CREATE OR REPLACE FUNCTION public.guard_booking_cancellation()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_new_status text; v_old_status text; v_booking uuid;
BEGIN
 IF TG_TABLE_NAME='booking_items' THEN
  v_new_status:=NEW.item_status::text; v_booking:=NEW.booking_id;
  IF TG_OP='UPDATE' THEN v_old_status:=OLD.item_status::text; END IF;
 ELSE
  v_new_status:=NEW.status::text; v_booking:=NEW.id;
  IF TG_OP='UPDATE' THEN v_old_status:=OLD.status::text; END IF;
 END IF;
 IF v_new_status IN ('Cancelled','No-Show') AND v_new_status IS DISTINCT FROM v_old_status AND NOT public.can_cancel_bookings() THEN
  IF NOT (current_user='service_role' AND v_new_status='Cancelled' AND current_setting('heos.ota_cancel_booking',true)=v_booking::text) THEN
   RAISE EXCEPTION 'Only an owner or admin can cancel a booking or mark it as no-show.' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION public.process_ota_cancellation(p_booking_id uuid,p_integration_id uuid,p_provider text,p_external_ref text)
RETURNS numeric LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE b public.bookings%ROWTYPE; v_credit numeric; v_refunded numeric; v_offset numeric; v_changed boolean; v_reason text;
BEGIN
 SELECT * INTO b FROM public.bookings WHERE id=p_booking_id FOR UPDATE;
 IF NOT FOUND OR b.integration_id IS DISTINCT FROM p_integration_id OR b.external_ref IS DISTINCT FROM p_external_ref OR p_integration_id IS NULL OR p_provider IS NULL OR length(p_provider)>120 THEN RAISE EXCEPTION 'Invalid OTA booking'; END IF;
 IF b.status::text IN ('Checked-In','Checked-Out','Stay Completed','No-Show') OR EXISTS(SELECT 1 FROM public.booking_items WHERE booking_id=b.id AND (checked_in_at IS NOT NULL OR checked_out_at IS NOT NULL OR item_status::text IN ('Checked-In','Checked-Out','Stay Completed'))) THEN RAISE EXCEPTION 'OTA cancellation requires manual review: booking has stay history'; END IF;
 v_reason:='Cancelled on '||p_provider||' #'||p_external_ref;
 v_changed:=b.status::text<>'Cancelled';
 PERFORM set_config('heos.ota_cancel_booking',b.id::text,true);
 UPDATE public.bookings SET status='Cancelled',cancel_reason=v_reason,room_id=NULL WHERE id=b.id;
 UPDATE public.booking_items SET item_status='Cancelled',assigned_room_id=NULL WHERE booking_id=b.id;
 DELETE FROM public.booking_room_assignments WHERE booking_id=b.id;
 SELECT COALESCE(sum(amount),0) INTO v_credit FROM public.booking_payments WHERE booking_id=b.id AND NOT is_refund AND ota_import_key='ota-prepaid:'||b.id::text;
 SELECT COALESCE(sum(amount),0) INTO v_refunded FROM public.booking_payments WHERE booking_id=b.id AND is_refund;
 v_offset:=greatest(0,v_credit-v_refunded);
 IF v_offset>0 THEN
  INSERT INTO public.booking_payments(user_id,booking_id,customer_id,amount,payment_mode,collected_by,notes,is_refund,refund_reason,ota_import_key)
  VALUES(b.user_id,b.id,b.customer_id,v_offset,'OTA Refund',p_provider,'OTA ledger offset only; no hotel cash movement',true,v_reason,'ota-refund:'||b.id::text)
  ON CONFLICT(ota_import_key) WHERE ota_import_key IS NOT NULL DO NOTHING;
 END IF;
 UPDATE public.bookings SET cancel_refund_amount=(SELECT COALESCE(sum(amount),0) FROM public.booking_payments WHERE ota_import_key='ota-refund:'||b.id::text),cancel_refund_mode=CASE WHEN v_credit>0 THEN 'OTA Refund' ELSE NULL END,cancel_refund_at=CASE WHEN v_credit>0 THEN COALESCE(cancel_refund_at,now()) ELSE NULL END WHERE id=b.id;
 PERFORM public.recompute_booking_advance(b.id);
 IF v_changed THEN
  INSERT INTO public.booking_activities(booking_id,actor_name,actor_role,action,from_status,to_status,notes,metadata)
  VALUES(b.id,'System ('||p_provider||' Sync)','system','booking_cancelled',b.status::text,'Cancelled',v_reason,jsonb_build_object('source','ota_cancellation','integration_id',p_integration_id,'ota_offset',v_offset));
  INSERT INTO public.notifications(type,title,body,entity_type,entity_id,entity_reference,priority,audience_role,status,metadata)
  VALUES('booking_cancelled','OTA Cancellation · '||b.booking_reference,v_reason||'. OTA prepaid offset: ₹'||v_offset||'.','booking',b.id,b.booking_reference,'high','operations','unread',jsonb_build_object('booking_id',b.id,'source',p_provider,'integration_id',p_integration_id));
 END IF;
 PERFORM set_config('heos.ota_cancel_booking','',true);
 RETURN v_offset;
END; $$;
REVOKE ALL ON FUNCTION public.process_ota_cancellation(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_ota_cancellation(uuid,uuid,text,text) TO service_role;