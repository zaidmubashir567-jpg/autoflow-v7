-- ============================================================
-- AutoFlow v7 — Initial Schema Migration
-- Project: ndwvsrtyjnaddrifafqk
-- Tables: 14 | RLS: enabled on all | Twin patterns: applied
-- ============================================================

-- ─────────────────────────────────────────
-- EXTENSIONS
-- ─────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────
CREATE TYPE email_confidence_level AS ENUM ('high', 'medium', 'low');
CREATE TYPE email_source_type      AS ENUM ('hunter', 'apollo', 'linkedin', 'scraped', 'manual');
CREATE TYPE variation_type         AS ENUM ('A', 'B', 'C');
CREATE TYPE pipeline_status        AS ENUM ('idle', 'running', 'completed', 'completed_empty', 'error', 'paused_approval');
CREATE TYPE pipeline_stage         AS ENUM (
  'new', 'contacted', 'replied', 'interested',
  'discovery_call', 'proposal_sent', 'negotiation', 'won', 'lost'
);
CREATE TYPE reply_classification   AS ENUM (
  'INTERESTED', 'QUESTION', 'OBJECTION',
  'NOT_INTERESTED', 'OUT_OF_OFFICE', 'UNSUBSCRIBE'
);
CREATE TYPE draft_status           AS ENUM ('pending', 'sent', 'rejected');
CREATE TYPE channel_type           AS ENUM (
  'email', 'whatsapp', 'sms', 'phone',
  'facebook', 'instagram', 'yelp', 'linkedin',
  'contact_form', 'direct_mail'
);

-- ─────────────────────────────────────────
-- TABLE 1: clients
-- The top-level tenant. Every other table scopes to client_id.
-- ─────────────────────────────────────────
CREATE TABLE clients (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name              text NOT NULL,
  email             text,
  plan              text NOT NULL DEFAULT 'entry',  -- entry | growth | agency
  -- Per-client AI keys (encrypted at rest by Supabase)
  gemini_key        text,
  claude_key        text,
  openai_key        text,
  ai_model          text NOT NULL DEFAULT 'gemini-1.5-flash',
  -- Google OAuth (refreshed server-side every 50 min)
  google_client_id  text,
  google_oauth_token text,
  google_refresh_token text,
  gmail_access      text,
  gmail_refresh     text,
  gmail_client_id   text,
  gmail_client_secret text,
  sheets_id         text,
  -- External API keys
  places_key        text,
  vercel_token      text,
  hunter_key        text,
  apollo_key        text,
  -- Settings
  daily_email_cap   int NOT NULL DEFAULT 20,        -- Twin pattern: hard cap
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────
-- TABLE 2: leads
-- ─────────────────────────────────────────
CREATE TABLE leads (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id         uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- From Google Places
  place_id          text NOT NULL,                  -- Twin: INSERT OR IGNORE dedup key
  business_name     text NOT NULL,
  address           text,
  city              text,
  state             text,
  niche             text,
  niche_normalized  text,                           -- Twin: group sub-categories for analytics
  phone             text,
  website           text,
  google_rating     numeric(3,1),
  review_count      int DEFAULT 0,
  -- Scoring
  score             int CHECK (score BETWEEN 1 AND 10),
  qualify           boolean NOT NULL DEFAULT false,
  score_reason      text,
  -- Contact info
  email             text,
  email_confidence  email_confidence_level,
  email_source      email_source_type,
  do_not_contact    boolean NOT NULL DEFAULT false, -- Twin: respected at RLS level
  -- Pipeline stage
  stage             pipeline_stage NOT NULL DEFAULT 'new',
  -- Meta
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, place_id)                      -- Twin: deduplication
);

-- ─────────────────────────────────────────
-- TABLE 3: contact_channels
-- All found contact methods per lead beyond email
-- ─────────────────────────────────────────
CREATE TABLE contact_channels (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  lead_id         uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  channel         channel_type NOT NULL,
  value           text,                             -- URL, phone, handle, address
  verified        boolean NOT NULL DEFAULT false,
  found_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, channel)
);

