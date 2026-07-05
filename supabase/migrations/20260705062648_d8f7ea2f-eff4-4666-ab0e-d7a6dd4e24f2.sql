-- Laundry stabilization: transactional RPCs for batch creation and return confirmation.
-- Makes multi-statement writes atomic (all queue-row flips, line inserts, batch row,
-- and activity_log entries either commit together or roll back together).

CREATE OR REPLACE FUNCTION public.create_laundry_batch(
  p_vendor_id           uuid,
  p_vendor_name         text,
  p_business_date       date,
  p_vendor_slip_number  text,
  p_pickup_remarks      text,
  p_pickup_slip_photo_path text,
  p_performer_id        uuid,
  p_performer_name      text,
  p_lines               jsonb            -- [{linen_type_id, linen_name_at_time, qty_heos_queue, qty_sent}]
) RETURNS public.laundry_batches
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_batch            public.laundry_batches;
  v_correlation      uuid := gen_random_uuid();
  v_line             jsonb;
  v_linen_type_id    uuid;
  v_linen_name       text;
  v_qty_queue        integer;
  v_qty_sent         integer;
  v_qty_in_house     integer;
  v_active_lines     jsonb := '[]'::jsonb;
  v_total_sent       integer := 0;
  v_total_in_house   integer := 0;
  v_sent_ids         uuid[];
  v_inhouse_ids      uuid[];
  v_parts            text := '';
BEGIN
  IF p_vendor_id IS NULL THEN
    RAISE EXCEPTION 'Vendor is required';
  END IF;

  -- Validate and collect active lines
  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb))
  LOOP
    v_qty_queue := COALESCE((v_line->>'qty_heos_queue')::int, 0);
    v_qty_sent  := COALESCE((v_line->>'qty_sent')::int, 0);
    v_linen_name := v_line->>'linen_name_at_time';
    IF v_qty_sent < 0 THEN
      RAISE EXCEPTION 'Sent quantity cannot be negative';
    END IF;
    IF v_qty_sent > v_qty_queue THEN
      RAISE EXCEPTION 'Sent (%) cannot exceed HEOS queue (%) for %', v_qty_sent, v_qty_queue, v_linen_name;
    END IF;
    IF v_qty_queue > 0 OR v_qty_sent > 0 THEN
      v_active_lines := v_active_lines || v_line;
      v_total_sent := v_total_sent + v_qty_sent;
      v_total_in_house := v_total_in_house + (v_qty_queue - v_qty_sent);
    END IF;
  END LOOP;

  IF jsonb_array_length(v_active_lines) = 0 THEN
    RAISE EXCEPTION 'Nothing to send — the queue is empty';
  END IF;

  -- Insert batch
  INSERT INTO public.laundry_batches (
    vendor_id, vendor_name_at_time, state, business_date,
    vendor_slip_number, pickup_remarks, pickup_slip_photo_path,
    sent_by_user_id, sent_by_name, correlation_id
  ) VALUES (
    p_vendor_id, p_vendor_name, 'sent', p_business_date,
    NULLIF(btrim(p_vendor_slip_number), ''),
    NULLIF(btrim(p_pickup_remarks), ''),
    NULLIF(btrim(p_pickup_slip_photo_path), ''),
    p_performer_id, p_performer_name, v_correlation
  )
  RETURNING * INTO v_batch;

  -- Insert lines + flip queue rows per linen type
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_active_lines)
  LOOP
    v_linen_type_id := (v_line->>'linen_type_id')::uuid;
    v_linen_name    := v_line->>'linen_name_at_time';
    v_qty_queue     := (v_line->>'qty_heos_queue')::int;
    v_qty_sent      := (v_line->>'qty_sent')::int;
    v_qty_in_house  := v_qty_queue - v_qty_sent;

    INSERT INTO public.laundry_batch_lines (
      batch_id, linen_type_id, linen_name_at_time,
      qty_heos_queue, qty_sent
    ) VALUES (
      v_batch.id, v_linen_type_id, v_linen_name,
      v_qty_queue, v_qty_sent
    );

    -- Oldest queued rows first: N sent, then remainder in-house
    WITH ordered AS (
      SELECT id, row_number() OVER (ORDER BY business_date ASC, created_at ASC) AS rn
      FROM public.laundry_queue
      WHERE state = 'queued' AND linen_type_id = v_linen_type_id
    )
    SELECT
      COALESCE(array_agg(id) FILTER (WHERE rn <= v_qty_sent), '{}'::uuid[]),
      COALESCE(array_agg(id) FILTER (WHERE rn > v_qty_sent AND rn <= v_qty_sent + v_qty_in_house), '{}'::uuid[])
    INTO v_sent_ids, v_inhouse_ids
    FROM ordered;

    IF array_length(v_sent_ids, 1) > 0 THEN
      UPDATE public.laundry_queue
         SET state = 'sent', batch_id = v_batch.id, processing_method = 'vendor'
       WHERE id = ANY(v_sent_ids);
    END IF;
    IF array_length(v_inhouse_ids, 1) > 0 THEN
      UPDATE public.laundry_queue
         SET state = 'returned', processing_method = 'in_house'
       WHERE id = ANY(v_inhouse_ids);
    END IF;

    IF v_qty_sent > 0 THEN
      v_parts := v_parts || CASE WHEN v_parts = '' THEN '' ELSE ', ' END
              || v_qty_sent::text || ' ' || v_linen_name;
    END IF;
  END LOOP;

  -- Activity log — same transaction
  PERFORM public.log_activity(
    'laundry', 'laundry_batch_sent', 'laundry_batch', v_batch.id, v_batch.batch_number,
    'Sent ' || v_total_sent || ' pieces (' || COALESCE(NULLIF(v_parts,''),'nothing') || ') to ' || p_vendor_name
      || CASE WHEN NULLIF(btrim(p_vendor_slip_number),'') IS NOT NULL
              THEN ' · slip #' || btrim(p_vendor_slip_number) ELSE '' END,
    NULL, NULL,
    jsonb_build_object(
      'total_sent', v_total_sent,
      'total_in_house', v_total_in_house,
      'vendor_id', p_vendor_id,
      'lines', v_active_lines
    ),
    'manual', NULL, v_correlation
  );

  IF v_total_in_house > 0 THEN
    PERFORM public.log_activity(
      'laundry', 'laundry_in_house_recorded', 'laundry_batch', v_batch.id, v_batch.batch_number,
      v_total_in_house || ' pieces washed in-house',
      NULL, NULL,
      jsonb_build_object('total_in_house', v_total_in_house),
      'manual', NULL, v_correlation
    );
  END IF;

  RETURN v_batch;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_laundry_batch(
  uuid, text, date, text, text, text, uuid, text, jsonb
) TO authenticated;


