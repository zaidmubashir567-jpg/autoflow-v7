// ================================================================
// AutoFlow v7 — follow-up-engine  (Phase 3 rewrite)
// Runs hourly via pg_cron.
// Queries outreach_log WHERE status='scheduled' AND scheduled_at <= now()
// Sends via Gmail if oauth token exists, otherwise marks 'needs_sender'.
// Respects daily_email_cap per client.
// ================================================================
import { getAdminClient, CORS } from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const sb = getAdminClient();

  // Load all active clients
  const { data: clients } = await sb
    .from("clients")
    .select("id, daily_email_cap, gmail_access, gmail_refresh, smtp_host, smtp_user, smtp_pass, claude_key")
    .eq("active", true);

  if (!clients?.length) {
    return new Response(JSON.stringify({ processed: 0, message: "No active clients" }), {
      headers: { ...CORS, "Content-Type": "application/json" }
    });
  }

  const results = [];

  for (const client of clients) {
    try {
      const result = await processClient(sb, client);
      results.push({ client_id: client.id, ...result });
    } catch (e) {
      console.error(`[follow-up-engine] Client ${client.id}:`, (e as Error).message);
      results.push({ client_id: client.id, error: (e as Error).message });
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { ...CORS, "Content-Type": "application/json" }
  });
});

// ── Per-client processor ─────────────────────────────────────────
async function processClient(
  sb: ReturnType<typeof import("../_shared/helpers.ts").getAdminClient>,
  client: Record<string, unknown>
) {
  const clientId = client.id as string;
  const cap = (client.daily_email_cap as number) ?? 20;

  // How many emails sent today already?
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { count: todayCount } = await sb
    .from("outreach_log")
    .select("*", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("status", "sent")
    .gte("sent_at", todayStart.toISOString());

  let remaining = cap - (todayCount ?? 0);
  if (remaining <= 0) {
    return { sent: 0, skipped: 0, reason: "daily cap reached" };
  }

  // Find all due follow-ups for this client
  const now = new Date().toISOString();
  const { data: due } = await sb
    .from("outreach_log")
    .select(`
      id, lead_id, subject, body, channel, follow_up_seq,
      leads ( email, phone, business_name, owner_name, do_not_contact )
    `)
    .eq("client_id", clientId)
    .eq("status", "scheduled")
    .lte("scheduled_at", now)
    .order("scheduled_at", { ascending: true })
    .limit(remaining);

  if (!due?.length) {
    return { sent: 0, skipped: 0, reason: "no due follow-ups" };
  }

  let sent = 0;
  let skipped = 0;

  for (const row of due) {
    if (sent >= remaining) break;

    const lead = (row.leads as Record<string, unknown> | null);
    if (!lead || lead.do_not_contact) {
      // Mark as skipped — do_not_contact
      await sb.from("outreach_log").update({ status: "failed" }).eq("id", row.id);
      skipped++;
      continue;
    }

    const email = lead.email as string | null;

    // ── Try to send ────────────────────────────────────────────
    let sendResult: { ok: boolean; thread_id?: string; error?: string } = { ok: false };

    if (row.channel === "email" && email) {
      if (client.gmail_access) {
        sendResult = await sendViaGmail(
          client.gmail_access as string,
          email,
          row.subject as string,
          row.body as string
        );
      } else if (client.smtp_host) {
        sendResult = await sendViaSmtp(client, email, row.subject as string, row.body as string);
      } else {
        // No sender configured — mark as needs_sender so UI can flag it
        await sb.from("outreach_log")
          .update({ status: "needs_sender" })
          .eq("id", row.id);
        skipped++;
        continue;
      }
    } else if (row.channel === "sms" && lead.phone) {
      // SMS follow-ups — mark pending, handled by send-sms function
      await sb.from("outreach_log").update({ status: "needs_sender" }).eq("id", row.id);
      skipped++;
      continue;
    } else {
      // No contact info — skip
      await sb.from("outreach_log").update({ status: "failed" }).eq("id", row.id);
      skipped++;
      continue;
    }

    if (sendResult.ok) {
      // Update to sent
      await sb.from("outreach_log").update({
        status: "sent",
        sent_at: new Date().toISOString(),
        delivered: true,
        ...(sendResult.thread_id ? { thread_id: sendResult.thread_id } : {})
      }).eq("id", row.id);

      // Update lead stage to 'contacted'
      await sb.from("leads")
        .update({ stage: "contacted", updated_at: new Date().toISOString() })
        .eq("id", row.lead_id);

      sent++;
    } else {
      // Log failure but keep as scheduled — will retry next hour
      console.error(`[follow-up-engine] Failed to send ${row.id}:`, sendResult.error);
      // After 3 attempts give up — for now just leave as scheduled
    }
  }

  return { sent, skipped, cap_remaining: remaining - sent };
}

// ── Gmail sender ─────────────────────────────────────────────────
async function sendViaGmail(
  accessToken: string,
  to: string,
  subject: string,
  body: string
): Promise<{ ok: boolean; thread_id?: string; error?: string }> {
  try {
    const raw = buildRawEmail(to, subject, body);
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ raw })
    });

    if (res.status === 401) {
      return { ok: false, error: "Gmail token expired — reconnect in Credentials" };
    }
    if (!res.ok) {
      const e = await res.text();
      return { ok: false, error: `Gmail error ${res.status}: ${e.slice(0, 200)}` };
    }

    const data = await res.json();
    return { ok: true, thread_id: data.threadId };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ── SMTP sender (future — placeholder) ──────────────────────────
async function sendViaSmtp(
  _client: Record<string, unknown>,
  _to: string,
  _subject: string,
  _body: string
): Promise<{ ok: boolean; error?: string }> {
  // Supabase Edge Functions can't open raw TCP sockets.
  // SMTP would need a relay like Resend or SendGrid.
  // Mark as needs_sender for now — Phase 4 (Stripe) will add Resend.
  return { ok: false, error: "SMTP via relay not yet configured — connect Gmail or add Resend key" };
}

// ── Email builder ─────────────────────────────────────────────────
function buildRawEmail(to: string, subject: string, body: string): string {
  const msg = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
    "",
    body,
    "",
    "---",
    "To unsubscribe from these emails, reply STOP."
  ].join("\r\n");

  return btoa(msg).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
