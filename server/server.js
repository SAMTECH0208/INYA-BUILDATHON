// // server/server.js
// const express = require('express');
// const fs = require('fs');
// const path = require('path');
// const seedrandom = require('seedrandom');
// const cors = require('cors');

// const app = express();
// app.use(express.json());
// app.use(cors());

// // Paths
// const POLICIES_PATH = path.join(__dirname, '..', 'data', 'policies.json');
// const LOGS_DIR = path.join(__dirname, '..', 'logs');
// const EVENTS_LOG = path.join(LOGS_DIR, 'events.log');

// // Ensure logs dir exists
// if (!fs.existsSync(LOGS_DIR)) {
//   fs.mkdirSync(LOGS_DIR, { recursive: true });
// }

// // Utility: load policies fresh on each request (so you can edit the file while dev'ing)
// function loadPolicies() {
//   try {
//     const raw = fs.readFileSync(POLICIES_PATH, 'utf8');
//     const parsed = JSON.parse(raw);
//     return parsed;
//   } catch (err) {
//     console.error('Error loading policies.json:', err.message);
//     return [];
//   }
// }

// // Utility: deterministic RNG
// function rngWithSeed(seed) {
//   return seedrandom(String(seed || 'default-seed'));
// }

// // Utility: log events (append JSON line)
// function logEvent(obj) {
//   try {
//     const line = JSON.stringify(obj) + '\n';
//     fs.appendFileSync(EVENTS_LOG, line);
//   } catch (e) {
//     console.error('Failed to write event log', e);
//   }
// }

// // Disclosure string (required)
// const DISCLOSURE = "Disclosure: This is a mock quote based on an internal demo catalog. Premiums shown are illustrative only. This is not legal, tax, or financial advice.";

// /**
//  * Score a policy for a given profile.
//  * Returns { score: number, reasons: [] }
//  */
// function scorePolicy(policy, profile, rng, temperature) {
//   let score = 0;
//   const reasons = [];

//   // 1) Age eligibility
//   if (policy.eligibility && (policy.eligibility.min_age !== undefined || policy.eligibility.max_age !== undefined)) {
//     const minAge = policy.eligibility.min_age ?? -Infinity;
//     const maxAge = policy.eligibility.max_age ?? Infinity;
//     // profile.age_band expected like "26-35" or a single number string "32"
//     let low = null, high = null;
//     if (profile.age_band && profile.age_band.includes('-')) {
//       [low, high] = profile.age_band.split('-').map(s => Number(s));
//     } else if (profile.age_band) {
//       low = high = Number(profile.age_band);
//     }
//     if (low === null) {
//       // no age info: small penalty (less confident)
//       score += 0;
//     } else if (high < minAge || low > maxAge) {
//       // outside eligibility => large negative
//       score -= 100;
//       reasons.push(`Age ${profile.age_band} outside eligibility (${minAge}-${maxAge})`);
//       return { score, reasons };
//     } else {
//       score += 8;
//       reasons.push(`Fits age eligibility (${minAge}-${maxAge})`);
//     }
//   } else {
//     score += 2;
//   }

//   // 2) Risk tolerance & product type preference
//   if (profile.risk_tolerance) {
//     const rt = profile.risk_tolerance.toLowerCase();
//     if (rt === 'high' && /ulip|wealth|unit/i.test(policy.name)) {
//       score += 7;
//       reasons.push('Suitable for higher risk tolerance (investment linked)');
//     }
//     if (rt === 'low' && policy.type === 'term') {
//       score += 7;
//       reasons.push('Term plan fits low risk tolerance');
//     }
//   }

