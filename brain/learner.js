// ============================================================
// LeadFyn — Brain: Learner
// Reads performance data, surfaces insights for the UI
// Called from analytics.html and triggered post-learn Edge Function
// ============================================================

import { sb } from '../shared/auth.js';
import { getWeeklyComparison, getVariationStats } from '../shared/db.js';

// local alias so existing code below works unchanged
const getWeeklyStats = getWeeklyComparison;

// ── Primary export: full learning report for a client ────────
export async function getLearningReport(clientId) {
  const [abcStats, weeklyStats, channelStats, nicheStats, promptHistory] = await Promise.all([
    getVariationStats(clientId),
    getWeeklyStats(clientId),
    getChannelStats(clientId),
    getNicheStats(clientId),
    getPromptHistory(clientId)
  ]);

  return {
    abc: abcStats,
    weekly: weeklyStats,
    channels: channelStats,
    niches: nicheStats,
    prompts: promptHistory,
    generated_at: new Date().toISOString()
  };
}

// ── P1–P5 Theo-style recommendations ─────────────────────────
export async function getRecommendations(clientId) {
  const report = await getLearningReport(clientId);
  const recs = [];

  // P1: Winning variation — promote it
  if (report.abc?.winner && report.abc?.rates) {
    const winRate = report.abc.rates[report.abc.winner];
    const loserRate = Math.min(...Object.values(report.abc.rates).filter(r => r >= 0));
    if (winRate > loserRate * 1.5 && winRate > 0) {
      recs.push({
        priority: 'P1',
        type: 'ab_winner',
        title: `Variation ${report.abc.winner} is your top performer`,
        detail: `${winRate.toFixed(1)}% reply rate vs avg ${loserRate.toFixed(1)}%. Consider using ${report.abc.winner}'s angle across more outreach.`,
        action: 'view_sequences',
        data: { winner: report.abc.winner, rate: winRate }
      });
    }
  }

  // P1: DNC spike
  if (report.weekly?.current?.dnc_rate > 5) {
    recs.push({
      priority: 'P1',
      type: 'dnc_spike',
      title: 'Unsubscribe rate above 5%',
      detail: `${report.weekly.current.dnc_rate.toFixed(1)}% of recipients are opting out. Review your messaging tone in Sequences.`,
      action: 'view_sequences',
      data: { rate: report.weekly.current.dnc_rate }
    });
  }

  // P2: Best niche
  const topNiche = report.niches?.top_niches?.[0];
  if (topNiche && topNiche.reply_rate > 10) {
    recs.push({
      priority: 'P2',
      type: 'niche_opportunity',
      title: `${topNiche.niche} is your highest-converting niche`,
      detail: `${topNiche.reply_rate.toFixed(1)}% reply rate from ${topNiche.sent} emails. Run more ${topNiche.niche} campaigns.`,
      action: 'run_pipeline',
      data: { niche: topNiche.niche, rate: topNiche.reply_rate }
    });
  }

  // P2: Underperforming niche
  const bottomNiche = report.niches?.bottom_niches?.[0];
  if (bottomNiche && bottomNiche.reply_rate < 2 && bottomNiche.sent >= 10) {
    recs.push({
      priority: 'P2',
      type: 'niche_underperform',
      title: `${bottomNiche.niche} has low reply rate`,
      detail: `Only ${bottomNiche.reply_rate.toFixed(1)}% from ${bottomNiche.sent} emails. Try a different angle or pause this niche.`,
      action: 'view_sequences',
      data: { niche: bottomNiche.niche, rate: bottomNiche.reply_rate }
    });
  }

  // P3: Best channel
  const bestChannel = report.channels?.best_channel;
  if (bestChannel && bestChannel !== 'email') {
    const chData = report.channels?.by_channel?.[bestChannel];
    if (chData?.reply_rate > 5) {
      recs.push({
        priority: 'P3',
        type: 'channel_opportunity',
        title: `${bestChannel.replace('_', ' ')} is outperforming email`,
        detail: `${chData.reply_rate.toFixed(1)}% reply rate. Make sure your ${bestChannel} outreach is active in the DM queue.`,
        action: 'view_outreach_hub',
        data: { channel: bestChannel, rate: chData.reply_rate }
      });
    }
  }

  // P3: Weekly trend
  if (report.weekly?.trend === 'declining' && report.weekly?.pct_change < -20) {
    recs.push({
      priority: 'P3',
      type: 'declining_trend',
      title: 'Reply rate declining week over week',
      detail: `Down ${Math.abs(report.weekly.pct_change).toFixed(0)}% from last week. The learn engine has queued a prompt rewrite.`,
      action: 'view_analytics',
      data: report.weekly
    });
  }

  // P4: Follow-up performance
  if (report.weekly?.fu3_reply_rate > report.weekly?.day0_reply_rate) {
    recs.push({
      priority: 'P4',
      type: 'followup_insight',
      title: 'Day 14 follow-ups converting better than Day 0',
      detail: 'Leads need more nurturing. Consider adding value emails between initial outreach and Day 14.',
      action: 'view_sequences',
      data: {}
    });
  }

  // P5: Prompt was auto-rewritten
  if (report.prompts?.recent_rewrite) {
    recs.push({
      priority: 'P5',
      type: 'prompt_rewrite',
      title: `Variation ${report.prompts.recent_rewrite.variation} prompt auto-updated`,
      detail: `Angle changed to: "${report.prompts.recent_rewrite.angle}". Watch performance over next 20 sends.`,
      action: 'view_sequences',
      data: report.prompts.recent_rewrite
    });
  }

  // Sort: P1 first
  return recs.sort((a, b) => a.priority.localeCompare(b.priority));
}

