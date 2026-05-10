// ============================================================
// AutoFlow v7 — learn Edge Function
// Runs every 5 pipeline runs (triggered from run-pipeline after runCount % 5 === 0)
// Also called hourly for reply classification learning
// Self-learning loop:
//   1. A/B/C winner detection (open rate proxy via replies)
//   2. Prompt rewriting for underperforming variations
//   3. Channel performance tracking
//   4. Niche performance analysis
//   5. Saves new prompt versions to prompt_versions table
// ============================================================

import { getAdminClient, callAI, callAIQuality, ok, err, CORS } from '../_shared/helpers.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const body = await req.json().catch(() => ({}));
  const { client_id, trigger } = body as { client_id?: string; trigger?: string };
  // trigger: 'pipeline_batch' | 'scheduled' | 'manual'

  const sb = getAdminClient();

  // Process specific client or all active clients
  const query = sb.from('clients').select('*').eq('active', true);
  const { data: clients } = client_id ? await query.eq('id', client_id) : await query;
  if (!clients?.length) return ok({ processed: 0 });

  const results = [];
  for (const client of clients) {
    try {
      const summary = await learnForClient(sb, client);
      results.push({ client_id: client.id, ...summary });
    } catch (e) {
      console.error(`[learn] Client ${client.id}:`, (e as Error).message);
    }
  }

  return ok({ processed: clients.length, trigger: trigger ?? 'unknown', results });
});

async function learnForClient(
  sb: ReturnType<typeof import('../_shared/helpers.ts').getAdminClient>,
  client: Record<string, unknown>
) {
  const clientId = client.id as string;
  const summary: Record<string, unknown> = {};

  // ── 1. A/B/C Winner Detection ────────────────────────────
  const abcResult = await analyzeABC(sb, clientId);
  summary.abc = abcResult;

  // ── 2. Rewrite underperforming prompts ───────────────────
  if (abcResult.should_rewrite && (client.gemini_key || client.claude_key || client.openai_key)) {
    const rewriteResult = await rewritePrompts(sb, client, abcResult);
    summary.prompt_rewrite = rewriteResult;
  }

  // ── 3. Channel performance ───────────────────────────────
  const channelResult = await analyzeChannels(sb, clientId);
  summary.channels = channelResult;

  // ── 4. Niche performance ─────────────────────────────────
  const nicheResult = await analyzeNiches(sb, clientId);
  summary.niches = nicheResult;

  // ── 5. Save learning insights to run_history ─────────────
  await sb.from('run_history').insert({
    client_id: clientId,
    event_type: 'learn',
    payload: JSON.stringify(summary),
    created_at: new Date().toISOString()
  });

  return summary;
}

// ── A/B/C Analysis ───────────────────────────────────────────
async function analyzeABC(
  sb: ReturnType<typeof import('../_shared/helpers.ts').getAdminClient>,
  clientId: string
): Promise<Record<string, unknown>> {
  // Get reply rates per variation over last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: stats } = await sb.from('outreach_log')
    .select('variation, replied')
    .eq('client_id', clientId)
    .eq('sequence_day', 0)
    .gte('sent_at', thirtyDaysAgo);

  if (!stats?.length) return { status: 'insufficient_data', should_rewrite: false };

  // Aggregate by variation
  const byVariation: Record<string, { sent: number; replied: number }> = {};
  for (const row of stats) {
    const v = (row.variation as string) ?? 'A';
    if (!byVariation[v]) byVariation[v] = { sent: 0, replied: 0 };
    byVariation[v].sent++;
    if (row.replied) byVariation[v].replied++;
  }

  // Calculate reply rates
  const rates: Record<string, number> = {};
  for (const [v, data] of Object.entries(byVariation)) {
    rates[v] = data.sent >= 5 ? (data.replied / data.sent) * 100 : -1; // -1 = insufficient data
  }

  // Find winner and loser
  const validRates = Object.entries(rates).filter(([, r]) => r >= 0);
  if (validRates.length < 2) return { rates, status: 'insufficient_data', should_rewrite: false };

  validRates.sort((a, b) => b[1] - a[1]);
  const winner = validRates[0][0];
  const loser = validRates[validRates.length - 1][0];
  const winnerRate = validRates[0][1];
  const loserRate = validRates[validRates.length - 1][1];

  // Rewrite if performance gap > 50% relative (loser is 50% worse than winner)
  const shouldRewrite = winnerRate > 0 && (winnerRate - loserRate) / winnerRate > 0.5 && loserRate < 5;

  return {
    rates,
    winner,
    loser,
    should_rewrite: shouldRewrite,
    counts: byVariation,
    status: 'analyzed'
  };
}

