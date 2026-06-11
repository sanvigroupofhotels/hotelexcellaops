ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS emergency_contact_name text,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone text;

-- Backfill: take latest non-null booking emergency contact per customer
UPDATE public.customers c SET
  emergency_contact_name = COALESCE(c.emergency_contact_name, src.name),
  emergency_contact_phone = COALESCE(c.emergency_contact_phone, src.phone)
FROM (
  SELECT DISTINCT ON (customer_id)
    customer_id,
    emergency_contact_name AS name,
    emergency_contact_phone AS phone
  FROM public.bookings
  WHERE customer_id IS NOT NULL
    AND (emergency_contact_name IS NOT NULL OR emergency_contact_phone IS NOT NULL)
  ORDER BY customer_id, updated_at DESC
) src
WHERE c.id = src.customer_id;