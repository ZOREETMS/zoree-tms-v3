// ═══════════════════════════════════════════════════════════════════
// One-shot setup: create the Teams bot's TMS identity.
//
// Creates (or reuses) the Supabase auth user teams-bot@zoree.io with a
// fresh random password, upserts its user_profiles row with the
// planner role, verifies password sign-in, and appends
// TEAMS_BOT_TMS_EMAIL / TEAMS_BOT_TMS_PASSWORD to api/.env.
//
// Run from api/:  node scripts/create-teams-bot-user.js
// (or double-click run-bot-user-setup.bat in the repo root)
// Safe to re-run: resets the password and rewrites .env entries.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
const EMAIL = 'teams-bot@zoree.io';

const H = { 'Content-Type': 'application/json', apikey: KEY, Authorization: 'Bearer ' + KEY };

function randomPassword() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = require('crypto').randomBytes(24);
  return [...bytes].map((b) => chars[b % chars.length]).join('');
}

(async () => {
  const pw = randomPassword();

  // 1. Create auth user (email pre-confirmed) or reuse + reset password
  let res = await fetch(`${URL}/auth/v1/admin/users`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      email: EMAIL, password: pw, email_confirm: true,
      user_metadata: { role: 'planner', full_name: 'Teams Bot' },
    }),
  });
  let user = await res.json();
  let note = 'created';
  if (!res.ok) {
    const list = await fetch(`${URL}/auth/v1/admin/users?page=1&per_page=200`, { headers: H }).then((r) => r.json());
    user = (list.users || []).find((u) => u.email === EMAIL);
    if (!user) { console.error('FAILED to create user:', JSON.stringify(user)); process.exit(1); }
    const upd = await fetch(`${URL}/auth/v1/admin/users/${user.id}`, {
      method: 'PUT', headers: H, body: JSON.stringify({ password: pw }),
    });
    if (!upd.ok) { console.error('FAILED to reset password:', await upd.text()); process.exit(1); }
    note = 'existing user reused, password reset';
  }

  // 2. Planner role via user_profiles (source of truth per REQ-08)
  res = await fetch(`${URL}/rest/v1/user_profiles?on_conflict=id`, {
    method: 'POST',
    headers: { ...H, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      id: user.id, email: EMAIL, full_name: 'Teams Bot',
      roles: ['planner'], active_role: 'planner',
      tenant_id: process.env.DEFAULT_TENANT || null,
    }),
  });
  const prof = await res.json();
  if (!res.ok) { console.error('FAILED user_profiles upsert:', JSON.stringify(prof)); process.exit(1); }

  // 3. Verify password sign-in
  const signin = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify({ email: EMAIL, password: pw }),
  });

  // 4. Write creds to .env (replace existing entries if present)
  const envPath = path.join(__dirname, '..', '.env');
  let env = fs.readFileSync(envPath, 'utf8');
  env = env
    .split('\n')
    .filter((l) => !l.startsWith('TEAMS_BOT_TMS_EMAIL=') && !l.startsWith('TEAMS_BOT_TMS_PASSWORD='))
    .join('\n');
  if (!env.endsWith('\n')) env += '\n';
  env += `TEAMS_BOT_TMS_EMAIL=${EMAIL}\nTEAMS_BOT_TMS_PASSWORD=${pw}\n`;
  fs.writeFileSync(envPath, env);

  console.log(JSON.stringify({
    ok: true, note, userId: user.id,
    roles: prof[0].roles, activeRole: prof[0].active_role,
    signinOk: signin.ok, envUpdated: true,
  }, null, 2));
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
