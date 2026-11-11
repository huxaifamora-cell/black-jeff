// Service record: ranks earned by learning and discipline. Progress is saved per person in Telegram's own storage
// (CloudStorage), with the browser's localStorage as a fallback, so no database is needed on the server.
// There is no leaderboard and nothing here rates trades or gives advice.
const RANKS = [['Recruit', 0], ['Private', 40], ['Corporal', 120], ['Sergeant', 250], ['Lieutenant', 450], ['Captain', 700], ['Major', 1000]];
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
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const kvGet = k => new Promise(res => { const c = cloud(); if (!c) return res(lsGet(k)); try { c.getItem(k, (e, v) => res(!e && v ? v : lsGet(k))); } catch { res(lsGet(k)); } });
const kvSet = (k, v) => { lsSet(k, v); const c = cloud(); if (c) try { c.setItem(k, v, () => {}); } catch { /* ignore */ } };

const today = () => new Date().toLocaleDateString('en-CA');
const dayBefore = () => new Date(Date.now() - 864e5).toLocaleDateString('en-CA');
let RKS = null;
const fresh = () => ({ v: 1, xp: 0, ch: [], qz: {}, streak: 0, best: 0, last: '', drillOk: 0, anTotal: 0, medals: [], promo: 0, d: { date: '', drill: 0 } });
async function rk() {
  if (RKS) return RKS;
  let s; try { s = JSON.parse(await kvGet('sork_rank') || 'null'); } catch { s = null; }
  RKS = Object.assign(fresh(), s || {});
  if (RKS.d.date !== today()) RKS.d = { date: today(), drill: 0 };
  return RKS;
}
const rkSave = () => kvSet('sork_rank', JSON.stringify(RKS));
const rankIdx = xp => { let i = 0; RANKS.forEach((r, k) => { if (xp >= r[1]) i = k; }); return i; };

function toast(html, long) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.innerHTML = html; t.className = 'on'; clearTimeout(t._h); t._h = setTimeout(() => { t.className = ''; }, long ? 5200 : 3200);
}
async function award(xp, why, medal) {
  const s = await rk(), before = rankIdx(s.xp);
  s.xp += xp;
  let msg = xp ? `<b>+${xp} XP</b> ${esc(why)}` : esc(why);
  if (medal && !s.medals.includes(medal)) { s.medals.push(medal); msg += `<br>Medal: <b>${MEDALS[medal][0]}</b>`; }
  if (s.ch.length === CHAPTERS.length && !s.promo) {   // finishing every chapter is a promotion
    s.promo = 1; const nx = RANKS[Math.min(RANKS.length - 1, rankIdx(s.xp) + 1)][1]; if (nx > s.xp) s.xp = nx;
    if (!s.medals.includes('scholar')) s.medals.push('scholar');
    msg += '<br>Guide complete: <b>Scholar</b>';
  }
  if (CHAPTERS.every((_, i) => (s.qz[i] || 0) >= 2) && !s.medals.includes('honors')) { s.medals.push('honors'); msg += '<br>Medal: <b>Top of Class</b>'; }
  if (s.drillOk >= 5 && !s.medals.includes('eye')) { s.medals.push('eye'); msg += '<br>Medal: <b>Sharp Eye</b>'; }
  const after = rankIdx(s.xp);
  if (after > before) msg += `<br><b>PROMOTED to ${RANKS[after][0]}</b>`;
  rkSave(); toast(msg, after > before);
}

// ---- Roll Call: daily check-in streak
async function rkCheckIn() {
  const s = await rk(), t = today();
  if (s.last === t) return;
  s.streak = s.last === dayBefore() ? s.streak + 1 : 1; s.last = t; s.best = Math.max(s.best, s.streak);
  let bonus = 5, medal = s.medals.includes('first') ? null : 'first', why = `roll call, day ${s.streak}`;
  for (const [n, m, x] of [[7, 'wk7', 50], [30, 'wk30', 150], [90, 'wk90', 300]]) if (s.streak === n && !s.medals.includes(m)) { medal = m; bonus += x; why = `${n} day streak`; }
  await award(bonus, why, medal);
}

