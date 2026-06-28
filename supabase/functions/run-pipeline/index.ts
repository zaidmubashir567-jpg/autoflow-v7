// ================================================================
// AutoFlow v7 — run-pipeline  (Multi-call orchestration architecture)
// mode: 'discover' → finds 10 businesses, returns list (called once)
// mode: 'enrich'   → processes ONE business, saves lead (called per business)
// mode: 'finish'   → saves niche memory, marks run complete
// Frontend loops enrich calls — each ~15s, well within 150s timeout
// ================================================================
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getAdminClient, CORS, ok, err } from "../_shared/helpers.ts";

// ── Niche pain hooks ──────────────────────────────────────────────
const NICHE_PAIN: Record<string, string> = {
  'hvac':         'HVAC owners pay $187/lead on Google Ads and go broke in the off-season. They need a predictable pipeline year-round.',
  'roofer':       'Roofers rely on storm-chasing and word of mouth. Their competitors get the emergency calls first because they rank higher.',
  'dentist':      'Dentists lose new patients to corporate chains. Cancelled appointments are pure lost revenue with no system to fill them.',
  'plumber':      'Plumbers buy shared leads from HomeAdvisor and compete on price against 5 others for the same job.',
  'landscaper':   'Landscapers have extreme seasonal swings — dead in winter, overwhelmed in spring. No system to smooth it out.',
  'electrician':  '80% of electrician search traffic goes to the top 3 Google results. Most electricians don\'t appear there.',
  'chiropractor': 'Chiropractors compete with medical groups. New patients online pick whoever has 50+ reviews — most don\'t.',
  'restaurant':   'Restaurants pay delivery platforms 25-30% of every order — funding DoorDash while losing margin on every sale.',
  'hair salon':   'Salons depend on walk-ins with no system to re-activate past clients or fill slow mid-week slots.',
  'real estate':  'Agents pay $300+/lead from Zillow that goes to 5 agents simultaneously. Pure waste.',
  'auto repair':  'One bad Google review wipes out 10 referrals. Most shops have no system to collect reviews from happy customers.',
  'pest control': 'Pest control companies lose recurring contracts to Terminix/Orkin purely on visibility, not service quality.',
  'cleaning':     'Cleaning services compete on price — unless they have social proof and a professional online presence.',
  'attorney':     'Law firms lose clients in the first 10 seconds online — to competitors with more reviews and faster response times.',
  'therapist':    'Therapists rely on referrals and Psychology Today. New clients searching online almost never find private practices.',
  'mover':        'Moving companies lose bookings to larger aggregators. Most have weak Google presence and few reviews.',
  'optometrist':  'Optometrists compete with LensCrafters and Warby Parker online. Independent practices rarely rank locally.',
};

const PRICING = `STARTER $800/mo — Email outreach + lead scoring + follow-up sequences + real business website
GROWTH $1,500/mo — Starter + AI Receptionist chatbot + monthly results report
PRO $2,500/mo — Growth + unlimited city pipelines + priority support`;

// ── Follow-up email templates ─────────────────────────────────────
function makeFollowUps(bizName: string, owner: string|null, niche: string, city: string) {
  const n = owner ? ` ${owner}` : "";
  return [
    { seq:1, days:3,  subject:`Quick follow-up — ${bizName}`, body:`Hi${n},\n\nI reached out a few days ago about helping ${bizName} get more ${niche} clients in ${city}.\n\nJust wanted to make sure my message didn't get buried. The gap I spotted between you and your top local competitor is one we fix consistently — usually within 30 days.\n\nIs there a better time to connect this week?\n\n— AutoFlow AI` },
    { seq:2, days:7,  subject:`Last try — ${bizName} growth opportunity`, body:`Hi${n},\n\nI don't want to keep filling your inbox, so this will be my last message.\n\nWe've helped ${niche} businesses in ${city} increase monthly leads by 30-60% using AI-powered review management + outreach. The businesses that act first tend to lock in the advantage.\n\nIf the timing ever makes sense, I'm here.\n\n— AutoFlow AI` },
    { seq:3, days:14, subject:`${bizName} — one more thought`, body:`Hi${n},\n\nProbably not the right time — and that's totally fine.\n\nIf you ever want a free 10-minute audit of your online presence vs. your top ${city} competitors, just reply and I'll put it together. No pitch. Just data.\n\n— AutoFlow AI` },
  ];
}

