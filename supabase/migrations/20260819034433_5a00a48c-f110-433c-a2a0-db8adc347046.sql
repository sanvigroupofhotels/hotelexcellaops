-- Repair: live Checked-In bookings whose items were never stamped (pre-fan-out legacy).
update public.booking_items i
set item_status = 'Checked-In',
    checked_in_at = coalesce(i.checked_in_at, now())
from public.bookings b
where i.booking_id = b.id
  and b.status::text = 'Checked-In'
  and i.item_status::text = 'Confirmed';

-- Link existing occupancy segments to their booking item and mirror the room.
select public.backfill_booking_item_segment_links();

update public.booking_items i
set assigned_room_id = a.room_id
from public.booking_room_assignments a
where a.item_id = i.id
  and i.assigned_room_id is null;