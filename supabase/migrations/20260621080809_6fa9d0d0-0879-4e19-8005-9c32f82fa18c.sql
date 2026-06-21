
-- 1. Canonicalization helper (mirrors src/lib/phone.ts)
CREATE OR REPLACE FUNCTION public.normalize_phone_in(p text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE s text; digits text;
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  s := regexp_replace(p, '[\s\-().]', '', 'g');
  IF s = '' THEN RETURN NULL; END IF;
  IF s ~ '^\+91[0-9]{10}$' THEN RETURN s; END IF;
  IF left(s,3) = '+91' THEN
    digits := regexp_replace(substring(s from 4), '[^0-9]', '', 'g');
    IF length(digits) = 10 THEN RETURN '+91' || digits; END IF;
  END IF;
  IF left(s,4) = '0091' THEN
    digits := regexp_replace(substring(s from 5), '[^0-9]', '', 'g');
    IF length(digits) = 10 THEN RETURN '+91' || digits; END IF;
  END IF;
  IF s ~ '^91[0-9]{10}$' THEN RETURN '+' || s; END IF;
  IF s ~ '^0[0-9]{10}$' THEN RETURN '+91' || substring(s from 2); END IF;
  IF s ~ '^[0-9]{10}$' THEN RETURN '+91' || s; END IF;
  RETURN NULL; -- invalid input → stored as NULL after cleanup
END $$;

-- 2. Snapshot counts BEFORE cleanup
DO $$
DECLARE
  v_dupe_pairs int;
  v_cust_non_canonical int;
  v_lead_non_canonical int;
  v_book_non_canonical int;
  v_quote_non_canonical int;
  v_cash_non_canonical int;
BEGIN
  SELECT count(*) INTO v_dupe_pairs FROM (
    SELECT 1 FROM public.customers
    WHERE phone IS NOT NULL AND trim(phone) <> ''
    GROUP BY public.normalize_phone_in(phone)
    HAVING count(*) > 1
  ) x;
  SELECT count(*) INTO v_cust_non_canonical FROM public.customers
    WHERE phone IS NOT NULL AND trim(phone)<>'' AND phone IS DISTINCT FROM public.normalize_phone_in(phone);
  SELECT count(*) INTO v_lead_non_canonical FROM public.leads
    WHERE phone IS NOT NULL AND phone IS DISTINCT FROM public.normalize_phone_in(phone);
  SELECT count(*) INTO v_book_non_canonical FROM public.bookings
    WHERE phone IS NOT NULL AND phone IS DISTINCT FROM public.normalize_phone_in(phone);
  SELECT count(*) INTO v_quote_non_canonical FROM public.quotes
    WHERE phone IS NOT NULL AND phone IS DISTINCT FROM public.normalize_phone_in(phone);
  SELECT count(*) INTO v_cash_non_canonical FROM public.cash_transactions
    WHERE guest_mobile IS NOT NULL AND guest_mobile IS DISTINCT FROM public.normalize_phone_in(guest_mobile);
  INSERT INTO public.app_settings(key, value)
    VALUES ('crm_phone_cleanup', jsonb_build_object(
      'ran_at', now(),
      'dupe_customer_pairs', v_dupe_pairs,
      'customers_non_canonical', v_cust_non_canonical,
      'leads_non_canonical', v_lead_non_canonical,
      'bookings_non_canonical', v_book_non_canonical,
      'quotes_non_canonical', v_quote_non_canonical,
      'cash_tx_non_canonical', v_cash_non_canonical
    ))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
END $$;

-- 3. Normalize existing phone columns (skip invalid → leave row's phone alone if normalization returns NULL but original was non-empty; we set to NULL only for genuinely unfixable values)
UPDATE public.leads
  SET phone = public.normalize_phone_in(phone)
  WHERE phone IS NOT NULL
    AND public.normalize_phone_in(phone) IS NOT NULL
    AND phone IS DISTINCT FROM public.normalize_phone_in(phone);

UPDATE public.bookings
  SET phone = public.normalize_phone_in(phone)
  WHERE phone IS NOT NULL
    AND public.normalize_phone_in(phone) IS NOT NULL
    AND phone IS DISTINCT FROM public.normalize_phone_in(phone);

UPDATE public.quotes
  SET phone = public.normalize_phone_in(phone)
  WHERE phone IS NOT NULL
    AND public.normalize_phone_in(phone) IS NOT NULL
    AND phone IS DISTINCT FROM public.normalize_phone_in(phone);

UPDATE public.cash_transactions
  SET guest_mobile = public.normalize_phone_in(guest_mobile)
  WHERE guest_mobile IS NOT NULL
    AND public.normalize_phone_in(guest_mobile) IS NOT NULL
    AND guest_mobile IS DISTINCT FROM public.normalize_phone_in(guest_mobile);

-- Customers: normalize in two phases so we never violate the existing partial unique mid-update.
-- Phase A: clear the partial unique index temporarily.
DROP INDEX IF EXISTS public.customers_phone_unique_when_set;

-- Phase B: normalize all fixable phone values.
UPDATE public.customers
  SET phone = public.normalize_phone_in(phone)
  WHERE phone IS NOT NULL
    AND trim(phone) <> ''
    AND public.normalize_phone_in(phone) IS NOT NULL
    AND phone IS DISTINCT FROM public.normalize_phone_in(phone);

-- Invalid (e.g. 9-digit "939692782") → NULL so it doesn't pretend to be a unique key
UPDATE public.customers
  SET phone = NULL
  WHERE phone IS NOT NULL
    AND trim(phone) <> ''
    AND public.normalize_phone_in(phone) IS NULL;

-- 4. Merge duplicate customers (oldest wins)
DO $$
DECLARE r record; dup_id uuid; keep_id uuid;
BEGIN
  FOR r IN
    SELECT phone, array_agg(id ORDER BY created_at) AS ids
    FROM public.customers
    WHERE phone IS NOT NULL AND trim(phone) <> ''
    GROUP BY phone
    HAVING count(*) > 1
  LOOP
    keep_id := r.ids[1];
    FOREACH dup_id IN ARRAY r.ids[2:array_length(r.ids,1)] LOOP
      UPDATE public.bookings           SET customer_id = keep_id WHERE customer_id = dup_id;
      UPDATE public.leads              SET customer_id = keep_id WHERE customer_id = dup_id;
      UPDATE public.quotes             SET customer_id = keep_id WHERE customer_id = dup_id;
      UPDATE public.cash_transactions  SET customer_id = keep_id WHERE customer_id = dup_id;
      UPDATE public.booking_payments   SET customer_id = keep_id WHERE customer_id = dup_id;
      DELETE FROM public.customers WHERE id = dup_id;
    END LOOP;
    PERFORM public.recompute_customer_bookings(keep_id);
    PERFORM public.recompute_customer_stats(keep_id);
    UPDATE public.customers c
      SET lead_count = (SELECT count(*)::int FROM public.leads WHERE customer_id = keep_id)
      WHERE c.id = keep_id;
  END LOOP;
END $$;

-- 5. Re-create the partial unique index (canonical form is now the only stored shape)
CREATE UNIQUE INDEX customers_phone_unique_when_set
  ON public.customers(phone)
  WHERE phone IS NOT NULL AND length(trim(phone)) > 0;

-- 6. Cash transaction linker: normalize before matching/creating customer
CREATE OR REPLACE FUNCTION public.cashtx_link_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_customer_id uuid;
  v_phone text;
BEGIN
  IF NEW.kind <> 'collection' THEN RETURN NEW; END IF;

  -- Canonicalize the mobile on the row itself, so storage = lookup key.
  v_phone := public.normalize_phone_in(NEW.guest_mobile);
  IF v_phone IS NOT NULL THEN
    NEW.guest_mobile := v_phone;
  END IF;

  IF NEW.customer_id IS NOT NULL THEN RETURN NEW; END IF;
  IF v_phone IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_customer_id FROM public.customers
    WHERE phone = v_phone
    ORDER BY created_at ASC LIMIT 1;

  IF v_customer_id IS NULL AND NEW.guest_name IS NOT NULL THEN
    INSERT INTO public.customers (user_id, guest_name, phone, lead_source)
    VALUES (NEW.user_id, NEW.guest_name, v_phone, 'Direct')
    RETURNING id INTO v_customer_id;
  END IF;

  NEW.customer_id := v_customer_id;
  RETURN NEW;
END $function$;

-- 7. Booking → customer phone sync: compare/copy canonical form
CREATE OR REPLACE FUNCTION public.bookings_sync_phone_to_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_new_phone text := public.normalize_phone_in(NEW.phone);
  v_cust_phone text;
BEGIN
  IF NEW.customer_id IS NULL OR v_new_phone IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.phone,'') = COALESCE(NEW.phone,'') THEN RETURN NEW; END IF;
  SELECT NULLIF(trim(phone),'') INTO v_cust_phone FROM public.customers WHERE id = NEW.customer_id;
  IF v_cust_phone IS NULL THEN
    UPDATE public.customers SET phone = v_new_phone WHERE id = NEW.customer_id;
  END IF;
  RETURN NEW;
END $function$;

-- 8. Final stats
DO $$
DECLARE v_remaining int;
BEGIN
  SELECT count(*) INTO v_remaining FROM (
    SELECT 1 FROM public.customers
    WHERE phone IS NOT NULL AND trim(phone) <> ''
    GROUP BY phone HAVING count(*) > 1
  ) x;
  UPDATE public.app_settings
    SET value = value || jsonb_build_object('finished_at', now(), 'remaining_dupes', v_remaining)
    WHERE key = 'crm_phone_cleanup';
END $$;
