-- Slice B: Add/Remove Room during stay — schema foundation.
-- 1) Extend booking_item_status enum with 'Removed'.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'booking_item_status' AND e.enumlabel = 'Removed'
  ) THEN
    ALTER TYPE public.booking_item_status ADD VALUE 'Removed';
  END IF;
END $$;

-- 2) Track removal metadata + audit whether a room was added during the stay.
ALTER TABLE public.booking_items
  ADD COLUMN IF NOT EXISTS removed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS removed_reason    TEXT,
  ADD COLUMN IF NOT EXISTS added_during_stay BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS booking_items_status_idx
  ON public.booking_items (booking_id, item_status);