// ── Fast DuckDuckGo search ────────────────────────────────────────
async function ddgSearch(query: string): Promise<string> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en`;
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept-Language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) return "";
    const html = await r.text();
    const results: {title:string; url:string; snippet:string}[] = [];
    const titleRe   = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    const titles: {url:string;title:string}[] = [];
    const snips: string[] = [];
    let tm;
    while ((tm = titleRe.exec(html)) !== null && titles.length < 12) {
      const raw = tm[1]; const title = tm[2].replace(/<[^>]+>/g,"").trim();
      let cu = raw;
      try { const u = new URL(raw.startsWith("http")?raw:"https://duckduckgo.com"+raw); const ud=u.searchParams.get("uddg"); if(ud) cu=decodeURIComponent(ud); } catch(_){}
      if (title && cu.startsWith("http")) titles.push({url:cu, title});
    }
    let sm; while((sm=snippetRe.exec(html))!==null && snips.length<12) snips.push(sm[1].replace(/<[^>]+>/g,"").trim());
    for (let i=0; i<Math.min(titles.length,8); i++) results.push({title:titles[i].title, url:titles[i].url, snippet:snips[i]||""});
    return JSON.stringify(results);
  } catch(_) { return "[]"; }
}

// ── Fast page fetch ───────────────────────────────────────────────
async function quickFetch(url: string, maxChars=4000): Promise<string> {
  try {
    const r = await fetch(url, { headers: {"User-Agent":"Mozilla/5.0 (compatible; AutoFlowBot/1.0)"}, signal: AbortSignal.timeout(4000) });
    if (!r.ok) return "";
    const html = await r.text();
    return html.replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<style[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim().substring(0,maxChars);
  } catch(_) { return ""; }
}

// ── Fast contact finder (max 2 pages + pattern fallback) ──────────
async function findContact(bizName:string, website:string|undefined, city:string) {
  const emailRe = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const phoneRe = /(?:\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}/g;
  const BAD = /example|domain|email@|sentry|wix|\.png|\.jpg|noreply|support@google|schema\.org/i;
  const extract = (t:string) => ({
    emails:[...new Set((t.match(emailRe)||[]).filter(e=>!BAD.test(e)))],
    phones:[...new Set((t.match(phoneRe)||[]).map(p=>p.trim()))]
  });

  let email:string|null=null, phone:string|null=null, ownerName:string|null=null;
  const foundVia:string[]=[];

  if (website) {
    const base = website.replace(/\/$/,"");
    const homeText = await quickFetch(base);
    const { emails:he, phones:hp } = extract(homeText);
    if (he.length) { email=he[0]; foundVia.push("homepage"); }
    if (hp.length) { phone=hp[0]; }
    const ownerRe = /(?:owner|founder|ceo|dr\.)[:\s,]+([A-Z][a-z]+ [A-Z][a-z]+)/gi;
    const om = ownerRe.exec(homeText); if(om) ownerName=om[1];

    if (!email) {
      const contactText = await quickFetch(`${base}/contact`);
      const { emails:ce, phones:cp } = extract(contactText);
      if (ce.length) { email=ce[0]; foundVia.push("contact-page"); }
      if (!phone && cp.length) phone=cp[0];
    }
  }

  // Instant pattern fallback — zero extra HTTP
  let guessedEmail:string|null = null;
  if (!email && website) {
    try {
      const domain = new URL(website).hostname.replace(/^www\./,"");
      guessedEmail = `info@${domain}`;
    } catch(_) {}
  }

  // DDG fallback only if no website at all
  if (!email && !guessedEmail) {
    try {
      const ddg = await quickFetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(`${bizName} ${city} contact email`)}&kl=us-en`);
      const { emails:se, phones:sp } = extract(ddg);
      if (se.length) { email=se[0]; foundVia.push("web-search"); }
      if (!phone && sp.length) phone=sp[0];
    } catch(_) {}
  }

  return { email: email||guessedEmail, phone, ownerName, foundVia, isGuessed: !email && !!guessedEmail };
}

