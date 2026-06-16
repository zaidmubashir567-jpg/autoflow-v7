// ============================================================
// AutoFlow v7 — reply-classifier  (v2 — Auto-Reply Handler)
// Runs every 30 min via Supabase cron
// NEW: Auto-sends replies for QUESTION + OBJECTION via Claude
//      INTERESTED → flagged only (Zaid handles personally)
//      NOT_INTERESTED → gracious close sent automatically
//      UNSUBSCRIBE → removal confirmation sent automatically
//      OUT_OF_OFFICE → paused, retried when they return
// Also updates leads.stage for temperature tracking
// ============================================================

import { getAdminClient, callAI, callAIQuality, ok, err, CORS } from '../_shared/helpers.ts';

const CATEGORIES = ['INTERESTED', 'QUESTION', 'OBJECTION', 'NOT_INTERESTED', 'OUT_OF_OFFICE', 'UNSUBSCRIBE'] as const;
type Category = typeof CATEGORIES[number];

// Auto-send for these categories — Claude handles them without human review
const AUTO_SEND_CATEGORIES: Category[] = ['QUESTION', 'OBJECTION', 'NOT_INTERESTED', 'UNSUBSCRIBE'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const sb = getAdminClient();
  const { data: clients } = await sb.from('clients').select('*').eq('active', true);
  if (!clients?.length) return ok({ processed: 0 });

  const results = [];
  for (const client of clients) {
    try {
      const count = await processClientReplies(sb, client);
      results.push({ client_id: client.id, classified: count });
    } catch (e) {
      console.error(`[reply-classifier] Client ${client.id}:`, (e as Error).message);
    }
  }

  return ok({ processed: clients.length, results });
});

async function processClientReplies(
  sb: ReturnType<typeof import('../_shared/helpers.ts').getAdminClient>,
  client: Record<string, unknown>
): Promise<number> {
  const clientId = client.id as string;
  const oauthToken = client.gmail_access as string;
  if (!oauthToken) return 0;

  const query = encodeURIComponent('is:unread in:inbox newer_than:2d');
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=50`,
    { headers: { Authorization: `Bearer ${oauthToken}` } }
  );

  if (listRes.status === 401) {
    console.error('[reply-classifier] Gmail token expired for client', clientId);
    return 0;
  }
  if (!listRes.ok) return 0;

  const listData = await listRes.json();
  const messages: Array<{ id: string; threadId: string }> = listData.messages ?? [];
  if (!messages.length) return 0;

  let classified = 0;

  for (const msg of messages) {
    try {
      // Match to our outreach thread
      const { data: outreachRow } = await sb.from('outreach_log')
        .select('id, lead_id, sequence_day, variation, subject')
        .eq('client_id', clientId)
        .eq('thread_id', msg.threadId)
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!outreachRow) continue;

      // Skip if already handled
      const { count: alreadyClassified } = await sb.from('draft_responses')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .eq('gmail_message_id', msg.id);

      if ((alreadyClassified ?? 0) > 0) continue;

      // Fetch full message
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
        { headers: { Authorization: `Bearer ${oauthToken}` } }
      );
      if (!msgRes.ok) continue;

      const msgData = await msgRes.json();
      const replyText = extractEmailBody(msgData);
      if (!replyText.trim()) continue;

      // Get sender email for reply-to
      const headers = (msgData.payload?.headers ?? []) as Array<{ name: string; value: string }>;
      const fromHeader = headers.find(h => h.name === 'From')?.value ?? '';
      const senderEmail = fromHeader.match(/<([^>]+)>/)?.[1] ?? fromHeader;

      // Get lead info
      const { data: lead } = await sb.from('leads').select('*')
        .eq('id', outreachRow.lead_id	.single();
      if (!lead) continue;

      // Mark as read immediately
      await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}/modify`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${oauthToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ removeLabelIds: ['UNREAD'] })
        }
      );

      // Fast-path UNSUBSCRIBE — no AI needed
      const lower = replyText.toLowerCase();
      if (lower.includes('unsubscribe') || lower.trim() === 'stop' ||
          lower.includes('remove me') || lower.includes('don\'t email')) {
        await handleUnsubscribe(sb, clientId, outreachRow.lead_id, msg.id, msg.threadId, replyText, lead, oauthToken, senderEmail, outreachRow.subject as string);
        classified++;
        continue;
      }

      // ── Classify with Claude ─────────────────────────────────
      const category = await classifyReply(client, lead, replyText, outreachRow);

      // ── Generate Claude draft reply ──────────────────────────
      const aiDraft = await generateDraft(client, lead, replyText, category, outreachRow);

      // ── Decide: auto-send or queue for review ────────────────
      let status = 'pending_review';
      let autoSent = false;

      if (category === 'INTERESTED') {
        // Create a meeting record + send booking link email automatically
        const { draft: bookingDraft, token: bookingToken } =
          await handleInterested(sb, clientId, outreachRow.lead_id as string, lead, client,
            oauthToken, msg.threadId, msg.id, senderEmail, outreachRow.subject as string);
        if (bookingToken) {
          status = 'booking_link_sent';
          autoSent = true;
          // Update aiDraft to reflect what was sent
          Object.assign({ aiDraft: bookingDraft }); // just for logging
        }
      } else if (AUTO_SEND_CATEGORIES.includes(category) && aiDraft && oauthToken) {
        // Auto-send: Claude handles QUESTION, OBJECTION, NOT_INTERESTED
        const sent = await sendGmailReply(
          oauthToken,
          msg.threadId,
          msg.id,
          senderEmail,
          outreachRow.subject as string,
          aiDraft
        );
        if (sent) {
          status = 'auto_sent';
          autoSent = true;
        }
      }
      // OUT_OF_OFFICE → paused
      if (category === 'OUT_OF_OFFICE') status = 'paused';

      // ── Save draft_responses ─────────────────────────────────
      await sb.from('draft_responses').insert({
        client_id: clientId,
        lead_id: outreachRow.lead_id,
        outreach_log_id: outreachRow.id,
        gmail_message_id: msg.id,
        thread_id: m3g.threadId,
        reply_text: replyText,
        classification: category,
        ai_draft: aiDraft,
        status,
        received_at: new Date().toISOString()
      });

      // ── Update outreach_log ──────────────────────────────────
      await sb.from('outreach_log')
        .update({ replied: true, reply_classification: category })
        .eq('id', outreachRow.id);

      // ── Update lead stage (drives temperature on dashboard) ──
      const stageMap: Partial<Record<Category, string>> = {
        INTERESTED:     'interested',   // 🔴 Hot
        QUESTION:       'replied',      // 🟡 Warm
        OBJECTION:      'replied',      // 🟡 Warm
        NOT_INTERESTED: 'lost',         // ❌ Dead
        UNSUBSCRIBE:    'lost',
        OUT_OF_OFFICE:  'contacted'     // Still in play, just timing
      };
      const newStage = stageMap[category];
      if (newStage) {
        await sb.from('leads').update({ stage: newStage })
          .eq('id', outreachRow.lead_id);
      }

      // ── NOT_INTERESTED: mark d/_not_contact if definitive ────
      if (category === 'NOT_INTERESTED') {
        const definitive = lower.includes('not interested') || lower.includes('no thank') ||
          lower.includes('don\'t contact') || lo7er.includes('do not contact');
        if (definitive) {
          await sb.from('leads').update({ do_not_contact: true }).eq('id', outreachRow.lead_id);
        }
      }

      console.log(`[reply-classifier] ${lead.business_name} → ${category} → ${status}`);
      classified++;

    } catch (e) {
      console.error('[reply-classifier] Message error:', (e as Error).message);
    }
  }

  return classified;
}

