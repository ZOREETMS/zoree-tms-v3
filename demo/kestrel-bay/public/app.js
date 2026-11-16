'use strict';
// UI only. Every number comes from the server.
const $ = (s) => document.querySelector(s);
const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LABEL = { clear: 'Clear to pay', overbilled: 'Overbilled → AP', duplicate: 'Duplicate → AP', not_payable: 'Not payable → AP', unmatched: 'No match → AP', unreadable: 'Read check failed → AP' };
const api = {
  get: (u) => fetch(u).then((r) => (r.ok ? r.json() : Promise.reject(r))),
  post: (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(e)))),
};
const S = { pack: null, inbox: [], job: null, decisions: {}, poll: null, shown: 0 };

async function init() {
  const [pack, inbox, health] = await Promise.all([api.get('/api/datapack'), api.get('/api/inbox'), api.get('/api/health')]);
  S.pack = pack; S.inbox = inbox;
  $('#chipMode').textContent = health.mode === 'shadow' ? 'Shadow mode — agent suggests, people act' : 'Assist mode';
  renderProfile(pack.policy); renderInbox(); renderChecks(pack.checks); renderSystems(pack.policy); renderPilot(pack.policy);
  try { S.job = await api.get('/api/audit/run'); S.decisions = await api.get('/api/decisions'); S.shown = S.job.results.length; renderJob(); } catch (_) { /* no run */ }
  refreshLog();
}

function renderProfile(p) {
  const pr = p.profile;
  $('#profile').innerHTML = [
    [pr.invoicesPerMonth.toLocaleString(), 'carrier invoices a month'],
    [`${pr.stepsPerInvoiceToday} steps · ${pr.systemsPerInvoiceToday} systems`, 'per invoice, by hand, today'],
    [(pr.invoicesPerMonth * pr.stepsPerInvoiceToday).toLocaleString(), 'manual steps a month'],
    [`${pr.apClerks} clerks`, 'in accounts payable'],
    ['about 1 in 6', 'invoices has a problem'],
  ].map(([b, s]) => `<div class="kpi"><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join('');
}

function renderInbox(state = {}) {
  $('#inbox').innerHTML = S.inbox.map((f, i) => `<a href="/inbox/${encodeURIComponent(f)}" target="_blank" class="${state[i + 1] || ''}"><span class="dot"></span>${esc(f.replace(/\.pdf$/i, ''))}</a>`).join('');
}

function renderChecks(checks) { $('#checks').innerHTML = (checks || []).map((c) => `<li class="${c.level}">${esc(c.detail)}</li>`).join(''); }

function renderSystems(p) {
  $('#flow').innerHTML = p.it.flow.map((s) => `<li>${esc(s)}</li>`).join('');
  $('#safety').innerHTML = p.it.safety.map((s) => `<li>${esc(s)}</li>`).join('');
  $('#today').innerHTML = `<b>What you are seeing today vs the pilot</b><table>${(p.it.demoVsPilot || []).map(([k, a, b]) => `<tr><td>${esc(k)}</td><td>${esc(a.replace('Demo: ', ''))} → <b style="display:inline">${esc(b.replace('Pilot: ', ''))}</b></td></tr>`).join('')}</table>`;
}

function renderPilot(p) {
  $('#pilot').innerHTML = [
    `<b>Shadow mode from day 1.</b> No changes to live systems Nov 20 – Jan 5, so the agent reads and recommends while AP keeps posting as today. We compare its calls with AP's on every invoice.`,
    `<b>${p.pilot.days} days</b>, all ~${p.profile.invoicesPerMonth.toLocaleString()} invoices a month, through one AP mailbox.`,
    ...p.pilot.metrics.map((m) => `Measure: ${esc(m)}`),
    `Your team's time: about 1 hour to set up access, then 15 minutes a week to review the agent's calls.`,
    `IT first: connect SSO, the AP mailbox (read-only) and the TMS API on a US-region endpoint before any live invoice is read.`,
  ].map((i) => `<li>${i}</li>`).join('');
  $('#yes').innerHTML = `<h3>The technical yes</h3><ul>
    <li>Works on your data — read your invoice PDFs, matched your TMS and contracts</li>
    <li>Fits your systems — M365 mailbox in, read-only TMS and NetSuite, ready-to-post list out</li>
    <li>Safe and scalable — rules decide, people own exceptions, read-only, full audit log; SSO and US-only endpoint set up in week 1</li></ul>
    <p><b>${esc(p.pilot.ask)}</b></p>`;
}