// ── DISCOVER mode: search + parse 10 businesses ───────────────────
async function handleDiscover(body: Record<string,unknown>) {
  const { run_id, client_id, city, state, niche } = body as Record<string,string>;
  const sb = getAdminClient();

  await sb.from("pipeline_runs").update({
    status:"running", current_node:"Discovering",
    agent_message:`Searching for ${niche} businesses in ${city}…`, started_at: new Date().toISOString()
  }).eq("id", run_id);

  await sb.from("pipeline_chat").insert({ run_id, client_id, role:"claude", type:"info",
    message:`🔍 Searching for ${niche} businesses in ${city}, ${state}…` });

  // Two DDG searches targeting actual business websites, not articles
  const [raw1, raw2] = await Promise.all([
    ddgSearch(`${niche} ${city} ${state} contact phone`),
    ddgSearch(`"${niche}" "${city}" small business website`),
  ]);

  const results1: {title:string;url:string;snippet:string}[] = JSON.parse(raw1||"[]");
  const results2: {title:string;url:string;snippet:string}[] = JSON.parse(raw2||"[]");
  const allResults = [...results1, ...results2];

  // Skip directories, aggregators, chains, and article/list pages
  const SKIP_URL   = /yelp|yellowpages|angi|homeadvisor|thumbtack|houzz|facebook|google|bbb|angieslist|tripadvisor|wikipedia|amazon|indeed|linkedin|zillow|thumbtack|porch\.com|nextdoor|bark\.com/i;
  // Article title patterns: "10 Best...", "Top 5...", "Best X in City 2024" etc.
  const SKIP_TITLE = /^\d+\s+(best|top)|^top\s+\d+|^best\s+\w+\s+in\s|^the\s+best\s|\b202[0-9]\b|\bhow\s+to\b|\bguide\b|\breview[s]?\b|\bnear\s+me\b|\brated\b/i;

  const seen = new Set<string>();
  const businesses: {name:string; website:string}[] = [];

  for (const r of allResults) {
    if (SKIP_URL.test(r.url)) continue;
    const hostname = (() => { try { return new URL(r.url).hostname.replace(/^www\./,""); } catch(_) { return ""; } })();
    if (!hostname || seen.has(hostname)) continue;
    // Clean up title — strip location suffixes first
    const name = r.title.replace(/\s*[-|–]\s*.{0,40}$/, "").replace(/\s+/g," ").trim().slice(0,60);
    // Skip article/list titles
    if (name.length < 4 || SKIP_TITLE.test(name)) continue;
    seen.add(hostname);
    businesses.push({ name, website: `https://${hostname}` });
    if (businesses.length >= 10) break;
  }

  await sb.from("pipeline_chat").insert({ run_id, client_id, role:"claude", type:"info",
    message:`📋 Found ${businesses.length} ${niche} businesses to investigate in ${city}:\n${businesses.map((b,i)=>`${i+1}. ${b.name}`).join("\n")}` });

  return ok({ businesses, total: businesses.length });
}

