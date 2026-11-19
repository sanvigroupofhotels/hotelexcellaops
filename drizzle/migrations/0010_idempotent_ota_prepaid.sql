ALTER TABLE public.booking_payments ADD COLUMN IF NOT EXISTS ota_import_key text;
CREATE UNIQUE INDEX IF NOT EXISTS booking_payments_ota_import_key_unique ON public.booking_payments(ota_import_key) WHERE ota_import_key IS NOT NULL;
CREATE OR REPLACE FUNCTION public.record_ota_prepaid(p_booking_id uuid, p_total numeric, p_provider text, p_external_ref text)
RETURNS numeric LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE b public.bookings%ROWTYPE; v_other numeric; v_credit numeric; v_key text; v_payment uuid;
BEGIN
 IF p_total <= 0 OR p_total IS NULL OR length(p_provider)>120 OR length(p_external_ref)>120 THEN RAISE EXCEPTION 'Invalid OTA payment'; END IF;
 SELECT * INTO b FROM public.bookings WHERE id=p_booking_id FOR UPDATE;
 IF NOT FOUND OR b.integration_id IS NULL OR b.external_ref IS DISTINCT FROM p_external_ref THEN RAISE EXCEPTION 'Invalid OTA booking'; END IF;
 IF b.status::text IN ('Cancelled','No-Show','Checked-Out','Stay Completed') THEN RETURN 0; END IF;
 v_key := 'ota-prepaid:' || b.id::text;
 SELECT id INTO v_payment FROM public.booking_payments WHERE ota_import_key=v_key;
 SELECT COALESCE(sum(CASE WHEN is_refund THEN -amount ELSE amount END),0) INTO v_other FROM public.booking_payments WHERE booking_id=b.id AND (ota_import_key IS NULL OR ota_import_key<>v_key);
 v_credit := greatest(0,p_total-v_other);
 IF v_payment IS NOT NULL THEN
  UPDATE public.booking_payments SET amount=v_credit, notes='GST-inclusive prepaid total from '||p_provider||' #'||p_external_ref WHERE id=v_payment;
 ELSIF v_credit>0 THEN
  INSERT INTO public.booking_payments(user_id,booking_id,customer_id,amount,payment_mode,collected_by,notes,is_refund,ota_import_key)
  VALUES(b.user_id,b.id,b.customer_id,v_credit,'OTA Prepaid',p_provider,'GST-inclusive prepaid total from '||p_provider||' #'||p_external_ref,false,v_key);
 END IF;
 RETURN v_credit;
END; $$;
REVOKE ALL ON FUNCTION public.record_ota_prepaid(uuid,numeric,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_ota_prepaid(uuid,numeric,text,text) TO service_role;