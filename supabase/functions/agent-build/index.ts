// AutoFlow v7 — agent-build (Builder)
// Builds a demo site for NEW leads missing one, in small batches. Calls generate-site.
// POST { dry_run?: boolean, batch?: number } — dry_run defaults TRUE.
const SUPA="https://ndwvsrtyjnaddrifafqk.supabase.co";
const CID="dc076116-c6fa-4f27-ad91-cfbd2e871a48";
const SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const CORS:Record<string,string>={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"*","Content-Type":"application/json"};
function sb(p:string){return fetch(SUPA+"/rest/v1"+p,{headers:{apikey:SRK,Authorization:"Bearer "+SRK}});}
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  let dry=true, batch=3; try{const b=await req.json();if(b&&b.dry_run===false)dry=false;if(b&&b.batch)batch=Math.min(5,+b.batch);}catch(_){}
  const leads=await sb("/leads?client_id=eq."+CID+"&demo_deployed_at=is.null&do_not_contact=eq.false&created_at=gte.2026-07-12&select=id,business_name&order=created_at.desc&limit="+batch).then(r=>r.json());
  const out:any[]=[]; let built=0;
  for(const l of leads){
    if(!dry){
      const r=await fetch(SUPA+"/functions/v1/generate-site",{method:"POST",headers:{Authorization:"Bearer "+SRK,apikey:SRK,"Content-Type":"application/json"},body:JSON.stringify({lead_id:l.id,client_id:CID})}).then(x=>x.json()).catch(()=>({}));
      out.push({business:l.business_name,demo_url:r.demo_url||null,ok:!!r.demo_url}); if(r.demo_url)built++;
    } else { out.push({business:l.business_name,would_build:true}); }
  }
  return new Response(JSON.stringify({ok:true,dry_run:dry,candidates:leads.length,built,items:out}),{headers:CORS});
});

