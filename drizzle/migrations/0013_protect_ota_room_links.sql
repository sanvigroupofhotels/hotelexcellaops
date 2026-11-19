CREATE OR REPLACE FUNCTION public.lock_booking_for_room_assignment() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN PERFORM 1 FROM public.bookings WHERE id=NEW.booking_id FOR UPDATE; RETURN NEW; END $$;
CREATE TRIGGER lock_booking_before_room_assignment BEFORE INSERT OR UPDATE ON public.booking_room_assignments FOR EACH ROW EXECUTE FUNCTION public.lock_booking_for_room_assignment();
CREATE OR REPLACE FUNCTION public.refresh_unassigned_ota_items(p_booking_id uuid,p_items jsonb) RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
PERFORM 1 FROM public.bookings WHERE id=p_booking_id AND status::text NOT IN ('Checked-In','Checked-Out','Stay Completed','Cancelled','No-Show') FOR UPDATE;
IF NOT FOUND THEN RETURN false; END IF;
IF EXISTS(SELECT 1 FROM public.booking_room_assignments WHERE booking_id=p_booking_id) OR EXISTS(SELECT 1 FROM public.booking_items WHERE booking_id=p_booking_id AND (assigned_room_id IS NOT NULL OR checked_in_at IS NOT NULL OR checked_out_at IS NOT NULL OR item_status::text NOT IN ('Confirmed','Pending'))) THEN RETURN false; END IF;
DELETE FROM public.booking_items WHERE booking_id=p_booking_id;
INSERT INTO public.booking_items(booking_id,position,room_type,rooms,adults,children,check_in,check_out,nights,rate,subtotal,breakfast_included,extra_bed,extra_adults,drivers,early_check_in,early_check_in_slot,late_check_out,late_check_out_slot,pet_size,notes)
SELECT p_booking_id,x.position,x.room_type,x.rooms,x.adults,x.children,x.check_in,x.check_out,x.nights,x.rate,x.subtotal,x.breakfast_included,x.extra_bed,x.extra_adults,x.drivers,x.early_check_in,x.early_check_in_slot,x.late_check_out,x.late_check_out_slot,x.pet_size,x.notes FROM jsonb_populate_recordset(NULL::public.booking_items,p_items) x;
RETURN true; END $$;
REVOKE ALL ON FUNCTION public.refresh_unassigned_ota_items(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_unassigned_ota_items(uuid,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.reconcile_checkin_room_links(p_booking_id uuid) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$ DECLARE a record; v_item uuid; v_date date; BEGIN
PERFORM 1 FROM public.bookings WHERE id=p_booking_id AND status::text NOT IN ('Checked-Out','Stay Completed','Cancelled','No-Show') FOR UPDATE;
IF NOT FOUND THEN RETURN; END IF;
SELECT (value->>'date')::date INTO v_date FROM public.app_settings WHERE key='business_date';
v_date:=coalesce(v_date,(now() AT TIME ZONE 'Asia/Kolkata')::date);
FOR a IN SELECT s.*,r.room_type FROM public.booking_room_assignments s JOIN public.rooms r ON r.id=s.room_id WHERE s.booking_id=p_booking_id AND s.item_id IS NULL AND s.ended_reason IS NULL AND s.end_date>v_date ORDER BY s.start_date,s.created_at LOOP
SELECT i.id INTO v_item FROM public.booking_items i WHERE i.booking_id=p_booking_id AND i.assigned_room_id IS NULL AND i.item_status::text IN ('Confirmed','Checked-In') AND lower(regexp_replace(trim(i.room_type),'\s+room$','','i'))=lower(regexp_replace(trim(a.room_type),'\s+room$','','i')) AND NOT EXISTS(SELECT 1 FROM public.booking_room_assignments z WHERE z.item_id=i.id AND z.start_date<a.end_date AND a.start_date<z.end_date) ORDER BY i.position LIMIT 1;
IF v_item IS NOT NULL THEN UPDATE public.booking_room_assignments SET item_id=v_item WHERE id=a.id; UPDATE public.booking_items SET assigned_room_id=a.room_id WHERE id=v_item; END IF;
END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.reconcile_checkin_room_links(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reconcile_checkin_room_links(uuid) TO authenticated,service_role;