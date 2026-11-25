// Service record: ranks earned by learning and discipline. Progress is saved per person in Telegram's own storage
// (CloudStorage), with the browser's localStorage as a fallback, so no database is needed on the server.
// There is no leaderboard and nothing here rates trades or gives advice.
// The ranks every person shares, up to Lieutenant: [name, XP]. Above Lieutenant the ladder is the chosen service's own (BRANCHES below).
const BASE_RANKS = [['Recruit', 0], ['Private', 40], ['Corporal', 120], ['Sergeant', 250], ['Lieutenant', 450]];
const CHAPTERS = ['The SORK framework', 'S: Market Structure', 'O: Order Flow', 'R: Reclamation', 'K: Key Level', 'QML: the inverse key level', 'Advanced key level and bjeff zone', 'Trade checklist'];
// Military line icons for the missions and medals (24x24, stroke only)
const STAR = '<path d="M12 8l1.2 2.5 2.8.4-2 2 .5 2.8-2.5-1.3-2.5 1.3.5-2.8-2-2 2.8-.4z"/>';
const ICON = {
  roll: '<path d="M7 3h10a2 2 0 012 2v11l-7 5-7-5V5a2 2 0 012-2z"/><path d="M8.5 11l2.5 2.5 4.5-5"/>',                                                    // dog tag with check
  intercept: '<rect x="5" y="10" width="14" height="11" rx="1"/><path d="M9 10V3M13 6.5a4 4 0 012.5 3.5M8 14h8M8 17h5"/><circle cx="16" cy="18" r="1"/>',   // field radio
  drill: '<path d="M4 17V10l2.5-6H9l1 6M20 17V10l-2.5-6H15l-1 6M10 12h4"/><circle cx="7" cy="17" r="3.5"/><circle cx="17" cy="17" r="3.5"/>',                   // binoculars
  guide: '<path d="M6 3h12v18H6z"/><path d="M9 3v18"/><g transform="translate(2.5 -1.5)">' + STAR + '</g>',                                                    // field manual
  exam: '<circle cx="11" cy="13" r="8"/><circle cx="11" cy="13" r="4"/><circle cx="11" cy="13" r=".8"/><path d="M12 12l8-8M16.5 4H20v3.5"/>',                  // target with arrow
  first: '<path d="M3 19h18M6 19a6 6 0 0112 0M12 5V2.5M4.5 9.5L3 8M19.5 9.5L21 8"/>',                                                                           // first light: sunrise
  wk7: '<path d="M4.5 14.5C4.5 8.5 8 5 12 5s7.5 3.5 7.5 9.5"/><path d="M2 14.5h20l-2.5 4h-15zM8 9.5h8"/>',                                                                                     // helmet
  wk30: '<path d="M6 21V3M6 4h13l-3.5 4 3.5 4H6"/>',                                                                                                               // flag
  wk90: '<path d="M4 21V8h2.5V5H9v3h2V5h2v3h2V5h2.5v3H20v13z"/><path d="M10 21v-5h4v5"/>',                                                                        // fortress tower
  scholar: '<path d="M3 5h7a2 2 0 012 2v13a2 2 0 00-2-2H3zM21 5h-7a2 2 0 00-2 2v13a2 2 0 012-2h7z"/>',                                                           // open manual
  honors: '<circle cx="12" cy="11" r="8"/><g transform="translate(0 -1)">' + STAR + '</g><path d="M8 18l-1.5 4 3-1.2M16 18l1.5 4-3-1.2"/>',                      // star, top of class
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/><path d="M12 1.5V4M12 20v2.5"/>',                              // sharp eye
  analyst: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l6-6"/><circle cx="16" cy="15.5" r="1"/>',                           // radar sweep
  // The three services a Lieutenant chooses between
  army: '<path d="M4.5 8l10 10M19.5 8l-10 10M12.5 20l4-4M11.5 20l-4-4M14.5 18l3.5 3.5M9.5 18L6 21.5"/><path d="M12 2l1.1 2.3 2.5.35-1.8 1.75.45 2.5L12 7.7l-2.25 1.2.45-2.5L8.4 4.65l2.5-.35z"/>',   // crossed swords under a star
  navy: '<circle cx="12" cy="4.8" r="2.2"/><path d="M12 7v14.5M8.2 10.5h7.6M4.5 13.5c.3 4.2 3.4 7.5 7.5 7.5s7.2-3.3 7.5-7.5M4.5 13.5l-1.7 2.2M19.5 13.5l1.7 2.2"/>',                // anchor
  air: '<path d="M12 2.5c1.1 1.4 1.4 3.6 1.4 6.2l8.1 5.8v2.2l-8.1-2.6v4.1l2.3 1.9v1.9L12 21.2l-3.7 1v-1.9l2.3-1.9v-4.1l-8.1 2.6v-2.2l8.1-5.8c0-2.6.3-4.8 1.4-6.2z"/>',        // jet
};
const ico = k => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
const MEDALS = {
  first: ['First Light', 'First roll call'], wk7: ['Week Guard', '7 day roll call streak'], wk30: ['Month Veteran', '30 day roll call streak'], wk90: ['Old Guard', '90 day roll call streak'],
  scholar: ['Scholar', 'Read every guide chapter'], honors: ['Top of Class', 'Pass every chapter exam'], eye: ['Sharp Eye', '5 chart drills right'],
  analyst: ['Alert Analyst', 'Analyse 5 Telegram alerts'],
};
const DAILY_CAP = { drill: 3 };
const QUIZ = [
  [['Which pillar is read on M5?', ['S: Market Structure', 'O: Order Flow', 'R: Reclamation', 'K: Key Level'], 3, 'Key level entries are on M5. Structure is H4, order flow and reclamation are H1.'],
   ['Which timeframe gives the trend direction?', ['M5', 'H1', 'H4', 'Daily'], 2, 'The trend direction comes from H4 only.'],
   ['What do you work out first?', ['The key level', 'The trend', 'The confirmation', 'The entry'], 1, 'Work through them in order: the trend first, then the points of interest, then the confirmation, then the key level.']],
  [['Where does the trend direction come from?', ['M5 only', 'H1 only', 'H4 only', 'Any timeframe'], 2, 'The trend direction comes from H4 only; H1 is used for order flow.'],
   ['A trend is only valid when it has...', ['A break of structure only', 'Liquidity only', 'Both liquidity and a break of structure', 'Two reclamations'], 2, 'A trend needs both liquidity (LQ) and a break of structure (BOS).'],
   ['In an uptrend, the liquidity (LQ) candle is...', ['A bullish green candle', 'A bearish red candle', 'A doji', 'Any gap'], 1, 'In an uptrend green candles dominate, so the LQ is the opposite-coloured red candle.']],
  [['What is the inducement?', ['The oldest BOS', 'The latest BOS in a trend', 'Any wick', 'The stop loss'], 1, 'The inducement is the latest BOS in a trend.'],
   ['What is the disruption?', ['The BOS right after the inducement', 'The BOS immediately before the inducement', 'A failed reclamation', 'The key level'], 1, 'The disruption is the BOS immediately before the inducement.'],
   ['Which timeframe is used for order flow?', ['M5', 'H1', 'H4', 'Weekly'], 1, 'Order flow is read on H1, using the trend set on H4.']],
  [['On which timeframe is a reclamation detected?', ['M5', 'H1', 'H4', 'Daily'], 1, 'Reclamation is detected on H1, at the inducement and disruption POIs.'],
   ['How many steps does a reclamation have?', ['3', '4', '5', '7'], 2, 'A reclamation has five steps.'],
   ['On its own, a reclamation is...', ['An entry signal', 'A confirmation, never an entry on its own', 'A stop loss rule', 'A trend filter'], 1, 'A reclamation adds confirmation but is never an entry on its own.']],
  [['A key level is made of...', ['One long wick', 'Two opposite candle bodies with equal or almost identical tops or bottoms', 'Three green candles', 'A gap on M5'], 1, 'Two opposite candle bodies sitting next to each other with matching tops or bottoms.'],
   ['Key levels are found and judged on...', ['M5', 'H1', 'H4', 'Daily'], 1, 'Key levels are found on H1 and their validity is judged on H1.'],
   ['RBS means...', ['Resistant becomes support (look for buys)', 'Reclamation breaks structure', 'Retest before stop', 'Rally below support'], 0, 'RBS is a resistant key level that has become support, so you look for buys.']],
  [['QML stands for...', ['Quick Market Line', 'Quasimodo Level', 'Quality Market Level', 'Quarter Mark Line'], 1, 'QML means Quasimodo Level.'],
   ['What is the QML used for?', ['Trading a reversal after a key level is invalidated', 'Finding the H4 trend', 'Setting the stop loss', 'Counting wicks'], 0, 'It is how to trade in the reverse direction after a directional key level has been taken out or invalidated.'],
   ['Where is a QML entered?', ['H4', 'H1', 'M5', 'Daily'], 2, 'Confirmation is on H1 and the entry is on M5, just like a normal key level.']],
  [['The 50% of the key level is...', ['The middle of the POI box', 'The top edge', 'The stop loss', 'The previous high'], 0, 'The 100% is the full POI box and the 50% is its middle.'],
   ['For the advanced key level, the M5 confirmation can be...', ['Only inside the POI', 'Inside or outside the POI', 'Only above the POI', 'Skipped'], 1, 'Unlike the standard key level, it can be inside or outside the POI.'],
   ['Which candle patterns are named as entry confirmation?', ['Engulf and harami', 'Doji and gap', 'Marubozu only', 'Heikin Ashi'], 0, 'Candle reversal patterns such as engulf and harami.']],
  [['What must not happen to the inducement and disruption POIs?', ['They must not be drawn', 'An H1 body close beyond the disruption POI', 'A touch on M5', 'A wick on H4'], 1, 'Check they are not invalidated by an H1 body close beyond the disruption POI.'],
   ['Maximum wicks inside a valid key level POI?', ['0', '2', '5', 'No limit'], 1, 'Count the wicks inside its POI: no more than 2.'],
   ['Where is the stop loss set?', ['Slightly outside the POI', 'Far from the POI', 'Inside the POI', 'At the entry'], 0, 'Set the SL slightly outside the POI.']],
];

// ---- storage
const tgs = window.Telegram && Telegram.WebApp;
const cloud = () => { try { return tgs && tgs.CloudStorage && tgs.isVersionAtLeast && tgs.isVersionAtLeast('6.9') ? tgs.CloudStorage : null; } catch { return null; } };
// The browser's localStorage is shared by every Telegram account on the same phone, so each key carries the account's own id. Without this a second
// account opening the app on the same phone would read the first account's rank and XP (and then report it to the server as its own).
const myId = () => (tgs && tgs.initDataUnsafe && tgs.initDataUnsafe.user && tgs.initDataUnsafe.user.id) || null;
const lsKey = k => `${k}@${(tgs && tgs.initDataUnsafe && tgs.initDataUnsafe.user && tgs.initDataUnsafe.user.id) || 'anon'}`;
const lsGet = k => { try { return localStorage.getItem(lsKey(k)); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(lsKey(k), v); } catch { /* private mode */ } };
const kvGet = k => new Promise(res => { const c = cloud(); if (!c) return res(lsGet(k)); try { c.getItem(k, (e, v) => res(!e && v ? v : lsGet(k))); } catch { res(lsGet(k)); } });
const kvSet = (k, v) => { lsSet(k, v); const c = cloud(); if (c) try { c.setItem(k, v, () => {}); } catch { /* ignore */ } };

