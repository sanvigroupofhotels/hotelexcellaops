
ALTER TABLE public.quotes REPLICA IDENTITY FULL;
ALTER TABLE public.followups REPLICA IDENTITY FULL;
ALTER TABLE public.quote_activities REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.quotes;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.followups;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.quote_activities;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
