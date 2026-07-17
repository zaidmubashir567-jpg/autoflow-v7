// AutoFlow v7 — agent-compose (Writer)
// Rewrites each demo-ready lead's INITIAL email into a clean, link-first message.
// Leads with the full done-for-you MARKETING offer + free website preview + a booking link.
// POST { dry_run?: boolean } — dry_run defaults to TRUE for safety.
const SUPA = "https://ndwvsrtyjnaddrifafqk.supabase.co";
const CID  = "dc076116-c6fa-4f27-ad91-cfbd2e871a48";
const SRK  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const BOOK = "https://attoleads.com/book";
const CORS: Record<string,string> = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"*", "Content-Type":"application/json" };
const ROLE = new Set(["info","sales","contact","office","admin","support","hello","service","dispatch","team","help","inquiries","customercare","bids","hr","everything","inquiry","marketing","billing","accounts","jobs","careers"]);
const FOOTER = "\n\n--\nZaid Mubashir\nAttoLeads — done-for-you marketing for local businesses\nWebsites, AI receptionists, SEO, Google & social\nhttps://attoleads.com | sales@attoleads.com\n30 N Gould St, Sheridan, WY 82801\n\nIf you'd rather not hear from me, just reply \"unsubscribe\" and I won't email you again.";

function isRole(email){ if(!email) return true; const lp = email.split("@")[0].toLowerCase(); return ROLE.has(lp); }
function firstName(o){ const t=(o||"").trim(); return (t && t.toLowerCase()!=="not found" && t.length>1) ? t.split(" ")[0] : null; }
function sb(path, opts = {}){
  return fetch(SUPA+"/rest/v1"+path, { ...opts, headers: { apikey:SRK, Authorization:"Bearer "+SRK, "Content-Type":"application/json", ...(opts.headers||{}) } });
}
async function bookUrlFor(leadId){
  try {
    const ex = await sb("/meetings?lead_id=eq."+leadId+"&status=eq.pending&select=booking_token&limit=1").then(r=>r.json());
    let tok = ex && ex[0] && ex[0].booking_token;
    if(!tok){
      const ins = await sb("/meetings", { method:"POST", headers:{ Prefer:"return=representation" }, body: JSON.stringify({ client_id:CID, lead_id:leadId, status:"pending" }) }).then(r=>r.json());
      tok = ins && ins[0] && ins[0].booking_token;
    }
    if(tok) return BOOK+"?t="+tok;
  } catch(_){}
  return BOOK;
}
function compose(L, bookUrl){
  const fn = firstName(L.owner_name);
  const greet = fn ? ("Hi "+fn+",") : "Hi there,";
  const r = L.google_rating, rc = L.review_count||0;
  let audit;
  if(rc>=100 && r>=4.5) audit = r+" stars from "+rc+" reviews is genuinely impressive — you've clearly earned the trust locally";
  else if(rc<30) audit = "you do great work, but only "+rc+" Google reviews are showing for it — most of your reputation is invisible online";
  else audit = "you've got a solid reputation, but it isn't turning into as many booked jobs online as it should";
  const niche = L.niche || "local business";
  const subject = "A free preview for "+L.business_name;
  const body = greet+"\n\nI came across "+L.business_name+" while looking at "+niche+"s in "+L.city+" — "+audit+".\n\n"
    + "I run a small marketing team that handles the whole online side for local businesses — a modern website, an AI receptionist that answers 24/7, plus Google, SEO and social — all done for you, month to month. Rather than pitch you, I built a free preview so you can just see it:\n"
    + L.demo_url+"\n\n"
    + "That link shows a faster version of your site with the AI receptionist built in — it grabs a caller's name and number and texts it straight to you, so the after-hours call doesn't slip to a competitor.\n\n"
    + "If you like it, reply and I'll show you what having us run your marketing would look like — or grab a 10-minute call directly here:\n"
    + bookUrl+"\n\n"
    + "No pressure either way. If it's not for you, keep the preview — no strings.\n\nBest,\nZaid" + FOOTER;
  return { subject, body };
}

Deno.serve(async (req) => {
  if(req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let dryRun = true;
  try { const b = await req.json(); if(b && b.dry_run === false) dryRun = false; } catch(_){}

  const leads = await sb("/leads?client_id=eq."+CID+"&demo_url=not.is.null&do_not_contact=eq.false&select=id,business_name,owner_name,city,niche,email,google_rating,review_count,demo_url&limit=400").then(r=>r.json());
  let composed = 0, inserted = 0, skipped = 0;
  const samples = [];

  for(const L of leads){
    if(!L.email || isRole(L.email)){ skipped++; continue; }
    const initial = await sb("/outreach_log?lead_id=eq."+L.id+"&follow_up_seq=eq.0&select=id,status&order=created_at.asc&limit=1").then(r=>r.json());
    const row = initial[0];
    if(row && row.status === "sent"){ skipped++; continue; }
    const bookUrl = dryRun ? BOOK : await bookUrlFor(L.id);
    const { subject, body } = compose(L, bookUrl);
    if(!dryRun){
      if(row){
        await sb("/outreach_log?id=eq."+row.id, { method:"PATCH", headers:{ Prefer:"return=minimal" }, body: JSON.stringify({ subject, body, status:"draft", follow_up_seq:0 }) });
        composed++;
      } else {
        await sb("/outreach_log", { method:"POST", headers:{ Prefer:"return=minimal" }, body: JSON.stringify({ lead_id:L.id, client_id:CID, channel:"email", subject, body, status:"draft", follow_up_seq:0 }) });
        inserted++;
      }
    } else {
      composed++;
      if(samples.length < 3) samples.push(L.business_name);
    }
  }

  return new Response(JSON.stringify({ ok:true, dry_run:dryRun, would_or_did_update:composed, inserted, skipped_role_or_sent:skipped, sample:samples }), { headers: CORS });
});
