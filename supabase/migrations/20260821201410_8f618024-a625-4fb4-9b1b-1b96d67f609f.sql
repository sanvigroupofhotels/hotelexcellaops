CREATE OR REPLACE FUNCTION public.backfill_booking_item_segment_links()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_booking record;
  v_assignment record;
  v_item_id uuid;
  v_business date;
BEGIN
  SELECT (value->>'date')::date INTO v_business
    FROM public.app_settings WHERE key = 'business_date';
  v_business := COALESCE(v_business, CURRENT_DATE);

  CREATE TEMP TABLE IF NOT EXISTS _booking_item_tracks (
    booking_id uuid NOT NULL,
    item_id uuid NOT NULL,
    last_end date NOT NULL
  ) ON COMMIT DROP;

  FOR v_booking IN
    SELECT id, status, check_in, check_out FROM public.bookings ORDER BY created_at, id
  LOOP
    DELETE FROM _booking_item_tracks;

    FOR v_assignment IN
      SELECT a.id, a.booking_id, a.room_id, a.start_date, a.end_date, a.created_at, r.room_type
        FROM public.booking_room_assignments a
        LEFT JOIN public.rooms r ON r.id = a.room_id
       WHERE a.booking_id = v_booking.id
       ORDER BY a.start_date, a.created_at, a.id
    LOOP
      v_item_id := NULL;

      SELECT item_id INTO v_item_id
        FROM _booking_item_tracks
       WHERE booking_id = v_booking.id
         AND last_end = v_assignment.start_date
       ORDER BY item_id
       LIMIT 1;

      IF v_item_id IS NULL THEN
        SELECT i.id INTO v_item_id
          FROM public.booking_items i
         WHERE i.booking_id = v_booking.id
           AND NOT EXISTS (
             SELECT 1 FROM _booking_item_tracks t WHERE t.item_id = i.id
           )
         ORDER BY
           CASE
             WHEN lower(regexp_replace(COALESCE(i.room_type, ''), '\s+room\s*$', '', 'i')) =
                  lower(regexp_replace(COALESCE(v_assignment.room_type, ''), '\s+room\s*$', '', 'i'))
             THEN 0 ELSE 1
           END,
           i.position, i.created_at, i.id
         LIMIT 1;
      END IF;

      IF v_item_id IS NOT NULL THEN
        UPDATE public.booking_room_assignments
           SET item_id = v_item_id
         WHERE id = v_assignment.id;

        IF EXISTS (SELECT 1 FROM _booking_item_tracks WHERE item_id = v_item_id) THEN
          UPDATE _booking_item_tracks
             SET last_end = v_assignment.end_date
           WHERE item_id = v_item_id;
        ELSE
          INSERT INTO _booking_item_tracks(booking_id, item_id, last_end)
          VALUES (v_booking.id, v_item_id, v_assignment.end_date);
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  UPDATE public.booking_items i
     SET assigned_room_id = NULL
   WHERE NOT EXISTS (
     SELECT 1 FROM public.booking_room_assignments a
      WHERE a.item_id = i.id
   );

  WITH current_segment AS (
    SELECT DISTINCT ON (a.item_id)
           a.item_id, a.room_id
      FROM public.booking_room_assignments a
     WHERE a.item_id IS NOT NULL
     ORDER BY a.item_id,
       CASE WHEN a.start_date <= v_business AND a.end_date > v_business THEN 0 ELSE 1 END,
       a.start_date DESC,
       a.created_at DESC,
       a.id DESC
  )
  UPDATE public.booking_items i
     SET assigned_room_id = current_segment.room_id,
         updated_at = now()
    FROM current_segment
   WHERE i.id = current_segment.item_id
     AND i.assigned_room_id IS DISTINCT FROM current_segment.room_id;

  -- Only initialise item_status for items that have never had per-item
  -- lifecycle activity. NEVER overwrite a per-room check-in / check-out that
  -- reception already performed (partial-departure multi-room bookings).
  UPDATE public.booking_items i
     SET item_status = CASE
         WHEN b.status = 'Checked-In' THEN 'Checked-In'::public.booking_item_status
         WHEN b.status IN ('Checked-Out', 'Stay Completed') THEN 'Checked-Out'::public.booking_item_status
         WHEN b.status = 'Cancelled' THEN 'Cancelled'::public.booking_item_status
         WHEN b.status = 'No-Show' THEN 'No-Show'::public.booking_item_status
         ELSE 'Confirmed'::public.booking_item_status
       END,
       checked_in_at = CASE WHEN b.status = 'Checked-In' AND i.checked_in_at IS NULL THEN now() ELSE i.checked_in_at END,
       checked_out_at = CASE WHEN b.status IN ('Checked-Out', 'Stay Completed') AND i.checked_out_at IS NULL THEN now() ELSE i.checked_out_at END,
       updated_at = now()
    FROM public.bookings b
   WHERE b.id = i.booking_id
     AND i.item_status = 'Confirmed'::public.booking_item_status
     AND i.checked_in_at IS NULL
     AND i.checked_out_at IS NULL;
END $function$;