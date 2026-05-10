-- ============================================================
-- AutoFlow v7 — Migration 002: Client Portal RLS
-- Clients get read-only access to their own data via portal login
-- Admin (service_role) bypasses all RLS via Edge Functions
-- ============================================================

-- Client portal users are stored in auth.users with metadata role='client'
-- They are linked to a specific client_id in clients.portal_user_id

ALTER TABLE clients ADD COLUMN IF NOT EXISTS portal_user_id uuid REFERENCES auth.users(id);

-- Portal users can read their own client row (for name, plan display)
CREATE POLICY "client_portal_read_own" ON clients
  FOR SELECT USING (auth.uid() = portal_user_id);

-- Portal: read own leads (RLS already limits by client_id)
-- The my_client_ids() helper also covers portal users IF we add them to clients
-- Instead, add a direct portal policy per table:

CREATE OR REPLACE FUNCTION portal_client_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM clients WHERE portal_user_id = auth.uid() LIMIT 1;
$$;

-- Leads: portal read-only
CREATE POLICY "portal_leads_read" ON leads
  FOR SELECT USING (client_id = portal_client_id());

-- Pipeline runs: portal read-only (so client can see live progress)
CREATE POLICY "portal_runs_read" ON pipeline_runs
  FOR SELECT USING (client_id = portal_client_id());

-- Run history: portal read-only (for analytics page)
CREATE POLICY "portal_history_read" ON run_history
  FOR SELECT USING (client_id = portal_client_id());

-- Proposals: portal read-only
CREATE POLICY "portal_proposals_read" ON proposals
  FOR SELECT USING (client_id = portal_client_id());

-- Websites: portal read-only
CREATE POLICY "portal_websites_read" ON websites
  FOR SELECT USING (client_id = portal_client_id());

-- Sequences: portal read-only (campaigns page)
CREATE POLICY "portal_sequences_read" ON sequences
  FOR SELECT USING (client_id = portal_client_id());

-- Outreach log: portal read-only (campaign activity)
CREATE POLICY "portal_outreach_read" ON outreach_log
  FOR SELECT USING (client_id = portal_client_id());

-- NOTE: Portal users CANNOT see:
--   - draft_responses (internal admin tool)
--   - manual_outreach_queue (internal admin tool)
--   - prompt_versions (internal AI config)
--   - error_library (internal system)
--   - Other clients' data (portal_client_id() returns NULL if not a portal user)
