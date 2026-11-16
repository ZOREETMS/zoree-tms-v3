// Carrier Inbox — Jev (System 1) decides in milliseconds; low-confidence
// messages escalate to ZoreeAI (Claude, System 2). Dry run: planned actions only.
import { useState } from 'react';
import { triageOne, triageBatch, getLiveSamples } from '../services/jevTriageService';

const INTENT_COLORS = {
  tender_accept: '#16a34a', tender_reject: '#dc2626', delay_notice: '#ea580c',
  delivered_pod: '#2563eb', accessorial_claim: '#9333ea', rate_question: '#0891b2', other: '#6b7280',
};
const SEVERITY = ['None', 'Minor', 'Significant', 'Critical'];

const s = {
  wrap: { fontFamily: 'Inter, system-ui, sans-serif', padding: 24, maxWidth: 1280, margin: '0 auto' },
  stats: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, margin: '16px 0' },
  stat: { background: '#0f172a', color: '#fff', borderRadius: 10, padding: '14px 16px' },
  num: { fontSize: 28, fontWeight: 700 },
  lbl: { fontSize: 12, opacity: 0.7, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { display: 'grid', gridTemplateColumns: '130px 150px 1fr auto auto auto', gap: 8, marginBottom: 16 },
  field: { padding: 10, border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14 },
  btn: { padding: '10px 16px', border: 0, borderRadius: 8, background: '#0f172a', color: '#fff', fontWeight: 600, cursor: 'pointer' },
  btn2: { padding: '10px 16px', border: '1px solid #0f172a', borderRadius: 8, background: '#fff', color: '#0f172a', fontWeight: 600, cursor: 'pointer' },
  th: { textAlign: 'left', padding: 10, borderBottom: '2px solid #e2e8f0', fontSize: 12, color: '#64748b', textTransform: 'uppercase' },
  td: { padding: 10, borderBottom: '1px solid #f1f5f9', verticalAlign: 'top', fontSize: 14 },
  chip: (c) => ({ background: c, color: '#fff', borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }),
  route: (auto) => ({ background: auto ? '#dcfce7' : '#fef3c7', color: auto ? '#166534' : '#92400e', borderRadius: 6, padding: '3px 8px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }),
};

export default function JevInboxPage() {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({ shipmentRef: 'SHP-10431', carrier: 'Heartland', message: '' });

  const add = (r) => setRows((p) => [...r, ...p]);
  async function run(fn) {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e.message); }
    setBusy(false);
  }
  const runSamples = () => run(async () => add((await triageBatch(await getLiveSamples())).results));
  const runOne = () => draft.message.trim() && run(async () => {
    add([await triageOne(draft)]);
    setDraft({ ...draft, message: '' });
  });

  const auto = rows.filter((r) => r.route === 'SYSTEM_1_AUTO').length;
  const avgMs = rows.length ? Math.round(rows.reduce((a, r) => a + r.latencyMs, 0) / rows.length) : 0;
  const cost = rows.reduce((a, r) => a + r.costUsd, 0);

  return (
    <div style={s.wrap}>
      <h2 style={{ margin: 0 }}>Carrier Inbox · Jev (System 1) + Claude (System 2)</h2>
      <div style={{ color: '#64748b' }}>Jev decides in milliseconds. Low-confidence messages escalate to ZoreeAI (Claude). Shipments, carriers and lanes are live TMS data. Dry run — no data is changed.</div>

      <div style={s.stats}>
        <div style={s.stat}><div style={s.num}>{rows.length}</div><div style={s.lbl}>Messages triaged</div></div>
        <div style={s.stat}><div style={s.num}>{rows.length ? Math.round((auto / rows.length) * 100) : 0}%</div><div style={s.lbl}>Handled by Jev</div></div>
        <div style={s.stat}><div style={s.num}>{avgMs} ms</div><div style={s.lbl}>Avg decision latency</div></div>
        <div style={s.stat}><div style={s.num}>${cost.toFixed(5)}</div><div style={s.lbl}>Total model cost</div></div>
      </div>

      <div style={s.input}>
        <input style={s.field} value={draft.shipmentRef} onChange={(e) => setDraft({ ...draft, shipmentRef: e.target.value })} />
        <input style={s.field} value={draft.carrier} onChange={(e) => setDraft({ ...draft, carrier: e.target.value })} />
        <input style={s.field} placeholder="Paste a carrier message…" value={draft.message}
          onChange={(e) => setDraft({ ...draft, message: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && runOne()} />
        <button style={s.btn} onClick={runOne} disabled={busy}>{busy ? '…' : 'Triage'}</button>
        <button style={s.btn2} onClick={runSamples} disabled={busy}>Run on 10 live shipments</button>
        <button style={s.btn2} onClick={() => setRows([])} disabled={busy}>Clear</button>
      </div>
      {error && <div style={{ color: '#dc2626', marginBottom: 12 }}>{error}</div>}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>{['Shipment', 'Message', 'Intent', 'Confidence', 'Delay', 'Route', 'Action', 'ms'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={s.td}><b>{r.shipmentRef}</b><div style={{ color: '#64748b', fontSize: 12 }}>{r.carrier}{r.status ? ` · ${r.status}` : ''}</div></td>
              <td style={{ ...s.td, maxWidth: 340 }}>{r.message}</td>
              <td style={s.td}><span style={s.chip(INTENT_COLORS[r.intent] || '#6b7280')}>{String(r.intent).replace('_', ' ')}</span></td>
              <td style={s.td}>
                <div style={{ height: 8, background: '#e2e8f0', borderRadius: 4, width: 90, overflow: 'hidden' }}>
                  <div style={{ width: `${r.confidence * 100}%`, height: '100%', background: r.route === 'SYSTEM_1_AUTO' ? '#16a34a' : '#f59e0b' }} />
                </div>
                <div style={{ fontSize: 12, marginTop: 4 }}>{r.confidence.toFixed(2)}</div>
              </td>
              <td style={s.td}>{SEVERITY[Math.round(r.delaySeverity)] ?? '-'}</td>
              <td style={s.td}><span style={s.route(r.route === 'SYSTEM_1_AUTO')}>{r.route === 'SYSTEM_1_AUTO' ? 'JEV AUTO' : '→ CLAUDE'}</span></td>
              <td style={{ ...s.td, fontSize: 12 }}><b>{r.plannedAction.action}</b><div style={{ color: '#64748b' }}>{r.plannedAction.service}</div></td>
              <td style={s.td}>{r.latencyMs}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