// ── Prompt Rewriting ─────────────────────────────────────────
async function rewritePrompts(
  sb: ReturnType<typeof import('../_shared/helpers.ts').getAdminClient>,
  client: Record<string, unknown>,
  abcData: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const clientId = client.id as string;
  const loser = abcData.loser as string;
  const winner = abcData.winner as string;
  const rates = abcData.rates as Record<string, number>;

  // Get current prompt for losing variation
  const { data: currentPrompt } = await sb.from('prompt_versions')
    .select('*')
    .eq('client_id', clientId)
    .eq('variation', loser)
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Get best-performing examples from winner variation
  const { data: goodEmails } = await sb.from('outreach_log')
    .select('body, subject')
    .eq('client_id', clientId)
    .eq('variation', winner)
    .eq('replied', true)
    .limit(3);

  const winnerExamples = (goodEmails ?? []).map(e => `Subject: ${e.subject}\n${e.body}`).join('\n\n---\n\n');

  const rewritePrompt = `You are an email copywriting expert analyzing outreach performance for a web design agency.

Current situation:
- Variation ${winner} has a ${rates[winner]?.toFixed(1)}% reply rate (winner)
- Variation ${loser} has a ${rates[loser]?.toFixed(1)}% reply rate (underperformer)

${currentPrompt ? `Current underperforming prompt for variation ${loser}:\n${currentPrompt.prompt_text}` : ''}

${winnerExamples ? `Examples from winning variation ${winner} that got replies:\n${winnerExamples}` : ''}

Rewrite the prompt for variation ${loser} to:
1. Learn from what's working in variation ${winner}
2. Try a completely different angle (not just slight tweaks)
3. Keep under 120 words
4. Focus on the specific outcome the business owner cares about (more clients, more calls)

Return JSON: {"subject_template": "...", "body_template": "...", "angle": "one-line description of the new angle"}`;

  try {
    const raw = await callAIQuality(rewritePrompt, 'Return only valid JSON.', client as Record<string, string>);
    const newPromptData = JSON.parse(raw);

    // Deactivate old prompt version
    if (currentPrompt) {
      await sb.from('prompt_versions')
        .update({ active: false })
        .eq('id', currentPrompt.id);
    }

    // Save new prompt version
    const { data: savedPrompt } = await sb.from('prompt_versions').insert({
      client_id: clientId,
      variation: loser,
      prompt_text: JSON.stringify(newPromptData),
      active: true,
      performance_before: rates[loser],
      reason: `Auto-rewrite: ${loser} underperformed ${winner} by ${((rates[winner] - rates[loser]) / rates[winner] * 100).toFixed(0)}%`,
      created_at: new Date().toISOString()
    }).select().single();

    return {
      status: 'rewritten',
      variation: loser,
      old_rate: rates[loser],
      new_prompt_id: savedPrompt?.id,
      angle: newPromptData.angle
    };
  } catch (e) {
    return { status: 'failed', error: (e as Error).message };
  }
}

// ── Channel Performance ──────────────────────────────────────
async function analyzeChannels(
  sb: ReturnType<typeof import('../_shared/helpers.ts').getAdminClient>,
  clientId: string
): Promise<Record<string, unknown>> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: stats } = await sb.from('outreach_log')
    .select('channel, replied, delivered')
    .eq('client_id', clientId)
    .gte('sent_at', thirtyDaysAgo);

  if (!stats?.length) return { status: 'insufficient_data' };

  const byChannel: Record<string, { sent: number; delivered: number; replied: number }> = {};
  for (const row of stats) {
    const ch = row.channel as string;
    if (!byChannel[ch]) byChannel[ch] = { sent: 0, delivered: 0, replied: 0 };
    byChannel[ch].sent++;
    if (row.delivered) byChannel[ch].delivered++;
    if (row.replied) byChannel[ch].replied++;
  }

  const channelRates: Record<string, Record<string, number>> = {};
  for (const [ch, data] of Object.entries(byChannel)) {
    channelRates[ch] = {
      sent: data.sent,
      delivery_rate: data.sent > 0 ? (data.delivered / data.sent) * 100 : 0,
      reply_rate: data.sent > 0 ? (data.replied / data.sent) * 100 : 0
    };
  }

  // Find best channel
  const bestChannel = Object.entries(channelRates)
    .filter(([, r]) => r.sent >= 3)
    .sort((a, b) => b[1].reply_rate - a[1].reply_rate)[0]?.[0];

  return { by_channel: channelRates, best_channel: bestChannel, status: 'analyzed' };
}

// ── Niche Performance ────────────────────────────────────────
async function analyzeNiches(
  sb: ReturnType<typeof import('../_shared/helpers.ts').getAdminClient>,
  clientId: string
): Promise<Record<string, unknown>> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Join outreach_log with leads to get niche data
  const { data: stats } = await sb.from('outreach_log')
    .select('replied, leads!inner(niche)')
    .eq('client_id', clientId)
    .eq('channel', 'email')
    .gte('sent_at', thirtyDaysAgo);

  if (!stats?.length) return { status: 'insufficient_data' };

  const byNiche: Record<string, { sent: number; replied: number }> = {};
  for (const row of stats as Array<{ replied: boolean; leads: { niche: string } }>) {
    const niche = row.leads?.niche ?? 'unknown';
    if (!byNiche[niche]) byNiche[niche] = { sent: 0, replied: 0 };
    byNiche[niche].sent++;
    if (row.replied) byNiche[niche].replied++;
  }

  const nicheRates: Array<{ niche: string; sent: number; reply_rate: number }> = [];
  for (const [niche, data] of Object.entries(byNiche)) {
    if (data.sent >= 3) {
      nicheRates.push({
        niche,
        sent: data.sent,
        reply_rate: (data.replied / data.sent) * 100
      });
    }
  }

  nicheRates.sort((a, b) => b.reply_rate - a.reply_rate);

  return {
    top_niches: nicheRates.slice(0, 5),
    bottom_niches: nicheRates.slice(-3),
    total_niches: nicheRates.length,
    status: 'analyzed'
  };
}
