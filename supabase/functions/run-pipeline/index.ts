// ============================================================
// AutoFlow v7 — run-pipeline Edge Function
// The 13-node pipeline: Victor → Maya → Marcus → Filter →
// Sofia → Aria → James → Leo → Email Hunter → Deploy → Elena → Priya → Raj → Theo
// ============================================================

import { getAdminClient, callAI, updateRun, rajDiagnose, ok, err, CORS } from '../_shared/helpers.ts';

const DAILY_CAP = 20; // Twin pattern: hard cap

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const { run_id, client_id, city, state, niche, auto_mode } = await req.json();
  if (!run_id || !client_id) return err('run_id and client_id required');

  const sb = getAdminClient();

  // Load client (AI keys, credentials)
  const { data: client } = await sb.from('clients').select('*').eq('id', client_id).single();
  if (!client) return err('Client not found', 404);

  // Check AI key
  const hasAI = client.gemini_key || client.claude_key || client.openai_key;
  if (!hasAI) {
    await updateRun(sb, run_id, { status: 'error', error_message: 'No AI key configured. Add a key in Credentials.' });
    return err('No AI key');
  }

  // Run pipeline async (don't await — respond immediately, updates come via Realtime)
  runPipeline(sb, run_id, client_id, client, { city, state, niche, auto_mode }).catch(async (e) => {
    console.error('[run-pipeline] fatal:', e.message);
    await updateRun(sb, run_id, { status: 'error', error_message: e.message });
  });

  return ok({ started: true, run_id });
});