const today = () => new Date().toLocaleDateString('en-CA');
const dayBefore = () => new Date(Date.now() - 864e5).toLocaleDateString('en-CA');
let RKS = null;
const fresh = () => ({ v: 1, xp: 0, ch: [], qz: {}, streak: 0, best: 0, last: '', drillOk: 0, drillMiss: 0, anTotal: 0, medals: [], promo: 0, rank: null, branch: null, d: { date: '', drill: 0 } });
// ONE-OFF cleanup for a single test account that was handed another account's progress (two Telegram accounts on one phone, before the
// per-account storage fix). Runs once for this id, then never again (it leaves a flag). Delete this block and the call in rk() afterwards.
const WIPE_ID = 959811481;
async function wipeOnce() {
  if (myId() !== WIPE_ID || await kvGet('sork_wiped_1')) return;
  const keys = ['sork_rank', 'sork_alert_opens', 'sork_alert_queue', 'sork_alert_log'], c = cloud();
  keys.forEach(k => { try { localStorage.removeItem(lsKey(k)); } catch { /* ignore */ } });
  if (c) await new Promise(r => { try { c.removeItems(keys, () => r()); } catch { r(); } });
  kvSet('sork_wiped_1', '1');
}
async function rk() {
  if (RKS) return RKS;
  await wipeOnce();
  let s; try { s = JSON.parse(await kvGet('sork_rank') || 'null'); } catch { s = null; }
  if (s && s.owner && myId() && s.owner !== myId()) s = null;   // saved by another account: never show it as this person's
  RKS = Object.assign(fresh(), s || {});
  // Saved before the 30% rule: anyone already at Sergeant or above keeps their old passes (2 of 3) so the new rule never demotes them.
  if (RKS.rank != null && RKS.rank >= SERGEANT) for (const k of Object.keys(RKS.qz)) if (RKS.qz[k] >= 2) RKS.qz[k] = Math.max(RKS.qz[k], EXAM_PASS);
  // Already above Lieutenant before services existed: they keep their rank (the Army names are the old ones) and may still pick a service.
  if (RKS.rank != null && RKS.rank > LIEUTENANT && !RKS.branch) RKS.legacy = 1;
  if (RKS.rank == null) RKS.rank = rankOf(RKS);        // first load after the requirements were introduced: no retroactive promotion toast
  if (RKS.d.date !== today()) RKS.d = { date: today(), drill: 0 };
  return RKS;
}
const rkSave = () => { if (myId()) RKS.owner = myId(); kvSet('sork_rank', JSON.stringify(RKS)); rkHeader(); };
const rankIdx = (xp, s = RKS) => { let i = 0; ladder(s).forEach((r, k) => { if (xp >= r[1]) i = k; }); return i; };   // the rank XP alone would give
// Mandatory requirements: XP can be earned any way, but each rank below Lieutenant also needs one mission completed before the next rank is granted.
const DRILLS_REQ = 33, ANALYSES_REQ = 99;
// Promotional exam rule: failing MORE than EXAM_FAIL_MAX of a promotional exam fails the person and restarts the whole promotional mission.
// Each chapter exam has EXAM_Q questions, so with 30% a single wrong answer (33%) already fails it: EXAM_PASS = 3 of 3.
const EXAM_Q = 3, EXAM_FAIL_MAX = 0.30;
const EXAM_PASS = EXAM_Q - Math.floor(EXAM_Q * EXAM_FAIL_MAX + 1e-9);
// The same rule for the Corporal drill mission: a Private may miss at most 30% of the required drills (9 of 33). The 10th miss fails them
// and restarts the drill mission from 0 passed.
const DRILL_MISS_MAX = Math.floor(DRILLS_REQ * EXAM_FAIL_MAX + 1e-9), PRIVATE = 1;
const SERGEANT = 3;  // index of the rank the Proficiency Exam leads to; from here on the exam is no longer promotional
// At Lieutenant the person chooses a service. Every rank above Lieutenant then uses that service's own rank names and insignia.
// Each service has its own ranks above Lieutenant, with the XP for each: [name, XP]. They all end at 6000 XP: Field Marshal, Admiral of the Fleet,
// Marshal of the Air Force. (The Navy has one rank fewer in between, as in the real navy.)
const LIEUTENANT = 4;
const BRANCHES = {
  army: { name: 'Army', ico: 'army', blurb: 'Land forces', ranks: [['Captain', 700], ['Major', 1000], ['Lieutenant Colonel', 1400], ['Colonel', 1900], ['Brigadier', 2500], ['Major General', 3200], ['Lieutenant General', 4000], ['General', 5000], ['Field Marshal', 6000]] },
  navy: { name: 'Navy', ico: 'navy', blurb: 'Sea forces', ranks: [['Lieutenant Commander', 700], ['Commander', 1000], ['Captain', 1500], ['Commodore', 2200], ['Rear Admiral', 3000], ['Vice Admiral', 4000], ['Admiral', 5000], ['Admiral of the Fleet', 6000]] },
  air: { name: 'Air Force', ico: 'air', blurb: 'Air forces', ranks: [['Flight Lieutenant', 700], ['Squadron Leader', 1000], ['Wing Commander', 1400], ['Group Captain', 1900], ['Air Commodore', 2500], ['Air Vice-Marshal', 3200], ['Air Marshal', 4000], ['Air Chief Marshal', 5000], ['Marshal of the Air Force', 6000]] },
};
// The full ladder for a person: the shared ranks, then their service's ranks (the Army ladder until a service is chosen, which is also what
// people who were Captain or Major before services existed keep).
const ladder = (s = RKS) => BASE_RANKS.concat(BRANCHES[(s && s.branch) || 'army'].ranks);
const rankName = (i, s = RKS) => ladder(s)[Math.min(i, ladder(s).length - 1)][0];
const GATES = [
  { to: 'Private', short: 'Complete the Field guide (all chapters)', ok: s => s.ch.length >= CHAPTERS.length, text: s => `Complete the Field guide: ${s.ch.length}/${CHAPTERS.length} chapters finished` },
  { to: 'Corporal', short: `Pass ${DRILLS_REQ} chart reading drills`, ok: s => (s.drillOk || 0) >= DRILLS_REQ, text: s => `Pass ${DRILLS_REQ} chart reading drills: ${Math.min(s.drillOk || 0, DRILLS_REQ)}/${DRILLS_REQ} passed. Misses ${s.drillMiss || 0}/${DRILL_MISS_MAX} allowed; going over 30% restarts the drills from 0` },
  { to: 'Sergeant', short: 'Pass the Proficiency Exam (every chapter, no more than 30% wrong)', ok: s => CHAPTERS.every((_, k) => (s.qz[k] || 0) >= EXAM_PASS), text: s => `Pass the Proficiency Exam: ${CHAPTERS.filter((_, k) => (s.qz[k] || 0) >= EXAM_PASS).length}/${CHAPTERS.length} chapters passed. Failing more than 30% of a chapter exam restarts the exam from chapter 1` },
  { to: 'Lieutenant', short: `Complete ${ANALYSES_REQ} Intercept Analyses`, ok: s => (s.anTotal || 0) >= ANALYSES_REQ, text: s => `Complete ${ANALYSES_REQ} Intercept Analyses: ${Math.min(s.anTotal || 0, ANALYSES_REQ)}/${ANALYSES_REQ} done` },
  { to: 'Captain', pick: true, short: 'Choose your service: Army, Navy or Air Force', ok: s => !!s.branch || !!s.legacy, text: () => 'Choose your service: Army, Navy or Air Force. Your ranks above Lieutenant follow the service you pick' },
];
// The rank the person actually holds: the XP rank, held back at the first rank whose requirement is not met yet.
function rankOf(s) {
  const xpRank = rankIdx(s.xp, s); let i = 0;
  while (i < xpRank && (!GATES[i] || GATES[i].ok(s))) i++;
  return i;
}
// Returns a PROMOTED line when the held rank has gone up since the last time it was saved (a requirement was just met, or XP just arrived).
function promoMsg(s) {
  const now = rankOf(s), was = s.rank == null ? now : s.rank;
  s.rank = now;
  return now > was ? `<b>PROMOTED to ${rankName(now, s)}</b>` : '';
}

function toast(html, long) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.innerHTML = html; t.className = 'on'; clearTimeout(t._h); t._h = setTimeout(() => { t.className = ''; }, long ? 5200 : 3200);
}
async function award(xp, why, medal) {
  const s = await rk();
  s.xp += xp;
  let msg = xp ? `<b>+${xp} XP</b> ${esc(why)}` : esc(why);
  if (medal && !s.medals.includes(medal)) { s.medals.push(medal); msg += `<br>Medal: <b>${MEDALS[medal][0]}</b>`; }
  if (s.ch.length === CHAPTERS.length && !s.promo) {   // finishing every chapter is a promotion
    s.promo = 1; const L = ladder(s), nx = L[Math.min(L.length - 1, rankIdx(s.xp, s) + 1)][1]; if (nx > s.xp) s.xp = nx;
    if (!s.medals.includes('scholar')) s.medals.push('scholar');
    msg += '<br>Guide complete: <b>Scholar</b>';
  }
  if (CHAPTERS.every((_, i) => (s.qz[i] || 0) >= EXAM_PASS) && !s.medals.includes('honors')) { s.medals.push('honors'); msg += '<br>Medal: <b>Top of Class</b>'; }
  if (s.drillOk >= 5 && !s.medals.includes('eye')) { s.medals.push('eye'); msg += '<br>Medal: <b>Sharp Eye</b>'; }
  const pm = promoMsg(s); if (pm) msg += '<br>' + pm;
  rkSave(); toast(msg, !!pm);
  if (pm && needsBranch(s)) setTimeout(() => askBranch(), 2400);   // just reached Lieutenant: ask for the service once the promotion toast has been read
}

// ---- Roll Call: daily check-in streak
const ROLL_XP = 5;
async function rkCheckIn() {
  const s = await rk(), t = today();
  if (s.last === t) return;
  s.streak = s.last === dayBefore() ? s.streak + 1 : 1; s.last = t; s.best = Math.max(s.best, s.streak);
  let bonus = ROLL_XP, medal = s.medals.includes('first') ? null : 'first', why = `roll call, day ${s.streak}`;
  for (const [n, m, x] of [[7, 'wk7', 50], [30, 'wk30', 150], [90, 'wk90', 300]]) if (s.streak === n && !s.medals.includes(m)) { medal = m; bonus += x; why = `${n} day streak`; }
  await award(bonus, why, medal);
}

