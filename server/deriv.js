// Deriv market data over WebSocket (public, no login needed). Uses Node's built-in WebSocket.
import { C } from './engine.js';
import { norm } from './symbols.js';

export class Deriv {
  constructor(urls, appId, log = console) {
    this.urls = urls.map((u) => u.replace('{app_id}', appId));
    this.log = log;
    this.ws = null;
    this.pending = new Map();
    this.nextId = 1;
    this.connecting = null;
    this.active = 0;
    this.waiters = [];
    this.ping = null;
    this.streams = new Map();      // req_id -> { onMessage, onClose }: live subscriptions (ohlc candles)
    this.subs = new Map();         // Deriv subscription id -> req_id
  }

  async #connect() {
    let last = null;
    for (const url of this.urls) {
      try {
        const ws = new WebSocket(url);
        await new Promise((resolve, reject) => {
          const to = setTimeout(() => reject(new Error('timeout')), 15000);
          ws.onopen = () => { clearTimeout(to); resolve(); };
          ws.onerror = () => { clearTimeout(to); reject(new Error('connection error')); };
        });
        ws.onerror = () => {};
        ws.onmessage = (ev) => this.#onMessage(ev);
        ws.onclose = () => this.#onClose(ws);
        this.ws = ws;
        this.ping = setInterval(() => { try { ws.send(JSON.stringify({ ping: 1 })); } catch { /* closed */ } }, 30000);
        this.ping.unref?.();
        this.log.info('connected to', url.split('?')[0]);
        return;
      } catch (e) {
        last = e;
        this.log.warn('could not connect to', url.split('?')[0], e.message);
      }
    }
    throw new Error(`no Deriv endpoint reachable: ${last && last.message}`);
  }

  #onMessage(ev) {
    let data;
    try { data = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; }
    const p = this.pending.get(data.req_id);
    if (p) { this.pending.delete(data.req_id); p.resolve(data); return; }
    // not an answer to a one-off request: it is a message of a live subscription (Deriv echoes the req_id, the subscription id is the fallback)
    const rid = this.streams.has(data.req_id) ? data.req_id : this.subs.get((data.subscription && data.subscription.id) || (data.ohlc && data.ohlc.id));
    const st = rid != null ? this.streams.get(rid) : null;
    if (st) { try { st.onMessage(data); } catch (e) { this.log.warn('stream handler failed:', e.message); } }
  }

  #onClose(ws) {
    if (this.ws === ws) this.ws = null;
    clearInterval(this.ping);
    for (const p of this.pending.values()) p.reject(new Error('deriv connection closed'));
    this.pending.clear();
    const gone = [...this.streams.values()];
    this.streams.clear(); this.subs.clear();
    for (const st of gone) { try { st.onClose(); } catch (e) { this.log.warn('stream close handler failed:', e.message); } }
  }

  async request(payload, timeoutMs = 20000, stream = null) {
    if (!this.ws || this.ws.readyState !== 1) {
      this.connecting ||= this.#connect().finally(() => { this.connecting = null; });
      await this.connecting;
    }
    const id = this.nextId++;
    const reply = new Promise((resolve, reject) => {
      const to = setTimeout(() => { this.pending.delete(id); reject(new Error('deriv request timed out')); }, timeoutMs);
      this.pending.set(id, { resolve: (d) => { clearTimeout(to); resolve(d); }, reject: (e) => { clearTimeout(to); reject(e); } });
    });
    if (stream) this.streams.set(id, stream);          // registered before sending, so no early message is missed
    this.ws.send(JSON.stringify({ ...payload, req_id: id }));
    let data;
    try { data = await reply; } catch (e) { if (stream) this.streams.delete(id); throw e; }
    if (data.error) { if (stream) this.streams.delete(id); throw new Error(`deriv error: ${data.error.message}`); }
    if (stream) { const sid = data.subscription && data.subscription.id; if (sid) this.subs.set(sid, id); stream.id = id; stream.subId = sid || null; }
    return data;
  }

  // Live candles of one symbol: returns { first, stop }. `first` is the history answer (the `candles` array, newest last); every later message
  // ({ msg_type: 'ohlc', ohlc: { open_time, open, high, low, close, epoch, granularity } }) goes to onMessage. onClose fires when the socket drops;
  // the subscription is gone then and the caller subscribes again.
  async subscribeCandles(code, granularity, count, onMessage, onClose = () => {}) {
    const st = { onMessage, onClose, id: null, subId: null };
    const first = await this.#limit(() => this.request({
      ticks_history: code, adjust_start_time: 1, count, end: 'latest', style: 'candles', granularity, subscribe: 1 }, 20000, st));
    const stop = () => {
      if (!this.streams.delete(st.id)) return;
      if (st.subId) this.subs.delete(st.subId);
      if (this.ws && this.ws.readyState === 1 && st.subId) { try { this.ws.send(JSON.stringify({ forget: st.subId })); } catch { /* closed */ } }
    };
    return { first, stop };
  }

  // display name (normalised) -> symbol code. Works with the new and the legacy field names.
  async symbolCodes() {
    const data = await this.request({ active_symbols: 'brief' });
    const out = {};
    for (const s of data.active_symbols || []) {
      const name = s.underlying_symbol_name || s.display_name, code = s.underlying_symbol || s.symbol;
      if (name && code) out[norm(name)] = code;
    }
    return out;
  }

  async #limit(fn) {     // at most 4 requests in flight
    while (this.active >= 4) await new Promise((r) => this.waiters.push(r));
    this.active++;
    try { return await fn(); } finally { this.active--; this.waiters.shift()?.(); }
  }

  // Closed candles only (the candle still forming is dropped), unless `live` is true: then the forming candle is kept as the last one
  // (its high, low and close move with every tick).
  async candles(code, granularity, count, live = false) {
    const data = await this.#limit(() => this.request({
      ticks_history: code, adjust_start_time: 1, count, end: 'latest', style: 'candles', granularity }));
    const now = Date.now() / 1000;
    return (data.candles || [])
      .map((c) => C(Number(c.epoch), Number(c.open), Number(c.high), Number(c.low), Number(c.close)))
      .filter((c) => live || c.t + granularity <= now + 1)
      .map((c) => { if (c.t + granularity > now + 1) c.forming = true; return c; });   // only a live fetch can still hold the forming candle
  }

  close() { clearInterval(this.ping); try { this.ws?.close(); } catch { /* ignore */ } }
}
