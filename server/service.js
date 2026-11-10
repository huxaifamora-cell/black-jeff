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

export const formatAlert = (a) => {
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<b>${esc(a.title)}</b>\n${esc(a.symbol_name)}\n${esc(a.body)}`;
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
        kind: ev.kind, dir: ev.dir, title: ev.title, body: ev.body, payload: ev.extra,
      };
      a.id = this.store.addAlert(a);
      if (a.id) fresh.push(a);
    }
    return fresh;
  }

  // Live M5: the history is fetched once, then on every poll only the last 3 candles are fetched and merged in (the forming
  // candle keeps changing, the one before it gets its final values). A bigger gap (restart, lost connection) fetches everything again.
  async #liveM5(deriv, s, cache, now) {
    const ent = cache[M5], prev = (Math.floor(now / M5) - 1) * M5;
    const last = ent && ent.cs.length ? ent.cs[ent.cs.length - 1].t : null;
    if (last === null || last < prev) {
      cache[M5] = { cs: await deriv.candles(s.code, M5, countsFor(this.p)[M5], true) };
      return;
    }
    const tail = await deriv.candles(s.code, M5, 3, true);
    const byT = new Map(ent.cs.map((c) => [c.t, c]));
    for (const c of tail) byT.set(c.t, c);
    ent.cs = [...byT.values()].sort((a, b) => a.t - b.t).slice(-countsFor(this.p)[M5]);
  }

  async refresh(deriv, sid) {
    const s = this.byId.get(sid);
    if (!s.available) return [];
    const now = Date.now() / 1000, cache = this.cache.get(sid);
    let changed = false;
    for (const gran of [H4, H1]) {                              // H4 and H1: closed candles only, fetched once per candle
      const bucket = Math.floor(now / gran), ent = cache[gran];
      if (!ent || (ent.bucket !== bucket && now - bucket * gran >= 3)) {
        cache[gran] = { bucket, cs: await deriv.candles(s.code, gran, countsFor(this.p)[gran]) };
        changed = true;
      }
    }
    if (this.p.liveM5) { await this.#liveM5(deriv, s, cache, now); changed = true; }   // M5: the forming candle too, refreshed on every poll
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
