// ================================================================
// AutoFlow v7 — run-pipeline  (Claude Super Brain — All 5 Phases)
// Phase 1: Claude tool-use agentic loop
// Phase 2: Intent-based scoring + review gap detection
// Phase 3: 3-touch follow-up scheduling (Day 3 / 7 / 14)
// Phase 4: AI Mini-Audit block in every outreach email
// Phase 5: Niche memory — Claude learns what works per niche
// Apollo Replacement: find_contact tool — multi-source email/phone extraction
// ================================================================
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getAdminClient, CORS } from "../_shared/helpers.ts";

// ── Tool definitions for Claude ──────────────────────────────────
const TOOLS = [
  {
    name: "search_web",
    description: "Search the web for local businesses or any information. Returns titles, URLs, and snippets from real search results.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query, e.g. 'Dentists Austin Texas reviews'" }
      },
      required: ["query"]
    }
  },
  {
    name: "fetch_page",
    description: "Fetch and read the text content of any webpage. Use this to find emails, phone numbers, owner names, social media links, and business details from a company website.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Full URL to fetch" }
      },
      required: ["url"]
    }
  },
  {
    name: "save_lead",
    description: "Save a qualified lead. Automatically schedules Day 3, 7, 14 follow-ups and generates a mini-audit block for the email. Only call for leads scoring 6+.",
    input_schema: {
      type: "object",
      properties: {
        business_name:  { type: "string" },
        website:        { type: "string" },
        email:          { type: "string" },
        phone:          { type: "string" },
        owner_name:     { type: "string" },
        address:        { type: "string" },
        score:          { type: "number", description: "1-10 qualification score" },
        score_reason:   { type: "string", description: "Why this score, 1-2 sentences" },
        audit_data: {
          type: "object",
          description: "Mini-audit findings: { review_count, review_rating, competitor_name, competitor_reviews, social_missing, website_year, top_fix }",
          properties: {
            review_count:       { type: "number", description: "Their actual Google review count" },
            review_rating:      { type: "number", description: "Their Google rating 1-5" },
            competitor_name:    { type: "string", description: "Top local competitor name" },
            competitor_reviews: { type: "number", description: "Competitor review count" },
            social_missing:     { type: "string", description: "e.g. 'No Instagram, Facebook last active 2019'" },
            website_year:       { type: "number", description: "Estimated year website was built" },
            top_fix:            { type: "string", description: "Single highest-impact improvement" }
          }
        },
        email_subject:  { type: "string" },
        email_body:     { type: "string", description: "Personalized email (200 words). Must include the mini-audit block shown in your instructions." },
        channels: {
          type: "array",
          items: { type: "string" },
          description: "All channels found: email, sms, linkedin, facebook, instagram, twitter"
        },
        social_links: {
          type: "object",
          description: "Social URLs: { linkedin: 'url', facebook: 'url', instagram: 'url' }"
        }
      },
      required: ["business_name", "score", "score_reason", "audit_data", "email_subject", "email_body", "channels"]
    }
  },
  {
    name: "update_progress",
    description: "Update the live pipeline dashboard the user is watching.",
    input_schema: {
      type: "object",
      properties: {
        node:            { type: "string", description: "Current stage, e.g. 'Discovering', 'Investigating', 'paused_approval'" },
        leads_found:     { type: "number" },
        leads_qualified: { type: "number" },
        emails_found:    { type: "number" },
        message:         { type: "string", description: "Short status line" }
      },
      required: ["node", "message"]
    }
  },
  {
    name: "send_message",
    description: "Send a message to the user in their live pipeline chat. Share findings, insights, flag opportunities. Be specific — name businesses, give real numbers.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string" },
        type: {
          type: "string",
          enum: ["info", "success", "warning", "insight"],
          description: "info=update | success=great find | warning=issue | insight=strategy"
        }
      },
      required: ["message", "type"]
    }
  },
  {
    name: "find_contact",
    description: "Apollo replacement — systematically finds email, phone, and owner name for a business. Checks website pages, Google Maps, and LinkedIn. Always call this BEFORE save_lead so you have real contact data.",
    input_schema: {
      type: "object",
      properties: {
        business_name: { type: "string", description: "Full business name" },
        website:       { type: "string", description: "Business website URL (include https://)" },
        city:          { type: "string", description: "City the business is in" },
        niche:         { type: "string", description: "Business type e.g. Dentists" }
      },
      required: ["business_name", "city", "niche"]
    }
  },
  {
    name: "save_niche_insights",
    description: "CALL THIS AT THE END OF EVERY RUN. Save what you learned about this niche so the next run starts smarter.",
    input_schema: {
      type: "object",
      properties: {
        pain_signals: {
          type: "array",
          items: { type: "string" },
          description: "Top pain signals found in this niche, e.g. ['Most dentists have <30 reviews', 'Instagram rarely used', 'Websites often 5+ years old']"
        },
        best_queries: {
          type: "array",
          items: { type: "string" },
          description: "Search queries that returned the best leads, e.g. ['dentists Austin reviews site:yelp.com', 'Austin dental office near me']"
        },
        avg_score:    { type: "number", description: "Average qualification score of leads found this run" },
        notes:        { type: "string", description: "1-2 sentence summary of what works in this niche+city combination" }
      },
      required: ["pain_signals", "best_queries", "avg_score", "notes"]
    }
  }
];

