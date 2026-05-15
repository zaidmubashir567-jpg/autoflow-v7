-- ================================================================
-- AutoFlow v7 — Migration 007: Follow-up status column
-- Adds status tracking to outreach_log so the follow-up engine
-- can query scheduled vs sent vs draft entries reliably.
-- Run in: Supabase Dashboard → SQL Editor
-- ================================================================

-- Add status column (draft | scheduled | sent | failed | approved | rejected)
ALTER TABLE outreach_log ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft';

-- Add run_id so we can link follow-ups back to their originating pipeline run
ALTER TABLE outreach_log ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES pipeline_runs(id) ON DELETE SET NULL;

-- Index for the follow-up engine's core query: status + scheduled_at
CREATE INDEX IF NOT EXISTS idx_outreach_status_scheduled
  ON outreach_log(client_id, status, scheduled_at)
  WHERE status = 'scheduled';

-- Backfill: any existing rows with scheduled_at set should be 'scheduled'
UPDATE outreach_log
  SET status = 'scheduled'
  WHERE scheduled_at IS NOT NULL
    AND scheduled_at > now()
    AND status = 'draft';

-- Update cron schedule from daily to hourly for follow-up engine
-- (removes old daily job, adds new hourly one)
SELECT cron.unschedule('follow-up-engine-daily');

SELECT cron.schedule(
  'follow-up-engine-hourly',
  '0 * * * *',   -- top of every hour
  $$
  SELECT net.http_post(
    url := 'https://ndwvsrtyjnaddrifafqk.supabase.co/functions/v1/follow-up-engine',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
