// ============================================================
// AutoFlow v7 — send-sms Edge Function
// Called from run-pipeline for leads with phone but no email
// Twilio API — 160 char limit, mandatory STOP opt-out footer
// STOP reply → do_not_contact = true immediately
// ============================================================

import { getAdminClient, ok, err, CORS } from '../_shared/helpers.ts';

const MAX_BODY = 140; // Leave 20 chars for opt-out footer

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const body = await req.json();
  const { client_id, lead_ids } = body;
  if (!client_id || !lead_ids?.length) return err('client_id and lead_ids required');

  const sb = getAdminClient();

  // Get client with Twilio credentials
  const { data: client } = await sb
    .from('clients')
    .select('id, twilio_sid, twilio_token, twilio_from, daily_email_cap')
    .eq('id', client_id)
    .single();

  if (!client) return err('Client not found', 404);
  if (!client.twilio_sid || !client.twilio_token || !client.twilio_from) {
    return err('Twilio credentials not configured');
  }

  // Daily cap check (shared with email cap)
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const { count: todayCount } = await sb.from('outreach_log')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', client_id)
    .gte('sent_at', today.toISOString());

  const cap = (client.daily_email_cap as number) ?? 20;
  let remaining = cap - (todayCount ?? 0);
  if (remaining <= 0) return ok({ sent: 0, reason: 'daily_cap_reached' });

  const results = [];

  for (const leadId of lead_ids) {
    if (remaining <= 0) break;

    const { data: lead } = await sb.from('leads').select('*').eq('id', leadId).single();
    if (!lead || lead.do_not_contact || !lead.phone) continue;

    // Skip if already sent SMS today
    const { count: alreadySent } = await sb.from('outreach_log')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client_id)
      .eq('lead_id', leadId)
      .eq('channel', 'sms')
      .gte('sent_at', today.toISOString());

    if ((alreadySent ?? 0) > 0) continue;

    // Build SMS body
    const msgBody = buildSmsBody(lead);
    const phone = normalizePhone(lead.phone as string);
    if (!phone) continue;

    // Send via Twilio
    const result = await sendTwilioSms(client, phone, msgBody);

    if (result.success) {
      await sb.from('outreach_log').insert({
        client_id,
        lead_id: leadId,
        channel: 'sms',
        variation: 'A',
        body: msgBody,
        subject: 'SMS',
        sequence_day: 0,
        sent_at: new Date().toISOString(),
        delivered: true,
        twilio_sid: result.sid
      });
      remaining--;
      results.push({ lead_id: leadId, status: 'sent', phone });
    } else {
      results.push({ lead_id: leadId, status: 'failed', error: result.error });
    }
  }

  return ok({ sent: results.filter(r => r.status === 'sent').length, results });
});

function buildSmsBody(lead: Record<string, unknown>): string {
  const name = (lead.business_name as string).slice(0, 30);
  // Craft message under MAX_BODY chars
  const core = `Hi! I build websites for ${lead.niche as string} businesses. Is yours bringing in new clients? I'd love to show you what's possible — free mockup.`;
  const truncated = core.length > MAX_BODY ? core.slice(0, MAX_BODY - 1) + '…' : core;
  return `${truncated}\nReply STOP to opt out`;
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length > 10) return `+${digits}`;
  return null; // Invalid
}

async function sendTwilioSms(
  client: Record<string, unknown>,
  to: string,
  body: string
): Promise<{ success: boolean; sid?: string; error?: string }> {
  const sid = client.twilio_sid as string;
  const token = client.twilio_token as string;
  const from = client.twilio_from as string;

  const credentials = btoa(`${sid}:${token}`);
  const formData = new URLSearchParams({ To: to, From: from, Body: body });

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData.toString()
    });

    if (!res.ok) {
      const errData = await res.json();
      console.error('[send-sms] Twilio error:', errData.message);
      return { success: false, error: errData.message };
    }

    const data = await res.json();
    return { success: true, sid: data.sid };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

// ── Webhook endpoint: Twilio STOP handling ─────────────────
// Supabase function also handles incoming SMS webhooks from Twilio
// Set Twilio SMS webhook URL to this function's URL with ?webhook=true
export async function handleWebhook(req: Request): Promise<Response> {
  const sb = getAdminClient();
  const text = await req.text();
  const params = new URLSearchParams(text);

  const from = params.get('From') ?? '';
  const body = (params.get('Body') ?? '').trim().toUpperCase();

  // STOP / STOPALL / UNSUBSCRIBE / CANCEL / END / QUIT = opt-out
  const stopWords = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];
  if (stopWords.includes(body)) {
    const normalizedFrom = from.replace(/\D/g, '');

    // Find lead by phone
    const { data: lead } = await sb.from('leads')
      .select('id')
      .or(`phone.eq.${from},phone.eq.+${normalizedFrom},phone.eq.${normalizedFrom}`)
      .maybeSingle();

    if (lead) {
      await sb.from('leads').update({ do_not_contact: true }).eq('id', lead.id);
      console.log(`[send-sms] STOP from ${from} — lead ${lead.id} marked do_not_contact`);
    }

    // Twilio requires a TwiML response for webhooks
    return new Response('<Response></Response>', {
      headers: { 'Content-Type': 'application/xml' }
    });
  }

  return new Response('<Response></Response>', {
    headers: { 'Content-Type': 'application/xml' }
  });
}
