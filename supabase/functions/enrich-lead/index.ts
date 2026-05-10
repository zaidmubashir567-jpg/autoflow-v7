// ============================================================
// AutoFlow v7 — enrich-lead Edge Function
// Triggered by DB INSERT on leads table (or called directly from run-pipeline)
// Hunter.io + Apollo.io in parallel → confidence scoring → route no-email leads
// ============================================================

import { getAdminClient, ok, err, CORS } from '../_shared/helpers.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const { lead_id, client_id } = await req.json();
  if (!lead_id || !client_id) return err('lead_id and client_id required');

  const sb = getAdminClient();
  const { data: lead } = await sb.from('leads').select('*').eq('id', lead_id).single();
  if (!lead) return err('Lead not found', 404);

  // Skip if already has email or is do_not_contact
  if (lead.email || lead.do_not_contact) return ok({ skipped: true, reason: lead.email ? 'already_has_email' : 'do_not_contact' });

  const { data: client } = await sb.from('clients').select('hunter_key, apollo_key').eq('id', client_id).single();
  if (!client) return err('Client not found', 404);

  let emailResult: Record<string, string> | null = null;

  // ─── Hunter.io ───────────────────────────────────────────
  if (client.hunter_key && lead.website) {
    try {
      const domain = new URL(lead.website).hostname.replace('www.', '');
      const BLOCKED = ['wix.com', 'squarespace.com', 'wordpress.com', 'weebly.com', 'godaddy.com'];
      const isBlocked = BLOCKED.some(b => domain.includes(b));

      if (!isBlocked) {
        const res = await fetch(`https://api.hunter.io/v2/domain-search?domain=${domain}&api_key=${client.hunter_key}&limit=5`);
        if (res.status === 429) {
          // Rate limited — save to error library
          await sb.from('error_library').upsert({ error_signature: 'hunter_rate_limit', error_message: 'Hunter.io 429', fix_applied: 'Queue remaining, retry after 60s', times_applied: 1, last_applied_at: new Date().toISOString() }, { onConflict: 'error_signature' });
        } else if (res.ok) {
          const data = await res.json();
          const validEmails = (data.data?.emails ?? [])
            .filter((e: Record<string, unknown>) =>
              e.value && !(e.value as string).match(/^(noreply|no-reply|info|contact|support|hello|admin)@/) && (e.confidence as number) >= 50
            )
            .sort((a: Record<string, unknown>, b: Record<string, unknown>) => (b.confidence as number) - (a.confidence as number));

          if (validEmails[0]) {
            const conf = validEmails[0].confidence as number;
            emailResult = {
              email: validEmails[0].value as string,
              email_confidence: conf >= 80 ? 'high' : conf >= 60 ? 'medium' : 'low',
              email_source: 'hunter'
            };
          }
        }
      }
    } catch (e) { console.error('[enrich] Hunter error:', (e as Error).message); }
  }

  // ─── Apollo.io fallback ──────────────────────────────────
  if (!emailResult && client.apollo_key) {
    try {
      const domain = lead.website ? new URL(lead.website).hostname.replace('www.', '') : null;
      const res = await fetch('https://api.apollo.io/v1/people/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: client.apollo_key,
          organization_name: lead.business_name,
          ...(domain ? { domain } : {})
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.person?.email) {
          emailResult = { email: data.person.email, email_confidence: 'medium', email_source: 'apollo' };
        }
      }
    } catch (e) { console.error('[enrich] Apollo error:', (e as Error).message); }
  }

  if (emailResult) {
    await sb.from('leads').update(emailResult).eq('id', lead_id);
    return ok({ found: true, source: emailResult.email_source, confidence: emailResult.email_confidence });
  }

  // No email found — trigger detect-channels
  await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/detect-channels`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id, lead_ids: [lead_id] })
  });

  return ok({ found: false, routed_to: 'detect-channels' });
});
