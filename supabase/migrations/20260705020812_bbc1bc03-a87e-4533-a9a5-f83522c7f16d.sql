
-- Backfill role assignments per approved mapping.
INSERT INTO public.user_roles (user_id, role)
SELECT DISTINCT ur.user_id, 'fo_staff'::public.app_role
FROM public.user_roles ur
WHERE ur.role = 'reception'
ON CONFLICT DO NOTHING;

DELETE FROM public.user_roles WHERE role = 'reception';

INSERT INTO public.user_roles (user_id, role)
SELECT DISTINCT ur.user_id, 'housekeeping'::public.app_role
FROM public.user_roles ur
WHERE ur.role = 'staff'
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur2
    WHERE ur2.user_id = ur.user_id
      AND ur2.role IN ('admin','owner')
  )
ON CONFLICT DO NOTHING;

DELETE FROM public.user_roles WHERE role = 'staff';

-- Username column + backfill.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text;

DO $$
DECLARE
  r record;
  base text;
  candidate text;
  n int;
BEGIN
  FOR r IN SELECT id, email FROM public.profiles WHERE username IS NULL LOOP
    base := lower(regexp_replace(split_part(coalesce(r.email, r.id::text), '@', 1), '[^a-z0-9._-]+', '_', 'g'));
    IF base IS NULL OR length(base) < 3 THEN
      base := 'user_' || substr(replace(r.id::text, '-', ''), 1, 6);
    END IF;
    base := substr(base, 1, 32);
    candidate := base;
    n := 1;
    WHILE EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = lower(candidate)) LOOP
      n := n + 1;
      candidate := substr(base, 1, 30) || n::text;
    END LOOP;
    UPDATE public.profiles SET username = candidate WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_username_format_ck;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_format_ck
  CHECK (username IS NULL OR username ~ '^[a-z0-9._-]{3,32}$');

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_uq
  ON public.profiles ((lower(username)))
  WHERE username IS NOT NULL;
