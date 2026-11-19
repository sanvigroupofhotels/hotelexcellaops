CREATE OR REPLACE FUNCTION public.refresh_unassigned_ota_items(p_booking_id uuid,p_items jsonb) RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
PERFORM 1 FROM public.bookings WHERE id=p_booking_id AND status::text NOT IN ('Checked-In','Checked-Out','Stay Completed','Cancelled','No-Show') FOR UPDATE;
IF NOT FOUND THEN RETURN false; END IF;
IF EXISTS(SELECT 1 FROM public.booking_room_assignments WHERE booking_id=p_booking_id) OR EXISTS(SELECT 1 FROM public.booking_items WHERE booking_id=p_booking_id AND (assigned_room_id IS NOT NULL OR checked_in_at IS NOT NULL OR checked_out_at IS NOT NULL OR item_status::text NOT IN ('Confirmed','Pending'))) THEN RETURN false; END IF;
DELETE FROM public.booking_items WHERE booking_id=p_booking_id;
INSERT INTO public.booking_items(booking_id,position,room_type,rooms,adults,children,check_in,check_out,rate,subtotal,breakfast_included,extra_bed,extra_adults,drivers,early_check_in,early_check_in_slot,late_check_out,late_check_out_slot,pet_size,notes)
SELECT p_booking_id,x.position,x.room_type,x.rooms,x.adults,x.children,x.check_in,x.check_out,x.rate,x.subtotal,x.breakfast_included,x.extra_bed,x.extra_adults,x.drivers,x.early_check_in,x.early_check_in_slot,x.late_check_out,x.late_check_out_slot,x.pet_size,x.notes FROM jsonb_populate_recordset(NULL::public.booking_items,p_items) x;
RETURN true; END $$;