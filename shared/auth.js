// ============================================================
// AutoFlow v7 — shared/auth.js
// Google OAuth + Supabase Auth + role detection
// Import on every page: <script type="module" src="/shared/auth.js"></script>
// ============================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// ─── Supabase client (singleton) ───────────────────────────
export const SUPABASE_URL  = 'https://ndwvsrtyjnaddrifafqk.supabase.co';
export const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kd3ZzcnR5am5hZGRyaWZhZnFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4ODMxMDgsImV4cCI6MjA5MzQ1OTEwOH0.7XoOKB74DGiXac3cfSSiyvREuWZ7qbQ2QbxE6d1rnlM';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true }
});

// Alias used by brain/ modules
export const sb = supabase;

// Set global for Edge Function calls from browser
window.__SUPABASE_URL__ = SUPABASE_URL;

// ─── Google OAuth scopes ────────────────────────────────────
// gmail.send   → Elena can send emails
// cloud-platform → covers Gemini API + Places API with one login
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/cloud-platform',
  'openid',
  'email',
  'profile'
].join(' ');

// ─── Sign in with Google ────────────────────────────────────
export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      scopes: GOOGLE_SCOPES,
      redirectTo: `${location.origin}/shared/auth-callback.html`,
      queryParams: { access_type: 'offline', prompt: 'consent' }
    }
  });
  if (error) throw error;
}

// ─── Sign out ───────────────────────────────────────────────
export async function signOut() {
  _cClear();
  await supabase.auth.signOut();
  location.href = '/';
}

// ─── Session cache (sessionStorage, 3-min TTL) ──────────────
// Eliminates 3 extra Supabase round-trips on every page navigation.
const _TTL = 3 * 60 * 1000;

function _cSet(key, val) {
  try { sessionStorage.setItem(key, JSON.stringify({ v: val, t: Date.now() })); } catch {}
}
function _cGet(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return undefined;
    const { v, t } = JSON.parse(raw);
    if (Date.now() - t > _TTL) { sessionStorage.removeItem(key); return undefined; }
    return v;
  } catch { return undefined; }
}
function _cClear() {
  ['_af_role', '_af_cid', '_af_uid'].forEach(k => { try { sessionStorage.removeItem(k); } catch {} });
}

// ─── Get current session + user ────────────────────────────
export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function getUser() {
  // Use session user (no extra network call) — verified on every requireAuth anyway
  const session = await getSession();
  return session?.user ?? null;
}

// ─── Role detection ─────────────────────────────────────────
// admin   → has a row in clients where user_id = auth.uid()
// client  → has a row in clients where portal_user_id = auth.uid()
// none    → not linked to any client yet (new user)
export async function getUserRole() {
  const cached = _cGet('_af_role');
  if (cached !== undefined) return cached;

  const user = await getUser();
  if (!user) return 'none';

  // Check admin first
  const { data: adminRow } = await supabase
    .from('clients')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (adminRow) { _cSet('_af_role', 'admin'); return 'admin'; }

  // Check portal client
  const { data: portalRow } = await supabase
    .from('clients')
    .select('id')
    .eq('portal_user_id', user.id)
    .single();

  const role = portalRow ? 'client' : 'none';
  _cSet('_af_role', role);
  return role;
}

// ─── Get client_id for current user ─────────────────────────
export async function getClientId() {
  const cached = _cGet('_af_cid');
  if (cached !== undefined) return cached;

  const user = await getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('clients')
    .select('id')
    .or(`user_id.eq.${user.id},portal_user_id.eq.${user.id}`)
    .single();

  const cid = data?.id ?? null;
  _cSet('_af_cid', cid);
  return cid;
}

// ─── Redirect away from login if already authed ─────────────
// Call on index.html to skip login when session is active
export async function redirectIfAuthed() {
  const session = await getSession();
  if (!session) return;
  const role = await getUserRole();
  if (role === 'admin') { location.href = '/admin/dashboard.html'; }
  else if (role === 'client') { location.href = '/client/dashboard.html'; }
}

// ─── Auth guard — call at top of every protected page ───────
// Usage: await requireAuth('admin')  OR  await requireAuth('client')
export async function requireAuth(requiredRole = 'admin') {
  const session = await getSession();
  if (!session) {
    location.href = '/';
    return null;
  }

  const role = await getUserRole();

  if (requiredRole === 'admin' && role !== 'admin') {
    location.href = role === 'client' ? '/client/dashboard.html' : '/';
    return null;
  }

  if (requiredRole === 'client' && role === 'none') {
    location.href = '/';
    return null;
  }

  return { session, role, user: session.user };
}

// ─── Google OAuth token (for Places, Gemini, Gmail) ─────────
export async function getGoogleToken() {
  const session = await getSession();
  // provider_token is the Google OAuth access token
  return session?.provider_token ?? null;
}

// ─── Token refresh — called by DevOps cron every 50 min ─────
export async function refreshSession() {
  const { data, error } = await supabase.auth.refreshSession();
  if (error) console.error('[auth] refresh failed:', error.message);
  return data?.session ?? null;
}

// ─── Listen for auth state changes ──────────────────────────
export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
}
