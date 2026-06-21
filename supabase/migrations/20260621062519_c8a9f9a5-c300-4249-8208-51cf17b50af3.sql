
-- ============================================
-- CRM Phase 1b: Outbound email queue + cron sweeps
-- ============================================

-- 1. Outbound email queue (records every CRM notification)
CREATE TABLE IF NOT EXISTS public.crm_outbound_emails (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  event         text NOT NULL,            -- 'lead_created' | 'lead_abandoned' | 'lead_converted' | 'lead_lost'
  recipients    jsonb NOT NULL DEFAULT '[]'::jsonb,
  subject       text NOT NULL,
  body_text     text NOT NULL,
  body_html     text,
  status        text NOT NULL DEFAULT 'queued',  -- 'queued' | 'sent' | 'failed' | 'skipped'
  error         text,
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.crm_outbound_emails TO authenticated;
GRANT ALL ON public.crm_outbound_emails TO service_role;

ALTER TABLE public.crm_outbound_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crm_emails_select" ON public.crm_outbound_emails;
CREATE POLICY "crm_emails_select" ON public.crm_outbound_emails FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "crm_emails_modify" ON public.crm_outbound_emails;
CREATE POLICY "crm_emails_modify" ON public.crm_outbound_emails FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS crm_emails_status_idx ON public.crm_outbound_emails(status, created_at DESC);
CREATE INDEX IF NOT EXISTS crm_emails_lead_idx   ON public.crm_outbound_emails(lead_id);

-- 2. Schedule sweeps via pg_cron (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$ BEGIN
  PERFORM cron.unschedule('crm-sweep-abandoned');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN
  PERFORM cron.unschedule('crm-sweep-lost');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'crm-sweep-abandoned',
  '*/5 * * * *',
  $$ SELECT public.sweep_abandoned_leads(); $$
);

SELECT cron.schedule(
  'crm-sweep-lost',
  '15 2 * * *',
  $$ SELECT public.sweep_lost_leads(); $$
);