// ---- alert button from a group or channel: the FIRST open of each alert earns 3 XP, later opens earn nothing.
// The server only confirms the link is a real, recent alert; the opened alerts are remembered in Telegram's CloudStorage.
const ALERT_XP = 3;
async function rkAlertOpen(link) {
  let r; try { r = await api('/api/alert-open', { method: 'POST', body: JSON.stringify({ p: link }) }); } catch { return; }
  if (!r || !r.ok) return;
  let seen; try { seen = JSON.parse(await kvGet('sork_alert_opens') || '[]'); } catch { seen = []; }
  if (!Array.isArray(seen)) seen = [];
  const cutoff = Date.now() / 1000 - 48 * 3600;                      // links older than 24 h pay nothing, so older ids can be forgotten
  seen = seen.filter(x => parseInt(String(x).split('_')[0], 36) > cutoff);
  if (seen.includes(r.id)) return;
  seen.push(r.id); kvSet('sork_alert_opens', JSON.stringify(seen.slice(-200)));
  const q = await anQueue(); q.push({ id: r.id, sym: r.symbol, c: r.concept, ts: r.ts }); kvSet('sork_alert_queue', JSON.stringify(q.slice(-20)));   // waits for its analysis mission
  await award(ALERT_XP, 'new alert opened');
}

// ---- Intercept Analysis mission (Telegram alert analysis)
// A new alert opened from a Telegram button is saved here for 24 hours. In the Rank tab the person opens its chart and ticks each
// check once they have confirmed it themselves. Finishing earns XP once per alert, with no daily limit. It trains reading an alert; it is not a signal.
const ANALYSIS_XP = 10;
const CONCEPT_NAME = { S: 'Market structure', O: 'Order flow', R: 'Reclamation', K: 'Key level', QML: 'QML (inverse key level)', ADV: 'Advanced key level' };
const ANALYSIS = {
  S: ['H4 shows a valid trend: liquidity (LQ) and a break of structure (BOS)', 'The trend direction is read from H4 only and matches the alert\'s H4 bias', 'You can point to the most valid BOS that set the trend', 'No H4 body has closed past the disruption POI (trend not invalidated)'],
  O: ['The inducement is the latest BOS in the H4 trend', 'The disruption is the BOS immediately before the inducement', 'Both POIs are drawn on the order block (body to body, 50% if the body is long)', 'No H1 body has closed beyond the disruption POI'],
  R: ['Price came to the POI of an inducement, disruption or liquidity zone', 'You can name every step of the reclamation, and none is missing', 'The last step goes out of the POI in the trend direction', 'You remember a reclamation is a confirmation, never an entry on its own'],
  K: ['The H1 key level is valid (it became RBS or SBR) and matches the H4 bias', 'No more than 2 wicks sit inside its POI between the key level and its BOS', 'Price pulled back into the POI on M5 without a body closing outside it', 'An M5 confirmation (engulf or harami) is inside the POI, and you know where the SL goes (slightly outside the POI)'],
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
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
async function renderQuizMenu() {
  const s = await rk();
  view.innerHTML = `<div class="row"><button class="back" id="qb">&#8249; Proficiency Exam</button></div><p class="small">Three short questions per chapter. Get 2 right to pass and earn XP.</p>` +
    CHAPTERS.map((c, i) => `<button class="rrow ${(s.qz[i] || 0) >= 2 ? 'buy' : ''}" data-q="${i}"><span class="mid"><b>${i + 1}</b>${esc(c)}<br><span class="small">${s.qz[i] == null ? 'Not taken' : `Best ${s.qz[i]}/3` + (s.qz[i] >= 2 ? ' &middot; passed' : '')}</span></span><span class="st">${(s.qz[i] || 0) >= 2 ? '&#10003;' : '&#9656;'}</span></button>`).join('');
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
    const s = await rk(), first = (s.qz[ch] || 0) < 2 && right >= 2;
    s.qz[ch] = Math.max(s.qz[ch] || 0, right); rkSave();
    if (first) await award(20, `exam passed: ${CHAPTERS[ch]}`);
    view.innerHTML = `<div class="card"><h4>${right >= 2 ? 'Passed' : 'Not passed yet'} &middot; ${right}/3</h4><p>${right >= 2 ? (first ? '+20 XP earned.' : 'Already passed before, no extra XP.') : 'Read the chapter again and retry. No penalty.'}</p><div class="row"><button class="btn" id="again">Try again</button><button class="btn" id="menu">All chapters</button></div></div>`;
    document.getElementById('again').onclick = () => runQuiz(ch); document.getElementById('menu').onclick = renderQuizMenu;
  };
  ask();
}

