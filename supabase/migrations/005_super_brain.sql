-- ================================================================
-- AutoFlow v7 — Migration 005: Claude Super Brain
-- Adds: pipeline_chat table, agent_message column,
--       brave_search_key on clients, owner_name + social_links on leads
-- ================================================================

-- 1. pipeline_chat — real-time Claude ↔ user chat during pipeline runs
CREATE TABLE IF NOT EXISTS pipeline_chat (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id      uuid        REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  client_id   uuid        REFERENCES clients(id) ON DELETE CASCADE,
  role        text        NOT NULL CHECK (role IN ('claude','user','system')),
  message     text        NOT NULL,
  type        text        DEFAULT 'info' CHECK (type IN ('info','success','warning','insight','error')),
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE pipeline_chat ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_pipeline_chat_all" ON pipeline_chat
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid()));

-- Enable realtime on pipeline_chat
ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_chat;

-- 2. Add agent_message to pipeline_runs (Claude's live status line)
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS agent_message text;

-- 3. Brave Search API key per client (free 2000 searches/month)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS brave_search_key text;

-- 4. Extra lead fields the super brain will populate
ALTER TABLE leads ADD COLUMN IF NOT EXISTS owner_name   text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS social_links jsonb DEFAULT '{}';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS score_reason text;

-- 5. run_id on outreach_log (for easier joins in pipeline-manager)
ALTER TABLE outreach_log ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES pipeline_runs(id);
