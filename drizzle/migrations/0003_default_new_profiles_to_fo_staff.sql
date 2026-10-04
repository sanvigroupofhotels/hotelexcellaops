CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'fo_staff'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END;
$function$;