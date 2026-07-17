// AutoFlow v7 — agent-reply
// Reads BOTH inboxes' Gmail, matches replies to leads, marks replied + classifies.
// POST { dry_run?: boolean } — dry_run defaults TRUE.
const SUPA="https://ndwvsrtyjnaddrifafqk.supabase.co";
const CID="dc076116-c6fa-4f27-ad91-cfbd2e871a48";
const SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const CORS:Record<string,string>={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"*","Content-Type":"application/json"};
function sb(p:string,o:any={}){return fetch(SUPA+"/rest/v1"+p,{...o,headers:{apikey:SRK,Authorization:"Bearer "+SRK,"Content-Type":"application/json",...(o.headers||{})}});}
async function token(ib:any){const b="client_id="+encodeURIComponent(ib.gmail_client_id)+"&client_secret="+encodeURIComponent(ib.gmail_client_secret)+"&refresh_token="+encodeURIComponent(ib.gmail_refresh)+"&grant_type=refresh_token";const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:b});if(!r.ok)return null;return (await r.json()).access_token;}
function classify(t:string){t=(t||"").toLowerCase();
  if(/unsubscribe|remove me|stop emailing/.test(t))return "unsubscribe";
  if(/out of office|automatic reply|auto-reply|on vacation/.test(t))return "out_of_office";
  if(/not interested|no thanks|no thank you|not right now|we're good|remove/.test(t))return "not_interested";
  if(/interested|yes|sounds good|how much|pricing|price|call|let's talk|tell me more|send it|schedule/.test(t))return "interested";
  return "question";}
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  let dry=true; try{const b=await req.json();if(b&&b.dry_run===false)dry=false;}catch(_){}
  const inboxes=(await sb("/sending_inboxes?client_id=eq."+CID+"&select=*").then(r=>r.json())).filter((i:any)=>i.gmail_refresh);
  const leads=await sb("/leads?client_id=eq."+CID+"&email=not.is.null&select=id,email,business_name&limit=5000").then(r=>r.json());
  const byEmail:Record<string,any>={}; for(const l of leads){ if(l.email) byEmail[l.email.toLowerCase()]=l; }
  const out:any[]=[]; let marked=0;
  for(const ib of inboxes){
    const at=await token(ib); if(!at){ out.push({inbox:ib.email,error:"token_failed"}); continue; }
    const list=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?q="+encodeURIComponent("in:inbox newer_than:5d -category:promotions -category:social")+"&maxResults=25",{headers:{Authorization:"Bearer "+at}}).then(r=>r.json());
    const ids=(list.messages||[]);
    for(const m of ids){
      const d=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/"+m.id+"?format=metadata&metadataHeaders=From&metadataHeaders=Subject",{headers:{Authorization:"Bearer "+at}}).then(r=>r.json());
      const hs=(d.payload&&d.payload.headers)||[]; const from=((hs.find((h:any)=>h.name==="From")||{}).value||""); const subj=((hs.find((h:any)=>h.name==="Subject")||{}).value||"");
      const em=(from.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)||[""])[0].toLowerCase();
      const lead=byEmail[em]; if(!lead)continue;
      const cls=classify(subj+" "+(d.snippet||""));
      out.push({inbox:ib.email,from:lead.business_name,classification:cls});
      if(!dry){
        await sb("/outreach_log?lead_id=eq."+lead.id+"&status=eq.sent",{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({replied:true,reply_classification:cls})});
        await sb("/leads?id=eq."+lead.id,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({stage:"replied"})});
        marked++;
      }
    }
  }
  return new Response(JSON.stringify({ok:true,dry_run:dry,matched:out.length,marked,replies:out}),{headers:CORS});
});

