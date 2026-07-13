// AutoFlow v7 — agent-ping (deploy probe)
Deno.serve((req) => {
  const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  return new Response(JSON.stringify({ ok: true, agent: "ping", version: "v1", ts: Date.now() }), { headers: CORS });
});

