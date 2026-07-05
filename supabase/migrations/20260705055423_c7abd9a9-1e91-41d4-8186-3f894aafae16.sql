
ALTER TYPE public.laundry_queue_state ADD VALUE IF NOT EXISTS 'written_off';

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS vendor_kind text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS vendors_kind_gin_idx ON public.vendors USING gin (vendor_kind);

CREATE TYPE public.laundry_batch_state AS ENUM ('sent', 'returned', 'cancelled');

CREATE TABLE public.laundry_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number text UNIQUE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
  vendor_name_at_time text NOT NULL,
  state public.laundry_batch_state NOT NULL DEFAULT 'sent',
  business_date date NOT NULL,
  vendor_slip_number text,
  pickup_slip_photo_path text,
  return_photo_path text,
  pickup_remarks text,
  return_remarks text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  sent_by_user_id uuid,
  sent_by_name text,
  returned_at timestamptz,
  returned_by_user_id uuid,
  returned_by_name text,
  cancelled_at timestamptz,
  cancelled_by_user_id uuid,
  cancelled_by_name text,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  invoice_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.laundry_batches TO authenticated;
GRANT ALL ON public.laundry_batches TO service_role;
ALTER TABLE public.laundry_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "laundry_batches read authenticated"
  ON public.laundry_batches FOR SELECT TO authenticated USING (true);
CREATE POLICY "laundry_batches write authenticated"
  ON public.laundry_batches FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX laundry_batches_vendor_date_idx
  ON public.laundry_batches (vendor_id, business_date DESC);
CREATE INDEX laundry_batches_state_idx
  ON public.laundry_batches (state, business_date DESC);
CREATE TRIGGER trg_laundry_batches_updated_at
  BEFORE UPDATE ON public.laundry_batches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.laundry_batch_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.laundry_batches(id) ON DELETE CASCADE,
  linen_type_id uuid NOT NULL REFERENCES public.linen_types(id) ON DELETE RESTRICT,
  linen_name_at_time text NOT NULL,
  qty_heos_queue integer NOT NULL CHECK (qty_heos_queue >= 0),
  qty_sent integer NOT NULL CHECK (qty_sent >= 0),
  qty_returned_ok integer NOT NULL DEFAULT 0 CHECK (qty_returned_ok >= 0),
  qty_short integer NOT NULL DEFAULT 0 CHECK (qty_short >= 0),
  qty_damaged integer NOT NULL DEFAULT 0 CHECK (qty_damaged >= 0),
  qty_lost integer NOT NULL DEFAULT 0 CHECK (qty_lost >= 0),
  qty_in_house integer GENERATED ALWAYS AS (qty_heos_queue - qty_sent) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, linen_type_id),
  CONSTRAINT qty_sent_le_queue CHECK (qty_sent <= qty_heos_queue)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.laundry_batch_lines TO authenticated;
GRANT ALL ON public.laundry_batch_lines TO service_role;
ALTER TABLE public.laundry_batch_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "laundry_batch_lines read authenticated"
  ON public.laundry_batch_lines FOR SELECT TO authenticated USING (true);
CREATE POLICY "laundry_batch_lines write authenticated"
  ON public.laundry_batch_lines FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX laundry_batch_lines_batch_idx
  ON public.laundry_batch_lines (batch_id);
CREATE TRIGGER trg_laundry_batch_lines_updated_at
  BEFORE UPDATE ON public.laundry_batch_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.laundry_batch_lines_validate_return()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_state public.laundry_batch_state;
BEGIN
  SELECT state INTO v_state FROM public.laundry_batches WHERE id = NEW.batch_id;
  IF v_state = 'returned' THEN
    IF NEW.qty_sent <> (NEW.qty_returned_ok + NEW.qty_short + NEW.qty_damaged + NEW.qty_lost) THEN
      RAISE EXCEPTION 'Return quantities must sum to qty_sent (% <> % ok + % short + % dmg + % lost)',
        NEW.qty_sent, NEW.qty_returned_ok, NEW.qty_short, NEW.qty_damaged, NEW.qty_lost
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_laundry_batch_lines_validate_return
  BEFORE INSERT OR UPDATE ON public.laundry_batch_lines
  FOR EACH ROW EXECUTE FUNCTION public.laundry_batch_lines_validate_return();

ALTER TABLE public.laundry_queue
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.laundry_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS processing_method text
    CHECK (processing_method IS NULL OR processing_method IN ('vendor', 'in_house'));
CREATE INDEX IF NOT EXISTS laundry_queue_batch_idx ON public.laundry_queue (batch_id);
CREATE INDEX IF NOT EXISTS laundry_queue_state_created_idx
  ON public.laundry_queue (state, created_at) WHERE state = 'queued';

CREATE OR REPLACE FUNCTION public.next_laundry_batch_number(p_business_date date)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_next int;
  v_prefix text := 'LB-' || to_char(p_business_date, 'YYYYMMDD') || '-';
BEGIN
  SELECT COALESCE(MAX((substring(batch_number FROM length(v_prefix) + 1))::int), 0) + 1
    INTO v_next
    FROM public.laundry_batches
   WHERE batch_number LIKE v_prefix || '%';
  RETURN v_prefix || lpad(v_next::text, 3, '0');
END $$;

CREATE OR REPLACE FUNCTION public.laundry_batches_assign_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.batch_number IS NULL OR NEW.batch_number = '' THEN
    NEW.batch_number := public.next_laundry_batch_number(NEW.business_date);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_laundry_batches_assign_number
  BEFORE INSERT ON public.laundry_batches
  FOR EACH ROW EXECUTE FUNCTION public.laundry_batches_assign_number();

UPDATE public.vendors
   SET vendor_kind = ARRAY['laundry']
 WHERE lower(name) LIKE '%we wash%' AND NOT ('laundry' = ANY(vendor_kind));
