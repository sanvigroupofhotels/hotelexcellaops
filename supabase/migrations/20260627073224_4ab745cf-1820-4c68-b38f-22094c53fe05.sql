CREATE OR REPLACE FUNCTION public.push_subscriptions_fill_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.audience_role IS NULL THEN
    SELECT role::text INTO NEW.audience_role
      FROM public.user_roles
      WHERE user_id = NEW.user_id
      ORDER BY CASE role::text
        WHEN 'admin' THEN 1 WHEN 'owner' THEN 2 WHEN 'reception' THEN 3 ELSE 4
      END
      LIMIT 1;
  END IF;
  RETURN NEW;
END
$function$;