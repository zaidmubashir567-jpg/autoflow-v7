// ================================================================
// AutoFlow v7 — run-pipeline  (Claude Super Brain)
// Claude is the entire pipeline: finds businesses, enriches contact
// info across ALL channels, qualifies, writes outreach, reports live.
// External APIs replaced by Claude tool-use + Brave Search.
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
    description: "Save a qualified lead with full contact info and personalized outreach. Only call this for leads scoring 6 or above.",
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
        email_subject:  { type: "string" },
        email_body:     { type: "string", description: "Personalized email, under 200 words" },
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
      required: ["business_name", "score", "score_reason", "email_subject", "email_body", "channels"]
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
  }
];

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

    // Mark run as started
    await sb.from("pipeline_runs").update({
      status: "running", current_node: "SuperBrain",
      started_at: new Date().toISOString()
    }).eq("id", run_id);

    // ── Tool implementations ──────────────────────────────────

    const searchWeb = async (query: string): Promise<string> => {
      if (braveKey) {
        try {
          const r = await fetch(
            `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&country=us`,
            { headers: { "Accept": "application/json", "X-Subscription-Token": braveKey } }
          );
          const d = await r.json();
          return JSON.stringify((d.web?.results || []).map((x: Record<string,string>) => ({
            title: x.title, url: x.url, snippet: x.description
          })));
        } catch (e) { return JSON.stringify({ error: String(e) }); }
      }
      // Fallback: Google Custom Search
      const gKey = client?.google_places_key || Deno.env.get("GOOGLE_API_KEY") || "";
      const cx   = Deno.env.get("GOOGLE_CSE_CX") || "";
      if (gKey && cx) {
        try {
          const r = await fetch(`https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${gKey}&cx=${cx}&num=10`);
          const d = await r.json();
          return JSON.stringify((d.items || []).map((x: Record<string,string>) => ({
            title: x.title, url: x.link, snippet: x.snippet
          })));
        } catch (e) { return JSON.stringify({ error: String(e) }); }
      }
      return JSON.stringify({ error: "Add brave_search_key in Credentials to enable web search." });
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

        // Email draft
        await sb.from("outreach_log").insert({
          lead_id: lead.id, client_id, run_id,
          channel: "email",
          subject: input.email_subject,
          body:    input.email_body,
          status:  "draft", sent_at: null
        });

        // SMS draft if phone found
        const channels = (input.channels as string[]) ?? [];
        if (input.phone && channels.includes("sms")) {
          await sb.from("outreach_log").insert({
            lead_id: lead.id, client_id, run_id,
            channel: "sms",
            body: `Hi${input.owner_name ? " " + input.owner_name : ""}! I help ${niche} in ${city} get more clients with AI. Worth a quick call? — AutoFlow`,
            status: "draft", sent_at: null
          });
        }

        // Update pipeline stats
        await sb.from("pipeline_runs").update({
          leads_found:     (run?.leads_found     ?? 0) + 1,
          leads_qualified: (run?.leads_qualified  ?? 0) + 1,
          emails_found:    (run?.emails_found     ?? 0) + (input.email ? 1 : 0)
        }).eq("id", run_id);

        return JSON.stringify({ success: true, lead_id: lead.id });
      } catch (e) { return JSON.stringify({ error: String(e) }); }
    };

    const executeTool = async (name: string, input: Record<string,unknown>): Promise<string> => {
      if (name === "search_web")   return searchWeb(input.query as string);
      if (name === "fetch_page")   return fetchPage(input.url as string);
      if (name === "save_lead")    return saveLead(input);
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
    const systemPrompt = `You are AutoFlow's Claude Super Brain — an autonomous AI lead generation agent inside an AI marketing agency.

MISSION: Find 15-20 high-quality ${niche} businesses in ${city}, ${state}. Build complete outreach packages via ALL available channels. You ARE the pipeline.

PROCESS:

PHASE 1 — DISCOVER
Search for "${niche} ${city} ${state}" and 2-3 variations. Also try "${niche} near ${city}" and "${niche} ${city} reviews". Collect 25+ candidates with websites.
→ Call send_message to tell user what you found.
→ Call update_progress({node: "Discovering", message: "..."})

PHASE 2 — INVESTIGATE
For each candidate: fetch_page their website, /contact, /about pages.
Find: owner name, email, phone, LinkedIn, Facebook, Instagram, Twitter.
If no email on site: search_web for "[business name] email" or "[owner name] LinkedIn ${city}".
→ Call send_message with interesting finds as you go.

PHASE 3 — QUALIFY (score 1-10)
8-10: Clear gap, easy to contact, medium/large business
6-7: Some opportunity, at least one contact channel
<6:  Skip — too small, no contact, saturated
→ save_lead for every business scoring 6+

PHASE 4 — WRITE OUTREACH (for each saved lead)
email_body MUST:
• Reference ONE specific thing from their actual website
• Name a real gap you spotted (old site, few reviews, no social)
• Offer AutoFlow lead gen as the solution
• End with "Worth a 15-min call this week?"
• Under 200 words, no "hope this finds you well"

PHASE 5 — CHANNELS
List ALL channels found in channels array: email, sms, linkedin, facebook, instagram, twitter
Include all social URLs in social_links.

COMMUNICATION:
Use send_message constantly — you are talking directly to the business owner watching this live.
Be specific: name businesses, give numbers, flag great opportunities with "insight" type.
Update the dashboard every 3-4 leads via update_progress.

FINISH:
After all leads saved → send_message with full summary (total found, qualified, channels breakdown, top 3 leads)
→ update_progress({node: "paused_approval", message: "Ready for your review"})

Never invent contact info. Only save what you actually found.`;

    // ── Agentic loop (background) ─────────────────────────────
    (async () => {
      try {
        await sb.from("pipeline_chat").insert({
          run_id, client_id, role: "claude",
          message: `🧠 Super Brain activated. Starting mission: ${niche} businesses in ${city}, ${state}. Searching now...`,
          type: "info"
        });

        const messages: Record<string,unknown>[] = [{
          role: "user",
          content: `Execute your full mission: find and qualify ${niche} businesses in ${city}, ${state}. Report live as you work.`
        }];

        let iters = 0;
        while (iters++ < 60) {
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
