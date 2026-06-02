-- booking_items: mirror of quote_items so bookings can hold multi-line stays
-- independently from their source quote.
CREATE TABLE public.booking_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  room_type text NOT NULL DEFAULT 'Standard Room',
  adults integer NOT NULL DEFAULT 2,
  children integer NOT NULL DEFAULT 0,
  check_in date NOT NULL,
  check_out date NOT NULL,
  nights integer GENERATED ALWAYS AS (GREATEST(1, (check_out - check_in))) STORED,
  breakfast_included boolean NOT NULL DEFAULT true,
  extra_bed integer NOT NULL DEFAULT 0,
  rate numeric NOT NULL DEFAULT 0,
  subtotal numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_booking_items_booking_id ON public.booking_items(booking_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_items TO authenticated;
GRANT ALL ON public.booking_items TO service_role;

ALTER TABLE public.booking_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY booking_items_select_all ON public.booking_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY booking_items_insert_own_parent ON public.booking_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.bookings b WHERE b.id = booking_items.booking_id AND b.user_id = auth.uid()
  ));

CREATE POLICY booking_items_update_own_parent ON public.booking_items
  FOR UPDATE TO authenticated USING (true)
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.bookings b WHERE b.id = booking_items.booking_id AND b.user_id = auth.uid()
  ));

CREATE POLICY booking_items_delete_own_parent ON public.booking_items
  FOR DELETE TO authenticated
  USING (is_admin() OR EXISTS (
    SELECT 1 FROM public.bookings b WHERE b.id = booking_items.booking_id AND b.user_id = auth.uid()
  ));

CREATE TRIGGER set_booking_items_updated_at
  BEFORE UPDATE ON public.booking_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();