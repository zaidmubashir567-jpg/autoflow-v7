import { getAdminClient } from "../_shared/helpers.ts";

// Public endpoint: (1) track+redirect for links, (2) serve stored demo HTML.
Deno.serve(async (req) => {
  const h = new Headers();
  h.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { h.set("Access-Control-Allow-Headers", "*"); return new Response("ok", { headers: h }); }
  const url = new URL(req.url);
  const to = url.searchParams.get("to");
  const lead = url.searchParams.get("lead");
  const id = url.searchParams.get("id");
  // Track + redirect mode (used for booking/demo links in emails)
  if (to) {
    try { if (lead) { const sb = getAdminClient(); await sb.from("outreach_log").update({ clicked: true }).eq("lead_id", lead); } } catch (_) {}
    if (/^https?:\/\//.test(to)) { h.set("Location", to); return new Response(null, { status: 302, headers: h }); }
    h.set("Content-Type", "text/plain"); return new Response("ok", { headers: h });
  }
  // Demo-serving mode (id is the lead id)
  if (!id) { h.set("Content-Type", "text/plain"); return new Response("Missing id", { status: 400, headers: h }); }
  try {
    const sb = getAdminClient();
    try { await sb.from("outreach_log").update({ clicked: true }).eq("lead_id", id); } catch (_) {}
    const { data, error } = await sb.storage.from("demos").download(id + ".html");
    if (error || !data) { h.set("Content-Type", "text/plain"); return new Response("Demo not found", { status: 404, headers: h }); }
    const html = await data.text();
    h.set("Content-Type", "text/html; charset=utf-8");
    h.set("Cache-Control", "public, max-age=300");
    return new Response(html, { headers: h });
  } catch (e) { h.set("Content-Type", "text/plain"); return new Response("Error: " + String(e), { status: 500, headers: h }); }
});