// ---- alert button from a group or channel: the FIRST open of each alert earns 3 XP, later opens earn nothing.
// The server only confirms the link is a real, recent alert; the opened alerts are remembered in Telegram's CloudStorage.
const ALERT_XP = 3;
// What the Alerts tab shows per alert: 1 = opened from Telegram (+3 XP earned), 2 = also analysed (+10 XP earned). Kept as "id:state,id:state".
// Telegram CloudStorage values are capped at 4096 characters, so only the newest 200 alerts from the last 30 days are kept.
async function alLog() {
  const m = new Map(); (await kvGet('sork_alert_log') || '').split(',').forEach(x => { const [id, st] = x.split(':'); if (id && st) m.set(id, +st); });
  return m;
}
async function alMark(id, st) {
  const m = await alLog(), cutoff = Date.now() / 1000 - 30 * 86400;
  m.set(id, Math.max(st, m.get(id) || 0));
  const out = [...m].filter(([k]) => parseInt(k.split('_')[0], 36) > cutoff).slice(-200).map(([k, v]) => `${k}:${v}`).join(',');
  kvSet('sork_alert_log', out);
}
// HTML badge per alert id for the Alerts tab: earned XP, XP waiting to be claimed, or nothing when the alert pays no XP.
async function alertBadges(alerts) {
  const log = await alLog(), q = await anQueue(), waiting = new Set(q.map(x => x.id)), now = Date.now() / 1000, out = {};
  for (const a of alerts) {
    if (!a.xp || !a.oid) continue;
    const st = log.get(a.oid) || 0;
    if (st >= 2) out[a.oid] = `<span class="xpb done">&#10003; Analysed &middot; +${ALERT_XP + ANALYSIS_XP} XP earned</span>`;
    else if (st === 1) out[a.oid] = waiting.has(a.oid)
      ? `<span class="xpb part">&#10003; Opened &middot; +${ALERT_XP} XP earned &middot; +${ANALYSIS_XP} XP to claim</span>`
      : `<span class="xpb done">&#10003; Opened &middot; +${ALERT_XP} XP earned</span>`;
    else if (now - a.ts < 24 * 3600) out[a.oid] = `<span class="xpb new">+${ALERT_XP} XP to claim &middot; open it from Telegram</span>`;
  }
  return out;
}
async function rkAlertOpen(link) {
  let r; try { r = await api('/api/alert-open', { method: 'POST', body: JSON.stringify({ p: link }) }); } catch { return; }
  if (!r || !r.ok) return;
  let seen; try { seen = JSON.parse(await kvGet('sork_alert_opens') || '[]'); } catch { seen = []; }
  if (!Array.isArray(seen)) seen = [];
  const cutoff = Date.now() / 1000 - 48 * 3600;                      // links older than 24 h pay nothing, so older ids can be forgotten
  seen = seen.filter(x => parseInt(String(x).split('_')[0], 36) > cutoff);
  if (seen.includes(r.id)) return;
  seen.push(r.id); kvSet('sork_alert_opens', JSON.stringify(seen.slice(-200))); alMark(r.id, 1);
  const q = await anQueue(); q.push({ id: r.id, sym: r.symbol, c: r.concept, ts: r.ts }); kvSet('sork_alert_queue', JSON.stringify(q.slice(-20)));   // waits for its analysis mission
  await award(ALERT_XP, 'new alert opened');
}

// ---- Intercept Analysis mission (Telegram alert analysis)
// A new alert opened from a Telegram button is saved here for 24 hours. In the Rank tab the person opens its chart and ticks each
// check once they have confirmed it themselves. Finishing earns XP once per alert, with no daily limit. It trains reading an alert; it is not a signal.
const ANALYSIS_XP = 10;
const CONCEPT_NAME = { S: 'Market structure', O: 'Order flow', R: 'Reclamation', K: 'Key level', QML: 'QML (inverse key level)', ADV: 'Advanced key level' };
const ANALYSIS = {
  S: ['H1 order flow shows a valid trend: liquidity (LQ) and a break of structure (BOS)', 'The trend direction is the H1 order flow and matches the alert\'s H1 trend', 'You can point to the most valid BOS that set the trend', 'No H4 body has closed past the disruption POI (trend not invalidated)'],
  O: ['The inducement is the latest BOS in the H4 trend', 'The disruption is the BOS immediately before the inducement', 'Both POIs are drawn on the order block (body to body, 50% if the body is long)', 'No H1 body has closed beyond the disruption POI'],
  R: ['Price came to the POI of an inducement, disruption or liquidity zone', 'You can name every step of the reclamation, and none is missing', 'The last step goes out of the POI in the trend direction', 'You remember a reclamation is a confirmation, never an entry on its own'],
  K: ['The H1 key level is valid (it became RBS or SBR) and matches the H1 trend', 'No more than 2 wicks sit inside its POI between the key level and its BOS', 'Price pulled back into the POI on M5 without a body closing outside it', 'An M5 confirmation (engulf or harami) is inside the POI, and you know where the SL goes (slightly outside the POI)'],
  QML: ['The directional key level was invalidated by its POI', 'The QML POI is drawn from the old POI edge to the extreme before the reversal', 'The reversal is at or close to a point of liquidity', 'Entry waits for M5 confirmation inside the POI; SL and TP rules are the same as a key level'],
  ADV: ['The H1 key level is valid and its full POI box (100%) is marked', 'Price has come back into the 50% of that box', 'An M5 reversal pattern (engulf, harami or similar) is your entry confirmation', 'SL and TP are the same as the standard key level'],
};
async function anQueue() {
  let q; try { q = JSON.parse(await kvGet('sork_alert_queue') || '[]'); } catch { q = []; }
  const cutoff = Date.now() / 1000 - 24 * 3600;
  return Array.isArray(q) ? q.filter(x => x && x.id && x.ts > cutoff) : [];
}
async function renderAnalysis() {
  const s = await rk(), q = await anQueue(), a = q[q.length - 1];
  const how = `<div class="card"><h4>How it works</h4><p class="small">1. A new alert arrives in Telegram.<br>2. Tap its <b>Open chart</b> button. The app opens on that symbol and SORK page (first open +${ALERT_XP} XP) and saves the alert here for 24 hours.<br>3. Come back to this mission (Intercept Analysis), open the chart and tick each check only after you have confirmed it yourself on the chart.<br>4. Complete the analysis for +${ANALYSIS_XP} XP for every alert, with no daily limit. Five analyses earn the Alert Analyst medal.<br>It trains reading an alert the SORK way. It is not a trade signal.</p></div>`;
  const back = '<div class="row"><button class="back" id="ab">&#8249; Rank</button><span class="small">Intercept Analysis</span></div>';
  if (!a) {
    view.innerHTML = back + how + '<div class="card"><p class="small">No new alert is waiting. The next alert you open from a Telegram button will appear here.</p></div>';
    document.getElementById('ab').onclick = renderRank; return;
  }
  const mins = Math.max(0, Math.round((Date.now() / 1000 - a.ts) / 60)), age = mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`;
  const steps = ANALYSIS[a.c] || ANALYSIS.K, name = CONCEPT_NAME[a.c] || a.c;
  view.innerHTML = back + how + `<div class="card"><h4>${esc(a.sym)} &middot; ${esc(name)}</h4><p class="small">Alert ${age}. ${q.length > 1 ? `${q.length} alerts are waiting; this is the newest.` : ''}</p><button class="btn" id="ao">Open ${esc(a.sym)} chart</button>
    <div id="al">${steps.map(t => `<label class="dl"><input type="checkbox" class="ak"> ${esc(t)}</label>`).join('')}</div>
    <button class="btn" id="ad" disabled>Complete analysis</button></div>`;
  document.getElementById('ab').onclick = renderRank;
  document.getElementById('ao').onclick = () => {
    if (a.c === 'QML' || a.c === 'ADV') { symConcept = 'K'; kSub = a.c; } else if (['S', 'O', 'R', 'K'].includes(a.c)) symConcept = a.c;
    openSymbol(a.sym);
  };
  const ad = document.getElementById('ad'), upd = () => { ad.disabled = [...view.querySelectorAll('.ak')].some(x => !x.checked); };
  view.querySelectorAll('.ak').forEach(x => x.onchange = upd);
  ad.onclick = async () => {
    ad.disabled = true;
    kvSet('sork_alert_queue', JSON.stringify(q.filter(x => x.id !== a.id)));
    alMark(a.id, 2); api('/api/alert-analysed', { method: 'POST', body: JSON.stringify({ id: a.id }) }).catch(() => {});   // so the channel post's XP status button knows
    s.anTotal = (s.anTotal || 0) + 1; await award(ANALYSIS_XP, `${a.sym} alert analysed`, s.anTotal >= 5 ? 'analyst' : undefined);
    renderRank();
  };
}

// ---- guide progress
async function rkGuideHook(frame) {
  const doc = frame.contentDocument, win = frame.contentWindow; if (!doc || !win || !win.IntersectionObserver) return;
  const hs = [...doc.querySelectorAll('h1')].slice(1);
  const io = new win.IntersectionObserver(es => es.forEach(async e => {
    if (!e.isIntersecting) return;
    const i = Number(e.target.dataset.ch), s = await rk(); io.unobserve(e.target);
    if (s.ch.includes(i)) return;
    s.ch.push(i); await award(15, `chapter finished: ${CHAPTERS[i] || ''}`); rkGuideBar();
  }));
  hs.forEach((h, i) => { const m = doc.createElement('div'); m.dataset.ch = i; m.style.height = '2px'; hs[i + 1] ? hs[i + 1].before(m) : doc.body.appendChild(m); io.observe(m); });
}
async function rkGuideBar() {
  const el = document.getElementById('gprog'); if (!el) return; const s = await rk();
  el.innerHTML = `<span class="small">Chapters read</span> ${CHAPTERS.map((_, i) => `<i class="stripe ${s.ch.includes(i) ? 'on' : ''}"></i>`).join('')} <span class="px">${s.ch.length}/${CHAPTERS.length}</span>`;
}

// ---- quiz
const promoExam = s => rankOf(s) < SERGEANT;   // the exam is promotional until the person holds Sergeant
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
async function renderQuizMenu() {
  const s = await rk();
  view.innerHTML = `<div class="row"><button class="back" id="qb">&#8249; Proficiency Exam</button></div><p class="small">Three short questions per chapter. Get ${EXAM_PASS} right to pass and earn XP. ${promoExam(s) ? 'This is a promotion exam: failing more than 30% of any chapter exam fails you and restarts the whole Proficiency Exam from chapter 1.' : ''}</p>` +
    CHAPTERS.map((c, i) => `<button class="rrow ${(s.qz[i] || 0) >= EXAM_PASS ? 'buy' : ''}" data-q="${i}"><span class="mid"><b>${i + 1}</b>${esc(c)}<br><span class="small">${s.qz[i] == null ? 'Not taken' : `Best ${s.qz[i]}/${EXAM_Q}` + (s.qz[i] >= EXAM_PASS ? ' &middot; passed' : '')}</span></span><span class="st">${(s.qz[i] || 0) >= EXAM_PASS ? '&#10003;' : '&#9656;'}</span></button>`).join('');
  document.getElementById('qb').onclick = renderRank;
  view.querySelectorAll('[data-q]').forEach(b => b.onclick = () => runQuiz(Number(b.dataset.q)));
}
function runQuiz(ch) {
  const qs = QUIZ[ch].map(q => { const idx = shuffle([0, 1, 2, 3]); return { q: q[0], o: idx.map(i => q[1][i]), a: idx.indexOf(q[2]), why: q[3] }; });
  let n = 0, right = 0;
  const ask = () => {
    const q = qs[n];
    view.innerHTML = `<div class="row"><button class="back" id="qb">&#8249; ${esc(CHAPTERS[ch])}</button><span class="px">${n + 1}/3</span></div><div class="card"><h4>${esc(q.q)}</h4>` +
      q.o.map((o, i) => `<button class="opt" data-i="${i}">${esc(o)}</button>`).join('') + '<div id="fb"></div></div>';
    document.getElementById('qb').onclick = renderQuizMenu;
    view.querySelectorAll('.opt').forEach(b => b.onclick = () => {
      view.querySelectorAll('.opt').forEach(x => { x.disabled = true; if (Number(x.dataset.i) === q.a) x.classList.add('ok'); });
      const ok = Number(b.dataset.i) === q.a; if (ok) right++; else b.classList.add('bad');
      document.getElementById('fb').innerHTML = `<p class="${ok ? 'up' : 'down'}"><b>${ok ? 'Correct.' : 'Not quite.'}</b> ${esc(q.why)}</p><button class="btn" id="nx">${n === 2 ? 'See result' : 'Next'}</button>`;
      document.getElementById('nx').onclick = () => { n++; n < 3 ? ask() : done(); };
    });
  };
  const done = async () => {
    const s = await rk(), passed = right >= EXAM_PASS, failedHard = (EXAM_Q - right) / EXAM_Q > EXAM_FAIL_MAX;   // more than 30% wrong
    if (failedHard && promoExam(s)) {
      // Promotional exam failed: the person fails and the whole promotional mission restarts from the beginning (chapter 1).
      s.qz = {}; rkSave();
      view.innerHTML = `<div class="card"><h4 class="down">Failed &middot; ${right}/${EXAM_Q}</h4><p>You got more than 30% of this promotional exam wrong. The Proficiency Exam restarts from the beginning: all chapter passes are cleared. Read the guide again, then start over at chapter 1.</p><div class="row"><button class="btn" id="again">Restart from chapter 1</button><button class="btn" id="menu">All chapters</button></div></div>`;
      document.getElementById('again').onclick = () => runQuiz(0); document.getElementById('menu').onclick = renderQuizMenu;
      return;
    }
    const first = (s.qz[ch] || 0) < EXAM_PASS && passed;
    s.qz[ch] = Math.max(s.qz[ch] || 0, right); rkSave();
    if (first) await award(20, `exam passed: ${CHAPTERS[ch]}`);
    view.innerHTML = `<div class="card"><h4>${passed ? 'Passed' : 'Not passed yet'} &middot; ${right}/${EXAM_Q}</h4><p>${passed ? (first ? '+20 XP earned.' : 'Already passed before, no extra XP.') : 'Read the chapter again and retry. No penalty.'}</p><div class="row"><button class="btn" id="again">Try again</button><button class="btn" id="menu">All chapters</button></div></div>`;
    document.getElementById('again').onclick = () => runQuiz(ch); document.getElementById('menu').onclick = renderQuizMenu;
  };
  ask();
}

