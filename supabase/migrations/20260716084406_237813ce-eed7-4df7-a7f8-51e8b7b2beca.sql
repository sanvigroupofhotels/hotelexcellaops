
-- UAT-001: Allow manual laundry lines where qty_heos_queue = 0 but qty_sent > 0.
-- Drop the table-level constraint that blocked this at insert time.
ALTER TABLE public.laundry_batch_lines DROP CONSTRAINT IF EXISTS qty_sent_le_queue;

-- Update the RPC so:
--   • qty_sent > qty_queue is rejected only for queue-backed lines
--     (i.e. rows where qty_heos_queue > 0). Manual rows (qty_heos_queue = 0)
--     may have any positive qty_sent.
--   • The batch is considered non-empty if there is at least one line with
--     qty_sent > 0 (manual OR queue) — no more "queue is empty" error when
--     the vendor picked up only manual items.
CREATE OR REPLACE FUNCTION public.create_laundry_batch(
  p_vendor_id           uuid,
  p_vendor_name         text,
  p_business_date       date,
  p_vendor_slip_number  text,
  p_pickup_remarks      text,
  p_pickup_slip_photo_path text,
  p_performer_id        uuid,
  p_performer_name      text,
  p_lines               jsonb
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

  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb))
  LOOP
    v_qty_queue := COALESCE((v_line->>'qty_heos_queue')::int, 0);
    v_qty_sent  := COALESCE((v_line->>'qty_sent')::int, 0);
    v_linen_name := v_line->>'linen_name_at_time';
    IF v_qty_sent < 0 OR v_qty_queue < 0 THEN
      RAISE EXCEPTION 'Quantities cannot be negative';
    END IF;
    -- UAT-001: enforce sent<=queue ONLY for queue-backed rows.
    -- Manual entries have qty_heos_queue = 0 and may have any positive qty_sent.
    IF v_qty_queue > 0 AND v_qty_sent > v_qty_queue THEN
      RAISE EXCEPTION 'Sent (%) cannot exceed HEOS queue (%) for %', v_qty_sent, v_qty_queue, v_linen_name;
    END IF;
    IF v_qty_queue > 0 OR v_qty_sent > 0 THEN
      v_active_lines := v_active_lines || v_line;
      v_total_sent := v_total_sent + v_qty_sent;
      v_total_in_house := v_total_in_house + GREATEST(0, v_qty_queue - v_qty_sent);
    END IF;
  END LOOP;

  IF jsonb_array_length(v_active_lines) = 0 THEN
    RAISE EXCEPTION 'Nothing to send — add at least one linen line';
  END IF;

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

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_active_lines)
  LOOP
    v_linen_type_id := (v_line->>'linen_type_id')::uuid;
    v_linen_name    := v_line->>'linen_name_at_time';
    v_qty_queue     := (v_line->>'qty_heos_queue')::int;
    v_qty_sent      := (v_line->>'qty_sent')::int;
    v_qty_in_house  := GREATEST(0, v_qty_queue - v_qty_sent);

    INSERT INTO public.laundry_batch_lines (
      batch_id, linen_type_id, linen_name_at_time,
      qty_heos_queue, qty_sent
    ) VALUES (
      v_batch.id, v_linen_type_id, v_linen_name,
      v_qty_queue, v_qty_sent
    );

    -- Queue-row reconciliation only when there is a real HEOS queue behind this line.
    IF v_qty_queue > 0 THEN
      WITH ordered AS (
        SELECT id, row_number() OVER (ORDER BY business_date ASC, created_at ASC) AS rn
        FROM public.laundry_queue
        WHERE state = 'queued' AND linen_type_id = v_linen_type_id
      )
      SELECT
        COALESCE(array_agg(id) FILTER (WHERE rn <= LEAST(v_qty_sent, v_qty_queue)), '{}'::uuid[]),
        COALESCE(array_agg(id) FILTER (WHERE rn > LEAST(v_qty_sent, v_qty_queue) AND rn <= v_qty_queue), '{}'::uuid[])
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
    END IF;

    IF v_qty_sent > 0 THEN
      v_parts := v_parts || CASE WHEN v_parts = '' THEN '' ELSE ', ' END
              || v_qty_sent::text || ' ' || v_linen_name;
    END IF;
  END LOOP;

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
