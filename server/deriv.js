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
    if (p) { this.pending.delete(data.req_id); p.resolve(data); }
  }

  #onClose(ws) {
    if (this.ws === ws) this.ws = null;
    clearInterval(this.ping);
    for (const p of this.pending.values()) p.reject(new Error('deriv connection closed'));
    this.pending.clear();
  }

  async request(payload, timeoutMs = 20000) {
    if (!this.ws || this.ws.readyState !== 1) {
      this.connecting ||= this.#connect().finally(() => { this.connecting = null; });
      await this.connecting;
    }
    const id = this.nextId++;
    const reply = new Promise((resolve, reject) => {
      const to = setTimeout(() => { this.pending.delete(id); reject(new Error('deriv request timed out')); }, timeoutMs);
      this.pending.set(id, { resolve: (d) => { clearTimeout(to); resolve(d); }, reject: (e) => { clearTimeout(to); reject(e); } });
    });
    this.ws.send(JSON.stringify({ ...payload, req_id: id }));
    const data = await reply;
    if (data.error) throw new Error(`deriv error: ${data.error.message}`);
    return data;
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
