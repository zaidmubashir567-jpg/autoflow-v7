-- ============================================================
-- AutoFlow v7 — Migration 004: Admin self-provisioning
-- Allows a logged-in Google user to create their own clients row
-- (only needed once for the first admin setup)
-- ============================================================

-- Allow any authenticated user to INSERT their own clients row
-- where user_id matches their auth UID.
-- This is safe: RLS on SELECT/UPDATE/DELETE already restricts to owner.
CREATE POLICY "admin_self_insert" ON clients
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Allow admin to UPDATE their own row (for credentials page)
CREATE POLICY "admin_update_own" ON clients
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Allow admin to SELECT their own row
CREATE POLICY "admin_select_own" ON clients
  FOR SELECT
  USING (auth.uid() = user_id);