// ---- SMC chart reading drill: an H1 chart with every SMC mark hidden. Read it and answer: BOS, trend, IDM, DISR, KLV, swing highs and lows, trend direction.
// The answers come from the server's SMC engine (/api/smc, /api/smc/flow), the same marks the live chart draws, so the drill teaches the rules the bot really uses.
// Rank mechanics (XP, daily cap, 30% miss rule for a Private) are unchanged: every pass counts as a drill, right or wrong is all that matters.
let lastDrill = '';
const DRILL_COL = { idm: '#B197FC', disr: '#B197FC', klv: '#FFD166', bos: '#6EA8FE', swing: '#E6EDF7', qml: '#FF8A65', rec: '#69F0AE', cand: '#FFF59D' };

// Everything the chart needs to show the answer after the person has answered (the live chart draws nothing in a drill, so the reveal is drawn here).
function drillReveal(cv, map, items) {
  const G = cv._geom, g = cv.getContext('2d'); if (!G || !map) return;
  const dpr = cv.width / cv.clientWidth, y0 = map.toPrice(0), y1 = map.toPrice(1), Y = p => (p - y0) / (y1 - y0);
  const xl = t => { const i = G.cs.findIndex(c => c[0] >= t); return i < 0 ? G.plotW : i === 0 && G.cs[0][0] > t ? 0 : i * G.step + G.step * .2; };
  const xc = t => { const i = G.cs.findIndex(c => c[0] >= t); return (i < 0 ? G.cs.length - 1 : i) * G.step + G.step / 2; };
  g.save(); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.font = '700 11px ui-monospace, monospace'; g.textBaseline = 'alphabetic';
  for (const o of items) {
    g.strokeStyle = o.col; g.fillStyle = o.col;
    if (o.k === 'cands') {                                              // a bracket around the named candles
      const cc = G.cs.filter(c => o.ts.includes(c[0])); if (!cc.length) continue;
      const hi = Math.max(...cc.map(c => c[2])), lo = Math.min(...cc.map(c => c[3])), x0 = xl(cc[0][0]) - 3, x1 = xc(cc[cc.length - 1][0]) + G.step * .35;
      g.lineWidth = 1.8; g.strokeRect(x0, Y(hi) - 4, x1 - x0, Y(lo) - Y(hi) + 8); g.fillText(o.label, Math.max(3, x0), Y(hi) - 8);
    } else if (o.k === 'box') {
      const x = xl(o.t0), w = cv.clientWidth - x; g.globalAlpha = .22; g.fillRect(x, Y(o.hi), w, Y(o.lo) - Y(o.hi)); g.globalAlpha = 1; g.lineWidth = 1.2; if (o.dash) g.setLineDash([6, 4]); g.strokeRect(x, Y(o.hi), w, Y(o.lo) - Y(o.hi)); g.setLineDash([]);
      g.fillText(o.label, Math.max(3, x + 3), Y(o.hi) - 3);
    } else if (o.k === 'line') {
      const x0 = xc(o.t0), x1 = xc(o.t1), y = Y(o.y); g.lineWidth = 1.6; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
      g.fillText(o.label, (x0 + x1) / 2 - 8, y + (o.below ? 13 : -4));
    } else if (o.k === 'dot') {
      const x = xc(o.t), y = Y(o.y); g.beginPath(); g.arc(x, y, 5, 0, 7); g.lineWidth = 2; g.stroke(); g.fillText(o.label, x - 8, y + (o.below ? 17 : -9));
    }
  }
  g.restore();
}

// The questions a chart can ask, from the marks that are inside the candles on screen (cs = the visible candles). Tap questions have `hit(x, price)`; choice questions have `options` + `answer`.
function drillQuestions(cv, map, sm, fl) {
  const G = cv._geom, cs = G.cs, t0 = cs[0][0], tN = cs[cs.length - 1][0], step = G.step, tol = (map.hi - map.lo) * .03;
  const inView = t => t >= t0 && t <= tN - 3 * 3600;
  const xl = t => { const i = cs.findIndex(c => c[0] >= t); return i < 0 ? G.plotW : i === 0 && cs[0][0] > t ? 0 : i * step + step * .2; };
  const xc = t => { const i = cs.findIndex(c => c[0] >= t); return (i < 0 ? cs.length - 1 : i) * step + step / 2; };
  const ann = ((sm && sm.annotations) || []).filter(a => a.status !== 'void'), out = [];
  const latest = (list, key) => list.slice().sort((a, b) => (b[key] ?? b.t0) - (a[key] ?? a.t0))[0];
  const zoneQ = (kind, role, title, why) => {
    const z = latest(ann.filter(a => a.type === 'idm' && a.role === role && Number.isFinite(a.lo) && inView(a.t0)), 't0'); if (!z) return;
    out.push({ kind, type: 'tap', title, hint: 'The SMC marks are hidden. Tap the price zone where you think it sits.', why,
      hit: (x, p) => p >= z.lo - tol && p <= z.hi + tol && x >= xl(z.t0) - 2 * step, reveal: [{ k: 'box', lo: z.lo, hi: z.hi, t0: z.t0, label: role.toUpperCase(), col: DRILL_COL[role] }] });
  };
  zoneQ('idm', 'idm', 'Tap the IDM zone', 'The IDM is the demand (or supply) zone of the most recent HH/HL leg (LH/LL in a downtrend): the pullback low that led into the latest BOS in the trend direction.');
  zoneQ('disr', 'disr', 'Tap the DISR zone', 'The DISR is the zone of the leg before the IDM, from the stepping HH/HL (LH/LL) sequence. In an uptrend it sits below the IDM, in a downtrend above it. A body close through its far side flips the trend.');
  const k = fl && fl.state && (fl.state.overlays || []).find(o => o.type === 'box' && o.grp === 'k' && o.tone !== 'dead' && inView(o.t0));
  if (k) out.push({ kind: 'klv', type: 'tap', title: 'Tap the KLV (key level)', hint: 'The SMC marks are hidden. Tap the price zone where you think the key level sits.', why: 'The KLV is the key level zone the SORK rules take from the IDM and DISR order flow. It is the area price is expected to react from.',
    hit: (x, p) => p >= k.lo - tol && p <= k.hi + tol && x >= xl(k.t0) - 2 * step, reveal: [{ k: 'box', lo: k.lo, hi: k.hi, t0: k.t0, label: 'KLV', col: DRILL_COL.klv }] });
  const bos = latest(ann.filter(a => a.type === 'bos' && inView(a.t0) && a.t1 != null && a.t1 <= tN), 't1');
  const bosShow = bos ? [{ k: 'line', y: bos.price, t0: bos.t0, t1: bos.t1, label: 'BOS', col: DRILL_COL.bos, below: bos.dir === -1 }] : [];
  if (bos) {
    out.push({ kind: 'bos', type: 'tap', title: 'Tap the latest BOS', hint: 'Tap the swing level that price broke: from the swing to the candle that closed through it.', why: 'A BOS is a candle BODY closing beyond the latest unbroken swing. The line runs from the broken swing to the candle that closed through it. A wick through it is only a sweep.',
      hit: (x, p) => Math.abs(p - bos.price) <= tol && x >= xl(bos.t0) - 2 * step && x <= xc(bos.t1) + 3 * step, reveal: bosShow });
    out.push({ kind: 'bosdir', type: 'choice', title: 'Which way did the latest BOS break?', hint: 'Read the last break of structure on the chart.', options: ['Up (a body closed above a swing high)', 'Down (a body closed below a swing low)'], answer: bos.dir === 1 ? 0 : 1,
      why: (bos.dir === 1 ? 'A bullish BOS: a body closed above the swing high.' : 'A bearish BOS: a body closed below the swing low.') + (bos.counter ? ' It went against the trend, so it is only a counter-trend BOS: the trend flips only when the DISR zone is closed through.' : ''), reveal: bosShow });
  }
  const sw = (hi) => latest(ann.filter(a => a.type === 'swing' && (hi ? /^(HH|LH|H|EQH)$/ : /^(HL|LL|L|EQL)$/).test(a.label || '') && inView(a.t0)), 't0');
  for (const [hi, kind] of [[true, 'swingh'], [false, 'swingl']]) {
    const w = sw(hi); if (!w) continue;
    out.push({ kind, type: 'tap', title: hi ? 'Tap the most recent swing high' : 'Tap the most recent swing low', hint: 'Tap the pivot itself: the candle with lower highs (higher lows) on both sides.',
      why: `A swing ${hi ? 'high is a pivot high with lower highs' : 'low is a pivot low with higher lows'} on both sides, confirmed a few candles later. This one is ${w.label}: ${hi ? (w.label === 'HH' ? 'higher than the swing high before it' : w.label === 'LH' ? 'lower than the swing high before it' : 'a swing high') : (w.label === 'HL' ? 'higher than the swing low before it' : w.label === 'LL' ? 'lower than the swing low before it' : 'a swing low')}.`,
      hit: (x, p) => Math.abs(p - w.price) <= tol * 1.3 && Math.abs(x - xc(w.t0)) <= 2.5 * step, reveal: [{ k: 'dot', y: w.price, t: w.t0, label: w.label || (hi ? 'High' : 'Low'), col: DRILL_COL.swing, below: !hi }] });
  }
  if (sm && [1, -1, 0].includes(sm.trend)) {
    const zs = ann.filter(a => a.type === 'idm' && (a.role === 'idm' || a.role === 'disr') && Number.isFinite(a.lo) && a.t0 >= t0).map(z => ({ k: 'box', lo: z.lo, hi: z.hi, t0: z.t0, label: z.role.toUpperCase(), col: DRILL_COL[z.role] }));
    out.push({ kind: 'trend', type: 'choice', title: 'What is the H1 trend?', hint: 'Read the structure: the swings, the BOS and where the IDM and DISR would sit.', options: ['Bullish (HH + HL)', 'Bearish (LH + LL)', 'No trend yet'], answer: sm.trend === 1 ? 0 : sm.trend === -1 ? 1 : 2, reveal: [...zs, ...bosShow],
      why: sm.trend === 1 ? 'Bullish: structure steps up (HH + HL), the BOS break highs, and the DISR below has not been closed through.' : sm.trend === -1 ? 'Bearish: structure steps down (LH + LL), the BOS break lows, and the DISR above has not been closed through.' : 'No trend yet: a trend needs 2 BOS in one direction (IDM + DISR). One break, or a lone break against older ones, is not a trend.' });
  }
  return out;
}

