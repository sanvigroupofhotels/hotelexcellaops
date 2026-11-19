CREATE OR REPLACE FUNCTION public.create_whatsapp_room_draft(p_booking jsonb, p_items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_id uuid; v_item jsonb; v_type text; v_day date; v_capacity integer; v_demand integer; v_blocks integer; v_requested integer;
BEGIN
  IF jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 20 OR p_booking->>'status' <> 'Draft' OR p_booking->>'source_channel' <> 'BookingEngine' THEN RAISE EXCEPTION 'Invalid room request'; END IF;
  PERFORM pg_advisory_xact_lock(741921, 1);
  FOR v_type IN SELECT DISTINCT lower(regexp_replace(trim(value->>'room_type'), '\s+Room$', '', 'i')) FROM jsonb_array_elements(p_items) LOOP
    SELECT count(*) INTO v_capacity FROM public.rooms WHERE active AND lower(regexp_replace(trim(room_type), '\s+Room$', '', 'i')) = v_type;
    SELECT count(*) INTO v_requested FROM jsonb_array_elements(p_items) WHERE lower(regexp_replace(trim(value->>'room_type'), '\s+Room$', '', 'i')) = v_type;
    FOR v_day IN SELECT generate_series((p_booking->>'check_in')::date, (p_booking->>'check_out')::date - 1, '1 day'::interval)::date LOOP
      SELECT coalesce(sum(i.rooms),0) INTO v_demand FROM public.booking_items i JOIN public.bookings b ON b.id=i.booking_id WHERE lower(regexp_replace(trim(i.room_type), '\s+Room$', '', 'i'))=v_type AND i.check_in<=v_day AND i.check_out>v_day AND i.item_status::text NOT IN ('Checked-Out','Cancelled','No-Show','Removed') AND (b.status::text IN ('Pending','Confirmed','Advance Paid','Full Paid','Checked-In') OR (b.status::text='Draft' AND (b.draft_expires_at IS NULL OR b.draft_expires_at>=now())));
      SELECT v_demand+count(*) INTO v_demand FROM public.bookings b LEFT JOIN public.rooms r ON r.id=b.room_id WHERE NOT EXISTS (SELECT 1 FROM public.booking_items i WHERE i.booking_id=b.id) AND lower(regexp_replace(trim(coalesce(r.room_type,b.room_details)), '\s+Room$', '', 'i'))=v_type AND b.check_in<=v_day AND b.check_out>v_day AND (b.status::text IN ('Pending','Confirmed','Advance Paid','Full Paid','Checked-In') OR (b.status::text='Draft' AND (b.draft_expires_at IS NULL OR b.draft_expires_at>=now())));
      SELECT count(*) INTO v_blocks FROM public.room_maintenance m JOIN public.rooms r ON r.id=m.room_id WHERE m.active AND r.active AND m.start_date<=v_day AND m.end_date>v_day AND lower(regexp_replace(trim(r.room_type), '\s+Room$', '', 'i'))=v_type;
      IF v_requested+v_demand+v_blocks>v_capacity THEN RAISE EXCEPTION 'Selected rooms are no longer available. Please refresh your selection.'; END IF;
    END LOOP;
  END LOOP;
  INSERT INTO public.bookings(user_id,customer_id,booking_reference,guest_name,phone,check_in,check_out,adults,children,guests,room_details,subtotal,taxes,tax_rate,amount,status,source_channel,lead_source,draft_expires_at,special_requests,notes)
  VALUES ((p_booking->>'user_id')::uuid,(p_booking->>'customer_id')::uuid,p_booking->>'booking_reference',p_booking->>'guest_name',p_booking->>'phone',(p_booking->>'check_in')::date,(p_booking->>'check_out')::date,(p_booking->>'adults')::int,(p_booking->>'children')::int,(p_booking->>'guests')::int,p_booking->>'room_details',(p_booking->>'subtotal')::numeric,(p_booking->>'taxes')::numeric,(p_booking->>'tax_rate')::numeric,(p_booking->>'amount')::numeric,'Draft','BookingEngine','WhatsApp',(p_booking->>'draft_expires_at')::timestamptz,p_booking->>'special_requests',p_booking->>'notes') RETURNING id INTO v_id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.booking_items(booking_id,position,room_type,rooms,adults,children,check_in,check_out,nights,rate,subtotal,breakfast_included,extra_bed,pet_size,extra_adults,drivers,early_check_in,early_check_in_slot,late_check_out,late_check_out_slot)
    VALUES(v_id,(v_item->>'position')::int,v_item->>'room_type',1,(v_item->>'adults')::int,(v_item->>'children')::int,(v_item->>'check_in')::date,(v_item->>'check_out')::date,(v_item->>'check_out')::date-(v_item->>'check_in')::date,(v_item->>'rate')::numeric,(v_item->>'subtotal')::numeric,false,0,'none',(v_item->>'extra_adults')::int,0,(v_item->>'early_check_in')::boolean,v_item->>'early_check_in_slot',(v_item->>'late_check_out')::boolean,v_item->>'late_check_out_slot');
  END LOOP;
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.create_whatsapp_room_draft(jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_whatsapp_room_draft(jsonb,jsonb) TO service_role;