-- ─────────────────────────────────────────
-- TABLE 4: outreach_log
-- Every outreach send across all 10 channels
-- ─────────────────────────────────────────
CREATE TABLE outreach_log (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  lead_id         uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  channel         channel_type NOT NULL,
  variation       variation_type,                   -- A/B/C email copy variant
  subject         text,
  body            text,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  -- Follow-up tracking (Twin: Day 0/3/7/14 sequence)
  sequence_day    int NOT NULL DEFAULT 0,           -- 0, 3, 7, 14
  thread_id       text,                             -- Gmail thread ID for Re: replies
  -- Status
  delivered       boolean,
  opened          boolean DEFAULT false,
  clicked         boolean DEFAULT false,
  replied         boolean DEFAULT false,
  bounced         boolean DEFAULT false,
  -- Meta
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────
-- TABLE 5: email_stats
-- Aggregated Gmail open/click/reply stats (updated hourly)
-- ─────────────────────────────────────────
CREATE TABLE email_stats (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  lead_id         uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  outreach_id     uuid REFERENCES outreach_log(id),
  opens           int NOT NULL DEFAULT 0,
  clicks          int NOT NULL DEFAULT 0,
  last_opened_at  timestamptz,
  last_clicked_at timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────
-- TABLE 6: draft_responses
-- AI-generated reply drafts awaiting human approval (Twin: never auto-send)
-- ─────────────────────────────────────────
CREATE TABLE draft_responses (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id         uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  lead_id           uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  outreach_id       uuid REFERENCES outreach_log(id),
  -- The inbound reply
  reply_text        text NOT NULL,
  reply_received_at timestamptz NOT NULL DEFAULT now(),
  -- Classification (Twin: 6 categories)
  classification    reply_classification NOT NULL,
  -- AI draft
  draft_text        text NOT NULL,
  status            draft_status NOT NULL DEFAULT 'pending',
  sent_at           timestamptz,
  rejected_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────
-- TABLE 7: manual_outreach_queue
-- Leads with no email — queued for social DM (Human Touchpoint #3)
-- ─────────────────────────────────────────
CREATE TABLE manual_outreach_queue (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  lead_id         uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  channels_json   jsonb NOT NULL DEFAULT '{}',      -- {facebook: url, instagram: url, ...}
  dm_script       text NOT NULL,                    -- Pre-written DM (James-generated)
  status          text NOT NULL DEFAULT 'pending',  -- pending | sent | skipped
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────
-- TABLE 8: websites
-- Sofia-generated website redesign concepts
-- ─────────────────────────────────────────
CREATE TABLE websites (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  lead_id         uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  html_content    text,
  vercel_url      text,
  deploy_status   text NOT NULL DEFAULT 'pending',  -- pending | deployed | failed
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────
-- TABLE 9: proposals
-- Oliver-generated proposals
-- ─────────────────────────────────────────
CREATE TABLE proposals (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  lead_id         uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  content         text NOT NULL,
  price           numeric(10,2),
  status          text NOT NULL DEFAULT 'draft',    -- draft | sent | accepted | rejected
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────
-- TABLE 10: sequences
-- Email sequence templates (Day 0/3/7/14)
-- ─────────────────────────────────────────
CREATE TABLE sequences (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  niche           text,
  variation       variation_type NOT NULL DEFAULT 'A',
  day             int NOT NULL,                     -- 0, 3, 7, 14
  subject         text NOT NULL,
  body            text NOT NULL,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────
-- TABLE 11: pipeline_runs
-- Each execution of the 13-node pipeline
-- ─────────────────────────────────────────
CREATE TABLE pipeline_runs (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  city            text NOT NULL,
  state           text NOT NULL,
  niche           text NOT NULL,
  status          pipeline_status NOT NULL DEFAULT 'idle',
  current_node    text,                             -- e.g. 'Marcus', 'Filter', 'Elena'
  leads_found     int DEFAULT 0,
  leads_qualified int DEFAULT 0,
  emails_found    int DEFAULT 0,
  channels_found  int DEFAULT 0,
  emails_sent     int DEFAULT 0,
  error_message   text,
  -- Auto mode (Opportunity Scout)
  auto_mode       boolean NOT NULL DEFAULT false,
  scout_city      text,
  scout_niche     text,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────
-- TABLE 12: run_history
-- Aggregated run results for Theo's analytics + period-over-period (Twin)
-- ─────────────────────────────────────────
CREATE TABLE run_history (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  run_id          uuid REFERENCES pipeline_runs(id),
  city            text,
  state           text,
  niche           text,
  niche_normalized text,
  leads_found     int DEFAULT 0,
  leads_qualified int DEFAULT 0,
  contact_rate    numeric(5,2),                     -- % of qualified leads reached
  reply_rate      numeric(5,2),
  best_variation  variation_type,                   -- which A/B/C won this run
  grade           text,                             -- Theo's A/B/C/D grade
  week_number     int,                              -- for period-over-period comparisons
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────
-- TABLE 13: prompt_versions
-- Self-learning loop — tracks prompt iterations per node (brain/learner.js)
-- ─────────────────────────────────────────
CREATE TABLE prompt_versions (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  node_name       text NOT NULL,                    -- 'James', 'Leo', 'Victor', etc.
  version         int NOT NULL DEFAULT 1,
  system_prompt   text NOT NULL,
  user_prompt     text NOT NULL,
  reply_rate      numeric(5,2),                     -- measured performance
  runs_tested     int DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  replaced_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────
-- TABLE 14: error_library
-- Raj's error memory — known errors + proven fixes (brain/solver.js)
-- ─────────────────────────────────────────
CREATE TABLE error_library (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  error_signature text NOT NULL UNIQUE,             -- hash/fingerprint of error
  error_message   text NOT NULL,
  node_name       text,
  fix_applied     text NOT NULL,
  fix_success     boolean NOT NULL DEFAULT true,
  times_applied   int NOT NULL DEFAULT 1,
  -- Pre-seeded with Twin's known issues
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_applied_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────
-- INDEXES (sub-20ms query targets)
-- ─────────────────────────────────────────
-- leads
CREATE INDEX idx_leads_client_id      ON leads(client_id);
CREATE INDEX idx_leads_stage          ON leads(client_id, stage);
CREATE INDEX idx_leads_score          ON leads(client_id, score DESC);
CREATE INDEX idx_leads_do_not_contact ON leads(client_id, do_not_contact);
CREATE INDEX idx_leads_place_id       ON leads(client_id, place_id);

-- outreach_log
CREATE INDEX idx_outreach_client_id   ON outreach_log(client_id);
CREATE INDEX idx_outreach_lead_id     ON outreach_log(lead_id);
CREATE INDEX idx_outreach_sent_at     ON outreach_log(client_id, sent_at DESC);
CREATE INDEX idx_outreach_seq_day     ON outreach_log(client_id, sequence_day, sent_at);

-- draft_responses
CREATE INDEX idx_drafts_client_status ON draft_responses(client_id, status);
CREATE INDEX idx_drafts_lead_id       ON draft_responses(lead_id);

-- manual_outreach_queue
CREATE INDEX idx_moq_client_status    ON manual_outreach_queue(client_id, status);

-- pipeline_runs
CREATE INDEX idx_runs_client_status   ON pipeline_runs(client_id, status);
CREATE INDEX idx_runs_created         ON pipeline_runs(client_id, created_at DESC);

-- prompt_versions
CREATE INDEX idx_prompts_client_node  ON prompt_versions(client_id, node_name, is_active);

-- contact_channels
CREATE INDEX idx_channels_lead_id     ON contact_channels(lead_id);
CREATE INDEX idx_channels_client      ON contact_channels(client_id, channel);

-- ─────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────
ALTER TABLE clients             ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads               ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_channels    ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_stats         ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_responses     ENABLE ROW LEVEL SECURITY;
ALTER TABLE manual_outreach_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE websites            ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposals           ENABLE ROW LEVEL SECURITY;
ALTER TABLE sequences           ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_runs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_history         ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_versions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_library       ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────
-- RLS POLICIES
-- ─────────────────────────────────────────

-- clients: user sees only their own client row
CREATE POLICY "clients_owner" ON clients
  FOR ALL USING (auth.uid() = user_id);

-- Helper: returns the set of client_ids belonging to the current user
-- Used by all child table policies
CREATE OR REPLACE FUNCTION my_client_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM clients WHERE user_id = auth.uid();
$$;

-- leads
CREATE POLICY "leads_owner" ON leads
  FOR ALL USING (client_id IN (SELECT my_client_ids()));

-- CRITICAL: Block any outreach_log INSERT if lead is do_not_contact = true (Twin pattern)
CREATE POLICY "leads_no_dnc_outreach" ON outreach_log
  FOR INSERT WITH CHECK (
    (SELECT do_not_contact FROM leads WHERE id = lead_id) = false
    AND client_id IN (SELECT my_client_ids())
  );

CREATE POLICY "outreach_log_owner" ON outreach_log
  FOR SELECT USING (client_id IN (SELECT my_client_ids()));

CREATE POLICY "outreach_log_update" ON outreach_log
  FOR UPDATE USING (client_id IN (SELECT my_client_ids()));

-- contact_channels
CREATE POLICY "contact_channels_owner" ON contact_channels
  FOR ALL USING (client_id IN (SELECT my_client_ids()));

-- email_stats
CREATE POLICY "email_stats_owner" ON email_stats
  FOR ALL USING (client_id IN (SELECT my_client_ids()));

-- draft_responses
CREATE POLICY "draft_responses_owner" ON draft_responses
  FOR ALL USING (client_id IN (SELECT my_client_ids()));

-- manual_outreach_queue
CREATE POLICY "moq_owner" ON manual_outreach_queue
  FOR ALL USING (client_id IN (SELECT my_client_ids()));

-- websites
CREATE POLICY "websites_owner" ON websites
  FOR ALL USING (client_id IN (SELECT my_client_ids()));

-- proposals
CREATE POLICY "proposals_owner" ON proposals
  FOR ALL USING (client_id IN (SELECT my_client_ids()));

-- sequences
CREATE POLICY "sequences_owner" ON sequences
  FOR ALL USING (client_id IN (SELECT my_client_ids()));

-- pipeline_runs (Realtime subscription uses anon key — policy must allow SELECT)
CREATE POLICY "pipeline_runs_owner" ON pipeline_runs
  FOR ALL USING (client_id IN (SELECT my_client_ids()));

-- run_history
CREATE POLICY "run_history_owner" ON run_history
  FOR ALL USING (client_id IN (SELECT my_client_ids()));

-- prompt_versions
CREATE POLICY "prompt_versions_owner" ON prompt_versions
  FOR ALL USING (client_id IN (SELECT my_client_ids()));

-- error_library: all authenticated users can read (shared knowledge base)
-- only service_role can insert/update (Edge Functions only)
CREATE POLICY "error_library_read" ON error_library
  FOR SELECT USING (auth.role() = 'authenticated');

-- ─────────────────────────────────────────
-- UPDATED_AT TRIGGER
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER clients_updated_at  BEFORE UPDATE ON clients  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER leads_updated_at    BEFORE UPDATE ON leads    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────
-- SEED: error_library (Twin's known issues)
-- ─────────────────────────────────────────
INSERT INTO error_library (error_signature, error_message, node_name, fix_applied, notes) VALUES
  ('places_quota_exceeded',     'Google Places API quota exceeded',         'Marcus',  'Retry after 60s with exponential backoff', 'Common on heavy run days'),
  ('gmail_oauth_expired',       'Gmail OAuth token expired or revoked',      'Elena',   'Trigger token refresh via /api/auth/refresh', 'Tokens expire after 60 min'),
  ('vercel_deploy_timeout',     'Vercel deployment timed out after 30s',     'Deploy',  'Retry deploy with smaller HTML payload', 'Sofia HTML sometimes exceeds limit'),
  ('hunter_rate_limit',         'Hunter.io rate limit: 429 Too Many Requests', 'Email Hunter', 'Queue remaining leads, retry after 60s', 'Free tier: 25 req/month'),
  ('apollo_no_match',           'Apollo.io: no person match found',          'Email Hunter', 'Mark email_confidence=low, route to detect-channels', 'Normal for sole proprietors'),
  ('places_zero_results',       'Google Places returned 0 results',          'Marcus',  'Return completed_empty status, suggest different niche/city', 'Common in rural areas')
ON CONFLICT (error_signature) DO NOTHING;

-- ─────────────────────────────────────────
-- REALTIME: enable for pipeline_runs
-- (Supabase dashboard: enable Realtime on this table)
-- ─────────────────────────────────────────
-- Run in Supabase dashboard after migration:
-- ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_runs;
-- ALTER PUBLICATION supabase_realtime ADD TABLE draft_responses;
