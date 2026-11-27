// Signed deep links for alert buttons. The link carries the symbol, the SORK concept and a signature, so the mini app can
// open on the right page and the server can tell a real alert link from a hand-made one (needed for the open-once reward).
// Link parameter (Telegram start_param allows A-Z a-z 0-9 _ - up to 64 chars):  <symbol>_<concept>[_<ts36>_<id>_<sig>]
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const sign = (secret, body) => createHmac('sha256', secret || 'dev').update(body).digest('hex').slice(0, 10);

// The id the app remembers for an alert (the same id checkParam returns), so the Alerts tab can show which alerts were already opened.
export function alertId(alert) {
  const ts = Math.max(0, Math.floor(alert.ts || 0)).toString(36);
  const id = createHash('sha1').update(String(alert.key || `${alert.symbol}|${alert.concept}|${alert.ts}`)).digest('hex').slice(0, 8);
  return `${ts}_${id}`;
}

// signed = false: plain page link (private messages, no reward)
export function alertParam(alert, secret, signed = true) {
  const base = `${alert.symbol}_${alert.concept}`;
  if (!signed) return base;
  const [ts, id] = alertId(alert).split('_');
  return `${base}_${ts}_${id}_${sign(secret, `${base}_${ts}_${id}`)}`;
}

// -> { ok, symbol, concept, id, ts } ; id is what the app remembers so one alert pays only once. Age does not matter here: whether the alert is
// still worth XP (not invalidated) is decided by the server from its own alert records, see alertstatus.js.
export function checkParam(param, secret) {
  const m = /^([A-Za-z0-9]+)_([A-Z]+)_([0-9a-z]+)_([0-9a-f]{8})_([0-9a-f]{10})$/.exec(String(param || ''));
  if (!m) return { ok: false, reason: 'not an alert link' };
  const [, symbol, concept, ts36, id, sig] = m;
  const want = sign(secret, `${symbol}_${concept}_${ts36}_${id}`);
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return { ok: false, reason: 'bad signature' };
  const ts = parseInt(ts36, 36);
  return { ok: true, symbol, concept, ts, id: `${ts36}_${id}` };
}

// ---- private XP status, shown as a pop-up that only the person who tapped the "XP status" button sees
export const ALERT_XP = 3;                                       // keep equal to ALERT_XP in web/rank.js: one Intercept Analysis = the first open of an alert that is not invalidated
export const isAlertId = (id) => /^[0-9a-z]+_[0-9a-f]{8}$/.test(String(id || ''));
// st: 0 = not opened, 1 = opened (an Intercept Analysis done, +3 XP earned). status: 'active' | 'invalidated' | 'unknown' (see alertstatus.js).
// Telegram allows 200 characters in the pop-up.
export function xpStatusText(st, status = 'active') {
  if (st >= 1) return `✅ You opened this alert: Intercept Analysis done, +${ALERT_XP} XP earned.`;
  if (status === 'invalidated') return 'This alert was invalidated, so it no longer pays XP.';
  if (status === 'unknown') return 'This alert can no longer be checked, so it does not pay XP.';
  return `⏳ +${ALERT_XP} XP to claim. Tap Open chart on this alert: the first open of an alert that is not invalidated is one Intercept Analysis.`;
}
