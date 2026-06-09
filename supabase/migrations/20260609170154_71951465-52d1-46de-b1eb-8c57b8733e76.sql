
CREATE OR REPLACE FUNCTION public.link_or_create_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_customer_id uuid;
  v_phone text := NULLIF(trim(NEW.phone), '');
  v_email text := NULLIF(lower(trim(NEW.email)), '');
  v_lead_source text;
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- lead_source only exists on quotes; bookings default to 'Operations'.
  IF TG_TABLE_NAME = 'quotes' THEN
    BEGIN
      v_lead_source := COALESCE(NULLIF(trim(row_to_json(NEW)->>'lead_source'), ''), 'Direct');
    EXCEPTION WHEN OTHERS THEN
      v_lead_source := 'Direct';
    END;
  ELSE
    v_lead_source := 'Operations';
  END IF;

  IF v_phone IS NOT NULL THEN
    SELECT id INTO v_customer_id
    FROM public.customers
    WHERE NULLIF(trim(phone),'') = v_phone
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_customer_id IS NULL AND v_email IS NOT NULL THEN
    SELECT id INTO v_customer_id
    FROM public.customers
    WHERE lower(NULLIF(trim(email),'')) = v_email
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (user_id, guest_name, phone, email, lead_source)
    VALUES (NEW.user_id, NEW.guest_name, NEW.phone, NEW.email, v_lead_source)
    RETURNING id INTO v_customer_id;
  END IF;

  NEW.customer_id := v_customer_id;
  RETURN NEW;
END;
$function$;
