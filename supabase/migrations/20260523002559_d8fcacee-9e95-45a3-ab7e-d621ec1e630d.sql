-- Add standardized quote statuses to enum (keep old values for backward compatibility)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.quote_status'::regtype AND enumlabel = 'Draft') THEN
    ALTER TYPE public.quote_status ADD VALUE 'Draft';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.quote_status'::regtype AND enumlabel = 'Negotiation') THEN
    ALTER TYPE public.quote_status ADD VALUE 'Negotiation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.quote_status'::regtype AND enumlabel = 'Confirmed') THEN
    ALTER TYPE public.quote_status ADD VALUE 'Confirmed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.quote_status'::regtype AND enumlabel = 'Cancelled') THEN
    ALTER TYPE public.quote_status ADD VALUE 'Cancelled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.quote_status'::regtype AND enumlabel = 'Completed') THEN
    ALTER TYPE public.quote_status ADD VALUE 'Completed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.quote_status'::regtype AND enumlabel = 'Expired') THEN
    ALTER TYPE public.quote_status ADD VALUE 'Expired';
  END IF;
END $$;

-- Add optional children column for family booking analytics
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS children integer NOT NULL DEFAULT 0;

-- Fix recompute_customer_stats trigger function: align with valid enum values.
-- Treat Confirmed / Completed / Converted (legacy) as booked.
CREATE OR REPLACE FUNCTION public.recompute_customer_stats(p_customer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_customer_id IS NULL THEN RETURN; END IF;
  UPDATE public.customers c
  SET total_quotes = sub.total_quotes,
      total_bookings = sub.total_bookings,
      total_revenue = sub.total_revenue,
      last_stay_date = sub.last_stay_date
  FROM (
    SELECT
      COUNT(*)::int AS total_quotes,
      COUNT(*) FILTER (WHERE status::text IN ('Confirmed','Completed','Converted'))::int AS total_bookings,
      COALESCE(SUM(total) FILTER (WHERE status::text IN ('Confirmed','Completed','Converted')), 0) AS total_revenue,
      MAX(check_out) FILTER (WHERE status::text IN ('Confirmed','Completed','Converted')) AS last_stay_date
    FROM public.quotes WHERE customer_id = p_customer_id
  ) sub
  WHERE c.id = p_customer_id;
END;
$function$;