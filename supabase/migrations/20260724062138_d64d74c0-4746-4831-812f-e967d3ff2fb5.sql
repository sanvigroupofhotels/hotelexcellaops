-- =============================================================================
-- Phase 2 · Foundation schema for per-room operational identity
-- Non-breaking: all new columns are nullable / defaulted; no existing read
-- paths touched. Later phases will populate & consume these fields.
-- =============================================================================

-- 1) Per-item operational status enum ----------------------------------------
DO $$ BEGIN
  CREATE TYPE public.booking_item_status AS ENUM (
    'Confirmed', 'Checked-In', 'Checked-Out', 'Cancelled', 'No-Show'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) booking_items: per-room operational identity ----------------------------
ALTER TABLE public.booking_items
  ADD COLUMN IF NOT EXISTS assigned_room_id      uuid REFERENCES public.rooms(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS primary_occupant_name text,
  ADD COLUMN IF NOT EXISTS primary_phone         text,
  ADD COLUMN IF NOT EXISTS item_status           public.booking_item_status NOT NULL DEFAULT 'Confirmed',
  ADD COLUMN IF NOT EXISTS checked_in_at         timestamptz,
  ADD COLUMN IF NOT EXISTS checked_out_at        timestamptz;

CREATE INDEX IF NOT EXISTS idx_booking_items_assigned_room ON public.booking_items(assigned_room_id);
CREATE INDEX IF NOT EXISTS idx_booking_items_item_status   ON public.booking_items(item_status);

-- 3) booking_charges.item_id — optional per-room attribution ------------------
ALTER TABLE public.booking_charges
  ADD COLUMN IF NOT EXISTS item_id uuid REFERENCES public.booking_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_booking_charges_item ON public.booking_charges(item_id);

-- 4) booking_item_activities — per-room operational timeline -----------------
CREATE TABLE IF NOT EXISTS public.booking_item_activities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id       uuid NOT NULL REFERENCES public.booking_items(id) ON DELETE CASCADE,
  booking_id    uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  actor_id      uuid,
  actor_name    text,
  actor_role    text,
  action        text NOT NULL,
  field         text,
  old_value     text,
  new_value     text,
  summary       text,
  metadata      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_item_activities TO authenticated;
GRANT ALL ON public.booking_item_activities TO service_role;

ALTER TABLE public.booking_item_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read booking item activities"
  ON public.booking_item_activities FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated can write booking item activities"
  ON public.booking_item_activities FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_booking_item_activities_item    ON public.booking_item_activities(item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_item_activities_booking ON public.booking_item_activities(booking_id, created_at DESC);