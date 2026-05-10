// ============================================================
// AutoFlow v7 — Brain: Opportunity Scout (AUTO mode)
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

// ── Top niche+city combos that AutoFlow can auto-suggest ─────
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

  const availableCities = cities.filter(c => !recentCities.has(c.toLowerCase()));
  const city = availableCities.length > 0
    ? availableCities[Math.floor(Math.random() * availableCities.length)]
    : cities[Math.floor(Math.random() * cities.length)]; // All cities used — pick random

  const niche = sortedNiches[0] ?? NICHE_ROTATION[0];

  return {
    niche,
    city,
    state,
    lead_count,
    score: nicheScores[niche] ?? 5,
    reason: buildReason(niche, city, nicheHistory, cityHistory)
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

  const supabaseUrl = window.__SUPABASE_URL__;
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
function buildReason(niche, city, nicheHistory, cityHistory) {
  const h = nicheHistory[niche.toLowerCase()];
  if (!h) return `${niche} in ${city} — untested niche, good opportunity`;
  if (h.reply_rate > 10) return `${niche} performing well (${h.reply_rate.toFixed(1)}% reply rate)`;
  return `${niche} in ${city} — rotating for fresh results`;
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
