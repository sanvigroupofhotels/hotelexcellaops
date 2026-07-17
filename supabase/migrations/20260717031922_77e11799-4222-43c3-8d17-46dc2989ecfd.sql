
-- Fix tg_customer_phones_sync_primary: never null-out customers.phone
-- when the customer has no primary row yet. This previously happened for
-- customers created after the multi-phone rollout (createCustomer never
-- inserted a customer_phones row), so the first alternate number added
-- via the panel or guest portal wiped customers.phone.
CREATE OR REPLACE FUNCTION public.tg_customer_phones_sync_primary()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_customer uuid;
  v_primary text;
BEGIN
  v_customer := COALESCE(NEW.customer_id, OLD.customer_id);
  SELECT phone INTO v_primary FROM public.customer_phones
    WHERE customer_id = v_customer AND is_primary = true LIMIT 1;
  -- Only mirror when a primary exists. Otherwise leave customers.phone
  -- untouched so the legacy value survives until staff explicitly
  -- promote a number to Primary.
  IF v_primary IS NOT NULL THEN
    UPDATE public.customers SET phone = v_primary, updated_at = now() WHERE id = v_customer;
  END IF;
  RETURN NEW;
END; $$;

-- Backfill: any customer with a phone but no customer_phones row (i.e.
-- created after the initial rollout) gets a Primary row now.
INSERT INTO public.customer_phones (customer_id, user_id, phone, is_primary, label)
SELECT c.id, c.user_id, c.phone, true, 'Primary'
FROM public.customers c
WHERE c.phone IS NOT NULL AND trim(c.phone) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.customer_phones cp WHERE cp.customer_id = c.id
  )
ON CONFLICT (phone) DO NOTHING;
