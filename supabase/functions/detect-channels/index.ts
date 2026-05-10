// ============================================================
// AutoFlow v7 — detect-channels Edge Function
// For no-email leads: find WhatsApp, FB, Instagram, Yelp, LinkedIn,
// contact form URL, phone confirmation — build contact_channels JSON
// ============================================================

import { getAdminClient, ok, err, CORS } from '../_shared/helpers.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const { client_id, lead_ids } = await req.json();
  if (!client_id || !lead_ids?.length) return err('client_id and lead_ids required');

  const sb = getAdminClient();
  const results = [];

  for (const leadId of lead_ids) {
    const { data: lead } = await sb.from('leads').select('*').eq('id', leadId).single();
    if (!lead || lead.do_not_contact) continue;

    const channels: Record<string, string> = {};
    const channelRows = [];

    // ── Phone ────────────────────────────────────────────────
    if (lead.phone) {
      channels.phone = lead.phone;
      channelRows.push({ client_id, lead_id: leadId, channel: 'phone', value: lead.phone, verified: true });

      // WhatsApp — assume available if has phone (common for small businesses)
      const waUrl = `https://wa.me/${lead.phone.replace(/\D/g, '')}`;
      channels.whatsapp = waUrl;
      channelRows.push({ client_id, lead_id: leadId, channel: 'whatsapp', value: waUrl, verified: false });
    }

    // ── Website scraping for social links + contact form ─────
    if (lead.website) {
      try {
        const res = await fetch(lead.website, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (res.ok) {
          const html = await res.text();

          // Facebook
          const fbMatch = html.match(/https?:\/\/(www\.)?(facebook|fb)\.com\/([^"'\s>?#/][^"'\s>?#]{2,})/i);
          if (fbMatch) {
            channels.facebook = fbMatch[0];
            channelRows.push({ client_id, lead_id: leadId, channel: 'facebook', value: fbMatch[0], verified: true });
          }

          // Instagram
          const igMatch = html.match(/https?:\/\/(www\.)?instagram\.com\/([^"'\s>?#/][^"'\s>?#]{2,})/i);
          if (igMatch) {
            channels.instagram = igMatch[0];
            channelRows.push({ client_id, lead_id: leadId, channel: 'instagram', value: igMatch[0], verified: true });
          }

          // LinkedIn
          const liMatch = html.match(/https?:\/\/(www\.)?linkedin\.com\/(company|in)\/([^"'\s>?#/][^"'\s>?#]{2,})/i);
          if (liMatch) {
            channels.linkedin = liMatch[0];
            channelRows.push({ client_id, lead_id: leadId, channel: 'linkedin', value: liMatch[0], verified: true });
          }

          // Yelp
          const yelpMatch = html.match(/https?:\/\/(www\.)?yelp\.com\/biz\/([^"'\s>?#/][^"'\s>?#]{2,})/i);
          if (yelpMatch) {
            channels.yelp = yelpMatch[0];
            channelRows.push({ client_id, lead_id: leadId, channel: 'yelp', value: yelpMatch[0], verified: true });
          }

          // Contact form — look for /contact page link
          const formMatch = html.match(/href=["']([^"']*contact[^"']*)["']/i);
          if (formMatch) {
            const formUrl = formMatch[1].startsWith('http') ? formMatch[1] : `${lead.website}/${formMatch[1].replace(/^\//, '')}`;
            channels.contact_form = formUrl;
            channelRows.push({ client_id, lead_id: leadId, channel: 'contact_form', value: formUrl, verified: false });
          }
        }
      } catch { /* website unreachable — skip */ }
    }

    // ── Yelp search (if not found on website) ────────────────
    if (!channels.yelp) {
      const yelpSearch = `https://www.yelp.com/search?find_desc=${encodeURIComponent(lead.business_name)}&find_loc=${encodeURIComponent(lead.city + ', ' + lead.state)}`;
      channels.yelp_search = yelpSearch;
      channelRows.push({ client_id, lead_id: leadId, channel: 'yelp', value: yelpSearch, verified: false });
    }

    // ── Direct mail — for high-score leads (score 85+) ───────
    if ((lead.score ?? 0) >= 8 && lead.address) {
      channels.direct_mail = lead.address;
      channelRows.push({ client_id, lead_id: leadId, channel: 'direct_mail', value: lead.address, verified: false });
    }

    // ── Save contact_channels rows ───────────────────────────
    if (channelRows.length > 0) {
      await sb.from('contact_channels')
        .upsert(channelRows, { onConflict: 'lead_id,channel' });
    }

    // ── Create manual outreach queue entry ───────────────────
    // Only if we found at least one social channel
    const hasSocial = channels.facebook || channels.instagram || channels.linkedin || channels.whatsapp;
    if (hasSocial) {
      const dmScript = generateDMScript(lead);
      await sb.from('manual_outreach_queue').upsert({
        client_id, lead_id: leadId,
        channels_json: JSON.stringify(channels),
        dm_script: dmScript,
        status: 'pending'
      }, { onConflict: 'lead_id' });
    }

    results.push({ lead_id: leadId, channels_found: Object.keys(channels).length });
  }

  return ok({ processed: results.length, results });
});

function generateDMScript(lead: Record<string, unknown>): string {
  return `Hi! I came across ${lead.business_name as string} and noticed your website could be driving a lot more customers to you.

We specialize in redesigning websites for ${lead.niche as string} businesses — the kind that actually brings in phone calls and bookings.

Quick question: are you happy with how many new clients your website is bringing you right now?

I'd love to show you what we'd do with your site — no cost, no pressure. Would 15 minutes this week work?`;
}
