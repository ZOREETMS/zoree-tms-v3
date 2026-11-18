// ═══════════════════════════════════════════════════════════════════
// AP mailbox triggers — the invoice agent runs when new email arrives.
//
//   Main trigger   a live IMAP IDLE connection to the AP mailbox: the
//                  mail server tells the agent the moment a message
//                  lands, and a run starts within seconds. (In a
//                  Microsoft 365 pilot this is a Graph change
//                  notification; it calls the same trigger().)
//   Catch-up       one check every time the connection (re)opens, for
//                  mail that arrived while it was down — including
//                  while the server was off.
//   Backup check   every EMAIL_INTAKE_AP_BACKUP_SECONDS (default 300) in
//                  case a notification is missed. Checks that find
//                  nothing are not logged.
//   Run now        the "Read AP Mailbox" button (mailboxRun.start).
//
// Every trigger goes through poller.requestRun: one run at a time, and a
// trigger that arrives during a run queues exactly one more run, so no
// email waits for the next backup check. Each email is processed once —
// email_order_intake is unique on (tenant, mailbox, message_id).
//
// Env:
//   EMAIL_INTAKE_AP_AUTO              true = the agent reads the AP mailbox by itself
//   EMAIL_INTAKE_AP_WATCH             on (default) | off — the new-email trigger
//   EMAIL_INTAKE_AP_BACKUP_SECONDS    default 300 (min 60); 0 or off = no backup check
// ═══════════════════════════════════════════════════════════════════
'use strict';

const { ImapFlow } = require('imapflow');
const mailbox = require('./mailbox');
const poller = require('./poller');
const graphMailbox = require('./graphMailbox');

const LABEL = { 'new-email': 'new-email', 'catch-up': 'catch-up-check', backup: 'backup-check' };

function backupSeconds(env = process.env) {
  const v = String(env.EMAIL_INTAKE_AP_BACKUP_SECONDS ?? '300').trim().toLowerCase();
  if (v === 'off' || v === '0' || v === 'false') return 0;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.max(60, n) : 300;
}
function watchEnabled(env = process.env) {
  return String(env.EMAIL_INTAKE_AP_WATCH ?? 'on').trim().toLowerCase() !== 'off';
}

/**
 * A self-healing new-mail watcher on one mailbox. Pure apart from the
 * injected client factory and timers, so it is unit-tested with fakes.
 * @param {{ account, onNewMail:(reason:'new-email'|'catch-up')=>void, makeClient:(account)=>object,
 *           delays?:{ debounceMs, minBackoffMs, maxBackoffMs }, timers?:{ setTimeout, clearTimeout } }} o
 */
function createWatcher({ account, onNewMail, makeClient, delays = {}, timers = { setTimeout, clearTimeout } }) {
  const d = { debounceMs: 2000, minBackoffMs: 5000, maxBackoffMs: 60000, ...delays };
  const st = { connected: false, lastEventAt: null, lastConnectAt: null, lastError: null, reconnects: 0, stopped: false };
  let client = null;
  let backoff = d.minBackoffMs;
  let debounceT = null;
  let retryT = null;
  let pendingReason = null;

  // Several notifications in a burst (one email, many parts) → one run.
  const fire = (reason) => {
    pendingReason = pendingReason === 'new-email' ? pendingReason : reason;
    if (debounceT) return;
    debounceT = timers.setTimeout(() => { debounceT = null; const r = pendingReason; pendingReason = null; onNewMail(r); }, d.debounceMs);
  };

  function scheduleReconnect() {
    if (st.stopped || retryT) return;
    st.reconnects += 1;
    const wait = backoff;
    backoff = Math.min(backoff * 2, d.maxBackoffMs);
    retryT = timers.setTimeout(() => { retryT = null; connect(); }, wait);
  }

  async function connect() {
    if (st.stopped) return;
    const c = makeClient(account);
    client = c;
    c.on('exists', (e) => {
      if (e && Number(e.count) > Number(e.prevCount)) { st.lastEventAt = new Date().toISOString(); fire('new-email'); }
    });
    c.on('close', () => { if (client === c) { st.connected = false; scheduleReconnect(); } });
    c.on('error', (err) => { st.lastError = err && err.message; });
    try {
      await c.connect();
      await c.mailboxOpen(account.mailbox || 'INBOX', { readOnly: true });
      st.connected = true;
      st.lastConnectAt = new Date().toISOString();
      st.lastError = null;
      backoff = d.minBackoffMs;
      fire('catch-up'); // mail that arrived while the connection was down
    } catch (err) {
      st.lastError = err && err.message;
      st.connected = false;
      try { c.close(); } catch { /* already closed */ }
      scheduleReconnect();
    }
  }

  return {
    start() { st.stopped = false; return connect(); },
    stop() {
      st.stopped = true;
      if (retryT) timers.clearTimeout(retryT);
      if (debounceT) timers.clearTimeout(debounceT);
      retryT = null; debounceT = null;
      const c = client; client = null; st.connected = false;
      if (c) { try { c.logout ? c.logout().catch(() => {}) : c.close(); } catch { /* ignore */ } }
    },
    status() { return { ...st }; },
  };
}

