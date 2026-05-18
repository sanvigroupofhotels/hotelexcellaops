
-- Enums
CREATE TYPE quote_status AS ENUM ('Pending','Sent','Negotiating','Converted','No Response','Failed');
CREATE TYPE activity_type AS ENUM ('created','edited','status_changed','whatsapp_sent','pdf_generated','followup_added','followup_completed','converted','note_added','deleted','duplicated');

-- profiles
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_all_auth" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- quotes
CREATE TABLE public.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_code text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_name text NOT NULL,
  phone text NOT NULL,
  email text,
  lead_source text DEFAULT 'Direct',
  group_size text DEFAULT '2 Adults',
  special_requests text,
  check_in date NOT NULL,
  check_out date NOT NULL,
  room_type text NOT NULL,
  room_rate numeric NOT NULL DEFAULT 0,
  rooms integer NOT NULL DEFAULT 1,
  extra_bed integer NOT NULL DEFAULT 0,
  early_check_in boolean NOT NULL DEFAULT false,
  late_check_out boolean NOT NULL DEFAULT false,
  pet_charges boolean NOT NULL DEFAULT false,
  discount numeric NOT NULL DEFAULT 0,
  internal_notes text,
  status quote_status NOT NULL DEFAULT 'Pending',
  nights integer NOT NULL DEFAULT 1,
  subtotal numeric NOT NULL DEFAULT 0,
  taxes numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_quotes_user ON public.quotes(user_id);
CREATE INDEX idx_quotes_status ON public.quotes(status);
CREATE INDEX idx_quotes_created ON public.quotes(created_at DESC);
CREATE INDEX idx_quotes_checkin ON public.quotes(check_in);

ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quotes_select_auth" ON public.quotes FOR SELECT TO authenticated USING (true);
CREATE POLICY "quotes_insert_own" ON public.quotes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "quotes_update_own" ON public.quotes FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "quotes_delete_own" ON public.quotes FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- activities
CREATE TABLE public.quote_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  type activity_type NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_activities_quote ON public.quote_activities(quote_id, created_at DESC);
ALTER TABLE public.quote_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "activities_select_auth" ON public.quote_activities FOR SELECT TO authenticated USING (true);
CREATE POLICY "activities_insert_auth" ON public.quote_activities FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- followups
CREATE TABLE public.followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  due_at timestamptz NOT NULL,
  note text,
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_followups_due ON public.followups(due_at);
CREATE INDEX idx_followups_quote ON public.followups(quote_id);
ALTER TABLE public.followups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "followups_select_auth" ON public.followups FOR SELECT TO authenticated USING (true);
CREATE POLICY "followups_insert_own" ON public.followups FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "followups_update_own" ON public.followups FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "followups_delete_own" ON public.followups FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER quotes_set_updated_at BEFORE UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- profile auto-create on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)));
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