// ── ENRICH mode: process ONE business → save lead + email ─────────
async function handleEnrich(body: Record<string,unknown>) {
  const { run_id, client_id, city, state, niche, business_name, website } = body as Record<string,string>;
  const sb = getAdminClient();
  const { data: client } = await sb.from("clients").select("claude_key").eq("id", client_id).single();
  const claudeKey = (client as Record<string,string>)?.claude_key || Deno.env.get("ANTHROPIC_API_KEY") || "";

  if (!claudeKey) return err("No Claude API key configured");

  await sb.from("pipeline_runs").update({
    current_node:"Investigating", agent_message:`Investigating ${business_name}…`
  }).eq("id", run_id);

  // 1. Contact info (max ~8s)
  const contact = await findContact(business_name, website, city);

  // 2. Reviews search (max ~8s)
  const reviewRaw = await ddgSearch(`"${business_name}" ${city} reviews Google rating`);
  const reviewSnippet = (() => {
    try {
      const res = JSON.parse(reviewRaw);
      return res.slice(0,3).map((r:Record<string,string>)=>r.snippet||"").join(" ").slice(0,600);
    } catch(_) { return ""; }
  })();

  // 3. Single Claude Haiku call — score + email (max ~5s)
  const nicheLower = niche.toLowerCase();
  const painKey = Object.keys(NICHE_PAIN).find(k => nicheLower.includes(k));
  const painHook = painKey ? NICHE_PAIN[painKey] : `Focus on the gap between their online presence and their top local competitor.`;

  const claudePrompt = `You are a sales AI writing cold outreach emails on behalf of AttoLeads (attoleads.com) — an AI-powered lead generation and digital marketing agency.

SENDER COMPANY: AttoLeads
SENDER WEBSITE: https://attoleads.com
BUSINESS: ${business_name}
WEBSITE: ${website || "unknown"}
CITY: ${city}, ${state||""}
EMAIL FOUND: ${contact.email || "none"}${contact.isGuessed ? " (guessed pattern)" : ""}
PHONE FOUND: ${contact.phone || "none"}
REVIEW DATA FROM SEARCH: ${reviewSnippet || "no data found"}

NICHE PAIN HOOK: ${painHook}

TASK: Return valid JSON only (no markdown, no backticks):
{
  "score": <1-10 based on need for help>,
  "score_reason": "<one sentence why>",
  "review_count": <estimated from search, or 0>,
  "review_rating": <estimated from search, or 0>,
  "competitor_name": "<top local competitor name from search>",
  "competitor_reviews": <their review count>,
  "social_missing": "<what platforms are missing e.g. No Instagram, old Facebook>",
  "website_year": <estimated year site was built, e.g. 2018>,
  "top_fix": "<single highest-impact improvement for this business>",
  "email_subject": "<compelling subject line>",
  "email_body": "<personalized 180-word email using the pain hook + their specific data. Structure: opening with pain hook + their real numbers | competitor comparison | one social proof line | what we fix | demo line: 'I built a free demo of what your site could look like: [business-name-slug]-demo.vercel.app' | AI receptionist mention | closing: 'Is this worth a 10-minute call? Reply with a time that works and I\\'ll send you the calendar link.' Sign off with: 'Best,\\nTeam AttoLeads\\nhttps://attoleads.com' NO price, NO generic opener. ALWAYS sign as AttoLeads not any other name.>"
}

SCORING GUIDE:
9-10: <20 reviews or <3.5 stars + weak/no social + old website
8: Any TWO of those gaps
7: One clear gap + contactable
6: Some opportunity + has contact method
<6: Well-established, skip

Return ONLY the JSON object, nothing else.`;

  let parsed: Record<string,unknown> = {};
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{ "x-api-key":claudeKey, "anthropic-version":"2023-06-01", "content-type":"application/json" },
      body: JSON.stringify({
        model:"claude-haiku-4-5-20251001",
        max_tokens:2048,
        messages:[{ role:"user", content:claudePrompt }]
      })
    });
    if (!res.ok) { const e = await res.json(); return err(`Claude error: ${(e as Record<string,Record<string,string>>).error?.message}`); }
    const data = await res.json() as {content:{text:string}[]};
    const text = data.content?.[0]?.text?.trim() || "{}";
    // Strip any accidental markdown fences
    const clean = text.replace(/^```(?:json)?\s*/,"").replace(/\s*```$/,"").trim();
    parsed = JSON.parse(clean);
  } catch(e) {
    return err(`Claude parse error: ${String(e)}`);
  }

  const score = (parsed.score as number) ?? 0;
  if (score < 6) {
    await sb.from("pipeline_chat").insert({ run_id, client_id, role:"claude", type:"info",
      message:`⏭️ Skipping ${business_name} — score ${score}/10 (${parsed.score_reason})` });
    return ok({ saved:false, skipped:true, reason:`Score ${score} below threshold`, business_name });
  }

  // 4. Save lead to DB
  const place_id = `ai_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  const { data:lead, error:le } = await sb.from("leads").insert({
    client_id, place_id,
    business_name,
    website:    website || null,
    email:      contact.email || null,
    phone:      contact.phone || null,
    owner_name: contact.ownerName || null,
    city, state:state||null, niche,
    score,
    score_reason: String(parsed.score_reason||""),
    social_links: {},
    qualify: true,
    stage: "new",
  }).select().single();

  if (le || !lead) {
    return err(`DB insert failed: ${le?.message}`);
  }

  // 5. Build audit block
  const auditBlock = [
    `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `📊 QUICK AUDIT — ${business_name}`,
    parsed.review_count ? `⭐ Reviews: ${parsed.review_count}${parsed.review_rating ? ` (${parsed.review_rating}/5)` : ""}${parsed.competitor_name ? ` vs. ${parsed.competitor_name}: ${parsed.competitor_reviews} reviews` : ""}` : "",
    parsed.social_missing ? `📱 Social: ${parsed.social_missing}` : "",
    parsed.website_year   ? `🌐 Website: Est. ${parsed.website_year} — needs refresh` : "",
    parsed.top_fix        ? `🎯 Quickest win: ${parsed.top_fix}` : "",
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🤖 AI RECEPTIONIST — included in our packages`,
    `Answers every visitor 24/7, captures name + phone, emails you instantly.`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`,
  ].filter(Boolean).join("\n");

  const emailBody = auditBlock + "\n" + String(parsed.email_body||"");

  // 6. Save initial email draft
  await sb.from("outreach_log").insert({
    lead_id: (lead as Record<string,string>).id, client_id, run_id,
    channel:"email",
    subject: String(parsed.email_subject||`${business_name} — quick thought`),
    body: emailBody,
    status:"draft",
    follow_up_seq:0,
  });

  // 7. Schedule Day 3/7/14 follow-ups
  const now = Date.now();
  for (const fu of makeFollowUps(business_name, contact.ownerName, niche, city)) {
    await sb.from("outreach_log").insert({
      lead_id:(lead as Record<string,string>).id, client_id, run_id,
      channel:"email", subject:fu.subject, body:fu.body,
      status:"scheduled",
      scheduled_at: new Date(now + fu.days*24*60*60*1000).toISOString(),
      follow_up_seq:fu.seq,
    });
  }

  // 8. Update pipeline stats
  const { data:runData } = await sb.from("pipeline_runs").select("leads_found,leads_qualified,emails_found").eq("id",run_id).single();
  const rd = runData as Record<string,number>|null;
  await sb.from("pipeline_runs").update({
    leads_found:     (rd?.leads_found||0)+1,
    leads_qualified: (rd?.leads_qualified||0)+1,
    emails_found:    (rd?.emails_found||0)+(contact.email?1:0),
    current_node: "Saving",
    agent_message: `Saved ${business_name} (score ${score})`,
  }).eq("id",run_id);

  // 9. Chat message
  await sb.from("pipeline_chat").insert({ run_id, client_id, role:"claude", type:"success",
    message:`✅ Lead saved: ${business_name} (Score ${score}/10)\n📧 Email: ${contact.email||"guessed"}\n📞 Phone: ${contact.phone||"none"}\n🎯 ${parsed.top_fix}` });

  return ok({ saved:true, lead_id:(lead as Record<string,string>).id, score, business_name, email: contact.email });
}

