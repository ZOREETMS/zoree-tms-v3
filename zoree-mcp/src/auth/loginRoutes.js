// ════════════════════════════════════════════════════════════════════
// loginRoutes.js — POST /oauth/login, the target of the sign-in form.
// Thin shell over oauthProvider.completeLogin(), plus a small per-IP
// limiter so the form can't be used to brute-force passwords.
// ════════════════════════════════════════════════════════════════════

const express = require('express');
const { renderLoginPage, renderErrorPage } = require('./loginPage');

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function createAttemptLimiter() {
  const hits = new Map(); // ip -> { n, start }
  return function allow(ip) {
    const now = Date.now();
    const h = hits.get(ip);
    if (!h || now - h.start > WINDOW_MS) {
      hits.set(ip, { n: 1, start: now });
      return true;
    }
    h.n += 1;
    return h.n <= MAX_ATTEMPTS;
  };
}

function createLoginRouter({ provider }) {
  const router = express.Router();
  const allow = createAttemptLimiter();

  router.post('/oauth/login', express.urlencoded({ extended: false, limit: '16kb' }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { tx = '', email = '', password = '' } = req.body || {};

    if (!allow(req.ip)) {
      return res.status(429).type('html')
        .send(renderLoginPage({ tx, email, error: 'Too many attempts. Wait 15 minutes and try again.' }));
    }

    try {
      const result = await provider.completeLogin({ tx, email: String(email).trim(), password: String(password) });
      if (result.redirectTo) return res.redirect(302, result.redirectTo);
      return res.status(401).type('html')
        .send(renderLoginPage({ ...result, email }));
    } catch (err) {
      return res.status(400).type('html').send(renderErrorPage(err.message));
    }
  });

  return router;
}

module.exports = { createLoginRouter };
