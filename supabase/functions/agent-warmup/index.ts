// AutoFlow v7 — agent-warmup
// Per-inbox health + dynamic cap manager. Grows each inbox's daily cap as it warms
// and stays healthy; holds/reduces if bounces spike. Pure DB, no sending.
// POST { dry_run?: boolean } — dry_run defaults to TRUE.
const SUPA = "https://ndwvsrtyjnaddrifafqk.supabase.co";
const CID  = "dc076116-c6fa-4f27-ad91-cfbd2e871a48";
const SRK  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CORS: Record<string,string> = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"*", "Content-Type":"application/json" };
// warmup ramp: cap by warmup "level"
const RAMP = [2, 3, 5, 8, 12, 18, 25, 30];

function idxFor(id: string, n: number){ return parseInt(String(id).replace(/-/g,"").slice(-6),16) % n; }
function sb(path: string, opts: any = {}){
  return fetch(SUPA+"/rest/v1"+path, { ...opts, headers: { apikey:SRK, Authorization:"Bearer "+SRK, "Content-Type":"application/json", ...(opts.headers||{}) } });
}

Deno.serve(async (req) => {
  if(req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let dryRun = true;
  try { const b = await req.json(); if(b && b.dry_run === false) dryRun = false; } catch(_){}

  const inboxes = await sb("/sending_inboxes?client_id=eq."+CID+"&order=is_primary.desc,created_at.asc&select=*").then(r=>r.json());
  const N = inboxes.length || 1;

  // last 7 days sent + bounced, per inbox (by deterministic assignment)
  const since = new Date(Date.now()-7*864e5).toISOString();
  const rows = await sb("/outreach_log?client_id=eq."+CID+"&status=eq.sent&sent_at=gte."+since+"&select=lead_id,bounced,opened").then(r=>r.json());
  const sent = new Array(N).fill(0), bounced = new Array(N).fill(0), opened = new Array(N).fill(0);
  for(const r of rows){ if(!r.lead_id) continue; const i = idxFor(r.lead_id, N); sent[i]++; if(r.bounced) bounced[i]++; if(r.opened) opened[i]++; }

  const plan: any[] = [];
  for(let i=0;i<inboxes.length;i++){
    const ib = inboxes[i];
    const s = sent[i], b = bounced[i];
    const bounceRate = s>0 ? b/s : 0;
    const openRate = s>0 ? opened[i]/s : 0;
    let level = RAMP.indexOf(ib.daily_cap);
    if(level < 0){ level = 0; for(let k=0;k<RAMP.length;k++){ if(RAMP[k] <= (ib.daily_cap||2)) level = k; } }

    let action = "hold";
    // health gate: bounce rate under 5% and at least a few sent -> allow growth
    if(bounceRate > 0.08){ level = Math.max(0, level-1); action = "reduce (high bounces)"; }
    else if(bounceRate <= 0.05 && s >= 3 && level < RAMP.length-1){ level = level+1; action = "grow (healthy)"; }

    const newCap = RAMP[level];
    let status = ib.status;
    if(bounceRate > 0.08) status = "warming";
    else if((ib.warmup_day||1) >= 14 && bounceRate <= 0.05) status = "healthy";

    const per: any = { inbox: ib.email, old_cap: ib.daily_cap, new_cap: newCap, warmup_day: (ib.warmup_day||1)+1, sent_7d: s, bounce_rate: Math.round(bounceRate*100)+"%", open_rate: Math.round(openRate*100)+"%", action, status };
    if(!dryRun){
      await sb("/sending_inboxes?id=eq."+ib.id, { method:"PATCH", headers:{ Prefer:"return=minimal" }, body: JSON.stringify({ daily_cap:newCap, warmup_day:(ib.warmup_day||1)+1, status }) });
    }
    plan.push(per);
  }
  return new Response(JSON.stringify({ ok:true, dry_run:dryRun, inboxes:plan }), { headers: CORS });
});

