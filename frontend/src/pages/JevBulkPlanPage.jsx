// Bulk plan — Zoree enforces hard rules and builds feasible plans; Jev chooses
// among them. Plans the orders handed over by "Plan with Jev" on the Orders
// screen (?orders=…), one plan per lane, or the default 10-order lane.
// Never tenders.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { runBulkPlan, readJevOrderIds, jevBulkPlanPath, summarizeBulkPlan } from '../services/jevTriageService';
import JevLanePlan from '../components/jev/JevLanePlan';
import { s } from '../components/jev/jevStyles';

export default function JevBulkPlanPage() {
  const [kllmOut, setKllmOut] = useState(false);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [searchParams] = useSearchParams();
  const orderIds = useMemo(() => readJevOrderIds(searchParams), [searchParams]);
  const picked = orderIds.length > 0;
  const idsKey = orderIds.join(',');

  async function go(out = kllmOut) {
    setBusy(true); setError('');
    try { setRes(await runBulkPlan(out, orderIds)); } catch (e) { setRes(null); setError(e.message); }
    setBusy(false);
  }
  // Arriving from the Orders screen with a selection: plan it straight away.
  useEffect(() => { if (picked) go(); }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const summary = useMemo(() => summarizeBulkPlan(res), [res]);

  return (
    <div style={s.wrap}>
      <h2 style={{ margin: 0 }}>Bulk Plan · {picked ? `${orderIds.length} Selected Order${orderIds.length === 1 ? '' : 's'}` : '10 Orders'} · Zoree rules + Jev judgment</h2>
      <div style={{ color: '#64748b' }}>Live data: {picked ? 'the orders you selected on the Orders screen' : '10 real unplanned orders'} and current TL contract rates from Zoree. Zoree enforces truck capacity and builds feasible plans; Jev chooses among feasible plans only. Nothing is tendered.</div>
      {picked && (
        <div style={{ marginTop: 6, fontSize: 13 }}>
          <Link to="/orders">← Back to Orders</Link> · <Link to={jevBulkPlanPath()}>Use the default 10-order lane instead</Link>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' }}>
        <button style={s.btn} onClick={() => go()} disabled={busy}>{busy ? 'Planning…' : picked ? `Plan ${orderIds.length} selected order${orderIds.length === 1 ? '' : 's'}` : 'Plan 10 orders'}</button>
        <button style={s.toggle(kllmOut)} onClick={() => { const v = !kllmOut; setKllmOut(v); if (res) go(v); }}>
          {kllmOut ? '✓ ' : ''}KLLM has no capacity today
        </button>
        {error && <span style={{ color: '#dc2626' }}>{error}</span>}
      </div>

      {res?.skipped?.length > 0 && (
        <div style={{ ...s.card, borderColor: '#f59e0b', background: '#fffbeb', fontSize: 13 }}>
          <b>Left out of this plan:</b> {res.skipped.map((k) => `${k.id} (${k.reason})`).join('; ')}
        </div>
      )}

      {!res && !error && (
        <div style={{ ...s.card, fontSize: 13 }}>{busy ? 'Planning…' : picked ? 'Click “Plan selected orders”.' : 'Click “Plan 10 orders”.'}</div>
      )}

      {summary && (
        <div style={{ ...s.card, fontSize: 13 }}>
          <b>{summary.lanes} lanes</b>, each planned separately because orders only share a truck and a rate within one lane.
          {' '}Jev's picks total <b>${summary.cost.toLocaleString()}</b> across {summary.trucks} shipment{summary.trucks === 1 ? '' : 's'}
          {' '}· {summary.review} lane{summary.review === 1 ? '' : 's'} need planner review
          {summary.failed > 0 && <span style={{ color: '#991b1b' }}> · {summary.failed} could not be planned</span>}.
        </div>
      )}

      {(res?.lanes || []).map((lane) => <JevLanePlan key={lane.lane} lane={lane} />)}
    </div>
  );
}
