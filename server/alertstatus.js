// Is an alert still worth XP? The rule: an alert pays XP (one Intercept Analysis) until it is INVALIDATED. Age does not matter.
// An invalidated alert pays nothing, and its analysis does not count.
//   - key level (K) and bjeff zone / 50% POI (ADV) alerts: invalidated by a later "key level invalidated" alert (an M5 body closed outside the POI,
//     which also kills every older key level) or by a later order flow invalidation (the disruption was broken, the trend flipped)
//   - reclamation (R) alerts: invalidated by a later order flow invalidation (the inducement / disruption they sit on is gone)
//   - QML alerts: invalidated when that QML's own POI was invalidated, or by a later order flow invalidation
// An alert the server no longer holds (restart) cannot be checked, so it pays nothing either; otherwise every old alert in the channel history could be farmed.
import { alertId } from './alertlink.js';
import { H1 } from './engine.js';

const KL_FAMILY = new Set(['K', 'ADV']);
const isSmc = (a) => !!(a && ((a.payload && a.payload.src === 'smc') || String(a.key || '').includes('|smc|')));

// state: the symbol's latest evaluated state for the same source as the alert (SMC or SORK); only its QML is read.
// Returns 'active' | 'invalidated'.
export function invalidation(store, alert, state) {
  const later = store.alertsSince(alert.symbol, alert.ts).filter((b) => isSmc(b) === isSmc(alert) && b.id !== alert.id);
  const flowBroken = later.some((b) => b.kind === 'invalidated' && Number((b.payload || {}).tf || H1) === H1);   // H1 order flow flipped (M5 / H4 flips are other charts)
  if (flowBroken) return 'invalidated';
  if (KL_FAMILY.has(alert.concept) && later.some((b) => b.kind === 'kl_invalid')) return 'invalidated';
  if (alert.concept === 'QML') {
    const q = state && state.qml, t0 = (alert.payload || {}).t0;
    if (q && q.invalidated_t && (t0 == null || q.t === t0)) return 'invalidated';
  }
  return 'active';
}

// Looks an alert up by the id the Telegram link carries (symbol may be null: the XP status button has none) and says whether it can still earn XP.
// -> 'active' | 'invalidated' | 'unknown' (the server does not hold this alert)
export function alertStatus(store, svc, symbol, oid) {
  const ts = parseInt(String(oid).split('_')[0], 36);
  const alert = store.alertsAt(symbol, ts).find((a) => alertId(a) === oid);
  if (!alert) return 'unknown';
  const st = (isSmc(alert) ? svc.smcStates : svc.states).get(alert.symbol);
  return invalidation(store, alert, st);
}
