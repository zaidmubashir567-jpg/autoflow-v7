-- ============================================================
-- Migration 011 — AI Chatbot Receptionist tables
-- ============================================================

-- chatbot_widgets: one per client/lead they deploy for
create table if not exists chatbot_widgets (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid references clients(id) on delete cascade,
  lead_id             uuid references leads(id) on delete set null,
  business_name       text not null,
  niche               text,
  city                text,
  services            text[],
  business_hours      text default 'Monday–Friday 9am–5pm',
  faq                 text,
  brand_color         text default '#6366f1',
  alert_email         text,
  claude_key_override text,
  active              boolean default true,
  deployed_at         timestamptz,
  created_at          timestamptz default now()
);

create table if not exists chatbot_logs (
  id              uuid primary key default gen_random_uuid(),
  widget_id       uuid references chatbot_widgets(id) on delete cascade,
  client_id       uuid references clients(id) on delete cascade,
  visitor_message text,
  ai_reply        text,
  visitor_name    text,
  visitor_phone   text,
  captured        boolean default false,
  created_at      timestamptz default now()
);

alter table leads add column if not exists chatbot_config   jsonb;
alter table leads add column if not exists chatbot_widget_id uuid references chatbot_widgets(id);

alter table chatbot_widgets enable row level security;
alter table chatbot_logs    enable row level security;

create policy "client_own_widgets" on chatbot_widgets using (client_id = auth.uid() or exists (select 1 from clients where id = client_id and user_id = auth.uid()));
create policy "client_own_logs" on chatbot_logs using (client_id = auth.uid() or exists (select 1 from clients where id = client_id and user_id = auth.uid()));
create policy "public_widget_read" on chatbot_widgets for select using (active = true);
create policy "public_log_insert" on chatbot_logs for insert with check (true);

create index if not exists idx_chatbot_logs_widget on chatbot_logs(widget_id, created_at desc);
create index if not exists idx_chatbot_logs_captured on chatbot_logs(client_id, captured, created_at desc);
create index if not exists idx_chatbot_widgets_client on chatbot_widgets(client_id);
