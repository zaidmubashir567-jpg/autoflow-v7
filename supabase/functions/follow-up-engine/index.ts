// ============================================================
// AutoFlow v7 — follow-up-engine Edge Function
// Runs daily at 10:00 AM (scheduled via Supabase cron)
// Twin patterns: Day 0/3/7/14 sequence, FU3→FU2→FU1→new priority, 20/day hard cap
// ============================================================

import { getAdminClient, callAI, ok, err, CORS } from '../_shared/helpers.ts';

const DAILY_CAP = 20; // Twin pattern: hard cap per client per day

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const sb = getAdminClient();
  const results = [];

  // Process all active clients
  const { data: clients } = await sb.from('clients').select('*').eq('active', true);
  if (!clients) return ok({ processed: 0 });

  for (const client of clients) {
    try {
      const sent = await processClientFollowUps(sb, client);
      results.push({ client_id: client.id, sent });
    } catch (e) {
      console.error(`[follow-up-engine] Client ${client.id}:`, (e as Error).message);
    }
  }

  return ok({ processed: clients.length, results });
});

async function processClientFollowUps(sb: ReturnType<typeof import('../_shared/helpers.ts').getAdminClient>, client: Record<string, unknown>) {
  const clientId = client.id as string;
  const cap = (client.daily_email_cap as number) ?? DAILY_CAP;
  let sent = 0;

  // Today's send count
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const { count: todayCount } = await sb.from('outreach_log')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .gte('sent_at', today.toISOString());

  let remaining = cap - (todayCount ?? 0);
  if (remaining <= 0) return 0; // Cap reached

  const now = new Date();

  // ── PRIORITY ORDER: FU3 → FU2 → FU1 → new (Twin pattern) ─
  const followUpDays = [14, 7, 3]; // Process FU3 first

  for (const day of followUpDays) {
    if (remaining <= 0) break;

    // Find leads that had Day 0 send X days ago, haven't replied, not do_not_contact
    const cutoffDate = new Date(now.getTime() - day * 24 * 60 * 60 * 1000);
    const windowStart = new Date(cutoffDate.getTime() - 12 * 60 * 60 * 1000); // 12h window
    const windowEnd   = new Date(cutoffDate.getTime() + 12 * 60 * 60 * 1000);

    const { data: day0Sends } = await sb.from('outreach_log')
      .select('lead_id, thread_id, variation')
      .eq('client_id', clientId)
      .eq('sequence_day', 0)
      .gte('sent_at', windowStart.toISOString())
      .lte('sent_at', windowEnd.toISOString())
      .eq('replied', false);

    if (!day0Sends?.length) continue;

    for (const send of day0Sends) {
      if (remaining <= 0) break;

      // Skip if already sent this follow-up day
      const { count: alreadySent } = await sb.from('outreach_log')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .eq('lead_id', send.lead_id)
        .eq('sequence_day', day);

      if ((alreadySent ?? 0) > 0) continue;

      // Get lead info
      const { data: lead } = await sb.from('leads').select('*').eq('id', send.lead_id).single();
      if (!lead || lead.do_not_contact) continue; // RLS also enforces this

      // Generate follow-up copy
      const fupBody = await generateFollowUp(client, lead, day, send.variation as string);

      // Send email
      const emailResult = await sendFollowUpEmail(client, lead, fupBody, day, send.thread_id as string);
      if (emailResult) {
        await sb.from('outreach_log').insert({
          client_id: clientId,
          lead_id: send.lead_id,
          channel: 'email',
          variation: send.variation,
          subject: fupBody.subject,
          body: fupBody.body,
          sequence_day: day,
          thread_id: emailResult.threadId ?? send.thread_id,
          sent_at: new Date().toISOString(),
          delivered: true
        });
        sent++;
        remaining--;
      }
    }
  }

  return sent;
}

async function generateFollowUp(client: Record<string, unknown>, lead: Record<string, unknown>, day: number, variation: string): Promise<{ subject: string; body: string }> {
  const templates: Record<number, string> = {
    3:  `Write a short Day 3 follow-up email for ${lead.business_name as string} (${lead.niche as string} in ${lead.city as string}). Angle: add value, ask one specific question. Variant ${variation} angle: ${variation === 'A' ? 'ROI focus' : variation === 'B' ? 'pain point' : 'social proof'}. Under 80 words. No fluff. Start with "Re: " implied by thread. Return JSON: {"subject":"Re: [original subject]","body":"..."}`,
    7:  `Write a Day 7 follow-up email sharing a brief case study for ${lead.business_name as string} (${lead.niche as string}). One result from a similar business. Under 100 words. Return JSON: {"subject":"Case study for ${lead.niche as string} owners","body":"..."}`,
    14: `Write a Day 14 breakup email to ${lead.business_name as string}. Tone: respectful final message, leave door open, no pressure. Under 60 words. Return JSON: {"subject":"Last one from me","body":"..."}`
  };

  const hasAI = (client.gemini_key || client.claude_key || client.openai_key) as string;
  if (!hasAI) return { subject: `Following up`, body: `Hi! Just wanted to follow up on my previous message about your website. Let me know if you'd like to chat.` };

  try {
    const raw = await callAI(templates[day], 'Return only valid JSON with subject and body.', client as Record<string, string>);
    return JSON.parse(raw);
  } catch {
    return { subject: day === 14 ? 'Last one from me' : 'Following up', body: `Hi! Wanted to follow up about your website. Interested in a quick chat?` };
  }
}

async function sendFollowUpEmail(client: Record<string, unknown>, lead: Record<string, unknown>, copy: { subject: string; body: string }, day: number, threadId: string | null): Promise<{ threadId?: string } | null> {
  const oauthToken = client.gmail_access as string;
  if (!oauthToken || !lead.email) return null;

  const to = lead.email as string;
  const raw = btoa([
    `To: ${to}`,
    `Subject: ${copy.subject}`,
    'Content-Type: text/plain; charset=utf-8',
    ...(threadId ? [`In-Reply-To: ${threadId}`, `References: ${threadId}`] : []),
    '',
    copy.body,
    '',
    '---',
    'To unsubscribe reply STOP'
  ].join('\r\n')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const payload: Record<string, string> = { raw };
  if (threadId) payload.threadId = threadId;

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${oauthToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (res.status === 401) {
    console.error('[follow-up] Gmail token expired for client', client.id);
    return null;
  }
  if (!res.ok) return null;

  const data = await res.json();
  return { threadId: data.threadId };
}
