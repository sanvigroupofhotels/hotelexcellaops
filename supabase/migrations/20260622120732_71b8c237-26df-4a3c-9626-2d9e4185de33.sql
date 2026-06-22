
-- Document verification status (used by Guest Portal profile completion)
ALTER TABLE public.guest_documents
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by_name text;

-- Guest review enrichment for the portal feedback flow
ALTER TABLE public.guest_reviews
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS feedback_what_went_wrong text,
  ADD COLUMN IF NOT EXISTS feedback_additional_comments text,
  ADD COLUMN IF NOT EXISTS routed_to_external boolean NOT NULL DEFAULT false;
