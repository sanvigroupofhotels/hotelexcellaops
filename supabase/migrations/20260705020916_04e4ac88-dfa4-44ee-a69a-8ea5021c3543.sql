
CREATE OR REPLACE FUNCTION public.resolve_username_to_email(_username text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email
  FROM public.profiles
  WHERE username IS NOT NULL
    AND lower(username) = lower(_username)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.resolve_username_to_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_username_to_email(text) TO anon, authenticated, service_role;
