// ================================================================
// AutoFlow v7 — generate-site
// Given a lead_id, Claude generates a full professional demo website
// for the business, then auto-deploys it to Vercel.
// The live URL is saved back to the lead record and included in outreach.
// ================================================================
import { getAdminClient, CORS } from "../_shared/helpers.ts";

const ANTHROPIC = "https://api.anthropic.com/v1/messages";
const VERCEL    = "https://api.vercel.com";
// Try these models in order until one succeeds (handles model deprecations).
const MODELS = ["claude-sonnet-4-5", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const { lead_id, client_id } = await req.json();
  if (!lead_id || !client_id) {
    return new Response(JSON.stringify({ error: "lead_id and client_id required" }), { status: 400, headers: CORS });
  }

  const sb = getAdminClient();

  // ── Load lead + client ────────────────────────────────────────
  const [{ data: lead }, { data: client }] = await Promise.all([
    sb.from("leads").select("*").eq("id", lead_id).single(),
    sb.from("clients").select("claude_key, vercel_token").eq("id", client_id).single()
  ]);

  if (!lead)          return new Response(JSON.stringify({ error: "Lead not found" }), { status: 404, headers: CORS });
  if (!client?.claude_key) return new Response(JSON.stringify({ error: "No Claude key configured" }), { status: 400, headers: CORS });

  console.log(`[generate-site] Generating site for ${lead.business_name}`);

  // ── Step 1: Claude generates the HTML ───────────────────────
  const { html, model_used, last_error } = await generateHTML(client.claude_key, lead);
  if (!html) return new Response(JSON.stringify({ error: "Claude failed to generate HTML", detail: last_error }), { status: 500, headers: CORS });

  // ── Step 2: Deploy to Vercel (if token exists) ────────────────
  let demoUrl: string | null = null;

  if (client.vercel_token) {
    demoUrl = await deployToVercel(client.vercel_token, lead, html);
  }

  // ── Step 3: Save back to lead ─────────────────────────────────
  const update: Record<string, unknown> = { demo_deployed_at: new Date().toISOString() };
  if (demoUrl) update.demo_url = demoUrl;

  await sb.from("leads").update(update).eq("id", lead_id);

  return new Response(JSON.stringify({
    ok: true,
    demo_url: demoUrl,
    deployed: !!demoUrl,
    model_used,
    html_length: html.length
  }), { headers: { ...CORS, "Content-Type": "application/json" } });
});

// ── Claude HTML generator ─────────────────────────────────────
async function generateHTML(claudeKey: string, lead: Record<string, unknown>): Promise<{ html: string | null, model_used: string | null, last_error: string | null }> {
  const bizName  = lead.business_name as string || "Your Business";
  const niche    = lead.niche        as string || "Local Business";
  const city     = lead.city         as string || "your area";
  const phone    = lead.phone        as string || "";
  const email    = lead.email        as string || "";
  const painPoints = (lead.pain_points as string[])?.join(", ") || "improve online presence";

  const prompt = `You are an expert web designer. Generate a COMPLETE, professional, modern single-page HTML website for this business.

Business: ${bizName}
Industry: ${niche}
City: ${city}
Phone: ${phone || "to be added"}
Email: ${email || "to be added"}
Current issues: ${painPoints}

Requirements:
- Full standalone HTML file (no external CSS files, everything inline)
- Modern, professional design with a dark hero section and clean layout
- Mobile responsive using CSS flexbox/grid
- Sections: Hero, About/Services, Why Choose Us, Contact CTA
- Use the business name and city throughout
- Real placeholder content specific to the ${niche} industry
- Color scheme: professional blues/greens or industry-appropriate colors
- Include a "Book a Free Consultation" CTA button
- Add a sticky nav bar
- Smooth scroll behavior
- DO NOT use any external images (use CSS gradients and emoji icons instead)
- Make it look like a $3,000 custom website
- The HTML should be 200-400 lines, complete and renderable

Output ONLY the raw HTML. No explanation, no markdown, no code blocks. Start with <!DOCTYPE html>`;

  let lastError: string | null = null;
  for (const model of MODELS) {
    try {
      const res = await fetch(ANTHROPIC, {
        method: "POST",
        headers: {
          "x-api-key": claudeKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          max_tokens: 8000,
          messages: [{ role: "user", content: prompt }]
        })
      });

      if (!res.ok) {
        lastError = model + ":" + res.status;
        console.error("[generate-site] Claude error:", model, res.status);
        continue; // try next model
      }

      const data = await res.json();
      let html = data.content?.[0]?.text || "";
      html = html.replace(/^```html?\n?/i, "").replace(/\n?```$/i, "").trim();
      if (!html.startsWith("<!DOCTYPE")) { lastError = model + ":no_doctype"; continue; }
      return { html, model_used: model, last_error: null };
    } catch (e) {
      lastError = model + ":" + String(e);
      console.error("[generate-site] Claude fetch error:", model, String(e));
    }
  }
  return { html: null, model_used: null, last_error: lastError };
}

// ── Vercel deployer — creates deployment then polls until READY ──
async function deployToVercel(
  token: string,
  lead: Record<string, unknown>,
  html: string
): Promise<string | null> {
  const bizName  = (lead.business_name as string || "business").toLowerCase()
    .replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 30);
  const projectName = `af-demo-${bizName}-${Date.now().toString(36)}`;

  const authHeaders = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  };

  try {
    // ── 1. Create deployment ────────────────────────────────────
    const res = await fetch(`${VERCEL}/v13/deployments`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        name: projectName,
        files: [
          {
            file: "index.html",
            data: btoa(unescape(encodeURIComponent(html))),
            encoding: "base64"
          }
        ],
        projectSettings: {
          framework: null,
          buildCommand: null,
          outputDirectory: null
        },
        target: "production"
      })
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[generate-site] Vercel deploy error:", res.status, err.slice(0, 200));
      return null;
    }

    const data = await res.json();
    const deploymentId = data.id as string | undefined;
    const rawUrl = data.url as string | undefined;

    if (!rawUrl) {
      console.error("[generate-site] Vercel returned no URL");
      return null;
    }

    const finalUrl = `https://${rawUrl}`;
    console.log(`[generate-site] Deployment created: ${finalUrl} (id: ${deploymentId})`);

    // ── 2. Poll until READY (max 90s, check every 5s) ──────────
    if (deploymentId) {
      const maxWait  = 90_000; // 90 seconds
      const interval = 5_000;  // poll every 5s
      const started  = Date.now();

      while (Date.now() - started < maxWait) {
        await new Promise(r => setTimeout(r, interval));

        try {
          const poll = await fetch(`${VERCEL}/v13/deployments/${deploymentId}`, {
            headers: authHeaders
          });

          if (poll.ok) {
            const pollData = await poll.json();
            const state = (pollData.readyState || pollData.status || "").toUpperCase();
            console.log(`[generate-site] Poll state: ${state} (${Math.round((Date.now()-started)/1000)}s)`);

            if (state === "READY") {
              console.log(`[generate-site] Deployment READY: ${finalUrl}`);
              return finalUrl;
            }
            if (state === "ERROR" || state === "CANCELED") {
              console.error(`[generate-site] Deployment failed with state: ${state}`);
              return null;
            }
          }
        } catch (pollErr) {
          console.warn("[generate-site] Poll error:", String(pollErr));
        }
      }

      console.warn(`[generate-site] Timed out waiting for READY — returning URL anyway: ${finalUrl}`);
    }

    return finalUrl;
  } catch (e) {
    console.error("[generate-site] Vercel fetch error:", String(e));
    return null;
  }
}
