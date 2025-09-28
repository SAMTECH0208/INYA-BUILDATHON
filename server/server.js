// server.js
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const seedrandom = require('seedrandom'); // npm i seedrandom
const app = express();
app.use(bodyParser.json());

const POLICIES = JSON.parse(fs.readFileSync('./policies.json','utf8')); // from above

// util: deterministic random
function randWithSeed(seed){
  return seedrandom(String(seed));
}

// GET /policies
app.get('/policies',(req,res)=>{
  res.json(POLICIES);
});

// POST /quote
// body: { profile: {...}, temperature: 0.0-1.0, seed: string/number }
app.post('/quote',(req,res)=>{
  const { profile, temperature=0.0, seed='default' } = req.body;
  // Basic validation
  if(!profile || !profile.age_band) return res.status(400).json({error:"profile.age_band required"});
  const rng = randWithSeed(seed);
  // Simple scoring: match type needs, age eligibility, income->premium band preference
  function scorePolicy(p){
    let score = 0;
    // eligibility
    if(p.eligibility && p.eligibility.min_age){
      const min = p.eligibility.min_age, max = p.eligibility.max_age;
      const [low,high] = profile.age_band.split('-').map(Number);
      if(high < min || low > max) score -= 100; // out of eligibility
      else score += 5;
    } else score += 2;
    // risk_tolerance: prefer ULIP if high risk, prefer term if low
    if(profile.risk_tolerance){
      if(profile.risk_tolerance==='high' && p.name.toLowerCase().includes('ulp' || 'unit') ) score += 8;
      if(profile.risk_tolerance==='low' && p.type==='term') score += 8;
    }
    // premium band: prefer matching premium
    if(profile.preferred_premium_band){
      const band = profile.preferred_premium_band; // e.g., "under_10000", "10000_30000", "above_30000"
      // simple heuristic using policy premium median (if available)
      const premiums = Object.values(p.premium_yearly).map(v => typeof v==='number'?v:(v.default?v.default:0));
      const median = premiums.length? premiums.sort((a,b)=>a-b)[Math.floor(premiums.length/2)]:0;
      if(band==='under_10000' && median<=10000) score+=6;
      if(band==='10000_30000' && median>10000 && median<=30000) score+=6;
      if(band==='above_30000' && median>30000) score+=6;
    }
    // add small deterministic noise from seed + temperature
    const noise = (rng()*2 -1) * temperature * 2;
    return score + noise;
  }

  const scored = POLICIES.map(p => ({policy:p,score:scorePolicy(p)}))
                         .filter(s=>s.score>-50) // exclude invalid ones
                         .sort((a,b)=>b.score-a.score)
                         .slice(0,3);

  // price math: choose suggested sum insured and compute premium
  const results = scored.map(s=>{
    const p = s.policy;
    // choose smallest sum_insured >= suggested from profile or first
    let chosenSum = p.sum_insured && p.sum_insured.length? p.sum_insured[0]: null;
    if(profile.preferred_sum_insured){
      const pick = p.sum_insured && p.sum_insured.find(si=>si>=profile.preferred_sum_insured);
      if(pick) chosenSum = pick;
    }
    const premium = (p.premium_yearly && p.premium_yearly[String(chosenSum)]) || p.premium_yearly.default || Object.values(p.premium_yearly)[0];
    const reason = `Matches needs: type=${p.type}; fits age band; premium ~ ${premium} yearly.`;
    return {
      policy_id:p.policy_id,
      name:p.name,
      chosen_sum_insured:chosenSum,
      premium_yearly:premium,
      reasons:[reason],
      quote_math:{
        base_premium:premium,
        riders:[],
        total_premium:premium
      }
    };
  });

  // Log (server-side)
  console.log('QUOTE_REQUEST', {profile, temperature, seed, result_ids: results.map(r=>r.policy_id)});

  res.json({quote_timestamp:new Date().toISOString(),results});
});

// POST /handoff
// body: {profile, reason, preferred_time, contact_channel}
app.post('/handoff',(req,res)=>{
  const { profile, reason, preferred_time, contact_channel } = req.body;
  const ticket = {
    ticket_id: 'HB-'+Date.now(),
    profile, reason, preferred_time, contact_channel,
    status:'scheduled',
    created_at:new Date().toISOString()
  };
  console.log('HANDOFF_TICKET', ticket);
  res.json({ticket});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`Stub API running on ${PORT}`));

