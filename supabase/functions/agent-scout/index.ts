// AutoFlow v7 — agent-scout
// Picks a high-fit niche + US city (scoreboard + season, no repeats in 3d). Optionally scrapes.
// WIDENED: ~40 niches x ~45 cities for much broader coverage.
// POST { dry_run?: boolean } — dry_run defaults TRUE (just returns the pick).
const SUPA="https://ndwvsrtyjnaddrifafqk.supabase.co";
const CID="dc076116-c6fa-4f27-ad91-cfbd2e871a48";
const SRK=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const CORS:Record<string,string>={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"*","Content-Type":"application/json"};
const NICHES=["HVAC contractor","Plumber","Roofing contractor","Electrician","Garage door repair","Window installation","Fencing contractor","Concrete contractor","Home remodeling contractor","Painter","Tree service","Landscaper","Pool service","Pest control","Junk removal","Moving company","Cleaning service","Solar installer","Auto repair shop","Auto detailing","Dentist","Cosmetic dentist","Orthodontist","Med spa","Chiropractor","Physical therapy","Optometrist","Veterinarian","Law firm","Personal injury attorney","Accountant / CPA","Insurance agency","Financial advisor","Real estate agency","Gym / fitness studio","Yoga studio","Hair salon","Nail salon","Barber shop","Restaurant","Catering","Wedding photographer","Event venue"];
const CITIES=[["Phoenix","AZ"],["Tucson","AZ"],["Austin","TX"],["Dallas","TX"],["Fort Worth","TX"],["Houston","TX"],["San Antonio","TX"],["El Paso","TX"],["Denver","CO"],["Colorado Springs","CO"],["Charlotte","NC"],["Raleigh","NC"],["Greensboro","NC"],["Tampa","FL"],["Orlando","FL"],["Jacksonville","FL"],["Miami","FL"],["Nashville","TN"],["Memphis","TN"],["Columbus","OH"],["Cincinnati","OH"],["Cleveland","OH"],["Las Vegas","NV"],["Reno","NV"],["San Diego","CA"],["Sacramento","CA"],["Fresno","CA"],["Atlanta","GA"],["Kansas City","MO"],["St. Louis","MO"],["Salt Lake City","UT"],["Boise","ID"],["Portland","OR"],["Seattle","WA"],["Spokane","WA"],["Albuquerque","NM"],["Oklahoma City","OK"],["Tulsa","OK"],["Indianapolis","IN"],["Minneapolis","MN"],["Milwaukee","WI"],["Omaha","NE"],["Louisville","KY"],["Birmingham","AL"],["Richmond","VA"]];
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