// Drills that need a different window than "the last 80 H1 candles": the M5 entry candle at the key level (KLV), the QML and the reclamation.
// Each descriptor says which timeframe and which end time to draw (endT = the newest candle shown, so an older pattern can still be drilled); make(cv, map) builds the question once that chart is drawn.
// Context (what the question is about, e.g. the key level POI) is drawn BEFORE the answer; the answer (reveal) after.
const ENTRY_NAME = ['Engulfing', 'Harami', 'Star (morning or evening)'];
const REC_STEPS = (d) => [`Step 1: price came ${d === 1 ? 'down' : 'up'} into the POI`, `Step 2: a body closed ${d === 1 ? 'below' : 'above'} the POI`, `Step 3: a body closed back ${d === 1 ? 'above' : 'below'} the POI`, 'Step 4: price came back into the POI without a body break'];
function drillSpecials(st, sm, fl) {
  const f = fl && fl.state, out = [], H = 3600, M = 300, m5 = (st.candles && st.candles.m5) || [], h1 = (st.candles && st.candles.h1) || [];
  if (!f) return out;
  // ---- KLV entry candle names: harami / engulfing / star completed inside the key level POI on M5
  const act = f.k && f.k.active, kb = act && !act.invalidated ? (f.m5poi || act) : null;
  if (kb && Array.isArray(f.signals)) for (const sg of f.signals) {
    const i = m5.findIndex(c => c[0] === sg.t); if (i < 2) continue;
    const star = /star/.test(sg.type), ts = (star ? [m5[i - 2][0]] : []).concat([m5[i - 1][0], m5[i][0]]), nm = sg.type.replace('_', ' ').replace(/^./, (c) => c.toUpperCase());
    out.push({ kind: 'entry', tf: 'm5', endT: sg.t + 5 * M, make: () => ({ kind: 'entry', type: 'choice', title: 'Name the entry candle pattern', hint: 'The shaded box is the key level (KLV) POI on M5. The candles at the end of the chart complete an entry confirmation inside it.',
      options: ENTRY_NAME, answer: star ? 2 : /harami/.test(sg.type) ? 1 : 0, context: [{ k: 'box', lo: kb.lo, hi: kb.hi, t0: kb.t ?? kb.t0, label: 'KLV POI', col: DRILL_COL.klv, dash: true }], reveal: [{ k: 'cands', ts, label: nm, col: DRILL_COL.cand }],
      why: `${nm}. ` + (star ? 'A star: a long candle, then a small body (at most half of the first body) that touches the POI, then a candle of the other colour closing beyond the middle of the first body (morning star for buys, evening star for sells).'
        : /harami/.test(sg.type) ? 'A harami: the candle body sits INSIDE the body of the opposite candle before it, inside the POI.' : 'An engulfing: the candle body covers the whole body of the opposite candle before it, inside the POI.') }) });
  }
  // ---- QML: the inverse of an invalidated key level
  const q = f.qml;
  if (q && Number.isFinite(q.lo) && Number.isFinite(q.hi) && Number.isFinite(q.t)) {
    const endT = q.t + 8 * H, qbox = { k: 'box', lo: q.lo, hi: q.hi, t0: q.t, label: 'QML', col: DRILL_COL.qml }, rev = [qbox, ...(Number.isFinite(q.extreme_t) ? [{ k: 'dot', y: q.extreme, t: q.extreme_t, label: 'Reversal', col: DRILL_COL.qml, below: q.dir === 1 }] : [])];
    const seen = (cv) => Number.isFinite(q.extreme_t) ? q.extreme_t >= cv._geom.cs[0][0] : true;     // the reversal must be on screen
    out.push({ kind: 'qml', tf: 'h1', endT, make: (cv, map) => { if (!seen(cv)) return null; const G = cv._geom, tol = (map.hi - map.lo) * .03, i = G.cs.findIndex(c => c[0] >= q.t), x0 = (i < 0 ? G.cs.length : i) * G.step;
      return { kind: 'qml', type: 'tap', title: 'Tap the QML zone', hint: 'A key level was just invalidated: an M5 body closed outside its POI. Tap the Quasimodo level (QML) it left behind.', why: 'The QML (inverse key level) runs from the edge of the invalidated key level to the extreme of the move that led into the break. It only counts when that reversal sits at or close to a point of liquidity.',
        hit: (x, p) => p >= q.lo - tol && p <= q.hi + tol && x >= x0 - 2 * G.step, reveal: rev }; } });
    out.push({ kind: 'qmldir', tf: 'h1', endT, make: (cv) => seen(cv) ? ({ kind: 'qmldir', type: 'choice', title: 'Which way does this QML trade?', hint: 'The QML is the inverse of the key level that was invalidated. Read where the reversal came from.', options: ['Buy', 'Sell'], answer: q.dir === 1 ? 0 : 1, reveal: rev,
      why: q.dir === 1 ? 'Buy: an SBR (sell key level) was invalidated, so the QML buys from the low of the move.' : 'Sell: an RBS (buy key level) was invalidated, so the QML sells from the high of the move.' }) : null });
    if (typeof q.at_liquidity === 'boolean') out.push({ kind: 'qmlvalid', tf: 'h1', endT, make: (cv) => seen(cv) ? ({ kind: 'qmlvalid', type: 'choice', title: 'Does this QML count?', hint: 'A QML only counts when its reversal point is at or close to a point of liquidity (an older BOS zone).', options: ['Yes: the reversal is at or near a point of liquidity', 'No: there is no point of liquidity near the reversal'], answer: q.at_liquidity ? 0 : 1, reveal: rev,
      why: q.at_liquidity ? 'It counts: the reversal formed at or close to an H1 point of liquidity that already existed.' : 'It does not count: no point of liquidity sits at or near the reversal, so this QML is not valid.' }) : null });
  }
  // ---- reclamation: 5 steps at the IDM / DISR POI
  for (const r of f.r || []) {
    if (!Number.isFinite(r.lo) || !Number.isFinite(r.hi)) continue;
    const role = r.role === 'inducement' ? 'IDM' : 'DISR', band = (cv) => ({ k: 'box', lo: r.lo, hi: r.hi, t0: cv._geom.cs[0][0], label: role + ' POI', col: DRILL_COL.idm, dash: true });
    if (Number.isFinite(r.last_complete) && h1.some(c => c[0] === r.last_complete)) out.push({ kind: 'reclaim', tf: 'h1', endT: r.last_complete + 4 * H, make: (cv, map) => {
      const G = cv._geom, tol = (map.hi - map.lo) * .03, c = G.cs.find(k => k[0] === r.last_complete); if (!c) return null;
      const xc = G.cs.indexOf(c) * G.step + G.step / 2;
      return { kind: 'reclaim', type: 'tap', title: 'Tap the candle that completed the reclamation', hint: `The ${role} POI is shaded. A valid reclamation has 5 steps; tap the candle that completed them.`, context: [band(cv)],
        why: 'The reclamation completes (step 5) with the body closing out of the POI in the trend direction, after: price into the POI (1), a body through it (2), a body back out (3) and back into it without a body break (4). It is a confirmation, not an entry.',
        hit: (x, p) => Math.abs(x - xc) <= 1.5 * G.step && p >= c[3] - tol && p <= c[2] + tol, reveal: [{ k: 'cands', ts: [c[0]], label: 'Reclamation complete', col: DRILL_COL.rec }] }; } });
    if (r.state >= 1 && r.state <= 4) out.push({ kind: 'reclaimstep', tf: 'h1', endT: null, make: (cv) => ({ kind: 'reclaimstep', type: 'choice', title: 'How far has the reclamation got?', hint: `The ${role} POI is shaded. Pick the latest step that has happened.`, options: REC_STEPS(r.dir), answer: r.state - 1, context: [band(cv)], reveal: [],
      why: `${REC_STEPS(r.dir)[r.state - 1]}. Step 5 is a body closing out of the POI in the trend direction. A body close through the far side again sends it back to step 2.` }) });
  }
  return out;
}


async function renderDrill() {
  view.innerHTML = '<p class="mut">Finding a chart...</p>';
  try {
    const { symbols } = await api('/api/symbols'), s = await rk();
    let ready = null;
    for (const sy of shuffle(symbols.filter(x => x.available && x.price != null)).slice(0, 6)) {
      const id = encodeURIComponent(sy.id);
      const [v, sm, fl] = await Promise.all([api('/api/symbol/' + id), api('/api/smc?symbol=' + id + '&tf=h1').catch(() => null), api('/api/smc/flow?symbol=' + id).catch(() => null)]);
      const st = v.state; if (!st || !st.candles || (st.candles.h1 || []).length < 30 || !sm || sm.state === 'starting') continue;
      view.innerHTML = `<div class="row"><button class="back" id="qb">&#8249; Drill</button><span class="small">${esc(v.short)} &middot; <span id="dtf">H1</span></span></div><div class="card" id="dq"></div><canvas id="dc"></canvas><div id="dr"></div>`;
      document.getElementById('qb').onclick = renderRank;
      const cv = document.getElementById('dc');
      // a chart with only the candles, ending at endT (null = now) on the timeframe tf: the marks are never drawn by the chart in a drill
      const draw = (tf, endT) => { const all = st.candles[tf] || [], cut = endT == null ? all : all.filter(c => c[0] <= endT); return chart(cv, { ...st, overlays: [], candles: { ...st.candles, [tf]: cut.slice(-80) } }, tf); };
      const map = draw('h1', null);
      if (!map || !cv._geom) continue;
      const pool = [...drillQuestions(cv, map, sm, fl).map(q => ({ kind: q.kind, q })), ...drillSpecials(st, sm, fl).map(d => ({ kind: d.kind, d }))];
      const fresh = pool.filter(x => x.kind !== lastDrill), order = shuffle(fresh.length ? fresh : pool);
      for (const it of order) {
        if (it.q) { ready = { cv, map, q: it.q, tf: 'h1' }; break; }
        const m2 = draw(it.d.tf, it.d.endT); if (!m2 || !cv._geom) continue;
        const q = it.d.make(cv, m2); if (q) { ready = { cv, map: m2, q, tf: it.d.tf }; break; }
      }
      if (ready) break;
    }
    if (!ready) { view.innerHTML = '<div class="row"><button class="back" id="qb">&#8249; Drill</button></div><p class="mut">No chart is ready for a drill yet. Try again when the markets have more data.</p>'; document.getElementById('qb').onclick = renderRank; return; }
    const { cv, map, q, tf } = ready; lastDrill = q.kind;
    document.getElementById('dtf').textContent = tf.toUpperCase();
    if (q.context) drillReveal(cv, map, q.context);
    document.getElementById('dq').innerHTML = `<h4>${esc(q.title)}</h4><p class="small">${esc(q.hint)}</p>` + (q.type === 'choice' ? q.options.map((o, i) => `<button class="opt" data-i="${i}">${esc(o)}</button>`).join('') : '');
    let answered = false;
    const finish = async ok => {
      answered = true; drillReveal(cv, map, q.reveal);
      const left = s.d.drill < DAILY_CAP.drill;
      let note = '', restarted = false;
      if (!ok && rankOf(s) === PRIVATE) {   // promotional drill mission: more than 30% missed fails the person and restarts it
        s.drillMiss = (s.drillMiss || 0) + 1;
        if (s.drillMiss > DRILL_MISS_MAX) { s.drillOk = 0; s.drillMiss = 0; restarted = true; note = ` You have missed more than 30% of the drills: you fail and the chart reading drills restart from 0/${DRILLS_REQ}.`; }
        else note = ` Misses ${s.drillMiss}/${DRILL_MISS_MAX} allowed.`;
        rkSave();
      }
      document.getElementById('dr').innerHTML = `<div class="card"><h4 class="${ok ? 'up' : 'down'}">${restarted ? 'Failed' : ok ? 'On target' : 'Missed'}</h4><p class="small">${ok ? (left ? '+10 XP. ' : 'Daily drill XP limit reached, keep practising. ') : 'The answer is now shown on the chart. '}${esc(q.why)}${note}</p><button class="btn" id="nd">Next drill</button></div>`;
      document.getElementById('nd').onclick = renderDrill;
      if (ok) { s.drillOk++; if (left) { s.d.drill++; await award(10, 'chart drill: ' + q.kind); } else { const pm = promoMsg(s); rkSave(); if (pm) toast(pm, true); } }
    };
    if (q.type === 'choice') {
      document.querySelectorAll('#dq .opt').forEach(b => b.onclick = () => {
        if (answered) return; const ok = Number(b.dataset.i) === q.answer;
        document.querySelectorAll('#dq .opt').forEach(x => { x.disabled = true; if (Number(x.dataset.i) === q.answer) x.classList.add('ok'); }); if (!ok) b.classList.add('bad');
        finish(ok);
      });
    } else {
      cv.onclick = e => {
        if (answered) return; const r = cv.getBoundingClientRect();
        finish(q.hit(e.clientX - r.left, map.toPrice(e.clientY - r.top - cv.clientTop)));
      };
    }
  } catch (e) { view.innerHTML = `<p class="down">${esc(e.message)}</p>`; }
}

