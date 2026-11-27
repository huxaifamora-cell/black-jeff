// Ties the feed, the engine and the alert store together.
import { H1, H4, M5, defaultParams, evaluate, closedOnly, manualOrderFlow } from './engine.js';
import { smcFlow } from './smcflow.js';
import { SYMBOLS, norm } from './symbols.js';

// H1 needs the last 6 months (h1Days x 24 candles, the Deriv indices trade round the clock) plus a small margin; H4 covers the same span.
// Deriv returns at most 5000 candles per request, so the counts are capped there.
const countsFor = (p) => ({ [H4]: Math.min(5000, p.h1Days * 6 + 40), [H1]: Math.min(5000, Math.ceil(p.h1Days * 24) + 48), [M5]: 500 });

// Number of decimals to show, guessed from the prices (Deriv indices use 2 to 4).
export function digitsFor(candles) {
  let d = 2;
  for (const c of candles.slice(-20)) {
    for (const v of [c.o, c.h, c.l, c.c]) {
      let k = 0;
      for (; k <= 5; k++) if (Math.abs(Number(v.toFixed(k)) - v) < 1e-9) break;
      d = Math.max(d, k > 5 ? 5 : k);
    }
  }
  return Math.min(d, 5);
}

const TF_NAME = { [H4]: 'H4', [H1]: 'H1', [M5]: 'M5' };
const TYPE_NAME = { S: 'Market structure', O: 'Order flow', R: 'Reclamation', K: 'Key level', QML: 'QML', ADV: 'Advanced key level' };
const BIAS_NAME = { 1: 'Bullish', '-1': 'Bearish' };

// Status on the timeframe that fired the alert, e.g. "Valid key level (buy setup)" or "Entry confirmation: bearish breakout (sell)".
export function statusOf(a) {
  const p = a.payload || {}, buy = a.dir === 1, sd = buy ? 'buy' : 'sell', sub = 'key level';                      // never RBS / SBR in alert text
  switch (a.kind) {
    case 'reclamation': return `Valid ${buy ? 'bullish' : 'bearish'} reclamation`;
    case 'kl_valid': return `Valid ${sub} (${sd} setup)`;
    case 'kl_invalid': return `${sub} invalidated`;
    case 'qml_valid': return `Valid QML (${sd} setup)`;
    case 'bjeff_valid': return `Bjeff zone active (${sd} setup)`;
    case 'kl_entry': case 'qml_entry': case 'adv_entry': return `Entry confirmation${p.conf ? ': ' + p.conf : ''} (${sd})`;
    default: return String(a.title || '').replace(/^[A-Z]+:\s*/, '');
  }
}

// Telegram text: two lines, the status dot and the alert type (why it fired), then the symbol name. No "bullish" / "bearish" words.
//   🟢 <b>RECLAMATION</b>
//   Volatility 25 Index
// The dot matches the button colour: green bullish, red bearish, white for invalidations and alerts with no direction.
// The type is the kind of alert: RECLAMATION, KEY LEVEL, QML, BJEFF ZONE or 50% KEYLEVEL POI (structure and order flow alerts
// keep their own names). The button under the message is added by the caller and is not part of this text.
const KIND_TYPE = { reclamation: 'RECLAMATION', kl_valid: 'KEY LEVEL', kl_entry: 'KEY LEVEL', kl_invalid: 'KEY LEVEL',
  qml_valid: 'QML', qml_entry: 'QML', bjeff_valid: 'BJEFF ZONE', adv_entry: '50% KEYLEVEL POI',
  bos: 'BREAK OF STRUCTURE', choch: 'CHANGE OF STRUCTURE' };      // bos / choch / invalidated(ORDER FLOW) come from Sniper Mode flows