// ---- chart reading drill: tap the zone on a chart that has the zones hidden
async function renderDrill() {
  view.innerHTML = '<p class="mut">Finding a chart...</p>';
  try {
    const { symbols } = await api('/api/symbols'); let pick = null;
    for (const sy of shuffle(symbols.filter(x => x.available && x.price != null)).slice(0, 8)) {
      const v = await api('/api/symbol/' + sy.id), st = v.state; if (!st || !st.candles || !(st.candles.h1 || []).length) continue;
      const cs = st.candles.h1.slice(-80), first = cs[0][0], last = cs[cs.length - 1][0];
      const boxes = (st.overlays || []).filter(o => o.type === 'box' && (o.grp === 'o' || o.grp === 'k') && o.tone !== 'dead' && o.t0 >= first && o.t0 <= last - 3 * 3600);
      if (boxes.length) { pick = { v, st, box: boxes[Math.floor(Math.random() * boxes.length)] }; break; }
    }
    if (!pick) { view.innerHTML = '<div class="row"><button class="back" id="qb">&#8249; Drill</button></div><p class="mut">No chart is ready for a drill yet. Try again when the markets have more data.</p>'; document.getElementById('qb').onclick = renderRank; return; }
    const { v, st, box } = pick, s = await rk(), name = box.label.toLowerCase().includes('key') ? 'key level' : box.label.toLowerCase();
    view.innerHTML = `<div class="row"><button class="back" id="qb">&#8249; Drill</button><span class="small">${esc(v.short)} &middot; H1</span></div>
      <div class="card"><h4>Tap the ${esc(name)} zone</h4><p class="small">The zones are hidden. Tap the price level where you think the ${esc(name)} sits.</p></div><canvas id="dc"></canvas><div id="dr"></div>`;
    document.getElementById('qb').onclick = renderRank;
    const cv = document.getElementById('dc'); let map = chart(cv, { ...st, overlays: [] }, 'h1'), answered = false;
    cv.onclick = async e => {
      if (answered || !map) return; answered = true;
      const r = cv.getBoundingClientRect(), y = e.clientY - r.top - cv.clientTop, x = e.clientX - r.left;
      const price = map.toPrice(y), tol = (map.hi - map.lo) * .03, ok = price >= box.lo - tol && price <= box.hi + tol && x >= map.xOf(box.t0) - 2 * map.step;
      chart(cv, { ...st, overlays: [box] }, 'h1');
      const left = s.d.drill < DAILY_CAP.drill;
      document.getElementById('dr').innerHTML = `<div class="card"><h4 class="${ok ? 'up' : 'down'}">${ok ? 'On target' : 'Missed'}</h4><p class="small">${ok ? (left ? '+10 XP.' : 'Daily drill XP limit reached, keep practising.') : 'The zone is now shown on the chart. Study where it formed.'}</p><button class="btn" id="nd">Next drill</button></div>`;
      document.getElementById('nd').onclick = renderDrill;
      if (ok) { s.drillOk++; if (left) { s.d.drill++; await award(10, 'chart drill: zone found'); } else rkSave(); }
    };
  } catch (e) { view.innerHTML = `<p class="down">${esc(e.message)}</p>`; }
}

