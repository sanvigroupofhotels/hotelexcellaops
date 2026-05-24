
-- Customers: own rows only
DROP POLICY IF EXISTS customers_select_auth ON public.customers;
CREATE POLICY customers_select_own ON public.customers
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Quotes: own rows only
DROP POLICY IF EXISTS quotes_select_auth ON public.quotes;
CREATE POLICY quotes_select_own ON public.quotes
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Followups: own rows only
DROP POLICY IF EXISTS followups_select_auth ON public.followups;
CREATE POLICY followups_select_own ON public.followups
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Tasks: own rows only
DROP POLICY IF EXISTS tasks_select_auth ON public.tasks;
CREATE POLICY tasks_select_own ON public.tasks
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Profiles: own row only
DROP POLICY IF EXISTS profiles_select_all_auth ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

-- Quote activities: only for quotes the user owns
DROP POLICY IF EXISTS activities_select_auth ON public.quote_activities;
CREATE POLICY activities_select_own ON public.quote_activities
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.quotes q
      WHERE q.id = quote_activities.quote_id AND q.user_id = auth.uid()
    )
  );