const INVALID_KINDS = new Set(['kl_invalid', 'invalidated']);
export const isSmcAlert = (a) => !!(a && ((a.payload && a.payload.src === 'smc') || String(a.key || '').includes('|smc|')));
export const alertType = (a) => KIND_TYPE[a.kind] || String(TYPE_NAME[a.concept] || a.concept || 'ALERT').toUpperCase();
// Key level and QML alerts name the candle confirmation: an entry alert carries it (" · BULLISH ENGULF"), a freshly detected key level / QML that has no
// candle confirmation yet says " · CONFIRMED"; a low probability key level says " · LOW PROBABILITY" and its reason goes on a third line.
const confSuffix = (a) => {
  const conf = a.payload && a.payload.conf;
  if ((a.kind === 'kl_entry' || a.kind === 'qml_entry') && conf) return ' · ' + String(conf).toUpperCase();
  if (a.kind === 'kl_valid' && a.payload && a.payload.low_prob) return ' · LOW PROBABILITY';
  if (a.kind === 'kl_valid' || a.kind === 'qml_valid') return ' · CONFIRMED';
  return '';
};
export const formatAlert = (a) => {
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const type = esc(alertType(a) + confSuffix(a));   // key level / QML entry: which candle confirmation (BULLISH HARAMI, MORNING STAR ...), or CONFIRMED when none yet (LOW PROBABILITY for a key level with too many wicks)
  const head = INVALID_KINDS.has(a.kind) ? `⚪ <b>INVALIDATED · ${type}</b>`
    : a.dir === 1 ? `🟢 <b>${type}</b>`
    : a.dir === -1 ? `🔴 <b>${type}</b>`
    : `⚪ <b>${type}</b>`;
  const lp = a.kind === 'kl_valid' && a.payload && a.payload.low_prob, pl = a.payload || {};
  const why = lp ? `\n⚠️ Low probability: ${esc(pl.wicks)} wick${pl.wicks === 1 ? '' : 's'} inside the POI (max ${esc(pl.max_wicks)} allowed). Not traded.` : '';
  return `${head}\n${esc(a.symbol_name)}${isSmcAlert(a) ? '\n🧭 <b>SMC</b>' : ''}${why}`;      // SMC alerts say so; the same rules on the SMC order flow (IDM / DISR)
};
// Short plain-text version of the headline for the chart image ("KEY LEVEL"). The colour of the tag and the arrow carry the direction.
export const alertLabel = (a) => `${INVALID_KINDS.has(a.kind) ? 'INVALIDATED ' : ''}${alertType(a)}${confSuffix(a).replace(' · ', ' ')}`;

// Sniper Mode (a person's own order flow): the same two lines, plus a third that says whose flow it is.
export const formatSniperAlert = (a) => `${formatAlert(a)}\n🎯 <b>SNIPER MODE</b>${a.kind === 'invalidated' ? ' · your order flow is over, set a new one' : ''}`;

// What the chart screenshot of an alert needs (see chartimg.js): the candles of the timeframe that fired it, the POI box and the trade plan.
// It is kept on the alert object only (never stored in the database) and used when the Telegram message is sent.
export function chartSnap(a, ev, series, digits) {
  const p = ev.extra || {}, plan = [];
  if (Number.isFinite(p.entry)) plan.push({ y: p.entry, label: 'ENTRY', tone: 'entry' });
  if (Number.isFinite(p.sl)) plan.push({ y: p.sl, label: 'SL', tone: 'sl' });
  if (Number.isFinite(p.tp)) plan.push({ y: p.tp, label: 'TP', tone: 'tp' });
  if (Number.isFinite(p.level)) plan.push({ y: p.level, label: 'BOS', tone: 'entry' });          // break / change of structure: the level that was broken
  return {
    candles: series.slice(-300).map((c) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, forming: !!c.forming })),
    tf: ev.tf, tfName: TF_NAME[ev.tf] || '', t: ev.t, dir: INVALID_KINDS.has(a.kind) ? 0 : a.dir, symbol: a.symbol_name.toUpperCase(), label: alertLabel(a), digits,
    box: Number.isFinite(p.lo) && Number.isFinite(p.hi) ? { lo: p.lo, hi: p.hi, t0: p.t0, label: (TYPE_NAME[a.concept] || '').toUpperCase() } : null,
    lines: plan,
  };
}

// The SORK checklist for one symbol: S structure, O order flow, R reclamation, K key level.
export function stepsOf(st) {
  const step = (k, state, text) => ({ k, state, text });
  if (!st) return { steps: ['S', 'O', 'R', 'K'].map((k) => step(k, 'todo', 'No data yet')), status: 'quiet', plan: null, next: 'Waiting for data' };
  const S = st.s, pois = ((st.o && st.o.pois) || []).filter((p) => p.role !== 'plq'), rs = (st.r || []).filter((r) => r.role !== 'plq');
  const a = st.k && st.k.active, valid = !!(a && !a.invalidated);
  const steps = [
    S && S.trend_invalidated ? step('S', 'now', `${S.trend === 1 ? 'Uptrend' : 'Downtrend'}: old trend invalidated (disruption POI broken)`)
      : S && S.valid ? step('S', 'done', `${S.trend === 1 ? 'Uptrend' : 'Downtrend'} valid on H1`) : step('S', 'todo', 'No valid structure yet'),
    pois.length ? step('O', 'done', 'Inducement and disruption mapped') : step('O', 'todo', 'Nothing mapped yet'),
    rs.some((r) => r.state > 0) ? step('R', 'now', `In progress: step ${Math.max(...rs.map((r) => r.state))} of 5 on H1`)
      : rs.some((r) => r.last_complete) ? step('R', 'done', 'Reclamation complete') : step('R', 'todo', 'Waiting for a reclamation'),
    valid ? (a.high_prob ? step('K', 'done', 'Key level is valid') : step('K', 'now', 'Key level is valid but low probability, not traded'))
      : step('K', 'todo', a ? 'Last key level was invalidated' : 'No valid key level yet'),
  ];
  const ready = valid && a.high_prob && pois.length > 0 && !!(S && S.valid);   // a setup needs structure and order flow, not just a key level
  const wait = steps.find((x) => x.state !== 'done');
  return { steps, status: ready ? 'ready' : (S && S.valid ? 'building' : 'quiet'),
    plan: valid ? { dir: a.dir, type: a.type, entry: a.plan ? a.plan.entry : null } : null,
    next: ready ? '' : (wait ? `${wait.k}: ${wait.text}` : '') };
}