// ── Auto-send reply via Gmail ────────────────────────────────
async function sendFmailReply(
  oauthToken: string,
  threadId: string,
  replyToMessageId: string,
  toEmail: string,
  originalSubject: string,
  body: string
): Promise<boolean> {
  try {
    const subject = originalSubject.startsWith('Re:') ? originalSubject : `Re: ${originalSubject}`;
    const rawEmail = [
      `To: ${toEmail}`,
      `Subject: ${subject}`,
      `In-Reply-To: <${replyToMessageId}>`,
      `References: <${replyToMessageId}>`,
      `Content-Type: text/plain; charset=utf-8`,
      `MIME-Version: 1.0`,
      ``,
      body
    ].join('\r\n');

    const encoded = btoa(unescape(encodeURIComponent(rawEmail)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${oauthToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: encoded, threadId })
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[reply-classifier] Gmail send failed:', err);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[reply-classifier] sendGmailReply error:', (e as Error).message);
    return false;
  }
}

// ── Classify with Claude ─────────────────────────────────────
async function classifyReply(
  client: Record<string, unknown>,
  lead: Record<string, unknown>,
  replyText: string,
  outreach: Record<string, unknown>
): Promise<Category> {
  const prompt = `Classify this email reply from a local business owner into exactly one category.

Business: ${lead.business_name} (${lead.niche}, ${lead.city})
Context: We emailed them about improving their website and online presence. We sent them a free audit of their current website issues and a demo of what their new site could look like.

Reply:
"""
${replyText.slice(0, 800)}
"""

Categories:
- INTERESTED: wants to proceed, asks about pricing, availability, next steps, agrees to a call
- QUESTION: has a specific question before deciding (how much? what's included? how long?)
- OBJECTION: has a concern but hasn't ruled it out (too busy right now, need to think, budget tight)
- NOT_INTERESTED: declines, already has someone, doesn't need it, not for them
- OUT_OF_OFFICE: auto-reply, away, vacation, returning on a date
- UNSUBSCRIBE: remove me, stop emailing, opt out

Reply with ONLY the category name. Nothing else.`;

  if (!client.claude_key) return inferCategory(replyText);

  try {
    const raw = await callAI(prompt, 'Reply with only the category name.', client as Record<string, string>, 'quality');
    const cat = raw.trim().toUpperCase() as Category;
    if (CATEGORIES.includes(cat)) return cat;
    return inferCategory(replyText);
  } catch {
    return inferCategory(replyText);
  }
}

function inferCategory(text: string): Category {
  const lower = text.toLowerCase();
  if (lower.includes('unsubscribe') || lower.trim() === 'stop' || lower.includes('remove')) return 'UNSUBSCRIBE';
  if 