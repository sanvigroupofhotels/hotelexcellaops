
-- 1) Tighten link_or_create_customer trigger.
--    Old logic used `phone = NEW.phone OR email = NEW.email` with `ORDER BY created_at ASC LIMIT 1`,
--    which could match an arbitrary unrelated customer when one side was NULL/empty.
--    New logic: phone-first exact match, then email-only exact match; treat empty strings as NULL.
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
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    RETURN NEW;
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
    VALUES (NEW.user_id, NEW.guest_name, NEW.phone, NEW.email, COALESCE(NEW.lead_source, 'Direct'))
    RETURNING id INTO v_customer_id;
  END IF;

  NEW.customer_id := v_customer_id;
  RETURN NEW;
END;
$function$;

-- 2) Backfill: for every booking whose linked customer's phone does NOT match the
--    booking's phone (and the booking has a phone), relink to the correct customer.
--    Create the customer if no phone match exists.
DO $$
DECLARE
  b RECORD;
  v_phone text;
  v_target uuid;
BEGIN
  FOR b IN
    SELECT bk.id, bk.user_id, bk.guest_name, bk.phone, bk.email, bk.customer_id,
           c.phone AS linked_phone, c.guest_name AS linked_name
    FROM public.bookings bk
    LEFT JOIN public.customers c ON c.id = bk.customer_id
    WHERE bk.phone IS NOT NULL
      AND NULLIF(trim(bk.phone),'') IS NOT NULL
  LOOP
    v_phone := NULLIF(trim(b.phone),'');
    -- skip already-correct (phone matches the linked customer)
    CONTINUE WHEN b.linked_phone IS NOT NULL AND NULLIF(trim(b.linked_phone),'') = v_phone;

    SELECT id INTO v_target
    FROM public.customers
    WHERE NULLIF(trim(phone),'') = v_phone
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_target IS NULL THEN
      INSERT INTO public.customers (user_id, guest_name, phone, email, lead_source)
      VALUES (b.user_id, b.guest_name, b.phone, b.email, 'Direct')
      RETURNING id INTO v_target;
    END IF;

    IF v_target IS DISTINCT FROM b.customer_id THEN
      UPDATE public.bookings SET customer_id = v_target WHERE id = b.id;
    END IF;
  END LOOP;
END $$;

-- 3) Recompute customer aggregates for everyone (trigger only fires on booking change;
--    a relink touches two customers so a one-shot full recompute is simplest).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.customers LOOP
    PERFORM public.recompute_customer_bookings(r.id);
  END LOOP;
END $$;