export class Service {
  constructor(store, params = defaultParams, log = console) {
    this.store = store;
    this.p = params;
    this.log = log;
    this.symbols = SYMBOLS.map((s) => ({ ...s }));
    this.byId = new Map(this.symbols.map((s) => [s.id, s]));
    this.cache = new Map(this.symbols.map((s) => [s.id, {}]));
    this.states = new Map();
    this.smcStates = new Map();                  // sid -> the SORK rules evaluated on the SMC order flow (IDM / DISR / LIQ)
    this.smcAlerts = false;                      // turned on by createApp (SMC_ALERTS)
    this.smcOnly = false;                        // turned on by createApp: the bot's own non-SMC alerts are not stored at all (they never reach Telegram or the Alerts tab)
    this.smcParams = {};                         // SMC engine settings for the order flow (swingLen, internalLen ...)
  }

  setCodes(codes) {
    for (const s of this.symbols) {
      s.code = codes[norm(s.name)] || null;
      s.available = s.code !== null;
      if (!s.available) this.log.warn('symbol not found on Deriv:', s.name);
    }
  }

  // Evaluate one symbol and return the NEW alerts (already stored).
  apply(sid, h4, h1, m5, now = Date.now() / 1000) {
    const s = this.byId.get(sid);
    const digits = digitsFor(m5), res = evaluate(h4, h1, m5, this.p, digits);
    res.state.updated = Math.floor(now);
    res.state.price = m5.length ? m5[m5.length - 1].c : null;
    this.states.set(sid, res.state);
    const fresh = [];
    if (this.smcOnly) return fresh;                            // SMC-only mode: the state above is kept for the app, but no alert is stored or sent
    for (const ev of res.events) {
      if (now - ev.t > 3 * ev.tf) continue;                    // stale events are not alerted
      const a = {
        key: `${sid}|${ev.concept}|${ev.kind}|${ev.uid}`, ts: Math.min(ev.t, Math.floor(now)), symbol: sid, symbol_name: s.name, concept: ev.concept,
        kind: ev.kind, dir: ev.dir, title: ev.title, body: ev.body,
        payload: { ...ev.extra, tf: ev.tf, bias: res.state.s ? res.state.s.bias : 0 },
      };
      a.id = this.store.addAlert(a);
      if (a.id) {
        try { a.snap = chartSnap(a, ev, ev.tf === M5 ? m5 : ev.tf === H4 ? h4 : h1, digits); } catch (e) { this.log.warn('chart data for', a.key, 'failed:', e.message); }
        fresh.push(a);
      }
    }
    return fresh;
  }