// ── Follow-up email templates (Phase 3) ──────────────────────────
function makeFollowUpEmails(businessName: string, ownerName: string | null, niche: string, city: string): Array<{seq: number; days: number; subject: string; body: string}> {
  const name = ownerName ? ` ${ownerName}` : "";
  return [
    {
      seq: 1, days: 3,
      subject: `Quick follow-up — ${businessName}`,
      body: `Hi${name},\n\nI reached out a few days ago about helping ${businessName} get more ${niche} clients in ${city}.\n\nJust wanted to make sure my message didn't get buried. The gap I spotted between you and your top local competitor is one we fix consistently — usually within 30 days.\n\nIs there a better time to connect this week?\n\n— AutoFlow AI`
    },
    {
      seq: 2, days: 7,
      subject: `Last try — ${businessName} growth opportunity`,
      body: `Hi${name},\n\nI don't want to keep filling your inbox, so this will be my last message.\n\nWe've helped ${niche} businesses in ${city} increase monthly leads by 30-60% using AI-powered review management + outreach. The businesses that act first in their area tend to lock in the advantage.\n\nIf the timing ever makes sense, I'm at your service.\n\n— AutoFlow AI`
    },
    {
      seq: 3, days: 14,
      subject: `${businessName} — one more thought`,
      body: `Hi${name},\n\nProbably not the right time — and that's totally fine.\n\nI'll leave this here: if you ever want a free 10-minute audit of your online presence vs. your top ${city} competitors, just reply and I'll put it together.\n\nNo pitch. Just data.\n\n— AutoFlow AI`
    }
  ];
}

// ── Mini-audit block builder (Phase 4) ───────────────────────────
function buildAuditBlock(auditData: Record<string,unknown>, businessName: string): string {
  const rc  = auditData.review_count    as number | undefined;
  const rr  = auditData.review_rating   as number | undefined;
  const cn  = auditData.competitor_name as string | undefined;
  const cr  = auditData.competitor_reviews as number | undefined;
  const sm  = auditData.social_missing  as string | undefined;
  const wy  = auditData.website_year    as number | undefined;
  const tf  = auditData.top_fix         as string | undefined;

  let block = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📊 QUICK AUDIT — ${businessName}\n`;
  if (rc != null) block += `⭐ Reviews: ${rc}${rr ? ` (${rr}/5)` : ""}`;
  if (cn && cr != null) block += ` vs. ${cn}: ${cr} reviews — you're losing ~${Math.round((cr - (rc ?? 0)) * 0.04)} clients/month to them`;
  block += "\n";
  if (sm) block += `📱 Social: ${sm}\n`;
  if (wy) block += `🌐 Website: Est. ${wy} — needs refresh\n`;
  if (tf) block += `🎯 Quickest win: ${tf}\n`;
  block += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  return block;
}

