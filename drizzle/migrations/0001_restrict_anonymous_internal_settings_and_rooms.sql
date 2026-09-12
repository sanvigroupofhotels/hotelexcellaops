DROP POLICY IF EXISTS "Public read app settings" ON public.app_settings;
REVOKE ALL PRIVILEGES ON TABLE public.app_settings FROM anon;

DROP POLICY IF EXISTS "Public read active rooms" ON public.rooms;
REVOKE ALL PRIVILEGES ON TABLE public.rooms FROM anon;

GRANT SELECT ON TABLE public.app_settings TO authenticated;
GRANT ALL ON TABLE public.app_settings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rooms TO authenticated;
GRANT ALL ON TABLE public.rooms TO service_role;