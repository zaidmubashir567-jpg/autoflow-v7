// ================================================================
// AutoFlow v7 — generate-site (FREE, template-based)
// Builds a polished per-business demo site from a template using the
// lead's real Google data (name, niche, city, phone, rating, reviews).
// NO AI / NO API credits. Deploys to Vercel and saves the live URL.
// ================================================================
import { getAdminClient, CORS } from "../_shared/helpers.ts";

const VERCEL = "https://api.vercel.com";
const BOOK   = "https://attoleads.com/book";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const { lead_id, client_id } = await req.json();
  if (!lead_id || !client_id) {
    return new Response(JSON.stringify({ error: "lead_id and client_id required" }), { status: 400, headers: CORS });
  }

  const sb = getAdminClient();
  const [{ data: lead }, { data: client }] = await Promise.all([
    sb.from("leads").select("*").eq("id", lead_id).single(),
    sb.from("clients").select("vercel_token").eq("id", client_id).single()
  ]);

  if (!lead) return new Response(JSON.stringify({ error: "Lead not found" }), { status: 404, headers: CORS });

  const html = buildHTML(lead);

  let demoUrl: string | null = null;
  if (client?.vercel_token) {
    demoUrl = await deployToVercel(client.vercel_token, lead, html);
  }

  const update: Record<string, unknown> = { demo_deployed_at: new Date().toISOString() };
  if (demoUrl) update.demo_url = demoUrl;
  await sb.from("leads").update(update).eq("id", lead_id);

  return new Response(JSON.stringify({ ok: true, demo_url: demoUrl, deployed: !!demoUrl, html_length: html.length, free: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
});

// ── niche profiles (emoji, accent, 3 services) ────────────────
function nicheProfile(niche: string) {
  const n = (niche || "").toLowerCase();
  const P: Record<string, any> = {
    hvac:      { emoji: "❄️", accent: "#0071e3", tag: "Heating & Cooling Experts", svc: [["🔥","Heating Repair","Fast, reliable furnace and heat-pump service to keep you warm."],["❄️","AC Installation","Energy-efficient cooling systems installed and serviced right."],["🛠️","24/7 Emergency","Same-day emergency response when your system goes down."]] },
    plumb:     { emoji: "🔧", accent: "#0a84ff", tag: "Trusted Local Plumbers", svc: [["🚿","Repairs & Leaks","Fast fixes for leaks, clogs, and burst pipes — done right."],["🔧","Installations","Water heaters, fixtures, and re-pipes by licensed pros."],["🚨","Emergency Service","24/7 response so a small leak never becomes a flood."]] },
    roof:      { emoji: "🏠", accent: "#b45309", tag: "Roofing Done Right", svc: [["🏠","Roof Replacement","Durable, warrantied roofs built to last decades."],["🔍","Free Inspections","Honest assessments and detailed repair estimates."],["⛈️","Storm Damage","Fast insurance-friendly storm and leak repairs."]] },
    electric:  { emoji: "⚡", accent: "#f59e0b", tag: "Licensed Electricians", svc: [["⚡","Wiring & Panels","Safe, code-compliant wiring and panel upgrades."],["💡","Lighting","Indoor and outdoor lighting installs that impress."],["🚨","Emergency Calls","Fast response for outages and electrical hazards."]] },
    dent:      { emoji: "🦷", accent: "#0891b2", tag: "Gentle Modern Dentistry", svc: [["🦷","General Dentistry","Cleanings, fillings, and preventive care for the whole family."],["✨","Cosmetic","Whitening, veneers, and smile makeovers."],["🩺","Implants & More","Advanced restorative care with a gentle touch."]] },
    med:       { emoji: "💆", accent: "#db2777", tag: "Look & Feel Your Best", svc: [["✨","Facials & Skincare","Personalized treatments for radiant, healthy skin."],["💉","Injectables","Expert, natural-looking results you can trust."],["💆","Body & Wellness","Relaxing treatments in a spa-like setting."]] },
    law:       { emoji: "⚖️", accent: "#1d4ed8", tag: "Experienced Legal Counsel", svc: [["⚖️","Consultation","Clear, honest advice on your case from day one."],["📄","Representation","Aggressive, professional representation you can rely on."],["🤝","Results","A track record of standing up for our clients."]] },
    gym:       { emoji: "💪", accent: "#16a34a", tag: "Your Fitness Starts Here", svc: [["🏋️","Training","Personal and group training for every level."],["🥗","Coaching","Nutrition and accountability that gets results."],["🎯","Community","A welcoming space that keeps you coming back."]] },
    salon:     { emoji: "💇", accent: "#c026d3", tag: "Look Amazing, Feel Great", svc: [["💇","Hair","Cuts, color, and styling by talented pros."],["💅","Nails & Beauty","Manicures, treatments, and pampering."],["✨","Special Events","Get red-carpet ready for your big day."]] },
    restaurant:{ emoji: "🍽️", accent: "#ea580c", tag: "Fresh. Local. Delicious.", svc: [["🍽️","Dine In","A warm atmosphere and a menu you'll crave."],["🥡","Takeout","Your favorites, ready when you are."],["🎉","Catering","We make your events unforgettable."]] },
    auto:      { emoji: "🚗", accent: "#334155", tag: "Honest Auto Care", svc: [["🔧","Repairs","Certified techs and fair, upfront pricing."],["🛢️","Maintenance","Oil, brakes, tires — keep your car running strong."],["🔍","Diagnostics","We find the problem fast and fix it right."]] }
  };
  const key = Object.keys(P).find(k => n.includes(k));
  return key ? P[key] : { emoji: "⭐", accent: "#0071e3", tag: "Quality Service You Can Trust", svc: [["✅","Quality Work","Professional service and results that last."],["⚡","Fast Response","Prompt, reliable service when you need it."],["🤝","Local & Trusted","Proudly serving our community every day."]] };
}

function esc(s: unknown){ return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

function buildHTML(lead: Record<string, unknown>): string {
  const name  = esc(lead.business_name || "Your Business");
  const niche = esc(lead.niche || "Local Business");
  const city  = esc(lead.city || "your area");
  const phone = esc(lead.phone || "");
  const rating = Number(lead.google_rating || 0);
  const reviews = Number(lead.review_count || 0);
  const p = nicheProfile(String(lead.niche || ""));
  const accent = p.accent;
  const stars = rating ? "★".repeat(Math.round(rating)) + "☆".repeat(Math.max(0,5-Math.round(rating))) : "";
  const ratingLine = rating ? `<div class="rating">${stars} <span>${rating.toFixed(1)} from ${reviews.toLocaleString()} Google reviews</span></div>` : "";
  const telBtn = phone ? `<a href="tel:${phone.replace(/[^0-9+]/g,'')}" class="btn btn-ghost">📞 ${phone}</a>` : "";
  const svcCards = p.svc.map((s: string[]) => `<div class="card"><div class="ci">${s[0]}</div><h3>${esc(s[1])}</h3><p>${esc(s[2])}</p></div>`).join("");

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name} — ${niche} in ${city}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--a:${accent};--d:#0f172a}
html{scroll-behavior:smooth}
body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e293b;line-height:1.6}
a{text-decoration:none}
nav{position:sticky;top:0;z-index:50;background:#fff;box-shadow:0 2px 14px rgba(0,0,0,.06);display:flex;justify-content:space-between;align-items:center;padding:14px 6%}
nav .logo{font-weight:800;font-size:1.15rem;color:var(--d)}
nav .logo b{color:var(--a)}
.btn{display:inline-block;padding:12px 22px;border-radius:999px;font-weight:700;font-size:.95rem;transition:.2s;cursor:pointer;border:none}
.btn-primary{background:var(--a);color:#fff}.btn-primary:hover{filter:brightness(1.08);transform:translateY(-1px)}
.btn-ghost{background:transparent;color:#fff;border:1.5px solid rgba(255,255,255,.5)}.btn-ghost:hover{background:rgba(255,255,255,.12)}
.nav-cta{background:var(--a);color:#fff;padding:9px 18px;border-radius:999px;font-weight:700;font-size:.9rem}
.hero{background:linear-gradient(135deg,var(--d),#1e293b 60%,var(--a));color:#fff;padding:110px 6% 96px;text-align:center;position:relative;overflow:hidden}
.hero .tag{display:inline-block;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);padding:6px 16px;border-radius:999px;font-size:.82rem;font-weight:600;letter-spacing:.5px;margin-bottom:22px}
.hero h1{font-size:clamp(2.2rem,5.5vw,4rem);font-weight:900;letter-spacing:-1.5px;margin-bottom:14px}
.hero p.sub{font-size:clamp(1.05rem,2vw,1.35rem);opacity:.9;max-width:620px;margin:0 auto 20px}
.rating{margin:0 auto 26px;color:#ffd166;font-size:1.15rem}.rating span{color:rgba(255,255,255,.85);font-size:.9rem;margin-left:6px}
.hero .btns{display:flex;gap:14px;justify-content:center;flex-wrap:wrap}
section{padding:80px 6%}
.sec-head{text-align:center;max-width:640px;margin:0 auto 46px}
.sec-head span{color:var(--a);font-weight:800;text-transform:uppercase;letter-spacing:1px;font-size:.82rem}
.sec-head h2{font-size:clamp(1.8rem,4vw,2.6rem);font-weight:800;letter-spacing:-1px;margin-top:8px;color:var(--d)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:26px;max-width:1080px;margin:0 auto}
.card{background:#fff;border:1px solid #eef2f7;border-radius:20px;padding:32px 28px;box-shadow:0 8px 30px rgba(2,6,23,.05);transition:.25s}
.card:hover{transform:translateY(-6px);box-shadow:0 18px 44px rgba(2,6,23,.12)}
.card .ci{font-size:2.4rem;margin-bottom:14px}.card h3{font-size:1.2rem;margin-bottom:8px;color:var(--d)}.card p{color:#64748b;font-size:.96rem}
.why{background:#f8fafc}
.stats{display:flex;gap:40px;justify-content:center;flex-wrap:wrap;max-width:900px;margin:0 auto}
.stat{text-align:center}.stat .n{font-size:2.6rem;font-weight:900;color:var(--a);letter-spacing:-1px}.stat .l{color:#64748b;font-weight:600;font-size:.92rem}
.cta{background:linear-gradient(135deg,var(--a),var(--d));color:#fff;text-align:center;border-radius:28px;max-width:1000px;margin:0 auto;padding:64px 6%}
.cta h2{font-size:clamp(1.8rem,4vw,2.6rem);font-weight:900;letter-spacing:-1px;margin-bottom:12px}
.cta p{opacity:.9;max-width:520px;margin:0 auto 26px}
footer{background:var(--d);color:rgba(255,255,255,.6);text-align:center;padding:40px 6%;font-size:.9rem}
footer b{color:#fff}
</style></head>
<body>
<nav><div class="logo">${p.emoji} <b>${name}</b></div><a href="${BOOK}" class="nav-cta">Book Now</a></nav>
<header class="hero">
  <div class="tag">${p.emoji} ${esc(p.tag)} · ${city}</div>
  <h1>${name}</h1>
  <p class="sub">Your trusted ${niche.toLowerCase()} in ${city}. Quality work, honest pricing, and service that shows up when you need it.</p>
  ${ratingLine}
  <div class="btns"><a href="${BOOK}" class="btn btn-primary">Book a Free Consultation</a>${telBtn}</div>
</header>
<section>
  <div class="sec-head"><span>What We Do</span><h2>Services Built Around You</h2></div>
  <div class="grid">${svcCards}</div>
</section>
<section class="why">
  <div class="sec-head"><span>Why ${name}</span><h2>Trusted by Your Neighbors</h2></div>
  <div class="stats">
    ${rating ? `<div class="stat"><div class="n">${rating.toFixed(1)}★</div><div class="l">Google Rating</div></div>` : ""}
    ${reviews ? `<div class="stat"><div class="n">${reviews.toLocaleString()}</div><div class="l">Happy Customers</div></div>` : ""}
    <div class="stat"><div class="n">Local</div><div class="l">${city} & Nearby</div></div>
    <div class="stat"><div class="n">Fast</div><div class="l">Same-Day Response</div></div>
  </div>
</section>
<section>
  <div class="cta">
    <h2>Ready to Get Started?</h2>
    <p>Book a free consultation today and see why ${city} chooses ${name}.</p>
    <a href="${BOOK}" class="btn btn-primary" style="background:#fff;color:var(--a)">Book a Free Consultation</a>
    ${phone ? `<div style="margin-top:16px;opacity:.9">or call <b>${phone}</b></div>` : ""}
  </div>
</section>
<footer>© ${new Date().getFullYear()} <b>${name}</b> · ${niche} in ${city} · Website preview by AttoLeads</footer>
</body></html>`;
}

// ── Vercel deployer ───────────────────────────────────────────
async function deployToVercel(token: string, lead: Record<string, unknown>, html: string): Promise<string | null> {
  const bizName = (lead.business_name as string || "business").toLowerCase().replace(/[^a-z0-9]/g,"-").replace(/-+/g,"-").slice(0,30);
  const projectName = `af-demo-${bizName}-${Date.now().toString(36)}`;
  const authHeaders = { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" };
  try {
    const res = await fetch(`${VERCEL}/v13/deployments`, {
      method: "POST", headers: authHeaders,
      body: JSON.stringify({ name: projectName, files: [{ file: "index.html", data: btoa(unescape(encodeURIComponent(html))), encoding: "base64" }], projectSettings: { framework: null, buildCommand: null, outputDirectory: null }, target: "production" })
    });
    if (!res.ok) { console.error("[generate-site] Vercel deploy error:", res.status, (await res.text()).slice(0,200)); return null; }
    const data = await res.json();
    const deploymentId = data.id as string | undefined;
    const rawUrl = data.url as string | undefined;
    if (!rawUrl) return null;
    const finalUrl = `https://${rawUrl}`;
    if (deploymentId) {
      const started = Date.now();
      while (Date.now() - started < 60_000) {
        await new Promise(r => setTimeout(r, 4000));
        try {
          const poll = await fetch(`${VERCEL}/v13/deployments/${deploymentId}`, { headers: authHeaders });
          if (poll.ok) {
            const pd = await poll.json();
            const state = (pd.readyState || pd.status || "").toUpperCase();
            if (state === "READY") return finalUrl;
            if (state === "ERROR" || state === "CANCELED") return null;
          }
        } catch (_) {}
      }
    }
    return finalUrl;
  } catch (e) { console.error("[generate-site] Vercel fetch error:", String(e)); return null; }
}
