// Signed deep links for alert buttons. The link carries the symbol, the SORK concept and a signature, so the mini app can
// open on the right page and the server can tell a real alert link from a hand-made one (needed for the open-once reward).
// Link parameter (Telegram start_param allows A-Z a-z 0-9 _ - up to 64 chars):  <symbol>_<concept>[_<ts36>_<id>_<sig>]
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const LINK_MAX_AGE = 24 * 3600;                       // an alert link earns points for 24 hours
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

// -> { ok, symbol, concept, id, ts } ; id is what the app remembers so one alert pays only once
export function checkParam(param, secret, now = Date.now() / 1000) {
  const m = /^([A-Za-z0-9]+)_([A-Z]+)_([0-9a-z]+)_([0-9a-f]{8})_([0-9a-f]{10})$/.exec(String(param || ''));
  if (!m) return { ok: false, reason: 'not an alert link' };
  const [, symbol, concept, ts36, id, sig] = m;
  const want = sign(secret, `${symbol}_${concept}_${ts36}_${id}`);
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return { ok: false, reason: 'bad signature' };
  const ts = parseInt(ts36, 36);
  if (now - ts > LINK_MAX_AGE) return { ok: false, reason: 'alert too old' };
  return { ok: true, symbol, concept, ts, id: `${ts36}_${id}` };
}

// ---- private XP status, shown as a pop-up that only the person who tapped the "XP status" button sees
export const ALERT_XP = 3, ANALYSIS_XP = 10;                 // keep equal to ALERT_XP / ANALYSIS_XP in web/rank.js
export const isAlertId = (id) => /^[0-9a-z]+_[0-9a-f]{8}$/.test(String(id || ''));
// st: 0 = not opened, 1 = opened (+3 earned), 2 = opened and analysed (+13 earned). Telegram allows 200 characters in the pop-up.
export function xpStatusText(st, id, now = Date.now() / 1000) {
  const fresh = now - parseInt(String(id).split('_')[0], 36) < LINK_MAX_AGE;
  if (st >= 2) return `✅ You opened and analysed this alert: +${ALERT_XP + ANALYSIS_XP} XP earned.`;
  if (st === 1) return `✅ You opened this alert: +${ALERT_XP} XP earned.` + (fresh ? `\n+${ANALYSIS_XP} XP to claim: finish its Intercept Analysis in the Rank tab, if you have not yet.` : '');
  return fresh ? `⏳ +${ALERT_XP} XP to claim. Tap Open chart on this alert to earn it, then +${ANALYSIS_XP} XP more for analysing it.`
    : 'This alert is older than 24 hours, so it no longer pays XP.';
}
