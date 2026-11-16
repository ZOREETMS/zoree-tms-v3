// Run the 1,000-order bulk-plan scenario against Jev and save the result.
//   cd api && node scripts/jevBulkPlan1000.js
// Synthetic orders; calls Jev only — never the database or a carrier.
'use strict';

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { runBulkPlan1000 } = require('../services/ai/bulkPlan1000');

(async () => {
  const res = await runBulkPlan1000();
  const dir = path.join(__dirname, '..', 'eval-results');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `bulk-plan-1000-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(res, null, 2));
  console.log(JSON.stringify(res.totals, null, 2));
  console.log(`Saved ${file}`);
})().catch((e) => { console.error(e); process.exit(1); });