//   // 3) Premium band preference
//   if (profile.preferred_premium_band && policy.premium_yearly) {
//     // compute a representative premium (median-ish)
//     const premiumsArr = Object.values(policy.premium_yearly).map(v => Number(v));
//     const median = premiumsArr.length ? premiumsArr.sort((a,b)=>a-b)[Math.floor(premiumsArr.length/2)] : 0;
//     const band = profile.preferred_premium_band;
//     if ((band === 'under_10000' && median <= 10000) ||
//         (band === '10000_30000' && median > 10000 && median <= 30000) ||
//         (band === 'above_30000' && median > 30000)) {
//       score += 6;
//       reasons.push(`Matches preferred premium band (${band})`);
//     } else {
//       reasons.push(`Premium ${median} not matching preferred band ${band}`);
//     }
//   }

//   // 4) Dependents influence (higher sum insured preferred)
//   if (typeof profile.dependents_count === 'number' && profile.dependents_count >= 2) {
//     if (policy.type === 'health' || policy.type === 'life') {
//       score += 4;
//       reasons.push('Recommend family/coverage due to dependents');
//     }
//   }

//   // 5) Vehicle matching (for motor)
//   if (profile.vehicle_type && policy.vehicle_type) {
//     if (Array.isArray(policy.vehicle_type) && policy.vehicle_type.includes(profile.vehicle_type)) {
//       score += 6;
//       reasons.push(`Policy supports vehicle type ${profile.vehicle_type}`);
//     } else {
//       reasons.push(`Policy does not match vehicle type ${profile.vehicle_type}`);
//     }
//   }

//   // 6) Health flags (if present - conservative handling)
//   if (Array.isArray(profile.health_flags) && profile.health_flags.length > 0) {
//     if (policy.type === 'health') {
//       score += 2; // health products might still be relevant
//       reasons.push('Health product considered due to health flags');
//     } else {
//       score -= 1;
//     }
//   }

//   // 7) Deterministic noise proportional to temperature
//   const noise = (rng() * 2 - 1) * (Number(temperature) || 0) * 3;
//   score += noise;
//   reasons.push(`Deterministic noise applied (${Number(temperature)||0})`);

//   return { score, reasons };
// }

// // Convert raw policy entry into safe premium number and chosen sum insured
// function pickPremiumAndSum(policy, profile) {
//   // find chosen sum insured based on profile.preferred_sum_insured if present
//   let chosenSum = null;
//   if (Array.isArray(policy.sum_insured) && policy.sum_insured.length) {
//     chosenSum = policy.sum_insured[0];
//     if (profile && profile.preferred_sum_insured) {
//       // pick smallest sum >= preferred_sum_insured, else highest available
//       const candidate = policy.sum_insured.find(si => si >= profile.preferred_sum_insured);
//       if (candidate) chosenSum = candidate;
//       else chosenSum = policy.sum_insured[policy.sum_insured.length - 1];
//     }
//   }

//   // get premium for chosen sum
//   let basePremium = null;
//   if (chosenSum !== null && policy.premium_yearly && policy.premium_yearly[String(chosenSum)]) {
//     basePremium = Number(policy.premium_yearly[String(chosenSum)]);
//   } else if (policy.premium_yearly && policy.premium_yearly.default) {
//     basePremium = Number(policy.premium_yearly.default);
//   } else if (policy.premium_yearly) {
//     const val = Object.values(policy.premium_yearly)[0];
//     basePremium = Number(val);
//   } else {
//     basePremium = 0;
//   }

//   return { chosenSum, basePremium };
// }

// /* ------------------------
//    ROUTES
//    ------------------------ */

// // GET /policies
// app.get('/policies', (req, res) => {
//   const policies = loadPolicies();
//   res.json({count: policies.length, policies});
// });

// // POST /quote
// // Expected body: { profile: {...}, temperature: 0.0, seed: "abc123" }
// app.post('/quote', (req, res) => {
//   const { profile, temperature = 0.0, seed = 'default' } = req.body || {};

//   if (!profile) {
//     return res.status(400).json({ error: "Missing 'profile' in request body" });
//   }

//   // Basic required slot check (age_band recommended)
//   if (!profile.age_band) {
//     // we allow quote with missing age but prefer to ask — return 400 so UI can prompt
//     return res.status(400).json({ error: "profile.age_band required for deterministic quoting" });
//   }

