
ALTER TABLE public.laundry_batches
  ADD COLUMN IF NOT EXISTS pickup_photo_paths text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS return_photo_paths text[] NOT NULL DEFAULT '{}'::text[];

-- Backfill from legacy single-path fields
UPDATE public.laundry_batches
   SET pickup_photo_paths = ARRAY[pickup_slip_photo_path]
 WHERE pickup_slip_photo_path IS NOT NULL
   AND (pickup_photo_paths IS NULL OR array_length(pickup_photo_paths,1) IS NULL);

UPDATE public.laundry_batches
   SET return_photo_paths = ARRAY[return_photo_path]
 WHERE return_photo_path IS NOT NULL
   AND (return_photo_paths IS NULL OR array_length(return_photo_paths,1) IS NULL);
