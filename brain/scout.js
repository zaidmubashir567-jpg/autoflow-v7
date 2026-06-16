// ============================================================
// LeadFyn — Brain: Opportunity Scout (AUTO mode)
// When AUTO mode is on in pipeline.html, runs every 24h
// Selects next best niche + city combo based on:
//   1. Niche performance history (reply rate)
//   2. Cities not recently targeted
//   3. Avoids niches with DNC spike
// Triggers run-pipeline automatically
// ============================================================

import { sb } from '../shared/auth.js';
import { getNicheHistory, getCityHistory } from '../shared/db.js';
// ↑ getNicheHistory + getCityHistory are now exported from db.js

// ── Top niche+city combos that LeadFyn can auto-suggest ────
const NICHE_ROTATION = [
  'plumber', 'electrician', 'HVAC', 'roofer', 'landscaper',
  'dentist', 'chiropractor', 'optometrist', 'veterinarian',
  'restaurant', 'coffee shop', 'bakery',
  'hair salon', 'nail salon', 'barbershop', 'spa',
  'real estate agent', 'mortgage broker', 'insurance agent',
  'personal trainer', 'yoga studio', 'gym',
  'auto repair', 'car wash', 'towing',
  'photographer', 'videographer',
  'pest control', 'cleaning service', 'mover',
  'accountant', 'attorney', 'therapist'
];

// ── Pick next opportunity ─────────────────────────────────────
export async function pickNextOpportunity(clientId, config = {}) {
  const {
    state = 'TX',        // Default state — overridden by client settings
    cities = DEFAULT_CITIES,
    lead_count = 50
  } = config;

  // Get performance history
  const [nicheHistory, cityHistory] = await Promise.all([
    getNicheHistory(clientId),
    getCityHistory(clientId)
  ]);

  // Score each niche (higher reply rate = higher score)
  const nicheScores = {};
  for (const niche of NICHE_ROTATION) {
    const history = nicheHistory[niche.toLowerCase()];
    if (history) {
      // Penalize high DNC rate, reward reply rate
      nicheScores[niche] = history.reply_rate - (history.dnc_rate * 2);
    } else {
      nicheScores[niche] = 5; // Default: untested niches get moderate score
    }
  }

  // Sort niches: best performing first, with some randomness for untested ones
  const sortedNiches = NICHE_ROTATION
    .filter(n => {
      const h = nicheHistory[n.toLowerCase()];
      // Skip if DNC rate is very high (>15%)
      return !h || h.dnc_rate < 15;
    })
    .sort((a, b) => {
      const scoreA = nicheScores[a] ?? 5;
      const scoreB = nicheScores[b] ?? 5;
      // Add small random factor to avoid always picking the same niche
      return (scoreB + Math.random() * 2) - (scoreA + Math.random() * 2);
    });

  // Pick a city not recently targeted
  const recentCities = new Set(
    cityHistory
      .filter(c => {
        const daysSince = (Date.now() - new Date(c.last_run).getTime()) / (1000 * 60 * 60 * 24);
        return daysSince < 14; // Avoid cities targeted in last 14 days
      })
      .map(c => c.city.toLowerCase())
  );

  // Prefer Tier A (high-income) cities — bigger retainer per deal
  const availableCities = sortCitiesByTier(
    cities.filter(c => !recentCities.has(c.toLowerCase()))
  );
  const pool = availableCities.length > 0 ? availableCities : sortCitiesByTier(cities);

  // Pick from the top Tier A cities with some randomness (not always the exact same city)
  const topCut = Math.min(5, pool.length);
  const city = pool[Math.floor(Math.random() * topCut)];

  const niche = sortedNiches[0] ?? NICHE_ROTATION[0];
  const tier  = getCityTier(city);
  const range = getCityRetainerRange(city);

  return {
    niche,
    city,
    state,
    lead_count,
    score: nicheScores[niche] ?? 5,
    geo_tier: tier,
    retainer_range: range,
    reason: buildReason(niche, city, nicheHistory, cityHistory, tier, range)
  };
}

