// AutoFlow v7 — agent-analyst
// Per-niche scoreboard: sent / opened / replied / bounced, so the brain scales winners.
// Read-only. GET or POST both work.
const SUPA="https://ndwvsrtyjnaddrifafqk.supabase.co";
const CID="dc076116-c6fa-4f27-ad91-cfbd2e871a48";
const SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const CORS:Record<string,string>={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"*","Content-Type":"application/json"};
function sb(p:string){return fetch(SUPA+"/rest/v1"+p,{headers:{apikey:SRK,Authorization:"Bearer "+SRK}});}
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  const rows=await sb("/outreach_log?client_id=eq."+CID+"&status=eq.sent&select=opened,replied,bounced,leads(niche)&limit=5000").then(r=>r.json());
  const N:Record<string,any>={};
  for(const r of rows){
    const niche=((r.leads&&r.leads.niche)||"Unknown");
    if(!N[niche])N[niche]={niche,sent:0,opened:0,replied:0,bounced:0};
    N[niche].sent++; if(r.opened)N[niche].opened++; if(r.replied)N[niche].replied++; if(r.bounced)N[niche].bounced++;
  }
  const board=Object.values(N).map((n:any)=>({niche:n.niche,sent:n.sent,open_rate:n.sent?Math.round(n.opened/n.sent*100)+"%":"0%",reply_rate:n.sent?Math.round(n.replied/n.sent*100)+"%":"0%",bounce_rate:n.sent?Math.round(n.bounced/n.sent*100)+"%":"0%"})).sort((a:any,b:any)=>b.sent-a.sent);
  const totals={sent:rows.length,opened:rows.filter((r:any)=>r.opened).length,replied:rows.filter((r:any)=>r.replied).length,bounced:rows.filter((r:any)=>r.bounced).length};
  return new Response(JSON.stringify({ok:true,totals,scoreboard:board}),{headers:CORS});
});

