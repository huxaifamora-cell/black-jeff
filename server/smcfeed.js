// Plugs the SMC indicator (smc.js) into the Deriv WebSocket. One live candle subscription per (symbol, timeframe) that somebody is looking at
// (or that SMC_SYMBOLS pins), each feeding its own SmcEngine. No polling: the engine sees every tick of the forming candle and every candle close.
//
// Events (EventEmitter):
//   'snapshot' { sym, tf, snap }                 full state: sent after (re)subscribing, or after the engine rebuilt itself
//   'update'   { sym, tf, changed, trend, t }    a candle CLOSED: annotations that are new or changed (BOS, CHoCH, sweep, IDM, swings ...)
//   'live'     { sym, tf, live }                 provisional marks of the forming candle, only sent when they change
import { EventEmitter } from 'node:events';
import { SmcEngine } from './smc.js';
import { C } from './engine.js';

export const TF_SECONDS = { m5: 300, h1: 3600, h4: 14400 };
export const tfName = (sec) => Object.keys(TF_SECONDS).find((k) => TF_SECONDS[k] === sec) || String(sec);
const clean = (a) => { const { ref, ...rest } = a; return rest; };       // `ref` is engine bookkeeping

export class SmcFeed extends EventEmitter {
  // deriv: needs subscribeCandles(code, granularity, count, onMessage, onClose) and (optionally) candles(code, granularity, count)
  // codeOf(symbolId) -> Deriv symbol code or null.   pinned: symbol ids that are always watched.
  constructor({ deriv, codeOf, params = {}, timeframes = [300, 3600], pinned = [], history = 1500, idleMs = 10 * 60 * 1000, log = console, confirmOnRoll = true } = {}) {
    super();
    this.deriv = deriv; this.codeOf = codeOf; this.params = params; this.timeframes = timeframes; this.pinned = new Set(pinned);
    this.history = history; this.idleMs = idleMs; this.log = log; this.confirmOnRoll = confirmOnRoll;
    this.entries = new Map();
    this.stopped = false;
    this.sweeper = setInterval(() => this.#sweep(), 60000); this.sweeper.unref?.();
  }

  key(sym, tf) { return `${sym}|${tf}`; }
  supports(tf) { return this.timeframes.includes(tf); }

  // Start watching (idempotent) and resolve with the current snapshot. Safe to call on every request: it also keeps the subscription alive.
  async watch(sym, tf) {
    if (this.stopped || !this.supports(tf)) return null;
    const k = this.key(sym, tf);
    let en = this.entries.get(k);
    if (!en) {
      en = { sym, tf, engine: new SmcEngine(this.params), forming: null, sub: null, starting: null, retry: 0, timer: null, sig: '', lastSeen: Date.now(), state: 'idle' };
      this.entries.set(k, en);
    }
    en.lastSeen = Date.now();
    if (!en.sub && !en.starting) en.starting = this.#subscribe(en).finally(() => { en.starting = null; });
    if (en.starting) { try { await en.starting; } catch (e) { this.log.warn('smc subscribe', k, 'failed:', e.message); this.#later(en); } }
    return en.sub ? this.snapshot(sym, tf) : null;
  }

  snapshot(sym, tf) {
    const en = this.entries.get(this.key(sym, tf));
    if (!en) return null;
    const snap = en.engine.snapshot();
    return { sym, tf, state: en.state, trend: snap.trend, last_t: snap.last_t, top: snap.top, btm: snap.btm,
      annotations: snap.annotations.map(clean), live: en.forming ? en.engine.peek(en.forming).map(clean) : [] };
  }

  touch(sym, tf) { const en = this.entries.get(this.key(sym, tf)); if (en) en.lastSeen = Date.now(); }

  stop() {
    this.stopped = true; clearInterval(this.sweeper);
    for (const en of this.entries.values()) this.#drop(en, false);
    this.entries.clear(); this.removeAllListeners();
  }

  // ------------------------------------------------------------------ internals
  async #subscribe(en) {
    const code = this.codeOf(en.sym);
    if (!code) throw new Error(`no Deriv code for ${en.sym} yet`);
    en.state = 'starting';
    const sub = await this.deriv.subscribeCandles(code, en.tf, this.history + 1,
      (msg) => this.#onMessage(en, msg), () => this.#onClosed(en));
    if (this.stopped || !this.entries.has(this.key(en.sym, en.tf))) { sub.stop(); return; }
    const now = Date.now() / 1000;
    const raw = (sub.first.candles || []).map((c) => C(Number(c.epoch), Number(c.open), Number(c.high), Number(c.low), Number(c.close)));
    const forming = raw.length && raw[raw.length - 1].t + en.tf > now + 1 ? raw.pop() : null;
    en.engine = new SmcEngine(this.params); en.engine.seed(raw);
    en.forming = forming; en.sub = sub; en.retry = 0; en.state = 'live'; en.sig = '';
    this.log.info?.(`smc live: ${en.sym} ${tfName(en.tf)} (${raw.length} candles)`);
    this.emit('snapshot', { sym: en.sym, tf: en.tf, snap: this.snapshot(en.sym, en.tf) });
  }

  #onMessage(en, msg) {
    if (msg.error) { this.log.warn('smc stream error', en.sym, msg.error.message); return; }
    const o = msg.ohlc;
    if (!o) return;
    const c = C(Number(o.open_time), Number(o.open), Number(o.high), Number(o.low), Number(o.close));
    if (!Number.isFinite(c.t) || !Number.isFinite(c.c)) return;
    const prev = en.forming;
    if (!prev || c.t === prev.t) { en.forming = c; return this.#live(en); }
    if (c.t < prev.t) return;                                  // late message of an older candle
    // a new candle opened: the previous one is final
    en.forming = c;
    if (c.t !== prev.t + en.tf) return void this.#resync(en); // we missed candles (gap): rebuild from history
    this.#closeCandle(en, prev, c).catch((e) => this.log.warn('smc close failed:', e.message));
  }

  async #closeCandle(en, prev, next) {
    let fin = prev;
    if (this.confirmOnRoll && this.deriv.candles) {            // the last tick of the candle may not have reached us: take the official closed candle
      try { const rows = await this.deriv.candles(this.codeOf(en.sym), en.tf, 3); const m = rows.find((x) => x.t === prev.t); if (m) fin = m; }
      catch { /* keep the streamed values */ }
    }
    if (en.sub == null || this.stopped) return;
    const r = en.engine.close(fin);
    if (r.rebuilt) this.emit('snapshot', { sym: en.sym, tf: en.tf, snap: this.snapshot(en.sym, en.tf) });
    else if (r.changed.length) this.emit('update', { sym: en.sym, tf: en.tf, changed: r.changed.map(clean), trend: r.trend, t: fin.t });
    en.sig = '';
    this.#live(en, true);
  }

  #live(en, force = false) {
    if (!en.forming) return;
    const live = en.engine.peek(en.forming), sig = live.map((a) => a.id).join('|');
    if (sig === en.sig && !force) return;
    en.sig = sig;
    this.emit('live', { sym: en.sym, tf: en.tf, live: live.map(clean) });
  }

  async #resync(en) {
    try { this.#drop(en, true); await this.watch(en.sym, en.tf); } catch (e) { this.log.warn('smc resync failed:', e.message); }
  }

  #onClosed(en) {                                              // the socket dropped: subscribe again after a pause
    en.sub = null; en.state = 'down';
    if (!this.stopped && this.entries.has(this.key(en.sym, en.tf))) this.#later(en);
  }