//   const policies = loadPolicies();
//   const rng = rngWithSeed(seed);

//   // Score all policies
//   const scored = policies.map(p => {
//     const s = scorePolicy(p, profile, rng, temperature);
//     return { policy: p, score: s.score, reasons: s.reasons };
//   })
//   // exclude those strongly invalid (score very negative)
//   .filter(x => Number.isFinite(x.score) && x.score > -50)
//   .sort((a,b) => b.score - a.score);

//   // Take top 3
//   const top = scored.slice(0,3).map(item => {
//     const p = item.policy;
//     const { chosenSum, basePremium } = pickPremiumAndSum(p, profile);
//     const quoteMath = {
//       base_premium: basePremium,
//       riders: [], // stub: no auto-riders added; UI may call add_rider
//       total_premium: basePremium
//     };
//     // compact reasons: include rule-based reasons + short explanation
//     const reasons = (item.reasons || []).slice(0,5);
//     reasons.unshift(`Policy type: ${p.type}.`);
//     const confidence = Math.max(0, Math.min(1, 1 - Math.exp(-Math.max(item.score,0)/10))); // 0..1

//     return {
//       policy_id: p.policy_id || p.id || p.name,
//       name: p.name,
//       type: p.type,
//       chosen_sum_insured: chosenSum,
//       premium_yearly: quoteMath.base_premium,
//       quoteMath,
//       reasons,
//       confidence
//     };
//   });

//   const result = {
//     quote_timestamp: new Date().toISOString(),
//     seed: String(seed),
//     temperature: Number(temperature),
//     disclosure: DISCLOSURE,
//     results: top
//   };

//   // Log the quote event
//   logEvent({
//     event_type: 'quote_generated',
//     timestamp: new Date().toISOString(),
//     profile,
//     seed: String(seed),
//     temperature: Number(temperature),
//     result_policy_ids: top.map(t=>t.policy_id)
//   });

//   res.json(result);
// });

// // POST /handoff
// // body: { profile: {...}, reason: "low confidence", preferred_time: "2025-10-08T10:00:00+05:30", contact_channel: "voice" }
// app.post('/handoff', (req, res) => {
//   const { profile, reason = 'user_requested', preferred_time = null, contact_channel = 'voice' } = req.body || {};
//   if (!profile) return res.status(400).json({ error: "Missing 'profile' in request body" });

//   const ticket = {
//     ticket_id: `HB-${Date.now()}`,
//     profile,
//     reason,
//     preferred_time,
//     contact_channel,
//     status: 'scheduled',
//     created_at: new Date().toISOString()
//   };

//   logEvent({
//     event_type: 'handoff_ticket_created',
//     timestamp: new Date().toISOString(),
//     ticket
//   });

//   res.json({ ticket });
// });

// // Health-check
// app.get('/health', (req, res) => res.json({ status: 'ok', now: new Date().toISOString() }));

// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => console.log(`Stub API running on port ${PORT}`));



// server/server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const seedrandom = require('seedrandom');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Paths
const POLICIES_PATH = path.join(__dirname, '..', 'data', 'policies.json');
const LOGS_DIR = path.join(__dirname, '..', 'logs');
const EVENTS_LOG = path.join(LOGS_DIR, 'events.log');

