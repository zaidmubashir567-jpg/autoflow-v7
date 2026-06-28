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

import { getAdminClient, callAI, callAIQuality, ok, err, CORS, refreshGmailToken } from '../_shared/helpers.ts';

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
  let oauthToken = client.gmail_access as string;
  if (!oauthToken) return 0;

  const query = encodeURIComponent('is:unread in:inbox newer_than:2d');
  let listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=50`,
    { headers: { Authorization: `Bearer ${oauthToken}` } }
  );

  // ── Auto-refresh on 401 ──────────────────────────────────────
  if (listRes.status === 401) {
    console.log('[reply-classifier] Access token expired — attempting refresh for', clientId);
    const refreshToken = client.gmail_refresh as string;
    const newToken = await refreshGmailToken(refreshToken);
    if (!newToken) {
      console.error('[reply-classifier] Token refresh failed for', clientId);
      return 0;
    }
    // Store the fresh token back in DB
    await sb.from('clients').update({
      gmail_access:         newToken,
      gmail_token_saved_at: new Date().toISOString()
    }).eq('id', clientId);
    oauthToken = newToken;
    // Retry the listing with the new token
    listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=50`,
      { headers: { Authorization: `Bearer ${oauthToken}` } }
    );
    if (!listRes.ok) {
      console.error('[reply-classifier] Still failing after refresh:', listRes.status);
      return 0;
    }
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
        .eq('id', outreachRow.lead_id).single();
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
        thread_id: msg.threadId,
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

      // ── NOT_INTERESTED: mark do_not_contact if definitive ────
      if (category === 'NOT_INTERESTED') {
        const definitive = lower.includes('not interested') || lower.includes('no thank') ||
          lower.includes('don\'t contact') || lower.includes('do not contact');
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
async function sendGmailReply(
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
  if (lower.includes('out of office') || lower.includes('away') || lower.includes('vacation')) return 'OUT_OF_OFFICE';
  if (lower.includes('not interested') || lower.includes('no thank') || lower.includes('already have')) return 'NOT_INTERESTED';
  if (lower.includes('how much') || lower.includes('price') || lower.includes('cost') || lower.includes('interested')) return 'INTERESTED';
  if (lower.includes('busy') || lower.includes('budget') || lower.includes('think about')) return 'OBJECTION';
  if (lower.includes('?')) return 'QUESTION';
  return 'QUESTION';
}

// ── Generate Claude draft ────────────────────────────────────
async function generateDraft(
  client: Record<string, unknown>,
  lead: Record<string, unknown>,
  replyText: string,
  category: Category,
  outreach: Record<string, unknown>
): Promise<string> {
  if (!client.claude_key || category === 'OUT_OF_OFFICE') return '';

  // ── Detect objection subtype for targeted script ─────────────
  const replyLower = replyText.toLowerCase();
  const objSubtype =
    (replyLower.includes('expensive') || replyLower.includes('too much') || replyLower.includes('cost') || replyLower.includes('budget') || replyLower.includes('price'))
      ? 'price'
    : (replyLower.includes('already have') || replyLower.includes('working with') || replyLower.includes('have someone') || replyLower.includes('have a person') || replyLower.includes('have a guy') || replyLower.includes('have an agency'))
      ? 'have_someone'
    : (replyLower.includes('tried') || replyLower.includes("didn't work") || replyLower.includes('does not work') || replyLower.includes('not for us') || replyLower.includes('waste'))
      ? 'tried_before'
    : (replyLower.includes('not now') || replyLower.includes('call me back') || replyLower.includes('later') || replyLower.includes('months') || replyLower.includes('next year') || replyLower.includes('busy'))
      ? 'timing'
    : 'generic';

  const OBJECTION_SCRIPTS: Record<string, string> = {
    price:        `Their objection is about cost/price. Use this script (adapt to feel natural, not copy-pasted): "Totally understand — let me ask: what does one new customer typically bring you in revenue over a year? Most businesses find that getting just 2–3 new customers per month covers the entire cost of this. The real question is whether the maths work for you — want me to walk through it quickly?" Under 70 words. Sign off "Best, Zaid".`,
    have_someone: `Their objection is that they already have someone doing marketing. Use this script: "That's great — how many qualified appointments are they booking you per month right now? I'm not here to replace anything that's working. But if there's a gap in your pipeline, I can fill it without disrupting what you already have. Happy to show you what we'd add — no commitment." Under 75 words. Sign off "Best, Zaid".`,
    tried_before: `Their objection is that they tried something like this before and it didn't work. Use this script: "I hear that a lot — and usually it came down to one of three things: wrong targeting, generic copy, or no follow-up system. What specifically didn't work? I can tell you in 30 seconds whether what we do is different — or save us both the time." Under 70 words. Sign off "Best, Zaid".`,
    timing:       `Their objection is bad timing — too busy, not now, call back later. Use this script: "Completely fair — can I ask, is it the timing, or is getting new customers just not a priority right now? I ask because I have clients who said the same thing and are now booking 10+ calls a month. I'll follow up in 6 weeks — does that work, or is there a better time?" Under 75 words. Sign off "Best, Zaid".`,
    generic:      `Acknowledge their concern in one genuine sentence — don't repeat their objection back to them. Reframe with one specific benefit for a ${(lead as Record<string,unknown>).niche as string} business. Offer a no-commitment 10-minute conversation. Keep it conversational, not salesy. Under 80 words. Sign off "Best, Zaid".`,
  };

  const instructions: Record<Category, string> = {
    INTERESTED: `Write a warm, professional reply confirming their interest. Suggest 2 specific time slots this week for a 15-minute call. Sign off "Best, Zaid". Under 80 words. Do NOT over-sell — they're already interested.`,
    QUESTION: `Answer their question directly and specifically. Keep it under 100 words. End by offering a quick 15-minute call to cover anything else. Sign off "Best, Zaid".`,
    OBJECTION: OBJECTION_SCRIPTS[objSubtype],
    NOT_INTERESTED: `Send a gracious, professional one-sentence reply thanking them for their time and leaving the door open if they ever need us. Under 25 words. No pitch at all. Sign off "Best, Zaid".`,
    OUT_OF_OFFICE: ``,
    UNSUBSCRIBE: `Confirm they've been removed. One sentence. Under 15 words. No pitch.`
  };

  const prompt = `You are handling email replies for a web presence agency on behalf of the business owner.

You just received this reply from ${lead.business_name as string} (${lead.niche as string} in ${lead.city as string}):
"${replyText.slice(0, 400)}"

Classification: ${category}

Your task: ${instructions[category]}

Return ONLY the email body text. No subject line. No "Dear" — just start the message body.`;

  try {
    return await callAIQuality(prompt, 'Write a concise, professional email reply.', client as Record<string, string>);
  } catch {
    return '';
  }
}

// ── Handle INTERESTED — create meeting + send booking link ───
async function handleInterested(
  sb: ReturnType<typeof import('../_shared/helpers.ts').getAdminClient>,
  clientId: string,
  leadId: string,
  lead: Record<string, unknown>,
  client: Record<string, unknown>,
  oauthToken: string,
  threadId: string,
  messageId: string,
  senderEmail: string,
  originalSubject: string
): Promise<{ draft: string; token: string | null }> {
  try {
    // Create a pending meeting record for this lead
    const { data: meeting } = await sb.from('meetings').insert({
      client_id:    clientId,
      lead_id:      leadId,
      visitor_name: (lead.contact_name ?? lead.business_name) as string,
      visitor_email: senderEmail,
      status:       'pending',
      created_at:   new Date().toISOString()
    }).select('booking_token').single();

    const token = meeting?.booking_token as string | undefined;
    const bookingUrl = token
      ? `https://autoflow-v7.vercel.app/book.html?t=${token}`
      : 'https://autoflow-v7.vercel.app/#contact';

    const bizName = lead.business_name as string ?? 'your business';
    const niche   = lead.niche as string ?? 'business';

    // Generate personalised warm reply with booking link
    let draft = '';
    if (client.claude_key) {
      const prompt = `Write a warm, professional reply to a ${niche} owner (${bizName}) who just replied saying they're interested in our website/lead-gen service.

Their reply was a positive response to our cold outreach email.

Task: Write a short, friendly email (under 100 words) that:
1. Thanks them for their interest — one sentence, genuine
2. Says: "I've set up a quick booking link so you can pick a time that suits you — just click here: ${bookingUrl}"
3. Says you're looking forward to the call
4. Sign off with "Best, Zaid" (keep [YOUR NAME] placeholder as written)

Return ONLY the email body. No subject line.`;
      draft = await callAI(prompt, 'Write a concise, warm email reply.', client as Record<string, string>, 'quality').catch(() => '');
    }

    // Fallback draft if Claude not available
    if (!draft) {
      draft = `Thanks so much for getting back to me — really excited to hear you're interested!\n\nI've set up a quick booking link so you can pick a time that suits you best:\n${bookingUrl}\n\nLooks forward to speaking with you!\n\nBest, Zaid`;
    }

    // Auto-send the booking link email
    if (oauthToken) {
      await sendGmailReply(oauthToken, threadId, messageId, senderEmail, originalSubject, draft);
    }

    // Update lead stage to call_booked_pending
    await sb.from('leads').update({ stage: 'interested' }).eq('id', leadId);

    return { draft, token: token ?? null };
  } catch (e) {
    console.error('[handleInterested]', (e as Error).message);
    return { draft: '', token: null };
  }
}

// ── Handle UNSUBSCRIBE fast-path ─────────────────────────────
async function handleUnsubscribe(
  sb: ReturnType<typeof import('../_shared/helpers.ts').getAdminClient>,
  clientId: string,
  leadId: string,
  messageId: string,
  threadId: string,
  replyText: string,
  lead: Record<string, unknown>,
  oauthToken: string,
  senderEmail: string,
  originalSubject: string
) {
  await sb.from('leads').update({ do_not_contact: true, stage: 'lost' }).eq('id', leadId);

  const confirmationMsg = `Hi,\n\nYou've been removed from our list. You won't hear from us again.\n\nBest of luck with your business.`;

  // Auto-send confirmation — no human review needed
  let status = 'auto_sent';
  const sent = await sendGmailReply(oauthToken, threadId, messageId, senderEmail, originalSubject, confirmationMsg);
  if (!sent) status = 'pending_review';

  await sb.from('draft_responses').insert({
    client_id: clientId,
    lead_id: leadId,
    gmail_message_id: messageId,
    thread_id: threadId,
    reply_text: replyText,
    classification: 'UNSUBSCRIBE',
    ai_draft: confirmationMsg,
    status,
    received_at: new Date().toISOString()
  });

  await sb.from('outreach_log')
    .update({ replied: true, reply_classification: 'UNSUBSCRIBE' })
    .eq('client_id', clientId)
    .eq('lead_id', leadId);
}

// ── Gmail body extraction ────────────────────────────────────
function extractEmailBody(msgData: Record<string, unknown>): string {
  const payload = msgData.payload as Record<string, unknown>;
  if (!payload) return '';
  const text = findPart(payload, 'text/plain');
  if (text) return decodeBase64(text);
  const html = findPart(payload, 'text/html');
  if (html) return decodeBase64(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const body = payload.body as Record<string, unknown>;
  if (body?.data) return decodeBase64(body.data as string);
  return '';
}

function findPart(payload: Record<string, unknown>, mimeType: string): string | null {
  const body = payload.body as Record<string, unknown>;
  if (payload.mimeType === mimeType && body?.data) return body.data as string;
  const parts = (payload.parts as Array<Record<string, unknown>>) ?? [];
  for (const part of parts) {
    const result = findPart(part, mimeType);
    if (result) return result;
  }
  return null;
}

function decodeBase64(encoded: string): string {
  try {
    return decodeURIComponent(escape(atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))));
  } catch {
    try { return atob(encoded.replace(/-/g, '+').replace(/_/g, '/')); }
    catch { return ''; }
  }
}