// ── Trigger AUTO pipeline run ─────────────────────────────────
export async function autoRun(clientId, clientSettings = {}) {
  const opportunity = await pickNextOpportunity(clientId, {
    state: clientSettings.default_state,
    cities: clientSettings.target_cities ? JSON.parse(clientSettings.target_cities) : DEFAULT_CITIES,
    lead_count: clientSettings.daily_lead_count ?? 50
  });

  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { success: false, error: 'Not authenticated' };

  const supabaseUrl = window.__SUPABASE_URL_;
  const res = await fetch(`${supabaseUrl}/functions/v1/run-pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      client_id: clientId,
      niche: opportunity.niche,
      city: opportunity.city,
      state: opportunity.state,
      lead_count: opportunity.lead_count,
      auto_mode: true
    })
  });

  if (!res.ok) return { success: false, error: await res.text(), opportunity };

  const data = await res.json();
  return { success: true, run_id: data.run_id, opportunity };
}

// ── Check if AUTO mode should fire ───────────────────────────
export async function shouldAutoFire(clientId) {
  // Get last auto run
  const { data: lastRun } = await sb.from('pipeline_runs')
    .select('started_at')
    .eq('client_id', clientId)
    .eq('auto_mode', true)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lastRun) return true; // Never run — fire now

  const hoursSinceLast = (Date.now() - new Date(lastRun.started_at).getTime()) / (1000 * 60 * 60);
  return hoursSinceLast >= 24; // Fire once per 24h
}

// ── Reason string for UI display ─────────────────────────────
function buildReason(niche, city, nicheHistory, cityHistory, tier = 'B', range = '$800–1,200/mo') {
  const h = nicheHistory[niche.toLowerCase()];
  const tierLabel = tier === 'A' ? '🔴 Premium market' : tier === 'B' ? '🟡 Mid market' : '🔵 Value market';
  const prefix = `${tierLabel} · ${city} (${range})`;
  if (!h) return `${prefix} — ${niche} untested here, good opportunity`;
  if (h.reply_rate > 10) return `${prefix} — ${niche} performing well (${h.reply_rate.toFixed(1)}% reply rate)`;
  return `${prefix} — ${niche} rotating for fresh results`;
}

// ── Geographic Pricing Intelligence ──────────────────────────
// Cities ranked by typical retainer value.
// A = $1,500–2,500/mo  |  B = $800–1,200/mo  |  C = $500–800/mo
export const GEO_PRICING = {
  // TIER A — High-income metros, professionals pay more
  A: {
    label: 'Premium Market',
    retainer_range: '$1,500–2,500/mo',
    cities: [
      'Austin', 'San Francisco', 'Los Angeles', 'New York City', 'Boston',
      'Seattle', 'Miami', 'Denver', 'San Diego', 'Chicago',
      'Washington DC', 'Atlanta', 'Nashville', 'Charlotte', 'Scottsdale',
      'Dallas', 'Houston', 'Portland', 'Minneapolis', 'Raleigh',
      'Salt Lake City', 'Phoenix', 'Las Vegas', 'Tampa', 'Orlando',
      'San Jose', 'Oakland', 'Sacramento', 'Long Beach', 'Irvine'
    ]
  },
  // TIER B — Mid-size metros, solid spending power
  B: {
    label: 'Mid Market',
    retainer_range: '$800–1,200/mo',
    cities: [
      'Fort Worth', 'San Antonio', 'Jacksonville', 'Indianapolis', 'Columbus',
      'Louisville', 'Richmond', 'Virginia Beach', 'Norfolk', 'Omaha',
      'Kansas City', 'Oklahoma City', 'Tulsa', 'Memphis', 'Knoxville',
      'Greensboro', 'Richmond', 'Buffalo', 'Cincinnati', 'Cleveland',
      'Colorado Springs', 'Henderson', 'Mesa', 'Chandler', 'Tempe',
      'Aurora', 'Bakersfield', 'Riverside', 'Fresno', 'Stockton'
    ]
  },
  // TIER C — Smaller cities, still viable but lower average deal size
  C: {
    label: 'Value Market',
    retainer_range: '$500–800/mo',
    cities: [
      'Tucson', 'Reno', 'Salem', 'Eugene', 'Provo', 'Ogden',
      'Fort Wayne', 'Evansville', 'Duluth', 'Lincoln', 'Saint Paul',
      'Savannah', 'Augusta', 'Albuquerque', 'Santa Fe', 'Las Cruces',
      'Lexington', 'St. Petersburg', 'Lubbock', 'El Paso', 'Laredo',
      'Corpus Christi', 'Amarillo', 'Boise', 'Spokane', 'Tacoma'
    ]
  }
};

// Get tier for a city
export function getCityTier(city) {
  if (!city) return 'B';
  const c = city.toLowerCase();
  if (GEO_PRICING.A.cities.some(x => x.toLowerCase() === c)) return 'A';
  if (GEO_PRICING.B.cities.some(x => x.toLowerCase() === c)) return 'B';
  if (GEO_PRICING.C.cities.some(x => x.toLowerCase() === c)) return 'C';
  return 'B'; // Unknown city: assume mid-market
}

// Get expected retainer range for a city
export function getCityRetainerRange(city) {
  return GEO_PRICING[getCityTier(city)]?.retainer_range ?? '$800–1,200/mo';
}

// Sort cities by tier: prioritise Tier A first to maximise revenue per deal
export function sortCitiesByTier(cities = []) {
  const tierOrder = { A: 0, B: 1, C: 2 };
  return [...cities].sort((a, b) => {
    const tA = tierOrder[getCityTier(a)] ?? 1;
    const tB = tierOrder[getCityTier(b)] ?? 1;
    return tA - tB;
  });
}

// ── Default US cities for rotation ───────────────────────────
const DEFAULT_CITIES = [
  'Austin', 'Dallas', 'Houston', 'San Antonio', 'Fort Worth',
  'Phoenix', 'Tucson', 'Mesa', 'Chandler', 'Scottsdale',
  'Denver', 'Colorado Springs', 'Aurora',
  'Las Vegas', 'Henderson', 'Reno',
  'Portland', 'Salem', 'Eugene',
  'Nashville', 'Memphis', 'Knoxville',
  'Charlotte', 'Raleigh', 'Greensboro',
  'Indianapolis', 'Fort Wayne', 'Evansville',
  'Columbus', 'Cleveland', 'Cincinnati',
  'Atlanta', 'Savannah', 'Augusta',
  'Tampa', 'Orlando', 'Jacksonville', 'Miami', 'St. Petersburg',
  'Minneapolis', 'Saint Paul', 'Duluth',
  'Kansas City', 'Omaha', 'Lincoln',
  'Salt Lake City', 'Provo', 'Ogden',
  'Albuquerque', 'Santa Fe', 'Las Cruces',
  'Louisville', 'Lexington',
  'Richmond', 'Norfolk', 'Virginia Beach'
];
