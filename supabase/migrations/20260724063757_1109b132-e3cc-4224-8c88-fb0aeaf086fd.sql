ALTER TABLE public.booking_room_assignments
  ADD COLUMN IF NOT EXISTS item_id uuid REFERENCES public.booking_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bra_item ON public.booking_room_assignments(item_id);

DO $$
DECLARE
  v_item record;
  v_rooms integer;
  v_idx integer;
  v_each_subtotal numeric;
BEGIN
  FOR v_item IN
    SELECT * FROM public.booking_items WHERE COALESCE(rooms, 1) > 1 ORDER BY booking_id, position, created_at
  LOOP
    v_rooms := GREATEST(1, COALESCE(v_item.rooms, 1));
    v_each_subtotal := COALESCE(v_item.subtotal, 0) / v_rooms;

    UPDATE public.booking_items
       SET rooms = 1,
           subtotal = v_each_subtotal,
           updated_at = now()
     WHERE id = v_item.id;

    FOR v_idx IN 2..v_rooms LOOP
      INSERT INTO public.booking_items (
        booking_id, position, room_type, rooms, adults, children,
        check_in, check_out, breakfast_included, extra_bed,
        rate, subtotal, notes, early_check_in, early_check_in_slot,
        late_check_out, late_check_out_slot, pet_size, extra_adults,
        drivers, assigned_room_id, primary_occupant_name, primary_phone,
        item_status, checked_in_at, checked_out_at
      ) VALUES (
        v_item.booking_id, COALESCE(v_item.position, 0) + v_idx - 1,
        v_item.room_type, 1, v_item.adults, v_item.children,
        v_item.check_in, v_item.check_out,
        v_item.breakfast_included, v_item.extra_bed,
        v_item.rate, v_each_subtotal, v_item.notes,
        v_item.early_check_in, v_item.early_check_in_slot,
        v_item.late_check_out, v_item.late_check_out_slot,
        v_item.pet_size, v_item.extra_adults, v_item.drivers,
        NULL, v_item.primary_occupant_name, v_item.primary_phone,
        COALESCE(v_item.item_status, 'Confirmed'::public.booking_item_status),
        v_item.checked_in_at, v_item.checked_out_at
      );
    END LOOP;
  END LOOP;

  WITH ranked AS (
    SELECT id, row_number() OVER (PARTITION BY booking_id ORDER BY position, created_at, id) - 1 AS next_position
    FROM public.booking_items
  )
  UPDATE public.booking_items i
     SET position = ranked.next_position,
         updated_at = now()
    FROM ranked
   WHERE ranked.id = i.id
     AND i.position IS DISTINCT FROM ranked.next_position;
END $$;

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
   WHERE b.id = i.booking_id;
END $function$;

GRANT EXECUTE ON FUNCTION public.backfill_booking_item_segment_links() TO authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_booking_item_segment_links() TO service_role;

SELECT public.backfill_booking_item_segment_links();

CREATE OR REPLACE FUNCTION public.split_room_assignment(
  p_booking_id uuid,
  p_old_assignment_id uuid,
  p_new_room_id uuid,
  p_effective_date date DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_business date;
  v_effective date;
  v_booking record;
  v_old record;
  v_new_id uuid;
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, check_in, check_out INTO v_booking
    FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  SELECT (value->>'date')::date INTO v_business
    FROM public.app_settings WHERE key = 'business_date';
  v_business := COALESCE(v_business, CURRENT_DATE);

  v_effective := COALESCE(p_effective_date, v_business);
  IF v_effective < v_business THEN
    RAISE EXCEPTION 'Room moves cannot be back-dated. Business date is %.', v_business
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_effective < v_booking.check_in THEN v_effective := v_booking.check_in; END IF;
  IF v_effective > v_booking.check_out THEN v_effective := v_booking.check_out; END IF;

  SELECT * INTO v_old FROM public.booking_room_assignments
   WHERE id = p_old_assignment_id AND booking_id = p_booking_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;

  IF v_old.start_date < v_business AND v_effective <= v_old.start_date THEN
    RAISE EXCEPTION 'Cannot rewrite a segment that already covers past days (segment started %). Historical occupancy is immutable.', v_old.start_date
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_effective <= v_old.start_date THEN
    UPDATE public.booking_room_assignments
       SET room_id = p_new_room_id
     WHERE id = p_old_assignment_id;
    v_new_id := p_old_assignment_id;
  ELSE
    UPDATE public.booking_room_assignments
       SET end_date = v_effective,
           ended_reason = 'room_change'
     WHERE id = p_old_assignment_id;

    INSERT INTO public.booking_room_assignments
      (booking_id, room_id, user_id, start_date, end_date, item_id)
    VALUES
      (p_booking_id, p_new_room_id, v_user, v_effective, v_old.end_date, v_old.item_id)
    RETURNING id INTO v_new_id;
  END IF;

  UPDATE public.bookings
     SET room_id = (
       SELECT room_id FROM public.booking_room_assignments
        WHERE booking_id = p_booking_id
          AND start_date <= v_business
          AND end_date   >  v_business
        ORDER BY start_date DESC LIMIT 1
     )
   WHERE id = p_booking_id
     AND EXISTS (
       SELECT 1 FROM public.booking_room_assignments
        WHERE booking_id = p_booking_id
          AND start_date <= v_business
          AND end_date   >  v_business
     );

  IF v_old.item_id IS NOT NULL THEN
    UPDATE public.booking_items
       SET assigned_room_id = p_new_room_id,
           updated_at = now()
     WHERE id = v_old.item_id;
  END IF;

  RETURN v_new_id;
END $function$;

GRANT EXECUTE ON FUNCTION public.split_room_assignment(uuid, uuid, uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.split_room_assignment(uuid, uuid, uuid, date) TO service_role;