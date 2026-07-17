// AutoFlow v7 — agent-proposal
// When a lead replies interested, draft a proposal into the Proposals section (status draft).
// POST { dry_run?: boolean } — dry_run defaults to TRUE.
const SUPA="https://ndwvsrtyjnaddrifafqk.supabase.co";
const CID="dc076116-c6fa-4f27-ad91-cfbd2e871a48";
const SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const CORS:Record<string,string>={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"*","Content-Type":"application/json"};
const INTERESTED=new Set(["interested","positive","warm","meeting","yes","question"]);
function fn(o:string|null){const t=(o||"").trim();return (t&&t.toLowerCase()!=="not found"&&t.length>1)?t.split(" ")[0]:"there";}
function sb(p:string,o:any={}){return fetch(SUPA+"/rest/v1"+p,{...o,headers:{apikey:SRK,Authorization:"Bearer "+SRK,"Content-Type":"application/json",...(o.headers||{})}});}
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  let dry=true; try{const b=await req.json();if(b&&b.dry_run===false)dry=false;}catch(_){}
  const rows=await sb("/outreach_log?client_id=eq."+CID+"&replied=eq.true&select=lead_id,reply_classification,leads(business_name,owner_name,city,niche,demo_url,review_count)").then(r=>r.json());
  const seen:Record<string,boolean>={}; const out:any[]=[]; let drafted=0, manual=0;
  for(const r of rows){
    if(!r.lead_id||seen[r.lead_id])continue; seen[r.lead_id]=true;
    const cls=(r.reply_classification||"").toLowerCase();
    const L=r.leads||{};
    if(cls && !INTERESTED.has(cls) && ["not_interested","negative","unsubscribe","out_of_office","bounce"].includes(cls)) continue;
    const interested = cls && INTERESTED.has(cls);
    if(!interested){ manual++; out.push({business:L.business_name,status:"needs manual check"}); continue; }
    const exists=await sb("/proposals?lead_id=eq."+r.lead_id+"&select=id&limit=1").then(x=>x.json());
    if(exists&&exists.length){ continue; }
    const rc=L.review_count||0; let price=1500,pkg="Growth";
    if(rc<30){price=800;pkg="Starter";} else if(rc>300){price=2500;pkg="Pro";}
    const content="Proposal for "+L.business_name+" — prepared by AttoLeads\n\nHi "+fn(L.owner_name)+",\n\nThanks for replying — glad the preview landed. Here's a quick proposal based on it.\n\nWhat you saw:\n- A modern, fast, mobile-first website (preview: "+(L.demo_url||"")+")\n- An AI receptionist that answers 24/7 and texts you every caller's name and number\n- A plan to turn your reviews and local search into booked jobs\n\nPackages:\n- Starter $800/mo — outreach + lead scoring + follow-up sequences + a real business website\n- Growth $1,500/mo — everything in Starter + AI Receptionist chatbot + monthly results report\n- Pro $2,500/mo — everything in Growth + unlimited city pipelines + priority support\n\nMy recommendation for "+L.business_name+": "+pkg+" ($"+price+"/mo).\n\nIf that works, reply and I'll send the onboarding link — live within a week.\n\nBest,\nZaid\nAttoLeads - https://attoleads.com";
    if(!dry){ await sb("/proposals",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({client_id:CID,lead_id:r.lead_id,price,status:"draft",content})}); }
    drafted++; out.push({business:L.business_name,package:pkg,price});
  }
  return new Response(JSON.stringify({ok:true,dry_run:dry,drafted,needs_manual:manual,items:out}),{headers:CORS});
});

