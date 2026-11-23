CREATE TABLE public.payment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  razorpay_link_id text UNIQUE NOT NULL,
  short_url text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  guest_name text NOT NULL,
  phone text NOT NULL,
  purpose text NOT NULL,
  status text NOT NULL DEFAULT 'Issued',
  expires_at timestamptz,
  paid_at timestamptz,
  razorpay_payment_id text,
  booking_id uuid,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.payment_links TO authenticated;
GRANT ALL ON public.payment_links TO service_role;
ALTER TABLE public.payment_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_links_frontdesk ON public.payment_links FOR ALL TO authenticated USING (public.can_access_frontdesk_data()) WITH CHECK (public.can_access_frontdesk_data());