// ============================================================
// AutoFlow v7 — reply-classifier Edge Function
// Runs every 30 min (scheduled via Supabase cron)
// Reads Gmail replies → 6-category LLM classification
// INTERESTED / QUESTION / OBJECTION / NOT_INTERESTED / OUT_OF_OFFICE / UNSUBSCRIBE
// Creates draft_responses row, never auto-replies
// ============================================================

import { getAdminClient, callAI, callAIQuality, ok, err, CORS } from '../_shared/helpers.ts';

const CATEGORIES = ['INTERESTED', 'QUESTION', 'OBJECTION', 'NOT_INTERESTED', 'OUT_OF_OFFICE', 'UNSUBSCRIBE'] as const;
type Category = typeof CATEGORIES[number];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const sb = getAdminClient();

  // Process all active clients
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

  // Fetch unread replies from Gmail — messages with label INBOX, after our threads
  // Query: is:unread in:inbox newer_than:1d
  const query = encodeURIComponent('is:unread in:inbox newer_than:1d');
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
      // Check if this thread matches one of our outreach threads
      const { data: outreachRow } = await sb.from('outreach_log')
        .select('id, lead_id, sequence_day, variation, subject')
        .eq('client_id', clientId)
        .eq('thread_id', msg.threadId)
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!outreachRow) continue; // Not our thread

      // Check if we already classified this message
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

      // Get lead info
      const { data: lead } = await sb.from('leads').select('*')
        .eq('id', outreachRow.lead_id).single();
      if (!lead) continue;

      // Mark as read
      await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}/modify`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${oauthToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ removeLabelIds: ['UNREAD'] })
        }
      );

      // ── Handle UNSUBSCRIBE without AI (keyword check first) ──
      const lower = replyText.toLowerCase();
      if (lower.includes('unsubscribe') || lower.includes('stop') || lower.trim() === 'stop' || lower.includes('remove me')) {
        await handleUnsubscribe(sb, clientId, outreachRow.lead_id, msg.id, msg.threadId, replyText, lead);
        classified++;
        continue;
      }

      // ── LLM Classification ───────────────────────────────────
      const category = await classifyReply(client, lead, replyText, outreachRow);
      const aiDraft = await generateDraft(client, lead, replyText, category, outreachRow);

      // Save draft_responses row (Human Touchpoint #2: admin reviews in pipeline-manager)
      await sb.from('draft_responses').insert({
        client_id: clientId,
        lead_id: outreachRow.lead_id,
        outreach_log_id: outreachRow.id,
        gmail_message_id: msg.id,
        thread_id: msg.threadId,
        reply_text: replyText,
        classification: category,
        ai_draft: aiDraft,
        status: 'pending_review',
        received_at: new Date().toISOString()
      });

      // Mark outreach_log row as replied
      await sb.from('outreach_log')
        .update({ replied: true, reply_classification: category })
        .eq('id', outreachRow.id);

      // For NOT_INTERESTED: set do_not_contact if definitive
      if (category === 'NOT_INTERESTED') {
        const definitive = lower.includes('not interested') || lower.includes('no thank') ||
          lower.includes('don\'t contact') || lower.includes('do not contact') || lower.includes('leave us alone');
        if (definitive) {
          await sb.from('leads').update({ do_not_contact: true }).eq('id', outreachRow.lead_id);
        }
      }

      classified++;

    } catch (e) {
      console.error('[reply-classifier] Message error:', (e as Error).message);
    }
  }

  return classified;
}

async function classifyReply(
  client: Record<string, unknown>,
  lead: Record<string, unknown>,
  replyText: string,
  outreach: Record<string, unknown>
): Promise<Category> {
  const prompt = `Classify this email reply into exactly one category.

Business: ${lead.business_name} (${lead.niche}, ${lead.city})
Original email was about: website redesign services
Reply text:
"""
${replyText.slice(0, 800)}
"""

Categories:
- INTERESTED: wants to learn more, asks about pricing, availability, next steps, agrees to call
- QUESTION: has specific questions before deciding
- OBJECTION: has concerns but hasn't ruled it out (too busy, timing, budget concern)
- NOT_INTERESTED: politely or bluntly declines, already has someone, not needed
- OUT_OF_OFFICE: auto-reply, away message, vacation, will return date
- UNSUBSCRIBE: wants to be removed, stop emails, opt out