async function runPipeline(sb: ReturnType<typeof getAdminClient>, runId: string, clientId: string, client: Record<string, unknown>, params: Record<string, unknown>) {
  let { city, state, niche } = params as { city: string; state: string; niche: string };

  const progress = async (node: string, extra?: Record<string, unknown>) => {
    await updateRun(sb, runId, { current_node: node, status: 'running', ...extra });
  };

  try {
    // ── NODE 1: Victor — campaign strategy ──────────────────
    await progress('Victor');
    const victorBrief = await callAI(
      `You are Victor, the CEO of an AI web agency. Create a brief campaign strategy for finding businesses in ${city}, ${state} in the ${niche} niche that need website redesigns. Include: target business profile, key pain points, competitive angle, and 3 discovery questions to use in outreach. Return JSON: {"profile":"...","pain_points":["..."],"angle":"...","discovery_questions":["...","...","..."]}`,
      'You are Victor, a strategic CEO. Return only valid JSON.',
      client as Record<string, string>
    );

    let strategy: Record<string, unknown> = {};
    try { strategy = JSON.parse(victorBrief); } catch { strategy = { angle: victorBrief }; }

    // ── NODE 2: Maya — market intel ─────────────────────────
    await progress('Maya');
    const mayaResearch = await callAI(
      `You are Maya, a market intelligence specialist. Research the ${niche} market in ${city}, ${state}. Analyze: competition levels, average website quality, typical revenue, digital marketing adoption. Return JSON: {"market_size":"...","competition":"low|medium|high","avg_web_quality":"poor|fair|good","opportunity_score":1-10,"notes":"..."}`,
      'You are Maya, market intel specialist. Return only valid JSON.',
      client as Record<string, string>
    );
    let market: Record<string, unknown> = {};
    try { market = JSON.parse(mayaResearch); } catch { market = {}; }

    // ── NODE 3: Marcus — lead acquisition via Places ─────────
    await progress('Marcus');
    const placesKey = client.places_key as string;
    if (!placesKey) throw new Error('places_key missing');

    const placesRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': placesKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount'
      },
      body: JSON.stringify({ textQuery: `${niche} in ${city}, ${state}`, maxResultCount: 20 })
    });

    if (!placesRes.ok) {
      if (placesRes.status === 429) throw new Error('places_quota_exceeded');
      throw new Error(`Places API ${placesRes.status}`);
    }

    const placesData = await placesRes.json();
    const rawLeads = (placesData.places ?? []).map((p: Record<string, unknown>) => {
      const display = p.displayName as Record<string, string>;
      return {
        client_id: clientId,
        place_id: p.id as string,
        business_name: display?.text ?? '',
        address: p.formattedAddress as string ?? '',
        city, state, niche,
        niche_normalized: normalizeNiche(niche),
        phone: p.nationalPhoneNumber as string ?? null,
        website: p.websiteUri as string ?? null,
        google_rating: (p.rating as number) ?? null,
        review_count: (p.userRatingCount as number) ?? 0,
      };
    });

    if (rawLeads.length === 0) {
      await updateRun(sb, runId, { status: 'completed_empty', leads_found: 0, completed_at: new Date().toISOString() });
      return;
    }

    // INSERT OR IGNORE duplicates (Twin pattern via onConflict)
    const { data: insertedLeads } = await sb.from('leads')
      .upsert(rawLeads, { onConflict: 'client_id,place_id', ignoreDuplicates: true })
      .select();

    await updateRun(sb, runId, { leads_found: rawLeads.length });

    // ── NODE 4: Filter — qualify leads ───────────────────────
    await progress('Filter');
    const leads = insertedLeads ?? [];
    const qualifiedLeads = [];

    for (const lead of leads) {
      try {
        const filterResult = await callAI(
          `Score this ${niche} business for website redesign potential (1-10). Business: ${lead.business_name}, ${lead.city}, Rating: ${lead.google_rating ?? 'unknown'} (${lead.review_count ?? 0} reviews), Has website: ${!!lead.website}. Score 6+ = qualify. Return JSON: {"score":7,"reason":"...","qualify":true}`,
          'You are Filter, a lead qualifier. Return only valid JSON.',
          client as Record<string, string>
        );
        let scored: Record<string, unknown> = {};
        try { scored = JSON.parse(filterResult); } catch { scored = { score: 5, qualify: false }; }
        const score = (scored.score as number) ?? 5;
        const qualify = score >= 6;
        await sb.from('leads').update({ score, qualify, score_reason: scored.reason as string }).eq('id', lead.id);
        if (qualify) qualifiedLeads.push({ ...lead, score });
      } catch { /* skip failed scoring */ }
    }

    await updateRun(sb, runId, { leads_qualified: qualifiedLeads.length });
    if (qualifiedLeads.length === 0) {
      await updateRun(sb, runId, { status: 'completed_empty', completed_at: new Date().toISOString() });
      return;
    }

    // ── NODE 5: Sofia — website redesign concept ─────────────
    await progress('Sofia');
    for (const lead of qualifiedLeads.slice(0, 5)) { // Top 5 only
      try {
        const sofiaHTML = await callAI(
          `You are Sofia, a web designer. Write a brief website redesign concept for ${lead.business_name} (${niche} in ${city}). Include: hero section copy, 3 key sections, CTA. Keep under 200 words.`,
          'You are Sofia, a web designer. Be concise and compelling.',
          client as Record<string, string>
        );
        await sb.from('websites').upsert({ client_id: clientId, lead_id: lead.id, html_content: sofiaHTML, deploy_status: 'pending' }, { onConflict: 'lead_id' });
      } catch { /* non-blocking */ }
    }

    // ── NODE 6: Aria — competitor intel ──────────────────────
    await progress('Aria');
    // Aria does lightweight analysis — no external API needed
    const ariaContext = await callAI(
      `You are Aria, a competitor intelligence specialist. In 2 sentences, describe what ${niche} businesses in ${city}, ${state} typically do wrong with their websites based on industry patterns. This will be used to personalize outreach.`,
      'You are Aria. Be specific and actionable. 2 sentences max.',
      client as Record<string, string>
    );

    // ── NODE 7: James — email copy ───────────────────────────
    await progress('James');
    const emailDrafts: Record<string, { subject: string; body: string }> = {};
    const variations = ['A', 'B', 'C'];
    const copyAngles = [
      `Direct value: focus on ROI and new customers they'll get`,
      `Pain-point: focus on what they're losing with a bad website`,
      `Social proof: focus on results achieved for similar ${niche} businesses`
    ];

    for (let i = 0; i < 3; i++) {
      const v = variations[i];
      const angle = copyAngles[i];
      try {
        const copy = await callAI(
          `You are James, an expert email copywriter. Write a cold outreach email for a ${niche} business in ${city}. Angle: ${angle}. Context: ${ariaContext}. Discovery questions to weave in naturally: ${JSON.stringify((strategy as Record<string, unknown[]>).discovery_questions ?? [])}. Keep subject under 8 words. Body under 120 words. Return JSON: {"subject":"...","body":"..."}`,
          'You are James. Return only valid JSON with subject and body keys.',
          client as Record<string, string>
        );
        try { emailDrafts[v] = JSON.parse(copy); } catch { emailDrafts[v] = { subject: `Quick question about ${niche} in ${city}`, body: copy }; }
      } catch { emailDrafts[v] = { subject: `Your ${niche} website`, body: `Hi, I noticed your website...` }; }
    }

    // ── NODE 8: Leo — social proof ───────────────────────────
    await progress('Leo');
    const leoHook = await callAI(
      `You are Leo, a social proof specialist. Write one powerful sentence of social proof to add to the end of a cold email to ${niche} businesses in ${city}. Reference a realistic result (e.g. "We helped a similar ${niche} in Texas get 12 new clients in 60 days"). One sentence only.`,
      'You are Leo. One sentence. Make it believable and specific.',
      client as Record<string, string>
    );

    // Append Leo's hook to each variant
    for (const v of variations) {
      if (emailDrafts[v]) emailDrafts[v].body += `\n\n${leoHook}`;
    }

    // ── NODE 9: Email Hunter ─────────────────────────────────
    await progress('Email Hunter');
    let emailsFound = 0;
    const hunterKey = client.hunter_key as string;
    const apolloKey = client.apollo_key as string;

    for (const lead of qualifiedLeads) {
      if (!lead.website) continue;
      const domain = new URL(lead.website).hostname.replace('www.', '');

      // Hunter first
      let emailResult = null;
      if (hunterKey) {
        try {
          const hRes = await fetch(`https://api.hunter.io/v2/domain-search?domain=${domain}&api_key=${hunterKey}&limit=5`);
          if (hRes.ok) {
            const hData = await hRes.json();
            const emails = (hData.data?.emails ?? []).filter((e: Record<string, unknown>) =>
              e.value && !(e.value as string).startsWith('noreply@') && !(e.value as string).startsWith('info@') && (e.confidence as number) >= 50
            ).sort((a: Record<string, unknown>, b: Record<string, unknown>) => (b.confidence as number) - (a.confidence as number));
            if (emails[0]) {
              const conf = (emails[0].confidence as number);
              emailResult = {
                email: emails[0].value as string,
                email_confidence: conf >= 80 ? 'high' : conf >= 60 ? 'medium' : 'low',
                email_source: 'hunter'
              };
            }
          }
        } catch { /* try Apollo */ }
      }

      // Apollo fallback
      if (!emailResult && apolloKey) {
        try {
          const aRes = await fetch('https://api.apollo.io/v1/people/match', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: apolloKey, organization_name: lead.business_name, domain })
          });
          if (aRes.ok) {
            const aData = await aRes.json();
            if (aData.person?.email) {
              emailResult = { email: aData.person.email, email_confidence: 'medium', email_source: 'apollo' };
            }
          }
        } catch { /* no email found */ }
      }

      if (emailResult) {
        await sb.from('leads').update(emailResult).eq('id', lead.id);
        emailsFound++;
      }
    }

    await updateRun(sb, runId, { emails_found: emailsFound });

    // No-email leads → trigger detect-channels
    const noEmailLeads = qualifiedLeads.filter(l => !l.email);
    if (noEmailLeads.length > 0) {
      await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/detect-channels`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, lead_ids: noEmailLeads.map((l: Record<string, string>) => l.id) })
      });
    }

    // ── NODE 10: Deploy — Vercel ────────────────────────────
    await progress('Deploy');
    const vercelToken = client.vercel_token as string;
    if (vercelToken) {
      const { data: pendingWebsites } = await sb.from('websites').select('*, leads(business_name)').eq('client_id', clientId).eq('deploy_status', 'pending').limit(3);
      for (const site of pendingWebsites ?? []) {
        try {
          const name = (site.leads as Record<string, string>)?.business_name?.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') ?? 'af-site';
          const dRes = await fetch('https://api.vercel.com/v13/deployments', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${vercelToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: `af-${name}`, files: [{ file: 'index.html', data: site.html_content }], projectSettings: { framework: null } })
          });
          if (dRes.ok) {
            const dData = await dRes.json();
            await sb.from('websites').update({ deploy_status: 'deployed', vercel_url: `https://${dData.url}` }).eq('id', site.id);
          }
        } catch { await sb.from('websites').update({ deploy_status: 'failed' }).eq('id', site.id); }
      }
    }

    // ── NODE 11: Elena — first-batch approval ───────────────
    await progress('Elena');
    const emailLeads = qualifiedLeads.filter(l => l.email);

    // HUMAN TOUCHPOINT #1: Pause for approval before any email sends
    // Write approval-pending records and set run status to paused
    const approvalDrafts = [];
    for (const lead of emailLeads.slice(0, DAILY_CAP)) {
      const variation = (['A','B','C'] as const)[Math.floor(Math.random() * 3)];
      const draft = emailDrafts[variation] ?? emailDrafts['A'];
      approvalDrafts.push({
        client_id: clientId,
        lead_id: lead.id,
        channel: 'email',
        variation,
        subject: draft?.subject ?? `Your ${niche} website`,
        body: (draft?.body ?? '').replace(/{business_name}/g, lead.business_name).replace(/{city}/g, city).replace(/{niche}/g, niche),
        sequence_day: 0,
        sent_at: null // not sent yet — waiting for approval
      });
    }

    // Store drafts as outreach_log rows with a NULL sent_at (pending)
    // Admin approves → sent_at is set → Elena actually sends
    await sb.from('outreach_log').insert(approvalDrafts.map(d => ({ ...d, delivered: false })));
    await updateRun(sb, runId, { status: 'paused_approval' });

    // The pipeline stops here. Admin approves via pipeline-manager.html.
    // After approval, the follow-up-engine handles Day 3/7/14.
    return;

  } catch (e: unknown) {
    const error = e as Error;
    // ── NODE 13: Raj — error recovery ───────────────────────
    await updateRun(sb, runId, { current_node: 'Raj' });
    const fix = await rajDiagnose(sb, error, runId);
    console.error('[Raj] Error:', error.message, '| Fix:', fix);
    await updateRun(sb, runId, {
      status: 'error',
      error_message: fix ? `${error.message} — Raj: ${fix}` : error.message,
      completed_at: new Date().toISOString()
    });
  }
}

// Twin: normalize niche for analytics grouping
function normalizeNiche(niche: string): string {
  const map: Record<string, string> = {
    dentist: 'Healthcare', dental: 'Healthcare', orthodontist: 'Healthcare',
    plumber: 'Home Services', hvac: 'Home Services', electrician: 'Home Services', landscaper: 'Home Services',
    restaurant: 'Food & Beverage', cafe: 'Food & Beverage', bakery: 'Food & Beverage',
    lawyer: 'Legal', attorney: 'Legal', law: 'Legal',
    gym: 'Fitness', fitness: 'Fitness', yoga: 'Fitness',
    salon: 'Beauty', barber: 'Beauty', spa: 'Beauty',
    realtor: 'Real Estate', 'real estate': 'Real Estate',
    accountant: 'Finance', insurance: 'Finance',
  };
  const lower = niche.toLowerCase();
  for (const [key, value] of Object.entries(map)) {
    if (lower.includes(key)) return value;
  }
  return niche;
}
