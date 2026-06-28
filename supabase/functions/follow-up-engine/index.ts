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

// ── Email builder — branded header, styled audit card, dark footer ──────────
function buildRawEmail(to: string, subject: string, body: string): string {
  // ── 1. Split body on the ━━━ dividers used by run-pipeline ──────────────
  // Body structure (from run-pipeline auditBlock):
  //   \n━━━\n📊 QUICK AUDIT…\n━━━\n🤖 AI RECEPTIONIST…\n━━━\n\n[email body]
  const DIVIDER = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
  const rawParts = body.split(DIVIDER).map((p) => p.trim()).filter((p) => p.length > 0);

  let emailBodyText = body;
  let auditContent  = "";

  if (rawParts.length >= 2) {
    // Everything except the last chunk = audit sections; last chunk = email prose
    auditContent  = rawParts.slice(0, rawParts.length - 1).join("\n\n");
    emailBodyText = rawParts[rawParts.length - 1];
  }

  // ── 2. Helpers ────────────────────────────────────────────────────────────
  // Escape + linkify a block of text, preserving line breaks
  function renderText(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/(https?:\/\/[^\s<>"]+)/g,
        '<a href="$1" style="color:#6366f1;font-weight:600;word-break:break-all">$1</a>')
      .replace(/\n/g, "<br>\n");
  }

  // Render audit lines — each line gets its own row so emojis align nicely
  function renderAuditLines(text: string): string {
    return text
      .split("\n")
      .filter((l) => l.trim())
      .map((line) => {
        const safe = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        // Section headers (📊 / 🤖) get a slightly larger style
        const isHeader = /^[📊🤖]/.test(line);
        return isHeader
          ? `<div style="font-size:13px;font-weight:800;color:#a5b4fc;margin-top:4px;margin-bottom:6px;letter-spacing:0.3px">${safe}</div>`
          : `<div style="font-size:12.5px;color:#cbd5e1;line-height:1.7;padding:2px 0 2px 8px;border-left:2px solid #3730a3">${safe}</div>`;
      })
      .join("\n");
  }

  // ── 3. Build the HTML ─────────────────────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">

  <!-- ═══ HEADER ═══ -->
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
    <tr>
      <td style="background:linear-gradient(135deg,#4f46e5 0%,#6366f1 50%,#818cf8 100%);padding:0">
        <table width="620" align="center" cellpadding="0" cellspacing="0" role="presentation"
               style="max-width:620px;margin:0 auto">
          <tr>
            <td style="padding:22px 32px 18px 32px">
              <div style="color:#fff;font-size:26px;font-weight:900;letter-spacing:-1px;line-height:1">
                AttoLeads
              </div>
              <div style="color:rgba(255,255,255,0.75);font-size:11px;margin-top:5px;letter-spacing:1.5px;text-transform:uppercase">
                AI-Powered Lead Generation &amp; Outreach
              </div>
            </td>
            <td style="padding:22px 32px 18px 0;text-align:right;vertical-align:middle">
              <a href="https://attoleads.com"
                 style="background:rgba(255,255,255,0.15);color:#fff;text-decoration:none;
                        font-size:11px;font-weight:700;padding:7px 16px;border-radius:20px;
                        border:1px solid rgba(255,255,255,0.3);letter-spacing:0.5px">
                attoleads.com ↗
              </a>
            </td>
          </tr>
          <!-- thin accent bar -->
          <tr><td colspan="2" style="height:4px;background:linear-gradient(90deg,#fbbf24,#f59e0b,#fbbf24)"></td></tr>
        </table>
      </td>
    </tr>
  </table>

  <!-- ═══ BODY CARD ═══ -->
  <table width="620" align="center" cellpadding="0" cellspacing="0" role="presentation"
         style="max-width:620px;margin:0 auto">
    <tr>
      <td style="background:#ffffff;padding:32px 36px 28px 36px">

        <!-- Email prose -->
        <div style="font-size:14px;line-height:1.85;color:#1e293b;white-space:pre-wrap">
          ${renderText(emailBodyText)}
        </div>

        ${auditContent ? `
        <!-- ── Audit card ── -->
        <div style="background:#0f172a;border-radius:12px;padding:22px 24px;margin:28px 0 8px 0;
                    border-top:4px solid #fbbf24;box-shadow:0 4px 24px rgba(15,23,42,0.18)">
          ${renderAuditLines(auditContent)}
        </div>` : ""}

      </td>
    </tr>
  </table>

  <!-- ═══ FOOTER ═══ -->
  <table width="620" align="center" cellpadding="0" cellspacing="0" role="presentation"
         style="max-width:620px;margin:0 auto">
    <tr>
      <td style="background:#0f172a;padding:24px 36px">
        <!-- accent line -->
        <div style="height:3px;background:linear-gradient(90deg,#6366f1,#818cf8,#6366f1);border-radius:2px;margin-bottom:18px"></div>

        <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
          <tr>
            <td style="vertical-align:top">
              <div style="color:#e2e8f0;font-size:16px;font-weight:800;letter-spacing:-0.5px">AttoLeads</div>
              <div style="color:#64748b;font-size:11px;margin-top:4px;line-height:1.6">
                AI-powered lead generation<br>for local businesses
              </div>
            </td>
            <td style="vertical-align:top;text-align:right">
              <a href="https://attoleads.com"
                 style="color:#818cf8;font-size:12px;font-weight:700;text-decoration:none">
                attoleads.com
              </a><br>
              <span style="color:#475569;font-size:10px">© ${new Date().getFullYear()} AttoLeads</span>
            </td>
          </tr>
        </table>

        <div style="margin-top:16px;padding-top:14px;border-top:1px solid #1e293b;
                    font-size:10px;color:#475569;text-align:center;line-height:1.6">
          You are receiving this because your business matched our outreach criteria.
          To unsubscribe, reply <span style="color:#94a3b8;font-weight:700">STOP</span> and we will remove you immediately.
        </div>
      </td>
    </tr>
  </table>

</body>
</html>`;

  // ── 4. Encode to RFC 2822 base64url for Gmail API ─────────────────────────
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

  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