CREATE OR REPLACE FUNCTION public.confirm_laundry_return(
  p_batch_id           uuid,
  p_return_remarks     text,
  p_return_photo_path  text,
  p_performer_id       uuid,
  p_performer_name     text,
  p_lines              jsonb  -- [{line_id, linen_type_id, linen_name_at_time, qty_sent, qty_returned_ok, qty_short, qty_damaged, qty_lost}]
) RETURNS public.laundry_batches
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_batch          public.laundry_batches;
  v_line           jsonb;
  v_line_id        uuid;
  v_linen_type_id  uuid;
  v_linen_name     text;
  v_qs             integer;
  v_ok             integer;
  v_short          integer;
  v_dmg            integer;
  v_lost           integer;
  v_ids            uuid[];
  v_total_ok       integer := 0;
  v_total_short    integer := 0;
  v_total_dmg      integer := 0;
  v_total_lost     integer := 0;
  v_shortfall      text := '';
  v_bits           text;
BEGIN
  SELECT * INTO v_batch FROM public.laundry_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Batch not found';
  END IF;
  IF v_batch.state <> 'sent' THEN
    RAISE EXCEPTION 'Batch is % — cannot confirm return', v_batch.state;
  END IF;

  -- Validate lines
  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb))
  LOOP
    v_qs    := COALESCE((v_line->>'qty_sent')::int, 0);
    v_ok    := COALESCE((v_line->>'qty_returned_ok')::int, 0);
    v_short := COALESCE((v_line->>'qty_short')::int, 0);
    v_dmg   := COALESCE((v_line->>'qty_damaged')::int, 0);
    v_lost  := COALESCE((v_line->>'qty_lost')::int, 0);
    v_linen_name := v_line->>'linen_name_at_time';
    IF v_ok < 0 OR v_short < 0 OR v_dmg < 0 OR v_lost < 0 THEN
      RAISE EXCEPTION 'Quantities cannot be negative';
    END IF;
    IF (v_ok + v_short + v_dmg + v_lost) <> v_qs THEN
      RAISE EXCEPTION '%: OK+Short+Damaged+Lost (%) must equal Sent (%)',
        v_linen_name, (v_ok + v_short + v_dmg + v_lost), v_qs;
    END IF;
  END LOOP;

  -- Apply per-line updates + reconcile queue rows
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_id       := (v_line->>'line_id')::uuid;
    v_linen_type_id := (v_line->>'linen_type_id')::uuid;
    v_ok    := COALESCE((v_line->>'qty_returned_ok')::int, 0);
    v_short := COALESCE((v_line->>'qty_short')::int, 0);
    v_dmg   := COALESCE((v_line->>'qty_damaged')::int, 0);
    v_lost  := COALESCE((v_line->>'qty_lost')::int, 0);
    v_linen_name := v_line->>'linen_name_at_time';

    UPDATE public.laundry_batch_lines
       SET qty_returned_ok = v_ok,
           qty_short       = v_short,
           qty_damaged     = v_dmg,
           qty_lost        = v_lost
     WHERE id = v_line_id;

    -- Reconcile queue rows for this linen type in this batch
    SELECT array_agg(id ORDER BY business_date ASC, created_at ASC) INTO v_ids
    FROM public.laundry_queue
    WHERE batch_id = p_batch_id
      AND linen_type_id = v_linen_type_id
      AND processing_method = 'vendor';

    IF v_ids IS NULL THEN v_ids := '{}'::uuid[]; END IF;

    -- Slice allocation order: short, damaged, lost, then ok
    IF v_short > 0 THEN
      UPDATE public.laundry_queue
         SET state = 'queued', batch_id = NULL, processing_method = NULL
       WHERE id = ANY(v_ids[1:v_short]);
    END IF;
    IF v_dmg + v_lost > 0 THEN
      UPDATE public.laundry_queue
         SET state = 'written_off'
       WHERE id = ANY(v_ids[v_short+1 : v_short+v_dmg+v_lost]);
    END IF;
    IF v_ok > 0 THEN
      UPDATE public.laundry_queue
         SET state = 'returned'
       WHERE id = ANY(v_ids[v_short+v_dmg+v_lost+1 : array_length(v_ids,1)]);
    END IF;

    v_total_ok    := v_total_ok + v_ok;
    v_total_short := v_total_short + v_short;
    v_total_dmg   := v_total_dmg + v_dmg;
    v_total_lost  := v_total_lost + v_lost;

    IF v_short + v_dmg + v_lost > 0 THEN
      v_bits := '';
      IF v_short > 0 THEN v_bits := v_bits || v_short || ' short'; END IF;
      IF v_dmg   > 0 THEN v_bits := v_bits || CASE WHEN v_bits='' THEN '' ELSE ', ' END || v_dmg || ' damaged'; END IF;
      IF v_lost  > 0 THEN v_bits := v_bits || CASE WHEN v_bits='' THEN '' ELSE ', ' END || v_lost || ' lost'; END IF;
      v_shortfall := v_shortfall || CASE WHEN v_shortfall='' THEN '' ELSE ' · ' END || v_linen_name || ': ' || v_bits;
    END IF;
  END LOOP;

  -- Flip batch
  UPDATE public.laundry_batches
     SET state = 'returned',
         returned_at = now(),
         returned_by_user_id = p_performer_id,
         returned_by_name = p_performer_name,
         return_remarks = NULLIF(btrim(p_return_remarks), ''),
         return_photo_path = COALESCE(NULLIF(btrim(p_return_photo_path), ''), return_photo_path)
   WHERE id = p_batch_id
  RETURNING * INTO v_batch;

  PERFORM public.log_activity(
    'laundry', 'laundry_batch_returned', 'laundry_batch', v_batch.id, v_batch.batch_number,
    CASE WHEN v_total_short + v_total_dmg + v_total_lost = 0
         THEN 'Returned ' || v_total_ok || ' pieces from ' || v_batch.vendor_name_at_time || ' — all OK'
         ELSE 'Returned ' || v_total_ok || ' OK from ' || v_batch.vendor_name_at_time || ' · ' || v_shortfall
    END,
    NULL, NULL,
    jsonb_build_object(
      'total_ok', v_total_ok,
      'total_short', v_total_short,
      'total_damaged', v_total_dmg,
      'total_lost', v_total_lost,
      'lines', p_lines
    ),
    'manual', NULL, v_batch.correlation_id
  );

  RETURN v_batch;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_laundry_return(
  uuid, text, text, uuid, text, jsonb
) TO authenticated;