-- ================================================================
-- AutoFlow v7 — Migration 009: White-label Agency Mode
-- Creates agencies table; links clients to agencies;
-- adds per-agency branding fields.
-- Run in: Supabase Dashboard → SQL Editor
-- ================================================================

-- ── 1. Agencies table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agencies (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_user_id   uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  slug            text NOT NULL UNIQUE,         -- URL slug: /agency/acmeleads
  logo_url        text,
  primary_color   text DEFAULT '#6366F1',       -- hex brand colour
  accent_color    text DEFAULT '#818CF8',
  tagline         text,
  support_email   text,
  custom_domain   text,                         -- future: app.acmeleads.com
  plan            text DEFAULT 'starter',       -- starter | growth | enterprise
  max_clients     integer DEFAULT 10,
  active          boolean DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE agencies ENABLE ROW LEVEL SECURITY;

-- Agency owner can read/update their own agency
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='agencies' AND policyname='agencies_owner'
  ) THEN
    CREATE POLICY "agencies_owner" ON agencies
      FOR ALL TO authenticated
      USING (owner_user_id = auth.uid());
  END IF;
END $$;

-- ── 2. Link clients to agencies ───────────────────────────────
ALTER TABLE clients ADD COLUMN IF NOT EXISTS agency_id uuid REFERENCES agencies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clients_agency_id ON clients(agency_id);

-- ── 3. Agency-branded client label ───────────────────────────
-- Clients can have a custom label shown in the white-labelled UI
ALTER TABLE clients ADD COLUMN IF NOT EXISTS brand_name text;     -- overrides "AutoFlow" in client UI
ALTER TABLE clients ADD COLUMN IF NOT EXISTS brand_logo  text;    -- overrides logo in client UI

-- ── 4. RLS: agency owner can see all their clients ────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='clients' AND policyname='clients_agency_owner'
  ) THEN
    CREATE POLICY "clients_agency_owner" ON clients
      FOR ALL TO authenticated
      USING (
        agency_id IN (
          SELECT id FROM agencies WHERE owner_user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- ── 5. Add to realtime ────────────────────────────────────────
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE agencies;
EXCEPTION WHEN others THEN NULL;
END $$;
