require('dotenv').config({ path: require('path').join(__dirname, '..', 'api', '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };

const ORDER_ID = process.argv[2] || 'OMS-E2E-948278';

async function q(table, query) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: H });
  if (!r.ok) throw new Error(`${table} ${r.status}: ${await r.text()}`);
  return r.json();
}

function extractCity(s) {
  if (!s) return '';
  return String(s).split(',')[0].trim();
}

(async () => {
  console.log('=== Order:', ORDER_ID);
  const orders = await q('orders', `select=*&id=eq.${encodeURIComponent(ORDER_ID)}`);
  if (!orders.length) { console.log('NOT FOUND'); return; }
  const o = orders[0];
  console.log(JSON.stringify(o, null, 2));

  const oCity = extractCity(o.origin);
  const dCity = extractCity(o.destination || o.dest);
  const weight = Number(o.weight || o.total_weight || 0);
  const mode = weight >= 15000 ? 'TL' : 'LTL';
  console.log(`\n=== Inferred match: oCity='${oCity}', dCity='${dCity}', weight=${weight}, mode=${mode}`);

  console.log('\n=== TL rate candidates (status=Active, mode=TL)');
  const allTL = await q('rates', `select=*&mode=eq.TL&status=eq.Active&limit=200`);
  console.log(`total active TL rates: ${allTL.length}`);
  const tlMatch = allTL.filter(r =>
    String(r.origin||'').toLowerCase().includes(oCity.toLowerCase()) &&
    String(r.dest||'').toLowerCase().includes(dCity.toLowerCase())
  );
  console.log(`TL matching ${oCity}->${dCity}:`, tlMatch.length);
  tlMatch.forEach(r => console.log(' -', r.carrier, r.origin, '->', r.dest, `$${r.rate}/mi`, 'status=', r.status));

  console.log('\n=== LTL rate candidates (status=Active, mode=LTL or null)');
  const allLTL = await q('rates', `select=*&status=eq.Active&or=(mode.eq.LTL,mode.is.null)&limit=500`);
  console.log(`total active LTL-ish rates: ${allLTL.length}`);
  const ltlMatch = allLTL.filter(r =>
    String(r.origin||'').toLowerCase().includes(oCity.toLowerCase()) &&
    String(r.dest||'').toLowerCase().includes(dCity.toLowerCase())
  );
  console.log(`LTL matching ${oCity}->${dCity}:`, ltlMatch.length);
  ltlMatch.forEach(r => console.log(' -', r.carrier, r.origin, '->', r.dest, 'min_wt=', r.czarlite_min_wt, 'max_wt=', r.czarlite_max_wt));

  console.log('\n=== Carrier flags');
  const carriers = await q('carriers', `select=name,czarlite_enabled,carrierconnect_enabled,pcmiler_enabled&limit=100`);
  const enabled = carriers.filter(c => c.czarlite_enabled || c.carrierconnect_enabled);
  console.log(`czarlite/carrierconnect-enabled carriers: ${enabled.length} / ${carriers.length}`);
  enabled.slice(0,20).forEach(c => console.log(' -', c.name, 'cz=', c.czarlite_enabled, 'cc=', c.carrierconnect_enabled));

  console.log('\n=== Lane preferences for this lane');
  const lp = await q('lane_preferences', `select=*&limit=500`).catch(e => { console.log('lane_preferences:', e.message); return []; });
  const lpMatch = lp.filter(r =>
    String(r.origin||'').toLowerCase().includes(oCity.toLowerCase()) &&
    String(r.dest||r.destination||'').toLowerCase().includes(dCity.toLowerCase())
  );
  console.log(`lane_preferences matching:`, lpMatch.length);
  lpMatch.forEach(r => console.log(' -', r));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
