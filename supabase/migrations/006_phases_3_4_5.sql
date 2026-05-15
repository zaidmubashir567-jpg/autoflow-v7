-- ================================================================
-- AutoFlow v7 — Migration 006: Phases 3, 4, 5
-- Phase 3: Follow-up scheduling columns
-- Phase 5: Niche memory table
-- ================================================================

-- Phase 3: Follow-up scheduling
ALTER TABLE outreach_log ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
ALTER TABLE outreach_log ADD COLUMN IF NOT EXISTS follow_up_seq integer DEFAULT 0;
-- follow_up_seq: 0=initial, 1=day-3, 2=day-7, 3=day-14

-- Phase 5: Niche memory — Claude learns what works per niche+city
CREATE TABLE IF NOT EXISTS niche_memory (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id    uuid REFERENCES clients(id) ON DELETE CASCADE,
  niche        text NOT NULL,
  city         text NOT NULL,
  state        text,
  insights     jsonb DEFAULT '{}',
  pain_signals text[],
  best_queries text[],
  avg_score    numeric DEFAULT 0,
  runs_count   integer DEFAULT 1,
  last_run_id  uuid REFERENCES pipeline_runs(id),
  notes        text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

ALTER TABLE niche_memory ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='niche_memory' AND policyname='niche_memory_auth'
  ) THEN
    CREATE POLICY "niche_memory_auth" ON niche_memory
      FOR ALL TO authenticated USING (true);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS niche_memory_client_niche_city
  ON niche_memory(client_id, lower(niche), lower(city));

-- Add to realtime
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE niche_memory;
EXCEPTION WHEN others THEN NULL;
END $$;
