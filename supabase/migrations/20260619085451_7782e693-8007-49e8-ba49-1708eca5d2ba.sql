
-- 1. Add 'reception' to app_role enum (idempotent)
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'reception';
