// ============================================================
// AutoFlow v7 — shared/api.js
// All external API wrappers: Places, Hunter, Apollo, Gmail, Twilio, Lob, Vercel
// Used by Edge Functions (server-side) and some admin pages (browser-side)
// ============================================================

// ─── CLAUDE — EXCLUSIVE AI ENGINE ──────────────────────────
// All 15 pipeline personas run on Claude.
// Two tiers:
//   claude-haiku-4-5-20251001  → bulk tasks: email copy, follow-ups, scoring (fast + cheap ~$0.0003/call)
//   claude-sonnet-4-6          → quality tasks: reply drafts, proposals, analysis (~$0.003/call)
// Model selected automatically by task tier. No other AI needed.

const CLAUDE_MODELS = {
  fast:    'claude-haiku-4-5-20251001',  // bulk: email copy, follow-ups, lead scoring
  quality: 'claude-sonnet-4-6'           // quality: reply drafts, proposals, learn engine
};

// callAI — the main entry point for all 15 personas
// tier: 'fast' (default) or 'quality'
export async function callAI(prompt, sys = '', tier = 'fast', apiKeys = {}) {
  const apiKey = apiKeys.claude;
  if (!apiKey) throw new Error('Claude API key not configured. Add it in Settings → Connected Accounts.');
  return callClaude(prompt, sys, CLAUDE_MODELS[tier] ?? CLAUDE_MODELS.fast, apiKey);
}

// Backward-compat aliases — all existing pipeline nodes work unchanged
export const gemini = (prompt, sys, _ignored, apiKeys) => callAI(prompt, sys, 'fast', apiKeys);

async function callClaude(prompt, sys, model, apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-allow-browser': 'true'
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      ...(sys ? { system: sys } : {}),
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Claude ${res.status}: ${err.error?.message ?? res.statusText}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text ?? '';
}

// Quality-tier helper — use for reply drafts, proposals, learn engine
export async function callAIQuality(prompt, sys = '', apiKeys = {}) {
  return callAI(prompt, sys, 'quality', apiKeys);
}

// ─── GOOGLE PLACES (v1 — new endpoint) ──────────────────────
// Use: searchPlaces('dentists', 'Austin', 'TX', token, apiKey)
export async function searchPlaces(niche, city, state, oauthToken, apiKey) {
  const url = 'https://places.googleapis.com/v1/places:searchText';
  const headers = {
    'Content-Type': 'application/json',
    'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount'
  };

  if (oauthToken) {
    headers['Authorization'] = `Bearer ${oauthToken}`;
  } else {
    headers['X-Goog-Api-Key'] = apiKey;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ textQuery: `${niche} in ${city}, ${state}`, maxResultCount: 20 })
  });

  if (!res.ok) {
    const err = await res.text();
    if (res.status === 429) throw new Error('places_quota_exceeded');
    throw new Error(`Places ${res.status}: ${err}`);
  }

  const data = await res.json();
  return (data.places ?? []).map(p => ({
    place_id:      p.id,
    business_name: p.displayName?.text ?? '',
    address:       p.formattedAddress ?? '',
    phone:         p.nationalPhoneNumber ?? null,
    website:       p.websiteUri ?? null,
    google_rating: p.rating ?? null,
    review_count:  p.userRatingCount ?? 0
  }));
}

