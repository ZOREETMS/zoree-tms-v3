// ═══════════════════════════════════════════════════════════════════
// Supabase migration runner — uses Supabase CLI (npx supabase db execute)
// Usage:
//   node scripts/run-migration.js api/migrations/NNN_file.sql
//
// Requires in api/.env:
//   SUPABASE_ACCESS_TOKEN  — personal access token (sbp_...)
//   SUPABASE_PROJECT_REF   — project ref (ljbeihotrmyqthxptcgp)
// ═══════════════════════════════════════════════════════════════════

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Load api/.env
try {
  require('dotenv').config({ path: path.resolve(__dirname, '..', 'api', '.env') });
} catch (_) {}

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF  = process.env.SUPABASE_PROJECT_REF || 'ljbeihotrmyqthxptcgp';

const sqlPath = process.argv[2];
if (!sqlPath) {
  console.error('Usage: node scripts/run-migration.js <path-to-sql>');
  process.exit(2);
}

if (!fs.existsSync(sqlPath)) {
  console.error(`[run-migration] File not found: ${sqlPath}`);
  process.exit(2);
}

console.log(`[run-migration] file:    ${sqlPath}`);
console.log(`[run-migration] project: ${PROJECT_REF}`);
console.log(`[run-migration] running via supabase CLI...`);

try {
  const result = execSync(
    `npx supabase db query --linked -f "${sqlPath}"`,
    {
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: ACCESS_TOKEN },
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      stdio: 'pipe',
    }
  );
  console.log('[run-migration] SUCCESS');
  if (result) console.log(result);
} catch (err) {
  console.error('[run-migration] FAILED:');
  console.error(err.stderr || err.message);
  console.error('');
  console.error('MANUAL FALLBACK:');
  console.error(`  1. Open https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`);
  console.error(`  2. Paste the contents of ${sqlPath}`);
  console.error('  3. Click RUN');
  process.exit(1);
}
