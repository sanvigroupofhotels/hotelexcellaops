ALTER TABLE public.booking_charges
  ADD COLUMN IF NOT EXISTS standard_unit_price numeric,
  ADD COLUMN IF NOT EXISTS price_overridden boolean NOT NULL DEFAULT false;

ALTER TABLE public.booking_items
  ADD COLUMN IF NOT EXISTS early_check_in_override numeric,
  ADD COLUMN IF NOT EXISTS late_check_out_override numeric;

COMMENT ON COLUMN public.booking_charges.standard_unit_price IS 'System-calculated standard unit price before any reception override. NULL = never auto-priced.';
COMMENT ON COLUMN public.booking_charges.price_overridden IS 'TRUE when reception manually overrode the calculated amount; blocks auto re-pricing from silently overwriting it.';
COMMENT ON COLUMN public.booking_items.early_check_in_override IS 'Per-room negotiated Early Check-In amount overriding the slot fee. NULL = use standard slot pricing.';
COMMENT ON COLUMN public.booking_items.late_check_out_override IS 'Per-room negotiated Late Check-Out amount overriding the slot fee. NULL = use standard slot pricing.';