Respond with ONLY the category name, nothing else.`;

  const hasAI = (client.gemini_key || client.claude_key || client.openai_key) as string;
  if (!hasAI) return inferCategory(replyText);

  try {
    const raw = await callAI(prompt, 'Return only the category name.', client as Record<string, string>, 'quality');
    const cat = raw.trim().toUpperCase() as Category;
    if (CATEGORIES.includes(cat)) return cat;
    return inferCategory(replyText);
  } catch {
    return inferCategory(replyText);
  }
}

function inferCategory(text: string): Category {
  const lower = text.toLowerCase();
  if (lower.includes('unsubscribe') || lower.includes('stop') || lower.includes('remove')) return 'UNSUBSCRIBE';
  if (lower.includes('out of office') || lower.includes('away') || lower.includes('vacation') || lower.includes('return')) return 'OUT_OF_OFFICE';
  if (lower.includes('not interested') || lower.includes('no thank') || lower.includes('already have')) return 'NOT_INTERESTED';
  if (lower.includes('how much') || lower.includes('price') || lower.includes('cost') || lower.includes('tell me more')) return 'INTERESTED';
  if (lower.includes('?')) return 'QUESTION';
  return 'QUESTION';
}

async function generateDraft(
  client: Record<string, unknown>,
  lead: Record<string, unknown>,
  replyText: string,
  category: Category,
  outreach: Record<string, unknown>
): Promise<string> {
  const draftInstructions: Record<Category, string> = {
    INTERESTED: `Write a 3-sentence reply confirming their interest. Suggest 2-3 specific time slots this week for a 15-min call. End with your name placeholder [YOUR NAME]. Under 80 words.`,
    QUESTION: `Answer their question directly and briefly. Then invite them to a 15-min call. Under 100 words.`,
    OBJECTION: `Acknowledge their concern, reframe briefly with one relevant fact. Offer a no-commitment 10-min chat. Under 80 words.`,
    NOT_INTERESTED: `Send a gracious 1-sentence closing that leaves the door open. No pitch. Under 30 words.`,
    OUT_OF_OFFICE: `Do not reply yet — schedule follow-up for when they return if date mentioned. If no return date, set reminder for 5 days. Return empty string.`,
    UNSUBSCRIBE: `Confirm removal in one sentence. Do not pitch. Under 20 words.`
  };

  const hasAI = (client.gemini_key || client.claude_key || client.openai_key) as string;
  if (!hasAI || category === 'OUT_OF_OFFICE') return '';

  const prompt = `You are replying on behalf of a web design agency to ${lead.business_name as string}.

Their reply: "${replyText.slice(0, 400)}"
Classification: ${category}

${draftInstructions[category]}

Return ONLY the email body text, no subject line.`;

  try {
    return await callAIQuality(prompt, 'Write a professional, concise email reply.', client as Record<string, string>);
  } catch {
    return '';
  }
}

async function handleUnsubscribe(
  sb: ReturnType<typeof import('../_shared/helpers.ts').getAdminClient>,
  clientId: string,
  leadId: string,
  messageId: string,
  threadId: string,
  replyText: string,
  lead: Record<string, unknown>
) {
  // Set do_not_contact immediately — no AI, no delay
  await sb.from('leads').update({ do_not_contact: true }).eq('id', leadId);

  // Save draft with unsubscribe confirmation (admin can send or it auto-sends)
  await sb.from('draft_responses').insert({
    client_id: clientId,
    lead_id: leadId,
    gmail_message_id: messageId,
    thread_id: threadId,
    reply_text: replyText,
    classification: 'UNSUBSCRIBE',
    ai_draft: `Hi ${(lead.business_name as string).split(' ')[0]},\n\nYou've been removed from our list. No further emails.\n\nBest,\n[YOUR NAME]`,
    status: 'pending_review',
    received_at: new Date().toISOString()
  });

  // Mark all outreach for this lead as replied
  await sb.from('outreach_log')
    .update({ replied: true, reply_classification: 'UNSUBSCRIBE' })
    .eq('client_id', clientId)
    .eq('lead_id', leadId);
}

function extractEmailBody(msgData: Record<string, unknown>): string {
  const payload = msgData.payload as Record<string, unknown>;
  if (!payload) return '';

  // Try plain text part first
  const text = findPart(payload, 'text/plain');
  if (text) return decodeBase64(text);

  // Fall back to HTML, strip tags
  const html = findPart(payload, 'text/html');
  if (html) return decodeBase64(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

  // Direct body
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
    return atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return '';
  }
}
