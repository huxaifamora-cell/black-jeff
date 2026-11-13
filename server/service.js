// Ties the feed, the engine and the alert store together.
import { H1, H4, M5, defaultParams, evaluate } from './engine.js';
import { SYMBOLS, norm } from './symbols.js';

// H1 needs the last 2 months (h1Days x 24 candles, the Deriv indices trade round the clock) plus a small margin.
const countsFor = (p) => ({ [H4]: 400, [H1]: Math.ceil(p.h1Days * 24) + 48, [M5]: 500 });

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

// Status on the timeframe that fired the alert, e.g. "Valid RBS (buy setup)" or "Entry confirmation: bearish breakout (sell)".
export function statusOf(a) {
  const p = a.payload || {}, buy = a.dir === 1, sd = buy ? 'buy' : 'sell', sub = p.sub || 'key level';
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

// Telegram text, "signal card" style: alert type, symbol, H4 bias, status, timeframe. Nothing else.
//   🟢 <b>BUY SETUP · KEY LEVEL</b>
//   Volatility 75 Index
//   ┃ H4 bias    Bullish          (a Telegram blockquote, labels and values in monospace)
//   ┃ Status     Valid RBS (buy setup)
//   ┃ Timeframe  H1
// The dot matches the button colour: green buy / bullish, red sell / bearish, white for invalidations and alerts with no direction.
// Key level, QML and advanced key level alerts are "setups" (BUY / SELL SETUP); structure, order flow and reclamation are BULLISH / BEARISH.
const SETUP_CONCEPTS = new Set(['K', 'QML', 'ADV']);
const INVALID_KINDS = new Set(['kl_invalid', 'invalidated']);
export const formatAlert = (a) => {
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const p = a.payload || {}, type = esc(String(TYPE_NAME[a.concept] || a.concept).toUpperCase());
  const dir = INVALID_KINDS.has(a.kind) ? 0 : a.dir;
  const setup = SETUP_CONCEPTS.has(a.concept);
  const head = INVALID_KINDS.has(a.kind) ? `⚪ <b>INVALIDATED · ${type}</b>`
    : dir === 1 ? `🟢 <b>${setup ? 'BUY SETUP' : 'BULLISH'} · ${type}</b>`
    : dir === -1 ? `🔴 <b>${setup ? 'SELL SETUP' : 'BEARISH'} · ${type}</b>`
    : `⚪ <b>${type}</b>`;
  const rows = [['H4 bias', BIAS_NAME[p.bias] || 'None yet'], ['Status', esc(statusOf(a))], ['Timeframe', TF_NAME[p.tf] || '-']];
  const card = rows.map(([k, v]) => `${k.padEnd(11)}${v}`).join('\n');
  return `${head}\n${esc(a.symbol_name)}\n\n<blockquote><code>${card}</code></blockquote>`;
};

// The SORK checklist for one symbol: S structure, O order flow, R reclamation, K key level.
export function stepsOf(st) {
  const step = (k, state, text) => ({ k, state, text });
  if (!st) return { steps: ['S', 'O', 'R', 'K'].map((k) => step(k, 'todo', 'No data yet')), status: 'quiet', plan: null, next: 'Waiting for data' };
  const S = st.s, pois = ((st.o && st.o.pois) || []).filter((p) => p.role !== 'plq'), rs = (st.r || []).filter((r) => r.role !== 'plq');
  const a = st.k && st.k.active, valid = !!(a && !a.invalidated);
  const steps = [
    S && S.trend_invalidated ? step('S', 'now', `${S.trend === 1 ? 'Uptrend' : 'Downtrend'}: old trend invalidated (disruption POI broken)`)
      : S && S.valid ? step('S', 'done', `${S.trend === 1 ? 'Uptrend' : 'Downtrend'} valid on H4`) : step('S', 'todo', 'No valid structure yet'),
    pois.length ? step('O', 'done', 'Inducement and disruption mapped') : step('O', 'todo', 'Nothing mapped yet'),
    rs.some((r) => r.state > 0) ? step('R', 'now', `In progress: step ${Math.max(...rs.map((r) => r.state))} of 5 on H1`)
      : rs.some((r) => r.last_complete) ? step('R', 'done', 'Reclamation complete') : step('R', 'todo', 'Waiting for a reclamation'),
    valid ? (a.high_prob ? step('K', 'done', `${a.type} key level is valid`) : step('K', 'now', `${a.type} is valid but low probability, not traded`))
      : step('K', 'todo', a ? 'Last key level was invalidated' : 'No valid key level yet'),
  ];
  const ready = valid && a.high_prob;
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
    const res = evaluate(h4, h1, m5, this.p, digitsFor(m5));
    res.state.updated = Math.floor(now);
    res.state.price = m5.length ? m5[m5.length - 1].c : null;
    this.states.set(sid, res.state);
    const fresh = [];
    for (const ev of res.events) {
      if (now - ev.t > 3 * ev.tf) continue;                    // stale events are not alerted
      const a = {
        key: `${sid}|${ev.concept}|${ev.kind}|${ev.uid}`, ts: Math.min(ev.t, Math.floor(now)), symbol: sid, symbol_name: s.name, concept: ev.concept,
        kind: ev.kind, dir: ev.dir, title: ev.title, body: ev.body,
        payload: { ...ev.extra, tf: ev.tf, bias: res.state.s ? res.state.s.bias : 0 },
      };
      a.id = this.store.addAlert(a);
      if (a.id) fresh.push(a);
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
    return this.apply(sid, cache[H4].cs, cache[H1].cs, cache[M5].cs, now);
  }

  overview() {
    const last = this.store.lastAlertTs();
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

  symbolView(sid) {
    const s = this.byId.get(sid);
    return s ? { id: sid, name: s.name, short: s.short, available: !!s.available, state: this.states.get(sid) || null, ...stepsOf(this.states.get(sid)) } : null;
  }
}
