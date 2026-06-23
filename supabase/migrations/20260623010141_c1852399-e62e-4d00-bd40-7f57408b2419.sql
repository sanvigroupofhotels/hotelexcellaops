
-- Server-side guard: Business Date can never exceed the calendar date (Asia/Kolkata).
-- A trigger on app_settings rejects any write where key='business_date' and value->>'date' > today (IST).
CREATE OR REPLACE FUNCTION public.app_settings_guard_business_date()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_date date;
  v_today date;
BEGIN
  IF NEW.key <> 'business_date' THEN
    RETURN NEW;
  END IF;
  v_date := NULLIF(NEW.value->>'date', '')::date;
  IF v_date IS NULL THEN
    RETURN NEW;
  END IF;
  v_today := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  IF v_date > v_today THEN
    RAISE EXCEPTION 'Business Date (%) cannot exceed the current calendar date (%).', v_date, v_today
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS app_settings_guard_business_date_ins ON public.app_settings;
DROP TRIGGER IF EXISTS app_settings_guard_business_date_upd ON public.app_settings;

CREATE TRIGGER app_settings_guard_business_date_ins
  BEFORE INSERT ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.app_settings_guard_business_date();

CREATE TRIGGER app_settings_guard_business_date_upd
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.app_settings_guard_business_date();
