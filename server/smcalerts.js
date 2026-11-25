// Turns what the live SMC feed sees (smcfeed.js 'update' / reconnect snapshots) into Telegram alerts. Pure: no network, no I/O.
//   BOS (S)                     a candle BODY closed beyond the latest swing in the trend direction
//   inducement / disruption (O) a new IDM / DISR zone was mapped in the trend direction
//   invalidated (O)             the trend flipped (a body closed beyond the DISR zone)
// Keys follow the ones the polled path (service.js apply) already uses for H1 order flow (`inducement-<bos_t>`, `inv-<t>`), so when both paths
// see the same event only ONE alert is stored and sent (the store ignores duplicate keys).
const ROLE = { idm: 'inducement', disr: 'disruption' };
const TF_NAME = { 300: 'm5', 3600: 'h1', 14400: 'h4' };
const TF_LABEL = { 300: 'M5', 3600: 'H1', 14400: 'H4' };
const side = (d) => (d === 1 ? 'bullish' : 'bearish');

// input: { sym, name, tf (seconds), changed: [annotations], trend, prevTrend (null = unknown), t (open time of the candle that closed), digits }
// returns: [{ key, ts, symbol, symbol_name, concept, kind, dir, title, body, payload, ev }]  (ev = what chartSnap needs)
export function smcAlertsFrom({ sym, name, tf, changed = [], trend = 0, prevTrend = null, t, digits = 3 }) {
  const tn = TF_NAME[tf] || String(tf), TL = TF_LABEL[tf] || tn, f = (x) => Number(x).toFixed(digits), out = [];
  const pre = tf === 3600 ? '' : `${tn}-`;                                   // H1 keeps the polled path's uid so the two paths dedupe
  const push = (concept, kind, dir, closeT, uid, title, body, extra) => out.push({
    key: `${sym}|smc|${concept}|${kind}|${pre}${uid}`, ts: closeT, symbol: sym, symbol_name: name, concept, kind, dir, title, body,
    payload: { ...extra, tf, bias: trend, src: 'smc', live: true }, ev: { tf, t: closeT, extra },
  });
  for (const a of changed) {
    if (a.provisional) continue;
    if (a.type === 'bos' && a.t1 != null) {
      push('S', 'bos', a.dir, a.t1 + tf, `bos-${a.t1}`, `S: ${TL} break of structure (${side(a.dir)})`,
        `SMC ${TL}: a candle body closed beyond ${f(a.price)}. ${a.dir === 1 ? 'Higher high' : 'Lower low'} on ${TL}.`, { level: a.price });
    } else if (a.type === 'idm' && a.zone && ROLE[a.role] && a.status !== 'void' && a.dir === trend) {
      const role = ROLE[a.role];
      push('O', role, a.dir, a.bos_t + tf, `${role}-${a.bos_t}`, `O: new ${role} POI (${side(a.dir)}) on ${TL}`,
        `SMC ${TL}: zone ${f(a.lo)} to ${f(a.hi)}. It formed with the BOS that broke ${f(a.bos_level)}.`, { lo: a.lo, hi: a.hi, t0: a.t0 });
    }
  }
  if (prevTrend && trend && prevTrend !== trend && t != null) {
    push('O', 'invalidated', trend, t + tf, `inv-${t}`, `O: ${TL} disruption invalidated, trend flipped`,
      `A ${TL} body closed beyond the DISR zone, so the SMC trend flips to ${trend === 1 ? 'up' : 'down'}. The new IDM and DISR are mapped in the new direction.`, {});
  }
  return out;
}
