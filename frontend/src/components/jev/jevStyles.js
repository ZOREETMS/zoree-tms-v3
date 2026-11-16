// Shared inline styles for the Jev pages' cards, tables and stat tiles.
export const s = {
  wrap: { fontFamily: 'Inter, system-ui, sans-serif', padding: 24, maxWidth: 1280, margin: '0 auto' },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginTop: 14 },
  h: { fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', fontSize: 13, color: '#334155' },
  th: { textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', fontSize: 11, color: '#64748b', textTransform: 'uppercase' },
  td: { padding: '6px 8px', borderBottom: '1px solid #f1f5f9', fontSize: 13, verticalAlign: 'top' },
  btn: { padding: '10px 18px', border: 0, borderRadius: 8, background: '#0f172a', color: '#fff', fontWeight: 700, cursor: 'pointer' },
  toggle: (on) => ({ padding: '10px 14px', borderRadius: 8, border: `2px solid ${on ? '#dc2626' : '#cbd5e1'}`, background: on ? '#fef2f2' : '#fff', color: on ? '#991b1b' : '#334155', fontWeight: 600, cursor: 'pointer' }),
  stat: { background: '#0f172a', color: '#fff', borderRadius: 10, padding: '12px 14px' },
  num: { fontSize: 22, fontWeight: 700 }, lbl: { fontSize: 11, opacity: 0.7, textTransform: 'uppercase' },
};