// ---- header: the person's rank insignia, rank name and name, under the B-JEFF logo
const rkName = () => (tgs && tgs.initDataUnsafe && tgs.initDataUnsafe.user && tgs.initDataUnsafe.user.first_name) || 'Operator';
let rkSent = '';
function rkHeader() {
  const el = document.getElementById('hrank'); if (!el || !RKS) return;
  const i = rankOf(RKS);
  const sync = `${RKS.branch || ''}:${i}`;   // tell the server the rank (once per change) so the Telegram group can show it as a tag next to the person's name
  if (sync !== rkSent) { rkSent = sync; api('/api/rank', { method: 'POST', body: JSON.stringify({ r: i, b: RKS.branch || null }) }).catch(() => { rkSent = ''; }); }
  const sv = document.getElementById('tsvc'); if (sv) sv.textContent = RKS.branch && BRANCHES[RKS.branch] ? ` (${BRANCHES[RKS.branch].name})` : '';   // B-JEFF (ARMY) FIELD TERMINAL once a service is chosen
  el.innerHTML = `${insignia(i, 24, RKS.branch)}<b class="hr">${rankName(i)}</b><span class="hn">${esc(rkName())}</span>`;
}
window.addEventListener('load', () => { rk().then(() => { rkHeader(); setTimeout(() => askBranch(), 900); }); });   // a Lieutenant who has not chosen yet is asked again on the next start