async function run() {
  const btn = $('#btnRun');
  btn.disabled = true; btn.textContent = 'Running…';
  $('#detailCard').hidden = true; $('#runTable tbody').innerHTML = ''; S.shown = 0;
  try {
    await api.post('/api/audit/run', { offline: $('#offline').checked });
    S.poll = setInterval(pollJob, 400);
  } catch (e) { say(e.error || 'Could not start'); btn.disabled = false; btn.textContent = 'Run the agent'; }
}

async function pollJob() {
  try { S.job = await api.get('/api/audit/run'); } catch (_) { return; }
  renderJob();
  if (S.job.status !== 'running') {
    clearInterval(S.poll); S.poll = null;
    $('#btnRun').disabled = false; $('#btnRun').textContent = 'Run again';
    if (S.job.status === 'failed') say('Run failed: ' + S.job.error);
    S.decisions = {};
    refreshLog();
  }
}

function renderJob() {
  const j = S.job;
  $('#emptyRun').hidden = true;
  const state = {};
  for (const e of j.events) if (e.seq) state[e.seq] = e.step === 'decided' ? 'done' : (state[e.seq] === 'done' ? 'done' : 'reading');
  renderInbox(state);
  $('#progress').hidden = j.status !== 'running';
  $('#bar').style.width = `${j.total ? (j.results.length / j.total) * 100 : 0}%`;
  $('#runMeta').textContent = j.status === 'running' ? `Reading and checking… ${j.results.length}/${j.total}` :
    `${j.results.length} PDFs · read by Claude${j.offline ? ' (saved reads, offline)' : ''} · decided by AP rules`;
  const tb = $('#runTable tbody');
  for (let i = S.shown; i < j.results.length; i += 1) {
    const tr = document.createElement('tr');
    tr.dataset.seq = j.results[i].seq;
    tr.addEventListener('click', () => openDetail(Number(tr.dataset.seq)));
    tb.appendChild(tr);
    requestAnimationFrame(() => tr.classList.add('in'));
  }
  S.shown = j.results.length;
  [...tb.querySelectorAll('tr')].forEach((tr) => { tr.innerHTML = rowHtml(j.results.find((r) => r.seq === Number(tr.dataset.seq))); tr.classList.add('in'); });
  if (j.status === 'done') { renderChecks(j.checks); renderSummary(); }
}

function rowHtml(x) {
  const d = S.decisions[x.seq];
  const why = x.verdict === 'clear' ? x.passed.filter((p) => /Base|Fuel|approved|found/.test(p)).join(' · ') : x.issues.map((i) => i.detail).join(' ');
  return `<td>${x.seq}</td><td><b>${esc(x.invoice.invoiceNumber)}</b><div class="muted small">PDF · read by Claude${x.read && x.read.source === 'cache' ? ' (saved)' : ''}</div></td>
    <td>${esc(x.invoice.carrier)}</td><td>${esc(x.invoice.shipmentId)}</td><td class="num">${money(x.invoice.total)}</td>
    <td><span class="pill ${x.verdict}">${LABEL[x.verdict]}</span>${d ? `<div class="small" style="color:var(--ok)">✓ ${esc(d.action.replace('_', ' '))} by ${esc(d.by)}</div>` : ''}</td>
    <td class="why">${esc(why)}</td><td class="rec">${esc(x.recommendation)}</td>`;
}

