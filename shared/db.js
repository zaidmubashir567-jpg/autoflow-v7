// ============================================================
// LeadFyn — shared/db.js
// All Supabase database queries in one place.
// Every Edge Function and page goes through here — no raw queries outside this file.
// ============================================================

import { supabase } from './auth.js';

// ─── CLIENTS ────────────────────────────────────────────────

export async function getClient(clientId) {
  const { data, error } = await supabase
    .from('clients').select('*').eq('id', clientId).single();
  if (error) throw error;
  return data;
}

export async function updateClient(clientId, updates) {
  const { error } = await supabase
    .from('clients').update(updates).eq('id', clientId);
  if (error) throw error;
}

export async function getAllClients() {
  const { data, error } = await supabase
    .from('clients').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ─── LEADS ──────────────────────────────────────────────────

export async function getLeads(clientId, opts = {}) {
  let q = supabase.from('leads').select('*').eq('client_id', clientId);
  if (opts.stage)     q = q.eq('stage', opts.stage);
  if (opts.qualified) q = q.eq('qualify', true);
  if (opts.minScore)  q = q.gte('score', opts.minScore);
  if (opts.search)    q = q.ilike('business_name', `%${opts.search}%`);
  q = q.order('score', { ascending: false }).order('created_at', { ascending: false });
  if (opts.limit)  q = q.limit(opts.limit);
  if (opts.offset) q = q.range(opts.offset, opts.offset + (opts.limit ?? 50) - 1);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// Twin pattern: INSERT OR IGNORE via UNIQUE(client_id, place_id) constraint
export async function upsertLeads(leadsArray) {
  const { data, error } = await supabase
    .from('leads')
    .upsert(leadsArray, { onConflict: 'client_id,place_id', ignoreDuplicates: true })
    .select();
  if (error) throw error;
  return data ?? [];
}

export async function updateLead(leadId, updates) {
  const { error } = await supabase
    .from('leads').update(updates).eq('id', leadId);
  if (error) throw error;
}

export async function setDoNotContact(leadId) {
  const { error } = await supabase
    .from('leads').update({ do_not_contact: true }).eq('id', leadId);
  if (error) throw error;
}

export async function getLeadWithChannels(leadId) {
  const { data, error } = await supabase
    .from('leads')
    .select('*, contact_channels(*)')
    .eq('id', leadId)
    .single();
  if (error) throw error;
  return data;
}

// ─── CONTACT CHANNELS ───────────────────────────────────────

export async function upsertChannels(channelsArray) {
  const { error } = await supabase
    .from('contact_channels')
    .upsert(channelsArray, { onConflict: 'lead_id,channel' });
  if (error) throw error;
}

export async function getChannels(leadId) {
  const { data, error } = await supabase
    .from('contact_channels').select('*').eq('lead_id', leadId);
  if (error) throw error;
  return data ?? [];
}

// ─── OUTREACH LOG ────────────────────────────────────────────

export async function logOutreach(entry) {
  /* __ATTOLEADS_SIG_PATCH__ appended signature to every generated draft */
  try{ if(entry && entry.body && entry.channel!=='sms' && !/attoleads\.com/i.test(entry.body)){
    var __isHtml=/<\s*(p|div|br|html)[\s>]/i.test(entry.body);
    var __sigH='<br><br><p style="color:#666;font-size:13px">--<br>Zaid Mubashir<br>AttoLeads \u2014 websites, SEO &amp; AI chatbots for local businesses<br><a href="https://attoleads.com">attoleads.com</a> | sales@attoleads.com<br>30 N Gould St, Sheridan, WY 82801<br><br>If you\u2019d rather not hear from me, just reply \u201Cunsubscribe\u201D and I won\u2019t email you again.</p>';
    var __sigT='\n\n--\nZaid Mubashir\nAttoLeads \u2014 websites, SEO & AI chatbots for local businesses\nhttps://attoleads.com | sales@attoleads.com\n30 N Gould St, Sheridan, WY 82801\n\nIf you\u2019d rather not hear from me, just reply \u201Cunsubscribe\u201D and I won\u2019t email you again.';
    entry.body += (__isHtml?__sigH:__sigT);
  } }catch(__e){}
  const { data, error } = await supabase
    .from('outreach_log').insert(entry).select().single();
  if (error) throw error;  // RLS will block if do_not_contact = true
  return data;
}

// Twin: count today's sends for this client (hard cap check)
// Filter by status='sent' — sent_at has DEFAULT now() so every row has it set at insert time
export async function getTodaySendCount(clientId) {
  const today = new Date(); today.setUTCHours(0,0,0,0);
  const { count, error } = await supabase
    .from('outreach_log')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('status', 'sent')
    .gte('sent_at', today.toISOString());
  if (error) throw error;
  return count ?? 0;
}

// Twin: priority follow-up queue — FU3 → FU2 → FU1 → new
export async function getFollowUpQueue(clientId) {
  const cutoffs = { 3: 3, 7: 7, 14: 14 };
  const now = new Date();
  const results = [];

  for (const [day, daysAgo] of Object.entries(cutoffs).reverse()) {
    const since = new Date(now - daysAgo * 86400000).toISOString();
    const { data } = await supabase
      .from('outreach_log')
      .select('lead_id, thread_id, variation, client_id')
      .eq('client_id', clientId)
      .eq('sequence_day', 0)
      .lte('sent_at', since)
      .eq('replied', false);
    if (data) results.push(...data.map(r => ({ ...r, next_day: parseInt(day) })));
  }

  return results;
}

export async function updateOutreachStats(outreachId, stats) {
  const { error } = await supabase
    .from('outreach_log').update(stats).eq('id', outreachId);
  if (error) throw error;
}

// ─── DRAFT RESPONSES ────────────────────────────────────────

export async function createDraft(draft) {
  const { data, error } = await supabase
    .from('draft_responses').insert(draft).select().single();
  if (error) throw error;
  return data;
}

export async function getPendingDrafts(clientId) {
  const { data, error } = await supabase
    .from('draft_responses')
    .select('*, leads(business_name, email, stage)')
    .eq('client_id', clientId)
    .eq('status', 'pending_review')   // reply-classifier inserts with pending_review
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function updateDraftStatus(draftId, status) {
  const updates = { status };
  if (status === 'sent')     updates.sent_at = new Date().toISOString();
  if (status === 'rejected') updates.rejected_at = new Date().toISOString();
  const { error } = await supabase
    .from('draft_responses').update(updates).eq('id', draftId);
  if (error) throw error;
}

// ─── MANUAL OUTREACH QUEUE ──────────────────────────────────

export async function getManualQueue(clientId) {
  const { data, error } = await supabase
    .from('manual_outreach_queue')
    .select('*, leads(business_name, city, niche, score)')
    .eq('client_id', clientId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function updateQueueItemStatus(itemId, status) {
  const { error } = await supabase
    .from('manual_outreach_queue')
    .update({ status, sent_at: status === 'sent' ? new Date().toISOString() : null })
    .eq('id', itemId);
  if (error) throw error;
}

// ─── PIPELINE RUNS ──────────────────────────────────────────

export async function createRun(run) {
  const { data, error } = await supabase
    .from('pipeline_runs').insert(run).select().single();
  if (error) throw error;
  return data;
}

export async function updateRun(runId, updates) {
  const { error } = await supabase
    .from('pipeline_runs').update(updates).eq('id', runId);
  if (error) throw error;
}

export async function getRecentRuns(clientId, limit = 10) {
  const { data, error } = await supabase
    .from('pipeline_runs')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

// Supabase Realtime subscription for live pipeline progress
export function subscribeToRun(runId, onUpdate) {
  return supabase
    .channel(`run:${runId}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'pipeline_runs',
      filter: `id=eq.${runId}`
    }, payload => onUpdate(payload.new))
    .subscribe();
}

export function subscribeToDrafts(clientId, onInsert) {
  return supabase
    .channel(`drafts:${clientId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'draft_responses',
      filter: `client_id=eq.${clientId}`
    }, payload => onInsert(payload.new))
    .subscribe();
}

// ─── RUN HISTORY ────────────────────────────────────────────

export async function saveRunHistory(entry) {
  const { error } = await supabase.from('run_history').insert(entry);
  if (error) throw error;
}

export async function getRunHistory(clientId, limit = 20) {
  const { data, error } = await supabase
    .from('run_history')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

// ─── PROMPT VERSIONS ────────────────────────────────────────

export async function getActivePrompt(clientId, nodeName) {
  const { data, error } = await supabase
    .from('prompt_versions')
    .select('*')
    .eq('client_id', clientId)
    .eq('node_name', nodeName)
    .eq('is_active', true)
    .single();
  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no row found
  return data ?? null;
}

export async function savePromptVersion(version) {
  // Deactivate old version first
  await supabase
    .from('prompt_versions')
    .update({ is_active: false, replaced_at: new Date().toISOString() })
    .eq('client_id', version.client_id)
    .eq('node_name', version.node_name)
    .eq('is_active', true);

  const { data, error } = await supabase
    .from('prompt_versions').insert(version).select().single();
  if (error) throw error;
  return data;
}

// ─── ERROR LIBRARY ──────────────────────────────────────────

export async function findKnownError(signature) {
  const { data } = await supabase
    .from('error_library')
    .select('*')
    .eq('error_signature', signature)
    .single();
  return data ?? null;
}

export async function saveNewError(entry) {
  const { error } = await supabase
    .from('error_library')
    .upsert(entry, { onConflict: 'error_signature' });
  if (error) throw error;
}

// ─── ANALYTICS HELPERS ──────────────────────────────────────

// Twin: period-over-period comparison
export async function getWeeklyStats(clientId, weeks = 4) {
  const { data, error } = await supabase
    .from('run_history')
    .select('week_number, contact_rate, reply_rate, leads_found, best_variation')
    .eq('client_id', clientId)
    .order('week_number', { ascending: false })
    .limit(weeks);
  if (error) throw error;
  return data ?? [];
}

// Twin: niche normalization analytics
export async function getNichePerformance(clientId) {
  const { data, error } = await supabase
    .from('run_history')
    .select('niche_normalized, contact_rate, reply_rate')
    .eq('client_id', clientId)
    .not('niche_normalized', 'is', null);
  if (error) throw error;
  return data ?? [];
}

// ─── WEEKLY COMPARISON (for brain/reporter.js + brain/learner.js) ────────────
// Returns structured { current, previous, trend, pct_change } from outreach_log
export async function getWeeklyComparison(clientId) {
  const now = new Date();
  const weekStart  = new Date(now - 7  * 86400000);
  const weekStart2 = new Date(now - 14 * 86400000);

  const [curResult, prevResult, intResult, dncResult] = await Promise.all([
    // Current week sends + replies — only status='sent' (sent_at has DEFAULT now() at insert)
    supabase.from('outreach_log')
      .select('replied, channel')
      .eq('client_id', clientId)
      .eq('status', 'sent')
      .gte('sent_at', weekStart.toISOString()),
    // Previous week
    supabase.from('outreach_log')
      .select('replied')
      .eq('client_id', clientId)
      .eq('status', 'sent')
      .gte('sent_at', weekStart2.toISOString())
      .lt('sent_at', weekStart.toISOString()),
    // Interested replies this week
    supabase.from('draft_responses')
      .select('classification')
      .eq('client_id', clientId)
      .gte('received_at', weekStart.toISOString()),
    // New DNC this week
    supabase.from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('do_not_contact', true)
      .gte('updated_at', weekStart.toISOString())
  ]);

  const curRows  = curResult.data  ?? [];
  const prevRows = prevResult.data ?? [];
  const draftRows = intResult.data ?? [];

  const curSent  = curRows.length;
  const curReplied = curRows.filter(r => r.replied).length;
  const prevSent = prevRows.length;
  const prevReplied = prevRows.filter(r => r.replied).length;

  const curRate  = curSent  > 0 ? (curReplied  / curSent)  * 100 : 0;
  const prevRate = prevSent > 0 ? (prevReplied / prevSent) * 100 : 0;

  const pctChange = prevRate > 0 ? ((curRate - prevRate) / prevRate) * 100 : 0;
  const trend = pctChange > 5 ? 'improving' : pctChange < -5 ? 'declining' : 'stable';

  const interested  = draftRows.filter(d => d.classification === 'INTERESTED').length;
  const dncCount    = dncResult.count ?? 0;
  const dncRate     = curSent > 0 ? (dncCount / curSent) * 100 : 0;

  return {
    period_start: weekStart.toISOString(),
    period_end: now.toISOString(),
    current: {
      sent: curSent,
      replied: curReplied,
      reply_rate: parseFloat(curRate.toFixed(2)),
      interested,
      dnc_rate: parseFloat(dncRate.toFixed(2)),
      proposals: 0,   // populated from proposals table if needed
      new_leads: 0
    },
    previous: {
      sent: prevSent,
      replied: prevReplied,
      reply_rate: parseFloat(prevRate.toFixed(2))
    },
    trend,
    pct_change: parseFloat(pctChange.toFixed(1))
  };
}

// Scout helpers — niche + city run history for AUTO mode
export async function getNicheHistory(clientId) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data } = await supabase.from('outreach_log')
    .select('replied, leads!inner(niche, do_not_contact)')
    .eq('client_id', clientId)
    .eq('channel', 'email')
    .gte('sent_at', thirtyDaysAgo);

  if (!data) return {};
  const byNiche = {};
  for (const row of data) {
    const niche = row.leads?.niche?.toLowerCase() ?? 'unknown';
    if (!byNiche[niche]) byNiche[niche] = { sent: 0, replied: 0, dnc: 0 };
    byNiche[niche].sent++;
    if (row.replied) byNiche[niche].replied++;
    if (row.leads?.do_not_contact) byNiche[niche].dnc++;
  }
  const result = {};
  for (const [niche, d] of Object.entries(byNiche)) {
    if (d.sent >= 3) {
      result[niche] = {
        sent: d.sent,
        reply_rate: (d.replied / d.sent) * 100,
        dnc_rate: (d.dnc / d.sent) * 100
      };
    }
  }
  return result;
}

export async function getCityHistory(clientId) {
  const { data } = await supabase.from('pipeline_runs')
    .select('city, started_at')
    .eq('client_id', clientId)
    .order('started_at', { ascending: false })
    .limit(50);
  return (data ?? []).map(r => ({ city: r.city, last_run: r.started_at }));
}

// A/B/C variation winner tracking
export async function getVariationStats(clientId) {
  const { data, error } = await supabase
    .from('outreach_log')
    .select('variation, replied')
    .eq('client_id', clientId)
    .not('variation', 'is', null);
  if (error) throw error;
  if (!data) return {};
  const stats = { A: {sent:0,replied:0}, B: {sent:0,replied:0}, C: {sent:0,replied:0} };
  data.forEach(r => {
    if (!stats[r.variation]) return;
    stats[r.variation].sent++;
    if (r.replied) stats[r.variation].replied++;
  });
  return stats;
}
