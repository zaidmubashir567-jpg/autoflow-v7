// AutoFlow v7 — agent-send
// Server-side, cap-aware sender across ALL inboxes. Initial (day-0) emails only.
// Only sends drafts whose body carries the address footer ("30 N Gould") = composer-approved.
// POST { dry_run?: boolean }  — dry_run defaults to TRUE for safety.
const SUPA = "https://ndwvsrtyjnaddrifafqk.supabase.co";
const CID  = "dc076116-c6fa-4f27-ad91-cfbd2e871a48";
const SRK  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CORS: Record<string,string> = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"*", "Content-Type":"application/json" };
const ROLE = new Set(["info","sales","contact","office","admin","support","hello","service","dispatch","team","help","inquiries","customercare","bids","hr","everything","inquiry","marketing","billing","accounts","jobs","careers"]);

function idxFor(id: string, n: number){ return parseInt(String(id).replace(/-/g,"").slice(-6),16) % n; }
function isRole(email: string | null){ if(!email) return true; const lp = email.split("@")[0].toLowerCase(); return ROLE.has(lp); }
function b64(s: string){ return btoa(unescape(encodeURIComponent(s))); }
function b64url(s: string){ return b64(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
function encSubj(s: string){ return /[^\x00-\x7F]/.test(s) ? "=?UTF-8?B?"+b64(s)+"?=" : s; }
function sb(path: string, opts: any = {}){
  return fetch(SUPA+"/rest/v1"+path, { ...opts, headers: { apikey:SRK, Authorization:"Bearer "+SRK, "Content-Type":"application/json", ...(opts.headers||{}) } });
}
async function accessToken(ib: any){
  const body = "client_id="+encodeURIComponent(ib.gmail_client_id)+"&client_secret="+encodeURIComponent(ib.gmail_client_secret)+"&refresh_token="+encodeURIComponent(ib.gmail_refresh)+"&grant_type=refresh_token";
  const r = await fetch("https://oauth2.googleapis.com/token", { method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"}, body });
  if(!r.ok) return null;
  return (await r.json()).access_token as string;
}
async function gmailSend(at: string, raw: string){
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method:"POST", headers:{ Authorization:"Bearer "+at, "Content-Type":"application/json" }, body: JSON.stringify({ raw }) });
  if(!r.ok) return { ok:false, status:r.status };
  const j = await r.json();
  return { ok:true, id:j.id as string };
}

Deno.serve(async (req) => {
  if(req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let dryRun = true;
  try { const b = await req.json(); if(b && b.dry_run === false) dryRun = false; } catch(_){}

  const inboxes = (await sb("/sending_inboxes?client_id=eq."+CID+"&order=is_primary.desc,created_at.asc&select=*").then(r=>r.json()))
    .filter((i: any) => i.gmail_refresh && (i.status==="healthy" || i.status==="warming"));
  const N = inboxes.length;
  if(!N) return new Response(JSON.stringify({ ok:false, reason:"no active inboxes" }), { headers: CORS });

  const today = new Date().toISOString().slice(0,10);
  const sentRows = await sb("/outreach_log?client_id=eq."+CID+"&status=eq.sent&or=(follow_up_seq.is.null,follow_up_seq.eq.0)&sent_at=gte."+today+"&select=lead_id").then(r=>r.json());
  const sentToday = new Array(N).fill(0);
  for(const row of sentRows){ if(row.lead_id) sentToday[ idxFor(row.lead_id, N) ]++; }

  const drafts = await sb("/outreach_log?client_id=eq."+CID+"&status=eq.draft&or=(follow_up_seq.is.null,follow_up_seq.eq.0)&select=id,lead_id,subject,body,leads(email,do_not_contact,review_count,stage)&limit=500").then(r=>r.json());
  const eligible = drafts.filter((d: any) => {
    const L = d.leads || {};
    if(!L.email || isRole(L.email)) return false;
    if(L.do_not_contact) return false;
    if(["contacted","replied","won","lost"].includes(L.stage)) return false;
    if(!d.body || d.body.indexOf("30 N Gould") < 0) return false;
    return true;
  });

  const plan: any[] = [];
  for(let i=0;i<N;i++){
    const ib = inboxes[i];
    const remaining = Math.max(0, (ib.daily_cap||0) - sentToday[i]);
    const mine = eligible.filter((d: any) => idxFor(d.lead_id, N) === i)
      .sort((a: any,b: any) => ((b.leads?.review_count||0) - (a.leads?.review_count||0)))
      .slice(0, remaining);
    const per: any = { inbox: ib.email, cap: ib.daily_cap, sent_today: sentToday[i], remaining, picked: mine.length, sent: 0, recipients: mine.map((d: any)=> d.leads.email) };

    if(mine.length && !dryRun){
      const at = await accessToken(ib);
      if(!at){ per.error = "token_failed"; plan.push(per); continue; }
      per.recipients = [];
      for(const d of mine){
        const to = d.leads.email;
        const mime = "To: "+to+"\r\nSubject: "+encSubj(d.subject||"")+"\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=\"UTF-8\"\r\nContent-Transfer-Encoding: base64\r\n\r\n"+b64(d.body).replace(/(.{76})/g,"$1\r\n");
        const s = await gmailSend(at, b64url(mime));
        if((s as any).ok){
          await sb("/outreach_log?id=eq."+d.id, { method:"PATCH", headers:{ Prefer:"return=minimal" }, body: JSON.stringify({ status:"sent", sent_at:new Date().toISOString(), delivered:true, thread_id:(s as any).id }) });
          await sb("/leads?id=eq."+d.lead_id, { method:"PATCH", headers:{ Prefer:"return=minimal" }, body: JSON.stringify({ stage:"contacted" }) });
          per.sent++; per.recipients.push(to);
          await new Promise(r=>setTimeout(r, 1200));
        } else { per.recipients.push(to+" (FAILED "+(s as any).status+")"); }
      }
      await sb("/sending_inboxes?id=eq."+ib.id, { method:"PATCH", headers:{ Prefer:"return=minimal" }, body: JSON.stringify({ sent_today:(ib.sent_today||0)+per.sent, last_used:new Date().toISOString() }) });
    }
    plan.push(per);
  }

  return new Response(JSON.stringify({ ok:true, dry_run:dryRun, inboxes:N, plan }), { headers: CORS });
});

