// One lane of a Jev bulk plan: Jev's pick, the lane's orders, the hard-rule
// rejections and every feasible plan. A lane that could not be planned shows
// its reason and its orders instead.
import { s } from './jevStyles';

const laneTitle = { fontWeight: 800, fontSize: 16, marginTop: 28, paddingTop: 16, borderTop: '2px solid #e2e8f0' };

export default function JevLanePlan({ lane }) {
  const affected = new Set(lane.affectedOrders || []);
  const title = lane.lane.replace('->', '→');

  if (lane.error) {
    return (
      <div>
        <div style={laneTitle}>{title}</div>
        <div style={{ ...s.card, borderColor: '#fca5a5', background: '#fef2f2', fontSize: 13 }}>
          <b style={{ color: '#991b1b' }}>Not planned.</b> {lane.error}
          <div style={{ marginTop: 6, color: '#475569' }}>Orders: {lane.orders.map((o) => o.id).join(', ')}</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={laneTitle}>{title}</div>
      {lane.estimatedMiles > 0 && (
        <div style={{ ...s.card, fontSize: 13, color: '#475569' }}>
          Distance is estimated at <b>{lane.estimatedMiles.toLocaleString()} mi</b> from the order ZIP codes (straight line × 1.2), because the contract rates for this lane have no mileage. Costs below use that estimate.
        </div>
      )}

      {(
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginTop: 14 }}>
          <div style={s.stat}><div style={s.num}>Plan {lane.pick}</div><div style={s.lbl}>Jev picks · {lane.pickLabel}</div></div>
          <div style={s.stat}><div style={s.num}>{Math.round(lane.confidence * 100)}%</div><div style={s.lbl}>Confidence</div></div>
          <div style={s.stat}><div style={s.num}>+${lane.premium}</div><div style={s.lbl}>vs cheapest (Plan {lane.cheapest})</div></div>
          <div style={s.stat}><div style={s.num}>{Math.round((lane.penaltyRisk || 0) * 100)}%</div><div style={s.lbl}>Cheapest plan late-delivery risk</div></div>
          <div style={{ ...s.stat, background: lane.route === 'RECOMMEND_FOR_APPROVAL' ? '#166534' : '#92400e' }}>
            <div style={s.num}>{lane.route === 'RECOMMEND_FOR_APPROVAL' ? 'Recommend' : 'Planner review'}</div>
            <div style={s.lbl}>{lane.latencyMs} ms · planner approves tender</div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 14 }}>
        <div>
          <div style={s.card}>
            <div style={s.h}>{lane.orders.length} order{lane.orders.length === 1 ? '' : 's'}</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Order', 'Dest', 'Lbs', 'Pcs', 'Due', 'Customer / rule'].map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
              <tbody>
                {(lane.orders || []).map((o) => (
                  <tr key={o.id} style={{ background: affected.has(o.id) ? '#fef2f2' : undefined }}>
                    <td style={s.td}><b>{o.id}</b>{affected.has(o.id) && <span style={{ color: '#dc2626' }}> ⟳</span>}</td>
                    <td style={s.td}>{o.dest}</td><td style={s.td}>{o.lbs.toLocaleString()}</td><td style={s.td}>{o.plt}</td>
                    <td style={s.td}>{o.due}</td><td style={{ ...s.td, color: '#9a3412' }}>{o.rule || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {affected.size > 0 && <div style={{ fontSize: 12, color: '#991b1b', marginTop: 6 }}>⟳ Replanned because KLLM is unavailable: {[...affected].join(', ')}</div>}
          </div>
          {lane.rejected.length > 0 && (
            <div style={s.card}>
              <div style={s.h}>Rejected by Zoree hard rules (53' van: 44,000 lbs)</div>
              {lane.rejected.map((r) => (
                <div key={r.orders.join()} style={{ fontSize: 13, marginBottom: 4 }}>
                  <span style={{ color: '#dc2626', fontWeight: 700 }}>✕</span> {r.orders.join(' + ')}: {r.errs.join('; ')}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          {(lane.plans || []).map((p) => {
            const isPick = lane.pick === p.key;
            const prob = lane.probabilities?.[p.key];
            return (
              <div key={p.key} style={{ ...s.card, border: isPick ? '2px solid #16a34a' : s.card.border }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={s.h}>Plan {p.key} · {p.label} · ${p.cost.toLocaleString()} · {p.trucks} shipments {isPick && <span style={{ color: '#16a34a' }}>★ Jev pick</span>}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <div style={{ height: 8, width: 100, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${(prob || 0) * 100}%`, background: isPick ? '#16a34a' : '#94a3b8' }} />
                    </div>
                    {prob == null ? '—' : `${Math.round(prob * 100)}%`}
                  </div>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {p.loads.map((l, i) => (
                      <tr key={i}>
                        <td style={{ ...s.td, width: 130 }}><b>{l.orders.join(' + ')}</b></td>
                        <td style={{ ...s.td, width: 110 }}>{l.carrier}</td>
                        <td style={s.td}>{l.note}</td>
                        <td style={{ ...s.td, width: 150, color: '#64748b' }}>{l.lbs.toLocaleString()} lbs · {l.plt} pcs</td>
                        <td style={{ ...s.td, width: 70, textAlign: 'right' }}>${l.cost.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