// ── Channel stats (last 30 days) ─────────────────────────────
async function getChannelStats(clientId) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await sb.from('outreach_log')
    .select('channel, replied, delivered')
    .eq('client_id', clientId)
    .gte('sent_at', thirtyDaysAgo);

  if (!data?.length) return null;

  const byChannel = {};
  for (const row of data) {
    const ch = row.channel ?? 'email';
    if (!byChannel[ch]) byChannel[ch] = { sent: 0, delivered: 0, replied: 0 };
    byChannel[ch].sent++;
    if (row.delivered) byChannel[ch].delivered++;
    if (row.replied) byChannel[ch].replied++;
  }

  const rates = {};
  for (const [ch, d] of Object.entries(byChannel)) {
    rates[ch] = {
      sent: d.sent,
      delivery_rate: d.sent > 0 ? (d.delivered / d.sent * 100) : 0,
      reply_rate: d.sent > 0 ? (d.replied / d.sent * 100) : 0
    };
  }

  const best = Object.entries(rates)
    .filter(([, r]) => r.sent >= 3)
    .sort((a, b) => b[1].reply_rate - a[1].reply_rate)[0]?.[0];

  return { by_channel: rates, best_channel: best };
}

// ── Niche stats ───────────────────────────────────────────────
async function getNicheStats(clientId) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await sb.from('outreach_log')
    .select('replied, leads!inner(niche)')
    .eq('client_id', clientId)
    .eq('channel', 'email')
    .gte('sent_at', thirtyDaysAgo);

  if (!data?.length) return { top_niches: [], bottom_niches: [] };

  const byNiche = {};
  for (const row of data) {
    const niche = row.leads?.niche ?? 'unknown';
    if (!byNiche[niche]) byNiche[niche] = { sent: 0, replied: 0 };
    byNiche[niche].sent++;
    if (row.replied) byNiche[niche].replied++;
  }

  const rates = Object.entries(byNiche)
    .filter(([, d]) => d.sent >= 3)
    .map(([niche, d]) => ({ niche, sent: d.sent, reply_rate: d.replied / d.sent * 100 }))
    .sort((a, b) => b.reply_rate - a.reply_rate);

  return { top_niches: rates.slice(0, 5), bottom_niches: rates.slice(-3), total: rates.length };
}

// ── Recent prompt history ─────────────────────────────────────
async function getPromptHistory(clientId) {
  const { data } = await sb.from('prompt_versions')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(10);

  const recentRewrite = data?.find(p => {
    const age = Date.now() - new Date(p.created_at).getTime();
    return age < 7 * 24 * 60 * 60 * 1000; // Within last week
  });

  if (recentRewrite) {
    try {
      const promptData = JSON.parse(recentRewrite.prompt_text);
      return {
        recent_rewrite: {
          variation: recentRewrite.variation,
          angle: promptData.angle,
          created_at: recentRewrite.created_at,
          performance_before: recentRewrite.performance_before
        },
        history: data
      };
    } catch { /* ignore parse error */ }
  }

  return { recent_rewrite: null, history: data ?? [] };
}

// ── Trigger learn Edge Function ───────────────────────────────
export async function triggerLearn(clientId, trigger = 'manual') {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;

  const supabaseUrl = window.__SUPABASE_URL__ ?? import.meta.env?.VITE_SUPABASE_URL;
  const res = await fetch(`${supabaseUrl}/functions/v1/learn`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ client_id: clientId, trigger })
  });

  return res.ok ? await res.json() : null;
}