const state = { active: false, watcher: null, backupTimer: null, backupSec: 0, account: null, watch: false };

/** Start a run for the AP mailbox (queued if one is running). */
function trigger(reason) {
  if (!state.account) return Promise.resolve({ skipped: true });
  return poller.requestRun({ accounts: [state.account], trigger: 'schedule', startedBy: LABEL[reason] || reason, domains: [] })
    .catch(() => {}); // kept in poller.status().lastError and on the run row
}

function start(env = process.env) {
  if (String(env.EMAIL_INTAKE_ENABLED || '').toLowerCase() !== 'true') return false;
  const ap = mailbox.apConfig();
  if (!ap || !ap.auto) return false;
  if (!mailbox.isConfigured(ap)) {
    console.log(`   ⚠️  AP mailbox ${ap.user || ''} set to read automatically but has no ${ap.provider === 'graph' ? 'Microsoft app credentials' : 'app password'} — not started`);
    return false;
  }
  state.account = ap;
  state.active = true;
  poller.setApHandled(true); // the general timer no longer reads the AP mailbox
  state.watch = watchEnabled(env);
  if (state.watch && ap.provider === 'graph') {
    const client = graphMailbox.createClient();
    state.watcher = graphMailbox.createGraphWatcher({ onNewMail: (reason) => { trigger(reason); }, peek: () => client.latestId() });
    state.watcher.start();
  } else if (state.watch) {
    state.watcher = createWatcher({
      account: ap,
      onNewMail: (reason) => { trigger(reason); },
      makeClient: (a) => {
        const c = new ImapFlow({ host: a.host, port: a.port, secure: true, auth: { user: a.user, pass: a.pass }, logger: false, maxIdleTime: 4 * 60 * 1000 });
        return c;
      },
    });
    state.watcher.start();
  }
  state.backupSec = backupSeconds(env);
  if (state.backupSec) {
    state.backupTimer = setInterval(() => { trigger('backup'); }, state.backupSec * 1000);
    if (state.backupTimer.unref) state.backupTimer.unref();
  }
  console.log(`   ✅ Invoice agent: ${state.watch ? `runs when new email arrives in ${ap.user}` : `new-email trigger off for ${ap.user}`}${state.backupSec ? `, backup check every ${state.backupSec}s` : ', no backup check'}`);
  return true;
}

function stop() {
  if (state.watcher) state.watcher.stop();
  if (state.backupTimer) clearInterval(state.backupTimer);
  state.watcher = null; state.backupTimer = null; state.active = false;
  poller.setApHandled(false);
}

function status() {
  const w = state.watcher ? state.watcher.status() : null;
  return {
    active: state.active,
    watching: Boolean(w),
    connected: Boolean(w && w.connected),
    lastEventAt: w ? w.lastEventAt : null,
    lastError: w ? w.lastError : null,
    backupSec: state.backupSec || null,
    mailbox: state.account ? state.account.user : null,
  };
}

module.exports = { start, stop, status, trigger, createWatcher, backupSeconds, watchEnabled };
