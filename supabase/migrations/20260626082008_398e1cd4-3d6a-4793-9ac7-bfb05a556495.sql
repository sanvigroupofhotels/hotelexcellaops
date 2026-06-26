-- Push notification framework hardening
-- 1. Drop duplicate trigger (two triggers were firing notifications_dispatch_push per row → duplicate pushes)
DROP TRIGGER IF EXISTS trg_notifications_dispatch_push ON public.notifications;

-- 2. Seed app_settings rows for push dispatch if missing. The actual URL/secret
--    are filled in by the admin via Settings → General → Push Notifications.
INSERT INTO public.app_settings (key, value)
VALUES ('push_dispatch_url', to_jsonb(''::text))
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_settings (key, value)
VALUES ('push_dispatch_secret', to_jsonb(''::text))
ON CONFLICT (key) DO NOTHING;