// ============================================================
// LeadFyn — book-meeting edge function
// GET  /book-meeting?token=UUID       → available slots + meeting info
// POST /book-meeting                  → confirm booking
// DELETE /book-meeting?token=UUID     → cancel meeting
// Called by public/book.html (no auth required)
// ============================================================

import { getAdminClient, ok, err, CORS } from '../_shared/helpers.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const sb  = getAdminClient();
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const token = url.searchParams.get('token');
    if (!token) return err('token required', 400);
    const { data: meeting, error: mErr } = await sb.from('meetings').select('*, leads(business_name, niche, city), clients(name, timezone)').eq('booking_token', token).single();
    if (mErr || !meeting) return err('Invalid booking link', 404);
    if (meeting.status === 'confirmed') return ok({ status: 'already_booked', meeting });
    const { data: slots } = await sb.from('availability_slots').select('*').eq('client_id', meeting.client_id).eq('active', true);
    const available = generateAvailableSlots(slots ?? [], meeting.client_id);
    const twoWeeksOut = new Date(); twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);
    const { data: booked } = await sb.from('meetings').select('booked_at, duration_min').eq('client_id', meeting.client_id).eq('status', 'confirmed').gte('booked_at', new Date().toISOString()).lte('booked_at', twoWeeksOut.toISOString());
    const bookedTimes = new Set((booked ?? []).map(b => b.booked_at));
    const freeSlots = available.filter(s => !bookedTimes.has(s.utc));
    return ok({ meeting, available_slots: freeSlots.slice(0, 40) });
  }
  if (req.method === 'POST') {
    let body; try { body = await req.json(); } catch { return err('Invalid JSON', 400); }
    const { token, visitor_name, visitor_email, visitor_phone, booked_at, company_name } = body;
    if (!token || !visitor_name || !booked_at) return err('token, visitor_name, and booked_at required', 400);
    const { data: meeting, error: mErr } = await sb.from('meetings').select('*, clients(name, email)').eq('booking_token', token).single();
    if (mErr || !meeting) return err('Invalid booking link', 404);
    if (meeting.status === 'confirmed') return ok({ status: 'already_booked' });
    const { count } = await sb.from('meetings').select('*', { count: 'exact', head: true }).eq('client_id', meeting.client_id).eq('booked_at', booked_at).eq('status', 'confirmed');
    if ((count ?? 0) > 0) return err('That time slot is no longer available.', 409);
    const { error: updateErr } = await sb.from('meetings').update({ visitor_name, visitor_email: visitor_email ?? null, visitor_phone: visitor_phone ?? null, company_name: company_name ?? null, booked_at, status: 'confirmed' }).eq('booking_token', token);
    if (updateErr) return err('Failed to confirm booking', 500);
    if (meeting.lead_id) await sb.from('leads').update({ stage: 'call_booked' }).eq('id', meeting.lead_id);
    await notifyZaid(meeting, visitor_name, visitor_email, visitor_phone, booked_at, company_name);
    return ok({ status: 'confirmed', booked_at, visitor_name });
  }
  if (req.method === 'DELETE') {
    const token = url.searchParams.get('token');
    if (!token) return err('token required', 400);
    await sb.from('meetings').update({ status: 'cancelled' }).eq('booking_token', token);
    return ok({ status: 'cancelled' });
  }
  return err('Method not allowed', 405);
});

function generateAvailableSlots(slots, _clientId) {
  const result = []; const now = new Date();
  for (let d = 1; d <= 14; d++) {
    const date = new Date(now); date.setDate(date.getDate() + d);
    const dow = date.getDay();
    for (const slot of slots) {
      if (slot.day_of_week !== dow) continue;
      const [sh, sm] = slot.start_time.split(':').map(Number);
      const [eh, em] = slot.end_time.split(':').map(Number);
      const duration = slot.duration_min ?? 30;
      let h = sh, m = sm;
      while (h * 60 + m + duration <= eh * 60 + em) {
        const slotDate = new Date(date); slotDate.setHours(h, m, 0, 0);
        if (slotDate > now) result.push({ utc: slotDate.toISOString(), label: slotDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }), day: slotDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) });
        m += duration; if (m >= 60) { h += Math.floor(m / 60); m %= 60; }
      }
    }
  }
  return result;
}

async function notifyZaid(meeting, name, email, phone, bookedAt, company) {
  const adminEmail = 'uswahadeel85@gmail.com';
  const dateStr = formatDate(bookedAt);
  const subject = `📅 Meeting booked — ${name}${company ? ` (${company})` : ''} — ${dateStr}`;
  const body = [`New meeting booked!\nVisitor: ${name}`, company ? `Company: ${company}` : '', email ? `Email: ${email}` : '', phone ? `Phone: ${phone}` : '', `Date: ${dateStr}`, `Token: ${meeting.booking_token}`].filter(Boolean).join('\n');
  await fetch(`${SUPABASE_URL}/functions/v1/submit-contact-form`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` }, body: JSON.stringify({ name, email: email ?? adminEmail, business: company ?? 'LeadFyn Booking', message: body, source: 'booking_system', alert_email: adminEmail, subject }) }).catch(() => {});
}

function formatDate(utc) {
  return new Date(utc).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Chicago' }) + ' (Chicago time)';
}
