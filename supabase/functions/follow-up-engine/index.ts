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

// ── Email builder — premium branded HTML email ────────────────────
function buildRawEmail(to: string, subject: string, body: string): string {

  // ── 1. Split on DIVIDER — audit sections vs email prose ──────────
  const DIVIDER = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
  const parts   = body.split(DIVIDER).map(p => p.trim()).filter(p => p.length > 0);
  let proseText  = body;
  let auditText  = "";
  if (parts.length >= 2) {
    auditText = parts.slice(0, parts.length - 1).join("\n\n");
    proseText = parts[parts.length - 1];
  }

  // ── 2. Sanitise helper ────────────────────────────────────────────
  const esc = (s: string) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  // ── 3. Render email prose into clean HTML paragraphs ─────────────
  function renderProse(text: string): string {
    // Strip trailing signature block ("Best,\nTeam AttoLeads\nhttps://…")
    // We'll render the signature ourselves in the footer
    const sigRe = /\n+Best,?\n[\s\S]*$/i;
    const cleanText = text.replace(sigRe, "").trim();

    const paragraphs = cleanText.split(/\n{2,}/);
    return paragraphs.map(para => {
      const lines = para.split("\n").map(l => l.trimEnd());

      // ── Bullet list ──
      if (lines.some(l => /^[•\-\*]\s/.test(l))) {
        const items = lines
          .filter(l => /^[•\-\*]\s/.test(l))
          .map(l => l.replace(/^[•\-\*]\s+/, ""))
          .map(l => `<li style="margin:6px 0;color:#1e293b;line-height:1.6">${esc(l)}</li>`)
          .join("");
        const before = lines.filter(l => !/^[•\-\*]\s/.test(l)).map(l => esc(l)).join(" ");
        return `${before ? `<p style="margin:0 0 8px;color:#334155;font-size:14px;line-height:1.7">${before}</p>` : ""}
<ul style="margin:8px 0 16px 0;padding-left:20px">${items}</ul>`;
      }

      // ── Demo / preview link line (👉 URL) ──
      const demoLineIdx = lines.findIndex(l => /👉|I built a free (preview|demo)|free demo/.test(l));
      if (demoLineIdx !== -1) {
        const demoLine = lines[demoLineIdx];
        // Extract URL from the line
        const urlMatch = demoLine.match(/https?:\/\/[^\s]+/);
        // Only show real deployed URLs (Vercel pattern: af-demo-... or anything with a real domain)
        // Fake placeholders look like "company-name-demo.vercel.app" (no af-demo- prefix, no timestamp hash)
        const isFakeUrl = urlMatch && /^[a-z0-9-]+-demo\.vercel\.app$/.test(new URL(urlMatch[0]).hostname);

        if (urlMatch && !isFakeUrl) {
          const url = urlMatch[0];
          const otherLines = lines.filter((_,i) => i !== demoLineIdx)
            .map(l => esc(l)).join(" ").trim();
          return `${otherLines ? `<p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.7">${otherLines}</p>` : ""}
<div style="text-align:center;margin:20px 0">
  <a href="${esc(url)}" style="display:inline-block;background:linear-gradient(135deg,#4f46e5,#6366f1);
     color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;
     padding:13px 28px;border-radius:8px;letter-spacing:0.3px;
     box-shadow:0 4px 14px rgba(79,70,229,0.35)">
    👁 View Your Free Demo Site →
  </a>
</div>`;
        } else {
          // Fake URL — replace with a genuine offer
          const otherLines = lines.filter((_,i) => i !== demoLineIdx)
            .map(l => esc(l)).join("<br>").trim();
          return `<p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.7">${otherLines}</p>
<div style="background:#f0f4ff;border-left:4px solid #6366f1;border-radius:0 8px 8px 0;padding:14px 18px;margin:16px 0">
  <p style="margin:0;font-size:13.5px;color:#3730a3;font-weight:600;line-height:1.6">
    💡 <strong>Free Demo:</strong> Reply to this email and I'll build a live preview of your new website — no strings attached. Usually ready within 24 hours.
  </p>
</div>`;
        }
      }

      // ── CTA line ──
      if (/worth a 10.minute call|schedule a call|book a call/i.test(para)) {
        return `
<div style="text-align:center;margin:28px 0 8px 0">
  <a href="mailto:${esc(to)}" style="display:inline-block;background:linear-gradient(135deg,#4f46e5,#6366f1);
     color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;
     padding:14px 32px;border-radius:8px;letter-spacing:0.3px;
     box-shadow:0 4px 14px rgba(79,70,229,0.35)">
    📅 Book a Free 10-Minute Call
  </a>
  <p style="margin:10px 0 0;font-size:12px;color:#64748b">Just reply with a time that works — I'll send the calendar link.</p>
</div>`;
      }

      // ── Normal paragraph ──
      const rendered = lines.map(l => {
        const safe = esc(l);
        return safe.replace(/(https?:\/\/[^\s&<>"]+)/g,
          '<a href="$1" style="color:#4f46e5;font-weight:600;text-decoration:underline">$1</a>');
      }).join("<br>");
      return `<p style="margin:0 0 14px;color:#1e293b;font-size:14px;line-height:1.75">${rendered}</p>`;
    }).join("\n");
  }

  // ── 4. Render audit card lines ────────────────────────────────────
  function renderAudit(text: string): string {
    return text.split("\n").filter(l => l.trim()).map(line => {
      const safe = esc(line.trim());
      if (/^📊/.test(line)) return `<div style="font-size:12px;font-weight:800;color:#fbbf24;letter-spacing:0.5px;text-transform:uppercase;margin:0 0 10px">${safe}</div>`;
      if (/^🤖/.test(line)) return `<div style="font-size:12px;font-weight:800;color:#a78bfa;letter-spacing:0.5px;text-transform:uppercase;margin:14px 0 8px">${safe}</div>`;
      if (/^⭐|^📱|^🌐|^🎯|^✅/.test(line)) return `
<div style="display:flex;gap:10px;align-items:flex-start;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
  <div style="font-size:13px;color:#94a3b8;line-height:1.5;flex:1">${safe}</div>
</div>`;
      return `<div style="font-size:12px;color:#64748b;line-height:1.6;padding:3px 0">${safe}</div>`;
    }).join("");
  }

  // ── 5. Assemble HTML ──────────────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f1f5f9">
<tr><td align="center" style="padding:24px 12px 0">

  <!-- ══ BRAND HEADER ══ -->
  <table width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#4f46e5"
         style="max-width:600px;border-radius:12px 12px 0 0;overflow:hidden">
    <tr>
      <td style="padding:24px 36px 0 36px">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td>
              <div style="font-size:24px;font-weight:900;color:#ffffff;letter-spacing:-0.5px;line-height:1">AttoLeads</div>
              <div style="font-size:10px;color:rgba(255,255,255,0.65);margin-top:4px;text-transform:uppercase;letter-spacing:1.5px">AI-Powered Lead Generation</div>
            </td>
            <td align="right" valign="middle">
              <a href="https://attoleads.com" style="display:inline-block;color:rgba(255,255,255,0.85);font-size:11px;font-weight:700;text-decoration:none;background:rgba(255,255,255,0.12);padding:6px 14px;border-radius:20px;border:1px solid rgba(255,255,255,0.25)">attoleads.com →</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr><td style="padding:0 0 0 0;height:20px"></td></tr>
    <!-- Gold accent bar -->
    <tr><td style="height:4px;background:linear-gradient(90deg,#fbbf24,#f59e0b,#fcd34d)"></td></tr>
  </table>

  <!-- ══ BODY CARD ══ -->
  <table width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff"
         style="max-width:600px">
    <tr>
      <td style="padding:36px 40px 28px 40px">
        ${renderProse(proseText)}
      </td>
    </tr>

    ${auditText ? `
    <!-- ══ AUDIT CARD ══ -->
    <tr>
      <td style="padding:0 40px 32px 40px">
        <div style="background:#0f172a;border-radius:10px;padding:22px 24px;border-top:3px solid #fbbf24">
          ${renderAudit(auditText)}
        </div>
      </td>
    </tr>` : ""}
  </table>

  <!-- ══ SIGNATURE ══ -->
  <table width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff"
         style="max-width:600px;border-top:1px solid #f1f5f9">
    <tr>
      <td style="padding:20px 40px 28px">
        <div style="font-size:13px;color:#475569;line-height:1.7">
          Best,<br>
          <strong style="color:#1e293b;font-size:14px">Team AttoLeads</strong><br>
          <a href="https://attoleads.com" style="color:#4f46e5;font-size:12px;font-weight:600;text-decoration:none">https://attoleads.com</a>
        </div>
      </td>
    </tr>
  </table>

  <!-- ══ FOOTER ══ -->
  <table width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#0f172a"
         style="max-width:600px;border-radius:0 0 12px 12px;overflow:hidden">
    <tr>
      <td style="padding:22px 36px">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td>
              <div style="color:#e2e8f0;font-size:14px;font-weight:800">AttoLeads</div>
              <div style="color:#475569;font-size:11px;margin-top:3px">AI-powered outreach for local businesses</div>
            </td>
            <td align="right" valign="top">
              <a href="https://attoleads.com" style="color:#818cf8;font-size:11px;font-weight:700;text-decoration:none">attoleads.com</a><br>
              <span style="color:#334155;font-size:10px">© ${new Date().getFullYear()} AttoLeads</span>
            </td>
          </tr>
        </table>
        <div style="margin-top:16px;padding-top:14px;border-top:1px solid #1e293b;
                    font-size:10px;color:#475569;text-align:center;line-height:1.6">
          You received this because your business matched our outreach criteria.
          To unsubscribe, reply <strong style="color:#64748b">STOP</strong> and we will remove you immediately.
        </div>
      </td>
    </tr>
  </table>

</td></tr>
</table>
</body>
</html>`;

  // ── 6. Encode RFC 2822 / base64url for Gmail API ──────────────────
  const bytes = new TextEncoder().encode(
    [`To: ${to}`, `Subject: ${subject}`, "MIME-Version: 1.0",
     "Content-Type: text/html; charset=utf-8", "", html].join("\r\n")
  );
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
