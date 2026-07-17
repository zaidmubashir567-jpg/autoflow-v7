// AutoFlow v7 — agent-scout
// Picks a high-fit niche + US city (scoreboard + season, no repeats in 3d). Optionally scrapes.
// POST { dry_run?: boolean } — dry_run defaults TRUE (just returns the pick).
const SUPA="https://ndwvsrtyjnaddrifafqk.supabase.co";
const CID="dc076116-c6fa-4f27-ad91-cfbd2e871a48";
const SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const CORS:Record<string,string>={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"*","Content-Type":"application/json"};
const NICHES=["HVAC contractor","Plumber","Roofing contractor","Electrician","Dentist","Med spa","Chiropractor","Law firm","Personal injury attorney","Auto repair shop","Pest control","Landscaper","Pool service","Real estate agency","Veterinarian"];
const CITIES=[["Phoenix","AZ"],["Austin","TX"],["Dallas","TX"],["Houston","TX"],["Denver","CO"],["Charlotte","NC"],["Tampa","FL"],["Nashville","TN"],["Columbus","OH"],["Las Vegas","NV"],["San Diego","CA"],["Atlanta","GA"],["Kansas City","MO"],["Salt Lake City","UT"],["Raleigh","NC"]];
function sb(p:string){return fetch(SUPA+"/rest/v1"+p,{headers:{apikey:SRK,Authorization:"Bearer "+SRK}});}
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  let dry=true; try{const b=await req.json();if(b&&b.dry_run===false)dry=false;}catch(_){}
  const recent=await sb("/pipeline_runs?client_id=eq."+CID+"&order=created_at.desc&select=niche,city&limit=30").then(r=>r.json());
  const recentKeys=new Set((recent||[]).map((r:any)=>((r.niche||"")+"|"+(r.city||"")).toLowerCase()));
  const month=new Date().getUTCMonth(); // 0=Jan
  const summer=[5,6,7].includes(month), winter=[11,0,1].includes(month);
  const seasonal = summer?["HVAC contractor","Roofing contractor","Pool service","Landscaper"] : winter?["Plumber","HVAC contractor","Roofing contractor"] : ["Landscaper","Pest control","Pool service","HVAC contractor"];
  const pool = NICHES.slice().sort((a,b)=> (seasonal.includes(b)?1:0)-(seasonal.includes(a)?1:0));
  let pick:any=null;
  for(const niche of pool){ for(const [city,state] of CITIES){ if(!recentKeys.has((niche+"|"+city).toLowerCase())){ pick={niche,city,state}; break; } } if(pick)break; }
  if(!pick) pick={niche:pool[0],city:CITIES[0][0],state:CITIES[0][1]};
  let scraped:any=null;
  if(!dry){
    const run=await fetch(SUPA+"/rest/v1/pipeline_runs",{method:"POST",headers:{apikey:SRK,Authorization:"Bearer "+SRK,"Content-Type":"application/json",Prefer:"return=representation"},body:JSON.stringify({client_id:CID,city:pick.city,state:pick.state,niche:pick.niche,status:"running",started_at:new Date().toISOString()})}).then(r=>r.json());
    const runId=run&&run[0]&&run[0].id;
    const disc=await fetch(SUPA+"/functions/v1/run-pipeline",{method:"POST",headers:{Authorization:"Bearer "+SRK,apikey:SRK,"Content-Type":"application/json"},body:JSON.stringify({mode:"discover",run_id:runId,client_id:CID,city:pick.city,state:pick.state,niche:pick.niche,max_items:40})}).then(r=>r.json()).catch(()=>({}));
    scraped={run_id:runId,businesses:(disc.businesses||[]).length};
  }
  return new Response(JSON.stringify({ok:true,dry_run:dry,pick,scraped}),{headers:CORS});
});