  #later(en) {
    if (this.stopped || en.timer) return;
    const wait = Math.min(30000, 2000 * 2 ** Math.min(en.retry++, 4));
    en.timer = setTimeout(() => {
      en.timer = null;
      if (this.stopped || !this.entries.has(this.key(en.sym, en.tf)) || en.sub || en.starting) return;
      en.starting = this.#subscribe(en).catch((e) => { this.log.warn('smc resubscribe', en.sym, 'failed:', e.message); this.#later(en); }).finally(() => { en.starting = null; });
    }, wait);
    en.timer.unref?.();
  }

  #drop(en, keep) {
    clearTimeout(en.timer); en.timer = null;
    if (en.sub) { try { en.sub.stop(); } catch { /* ignore */ } en.sub = null; }
    if (!keep) this.entries.delete(this.key(en.sym, en.tf));
  }

  #sweep() {                                                   // stop subscriptions nobody looks at any more
    const now = Date.now();
    for (const en of [...this.entries.values()]) {
      if (this.pinned.has(en.sym)) continue;                   // viewers keep an entry alive by asking for it (watch / touch)
      if (now - en.lastSeen > this.idleMs) { this.log.info?.(`smc idle: ${en.sym} ${tfName(en.tf)} stopped`); this.#drop(en, false); }
    }
  }
}