// Ensure logs dir exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Utility: load policies fresh on each request (so you can edit the file while dev'ing)
function loadPolicies() {
  try {
    const raw = fs.readFileSync(POLICIES_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (err) {
    console.error('Error loading policies.json:', err.message);
    return [];
  }
}

// Utility: deterministic RNG
function rngWithSeed(seed) {
  return seedrandom(String(seed || 'default-seed'));
}

// Utility: log events (append JSON line)
function logEvent(obj) {
  try {
    const line = JSON.stringify(obj) + '\n';
    fs.appendFileSync(EVENTS_LOG, line);
  } catch (e) {
    console.error('Failed to write event log', e);
  }
}

// Disclosure string (required)
const DISCLOSURE = "Disclosure: This is a mock quote based on an internal demo catalog. Premiums shown are illustrative only. This is not legal, tax, or financial advice.";

/**
 * Score a policy for a given profile.
 * Returns { score: number, reasons: [] }
 */
function scorePolicy(policy, profile, rng, temperature) {
  let score = 0;
  const reasons = [];

  // 1) Age eligibility
  if (policy.eligibility && (policy.eligibility.min_age !== undefined || policy.eligibility.max_age !== undefined)) {
    const minAge = policy.eligibility.min_age ?? -Infinity;
    const maxAge = policy.eligibility.max_age ?? Infinity;
    // profile.age_band expected like "26-35" or "32"
    let low = null, high = null;
    if (profile.age_band && profile.age_band.includes('-')) {
      [low, high] = profile.age_band.split('-').map(s => Number(s));
    } else if (profile.age_band) {
      low = high = Number(profile.age_band);
    }
    if (low === null) {
      score += 0; // no info
    } else if (high < minAge || low > maxAge) {
      score -= 100;
      reasons.push(`Age ${profile.age_band} outside eligibility (${minAge}-${maxAge})`);
      return { score, reasons };
    } else {
      score += 8;
      reasons.push(`Fits age eligibility (${minAge}-${maxAge})`);
    }
  } else {
    score += 2;
  }

  // 2) Risk tolerance
  if (profile.risk_tolerance) {
    const rt = profile.risk_tolerance.toLowerCase();
    if (rt === 'high' && /ulip|wealth|unit/i.test(policy.name)) {
      score += 7;
      reasons.push('Suitable for higher risk tolerance (investment linked)');
    }
    if (rt === 'low' && policy.type === 'term') {
      score += 7;
      reasons.push('Term plan fits low risk tolerance');
    }
  }

  // 3) Premium band preference
  if (profile.preferred_premium_band && policy.premium_yearly) {
    const premiumsArr = Object.values(policy.premium_yearly).map(v => Number(v));
    const median = premiumsArr.length ? premiumsArr.sort((a,b)=>a-b)[Math.floor(premiumsArr.length/2)] : 0;
    const band = profile.preferred_premium_band;
    if ((band === 'under_10000' && median <= 10000) ||
        (band === '10000_30000' && median > 10000 && median <= 30000) ||
        (band === 'above_30000' && median > 30000)) {
      score += 6;
      reasons.push(`Matches preferred premium band (${band})`);
    } else {
      reasons.push(`Premium ${median} not matching preferred band ${band}`);
    }
  }

  // 4) Dependents influence
  if (typeof profile.dependents_count === 'number' && profile.dependents_count >= 2) {
    if (policy.type === 'health' || policy.type === 'life') {
      score += 4;
      reasons.push('Recommend family/coverage due to dependents');
    }
  }

  // 5) Vehicle matching
  if (profile.vehicle_type && policy.vehicle_type) {
    if (Array.isArray(policy.vehicle_type) && policy.vehicle_type.includes(profile.vehicle_type)) {
      score += 6;
      reasons.push(`Policy supports vehicle type ${profile.vehicle_type}`);
    } else {
      reasons.push(`Policy does not match vehicle type ${profile.vehicle_type}`);
    }
  }

  // 6) Health flags
  if (Array.isArray(profile.health_flags) && profile.health_flags.length > 0) {
    if (policy.type === 'health') {
      score += 2;
      reasons.push('Health product considered due to health flags');
    } else {
      score -= 1;
    }
  }

  // 7) Deterministic noise
  const noise = (rng() * 2 - 1) * (Number(temperature) || 0) * 3;
  score += noise;
  reasons.push(`Deterministic noise applied (${Number(temperature)||0})`);

  return { score, reasons };
}

// Convert raw policy entry into safe premium number and chosen sum insured
function pickPremiumAndSum(policy, profile) {
  let chosenSum = null;
  if (Array.isArray(policy.sum_insured) && policy.sum_insured.length) {
    chosenSum = policy.sum_insured[0];
    if (profile && profile.preferred_sum_insured) {
      const candidate = policy.sum_insured.find(si => si >= profile.preferred_sum_insured);
      if (candidate) chosenSum = candidate;
      else chosenSum = policy.sum_insured[policy.sum_insured.length - 1];
    }
  }

  let basePremium = null;
  if (chosenSum !== null && policy.premium_yearly && policy.premium_yearly[String(chosenSum)]) {
    basePremium = Number(policy.premium_yearly[String(chosenSum)]);
  } else if (policy.premium_yearly && policy.premium_yearly.default) {
    basePremium = Number(policy.premium_yearly.default);
  } else if (policy.premium_yearly) {
    const val = Object.values(policy.premium_yearly)[0];
    basePremium = Number(val);
  } else {
    basePremium = 0;
  }

  return { chosenSum, basePremium };
}

/* ------------------------
   ROUTES
   ------------------------ */

// Root route
app.get("/", (req, res) => {
  res.send("✅ Insurance Sales API is running. Try /policies, /quote, or /health");
});

// GET /policies
app.get('/policies', (req, res) => {
  const policies = loadPolicies();
  res.json({count: policies.length, policies});
});

// POST /quote
app.post('/quote', (req, res) => {
  const { profile, temperature = 0.0, seed = 'default' } = req.body || {};
  if (!profile) {
    return res.status(400).json({ error: "Missing 'profile' in request body" });
  }
  if (!profile.age_band) {
    return res.status(400).json({ error: "profile.age_band required for deterministic quoting" });
  }

  const policies = loadPolicies();
  const rng = rngWithSeed(seed);

  const scored = policies.map(p => {
    const s = scorePolicy(p, profile, rng, temperature);
    return { policy: p, score: s.score, reasons: s.reasons };
  })
  .filter(x => Number.isFinite(x.score) && x.score > -50)
  .sort((a,b) => b.score - a.score);

  const top = scored.slice(0,3).map(item => {
    const p = item.policy;
    const { chosenSum, basePremium } = pickPremiumAndSum(p, profile);
    const quoteMath = {
      base_premium: basePremium,
      riders: [],
      total_premium: basePremium
    };
    const reasons = (item.reasons || []).slice(0,5);
    reasons.unshift(`Policy type: ${p.type}.`);
    const confidence = Math.max(0, Math.min(1, 1 - Math.exp(-Math.max(item.score,0)/10)));

    return {
      policy_id: p.policy_id || p.id || p.name,
      name: p.name,
      type: p.type,
      chosen_sum_insured: chosenSum,
      premium_yearly: quoteMath.base_premium,
      quoteMath,
      reasons,
      confidence
    };
  });

  const result = {
    quote_timestamp: new Date().toISOString(),
    seed: String(seed),
    temperature: Number(temperature),
    disclosure: DISCLOSURE,
    results: top
  };

  logEvent({
    event_type: 'quote_generated',
    timestamp: new Date().toISOString(),
    profile,
    seed: String(seed),
    temperature: Number(temperature),
    result_policy_ids: top.map(t=>t.policy_id)
  });

  res.json(result);
});

// POST /handoff
app.post('/handoff', (req, res) => {
  const { profile, reason = 'user_requested', preferred_time = null, contact_channel = 'voice' } = req.body || {};
  if (!profile) return res.status(400).json({ error: "Missing 'profile' in request body" });

  const ticket = {
    ticket_id: `HB-${Date.now()}`,
    profile,
    reason,
    preferred_time,
    contact_channel,
    status: 'scheduled',
    created_at: new Date().toISOString()
  };

  logEvent({
    event_type: 'handoff_ticket_created',
    timestamp: new Date().toISOString(),
    ticket
  });

  res.json({ ticket });
});

// Health-check
app.get('/health', (req, res) => res.json({ status: 'ok', now: new Date().toISOString() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Stub API running on port ${PORT}`));
