-- ================================================================
-- AutoFlow v7 — Migration 008: Gmail token timestamp
-- Adds gmail_token_saved_at so the UI can show token freshness
-- and the follow-up engine can decide when to auto-refresh.
-- Run in: Supabase Dashboard → SQL Editor
-- ================================================================

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS gmail_token_saved_at timestamptz;

-- Backfill: any client with a gmail_access token gets 'now' as baseline
-- (so the UI shows "Connected" rather than no timestamp)
UPDATE clients
  SET gmail_token_saved_at = now()
  WHERE gmail_access IS NOT NULL
    AND gmail_token_saved_at IS NULL;
