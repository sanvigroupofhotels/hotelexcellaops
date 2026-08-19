-- Legacy residue repair (live bookings): rooms of a Checked-In booking that
-- still carry 'Confirmed' because the old booking-level-only check-in never
-- reached the items. Only rooms with real occupancy (an assigned room or an
-- open segment) are stamped — no room assignments are created.
UPDATE public.booking_items i
   SET item_status = 'Checked-In',
       checked_in_at = COALESCE(i.checked_in_at, now())
  FROM public.bookings b
 WHERE b.id = i.booking_id
   AND b.status = 'Checked-In'
   AND i.item_status = 'Confirmed'
   AND (
     i.assigned_room_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.booking_room_assignments a WHERE a.item_id = i.id)
   );