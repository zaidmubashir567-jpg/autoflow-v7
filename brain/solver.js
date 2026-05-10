// ============================================================
// AutoFlow v7 — Brain: Solver (Raj layer, client-side)
// Wraps known error handling, retry logic, and fix suggestions
// Mirrors the rajDiagnose() helper in Edge Functions
// Used by pipeline.html and dashboard.html to surface fix hints
// ============================================================

import { sb } from '../shared/auth.js';

// ── Known error signatures (mirrors helpers.ts errorSignature) ─
const ERROR_MAP = {
  places_quota_exceeded: {
    title: 'Google Places quota reached',
    icon: '📍',
    fix: 'Wait until midnight Pacific for quota reset. Or add a second Google API key in Credentials.',
    retry_after_hours: 12,
    severity: 'high'
  },
  gmail_oauth_expired: {
    title: 'Gmail token expired',
    icon: '📧',
    fix: 'Re-connect your Gmail account in Credentials → Google OAuth.',
    retry_after_hours: 0,
    severity: 'critical',
    action: { label: 'Reconnect Gmail', href: '/admin/credentials.html' }
  },
  vercel_deploy_timeout: {
    title: 'Vercel deploy timed out',
    icon: '🚀',
    fix: 'Vercel free tier has cold start delays. Auto-retry in 2 minutes.',
    retry_after_hours: 0,
    severity: 'medium',
    auto_retry: true
  },
  hunter_rate_limit: {
    title: 'Hunter.io rate limited (429)',
    icon: '🔍',
    fix: 'Hunter.io rate limit hit. Pipeline will continue with Apollo.io fallback.',
    retry_after_hours: 1,
    severity: 'low'
  },
  apollo_no_match: {
    title: 'Apollo.io — no match found',
    icon: '🔍',
    fix: 'No email found via Hunter or Apollo. Lead routed to channel detection (DM/form/mail).',
    retry_after_hours: 0,
    severity: 'info'
  },
  places_zero_results: {
    title: 'Google Places — 0 results',
    icon: '📍',
    fix: 'Try a broader niche term (e.g. "restaurant" instead of "vegan Thai restaurant") or a larger city.',
    retry_after_hours: 0,
    severity: 'medium'
  }
};

// ── Diagnose an error and return structured fix info ──────────
export async function diagnose(errorMessage, clientId) {
  const sig = inferSignature(errorMessage);

  // Check DB error_library first (has times_applied, last fix)
  const { data: known } = await sb.from('error_library')
    .select('*')
    .eq('error_signature', sig)
    .maybeSingle();

  const template = ERROR_MAP[sig];

  return {
    signature: sig,
    known: !!known || !!template,
    title: template?.title ?? (known?.error_signature ?? 'Unknown error'),
    icon: template?.icon ?? '⚠️',
    fix: template?.fix ?? known?.fix_applied ?? 'Manual investigation required.',
    severity: template?.severity ?? 'medium',
    auto_retry: template?.auto_retry ?? false,
    retry_after_hours: template?.retry_after_hours ?? 0,
    action: template?.action ?? null,
    times_seen: known?.times_applied ?? 1,
    raw_message: errorMessage
  };
}

// ── Batch diagnose multiple errors ───────────────────────────
export async function diagnoseAll(errors, clientId) {
  return Promise.all(errors.map(e => diagnose(typeof e === 'string' ? e : e.message, clientId)));
}

// ── Get all errors for a pipeline run ────────────────────────
export async function getRunErrors(runId, clientId) {
  const { data: run } = await sb.from('pipeline_runs')
    .select('errors, status, node_progress')
    .eq('id', runId)
    .eq('client_id', clientId)
    .single();

  if (!run?.errors?.length) return [];

  const diagnosed = await diagnoseAll(run.errors, clientId);
  return diagnosed;
}

// ── Retry a failed pipeline run ──────────────────────────────
export async function retryRun(runId, clientId, fromNode) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { success: false, error: 'Not authenticated' };

  const supabaseUrl = window.__SUPABASE_URL__;
  const res = await fetch(`${supabaseUrl}/functions/v1/run-pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ client_id: clientId, retry_run_id: runId, start_from_node: fromNode })
  });

  if (!res.ok) return { success: false, error: await res.text() };
  return { success: true, data: await res.json() };
}

// ── Surface actionable fixes for the UI ──────────────────────
export function renderErrorCard(diagnosedError) {
  const severityColor = {
    critical: 'var(--color-error)',
    high: '#FF6B35',
    medium: 'var(--color-warning, #F59E0B)',
    low: 'var(--color-info, #3B82F6)',
    info: 'var(--color-muted)'
  };

  const color = severityColor[diagnosedError.severity] ?? 'var(--color-muted)';

  return `
    <div class="error-card" style="border-left:3px solid ${color};padding:12px 16px;margin:8px 0;background:var(--color-surface);border-radius:4px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span>${diagnosedError.icon}</span>
        <strong style="color:${color}">${diagnosedError.title}</strong>
        ${diagnosedError.times_seen > 1 ? `<span style="font-size:11px;color:var(--color-muted)">(seen ${diagnosedError.times_seen}x)</span>` : ''}
      </div>
      <p style="margin:0 0 8px;font-size:13px;color:var(--color-text-secondary)">${diagnosedError.fix}</p>
      ${diagnosedError.action ? `<a href="${diagnosedError.action.href}" class="btn btn-sm btn-navy">${diagnosedError.action.label}</a>` : ''}
      ${diagnosedError.auto_retry ? `<span style="font-size:11px;color:var(--color-success)">⟳ Auto-retrying…</span>` : ''}
    </div>
  `;
}

// ── Infer error signature from message ───────────────────────
function inferSignature(msg) {
  const lower = (msg ?? '').toLowerCase();
  if (lower.includes('quota') || lower.includes('resource_exhausted')) return 'places_quota_exceeded';
  if (lower.includes('gmail') && (lower.includes('oauth') || lower.includes('401') || lower.includes('token'))) return 'gmail_oauth_expired';
  if (lower.includes('vercel') && lower.includes('timeout')) return 'vercel_deploy_timeout';
  if (lower.includes('hunter') && lower.includes('429')) return 'hunter_rate_limit';
  if (lower.includes('apollo') && lower.includes('no match')) return 'apollo_no_match';
  if (lower.includes('places') && lower.includes('0 result')) return 'places_zero_results';
  return `unknown_${lower.slice(0, 40).replace(/\s+/g, '_')}`;
}
