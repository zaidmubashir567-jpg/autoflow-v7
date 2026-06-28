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
  const { data: clients, error: clientErr } = await sb
    .from("clients")
    .select("id, daily_email_cap, gmail_access, gmail_refresh, claude_key")
    .eq("active", true);

  if (clientErr) {
    console.error("[follow-up-engine] Client query failed:", clientErr.message);
    return new Response(JSON.stringify({ ok: false, error: clientErr.message }), {
      headers: { ...CORS, "Content-Type": "application/json" }
    });
  }

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
          sb,
          client,
          email,
          row.subject as string,
          row.body as string
        );
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
      // Mark as needs_sender so the dashboard shows the error clearly
      console.error(`[follow-up-engine] Failed to send ${row.id}:`, sendResult.error);
      await sb.from("outreach_log")
        .update({ status: "needs_sender" })
        .eq("id", row.id);
      skipped++;
    }
  }

  return { sent, skipped, cap_remaining: remaining - sent };
}

// ── Gmail token refresh ───────────────────────────────────────
async function refreshGmailToken(
  sb: ReturnType<typeof import("../_shared/helpers.ts").getAdminClient>,
  client: Record<string, unknown>
): Promise<string | null> {
  const refreshToken = client.gmail_refresh as string | null;
  if (!refreshToken) return null;

  // Google OAuth client credentials — these are the Supabase project's OAuth app credentials.
  // They live as Supabase secrets: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.
  const clientId     = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    console.warn("[follow-up-engine] GOOGLE_CLIENT_ID/SECRET not set — cannot refresh token");
    return null;
  }

  try {
    const body = new URLSearchParams({
      grant_type:    "refresh_token",
      refresh_token: refreshToken,
      client_id:     clientId,
      client_secret: clientSecret
    });

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });

    if (!res.ok) {
      const e = await res.text();
      console.error("[follow-up-engine] Token refresh failed:", e.slice(0, 200));
      return null;
    }

    const data = await res.json();
    const newToken = data.access_token as string;

    // Persist refreshed token + timestamp back to DB
    await sb.from("clients").update({
      gmail_access:         newToken,
      gmail_token_saved_at: new Date().toISOString()
    }).eq("id", client.id as string);

    console.log(`[follow-up-engine] Gmail token refreshed for client ${client.id}`);
    return newToken;
  } catch (e) {
    console.error("[follow-up-engine] Token refresh error:", String(e));
    return null;
  }
}

// ── Gmail sender ─────────────────────────────────────────────────
async function sendViaGmail(
  sb: ReturnType<typeof import("../_shared/helpers.ts").getAdminClient>,
  client: Record<string, unknown>,
  to: string,
  subject: string,
  body: string
): Promise<{ ok: boolean; thread_id?: string; error?: string }> {
  let accessToken = client.gmail_access as string;

  const doSend = async (token: string) => {
    const raw = buildRawEmail(to, subject, body);
    return fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ raw })
    });
  };

  try {
    let res = await doSend(accessToken);

    // 401 — try refreshing the token once
    if (res.status === 401) {
      console.log(`[follow-up-engine] 401 for client ${client.id} — attempting token refresh`);
      const newToken = await refreshGmailToken(sb, client);
      if (!newToken) {
        return { ok: false, error: "Gmail token expired — reconnect in Credentials" };
      }
      // Update in-memory client so caller sees new token
      client.gmail_access = newToken;
      res = await doSend(newToken);
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

// ── Email builder (HTML with clickable links + attoleads.com footer) ──────
function buildRawEmail(to: string, subject: string, body: string): string {
  // Escape HTML special chars
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Make URLs clickable
  const linked = escaped.replace(
    /(https?:\/\/[^\s<>"]+)/g,
    '<a href="$1" style="color:#6366f1;font-weight:600;word-break:break-all">$1</a>'
  );

  // Convert newlines to <br>
  const htmlBody = linked.replace(/\n/g, "<br>\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a2e;line-height:1.7;max-width:620px;margin:0 auto;padding:24px 20px;background:#fff">
  <div style="white-space:pre-wrap">${htmlBody}</div>
  <br>
  <div style="border-top:1px solid #e5e7eb;margin-top:24px;padding-top:16px;font-size:12px;color:#6b7280">
    Sent via <a href="https://attoleads.com" style="color:#6366f1;font-weight:600;text-decoration:none">AttoLeads.com</a>
    &nbsp;·&nbsp; AI-powered lead generation &amp; outreach for local businesses
    <br>
    To unsubscribe, reply <strong>STOP</strong> and you will not hear from us again.
  </div>
</body>
</html>`;

  // Encode to base64url — handle UTF-8 / emoji in body
  const bytes = new TextEncoder().encode(
    [
      `To: ${to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=utf-8",
      "",
      html
    ].join("\r\n")
  );

  // Convert Uint8Array → binary string → base64
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
