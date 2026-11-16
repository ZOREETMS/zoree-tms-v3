// Carrier recommendation — Zoree supplies eligible carriers, rates and live
// history; Jev judges best fit; Zoree computes the premium and decides
// auto-recommend vs planner review. Never tenders.
import { useState } from 'react';
import { recommendCarrier } from '../services/jevTriageService';

const ORDER = {
  id: 'TEST-QE-M0006-06',
  lane: 'Martinsville, MO -> Lake Providence, LA (500 mi)',
  weight: '6,000 lbs, 120 pcs, general freight',
  ready: '2026-10-09',
  due: '2026-10-12',
};
const OPTIONS = [
  { carrier: 'KLLM TRANSPORT', rate: 1721, transitDays: 3 },
  { carrier: 'WERNER ENTERPRISES', rate: 1776, transitDays: 2 },
  { carrier: 'SCHNEIDER NATIONAL', rate: 1831, transitDays: 2 },
];

const s = {
  wrap: { fontFamily: 'Inter, system-ui, sans-serif', padding: 24, maxWidth: 1100, margin: '0 auto' },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, marginTop: 16 },
  th: { textAlign: 'left', padding: 10, borderBottom: '2px solid #e2e8f0', fontSize: 12, color: '#64748b', textTransform: 'uppercase' },
  td: { padding: 10, borderBottom: '1px solid #f1f5f9', fontSize: 14 },
  toggle: (on) => ({ padding: '10px 14px', borderRadius: 8, border: `2px solid ${on ? '#ea580c' : '#cbd5e1'}`, background: on ? '#fff7ed' : '#fff', color: on ? '#9a3412' : '#334155', fontWeight: 600, cursor: 'pointer' }),
  btn: { padding: '10px 18px', border: 0, borderRadius: 8, background: '#0f172a', color: '#fff', fontWeight: 700, cursor: 'pointer' },
  stat: { background: '#0f172a', color: '#fff', borderRadius: 10, padding: '14px 16px' },
  num: { fontSize: 24, fontWeight: 700 },
  lbl: { fontSize: 12, opacity: 0.7, textTransform: 'uppercase' },
};

export default function JevCarrierPage() {
  const [urgent, setUrgent] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function recommend() {
    setBusy(true); setError('');
    try {
      setResult(await recommendCarrier({
        order: ORDER, options: OPTIONS,
        facts: { urgent, declines: declined ? { 'KLLM TRANSPORT': 2 } : {}, premiumCap: 150 },
      }));
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  const auto = result?.route === 'AUTO_RECOMMEND';
  const hist = Object.fromEntries((result?.carriers || []).map((c) => [c.carrier, c]));

  return (
    <div style={s.wrap}>
      <h2 style={{ margin: 0 }}>Carrier Recommendation · Jev</h2>
      <div style={{ color: '#64748b' }}>Zoree finds eligible carriers and rates. Jev judges the best fit. Zoree computes the premium and decides auto vs planner. Tendering stays a separate approval.</div>

      <div style={s.card}>
        <b>{ORDER.id}</b> · {ORDER.lane} · {ORDER.weight} · ready {ORDER.ready} · due {ORDER.due}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
          <thead><tr>{['Eligible carrier', 'TL rate', 'Transit', 'Loads with us', 'On-time', 'Recent declines', 'Jev probability'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
          <tbody>
            {OPTIONS.map((o) => {
              const h = hist[o.carrier];
              const p = result?.probabilities?.[o.carrier];
              const isPick = result?.pick === o.carrier;
              return (
                <tr key={o.carrier} style={{ background: isPick ? '#f0fdf4' : undefined }}>
                  <td style={s.td}><b>{o.carrier}</b>{isPick && <span style={{ marginLeft: 8, color: '#16a34a', fontWeight: 700 }}>★ Jev pick</span>}</td>
                  <td style={s.td}>${o.rate.toLocaleString()}</td>
                  <td style={s.td}>{o.transitDays} days</td>
                  <td style={s.td}>{h ? h.loads : '—'}</td>
                  <td style={s.td}>{h ? (h.onTimePct == null ? 'n/a' : `${h.onTimePct}% of ${h.delivered}`) : '—'}</td>
                  <td style={s.td}>{h ? h.recentDeclines : (declined && o.carrier === 'KLLM TRANSPORT' ? 2 : 0)}</td>
                  <td style={s.td}>
                    {p == null ? '—' : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ height: 8, width: 120, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${p * 100}%`, background: isPick ? '#16a34a' : '#94a3b8' }} />
                        </div>
                        {Math.round(p * 100)}%
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>Rates from Zoree rating for this order. Loads and on-time are live from the shipments table.</div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 16, alignItems: 'center' }}>
        <span style={{ fontWeight: 600 }}>What-if:</span>
        <button style={s.toggle(urgent)} onClick={() => setUrgent(!urgent)}>{urgent ? '✓ ' : ''}Delivery is urgent</button>
        <button style={s.toggle(declined)} onClick={() => setDeclined(!declined)}>{declined ? '✓ ' : ''}KLLM declined twice on this lane</button>
        <div style={{ flex: 1 }} />
        <button style={s.btn} onClick={recommend} disabled={busy}>{busy ? 'Asking Jev…' : 'Recommend carrier'}</button>
      </div>
      {error && <div style={{ color: '#dc2626', marginTop: 12 }}>{error}</div>}

      {result && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 16 }}>
          <div style={s.stat}><div style={s.num}>{result.pick.split(' ')[0]}</div><div style={s.lbl}>Jev recommends</div></div>
          <div style={s.stat}><div style={s.num}>{Math.round(result.confidence * 100)}%</div><div style={s.lbl}>Confidence</div></div>
          <div style={s.stat}><div style={s.num}>{result.premium > 0 ? `+$${result.premium}` : '$0'}</div><div style={s.lbl}>Premium vs cheapest (cap ${result.premiumCap})</div></div>
          <div style={{ ...s.stat, background: auto ? '#166534' : '#92400e' }}>
            <div style={s.num}>{auto ? 'Auto-recommend' : 'Planner review'}</div>
            <div style={s.lbl}>{result.latencyMs} ms · tender needs approval</div>
          </div>
        </div>
      )}
    </div>
  );
}
