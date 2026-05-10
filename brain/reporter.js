// ============================================================
// AutoFlow v7 — Brain: Reporter
// Generates run summaries, weekly digests, and Theo-style P1-P5 insights
// Used by dashboard.html and analytics.html
// ============================================================

import { sb } from '../shared/auth.js';
import { getWeeklyComparison } from '../shared/db.js';
import { getRecommendations } from './learner.js';

// local alias so existing code below works unchanged
const getWeeklyStats = getWeeklyComparison;

// ── Full weekly digest for a client ──────────────────────────
export async function getWeeklyDigest(clientId) {
  const [weekly, recs, recentRuns] = await Promise.all([
    getWeeklyStats(clientId),
    getRecommendations(clientId),
    getRecentRuns(clientId, 5)
  ]);

  const digest = {
    period: { start: weekly?.period_start, end: weekly?.period_end },
    headline: buildHeadline(weekly),
    metrics: {
      emails_sent: weekly?.current?.sent ?? 0,
      reply_rate: weekly?.current?.reply_rate ?? 0,
      interested_count: weekly?.current?.interested ?? 0,
      proposals_sent: weekly?.current?.proposals ?? 0,
      new_leads: weekly?.current?.new_leads ?? 0
    },
    vs_last_week: {
      sent_change_pct: weekly?.pct_change ?? 0,
      trend: weekly?.trend ?? 'stable'
    },
    top_recommendations: recs.slice(0, 3),
    recent_runs: recentRuns,
    generated_at: new Date().toISOString()
  };

  return digest;
}

// ── Single pipeline run summary ───────────────────────────────
export async function getRunSummary(runId, clientId) {
  const { data: run } = await sb.from('pipeline_runs')
    .select('*')
    .eq('id', runId)
    .eq('client_id', clientId)
    .single();

  if (!run) return null;

  const duration = run.completed_at && run.started_at
    ? Math.round((new Date(run.completed_at) - new Date(run.started_at)) / 1000)
    : null;

  return {
    id: run.id,
    status: run.status,
    started_at: run.started_at,
    completed_at: run.completed_at,
    duration_seconds: duration,
    stats: {
      leads_found: run.leads_found ?? 0,
      leads_enriched: run.leads_enriched ?? 0,
      emails_queued: run.emails_queued ?? 0,
      emails_sent: run.emails_sent ?? 0,
      sites_deployed: run.sites_deployed ?? 0,
      proposals_sent: run.proposals_sent ?? 0
    },
    errors: run.errors ?? [],
    node_progress: run.node_progress ?? {},
    niche: run.niche,
    city: run.city,
    state: run.state
  };
}

// ── Admin dashboard stats row ─────────────────────────────────
export async function getDashboardStats(clientId) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    todaySentResult,
    pendingDraftsResult,
    pendingDMResult,
    weeklyResult,
    totalLeadsResult,
    activeLeadsResult
  ] = await Promise.all([
    sb.from('outreach_log').select('*', { count: 'exact', head: true })
      .eq('client_id', clientId).gte('sent_at', today.toISOString()),
    sb.from('draft_responses').select('*', { count: 'exact', head: true })
      .eq('client_id', clientId).eq('status', 'pending_review'),
    sb.from('manual_outreach_queue').select('*', { count: 'exact', head: true })
      .eq('client_id', clientId).eq('status', 'pending'),
    getWeeklyStats(clientId),
    sb.from('leads').select('*', { count: 'exact', head: true })
      .eq('client_id', clientId),
    sb.from('leads').select('*', { count: 'exact', head: true })
      .eq('client_id', clientId).eq('do_not_contact', false)
      .not('email', 'is', null)
  ]);

  return {
    today_sent: todaySentResult.count ?? 0,
    pending_drafts: pendingDraftsResult.count ?? 0,
    pending_dm: pendingDMResult.count ?? 0,
    weekly_reply_rate: weeklyResult?.current?.reply_rate ?? 0,
    total_leads: totalLeadsResult.count ?? 0,
    active_leads: activeLeadsResult.count ?? 0,
    trend: weeklyResult?.trend ?? 'stable',
    pct_change: weeklyResult?.pct_change ?? 0
  };
}

// ── Recent pipeline runs ──────────────────────────────────────
async function getRecentRuns(clientId, limit = 5) {
  const { data } = await sb.from('pipeline_runs')
    .select('id, status, started_at, leads_found, emails_sent, niche, city, state, errors')
    .eq('client_id', clientId)
    .order('started_at', { ascending: false })
    .limit(limit);

  return (data ?? []).map(r => ({
    id: r.id,
    status: r.status,
    started_at: r.started_at,
    leads_found: r.leads_found ?? 0,
    emails_sent: r.emails_sent ?? 0,
    target: `${r.niche ?? ''} — ${r.city ?? ''}, ${r.state ?? ''}`.trim().replace(/^—\s*/, ''),
    has_errors: (r.errors?.length ?? 0) > 0
  }));
}

// ── Headline generator ────────────────────────────────────────
function buildHeadline(weekly) {
  if (!weekly?.current) return 'No data yet — run your first pipeline!';

  const { reply_rate, interested, sent } = weekly.current;
  const trend = weekly.trend;
  const change = Math.abs(weekly.pct_change ?? 0);

  if (interested > 0) {
    return `${interested} interested lead${interested > 1 ? 's' : ''} this week — follow up in Pipeline Manager.`;
  }
  if (sent === 0) {
    return 'No emails sent this week — run a new pipeline to get started.';
  }
  if (trend === 'improving' && change > 10) {
    return `Reply rate up ${change.toFixed(0)}% week-over-week. Keep the momentum going!`;
  }
  if (trend === 'declining' && change > 20) {
    return `Reply rate down ${change.toFixed(0)}% — check P1 recommendations below.`;
  }
  return `${sent} emails sent this week with ${reply_rate?.toFixed(1) ?? 0}% reply rate.`;
}

// ── Export for use in analytics.html ─────────────────────────
export async function getAnalyticsData(clientId) {
  const [digest, recs] = await Promise.all([
    getWeeklyDigest(clientId),
    getRecommendations(clientId)
  ]);

  return { digest, recommendations: recs };
}
