
CREATE TABLE public.booking_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  payment_mode text NOT NULL,
  collected_by text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_booking_payments_booking ON public.booking_payments(booking_id);
CREATE INDEX idx_booking_payments_customer ON public.booking_payments(customer_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_payments TO authenticated;
GRANT ALL ON public.booking_payments TO service_role;

ALTER TABLE public.booking_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bp_select_all" ON public.booking_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "bp_insert_auth" ON public.booking_payments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "bp_update_admin_or_owner" ON public.booking_payments FOR UPDATE TO authenticated
  USING (is_admin() OR auth.uid() = user_id) WITH CHECK (is_admin() OR auth.uid() = user_id);
CREATE POLICY "bp_delete_admin" ON public.booking_payments FOR DELETE TO authenticated USING (is_admin());

CREATE TRIGGER booking_payments_set_updated_at
  BEFORE UPDATE ON public.booking_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.recompute_booking_advance(p_booking_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.bookings b
  SET advance_paid = COALESCE((SELECT SUM(amount) FROM public.booking_payments WHERE booking_id = p_booking_id), 0)
  WHERE b.id = p_booking_id;
END $$;

CREATE OR REPLACE FUNCTION public.booking_payments_after_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.recompute_booking_advance(COALESCE(NEW.booking_id, OLD.booking_id));
  RETURN NULL;
END $$;

CREATE TRIGGER booking_payments_recompute
  AFTER INSERT OR UPDATE OR DELETE ON public.booking_payments
  FOR EACH ROW EXECUTE FUNCTION public.booking_payments_after_change();
