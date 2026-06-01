
-- Restrict user_roles SELECT to own row (prevent enumeration of admins)
DROP POLICY IF EXISTS user_roles_select_all ON public.user_roles;
CREATE POLICY user_roles_select_own ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Tighten UPDATE policies: prevent reassigning ownership (user_id) on shared records.
-- Read/edit remains shared across staff (intentional hotel-team CRM model);
-- but no one can hijack a record by setting user_id to themselves or another user.
DROP POLICY IF EXISTS quotes_update_auth ON public.quotes;
CREATE POLICY quotes_update_auth ON public.quotes
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (user_id = (SELECT user_id FROM public.quotes q WHERE q.id = quotes.id));

DROP POLICY IF EXISTS customers_update_auth ON public.customers;
CREATE POLICY customers_update_auth ON public.customers
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (user_id = (SELECT user_id FROM public.customers c WHERE c.id = customers.id));

DROP POLICY IF EXISTS followups_update_auth ON public.followups;
CREATE POLICY followups_update_auth ON public.followups
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (user_id = (SELECT user_id FROM public.followups f WHERE f.id = followups.id));

DROP POLICY IF EXISTS tasks_update_auth ON public.tasks;
CREATE POLICY tasks_update_auth ON public.tasks
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (user_id = (SELECT user_id FROM public.tasks t WHERE t.id = tasks.id));

-- Restrict realtime channel subscriptions to authenticated users only
-- (intentional shared visibility within the hotel team).
ALTER TABLE IF EXISTS realtime.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authenticated_can_receive_broadcasts ON realtime.messages;
CREATE POLICY authenticated_can_receive_broadcasts ON realtime.messages
  FOR SELECT TO authenticated USING (true);
