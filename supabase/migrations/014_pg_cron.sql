-- ================================================================
-- Migration 014 — pg_cron + pg_net: auto-trigger follow-up-engine
-- Runs follow-up-engine every 30 minutes automatically
-- ================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Grant cron schema access to postgres role
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- Remove existing job if already exists (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'follow-up-engine-trigger') THEN
    PERFORM cron.unschedule('follow-up-engine-trigger');
  END IF;
END $$;

-- Schedule follow-up-engine every 30 minutes
-- Uses pg_net to POST to the Supabase Edge Function
SELECT cron.schedule(
  'follow-up-engine-trigger',
  '*/30 * * * *',
  $$
  SELECT
    net.http_post(
      url     := 'https://ndwvsrtyjnaddrifafqk.supabase.co/functions/v1/follow-up-engine',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kd3ZzcnR5am5hZGRyaWZhZnFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4ODMxMDgsImV4cCI6MjA5MzQ1OTEwOH0.7XoOKB74DGiXac3cfSSiyvREuWZ7qbQ2QbxE6d1rnlM'
      ),
      body    := '{}'::jsonb
    ) AS request_id;
  $$
);

-- Verify the job was created
DO $$
DECLARE
  job_count int;
BEGIN
  SELECT COUNT(*) INTO job_count FROM cron.job WHERE jobname = 'follow-up-engine-trigger';
  IF job_count = 0 THEN
    RAISE EXCEPTION 'pg_cron job was not created — check if pg_cron extension is enabled on this plan';
  ELSE
    RAISE NOTICE 'pg_cron job follow-up-engine-trigger scheduled every 30 minutes ✓';
  END IF;
END $$;
