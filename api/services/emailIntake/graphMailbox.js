// ═══════════════════════════════════════════════════════════════════
// AP mailbox on Microsoft 365, read through Microsoft Graph.
//
// The agent signs in as its own Entra app (client credentials: no user,
// no password, no MFA prompt) with the Mail.Read application permission.
// It only ever reads: it lists recent inbox messages, downloads the
// ones it has not processed, and never moves, flags or deletes mail.
// Each message is fetched as its original MIME and parsed exactly like
// the IMAP reader, so everything after this (read, Jev check, audit) is
// unchanged.
//
// Config (api/.env):
//   EMAIL_INTAKE_AP_PROVIDER        graph   (anything else = IMAP)
//   EMAIL_INTAKE_AP_GRAPH_MAILBOX   ap@kestrelbay.zoree.io
//   MS_GRAPH_TENANT_ID              Entra tenant ID (falls back to MS_SSO_TENANT_ID)
//   MS_GRAPH_CLIENT_ID              the agent app's client ID
//   MS_GRAPH_CLIENT_SECRET          the agent app's secret
//   EMAIL_INTAKE_AP_GRAPH_POLL_SECONDS  new-mail check interval (default 15)
// ═══════════════════════════════════════════════════════════════════
'use strict';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const LOOKBACK_DAYS = 7;
const SCAN_LIMIT = 100;
const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;

function settings(env = process.env) {
  return {
    tenantId: String(env.MS_GRAPH_TENANT_ID || env.MS_SSO_TENANT_ID || '').trim(),
    clientId: String(env.MS_GRAPH_CLIENT_ID || '').trim(),
    clientSecret: String(env.MS_GRAPH_CLIENT_SECRET || '').trim(),
    mailbox: String(env.EMAIL_INTAKE_AP_GRAPH_MAILBOX || '').trim().toLowerCase(),
  };
}

function isGraph(env = process.env) {
  return String(env.EMAIL_INTAKE_AP_PROVIDER || '').trim().toLowerCase() === 'graph';
}

function isConfigured(env = process.env) {
  const s = settings(env);
  return Boolean(s.tenantId && s.clientId && s.clientSecret && s.mailbox);
}

function pollSeconds(env = process.env) {
  const n = Number(env.EMAIL_INTAKE_AP_GRAPH_POLL_SECONDS);
  return Number.isFinite(n) && n >= 5 ? Math.round(n) : 15;
}

/** App-only access token, cached until a minute before it expires. */
function createTokenSource({ fetchImpl = fetch, now = () => Date.now(), env = process.env } = {}) {
  let cached = null;
  return async function token() {
    if (cached && cached.until > now()) return cached.value;
    const s = settings(env);
    const body = new URLSearchParams({
      client_id: s.clientId,
      client_secret: s.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });
    const r = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(s.tenantId)}/oauth2/v2.0/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) {
      throw new Error(`Microsoft sign-in for the AP mailbox agent failed: ${j.error_description || j.error || r.status}`);
    }
    cached = { value: j.access_token, until: now() + Math.max(60, (Number(j.expires_in) || 3600) - 60) * 1000 };
    return cached.value;
  };
}