// ---- rank page
// Insignia for ladder position i. Chevrons up to Sergeant, a star for Lieutenant. Above Lieutenant each service wears its own:
//   Army: stars for Captain and Major, an oak leaf (Lieutenant Colonel), an eagle (Colonel), then 1 to 4 large silver stars for the generals,
//         and a ring of five stars for the Field Marshal.
//   Navy / Air Force: sleeve stripes (gold on navy blue / sky blue on air force blue). Broad stripes for the officers, then one wide band with
//         0 to 4 thin stripes under it for the flag officers (Commodore ... Admiral of the Fleet / Air Commodore ... Marshal of the Air Force).
const STAR_D = 'M0 -9l2.6 5.4 5.9.8-4.3 4 1 5.8L0 3.4l-5.2 2.6 1-5.8-4.3-4 5.9-.8z';
const star = (x, y, sc, fill) => `<path transform="translate(${x} ${y}) scale(${sc})" d="${STAR_D}" fill="${fill}"/>`;
// Bar patterns, one string per rank above Lieutenant, from the first service rank up: b = broad, t = thin, w = wide.
const NAVY_BARS = ['btb', 'bbb', 'bbbb', 'w', 'wt', 'wtt', 'wttt', 'wtttt'];
const AIR_BARS = ['bb', 'btb', 'bbb', 'bbbb', 'w', 'wt', 'wtt', 'wttt', 'wtttt'];
const BAR_H = { b: 3, t: 1.3, w: 5 };
function barsSvg(spec, col) {
  const gap = spec.length > 5 ? 1.3 : 1.6, hs = [...spec].map(k => BAR_H[k]), tot = hs.reduce((a, b) => a + b, 0) + gap * (hs.length - 1);
  let y = 13 - tot / 2;
  return hs.map(h => { const r = `<rect x="4.5" y="${y.toFixed(2)}" width="17" height="${h}" fill="${col}"/>`; y += h + gap; return r; }).join('');
}
function armySvg(off, c) {
  const W = '#EDEBD8';   // generals wear silver stars
  if (off <= 1) return Array.from({ length: off + 2 }, (_, k) => star(13 + (k - (off + 1) / 2) * 7, 13, .5, c)).join('');   // Captain 2 stars, Major 3
  if (off === 2) return `<path d="M13 4c6 2.8 7 9.5 0 18-7-8.5-6-15.2 0-18z" fill="${c}"/><path d="M13 8v14" stroke="#0C1109" stroke-width="1.1"/>`;   // oak leaf
  if (off === 3) return `<path d="M2.5 9c3.7-.6 7.3.9 10.5 4.2C16.200 9.900 19.800 8.400 23.500 9c-1 4.200-3.700 7-7 8.200l-1 3.800-2.500-1.600-2.500 1.600-1-3.800c-3.300-1.200-6-4-7-8.200z" fill="${c}"/><circle cx="13" cy="8.200" r="2" fill="${c}"/>`;   // eagle
  if (off <= 7) {                                                                   // Brigadier .. General: 1 to 4 large silver stars
    const n = off - 3, at = { 1: [[13, 13.5, .95]], 2: [[7.8, 13.5, .62], [18.2, 13.5, .62]], 3: [[13, 7.8, .56], [7.4, 17.4, .56], [18.6, 17.4, .56]], 4: [[8, 8, .56], [18, 8, .56], [8, 18, .56], [18, 18, .56]] }[n];
    return at.map(([x, y, sc]) => star(x, y, sc, W)).join('');
  }
  return `<circle cx="13" cy="13.5" r="9.6" fill="none" stroke="${c}" stroke-width="1"/>` + Array.from({ length: 5 }, (_, k) => { const a = (-90 + k * 72) * Math.PI / 180; return star((13 + 6.6 * Math.cos(a)).toFixed(2), (13.5 + 6.6 * Math.sin(a)).toFixed(2), .36, W); }).join('');   // Field Marshal: ring of five stars
}
function insignia(i, size = 44, branch = null) {
  const c = '#E3C16A', label = `Rank ${rankName(i, { branch })}`;
  const svg = (bg, edge, g) => `<svg width="${size}" height="${size}" viewBox="0 0 26 26" role="img" aria-label="${label}"><rect x="1" y="1" width="24" height="24" rx="3" fill="${bg}" stroke="${edge}" stroke-width="1.5"/>${g}</svg>`;
  if (i > LIEUTENANT) {
    const off = i - LIEUTENANT - 1;
    if (branch === 'navy') return svg('#0A1A33', c, barsSvg(NAVY_BARS[off] || 'wtttt', c));
    if (branch === 'air') return svg('#0B2540', '#8EC5F0', barsSvg(AIR_BARS[off] || 'wtttt', '#8EC5F0'));
    return svg('#0C1109', c, armySvg(off, c));
  }
  const g = i === 0 ? '<path d="M8 13h10" stroke="#3A4A2A" stroke-width="2.2"/>' : i <= 3 ? Array.from({ length: i }, (_, k) => `<path d="M5 ${9 + k * 5}l8 5 8-5" fill="none" stroke="${c}" stroke-width="2.2"/>`).join('')
    : star(13, 13, .5, c);
  return svg('#0C1109', i ? c : '#3A4A2A', g);
}
// Sub-navigation under the Rank tab: rank, missions, medals, rank ladder. The chosen page is remembered, so the back button of a mission returns to Missions.
const SUBTABS = [
  ['rank', 'Rank', '<path d="M12 2.5l8 3v6c0 5-3.4 8.4-8 10.5-4.6-2.1-8-5.5-8-10.5v-6z"/><path d="M8.5 10.5l3.5 3 3.5-3M8.5 14l3.5 3 3.5-3"/>'],            // shield with sergeant chevrons
  ['missions', 'Missions', '<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1.6"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>'],                        // rifle scope crosshair
  ['medals', 'Medals', '<path d="M7.5 2l4.5 7 4.5-7M9 8.5L6.5 2M15 8.5L17.5 2"/><circle cx="12" cy="15.5" r="5.5"/><path d="M12 12.6l1 2 2.2.3-1.6 1.5.4 2.2-2-1.1-2 1.1.4-2.2-1.6-1.5 2.2-.3z"/>'],   // ribbon and star medal
  ['ladder', 'Rank ladder', '<path d="M5 10.5l7-5 7 5M5 15.5l7-5 7 5M5 20.5l7-5 7 5M12 1.5v2"/>'],                                                              // ascending chevrons
];
// The living head of the XP bar, one per service (drawn at the end of the fill, pointing right; the motion is in style.css):
//  Army: a fired bullet with fire behind it. Air Force: a jet with a contrail. Navy: a warship riding the waves, with a wake.
// XP gauge: a half-dial like a speedometer. Dark gunmetal dial with tick marks, an arc that fills olive -> ember and a brass needle whose
// tip points at the percentage, which rides on the arc and moves with the needle. The rank name is centred above the dial; under it the XP on a
// mileage-counter style odometer (XP [0000]). Animated with SVG's own animation (SMIL), which phones run even when CSS animation is
// switched off by battery saver / reduce motion.
function xpGauge(pct, xp, rname) {
  const P = Math.max(0, Math.min(100, Number(pct) || 0)), ang = (180 * P / 100).toFixed(2), C = 120, R = 81;
  let ticks = '';
  for (let i = 0; i <= 100; i += 5) {
    const a = Math.PI * (1 - i / 100), big = i % 10 === 0, r1 = 103, r2 = big ? 110 : 106;
    ticks += `<line x1="${(C + r1 * Math.cos(a)).toFixed(1)}" y1="${(C - r1 * Math.sin(a)).toFixed(1)}" x2="${(C + r2 * Math.cos(a)).toFixed(1)}" y2="${(C - r2 * Math.sin(a)).toFixed(1)}" stroke="#C2A06A" stroke-width="${big ? 1.6 : 1}" opacity="${big ? .9 : .5}"/>`;
  }
  const arc = `M${C - R} ${C}A${R} ${R} 0 0 1 ${C + R} ${C}`;
  const sweep = (from, to) => `<animateTransform attributeName="transform" type="rotate" from="${from}" to="${to}" dur="1.4s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".2 .7 .2 1"/>`;
  const needle = `<g transform="rotate(${ang} ${C} ${C})">${sweep(`0 ${C} ${C}`, `${ang} ${C} ${C}`)}
      <g><animateTransform attributeName="transform" type="rotate" values="-1.2 ${C} ${C};1.2 ${C} ${C};-1.2 ${C} ${C}" dur=".5s" repeatCount="indefinite"/>
        <path d="M${C} ${C - 4}L${C - 52} ${C - 3}L${C - 63} ${C}L${C - 52} ${C + 3}L${C} ${C + 4}Z" fill="#E3C16A" stroke="#0A0E07" stroke-width=".8" stroke-linejoin="round"/></g>
      <g transform="translate(${C - R} ${C})"><g transform="rotate(${-ang})">${sweep('0', String(-ang))}<text x="0" y="5.5" text-anchor="middle" class="gpt">${Math.round(P)}%</text></g></g></g>`;   // the % turns with the needle and is turned back so it stays upright
  const digits = String(Math.max(0, Math.floor(Number(xp) || 0))).padStart(4, '0').split('');
  return `<div class="xpg" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(P)}" aria-label="XP progress">
    <div class="gn top">${esc(rname || '')}</div>
    <svg viewBox="0 0 240 134" aria-hidden="true"><defs><linearGradient id="xpgf" gradientUnits="userSpaceOnUse" x1="${C - R}" y1="0" x2="${C + R}" y2="0"><stop offset="0" stop-color="#3F5F27"/><stop offset=".45" stop-color="#6F8030"/><stop offset=".78" stop-color="#C0701E"/><stop offset="1" stop-color="#FF8A1F"/></linearGradient></defs>
      <path d="${arc}" pathLength="100" fill="none" stroke="#0E140A" stroke-width="38"/>
      <path d="M${C - R - 19} ${C}A${R + 19} ${R + 19} 0 0 1 ${C + R + 19} ${C}M${C - R + 19} ${C}A${R - 19} ${R - 19} 0 0 1 ${C + R - 19} ${C}" fill="none" stroke="#C2A06A" stroke-width="1.2" opacity=".75"/>
      <path d="${arc}" pathLength="100" fill="none" stroke="url(#xpgf)" stroke-width="36" stroke-dasharray="${P} 100"><animate attributeName="stroke-dasharray" from="0 100" to="${P} 100" dur="1.4s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".2 .7 .2 1"/></path>
      <path d="${arc}" pathLength="100" fill="none" stroke="#FFB347" stroke-width="36" stroke-dasharray="${P} 100" opacity="0"><animate attributeName="opacity" values="0;.22;0" dur=".45s" repeatCount="indefinite"/></path>
      ${ticks}${needle}
      <circle cx="${C}" cy="${C}" r="10" fill="#121A0D" stroke="#C2A06A" stroke-width="2"/><circle cx="${C}" cy="${C}" r="3.5" fill="#E3C16A"/></svg>
    <div class="gxl">XP</div><div class="odo" aria-label="${digits.join('')} XP">${digits.map((d, k) => `<i style="animation-delay:${k * 90}ms">${d}</i>`).join('')}</div></div>`;
}
// Career gauge: the whole road to the final rank (6000 XP). One box per rank on the person's own service ladder, each labelled with the XP that
// rank starts at. Boxes behind the person are filled, the box they are in fills as they progress, and the needle shows where they stand.
// Until a service is chosen the Army ladder is shown (the ladders only differ above Lieutenant).
function xpCareer(s, i, pct) {
  const L = ladder(s), n = L.length, C = 150, CY = 150, RO = 118, RI = 84, RM = (RO + RI) / 2, GAP = 0.014;
  const th = k => Math.PI * (1 - k / n), pt = (r, a) => `${(C + r * Math.cos(a)).toFixed(1)} ${(CY - r * Math.sin(a)).toFixed(1)}`;
  const sector = (a0, a1) => `M${pt(RO, a0)}A${RO} ${RO} 0 0 1 ${pt(RO, a1)}L${pt(RI, a1)}A${RI} ${RI} 0 0 0 ${pt(RI, a0)}Z`;
  const prog = i >= n - 1 ? 1 : Math.max(0, Math.min(1, pct / 100)), f = Math.min(1, (i + prog) / n), ang = (180 * f).toFixed(2);
  let boxes = '', labels = '';
  L.forEach((r, k) => {
    const a0 = th(k) - GAP, a1 = th(k + 1) + GAP, here = k === i, done = k < i || (k === n - 1 && i === n - 1 && s.xp >= r[1]);
    boxes += `<path d="${sector(a0, a1)}" fill="#0E140A" stroke="${here ? '#E3C16A' : '#C2A06A'}" stroke-width="${here ? 1.6 : .7}" stroke-opacity="${here ? 1 : .55}"><title>${esc(r[0])}: ${r[1]} XP</title></path>`;
    if (done) boxes += `<path d="${sector(a0, a1)}" fill="url(#xpcf)"/>`;
    else if (here && prog > 0) boxes += `<path d="${sector(a0, a0 - (a0 - a1) * prog)}" fill="url(#xpcf)"/>`;
    if (here) boxes += `<path d="${sector(a0, a1)}" fill="#FFB347" opacity="0"><animate attributeName="opacity" values="0;.28;0" dur="1.1s" repeatCount="indefinite"/></path>`;
    const am = th(k + .5);
    labels += `<text x="${(C + 133 * Math.cos(am)).toFixed(1)}" y="${(CY - 133 * Math.sin(am) + 2.6).toFixed(1)}" text-anchor="middle" class="cl${here ? ' on' : k < i ? ' dn' : ''}">${r[1]}</text>`;
  });
  const fin = L[n - 1], svc = s.branch ? BRANCHES[s.branch].name + ' · ' : '';
  const needle = `<g transform="rotate(${ang} ${C} ${CY})"><animateTransform attributeName="transform" type="rotate" from="0 ${C} ${CY}" to="${ang} ${C} ${CY}" dur="1.6s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".2 .7 .2 1"/><g><animateTransform attributeName="transform" type="rotate" values="-1.2 ${C} ${CY};1.2 ${C} ${CY};-1.2 ${C} ${CY}" dur=".55s" repeatCount="indefinite"/><path d="M${C} ${CY - 4}L${C - RI - 6} ${CY - .7}L${C - RI - 6} ${CY + .7}L${C} ${CY + 4}Z" fill="#E3C16A" stroke="#0A0E07" stroke-width=".8" stroke-linejoin="round"/></g></g>`;
  return `<div class="xpg xpc" role="img" aria-label="Career progress: ${s.xp} of ${fin[1]} XP, rank ${esc(L[i][0])} of ${n}">
    <div class="gh"><span>&#9733;</span> CHAIN OF COMMAND <span>&#9733;</span></div>
    <svg viewBox="0 0 300 168" aria-hidden="true"><defs><linearGradient id="xpcf" gradientUnits="userSpaceOnUse" x1="${C - RO}" y1="0" x2="${C + RO}" y2="0"><stop offset="0" stop-color="#3F5F27"/><stop offset=".45" stop-color="#6F8030"/><stop offset=".78" stop-color="#C0701E"/><stop offset="1" stop-color="#FF8A1F"/></linearGradient></defs>
      ${boxes}${labels}${needle}
      <circle cx="${C}" cy="${CY}" r="10" fill="#121A0D" stroke="#C2A06A" stroke-width="2"/><circle cx="${C}" cy="${CY}" r="3.5" fill="#E3C16A"/>
</svg>
    <div class="gn">${esc(L[i][0])}</div><div class="gs">${esc(svc)}rank ${i + 1} of ${n}</div></div>`;
}
const XPHEAD = {
  rocket: '<svg viewBox="0 0 56 28"><g class="fl"><path d="M20 14C13 4 8 10 0 2c3 6 2 9 6 12-4 3-3 6-6 12 8-6 14-1 20-12z" fill="#FF5A1F"/><path d="M20 14C15 9 11 12 5 8c3 4 1 6 4 6-3 2-2 4-4 6 6-3 10 0 15-6z" fill="#FFD23F"/></g><path d="M18 9l-6-6v6zM18 19l-6 6v-6z" fill="#D93A2B"/><path d="M18 8h20c8 0 14 3 17 6-3 3-9 6-17 6H18z" fill="#F2F4F7" stroke="#6B7480" stroke-width="1" stroke-linejoin="round"/><path d="M42 8.6c6 .8 10 3 13 5.4-3 2.4-7 4.6-13 5.4z" fill="#D93A2B"/><circle cx="32" cy="14" r="3.2" fill="#7CC4F2" stroke="#6B7480"/><path d="M24 8v12" stroke="#B9C0C9"/></svg>',
  army: '<svg viewBox="0 0 56 28"><g class="fl"><path d="M22 14C15 5 9 11 0 3c3 6 2 8 6 11-4 3-3 5-6 11 9-6 15-1 22-11z" fill="#FF5A1F"/><path d="M22 14C16 9 12 12 5 8c3 4 1 6 4 6-3 2-2 4-4 6 7-3 11 0 17-6z" fill="#FFD23F"/></g><path d="M20 8h14v12H20z" fill="#D8B04A"/><path d="M25 8v12" stroke="#8A6B1F" stroke-width="1.2"/><path d="M34 8c9 0 15 3 21 6-6 3-12 6-21 6z" fill="#B8651E"/><path d="M38 10c5 0 9 1.5 13 4" stroke="#F0B27A" stroke-width="1.2" fill="none"/></svg>',
  air: '<svg viewBox="0 0 56 28"><g class="ct"><path d="M0 13h24" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><path d="M6 17h18" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".7"/><path d="M10 9h14" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".7"/></g><path d="M55 14L41 12 31 3h-4l5 9h-8l-3-4h-2l2 6-2 6h2l3-4h8l-5 9h4l10-9 14-2z" fill="#E4ECF3" stroke="#0B2540" stroke-width="1.1" stroke-linejoin="round"/><path d="M44 13.2l5 .8-5 .8z" fill="#0B2540"/></svg>',
  navy: '<svg viewBox="0 0 56 28"><g class="wk"><path d="M0 22q4-3 8 0t8 0" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M4 26q4-3 8 0t8 0" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round" opacity=".7"/></g><g class="ship"><path d="M14 17h40l-5 6H19z" fill="#6B7886" stroke="#1F2A36" stroke-width="1"/><path d="M22 17v-4h9v4M31 17v-7h6v7M37 17v-3h5v3" fill="#8D99A6" stroke="#1F2A36" stroke-width="1"/><path d="M42 14.5h11" stroke="#1F2A36" stroke-width="2" stroke-linecap="round"/><path d="M34 10V4M31 6h6" stroke="#1F2A36" stroke-width="1.2"/></g></svg>',
};
let rkSub = 'rank', ldSub = null;   // ldSub: the open page of the Rank ladder tab (shared ranks, one service, or missions); null = your own service
const LADTABS = [
  ['base', 'Shared ranks', '<path d="M5 10.5l7-5 7 5M5 15.5l7-5 7 5M5 20.5l7-5 7 5M12 1.5v2"/>'],
  ['army', 'Army rank', ICON.army], ['navy', 'Navy rank', ICON.navy], ['air', 'Air Force rank', ICON.air],
];
async function renderRank() {
  const s = await rk(), i = rankOf(s), L = ladder(s), nx = L[i + 1], cur = L[i][1], br = BRANCHES[s.branch];
  const nxName = nx ? (i === LIEUTENANT && !s.branch && !s.legacy ? 'your service rank' : rankName(i + 1, s)) : '';
  const held = i < rankIdx(s.xp, s), gate = GATES[i] && !GATES[i].ok(s) ? GATES[i] : null;      // held: enough XP, but the requirement is still open
  const hk = 'army';   // every rank gets the fired-bullet bar (fire behind it)
  const pct = nx && !held ? Math.min(100, Math.round((s.xp - cur) / (nx[1] - cur) * 100)) : 100;
  const name = rkName();
  const m = (t, d, p, btn, id, ic) => `<div class="card"><h4>${ic ? ico(ic) : ''}${t} <span class="px">${p}</span></h4><p class="small">${d}</p>${btn ? `<button class="btn" id="${id}">${btn}</button>` : ''}</div>`;
  const lrow = (r, k, svc, on, rq) => `<div class="rl ${on ? 'on' : 'st'}">${insignia(k, 26, svc)}<b>${r[0]}</b><span class="px">${r[1]} XP</span>${rq ? `<span class="rq">${rq}</span>` : ''}</div>`;
  const examsPassed = CHAPTERS.filter((_, k) => (s.qz[k] || 0) >= EXAM_PASS).length;
  const ld = ldSub || s.branch || 'base';
  const missionCard = () => `<div class="card"><h4>Mission summary</h4>
        <p class="small"><b>Roll Call:</b> ${ROLL_XP} XP a day. Streaks of 7, 30 and 90 days add 50, 150 and 300 XP and a medal.</p>
        <p class="small"><b>Field guide:</b> 15 XP per chapter. Required for Private: finish all ${CHAPTERS.length} chapters.</p>
        <p class="small"><b>Chart reading drill:</b> 10 XP per pass (the first ${DAILY_CAP.drill} a day pay XP, every pass counts). Required for Corporal: ${DRILLS_REQ} passes. A Private may miss at most ${DRILL_MISS_MAX}; the next miss restarts the drills from 0.</p>
        <p class="small"><b>Proficiency Exam:</b> 20 XP the first time a chapter is passed. Required for Sergeant: pass all ${CHAPTERS.length} chapters with every answer right. More than 30% wrong restarts the exam from chapter 1.</p>
        <p class="small"><b>Intercept Analysis:</b> ${ANALYSIS_XP} XP per alert analysed, and ${ALERT_XP} XP the first time an alert is opened from Telegram. Required for Lieutenant: ${ANALYSES_REQ} analyses.</p>
        <p class="small"><b>Choose a service:</b> required at Lieutenant. It unlocks ${SERVICE_PERKS.join(' and ').toLowerCase()}. Every rank above Lieutenant needs XP only.</p></div>`;
  const ldPage = () => {
    if (ld === 'base') return `<h4 class="svch">Shared ranks &middot; every service</h4>${BASE_RANKS.map((r, k) => lrow(r, k, null, k <= i, k && GATES[k - 1] ? GATES[k - 1].short : '')).join('')}
      <p class="small">At Lieutenant the person chooses the Army, the Navy or the Air Force and continues up that service's own ladder. Open a service above to see it. All three end at 6000 XP.</p>
      <p class="small">XP can be earned any way, but each rank up to Lieutenant also needs its mission completed, and Lieutenant to the next rank needs you to choose a service. Until it is, you keep your rank and the XP keeps adding up. Progress is saved in your Telegram account on this app. It is for practice and fun: there is no leaderboard and it does not rate your trading.</p>${missionCard()}`;
    const sv = BRANCHES[ld], last = sv.ranks[sv.ranks.length - 1];
    return `<h4 class="svch">${ico(sv.ico)}${sv.name}${s.branch === ld ? '<span class="you">YOUR SERVICE</span>' : ''}</h4>
      <p class="small">${sv.blurb}. ${sv.ranks.length} ranks above Lieutenant, from ${sv.ranks[0][0]} at ${sv.ranks[0][1]} XP to ${last[0]} at ${last[1]} XP. Every rank here needs XP only.</p>
      ${sv.ranks.map((r, n) => lrow(r, LIEUTENANT + 1 + n, ld, s.branch === ld && LIEUTENANT + 1 + n <= i, n === 0 ? `Choose the ${sv.name} at Lieutenant` : '')).join('')}
      ${s.branch ? '' : `<p class="small">Reach Lieutenant to choose your service.</p>`}`;
  };
  const pages = {
    rank: `<h3 class="ctr" style="margin-top:0">Service record</h3>
      <div class="card prof">${insignia(i, 56, s.branch)}<div style="flex:1"><div class="small">RANK AND CALLSIGN</div><div class="rname">${rankName(i, s)}</div><div class="callsign">${esc(name)}</div>${br ? `<div class="svc">${ico(br.ico)}${br.name}</div>` : ''}</div></div>
      ${xpGauge(pct, s.xp, rankName(i, s))}
      <div class="small xpl">${nx ? `Next Rank: ${nxName} at ${nx[1]} XP` : 'highest rank'}</div>${xpCareer(s, i, pct)}${gate ? `<div class="card req tap" id="reqgo" role="button" tabindex="0" aria-label="Open the promotion requirement: ${esc(gate.short)}"><small>PROMOTION REQUIREMENT${held ? ' &middot; XP TARGET REACHED' : ''}</small>${esc(gate.text(s))}<span class="reqgo">${gate.pick ? 'Tap to choose your service' : 'Tap to open this mission'} &rsaquo;</span></div>` : ''}`,
    missions: `<h3 class="ctr" style="margin-top:0">Missions</h3>
      <div class="plan"><div><small>ROLL CALL STREAK</small><span class="px">${s.streak} d</span></div><div><small>CHAPTERS</small><span class="px">${s.ch.length}/${CHAPTERS.length}</span></div><div><small>EXAMS</small><span class="px">${examsPassed}/${CHAPTERS.length}</span></div></div>
      ${m('Roll Call', 'Report in once a day. 7, 30 and 90 days earn a medal and bonus XP.', `best ${s.best} d`, null, null, 'roll')}
      ${m('Intercept Analysis', 'Open a new alert from its Telegram button, then check it against the SORK steps on the chart. Required to become Lieutenant: complete ${ANALYSES_REQ}.', `${Math.min(s.anTotal || 0, ANALYSES_REQ)}/${ANALYSES_REQ}`, 'Analyse an alert', 'g5', 'intercept')}
      ${m('Chart reading drill', `SMC chart reading with the marks hidden: tap the BOS, IDM, DISR, KLV, swing highs and lows, the QML and the candle that completes a reclamation; read the trend, the BOS direction, the reclamation step and the QML; name the KLV entry candle (engulfing, harami or star). Required to become Corporal: pass ${DRILLS_REQ} drills (daily XP limit ${DAILY_CAP.drill}, but every pass counts). As a Private you may miss at most ${DRILL_MISS_MAX}: missing more than 30% fails you and restarts the drills from 0.`, `${Math.min(s.drillOk || 0, DRILLS_REQ)}/${DRILLS_REQ}`, 'Start a drill', 'g3', 'drill')}
      ${m('Field guide', 'Finish a chapter (scroll to its end) for a stripe and XP. Required to become Private: finish all chapters.', `${s.ch.length}/${CHAPTERS.length}`, 'Open the guide', 'g1', 'guide')}
      ${m('Proficiency Exam', 'Three questions per chapter. Pass with all 3 right for XP. Required to become Sergeant: pass every chapter. Failing more than 30% of any chapter exam fails you and restarts the exam from chapter 1.', `${examsPassed}/${CHAPTERS.length}`, 'Sit the exam', 'g2', 'exam')}`,
    medals: `<h3 class="ctr" style="margin-top:0">Medals</h3><div class="medals">${Object.entries(MEDALS).map(([k, [t, d]]) => `<div class="medal ${s.medals.includes(k) ? 'on' : ''}">${ico(k)}<b>${t}</b><span>${d}</span></div>`).join('')}</div>`,
    ladder: `<h3 class="ctr" style="margin-top:0">Rank ladder</h3><div class="subtabs ld" role="tablist">${LADTABS.map(([k, tt, ic]) => `<button role="tab" data-ld="${k}" class="${k === ld ? 'on' : ''}" aria-selected="${k === ld}"><svg viewBox="0 0 24 24" aria-hidden="true">${ic}</svg>${tt}</button>`).join('')}</div>` + ldPage(),
  };
  view.innerHTML = `<div class="subtabs" role="tablist">${SUBTABS.map(([k, t, ic]) => `<button role="tab" data-sub="${k}" class="${k === rkSub ? 'on' : ''}" aria-selected="${k === rkSub}"><svg viewBox="0 0 24 24" aria-hidden="true">${ic}</svg>${t}</button>`).join('')}</div>` + pages[rkSub];
  view.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => { rkSub = b.dataset.sub; renderRank(); });
  view.querySelectorAll('[data-ld]').forEach(b => b.onclick = () => { ldSub = b.dataset.ld; renderRank(); });
  const on = (id, f) => { const e = document.getElementById(id); if (e) e.onclick = f; };
  // the promotion requirement card opens its mission directly: the Field guide, the drills, the Proficiency Exam, the Intercept Analysis or the service picker
  const gateGo = [() => setTab('guide'), renderDrill, renderQuizMenu, renderAnalysis, () => askBranch(true)];
  const rq = document.getElementById('reqgo');
  if (rq && gateGo[i]) { rq.onclick = () => gateGo[i](); rq.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); gateGo[i](); } }; }
  on('g1', () => setTab('guide')); on('g2', renderQuizMenu); on('g3', renderDrill); on('g5', renderAnalysis); on('g6', () => askBranch(true));
}