  // Live candles (M5, and H1 / H4 when liveHtf): the history is fetched once, then on every poll only the last 3 candles are fetched and merged in (the forming
  // candle keeps changing, the one before it gets its final values). A bigger gap (restart, lost connection) fetches everything again.
  async #live(deriv, s, cache, now, gran) {
    const ent = cache[gran], prev = (Math.floor(now / gran) - 1) * gran, n = countsFor(this.p)[gran];
    const last = ent && ent.cs.length ? ent.cs[ent.cs.length - 1].t : null;
    if (last === null || last < prev) {
      cache[gran] = { cs: await deriv.candles(s.code, gran, n, true) };
      return;
    }
    const tail = await deriv.candles(s.code, gran, 3, true);
    const byT = new Map(ent.cs.map((c) => [c.t, c]));
    for (const c of tail) { byT.set(c.t, c); }
    ent.cs = [...byT.values()].sort((a, b) => a.t - b.t).slice(-n);
    const lt = ent.cs[ent.cs.length - 1];
    for (const c of ent.cs) if (c !== lt && c.forming) delete c.forming;   // a candle that has since closed is no longer forming
  }

  async refresh(deriv, sid) {
    const s = this.byId.get(sid);
    if (!s.available) return [];
    const now = Date.now() / 1000, cache = this.cache.get(sid);
    let changed = false;
    for (const gran of [H4, H1]) {
      if (this.p.liveHtf) { await this.#live(deriv, s, cache, now, gran); changed = true; continue; }   // forming candle too, refreshed on every poll
      const bucket = Math.floor(now / gran), ent = cache[gran];                                         // otherwise closed candles only, fetched once per candle
      if (!ent || (ent.bucket !== bucket && now - bucket * gran >= 3)) {
        cache[gran] = { bucket, cs: await deriv.candles(s.code, gran, countsFor(this.p)[gran]) };
        changed = true;
      }
    }
    if (this.p.liveM5) { await this.#live(deriv, s, cache, now, M5); changed = true; }   // M5: the forming candle too, refreshed on every poll
    else {
      const bucket = Math.floor(now / M5), ent = cache[M5];
      if (!ent || (ent.bucket !== bucket && now - bucket * M5 >= 3)) {
        cache[M5] = { bucket, cs: await deriv.candles(s.code, M5, countsFor(this.p)[M5]) };
        changed = true;
      }
    }
    if (!changed && this.states.has(sid)) return [];
    const fresh = this.apply(sid, cache[H4].cs, cache[H1].cs, cache[M5].cs, now);
    if (this.smcAlerts) { try { fresh.push(...this.applySmc(sid, cache[H4].cs, cache[H1].cs, cache[M5].cs, now)); } catch (e) { this.log.warn('smc flow', sid, 'failed:', e.message); } }
    return fresh;
  }

  // The same SORK rules (reclamation, key level, M5 POI, 50% POI, bjeff zone, QML, trade plan) on the SMC order flow: IDM = inducement, DISR = disruption, LIQ = point of liquidity.
  // Returns the NEW alerts (already stored). Their keys carry `smc`, so they never clash with the SORK alerts, and their payload says src: 'smc'.
  applySmc(sid, h4, h1, m5, now = Date.now() / 1000) {
    const s = this.byId.get(sid);
    const digits = digitsFor(m5), res = evaluate(h4, h1, m5, this.p, digits, { flowOf: (h1c) => smcFlow(h1c, this.smcParams) });
    res.state.updated = Math.floor(now);
    res.state.price = m5.length ? m5[m5.length - 1].c : null;
    delete res.state.candles;                                  // the chart already has its candles; keep the SMC state small
    this.smcStates.set(sid, res.state);
    const fresh = [];
    for (const ev of res.events) {
      if (now - ev.t > 3 * ev.tf) continue;                    // stale events are not alerted
      const a = {
        key: `${sid}|smc|${ev.concept}|${ev.kind}|${ev.uid}`, ts: Math.min(ev.t, Math.floor(now)), symbol: sid, symbol_name: s.name, concept: ev.concept,
        kind: ev.kind, dir: ev.dir, title: ev.title, body: ev.body,
        payload: { ...ev.extra, tf: ev.tf, bias: res.state.s ? res.state.s.bias : 0, src: 'smc' },
      };
      a.id = this.store.addAlert(a);
      if (a.id) {
        try { a.snap = chartSnap(a, ev, ev.tf === M5 ? m5 : ev.tf === H4 ? h4 : h1, digits); } catch (e) { this.log.warn('chart data for', a.key, 'failed:', e.message); }
        fresh.push(a);
      }
    }
    return fresh;
  }

  // Which of these price alerts has price reached? Live price counts at once; the M5 candles after the alert was set catch a spike
  // that came and went between two polls. The candle the alert was set in is skipped (its earlier highs and lows are not news).
  hitPriceAlerts(sid, list) {
    const st = this.states.get(sid);
    if (!st || st.price == null) return [];
    const ent = this.cache.get(sid)[M5], m5 = (ent && ent.cs) || [];
    return list.filter((a) => {
      const after = m5.filter((c) => c.t >= Math.ceil(a.created / M5) * M5);
      return a.side === 1 ? st.price >= a.price || after.some((c) => c.h >= a.price) : st.price <= a.price || after.some((c) => c.l <= a.price);
    });
  }

  // Chart data for the picture sent with a price alert (see chartimg.js).
  // tf = the timeframe (seconds) the alert was set on: the picture shows that chart. Falls back to M5 when that timeframe has no candles.
  priceSnap(sid, price, tf = M5) {
    const s = this.byId.get(sid), cache = this.cache.get(sid) || {}, st = this.states.get(sid);
    const use = cache[tf] && cache[tf].cs.length ? tf : M5, ent = cache[use];
    if (!s || !ent || !ent.cs.length) return null;
    return { candles: ent.cs.slice(-300).map((c) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, forming: !!c.forming })), tf: use, tfName: TF_NAME[use] || 'M5',
      t: Math.floor(Date.now() / 1000), dir: 0, symbol: s.name.toUpperCase(), label: 'PRICE ALERT', digits: st ? st.digits : 3, box: null,
      lines: [{ y: price, label: 'ALERT', tone: 'entry' }] };
  }

  // ---- Sniper Mode. The flow = { id, dir, ind: {lo, hi, t}, dis: {lo, hi, t}, created }. Returns null while the symbol has no data.
  // Alerts = the SORK events that came AFTER the flow was set (reclamation, key level, QML, bjeff zone, break / change of structure, and the
  // invalidation of the person's disruption). Nothing is sent for events that happened before, or that are older than 3 candles of their timeframe.
  sniperEvents(sid, flow, now = Date.now() / 1000) {
    const s = this.byId.get(sid), c = this.cache.get(sid) || {}, h4 = c[H4] && c[H4].cs, h1 = c[H1] && c[H1].cs, m5 = c[M5] && c[M5].cs;
    if (!s || !h4 || !h1 || !m5 || !h4.length || !h1.length || !m5.length) return null;
    const digits = digitsFor(m5), manual = { dir: flow.dir, ind: flow.ind, dis: flow.dis };
    const res = evaluate(h4, h1, m5, this.p, digits, { manual });
    const iv = res.state.o && res.state.o.invalidated, invT = iv ? iv.t + H1 : null, alerts = [];
    for (const ev of res.events) {
      if (ev.t < flow.created || now - ev.t > 3 * ev.tf) continue;
      if (invT !== null && ev.kind !== 'invalidated' && ev.t >= invT) continue;       // the flow is over: nothing more is said about it
      const a = { key: `${flow.id}|${ev.concept}|${ev.kind}|${ev.uid}`, ts: Math.min(ev.t, Math.floor(now)), symbol: sid, symbol_name: s.name, concept: ev.concept,
        kind: ev.kind, dir: ev.dir, title: ev.title, body: ev.body, payload: { ...ev.extra, tf: ev.tf } };
      try {
        a.snap = chartSnap(a, ev, ev.tf === M5 ? m5 : ev.tf === H4 ? h4 : h1, digits);
        if (ev.kind === 'invalidated') a.snap.box = { lo: flow.dis.lo, hi: flow.dis.hi, t0: flow.dis.t, label: 'DISRUPTION' };
      } catch (e) { this.log.warn('chart data for', a.key, 'failed:', e.message); }
      alerts.push(a);
    }
    return { alerts, ended: invT !== null };
  }
  // Has price already gone beyond this disruption POI? (Checked when a flow is set, so a flow that is already dead is refused.)
  sniperDead(sid, spec) {
    const ent = (this.cache.get(sid) || {})[H1]; if (!ent || !ent.cs.length) return false;
    return !!manualOrderFlow(closedOnly(ent.cs), spec).invalidated;
  }

  overview() {
    const last = this.store.lastAlertTs(this.smcOnly);
    return this.symbols.map((s) => {
      const st = this.states.get(s.id);
      const row = { id: s.id, name: s.name, short: s.short, available: !!s.available, trend: null, k: null, qml: false,
        price: null, updated: null, last_alert: last[s.id] ?? null, digits: 3 };
      if (st) {
        const k = st.k && st.k.active;
        Object.assign(row, stepsOf(st), {
          trend: st.s ? st.s.trend : null, price: st.price, updated: st.updated, digits: st.digits ?? 3,
          k: k && !k.invalidated ? k.type + (k.high_prob ? '' : '*') : null,
          qml: !!(st.qml && !st.qml.invalidated_t),
        });
      }
      if (!st) Object.assign(row, stepsOf(null));
      return row;
    });
  }

  // The SMC flow of one symbol for the chart: the overlays (key level, M5 POI, 50% POI, bjeff zone, QML), the reclamation steps and the checklist.
  smcView(sid) {
    const s = this.byId.get(sid), st = this.smcStates.get(sid) || null;
    return s ? { id: sid, name: s.name, state: st, ...stepsOf(st) } : null;
  }

  symbolView(sid) {
    const s = this.byId.get(sid);
    return s ? { id: sid, name: s.name, short: s.short, available: !!s.available, state: this.states.get(sid) || null, ...stepsOf(this.states.get(sid)) } : null;
  }
}
