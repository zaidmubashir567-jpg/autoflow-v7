// ================================================================
// AutoFlow v7 — generate-site
// Given a lead_id, Claude generates a full professional demo website
// for the business, then auto-deploys it to Vercel.
// The live URL is saved back to the lead record and included in outreach.
// ================================================================
import { getAdminClient, CORS } from "../_shared/helpers.ts";

const ANTHROPIC = "https://api.anthropic.com/v1/messages";
const VERCEL    = "https://api.vercel.com";

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

  // ── Step 1: Claude generates the HTML ────────────────────────
  const html = await generateHTML(client.claude_key, lead);
  if (!html) return new Response(JSON.stringify({ error: "Claude failed to generate HTML" }), { status: 500, headers: CORS });

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
    html_length: html.length
  }), { headers: { ...CORS, "Content-Type": "application/json" } });
});

// ── Claude HTML generator ─────────────────────────────────────
async function generateHTML(claudeKey: string, lead: Record<string, unknown>): Promise<string | null> {
  const bizName  = lead.business_name as string || "Your Business";
  const niche    = lead.niche        as string || "Local Business";
  const city     = lead.city         as string || "your area";
  const phone    = lead.phone        as string || "";
  const email    = lead.email        as string || "";
  const website  = lead.website      as string || "";
  const score    = lead.score        as number || 5;
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

  try {
    const res = await fetch(ANTHROPIC, {
      method: "POST",
      headers: {
        "x-api-key": claudeKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 8000,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!res.ok) {
      console.error("[generate-site] Claude error:", res.status);
      return null;
    }

    const data = await res.json();
    let html = data.content?.[0]?.text || "";

    // Strip any accidental markdown code fences
    html = html.replace(/^```html?\n?/i, "").replace(/\n?```$/i, "").trim();
    if (!html.startsWith("<!DOCTYPE")) return null;
    return html;
  } catch (e) {
    console.error("[generate-site] Claude fetch error:", String(e));
    return null;
  }
}

// ── Vercel deployer ───────────────────────────────────────────
async function deployToVercel(
  token: string,
  lead: Record<string, unknown>,
  html: string
): Promise<string | null> {
  const bizName  = (lead.business_name as string || "business").toLowerCase()
    .replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 30);
  const projectName = `af-demo-${bizName}-${Date.now().toString(36)}`;

  try {
    const res = await fetch(`${VERCEL}/v13/deployments`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
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
    const url = data.url ? `https://${data.url}` : null;
    console.log(`[generate-site] Deployed: ${url}`);
    return url;
  } catch (e) {
    console.error("[generate-site] Vercel fetch error:", String(e));
    return null;
  }
}