// ---- choosing a service at Lieutenant: Army, Navy or Air Force (a permanent choice)
const needsBranch = s => rankOf(s) >= LIEUTENANT && !s.branch;
let bpAsked = false;
// What choosing a service unlocks. Shown on the service picker, the Rank page and in the confirmation. Edit this list to change the wording everywhere.
const SERVICE_PERKS = ['Copy trading', 'Other service features'];
const perksHtml = `<div class="card perks"><small>CHOOSING A SERVICE UNLOCKS</small><ul>${SERVICE_PERKS.map(x => `<li>${x}</li>`).join('')}</ul></div>`;
async function askBranch(force) {
  const s = await rk();
  if (!needsBranch(s) || document.getElementById('bp') || (bpAsked && !force)) return;
  bpAsked = true;
  let pick = null;
  const o = document.createElement('div');
  o.id = 'bp'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true'); o.setAttribute('aria-label', 'Choose your service');
  o.innerHTML = `<div class="bpbox"><h3 class="ctr" style="margin-top:0">Choose your service</h3>
    <p class="small">You have reached Lieutenant. Choose the service you will continue in: every rank above Lieutenant will be a rank of that service. This choice is permanent.</p>
    ${perksHtml}
    ${Object.entries(BRANCHES).map(([k, b]) => `<button class="bpc" data-b="${k}" aria-pressed="false">${ico(b.ico)}<span><b>${b.name}</b><small>${b.blurb}</small><small class="path">${b.ranks[0][0]} &rarr; ${b.ranks.length} ranks &rarr; ${b.ranks[b.ranks.length - 1][0]}</small></span></button>`).join('')}
    <div class="row"><button class="btn" id="bp-ok" disabled>Choose a service</button><button class="btn" id="bp-later" style="background:transparent">Decide later</button></div></div>`;
  document.body.appendChild(o);
  const ok = o.querySelector('#bp-ok'), close = () => o.remove();
  o.querySelectorAll('.bpc').forEach(b => b.onclick = () => {
    pick = b.dataset.b;
    o.querySelectorAll('.bpc').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
    ok.disabled = false; ok.textContent = `Join the ${BRANCHES[pick].name}`;
  });
  o.querySelector('#bp-later').onclick = close;
  ok.onclick = async () => {
    if (!pick) return;
    s.branch = pick; delete s.legacy;                   // permanent: nothing in the app changes it again
    const pm = promoMsg(s); rkSave(); close();
    toast(`Service chosen: <b>${BRANCHES[pick].name}</b><br>Unlocked: ${SERVICE_PERKS.join(', ')}<br>Next rank: ${BRANCHES[pick].ranks[0][0]}` + (pm ? '<br>' + pm : ''), true);
    if (typeof tab !== 'undefined' && tab === 'rank') renderRank();
  };
}