// ---- rank page
function insignia(i, size = 44) {
  const c = '#E3C16A';
  let g = i === 0 ? '<path d="M8 13h10" stroke="#3A4A2A" stroke-width="2.2"/>' : i <= 3 ? Array.from({ length: i }, (_, k) => `<path d="M5 ${9 + k * 5}l8 5 8-5" fill="none" stroke="${c}" stroke-width="2.2"/>`).join('')
    : Array.from({ length: i - 3 }, (_, k) => `<path transform="translate(${13 + (k - (i - 4) / 2) * 7} 13) scale(.5)" d="M0 -9l2.6 5.4 5.9.8-4.3 4 1 5.8L0 3.4l-5.2 2.6 1-5.8-4.3-4 5.9-.8z" fill="${c}"/>`).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 26 26" role="img" aria-label="Rank ${RANKS[i][0]}"><rect x="1" y="1" width="24" height="24" rx="3" fill="#0C1109" stroke="${i ? c : '#3A4A2A'}" stroke-width="1.5"/>${g}</svg>`;
}
// Sub-navigation under the Rank tab: rank, missions, medals, rank ladder. The chosen page is remembered, so the back button of a mission returns to Missions.
const SUBTABS = [
  ['rank', 'Rank', '<path d="M12 2.5l8 3v6c0 5-3.4 8.4-8 10.5-4.6-2.1-8-5.5-8-10.5v-6z"/><path d="M8.5 10.5l3.5 3 3.5-3M8.5 14l3.5 3 3.5-3"/>'],            // shield with sergeant chevrons
  ['missions', 'Missions', '<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1.6"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>'],                        // rifle scope crosshair
  ['medals', 'Medals', '<path d="M7.5 2l4.5 7 4.5-7M9 8.5L6.5 2M15 8.5L17.5 2"/><circle cx="12" cy="15.5" r="5.5"/><path d="M12 12.6l1 2 2.2.3-1.6 1.5.4 2.2-2-1.1-2 1.1.4-2.2-1.6-1.5 2.2-.3z"/>'],   // ribbon and star medal
  ['ladder', 'Rank ladder', '<path d="M5 10.5l7-5 7 5M5 15.5l7-5 7 5M5 20.5l7-5 7 5M12 1.5v2"/>'],                                                              // ascending chevrons
];
let rkSub = 'rank';
async function renderRank() {
  const s = await rk(), i = rankIdx(s.xp), nx = RANKS[i + 1], cur = RANKS[i][1];
  const pct = nx ? Math.min(100, Math.round((s.xp - cur) / (nx[1] - cur) * 100)) : 100;
  const name = (tgs && tgs.initDataUnsafe && tgs.initDataUnsafe.user && tgs.initDataUnsafe.user.first_name) || 'Operator';
  const m = (t, d, p, btn, id, ic) => `<div class="card"><h4>${ic ? ico(ic) : ''}${t} <span class="px">${p}</span></h4><p class="small">${d}</p>${btn ? `<button class="btn" id="${id}">${btn}</button>` : ''}</div>`;
  const examsPassed = CHAPTERS.filter((_, k) => (s.qz[k] || 0) >= 2).length;
  const pages = {
    rank: `<h3 class="ctr" style="margin-top:0">Service record</h3>
      <div class="card prof">${insignia(i, 56)}<div style="flex:1"><div class="small">RANK AND CALLSIGN</div><div class="rname">${RANKS[i][0]}</div><div class="callsign">${esc(name)}</div></div></div>
      <div class="xpbar big" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="XP progress"><div style="width:${pct}%"></div><span class="xl">${RANKS[i][0]}</span><span class="xc">${pct}%</span><span class="xr">${s.xp} XP</span></div>
      <div class="small xpl">${nx ? `next: ${nx[0]} at ${nx[1]} XP` : 'highest rank'}</div>`,
    missions: `<h3 class="ctr" style="margin-top:0">Missions</h3>
      <div class="plan"><div><small>ROLL CALL STREAK</small><span class="px">${s.streak} d</span></div><div><small>CHAPTERS</small><span class="px">${s.ch.length}/${CHAPTERS.length}</span></div><div><small>EXAMS</small><span class="px">${examsPassed}/${CHAPTERS.length}</span></div></div>
      ${m('Roll Call', 'Report in once a day. 7, 30 and 90 days earn a medal and bonus XP.', `best ${s.best} d`, null, null, 'roll')}
      ${m('Intercept Analysis', 'Open a new alert from its Telegram button, then check it against the SORK steps on the chart. Tap to see how it works.', `${s.anTotal || 0} done`, 'Analyse an alert', 'g5', 'intercept')}
      ${m('Chart reading drill', 'Tap where the inducement or key level is on a chart with the zones hidden.', `${s.d.drill}/${DAILY_CAP.drill} today`, 'Start a drill', 'g3', 'drill')}
      ${m('Field guide', 'Finish a chapter (scroll to its end) for a stripe and XP. Finishing all of them is a promotion.', `${s.ch.length}/${CHAPTERS.length}`, 'Open the guide', 'g1', 'guide')}
      ${m('Proficiency Exam', 'Three questions per chapter. Pass with 2 right for XP.', `${examsPassed}/${CHAPTERS.length}`, 'Sit the exam', 'g2', 'exam')}`,
    medals: `<h3 class="ctr" style="margin-top:0">Medals</h3><div class="medals">${Object.entries(MEDALS).map(([k, [t, d]]) => `<div class="medal ${s.medals.includes(k) ? 'on' : ''}">${ico(k)}<b>${t}</b><span>${d}</span></div>`).join('')}</div>`,
    ladder: `<h3 class="ctr" style="margin-top:0">Rank ladder</h3>${RANKS.map((r, k) => `<div class="rl ${k <= i ? 'on' : ''}">${insignia(k, 26)}<b>${r[0]}</b><span class="px">${r[1]} XP</span></div>`).join('')}<p class="small">Progress is saved in your Telegram account on this app. It is for practice and fun: there is no leaderboard and it does not rate your trading.</p>`,
  };
  view.innerHTML = `<div class="subtabs" role="tablist">${SUBTABS.map(([k, t, ic]) => `<button role="tab" data-sub="${k}" class="${k === rkSub ? 'on' : ''}" aria-selected="${k === rkSub}"><svg viewBox="0 0 24 24" aria-hidden="true">${ic}</svg>${t}</button>`).join('')}</div>` + pages[rkSub];
  view.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => { rkSub = b.dataset.sub; renderRank(); });
  const on = (id, f) => { const e = document.getElementById(id); if (e) e.onclick = f; };
  on('g1', () => setTab('guide')); on('g2', renderQuizMenu); on('g3', renderDrill); on('g5', renderAnalysis);
}
