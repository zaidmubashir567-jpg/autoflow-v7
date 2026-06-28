// ============================================================
// AutoFlow v7 — Edge Function shared helpers
// Import in every Edge Function
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── Supabase admin client (service_role — bypasses RLS) ────
export function getAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );
}

// ─── CORS headers ───────────────────────────────────────────
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export function ok(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

export function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

// ─── Claude — Exclusive AI Engine ───────────────────────────
// Two tiers auto-selected by task importance:
//   fast    → claude-haiku-4-5-20251001  bulk tasks: email copy, scoring, follow-ups (~$0.0003/call)
//   quality → claude-sonnet-4-6          important: reply drafts, proposals, analysis (~$0.003/call)

const CLAUDE_FAST    = 'claude-haiku-4-5-20251001';
const CLAUDE_QUALITY = 'claude-sonnet-4-6';

export async function callAI(
  prompt: string,
  sys: string,
  client: Record<string, string>,
  tier: 'fast' | 'quality' = 'fast'
): Promise<string> {
  const apiKey = client.claude_key;
  if (!apiKey) throw new Error('Claude API key not configured. Add it in Settings → Connected Accounts.');
  const model = tier === 'quality' ? CLAUDE_QUALITY : CLAUDE_FAST;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      ...(sys ? { system: sys } : {}),
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(`Claude ${res.status}: ${(errData as { error: { message: string } }).error?.message}`);
  }
  const data = await res.json() as { content: Array<{ text: string }> };
  return data.content?.[0]?.text ?? '';
}

// Quality-tier shorthand for reply drafts, proposals, learn engine
export async function callAIQuality(prompt: string, sys: string, client: Record<string, string>): Promise<string> {
  return callAI(prompt, sys, client, 'quality');
}

// ─── Update pipeline_runs (triggers Realtime to all subscribers) ─
export async function updateRun(sb: ReturnType<typeof getAdminClient>, runId: string, updates: Record<string, unknown>) {
  const { error } = await sb.from('pipeline_runs').update(updates).eq('id', runId);
  if (error) console.error('[updateRun]', error.message);
}

// ─── Gmail token refresh ─────────────────────────────────────
// Uses GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET secrets + stored refresh token
// Returns new access token or null on failure
export async function refreshGmailToken(refreshToken: string): Promise<string | null> {
  const clientId     = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  if (!clientId || !clientSecret || !refreshToken) return null;

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type:    'refresh_token'
    }).toString()
  });
  if (!r.ok) {
    const errBody = await r.text().catch(() => '');
    console.error('[refreshGmailToken] Failed:', r.status, errBody.slice(0, 120));
    return null;
  }
  const data = await r.json() as { access_token?: string };
  return data.access_token ?? null;
}

// ─── Error signature (for error_library lookup) ──────────────
export function errorSignature(e: Error): string {
  const msg = e.message.toLowerCase();
  if (msg.includes('quota')) return 'places_quota_exceeded';
  if (msg.includes('gmail') && msg.includes('oauth')) return 'gmail_oauth_expired';
  if (msg.includes('vercel') && msg.includes('timeout')) return 'vercel_deploy_timeout';
  if (msg.includes('hunter') && msg.includes('429')) return 'hunter_rate_limit';
  if (msg.includes('places') && msg.includes('0 results')) return 'places_zero_results';
  return `unknown_${msg.slice(0, 40).replace(/\s+/g, '_')}`;
}

// ─── Raj: check error library, apply known fix ───────────────
export async function rajDiagnose(sb: ReturnType<typeof getAdminClient>, e: Error, runId: string) {
  const sig = errorSignature(e);
  const { data: known } = await sb.from('error_library').select('*').eq('error_signature', sig).single();
  if (known) {
    console.log(`[Raj] Known error "${sig}" — applying fix: ${known.fix_applied}`);
    await sb.from('error_library').update({ times_applied: known.times_applied + 1, last_applied_at: new Date().toISOString() }).eq('id', known.id);
    return known.fix_applied;
  }
  // New error — save to library for future
  await sb.from('error_library').upsert({
    error_signature: sig, error_message: e.message, fix_applied: 'Manual investigation required', fix_success: false, notes: `First seen in run ${runId}`
  }, { onConflict: 'error_signature' });
  return null;
}
