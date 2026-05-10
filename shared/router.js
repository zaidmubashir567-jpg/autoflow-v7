// ============================================================
// AutoFlow v7 — shared/router.js
// Role-based routing: admin → /admin/, client → /client/
// Used by index.html after login and auth-callback.html
// ============================================================

import { getUserRole } from './auth.js';

// ─── Route after login ──────────────────────────────────────
export async function routeByRole() {
  const role = await getUserRole();

  switch (role) {
    case 'admin':
      location.href = '/admin/dashboard.html';
      break;
    case 'client':
      location.href = '/client/dashboard.html';
      break;
    default:
      // No client row yet — show setup or error
      location.href = '/?error=no_account';
      break;
  }
}

// ─── Redirect if already logged in (for index.html) ─────────
export async function redirectIfAuthed() {
  const role = await getUserRole();
  if (role === 'admin') location.href = '/admin/dashboard.html';
  if (role === 'client') location.href = '/client/dashboard.html';
}