// ─── HUNTER.IO ──────────────────────────────────────────────
export async function huntEmail(domain, apiKey) {
  if (!domain) return null;

  // Reject invalid email sources (Twin pattern)
  const blocked = ['wix.com','squarespace.com','wordpress.com','weebly.com','godaddy.com','shopify.com'];
  if (blocked.some(b => domain.includes(b))) return null;

  const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${apiKey}&limit=5`;

  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    return null;
  }

  if (res.status === 429) throw new Error('hunter_rate_limit');
  if (!res.ok) return null;

  const data = await res.json();
  const emails = data.data?.emails ?? [];

  // Filter: no noreply@, no info@ from website builders (Twin pattern)
  const valid = emails.filter(e =>
    e.value &&
    !e.value.startsWith('noreply@') &&
    !e.value.startsWith('info@') &&
    !e.value.startsWith('contact@') &&
    e.confidence >= 50
  );

  if (!valid.length) return null;

  const best = valid.sort((a,b) => b.confidence - a.confidence)[0];
  return {
    email:            best.value,
    email_confidence: best.confidence >= 80 ? 'high' : best.confidence >= 60 ? 'medium' : 'low',
    email_source:     'hunter'
  };
}

// ─── APOLLO.IO ───────────────────────────────────────────────
export async function apolloEmail(businessName, domain, apiKey) {
  if (!businessName) return null;

  const res = await fetch('https://api.apollo.io/v1/people/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    body: JSON.stringify({
      api_key: apiKey,
      organization_name: businessName,
      domain,
      reveal_personal_emails: false
    })
  });

  if (!res.ok) return null;
  const data = await res.json();
  const email = data.person?.email;
  if (!email) return null;

  return {
    email,
    email_confidence: 'medium',
    email_source: 'apollo'
  };
}

// ─── EMAIL CONFIDENCE SCORING (Twin pattern) ─────────────────
export function scoreEmail(email, source, hunterConfidence = null) {
  // Reject rules (Twin)
  if (!email) return null;
  if (email.startsWith('noreply@') || email.startsWith('no-reply@')) return null;
  if (email.startsWith('info@') || email.startsWith('contact@')) return null;
  const domain = email.split('@')[1] ?? '';
  const builderDomains = ['wix.com','squarespace.com','wordpress.com','weebly.com'];
  if (builderDomains.some(d => domain.includes(d))) return null;

  if (source === 'hunter' && hunterConfidence) {
    return hunterConfidence >= 80 ? 'high' : hunterConfidence >= 60 ? 'medium' : 'low';
  }
  if (source === 'apollo') return 'medium';
  if (source === 'linkedin') return 'high';
  return 'low';
}

// ─── GMAIL API ───────────────────────────────────────────────
export async function sendEmail({ to, subject, body, threadId, oauthToken }) {
  const raw = btoa([
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    body
  ].join('\r\n')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

  const url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
  const payload = { raw };
  if (threadId) payload.threadId = threadId;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${oauthToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (res.status === 401) throw new Error('gmail_oauth_expired');
  if (!res.ok) throw new Error(`Gmail ${res.status}: ${await res.text()}`);

  const data = await res.json();
  return { messageId: data.id, threadId: data.threadId };
}

// ─── TWILIO SMS ──────────────────────────────────────────────
// $0.008/msg — only for phone-only leads (no email found)
export async function sendSMS({ to, body, accountSid, authToken, fromNumber }) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = btoa(`${accountSid}:${authToken}`);

  // Ensure opt-out is in message
  const msgBody = body.length <= 140 ? `${body}\nReply STOP to opt out` : body;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: fromNumber, Body: msgBody })
  });

  if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { sid: data.sid, status: data.status };
}

// ─── LOB.COM DIRECT MAIL ─────────────────────────────────────
// ~$0.80/postcard — only for score >= 85 leads
export async function sendPostcard({ toName, toAddress, toCity, toState, toZip, frontHtml, backHtml, lobApiKey }) {
  const auth = btoa(`${lobApiKey}:`);

  const res = await fetch('https://api.lob.com/v1/postcards', {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      description: 'AutoFlow outreach postcard',
      to: { name: toName, address_line1: toAddress, address_city: toCity, address_state: toState, address_zip: toZip, address_country: 'US' },
      front: frontHtml,
      back: backHtml,
      size: '4x6'
    })
  });

  if (!res.ok) throw new Error(`Lob ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { id: data.id, expectedDeliveryDate: data.expected_delivery_date };
}

// ─── VERCEL DEPLOY ───────────────────────────────────────────
export async function deployToVercel({ projectName, htmlContent, vercelToken }) {
  const fileName = 'index.html';

  const res = await fetch('https://api.vercel.com/v13/deployments', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${vercelToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: projectName,
      files: [{ file: fileName, data: htmlContent }],
      projectSettings: { framework: null }
    })
  });

  if (res.status === 504) throw new Error('vercel_deploy_timeout');
  if (!res.ok) throw new Error(`Vercel ${res.status}: ${await res.text()}`);

  const data = await res.json();
  return { url: `https://${data.url}`, deployId: data.id };
}