function renderSummary() {
  const s = S.job.summary;
  $('#stats').innerHTML = [
    [`${s.autoCleared} of ${s.total}`, 'cleared by the agent, no touch'],
    [money(s.readyToPost), 'on the ready-to-post list'],
    [money(s.overcharges), `overcharges caught on ${s.overchargeCount} invoices`],
    [money(s.held), `held: ${s.heldCount} invoices that should not be paid as sent`],
  ].map(([b, t]) => `<div class="stat"><b>${b}</b><span>${t}</span></div>`).join('');
  const t = $('#typical');
  t.hidden = s.sampleLooksTypical;
  t.innerHTML = `<b>Is this week typical?</b> ${s.toPerson} of ${s.total} need a person — you see about 1 in 6. If 1 in 6 holds, that is about <b>${s.monthly.expectedAutoCleared.toLocaleString()}</b> invoices a month cleared with no touch and <b>${s.monthly.expectedToPerson.toLocaleString()}</b> going to AP. Week 1 of the pilot tells us the real rate.`;
  renderRtp();
}

async function renderRtp() {
  try {
    const rows = await api.get('/api/export/ready-to-post.json');
    $('#rtp tbody').innerHTML = rows.map((r) => `<tr><td>${esc(r.invoice)}</td><td class="num">${money(r.payAmount)}</td><td class="small">${esc(r.clearedBy)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Nothing yet</td></tr>';
  } catch (_) {}
}

async function openDetail(seq) {
  const x = S.job.results.find((r) => r.seq === seq);
  if (!x) return;
  document.querySelectorAll('#runTable tbody tr').forEach((tr) => tr.classList.toggle('sel', Number(tr.dataset.seq) === seq));
  $('#detailCard').hidden = false;
  $('#detailTitle').textContent = `#${seq} ${x.invoice.invoiceNumber} · ${x.invoice.carrier} · ${x.invoice.shipmentId}`;
  const lines = (x.invoice.lines || []).map((l) => `<tr><td>${esc(l.description || l.type)}</td><td class="muted small">${esc(l.type)}${l.name ? ` · ${esc(l.name)}` : ''}</td><td class="num">${money(l.amount)}</td></tr>`).join('');
  const ship = x.shipment ? `<tr><td>Status</td><td>${esc(x.shipment.status)}</td></tr><tr><td>Lane</td><td>${esc(x.shipment.origin)} → ${esc(x.shipment.destination)}</td></tr><tr><td>Approved extras</td><td>${x.shipment.approvedExtras.length ? x.shipment.approvedExtras.map((a) => `${esc(a.type)} up to ${a.maxHours} hrs at ${money(a.ratePerHour)}/hr`).join(', ') : 'None'}</td></tr>`
    : '<tr><td colspan="2" style="color:var(--bad)">Not in the TMS</td></tr>';
  const contract = x.expected ? `<tr><td>Contract base</td><td class="num">${money(x.expected.base)}</td></tr><tr><td>Fuel ${x.expected.fuelPct}% of base</td><td class="num">${money(x.expected.fuel)}</td></tr>` : '<tr><td colspan="2" class="muted">Not reached — stopped at an earlier check</td></tr>';
  const d = S.decisions[seq];
  const buttons = x.route === 'person' && !d ? `<div class="decide">
      <input id="decNote" placeholder="Note for the record">
      ${x.verdict === 'overbilled' ? `<button data-act="short_pay" data-amt="${x.recommendPay}">Short-pay ${money(x.recommendPay)} + email carrier</button>` : ''}
      ${x.verdict === 'clear' ? `<button data-act="approve" data-amt="${x.recommendPay}">Sign off ${money(x.recommendPay)}</button>` : ''}
      <button data-act="approve" data-amt="${x.invoice.total}">Pay in full anyway</button>
      <button data-act="request_docs">Ask carrier for documents</button>
      <button data-act="reject">Reject</button>
    </div>` : '';
  $('#detailBody').innerHTML = `<div class="detail3">
      <div class="pdfwrap"><iframe src="/inbox/${encodeURIComponent(x.invoice.file)}#view=FitH" title="Invoice PDF"></iframe></div>
      <div>
        <h3>What the agent read from the PDF</h3>
        <table>${lines}<tr><th colspan="2">Total</th><th class="num">${money(x.invoice.total)}</th></tr></table>
        <div class="read">PRO ${esc(x.invoice.proNumber || '—')} · dated ${esc(x.invoice.invoiceDate || '—')} · confidence ${x.read && x.read.confidence != null ? x.read.confidence : '—'}${x.read && x.read.warnings && x.read.warnings.length ? ` · note: ${esc(x.read.warnings.join('; '))}` : ''}</div>
        <h3>TMS shipment</h3><table>${ship}</table>
        <h3 style="margin-top:8px">Contract</h3><table>${contract}</table>
      </div>
    </div>
    <h3 style="margin-top:12px"><span class="pill ${x.verdict}">${LABEL[x.verdict]}</span> &nbsp;${esc(x.recommendation)}</h3>
    ${x.issues.length ? `<ul class="issues">${x.issues.map((i) => `<li>${esc(i.detail)}</li>`).join('')}</ul>` : ''}
    <ul class="passed">${x.passed.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
    <div class="expl" id="expl"><span class="muted small">Asking Claude to explain…</span></div>
    ${d ? decidedHtml(d) : buttons}`;
  $('#detailBody').querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => decide(seq, b.dataset.act, b.dataset.amt)));
  $('#detailCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  try { const e = await api.get(`/api/audit/explain/${seq}`); const el = $('#expl'); if (el) el.innerHTML = `${esc(e.text)}<div class="src">${e.source === 'claude' ? `Explained by Claude${e.cached ? ' (saved)' : ''} · decided by AP rules` : 'Rules engine'}</div>`; } catch (_) {}
}

function decidedHtml(d) {
  return `<div class="decided">✓ <b>${esc(d.action.replace('_', ' '))}</b>${d.amount != null ? ` ${money(d.amount)}` : ''} by ${esc(d.by)}${d.note ? ` — ${esc(d.note)}` : ''}</div>${d.draft ? `<h3 style="margin-top:8px">Email to carrier (draft — AP sends)</h3><div class="draft">${esc(d.draft.text)}</div>` : ''}`;
}

async function decide(seq, action, amount) {
  const note = ($('#decNote') || {}).value || '';
  document.querySelectorAll('[data-act]').forEach((b) => { b.disabled = true; });
  try {
    S.decisions[seq] = await api.post(`/api/decisions/${seq}`, { action, note, by: 'AP clerk', amount: amount != null ? Number(amount) : undefined });
    renderJob(); openDetail(seq);
  } catch (e) { say(e.error || 'Decision failed'); }
  refreshLog();
}

async function ask() {
  const q = $('#askInput').value.trim();
  if (!q) return;
  const out = $('#askOut'); out.hidden = false; out.textContent = 'Thinking…';
  try { out.textContent = (await api.post('/api/audit/ask', { question: q })).text; } catch (e) { out.textContent = e.error || 'Failed'; }
  refreshLog();
}

async function refreshLog() {
  try {
    const log = await api.get('/api/audit/log');
    $('#log').innerHTML = log.slice(0, 40).map((l) => `<li>${new Date(l.at).toLocaleTimeString()} · <b>${esc(l.event)}</b> ${esc(summ(l))}</li>`).join('') || '<li>No events yet</li>';
  } catch (_) {}
}
function summ(l) {
  const d = l.detail || {};
  if (l.event === 'decision') return `#${d.seq} ${d.action} by ${d.by}`;
  if (l.event === 'run.completed') return `${d.total} invoices, ${d.toPerson} to a person`;
  if (l.event === 'question') return `"${d.question}"`;
  if (l.event === 'export.ready_to_post') return `${d.rows} rows`;
  if (l.event === 'run.failed') return d.error;
  return '';
}
function say(msg) { const o = $('#askOut'); o.hidden = false; o.textContent = msg; }

$('#btnRun').addEventListener('click', run);
$('#btnAsk').addEventListener('click', ask);
$('#askInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(); });
$('#btnCloseDetail').addEventListener('click', () => { $('#detailCard').hidden = true; });
init();
