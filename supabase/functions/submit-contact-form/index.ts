// ============================================================
// AutoFlow v7 — submit-contact-form Edge Function
// Two modes:
//   1. contact_form — HTTP POST to detected form URLs (no Puppeteer in Edge Functions)
//   2. direct_mail  — Lob.com postcard API for score >= 85 leads
// Note: Full Puppeteer form filling requires a separate server process.
//       This function handles HTTP-submittable forms + Lob.com.
// ============================================================

import { getAdminClient, callAI, ok, err, CORS } from '../_shared/helpers.ts';

const LOB_API = 'https://api.lob.com/v1/postcards';
const SCORE_THRESHOLD = 8; // was 85 in detect-channels — stored as 0-10

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const body = await req.json();
  const { client_id, mode, lead_ids } = body;
  if (!client_id || !mode || !lead_ids?.length) return err('client_id, mode, and lead_ids required');
  if (!['contact_form', 'direct_mail'].includes(mode)) return err('mode must be contact_form or direct_mail');

  const sb = getAdminClient();
  const { data: client } = await sb.from('clients').select('*').eq('id', client_id).single();
  if (!client) return err('Client not found', 404);

  const results = [];

  for (const leadId of lead_ids) {
    const { data: lead } = await sb.from('leads').select('*').eq('id', leadId).single();
    if (!lead || lead.do_not_contact) continue;

    try {
      if (mode === 'contact_form') {
        const result = await submitContactForm(sb, client, lead);
        results.push({ lead_id: leadId, mode: 'contact_form', ...result });
      } else {
        const result = await sendDirectMail(sb, client, lead);
        results.push({ lead_id: leadId, mode: 'direct_mail', ...result });
      }
    } catch (e) {
      console.error(`[submit-contact-form] Lead ${leadId}:`, (e as Error).message);
      results.push({ lead_id: leadId, mode, status: 'error', error: (e as Error).message });
    }
  }

  return ok({ processed: results.length, results });
});

// ── Contact Form Submission ─────────────────────────────────
async function submitContactForm(
  sb: ReturnType<typeof import('../_shared/helpers.ts').getAdminClient>,
  client: Record<string, unknown>,
  lead: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const clientId = client.id as string;
  const leadId = lead.id as string;

  // Get contact_form channel for this lead
  const { data: channel } = await sb.from('contact_channels')
    .select('value')
    .eq('lead_id', leadId)
    .eq('channel', 'contact_form')
    .maybeSingle();

  if (!channel?.value) return { status: 'skipped', reason: 'no_contact_form_url' };

  const formUrl = channel.value as string;

  // Skip if already submitted today
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const { count: alreadySent } = await sb.from('outreach_log')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('lead_id', leadId)
    .eq('channel', 'contact_form')
    .gte('sent_at', today.toISOString());

  if ((alreadySent ?? 0) > 0) return { status: 'skipped', reason: 'already_submitted_today' };

  // Generate message copy
  const message = await generateFormMessage(client, lead);

  // Attempt HTTP POST — works for simple contact forms
  // For JS-rendered forms, this will fail gracefully and we log for manual queue
  let submitted = false;
  let errorMsg = '';

  try {
    // First, GET the form page to find form action and fields
    const pageRes = await fetch(formUrl, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' }
    });

    if (pageRes.ok) {
      const html = await pageRes.text();
      const formData = parseContactForm(html, formUrl, message, client);

      if (formData.action) {
        const postRes = await fetch(formData.action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
          body: new URLSearchParams(formData.fields).toString(),
          signal: AbortSignal.timeout(10000)
        });
        submitted = postRes.ok || postRes.status === 302; // 302 redirect = success
      }
    }
  } catch (e) {
    errorMsg = (e as Error).message;
    // JS-rendered or unreachable — add to manual queue
    await sb.from('manual_outreach_queue').upsert({
      client_id: clientId,
      lead_id: leadId,
      channels_json: JSON.stringify({ contact_form: formUrl }),
      dm_script: message,
      status: 'pending',
      notes: `HTTP submit failed: ${errorMsg}`
    }, { onConflict: 'lead_id' });
  }

  if (submitted) {
    await sb.from('outreach_log').insert({
      client_id: clientId,
      lead_id: leadId,
      channel: 'contact_form',
      variation: 'A',
      subject: 'Website inquiry',
      body: message,
      sequence_day: 0,
      sent_at: new Date().toISOString(),
      delivered: true
    });
    return { status: 'submitted', form_url: formUrl };
  }

  return { status: 'queued_manual', reason: errorMsg || 'js_rendered_form', form_url: formUrl };
}