// ── Main handler ─────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const { run_id, client_id, city, state, niche } = body;

    if (!run_id || !client_id || !city || !niche) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    const sb = getAdminClient();

    // Load client record
    const { data: client } = await sb.from("clients").select("*").eq("id", client_id).single();
    const claudeKey = client?.claude_key || Deno.env.get("ANTHROPIC_API_KEY") || "";
    const braveKey  = client?.brave_search_key || Deno.env.get("BRAVE_SEARCH_KEY") || "";

    if (!claudeKey) {
      return new Response(JSON.stringify({ error: "No Claude API key. Add it in Credentials." }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    // ── Phase 5: Load niche memory ─────────────────────────────
    const { data: nicheMemory } = await sb.from("niche_memory")
      .select("*")
      .eq("client_id", client_id)
      .ilike("niche", niche)
      .ilike("city", city)
      .single();

    let nicheMemoryBlock = "";
    if (nicheMemory?.notes) {
      nicheMemoryBlock = `\n\n═══════════════════════════════
🧠 NICHE MEMORY (from ${nicheMemory.runs_count} previous run${nicheMemory.runs_count > 1 ? "s" : ""} in this exact niche+city)
What you learned last time:
${nicheMemory.notes}

Top pain signals in this niche:
${(nicheMemory.pain_signals || []).map((s: string) => `• ${s}`).join("\n")}

Search queries that found the best leads:
${(nicheMemory.best_queries || []).map((q: string) => `• ${q}`).join("\n")}

Previous avg lead score: ${nicheMemory.avg_score}/10

Use this intel from the first search — start with the query patterns that worked.
═══════════════════════════════`;
    }

    // Mark run as started
    await sb.from("pipeline_runs").update({
      status: "running", current_node: "SuperBrain",
      started_at: new Date().toISOString()
    }).eq("id", run_id);

    // ── Tool implementations ──────────────────────────────────

    // DuckDuckGo HTML scraping — free, no API key needed
    const searchDuckDuckGo = async (query: string): Promise<string> => {
      try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en`;
        const r = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5"
          },
          signal: AbortSignal.timeout(15000)
        });
        if (!r.ok) return JSON.stringify({ error: `DuckDuckGo returned ${r.status}` });
        const html = await r.text();

        const results: Array<{ title: string; url: string; snippet: string }> = [];
        const titleRe   = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

        const titles: Array<{ url: string; title: string }> = [];
        const snippets: string[] = [];

        let tm;
        while ((tm = titleRe.exec(html)) !== null && titles.length < 15) {
          const rawUrl = tm[1];
          const title  = tm[2].replace(/<[^>]+>/g, "").trim();
          let cleanUrl = rawUrl;
          try {
            const u = new URL(rawUrl.startsWith("http") ? rawUrl : "https://duckduckgo.com" + rawUrl);
            const uddg = u.searchParams.get("uddg");
            if (uddg) cleanUrl = decodeURIComponent(uddg);
          } catch (_) { /* keep as-is */ }
          if (title && cleanUrl.startsWith("http")) titles.push({ url: cleanUrl, title });
        }

        let sm;
        while ((sm = snippetRe.exec(html)) !== null && snippets.length < 15) {
          snippets.push(sm[1].replace(/<[^>]+>/g, "").trim());
        }

        for (let i = 0; i < Math.min(titles.length, 10); i++) {
          results.push({ title: titles[i].title, url: titles[i].url, snippet: snippets[i] || "" });
        }

        if (results.length === 0) return JSON.stringify({ error: "No results parsed from DuckDuckGo" });
        return JSON.stringify(results);
      } catch (e) {
        return JSON.stringify({ error: `DuckDuckGo failed: ${String(e)}` });
      }
    };

    const searchWeb = async (query: string): Promise<string> => {
      if (braveKey) {
        try {
          const r = await fetch(
            `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&country=us`,
            { headers: { "Accept": "application/json", "X-Subscription-Token": braveKey } }
          );
          if (r.ok) {
            const d = await r.json();
            const results = (d.web?.results || []).map((x: Record<string,string>) => ({
              title: x.title, url: x.url, snippet: x.description
            }));
            if (results.length > 0) return JSON.stringify(results);
          }
        } catch (_) { /* fall through to DuckDuckGo */ }
      }
      return searchDuckDuckGo(query);
    };

    const fetchPage = async (url: string): Promise<string> => {
      try {
        if (!url.startsWith("http")) return JSON.stringify({ error: "Invalid URL" });
        const r = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; AutoFlowBot/1.0)" },
          signal: AbortSignal.timeout(8000)
        });
        const html = await r.text();
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ").trim()
          .substring(0, 5000);
        return JSON.stringify({ url, content: text });
      } catch (e) { return JSON.stringify({ error: String(e) }); }
    };

    // ── Apollo replacement: multi-source contact finder ──────────
    const findContact = async (input: Record<string,unknown>): Promise<string> => {
      const name    = input.business_name as string;
      const website = input.website as string | undefined;
      const bCity   = input.city    as string;
      const bNiche  = input.niche   as string;

      // Regex helpers
      const emailRe = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
      const phoneRe = /(?:\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}/g;

      const extractFromText = (text: string) => {
        const emails = [...new Set((text.match(emailRe) || [])
          .filter(e => !e.includes('example') && !e.includes('domain') && !e.includes('email@') && !e.includes('sentry') && !e.includes('wix') && !e.endsWith('.png') && !e.endsWith('.jpg')))];
        const phones = [...new Set((text.match(phoneRe) || []).map(p => p.trim()))];
        return { emails, phones };
      };

      const safeFetch = async (url: string): Promise<string> => {
        try {
          const r = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; AutoFlowBot/1.0)" },
            signal: AbortSignal.timeout(8000)
          });
          if (!r.ok) return "";
          const html = await r.text();
          return html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 6000);
        } catch (_) { return ""; }
      };

      let email: string | null = null;
      let phone: string | null = null;
      let ownerName: string | null = null;
      const foundVia: string[] = [];

      // ── Step 1: Scrape website pages ─────────────────────────
      if (website) {
        const base = website.replace(/\/$/, "");
        const pagesToCheck = [base, `${base}/contact`, `${base}/contact-us`, `${base}/about`, `${base}/team`];
        for (const pageUrl of pagesToCheck) {
          const text = await safeFetch(pageUrl);
          if (!text) continue;
          const { emails, phones } = extractFromText(text);
          if (!email && emails.length) { email = emails[0]; foundVia.push(`website (${pageUrl})`); }
          if (!phone && phones.length) { phone = phones[0]; foundVia.push(`website-phone`); }
          if (email && phone) break;
        }

        // ── Step 2: Owner name — look for "owner", "founder", "Dr.", "CEO" on About page ──
        if (!ownerName) {
          const aboutText = await safeFetch(`${base}/about`);
          const ownerRe = /(?:owner|founder|ceo|president|dr\.|dentist|principal)[:\s,]+([A-Z][a-z]+ [A-Z][a-z]+)/gi;
          const ownerMatch = ownerRe.exec(aboutText);
          if (ownerMatch) { ownerName = ownerMatch[1]; foundVia.push("about-page"); }
        }
      }

      // ── Step 3: Google Maps / search for phone + owner ────────
      if (!email || !phone) {
        const mapsQuery = `${name} ${bCity} contact email phone`;
        const searchText = await safeFetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(mapsQuery)}&kl=us-en`);
        const { emails: se, phones: sp } = extractFromText(searchText);
        if (!email && se.length)  { email = se[0]; foundVia.push("search-engine"); }
        if (!phone && sp.length)  { phone = sp[0]; foundVia.push("search-phone"); }
      }

      // ── Step 4: LinkedIn for owner name ──────────────────────
      if (!ownerName) {
        const liQuery = `${bNiche} owner "${bCity}" site:linkedin.com`;
        const liText  = await safeFetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(liQuery)}&kl=us-en`);
        // Extract name from LinkedIn title pattern: "Name - Title at Company | LinkedIn"
        const liRe = /([A-Z][a-z]+ [A-Z][a-z]+)\s*[-–|]\s*(?:owner|founder|ceo|dentist|principal|president)/gi;
        const liMatch = liRe.exec(liText);
        if (liMatch) { ownerName = liMatch[1]; foundVia.push("linkedin"); }
      }

      // ── Step 5: Common email pattern fallback ─────────────────
      let emailPatterns: string[] = [];
      if (!email && website) {
        try {
          const domain = new URL(website).hostname.replace(/^www\./, "");
          emailPatterns = [`info@${domain}`, `contact@${domain}`, `hello@${domain}`, `admin@${domain}`];
          // We can't verify without sending — flag these as "guessed" for Claude to note
        } catch (_) { /* ignore */ }
      }

      return JSON.stringify({
        email,
        phone,
        owner_name: ownerName,
        found_via: foundVia,
        email_patterns: emailPatterns.length ? emailPatterns : undefined,
        note: email
          ? `✅ Real email found via ${foundVia.join(", ")}`
          : emailPatterns.length
            ? `⚠️ No email found. Likely patterns: ${emailPatterns.slice(0,2).join(", ")} — use the most business-appropriate one`
            : "❌ No email found — LinkedIn or cold-call outreach recommended"
      });
    };

    const saveLead = async (input: Record<string,unknown>): Promise<string> => {
      try {
        const { data: run } = await sb.from("pipeline_runs")
          .select("leads_found,leads_qualified,emails_found").eq("id", run_id).single();

        const { data: lead, error: le } = await sb.from("leads").insert({
          run_id, client_id,
          business_name: input.business_name,
          website:       input.website    ?? null,
          email:         input.email      ?? null,
          phone:         input.phone      ?? null,
          owner_name:    input.owner_name ?? null,
          address:       input.address    ?? null,
          score:         input.score,
          score_reason:  input.score_reason ?? null,
          channels:      input.channels   ?? ["email"],
          social_links:  input.social_links ?? {},
          status:        "qualified"
        }).select().single();

        if (le || !lead) return JSON.stringify({ error: le?.message ?? "Insert failed" });

        // Phase 4: Build mini-audit block to attach to email
        const auditData = (input.audit_data ?? {}) as Record<string,unknown>;
        const auditBlock = buildAuditBlock(auditData, input.business_name as string);

        // Initial email draft with audit block prepended
        const emailBodyWithAudit = auditBlock + "\n" + (input.email_body as string);
        await sb.from("outreach_log").insert({
          lead_id: lead.id, client_id, run_id,
          channel:      "email",
          subject:      input.email_subject,
          body:         emailBodyWithAudit,
          status:       "draft",
          sent_at:      null,
          follow_up_seq: 0
        });

        // Phase 3: Schedule 3-touch follow-up emails (Day 3 / 7 / 14)
        const followUps = makeFollowUpEmails(
          input.business_name as string,
          input.owner_name as string | null,
          niche, city
        );
        const now = Date.now();
        for (const fu of followUps) {
          const scheduled_at = new Date(now + fu.days * 24 * 60 * 60 * 1000).toISOString();
          await sb.from("outreach_log").insert({
            lead_id:       lead.id,
            client_id,
            run_id,
            channel:       "email",
            subject:       fu.subject,
            body:          fu.body,
            status:        "scheduled",
            scheduled_at,
            follow_up_seq: fu.seq,
            sent_at:       null
          });
        }

        // SMS draft if phone found
        const channels = (input.channels as string[]) ?? [];
        if (input.phone && channels.includes("sms")) {
          await sb.from("outreach_log").insert({
            lead_id: lead.id, client_id, run_id,
            channel:       "sms",
            body:          `Hi${input.owner_name ? " " + input.owner_name : ""}! I help ${niche} in ${city} get more clients with AI. Worth a quick call? — AutoFlow`,
            status:        "draft",
            sent_at:       null,
            follow_up_seq: 0
          });
        }

        // Update pipeline stats
        await sb.from("pipeline_runs").update({
          leads_found:     (run?.leads_found     ?? 0) + 1,
          leads_qualified: (run?.leads_qualified  ?? 0) + 1,
          emails_found:    (run?.emails_found     ?? 0) + (input.email ? 1 : 0)
        }).eq("id", run_id);

        return JSON.stringify({ success: true, lead_id: lead.id, follow_ups_scheduled: 3 });
      } catch (e) { return JSON.stringify({ error: String(e) }); }
    };

    // Phase 5: Save niche insights at end of run
    const saveNicheInsights = async (input: Record<string,unknown>): Promise<string> => {
      try {
        const painSignals  = (input.pain_signals  as string[]) ?? [];
        const bestQueries  = (input.best_queries  as string[]) ?? [];
        const avgScore     = (input.avg_score     as number)   ?? 0;
        const notes        = (input.notes         as string)   ?? "";

        // Upsert niche memory
        const { data: existing } = await sb.from("niche_memory")
          .select("id,runs_count,pain_signals,best_queries")
          .eq("client_id", client_id)
          .ilike("niche", niche)
          .ilike("city", city)
          .single();

        if (existing) {
          // Merge and deduplicate pain signals + queries
          const mergedPain    = [...new Set([...(existing.pain_signals ?? []), ...painSignals])].slice(0, 20);
          const mergedQueries = [...new Set([...(existing.best_queries ?? []), ...bestQueries])].slice(0, 15);
          await sb.from("niche_memory").update({
            pain_signals: mergedPain,
            best_queries: mergedQueries,
            avg_score:    Number(((existing.runs_count * (existing.avg_score ?? 0) + avgScore) / (existing.runs_count + 1)).toFixed(1)),
            runs_count:   (existing.runs_count ?? 1) + 1,
            last_run_id:  run_id,
            notes,
            updated_at:   new Date().toISOString()
          }).eq("id", existing.id);
        } else {
          await sb.from("niche_memory").insert({
            client_id, niche, city, state: state ?? null,
            pain_signals: painSignals,
            best_queries: bestQueries,
            avg_score:    avgScore,
            runs_count:   1,
            last_run_id:  run_id,
            notes
          });
        }

        return JSON.stringify({ success: true, message: "Niche memory saved for next run" });
      } catch (e) { return JSON.stringify({ error: String(e) }); }
    };

    const executeTool = async (name: string, input: Record<string,unknown>): Promise<string> => {
      if (name === "search_web")          return searchWeb(input.query as string);
      if (name === "fetch_page")          return fetchPage(input.url as string);
      if (name === "find_contact")        return findContact(input);
      if (name === "save_lead")           return saveLead(input);
      if (name === "save_niche_insights") return saveNicheInsights(input);
      if (name === "send_message") {
        await sb.from("pipeline_chat").insert({
          run_id, client_id, role: "claude",
          message: input.message, type: input.type ?? "info"
        });
        return JSON.stringify({ success: true });
      }
      if (name === "update_progress") {
        const upd: Record<string,unknown> = {
          current_node: input.node, agent_message: input.message
        };
        if (input.leads_found     != null) upd.leads_found     = input.leads_found;
        if (input.leads_qualified != null) upd.leads_qualified = input.leads_qualified;
        if (input.emails_found    != null) upd.emails_found    = input.emails_found;
        if (input.node === "paused_approval") upd.status = "paused_approval";
        await sb.from("pipeline_runs").update(upd).eq("id", run_id);
        return JSON.stringify({ success: true });
      }
      return JSON.stringify({ error: `Unknown tool: ${name}` });
    };

    // ── System prompt ──────────────────────────────────────────
    const systemPrompt = `You are AutoFlow's Claude Super Brain — an autonomous AI lead generation agent.

MISSION: Find 15-20 high-quality ${niche} businesses in ${city}, ${state}. Build complete outreach packages. You ARE the pipeline — Claude API is the ONLY requirement.${nicheMemoryBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROCESS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PHASE 1 — DISCOVER  [node: "Discovering"]
→ update_progress({node: "Discovering", message: "Searching for ${niche} in ${city}…"})
Search for "${niche} ${city} ${state}" and 2-3 variations. Also try "${niche} near ${city}" and "${niche} ${city} reviews".${nicheMemory?.best_queries?.length ? " Start with the queries from Niche Memory above." : ""}
→ send_message: what you found and how many candidates

PHASE 2 — INVESTIGATE  [node: "Investigating"]
→ update_progress({node: "Investigating", message: "Visiting business websites…"})
For each candidate, run TWO parallel tracks:

TRACK A — CONTACT EXTRACTION (Apollo replacement):
• call find_contact({business_name, website, city: "${city}", niche: "${niche}"})
  → This auto-checks website pages, Google Maps, LinkedIn, and common email patterns
  → Returns: email, phone, owner_name, found_via, email_patterns
  → If email_patterns returned (no real email found): use info@ or contact@ — flag in score_reason
  → If no email AND no patterns: still save the lead — use SMS or LinkedIn channel instead

TRACK B — AUDIT DATA (for the mini-audit block):
• fetch_page: homepage to check website age (footer copyright year) and social links
• search_web "[business name] ${city} reviews" — get their review COUNT and RATING
• search_web "[top competitor] ${city} reviews" — compare to their best local competitor
• SOCIAL CHECK: note which platforms missing (Instagram, Facebook, Google Business)
• WEBSITE AGE: estimate year from footer or design style

→ send_message("insight") for any business with <20 reviews + no social media — these are BEST leads

PHASE 3 — QUALIFY BY INTENT  [node: "Scoring"]
→ update_progress({node: "Scoring", message: "Scoring and qualifying leads…"})
Score HIGH for INTENT SIGNALS — hungry buyers who NEED help:
  9-10: Bad reviews (<3.5⭐ OR <20 reviews) + no/weak social + old website (pre-2020)
  8:    Any TWO of: few reviews, no social, old website, competitor outranking them
  7:    ONE clear gap + reachable contact + medium operation
  6:    Some opportunity + at least one contact channel found
  <6:   Skip
DO NOT score high for business SIZE alone. Small dental office with 8 reviews = 9. Large chain with great reviews = 4.

PHASE 4 — SAVE EACH LEAD ≥6 with save_lead  [node: "Emailing"]
→ update_progress({node: "Emailing", message: "Writing personalised outreach emails…"})
audit_data REQUIRED — fill in everything you found:
  review_count, review_rating, competitor_name, competitor_reviews,
  social_missing (e.g. "No Instagram, Facebook last active 2020"),
  website_year (estimate), top_fix (single best improvement)

email_body MUST follow this exact structure:
  [opening line naming their SPECIFIC pain — their actual review count, missing platform, old site year]
  [one comparison: "While [CompetitorName] has [X] reviews, you have [Y] — that's roughly [Z] clients/month going to them"]
  [one sentence: what AutoFlow fixes + how fast]
  [call to action: "Worth a 15-min call this week?"]

  [AUDIT BLOCK — the system auto-generates this from audit_data, you write the email body above it]

• Under 200 words
• No "hope this finds you well"
• No generic openers

After saving each lead:
→ update_progress({node: "Scheduling", message: "Scheduling follow-up sequences…"})
(The system auto-schedules Day 3 / 7 / 14 follow-ups when you call save_lead.)

List ALL channels in channels array: email, sms, linkedin, facebook, instagram, twitter
Include all social URLs in social_links.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMMUNICATION — send_message throughout the run:
• "info" — progress updates
• "success" — strong lead found (name it + say why)
• "warning" — issue encountered
• "insight" — strategic finding about this niche (e.g. "Most ${niche} in ${city} have <25 reviews — huge opportunity")

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FINISH — after all leads saved:
1. update_progress({node: "Learning", message: "Saving niche intelligence…"})
2. save_niche_insights — log what you learned:
   • Top pain signals you saw (be specific: "7 of 10 had <30 reviews", "Instagram missing in 80% of cases")
   • Best search queries that found leads
   • Average score of leads found
   • 1-2 sentence note for your next run in this niche

3. send_message with FULL SUMMARY:
   Total candidates found → qualified → channels breakdown → top 3 leads with their specific gaps

4. update_progress({node: "paused_approval", message: "✅ All done — ready for your review"})

Never invent contact info or review counts. Only save what you actually found.`;

    // ── Agentic loop (background) ─────────────────────────────
    (async () => {
      try {
        const memoryNote = nicheMemory
          ? `🧠 Loading niche memory from ${nicheMemory.runs_count} previous run${nicheMemory.runs_count > 1 ? "s" : ""} in ${niche}/${city}. Starting smarter...`
          : `🧠 Super Brain activated. First run in ${niche}/${city} — building niche knowledge. Searching now...`;

        await sb.from("pipeline_chat").insert({
          run_id, client_id, role: "claude",
          message: memoryNote,
          type: "info"
        });

        const messages: Record<string,unknown>[] = [{
          role: "user",
          content: `Execute your full mission: find and qualify ${niche} businesses in ${city}, ${state}. Save niche insights at the end. Report live as you work.`
        }];

        let iters = 0;
        while (iters++ < 80) {
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "x-api-key": claudeKey,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json"
            },
            body: JSON.stringify({
              model: "claude-sonnet-4-6",
              max_tokens: 8000,
              system: systemPrompt,
              tools: TOOLS,
              messages
            })
          });

          if (!res.ok) {
            const err = await res.json();
            await sb.from("pipeline_chat").insert({
              run_id, client_id, role: "claude",
              message: `⚠️ API error: ${err.error?.message ?? "unknown"}`, type: "warning"
            });
            break;
          }

          const result = await res.json();
          messages.push({ role: "assistant", content: result.content });

          if (result.stop_reason === "end_turn") break;

          if (result.stop_reason === "tool_use") {
            const toolResults: Record<string,unknown>[] = [];
            for (const block of result.content as Array<Record<string,unknown>>) {
              if (block.type === "tool_use") {
                const out = await executeTool(block.name as string, block.input as Record<string,unknown>);
                toolResults.push({ type: "tool_result", tool_use_id: block.id, content: out });
              }
            }
            messages.push({ role: "user", content: toolResults });
          }
        }

        // Ensure paused_approval status
        const { data: fr } = await sb.from("pipeline_runs").select("status").eq("id", run_id).single();
        if (fr?.status === "running") {
          await sb.from("pipeline_runs").update({
            status: "paused_approval", current_node: "paused_approval"
          }).eq("id", run_id);
        }

      } catch (err) {
        await sb.from("pipeline_runs").update({
          status: "error", error_message: String(err)
        }).eq("id", run_id);
        await sb.from("pipeline_chat").insert({
          run_id, client_id, role: "claude",
          message: `❌ Error: ${String(err)}`, type: "error"
        });
      }
    })();

    return new Response(
      JSON.stringify({ started: true, run_id }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );

  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
