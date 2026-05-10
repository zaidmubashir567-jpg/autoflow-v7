-- ============================================================
-- AutoFlow v7 — Supabase Cron Jobs
-- Run in Supabase SQL Editor after enabling pg_cron extension
-- Dashboard → Extensions → pg_cron → Enable
-- Also enable pg_net for HTTP calls from cron
-- ============================================================

-- Enable required extensions
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── Helper: call an Edge Function ────────────────────────────
-- Cron calls the REST API directly using pg_net.http_post
-- Replace <SERVICE_ROLE_KEY> with your Supabase service_role key
-- Replace <PROJECT_REF> with ndwvsrtyjnaddrifafqk

-- ── 1. Follow-up engine — runs daily at 10:00 AM UTC ─────────
select cron.schedule(
  'follow-up-engine-daily',
  '0 10 * * *',   -- 10:00 AM UTC every day
  $$
  select net.http_post(
    url := 'https://ndwvsrtyjnaddrifafqk.supabase.co/functions/v1/follow-up-engine',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ── 2. Reply classifier — runs every 30 minutes ──────────────
select cron.schedule(
  'reply-classifier-30min',
  '*/30 * * * *',   -- every 30 minutes
  $$
  select net.http_post(
    url := 'https://ndwvsrtyjnaddrifafqk.supabase.co/functions/v1/reply-classifier',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ── 3. Learn engine — runs every 6 hours ─────────────────────
select cron.schedule(
  'learn-engine-6h',
  '0 */6 * * *',   -- every 6 hours
  $$
  select net.http_post(
    url := 'https://ndwvsrtyjnaddrifafqk.supabase.co/functions/v1/learn',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := '{"trigger":"scheduled"}'::jsonb
  );
  $$
);

-- ── 4. Daily send cap reset (safety log) ─────────────────────
-- Inserts a daily marker into run_history so we have an audit trail
select cron.schedule(
  'daily-cap-reset-log',
  '0 0 * * *',   -- midnight UTC
  $$
  insert into run_history (event_type, payload, created_at)
  values ('daily_reset', '{"event":"cap_reset"}', now());
  $$
);

-- ── Set service_role_key as a DB setting ──────────────────────
-- Run this once in SQL editor (replace with your actual key):
-- alter database postgres set app.service_role_key = 'your-service-role-key-here';

-- ── View scheduled jobs ───────────────────────────────────────
-- select * from cron.job;

-- ── To disable a job ─────────────────────────────────────────
-- select cron.unschedule('follow-up-engine-daily');

-- ── To check job run history ──────────────────────────────────
-- select * from cron.job_run_details order by start_time desc limit 20;
