-- ============================================================
-- Migration 012 — Call Booking System + Daily Pipeline Cron
-- ============================================================

create table if not exists availability_slots (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid references clients(id) on delete cascade,
  day_of_week  int not null check (day_of_week between 0 and 6),
  start_time   time not null,
  end_time     time not null,
  timezone     text default 'America/Chicago',
  duration_min int default 30,
  active       boolean default true,
  created_at   timestamptz default now()
);

create table if not exists meetings (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid references clients(id) on delete cascade,
  lead_id           uuid references leads(id) on delete set null,
  booking_token     uuid unique default gen_random_uuid(),
  visitor_name      text,
  visitor_email     text,
  visitor_phone     text,
  company_name      text,
  booked_at         timestamptz,
  duration_min      int default 30,
  timezone          text default 'America/Chicago',
  status            text default 'pending' check (status in ('pending','confirmed','cancelled','completed','no_show')),
  reminder_sent     boolean default false,
  meeting_link      text,
  notes             text,
  cancel_reason     text,
  created_at        timestamptz default now()
);

alter table availability_slots enable row level security;
alter table meetings           enable row level security;

create policy "client_own_slots" on availability_slots using (client_id = auth.uid() or exists (select 1 from clients where id = client_id and user_id = auth.uid()));
create policy "client_own_meetings" on meetings using (client_id = auth.uid() or exists (select 1 from clients where id = client_id and user_id = auth.uid()));
create policy "public_meeting_read" on meetings for select using (true);
create policy "public_meeting_insert" on meetings for insert with check (true);
create policy "public_meeting_update" on meetings for update using (true);

create index if not exists idx_meetings_token on meetings(booking_token);
create index if not exists idx_meetings_client on meetings(client_id, status, booked_at);
create index if not exists idx_meetings_lead on meetings(lead_id);
create index if not exists idx_slots_client_day on availability_slots(client_id, day_of_week);

insert into chatbot_widgets (id, business_name, niche, city, services, business_hours, faq, brand_color, alert_email, active) values ('00000000-0000-0000-0000-000000000001', 'LeadFyn AI', 'AI Lead Generation', 'Your City', ARRAY['AI-powered lead finding','Cold email outreach','Demo website builds','AI Receptionist installs'], 'Always available — this is an AI', E'Q: What is LeadFyn?\nA: LeadFyn is an AI system.\nQ: How much does it cost?\nA: Websites start at $800/mo. AI Receptionist is $497 one-time + $97/mo.', '#0071e3', 'uswahadeel85@gmail.com', true) on conflict (id) do nothing;