// ── FINISH mode: save niche memory + mark complete ─────────────────
async function handleFinish(body: Record<string,unknown>) {
  const { run_id, client_id, city, state, niche, leads_saved, avg_score } = body as Record<string,string|number>;
  const sb = getAdminClient();

  // Upsert niche memory
  const { data:existing } = await sb.from("niche_memory").select("id,runs_count,avg_score").eq("client_id",client_id).ilike("niche",String(niche)).ilike("city",String(city)).single();
  if (existing) {
    const ex = existing as Record<string,number>;
    await sb.from("niche_memory").update({
      avg_score: Number(((ex.runs_count*(ex.avg_score||0) + Number(avg_score||0))/(ex.runs_count+1)).toFixed(1)),
      runs_count: ex.runs_count+1, last_run_id:run_id, updated_at:new Date().toISOString()
    }).eq("id",(existing as Record<string,string>).id);
  } else {
    await sb.from("niche_memory").insert({ client_id, niche, city, state:state||null, avg_score:Number(avg_score||0), runs_count:1, last_run_id:run_id });
  }

  await sb.from("pipeline_runs").update({
    status:"paused_approval", current_node:"paused_approval",
    agent_message:`✅ Done — ${leads_saved} leads saved, ready for review`,
    completed_at: new Date().toISOString()
  }).eq("id",run_id);

  await sb.from("pipeline_chat").insert({ run_id, client_id, role:"claude", type:"success",
    message:`🎉 Pipeline complete!\n📊 ${leads_saved} qualified leads saved\n📧 Emails drafted for all leads\n📅 Follow-up sequences scheduled (Day 3, 7, 14)\n\n✅ Review leads and approve outreach below.` });

  return ok({ finished:true });
}

// ── Main handler ──────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json() as Record<string,unknown>;
    const mode = (body.mode as string) || "discover";

    if (!body.run_id || !body.client_id) return err("Missing run_id or client_id");

    if (mode === "discover") return handleDiscover(body);
    if (mode === "enrich")   return handleEnrich(body);
    if (mode === "finish")   return handleFinish(body);

    return err(`Unknown mode: ${mode}`);
  } catch(e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status:500, headers:{...CORS,"Content-Type":"application/json"}
    });
  }
});
