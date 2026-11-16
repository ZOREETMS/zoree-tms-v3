// ════════════════════════════════════════════════════════════════════
// loginPage.js — the sign-in page Claude opens during OAuth.
// Plain server-rendered HTML; no scripts, no external assets.
// ════════════════════════════════════════════════════════════════════

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderLoginPage({ tx, clientName, returnHost, error, email }) {
  const app = escapeHtml(clientName || 'Claude');
  const back = returnHost ? ` After you sign in you'll return to <strong>${escapeHtml(returnHost)}</strong>.` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in to ZoreeTMS</title>
<style>
  :root { --bg:#f5f7fb; --card:#fff; --text:#0f172a; --muted:#64748b; --line:#e2e8f0; --brand:#3b82f6; --err:#b91c1c; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0b1220; --card:#111a2e; --text:#e5e7eb; --muted:#94a3b8; --line:#1f2a44; --err:#f87171; } }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--text);
         font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; padding:16px; }
  main { width:100%; max-width:380px; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:28px; }
  h1 { font-size:20px; margin:0 0 4px; }
  p  { margin:0 0 20px; color:var(--muted); }
  label { display:block; font-weight:600; font-size:13px; margin:14px 0 6px; }
  input { width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:8px; background:transparent; color:inherit; font:inherit; }
  input:focus { outline:2px solid var(--brand); outline-offset:1px; }
  button { margin-top:22px; width:100%; padding:11px; border:0; border-radius:8px; background:var(--brand); color:#fff; font:inherit; font-weight:600; cursor:pointer; }
  .err { color:var(--err); margin:0 0 8px; font-size:14px; }
  .fine { margin:18px 0 0; font-size:12px; }
</style>
</head>
<body>
<main>
  <h1>Sign in to ZoreeTMS</h1>
  <p>${app} is requesting read-only access to your orders, shipments, carriers and rates.${back}</p>
  ${error ? `<p class="err" role="alert">${escapeHtml(error)}</p>` : ''}
  <form method="post" action="/oauth/login" autocomplete="on">
    <input type="hidden" name="tx" value="${escapeHtml(tx)}">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" required autofocus value="${escapeHtml(email)}">
    <label for="password">Password</label>
    <input id="password" name="password" type="password" required>
    <button type="submit">Sign in and allow</button>
  </form>
  <p class="fine">Access follows your ZoreeTMS role. You can disconnect anytime from Claude's connector settings.</p>
</main>
</body>
</html>`;
}

function renderErrorPage(message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ZoreeTMS sign-in</title><style>body{font:15px system-ui,sans-serif;max-width:420px;margin:15vh auto;padding:16px;}</style></head>
<body><h1 style="font-size:20px">Sign-in link expired</h1><p>${escapeHtml(message)}</p>
<p>Go back to Claude and click <strong>Connect</strong> on the ZoreeTMS connector again.</p></body></html>`;
}

module.exports = { renderLoginPage, renderErrorPage, escapeHtml };
