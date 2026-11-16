// Seeded 1,000-order scenario for the bulk-plan demo. SYNTHETIC data:
// order mix, lanes and carrier profiles are generated, not customer data.
// Carrier names are fictional so no real carrier is given invented stats.
'use strict';

const ORIGIN = 'Dallas, TX DC';

// dest -> { region, miles from Dallas }
const DESTS = {
  Houston: { region: 'South', miles: 240 }, Austin: { region: 'South', miles: 195 },
  'San Antonio': { region: 'South', miles: 275 }, 'Corpus Christi': { region: 'South', miles: 410 },
  'Oklahoma City': { region: 'North', miles: 205 }, Tulsa: { region: 'North', miles: 260 },
  Wichita: { region: 'North', miles: 365 }, 'Kansas City': { region: 'North', miles: 505 },
  Shreveport: { region: 'East', miles: 190 }, 'Little Rock': { region: 'East', miles: 320 },
  Memphis: { region: 'East', miles: 450 }, 'Jackson MS': { region: 'East', miles: 405 },
  Lubbock: { region: 'West', miles: 345 }, Amarillo: { region: 'West', miles: 365 },
  Albuquerque: { region: 'West', miles: 650 }, 'El Paso': { region: 'West', miles: 635 },
  'New Orleans': { region: 'Gulf', miles: 505 }, 'Baton Rouge': { region: 'Gulf', miles: 430 },
  Mobile: { region: 'Gulf', miles: 645 }, Birmingham: { region: 'Gulf', miles: 645 },
};

// Fictional carriers. onTime varies by region; declines = recent tender declines.
const CARRIERS = {
  CA: { name: 'Carrier A', kind: 'TL', perMile: 2.05, baseFee: 150, onTime: { South: 95, North: 94, East: 93, West: 86, Gulf: 88 }, declines: { Gulf: '3 of last 10 tenders declined' } },
  CB: { name: 'Carrier B', kind: 'TL', perMile: 2.30, baseFee: 175, onTime: { South: 98, North: 97, East: 97, West: 96, Gulf: 97 } },
  CC: { name: 'Carrier C', kind: 'TL', perMile: 2.15, baseFee: 160, onTime: { South: 96, North: 92, East: 95, West: 93, Gulf: 94 } },
  RF: { name: 'Carrier R (reefer)', kind: 'REEFER', perMile: 2.70, baseFee: 200, onTime: { South: 96, North: 95, East: 95, West: 92, Gulf: 95 } },
  RS: { name: 'Carrier S (reefer)', kind: 'REEFER', perMile: 2.45, baseFee: 180, onTime: { South: 93, North: 90, East: 91, West: 85, Gulf: 90 } },
  LTL: { name: 'Carrier L (LTL)', kind: 'LTL', perCwt: 14.5, minCharge: 185, onTime: { South: 94, North: 93, East: 93, West: 91, Gulf: 92 } },
};

// mulberry32 — deterministic so every run plans the same 1,000 orders.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeight(r) {
  const x = r();
  if (x < 0.02) return 44500 + Math.round(r() * 3500); // over one truck
  if (x < 0.10) return 24000 + Math.round(r() * 16000);
  if (x < 0.40) return 12000 + Math.round(r() * 12000);
  return 1500 + Math.round(r() * 10500);
}

function generateOrders(count = 1000, seed = 20260926) {
  const r = rng(seed);
  const names = Object.keys(DESTS);
  const days = ['Tue', 'Wed', 'Thu'];
  const orders = [];
  for (let i = 1; i <= count; i += 1) {
    const dest = names[Math.floor(r() * names.length)];
    const lbs = pickWeight(r);
    const reefer = r() < 0.08;
    const appt = r() < 0.06;
    orders.push({
      id: `SO-${String(i).padStart(4, '0')}`,
      dest, region: DESTS[dest].region, miles: DESTS[dest].miles,
      lbs, plt: Math.min(30, Math.max(1, Math.ceil(lbs / 1650))),
      due: days[Math.floor(r() * days.length)],
      reefer,
      penalty: appt ? 250 + Math.round(r() * 3) * 250 : 0,
    });
  }
  return orders;
}

module.exports = { ORIGIN, DESTS, CARRIERS, generateOrders };