function createClient({ fetchImpl = fetch, env = process.env, token = createTokenSource({ fetchImpl, env }) } = {}) {
  const mbx = () => encodeURIComponent(settings(env).mailbox);

  async function get(path, { raw = false } = {}) {
    const r = await fetchImpl(`${GRAPH}${path}`, { headers: { Authorization: `Bearer ${await token()}` } });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      let msg = t;
      try { msg = JSON.parse(t).error.message; } catch { /* keep text */ }
      throw new Error(`Microsoft Graph ${r.status}: ${String(msg).slice(0, 300)}`);
    }
    return raw ? Buffer.from(await r.arrayBuffer()) : r.json();
  }

  /** Recent inbox messages, newest first: id, Message-ID, received time, attachments, size. */
  async function recent({ since = new Date(Date.now() - LOOKBACK_DAYS * 86400000), top = SCAN_LIMIT } = {}) {
    const q = new URLSearchParams({
      $select: 'id,internetMessageId,receivedDateTime,hasAttachments',
      $filter: `receivedDateTime ge ${since.toISOString()}`,
      $orderby: 'receivedDateTime desc',
      $top: String(top),
    });
    const j = await get(`/users/${mbx()}/mailFolders/inbox/messages?${q}`);
    return Array.isArray(j.value) ? j.value : [];
  }

  /** Newest inbox message id, or null — the cheap "anything new?" check. */
  async function latestId() {
    const q = new URLSearchParams({ $select: 'id,receivedDateTime', $orderby: 'receivedDateTime desc', $top: '1' });
    const j = await get(`/users/${mbx()}/mailFolders/inbox/messages?${q}`);
    return (j.value && j.value[0] && j.value[0].id) || null;
  }

  /** The original message (MIME), as received. */
  function mime(id) {
    return get(`/users/${mbx()}/messages/${encodeURIComponent(id)}/$value`, { raw: true });
  }

  return { recent, latestId, mime };
}

/**
 * Same contract as the IMAP reader's fetchNewEmails.
 * @param {{ isSeen:(ids:string[])=>Promise<Set<string>>, max?:number, client?:object,
 *           parse:(mime:Buffer)=>Promise<object>, toEmail:(parsed:object, meta:object)=>object,
 *           normalizeMessageId:(id:string)=>string }} opts
 */
async function fetchNewEmails({ isSeen, max = 10, client = createClient(), parse, toEmail, normalizeMessageId }) {
  if (!isConfigured()) {
    throw new Error('The Microsoft AP mailbox is not set up: set MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET and EMAIL_INTAKE_AP_GRAPH_MAILBOX in api/.env');
  }
  const list = (await client.recent()).filter((m) => m.hasAttachments);
  if (!list.length) return { scanned: 0, emails: [] };
  const envs = list.map((m) => ({
    id: m.id,
    messageId: normalizeMessageId(m.internetMessageId) || `graph-${m.id}`,
    receivedAt: m.receivedDateTime ? new Date(m.receivedDateTime) : new Date(),
  }));
  const seen = await isSeen(envs.map((e) => e.messageId));
  const todo = envs.filter((e) => !seen.has(e.messageId)).slice(0, max);
  const emails = [];
  for (const e of todo) {
    const source = await client.mime(e.id);
    if (!source || source.length > MAX_MESSAGE_BYTES) continue;
    const parsed = await parse(source);
    emails.push(toEmail(parsed, { messageId: e.messageId, internalDate: e.receivedAt }));
  }
  return { scanned: envs.length, emails };
}

/**
 * New-mail watch for the Graph mailbox: checks the newest inbox message
 * every few seconds and fires when it changes. A catch-up run fires once
 * at start. Same status shape as the IMAP watcher.
 */
function createGraphWatcher({ onNewMail, peek, everyMs = pollSeconds() * 1000, timers = { setInterval, clearInterval } }) {
  const st = { connected: false, lastCheckAt: null, lastEventAt: null, lastError: null };
  let last;
  let timer = null;
  let busy = false;

  async function check(first) {
    if (busy) return;
    busy = true;
    try {
      const id = await peek();
      st.connected = true; st.lastError = null; st.lastCheckAt = new Date().toISOString();
      if (first) { last = id; onNewMail('catch-up'); return; }
      if (id && id !== last) { last = id; st.lastEventAt = st.lastCheckAt; onNewMail('new-email'); }
    } catch (e) {
      st.connected = false; st.lastError = e.message;
    } finally {
      busy = false;
    }
  }

  return {
    start() {
      check(true);
      timer = timers.setInterval(() => { check(false); }, everyMs);
      if (timer && timer.unref) timer.unref();
      return Promise.resolve();
    },
    stop() { if (timer) timers.clearInterval(timer); timer = null; st.connected = false; },
    status() { return { ...st }; },
    _check: check,
  };
}

module.exports = {
  settings, isGraph, isConfigured, pollSeconds, createTokenSource, createClient, fetchNewEmails, createGraphWatcher,
};
