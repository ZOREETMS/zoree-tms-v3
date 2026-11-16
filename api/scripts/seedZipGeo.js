// ═══════════════════════════════════════════════════════════════════
// Seed public.zip_geo — api/scripts/seedZipGeo.js
// ─────────────────────────────────────────────────────────────────────
// Loads api/migrations/data/zip_geo_seed.csv into public.zip_geo.
// Idempotent: upserts on the zip primary key, so re-running refreshes
// coordinates rather than duplicating. Run after migration 046.
//
//   node api/scripts/seedZipGeo.js
//
// Reads SUPABASE_URL / SUPABASE_SERVICE_KEY from api/.env, same as the
// API server. Chunked so a single oversized request never fails the load.
// ═══════════════════════════════════════════════════════════════════

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { getClient } = require('../services/supabase');

const CSV = path.join(__dirname, '..', 'migrations', 'data', 'zip_geo_seed.csv');
const CHUNK = 1000;

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  lines.shift(); // header
  return lines.map((line) => {
    // city is the only field that may contain a comma; split from both ends.
    const first = line.indexOf(',');
    const second = line.indexOf(',', first + 1);
    const third = line.indexOf(',', second + 1);
    const last = line.lastIndexOf(',');
    return {
      zip: line.slice(0, first),
      lat: Number(line.slice(first + 1, second)),
      lng: Number(line.slice(second + 1, third)),
      city: line.slice(third + 1, last).replace(/^"|"$/g, '').replace(/""/g, '"'),
      state: line.slice(last + 1),
    };
  });
}

(async () => {
  if (!fs.existsSync(CSV)) {
    console.error(`Seed file not found: ${CSV}`);
    process.exit(1);
  }
  const rows = parseCsv(fs.readFileSync(CSV, 'utf8'));
  const bad = rows.filter((r) => !/^\d{5}$/.test(r.zip) || !Number.isFinite(r.lat) || !Number.isFinite(r.lng) || (r.state || '').length !== 2);
  if (bad.length) {
    console.error(`Refusing to seed: ${bad.length} malformed rows, first:`, bad[0]);
    process.exit(1);
  }
  console.log(`Parsed ${rows.length} zip rows. Upserting in chunks of ${CHUNK}...`);

  const db = getClient();
  let done = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await db.from('zip_geo').upsert(chunk, { onConflict: 'zip' });
    if (error) {
      console.error(`Chunk at offset ${i} failed: ${error.message}`);
      process.exit(1);
    }
    done += chunk.length;
    if (done % 10000 === 0 || done === rows.length) console.log(`  ${done}/${rows.length}`);
  }

  const { count, error: cErr } = await db.from('zip_geo').select('zip', { count: 'exact', head: true });
  if (cErr) console.warn(`Seeded, but count check failed: ${cErr.message}`);
  else console.log(`Done. public.zip_geo now holds ${count} rows.`);
})().catch((e) => { console.error(e); process.exit(1); });
