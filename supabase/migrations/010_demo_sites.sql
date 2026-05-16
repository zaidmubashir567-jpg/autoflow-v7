-- ================================================================
-- AutoFlow v7 — Migration 010: Demo Sites + Google Sheets
-- Adds demo_url (Vercel-deployed demo website per lead) and
-- google_sheet_id/url (per-client Sheets export tracking).
-- ================================================================

ALTER TABLE leads ADD COLUMN IF NOT EXISTS demo_url          text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS demo_deployed_at  timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS sheet_row         integer;

ALTER TABLE clients ADD COLUMN IF NOT EXISTS google_sheet_id  text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS google_sheet_url text;

CREATE INDEX IF NOT EXISTS idx_leads_demo_url
  ON leads(client_id) WHERE demo_url IS NOT NULL;
