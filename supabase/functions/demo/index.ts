import { getAdminClient, CORS } from "../_shared/helpers.ts";

// Public demo server: returns a lead's stored demo HTML with the correct
// text/html content-type so it renders as a real webpage.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return new Response("Missing id", { status: 400, headers: { ...CORS, "Content-Type": "text/plain" } });
  try {
    const sb = getAdminClient();
    const { data, error } = await sb.storage.from("demos").download(id + ".html");
    if (error || !data) return new Response("Demo not found", { status: 404, headers: { ...CORS, "Content-Type": "text/plain" } });
    const html = await data.text();
    return new Response(html, { headers: { ...CORS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" } });
  } catch (e) {
    return new Response("Error: " + String(e), { status: 500, headers: { ...CORS, "Content-Type": "text/plain" } });
  }
});
