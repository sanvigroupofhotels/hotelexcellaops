
-- 1) Allow operators to insert operational notifications via the engine.
GRANT INSERT ON public.notifications TO authenticated;

DROP POLICY IF EXISTS "Operators can emit operational notifications" ON public.notifications;
CREATE POLICY "Operators can emit operational notifications"
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- 2) Notification email recipients (editable from Settings).
INSERT INTO public.app_settings (key, value)
VALUES ('notification_email_recipients',
        jsonb_build_array('hotelexcellavizag@gmail.com'))
ON CONFLICT (key) DO NOTHING;

-- 3) Dispatch URL + secret for the email fan-out (mirrors push_dispatch_*).
INSERT INTO public.app_settings (key, value)
VALUES ('notification_email_dispatch_url', to_jsonb(''::text))
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_settings (key, value)
VALUES ('notification_email_dispatch_secret', to_jsonb(''::text))
ON CONFLICT (key) DO NOTHING;

-- 4) Trigger function — POSTs notification id to the email dispatcher.
CREATE OR REPLACE FUNCTION public.notifications_dispatch_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_url text;
  v_secret text;
BEGIN
  BEGIN
    SELECT value #>> '{}' INTO v_url
      FROM public.app_settings WHERE key = 'notification_email_dispatch_url';
    SELECT value #>> '{}' INTO v_secret
      FROM public.app_settings WHERE key = 'notification_email_dispatch_secret';
    IF v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN
      RETURN NEW;
    END IF;
    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-dispatch-secret', v_secret
      ),
      body    := jsonb_build_object('notification_id', NEW.id::text)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- email fan-out is best-effort; never block the insert
  END;
  RETURN NEW;
END
$func$;

DROP TRIGGER IF EXISTS notifications_dispatch_email_trg ON public.notifications;
CREATE TRIGGER notifications_dispatch_email_trg
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_dispatch_email();