function parseContactForm(
  html: string,
  pageUrl: string,
  message: string,
  client: Record<string, unknown>
): { action: string; fields: Record<string, string> } {
  // Find form action
  const actionMatch = html.match(/<form[^>]*action=["']([^"']*)["'][^>]*>/i);
  let action = actionMatch?.[1] ?? '';
  if (!action) {
    const formMatch = html.match(/<form[^>]*>/i);
    action = pageUrl; // POST to same page
  }
  if (action && !action.startsWith('http')) {
    const base = new URL(pageUrl);
    action = `${base.origin}${action.startsWith('/') ? '' : '/'}${action}`;
  }

  // Common contact form field names
  const fields: Record<string, string> = {};
  const nameFields = ['name', 'your-name', 'full_name', 'fullname', 'contact_name', 'fname'];
  const emailFields = ['email', 'your-email', 'email_address', 'contact_email'];
  const msgFields = ['message', 'your-message', 'msg', 'comment', 'comments', 'body', 'text', 'content'];
  const subjectFields = ['subject', 'your-subject', 'inquiry_subject'];

  // Find actual field names from the HTML
  const inputMatches = html.matchAll(/<input[^>]*name=["']([^"']*)["'][^>]*/gi);
  const textareaMatches = html.matchAll(/<textarea[^>]*name=["']([^"']*)["'][^>]*/gi);

  const allFields: string[] = [];
  for (const m of inputMatches) allFields.push(m[1].toLowerCase());
  for (const m of textareaMatches) allFields.push(m[1].toLowerCase());

  for (const field of allFields) {
    if (nameFields.some(n => field.includes(n))) {
      fields[field] = `${(client.business_name as string) ?? 'Web Design Agency'}`;
    } else if (emailFields.some(n => field.includes(n))) {
      fields[field] = (client.reply_to_email as string) ?? (client.gmail_user as string) ?? '';
    } else if (subjectFields.some(n => field.includes(n))) {
      fields[field] = 'Website redesign inquiry';
    } else if (msgFields.some(n => field.includes(n))) {
      fields[field] = message;
    }
  }

  // Fallbacks if we couldn't parse fields
  if (!Object.keys(fields).length) {
    fields['name'] = (client.business_name as string) ?? 'Web Design Agency';
    fields['email'] = (client.reply_to_email as string) ?? '';
    fields['message'] = message;
  }

  return { action, fields };
}

async function generateFormMessage(
  client: Record<string, unknown>,
  lead: Record<string, unknown>
): Promise<string> {
  const hasAI = (client.gemini_key || client.claude_key || client.openai_key) as string;
  const fallback = `Hi! I came across ${lead.business_name as string} and noticed your website has room to grow. We specialize in websites for ${lead.niche as string} businesses that actually generate phone calls and bookings. I'd love to show you a free mockup — no obligation. Would 15 minutes this week work?`;

  if (!hasAI) return fallback;

  const prompt = `Write a brief, genuine contact form message to ${lead.business_name as string} (${lead.niche as string} in ${lead.city as string}) about website redesign services. Under 80 words. Conversational tone. End with an ask for a 15-minute call. No fluff.`;

  try {
    return await callAI(prompt, 'Write a concise, genuine outreach message.', client as Record<string, string>);
  } catch {
    return fallback;
  }
}

// ── Direct Mail — Lob.com Postcards ─────────────────────────
async function sendDirectMail(
  sb: ReturnType<typeof import('../_shared/helpers.ts').getAdminClient>,
  client: Record<string, unknown>,
  lead: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const clientId = client.id as string;
  const leadId = lead.id as string;
  const lobKey = client.lob_key as string;

  if (!lobKey) return { status: 'skipped', reason: 'no_lob_key' };
  if ((lead.score as number ?? 0) < SCORE_THRESHOLD) return { status: 'skipped', reason: 'score_below_threshold' };
  if (!lead.address) return { status: 'skipped', reason: 'no_address' };

  // Skip if already sent postcard
  const { count: alreadySent } = await sb.from('outreach_log')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('lead_id', leadId)
    .eq('channel', 'direct_mail');

  if ((alreadySent ?? 0) > 0) return { status: 'skipped', reason: 'already_sent' };

  // Build postcard content
  const front = buildPostcardFront(lead);
  const back = buildPostcardBack(lead, client);

  // Send via Lob.com
  const credentials = btoa(`${lobKey}:`);
  const payload = {
    description: `AutoFlow — ${lead.business_name}`,
    to: {
      name: lead.business_name as string,
      address_line1: (lead.address as string).split(',')[0]?.trim() ?? lead.address,
      address_city: lead.city as string,
      address_state: lead.state as string,
      address_zip: (lead.zip as string) ?? '00000',
      address_country: 'US'
    },
    from: {
      name: (client.business_name as string) ?? 'Web Design Agency',
      address_line1: (client.mailing_address as string) ?? '123 Main St',
      address_city: (client.city as string) ?? 'New York',
      address_state: (client.state as string) ?? 'NY',
      address_zip: (client.zip as string) ?? '10001',
      address_country: 'US'
    },
    size: '4x6',
    front: `<html><body style="font-family:Arial;padding:20px;background:#1a237e;color:white"><h1 style="font-size:24px">${front.headline}</h1><p style="font-size:14px">${front.subhead}</p></body></html>`,
    back: `<html><body style="font-family:Arial;padding:20px"><p>${back}</p></body></html>`
  };

  try {
    const res = await fetch(LOB_API, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errData = await res.json();
      return { status: 'failed', error: errData.message };
    }

    const data = await res.json();

    await sb.from('outreach_log').insert({
      client_id: clientId,
      lead_id: leadId,
      channel: 'direct_mail',
      variation: 'A',
      subject: front.headline,
      body: back,
      sequence_day: 0,
      sent_at: new Date().toISOString(),
      delivered: true,
      lob_id: data.id
    });

    return { status: 'sent', lob_id: data.id, expected_delivery: data.expected_delivery_date };
  } catch (e) {
    return { status: 'failed', error: (e as Error).message };
  }
}

function buildPostcardFront(lead: Record<string, unknown>): { headline: string; subhead: string } {
  return {
    headline: `Is Your Website Bringing You New Clients?`,
    subhead: `${lead.business_name as string} — your website could be working a lot harder for you.`
  };
}

function buildPostcardBack(lead: Record<string, unknown>, client: Record<string, unknown>): string {
  return `Hi ${lead.business_name as string},

We help ${lead.niche as string} businesses in ${lead.city as string} get more clients through their website.

Most local business websites are invisible to Google and don't convert visitors. We fix that.

What we offer:
• Modern, mobile-first design
• Local SEO built in
• Free mockup before you commit

Scan the QR code or visit our website to see examples.

${(client.website as string) ?? ''}
${(client.phone as string) ?? ''}

Reply STOP to opt out of future mailings.`;
}
