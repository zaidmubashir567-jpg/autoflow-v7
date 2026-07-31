import { getAdminClient } from "../_shared/helpers.ts";

// Public demo server: returns a lead's stored demo HTML as real text/html.
Deno.serve(async (req) => {
  const h = new Headers();
  h.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { h.set("Access-Control-Allow-Headers", "*"); return new Response("ok", { headers: h }); }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) { h.set("Content-Type", "text/plain"); return new Response("Missing id", { status: 400, headers: h }); }
  try {
    const sb = getAdminClient();
    const { data, error } = await sb.storage.from("demos").download(id + ".html");
    if (error || !data) { h.set("Content-Type", "text/plain"); return new Response("Demo not found", { status: 404, headers: h }); }
    const html = await data.text();
    h.set("Content-Type", "text/html; charset=utf-8");
    h.set("Cache-Control", "public, max-age=300");
    return new Response(html, { headers: h });
  } catch (e) {
    h.set("Content-Type", "text/plain");
    return new Response("Error: " + String(e), { status: 500, headers: h });
  }
});
