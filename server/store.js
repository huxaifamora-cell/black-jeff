// In-memory SQLite (Node's built-in node:sqlite): alert feed and Telegram users. Nothing is written to disk;
// users survive restarts through backup.js and ALERT_CHAT_IDS, alerts are rebuilt from the market feed.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';

export const MAX_PRICE_ALERTS = 20;                 // per person
export const MAX_SNIPER_FLOWS = 10;                 // per person (one per symbol)
export const ALL_CONCEPTS = ['S', 'O', 'R', 'K', 'QML', 'ADV'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS alerts(
  id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE, ts INTEGER, symbol TEXT, symbol_name TEXT,
  concept TEXT, kind TEXT, dir INTEGER, title TEXT, body TEXT, payload TEXT);
CREATE INDEX IF NOT EXISTS alerts_symbol ON alerts(symbol, id);
CREATE TABLE IF NOT EXISTS alert_xp(tg_id INTEGER, oid TEXT, st INTEGER, ts INTEGER, PRIMARY KEY(tg_id, oid));
CREATE TABLE IF NOT EXISTS price_alerts(id TEXT PRIMARY KEY, tg_id INTEGER, symbol TEXT, price REAL, side INTEGER, created INTEGER, tf INTEGER DEFAULT 300);
CREATE INDEX IF NOT EXISTS price_alerts_symbol ON price_alerts(symbol);
CREATE TABLE IF NOT EXISTS sniper_flows(id TEXT PRIMARY KEY, tg_id INTEGER, symbol TEXT, dir INTEGER, ind_lo REAL, ind_hi REAL, ind_t INTEGER,
  dis_lo REAL, dis_hi REAL, dis_t INTEGER, created INTEGER, status TEXT DEFAULT 'active', seen TEXT DEFAULT '[]');
CREATE INDEX IF NOT EXISTS sniper_flows_symbol ON sniper_flows(symbol);
CREATE TABLE IF NOT EXISTS user_rank(tg_id INTEGER PRIMARY KEY, tag TEXT, applied INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS users(
  tg_id INTEGER PRIMARY KEY, chat_id INTEGER, name TEXT, subscribed INTEGER DEFAULT 1,
  muted TEXT DEFAULT '[]', concepts TEXT DEFAULT '[]', created INTEGER);
`;

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
    this.onUsersChanged = null;                       // set by the app to back users up
  }

  // ---- alerts
  addAlert(a) {
    const r = this.db.prepare(
      'INSERT OR IGNORE INTO alerts(key,ts,symbol,symbol_name,concept,kind,dir,title,body,payload) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(a.key, a.ts, a.symbol, a.symbol_name, a.concept, a.kind, a.dir, a.title, a.body, JSON.stringify(a.payload || {}));
    return r.changes ? Number(r.lastInsertRowid) : null;      // null = duplicate
  }

  recentAlerts({ symbol, concept, limit = 50, before } = {}) {
    let q = 'SELECT * FROM alerts WHERE 1=1';
    const args = [];
    if (symbol) { q += ' AND symbol=?'; args.push(symbol); }
    if (concept) { q += ' AND concept=?'; args.push(concept); }
    if (before) { q += ' AND id<?'; args.push(Number(before)); }
    q += ' ORDER BY id DESC LIMIT ?';
    args.push(Math.max(1, Math.min(Number(limit) || 50, 200)));
    return this.db.prepare(q).all(...args).map((r) => ({ ...r, payload: JSON.parse(r.payload || '{}') }));
  }

  lastAlertTs() {
    const out = {};
    for (const r of this.db.prepare('SELECT symbol, MAX(ts) m FROM alerts GROUP BY symbol').all()) out[r.symbol] = r.m;
    return out;
  }

  // ---- users
  upsertUser(tgId, name = '') {
    const r = this.db.prepare('INSERT OR IGNORE INTO users(tg_id,chat_id,name,created) VALUES(?,?,?,?)')
      .run(tgId, tgId, name, Math.floor(Date.now() / 1000));
    if (r.changes) this.onUsersChanged?.();
    return this.getUser(tgId);
  }

  getUser(tgId) {
    const r = this.db.prepare('SELECT * FROM users WHERE tg_id=?').get(tgId);
    const concepts = JSON.parse(r.concepts || '[]');
    return { ...r, muted: JSON.parse(r.muted || '[]'), concepts: concepts.length ? concepts : [...ALL_CONCEPTS], subscribed: !!r.subscribed };
  }

  updateSettings(tgId, { subscribed, muted, concepts } = {}) {
    if (subscribed !== undefined && subscribed !== null) this.db.prepare('UPDATE users SET subscribed=? WHERE tg_id=?').run(subscribed ? 1 : 0, tgId);
    if (Array.isArray(muted)) this.db.prepare('UPDATE users SET muted=? WHERE tg_id=?').run(JSON.stringify(muted), tgId);
    if (Array.isArray(concepts)) this.db.prepare('UPDATE users SET concepts=? WHERE tg_id=?').run(JSON.stringify(concepts.filter((c) => ALL_CONCEPTS.includes(c))), tgId);
    this.onUsersChanged?.();
    return this.getUser(tgId);
  }

  // ---- user backup (see backup.js)
  exportUsers() { return this.db.prepare('SELECT tg_id, chat_id, name, subscribed, muted, concepts, created FROM users').all(); }

  importUsers(rows) {
    const ins = this.db.prepare('INSERT OR IGNORE INTO users(tg_id,chat_id,name,subscribed,muted,concepts,created) VALUES(?,?,?,?,?,?,?)');
    let n = 0;
    for (const u of rows) {
      if (!Number.isInteger(u.tg_id)) continue;
      n += ins.run(u.tg_id, Number.isInteger(u.chat_id) ? u.chat_id : u.tg_id, String(u.name || ''), u.subscribed ? 1 : 0,
        typeof u.muted === 'string' ? u.muted : '[]', typeof u.concepts === 'string' ? u.concepts : '[]', u.created || 0).changes;
    }
    return n;
  }

  // ---- per-person alert XP status (1 = opened, 2 = analysed); backed up with the users, forgotten after 30 days
  xpMark(tgId, oid, st) {
    const ts = parseInt(String(oid).split('_')[0], 36) || 0;
    this.db.prepare('INSERT INTO alert_xp(tg_id,oid,st,ts) VALUES(?,?,?,?) ON CONFLICT(tg_id,oid) DO UPDATE SET st=MAX(st,excluded.st)').run(tgId, oid, st, ts);
    this.db.prepare('DELETE FROM alert_xp WHERE ts<?').run(Math.floor(Date.now() / 1000) - 30 * 86400);
    this.onUsersChanged?.();
  }
  xpState(tgId, oid) { const r = this.db.prepare('SELECT st FROM alert_xp WHERE tg_id=? AND oid=?').get(tgId, oid); return r ? r.st : 0; }
  exportXp() { return this.db.prepare('SELECT tg_id, oid, st, ts FROM alert_xp').all(); }
  importXp(rows) {
    const ins = this.db.prepare('INSERT OR IGNORE INTO alert_xp(tg_id,oid,st,ts) VALUES(?,?,?,?)');
    let n = 0;
    for (const x of Array.isArray(rows) ? rows : []) if (Number.isInteger(x.tg_id) && typeof x.oid === 'string' && [1, 2].includes(x.st)) n += ins.run(x.tg_id, x.oid, x.st, x.ts || 0).changes;
    return n;
  }

  // ---- rank tag per person (for the group); applied = 1 once Telegram accepted it
  rankSet(tgId, tag) {
    const cur = this.rankGet(tgId);
    if (cur && cur.tag === tag) return false;
    this.db.prepare('INSERT INTO user_rank(tg_id,tag,applied) VALUES(?,?,0) ON CONFLICT(tg_id) DO UPDATE SET tag=excluded.tag, applied=0').run(tgId, tag);
    this.onUsersChanged?.();
    return true;
  }
  rankGet(tgId) { return this.db.prepare('SELECT tag, applied FROM user_rank WHERE tg_id=?').get(tgId) || null; }
  rankApplied(tgId) { this.db.prepare('UPDATE user_rank SET applied=1 WHERE tg_id=?').run(tgId); this.onUsersChanged?.(); }
  exportRanks() { return this.db.prepare('SELECT tg_id, tag, applied FROM user_rank').all(); }
  importRanks(rows) {
    const ins = this.db.prepare('INSERT OR IGNORE INTO user_rank(tg_id,tag,applied) VALUES(?,?,?)');
    let n = 0;
    for (const x of Array.isArray(rows) ? rows : []) if (Number.isInteger(x.tg_id) && typeof x.tag === 'string' && x.tag.length <= 16) n += ins.run(x.tg_id, x.tag, x.applied ? 1 : 0).changes;
    return n;
  }

  // ---- price alerts: a person drags a line on the chart; the bot messages them once when price gets there.
  // side 1 = alert when price rises to the level (it was below), -1 = when it falls to it (it was above). One shot: removed when it fires.
  paList(tgId, symbol) {
    return symbol ? this.db.prepare('SELECT id, symbol, price, side, created, tf FROM price_alerts WHERE tg_id=? AND symbol=? ORDER BY created').all(tgId, symbol)
      : this.db.prepare('SELECT id, symbol, price, side, created, tf FROM price_alerts WHERE tg_id=? ORDER BY created').all(tgId);
  }
  paBySymbol(symbol) { return this.db.prepare('SELECT id, tg_id, symbol, price, side, created, tf FROM price_alerts WHERE symbol=?').all(symbol); }
  // tf = seconds of the chart timeframe the alert was set on (300, 3600 or 14400); its picture is drawn from that timeframe.
  paAdd(tgId, symbol, price, side, tf = 300, now = Math.floor(Date.now() / 1000)) {
    if (this.db.prepare('SELECT COUNT(*) n FROM price_alerts WHERE tg_id=?').get(tgId).n >= MAX_PRICE_ALERTS) return null;
    const id = randomBytes(5).toString('hex');
    this.db.prepare('INSERT INTO price_alerts(id,tg_id,symbol,price,side,created,tf) VALUES(?,?,?,?,?,?,?)').run(id, tgId, symbol, price, side, now, tf);
    this.onUsersChanged?.();
    return { id, symbol, price, side, created: now, tf };
  }
  paUpdate(tgId, id, price, side, tf, now = Math.floor(Date.now() / 1000)) {
    const r = tf ? this.db.prepare('UPDATE price_alerts SET price=?, side=?, created=?, tf=? WHERE id=? AND tg_id=?').run(price, side, now, tf, id, tgId)
      : this.db.prepare('UPDATE price_alerts SET price=?, side=?, created=? WHERE id=? AND tg_id=?').run(price, side, now, id, tgId);
    if (r.changes) this.onUsersChanged?.();
    return r.changes > 0;
  }
  paDelete(tgId, id) {
    const r = tgId === null ? this.db.prepare('DELETE FROM price_alerts WHERE id=?').run(id) : this.db.prepare('DELETE FROM price_alerts WHERE id=? AND tg_id=?').run(id, tgId);
    if (r.changes) this.onUsersChanged?.();
    return r.changes > 0;
  }
  exportPriceAlerts() { return this.db.prepare('SELECT id, tg_id, symbol, price, side, created, tf FROM price_alerts').all(); }
  importPriceAlerts(rows) {
    const ins = this.db.prepare('INSERT OR IGNORE INTO price_alerts(id,tg_id,symbol,price,side,created,tf) VALUES(?,?,?,?,?,?,?)');
    let n = 0;
    for (const x of Array.isArray(rows) ? rows : [])
      if (typeof x.id === 'string' && Number.isInteger(x.tg_id) && typeof x.symbol === 'string' && Number.isFinite(x.price) && (x.side === 1 || x.side === -1)) n += ins.run(x.id, x.tg_id, x.symbol, x.price, x.side, x.created || 0, [300, 3600, 14400].includes(x.tf) ? x.tf : 300).changes;
    return n;
  }

  // ---- Sniper Mode: a person sets the order flow (inducement + disruption POIs) by hand on a symbol and the bot alerts them to the rest of SORK.
  // One flow per person per symbol (setting it again replaces it). status: 'active' while it is watched, 'ended' once the disruption was invalidated.
  // `seen` = keys of the events already sent for this flow (kept with the flow, so a restart does not send them again).
  static sniperRow(r) {
    return r ? { id: r.id, tg_id: r.tg_id, symbol: r.symbol, dir: r.dir, ind: { lo: r.ind_lo, hi: r.ind_hi, t: r.ind_t },
      dis: { lo: r.dis_lo, hi: r.dis_hi, t: r.dis_t }, created: r.created, status: r.status } : null;
  }
  sniperList(tgId, symbol) {
    const rows = symbol ? this.db.prepare('SELECT * FROM sniper_flows WHERE tg_id=? AND symbol=?').all(tgId, symbol) : this.db.prepare('SELECT * FROM sniper_flows WHERE tg_id=? ORDER BY created').all(tgId);
    return rows.map(Store.sniperRow);
  }
  sniperActive(symbol) { return this.db.prepare("SELECT * FROM sniper_flows WHERE symbol=? AND status='active'").all(symbol).map((r) => ({ ...Store.sniperRow(r), seen: JSON.parse(r.seen || '[]') })); }
  sniperSet(tgId, symbol, spec, now = Math.floor(Date.now() / 1000)) {
    const had = this.db.prepare('SELECT id FROM sniper_flows WHERE tg_id=? AND symbol=?').get(tgId, symbol);
    if (!had && this.db.prepare('SELECT COUNT(*) n FROM sniper_flows WHERE tg_id=?').get(tgId).n >= MAX_SNIPER_FLOWS) return null;
    if (had) this.db.prepare('DELETE FROM sniper_flows WHERE id=?').run(had.id);
    const id = randomBytes(5).toString('hex');
    this.db.prepare('INSERT INTO sniper_flows(id,tg_id,symbol,dir,ind_lo,ind_hi,ind_t,dis_lo,dis_hi,dis_t,created,status,seen) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, tgId, symbol, spec.dir, spec.ind.lo, spec.ind.hi, spec.ind.t, spec.dis.lo, spec.dis.hi, spec.dis.t, now, 'active', '[]');
    this.onUsersChanged?.();
    return Store.sniperRow(this.db.prepare('SELECT * FROM sniper_flows WHERE id=?').get(id));
  }
  sniperDelete(tgId, id) {
    const r = tgId === null ? this.db.prepare('DELETE FROM sniper_flows WHERE id=?').run(id) : this.db.prepare('DELETE FROM sniper_flows WHERE id=? AND tg_id=?').run(id, tgId);
    if (r.changes) this.onUsersChanged?.();
    return r.changes > 0;
  }
  sniperMark(id, keys) {                                 // remember events already sent (the newest 300 are kept)
    const row = this.db.prepare('SELECT seen FROM sniper_flows WHERE id=?').get(id); if (!row) return;
    const seen = [...new Set([...JSON.parse(row.seen || '[]'), ...keys])].slice(-300);
    this.db.prepare('UPDATE sniper_flows SET seen=? WHERE id=?').run(JSON.stringify(seen), id);
    this.onUsersChanged?.();
  }
  sniperEnd(id) { const r = this.db.prepare("UPDATE sniper_flows SET status='ended' WHERE id=?").run(id); if (r.changes) this.onUsersChanged?.(); return r.changes > 0; }
  exportSniper() { return this.db.prepare('SELECT * FROM sniper_flows').all(); }
  importSniper(rows) {
    const ins = this.db.prepare('INSERT OR IGNORE INTO sniper_flows(id,tg_id,symbol,dir,ind_lo,ind_hi,ind_t,dis_lo,dis_hi,dis_t,created,status,seen) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    let n = 0;
    for (const x of Array.isArray(rows) ? rows : []) {
      if (typeof x.id !== 'string' || !Number.isInteger(x.tg_id) || typeof x.symbol !== 'string' || (x.dir !== 1 && x.dir !== -1)) continue;
      if (![x.ind_lo, x.ind_hi, x.ind_t, x.dis_lo, x.dis_hi, x.dis_t].every(Number.isFinite)) continue;
      n += ins.run(x.id, x.tg_id, x.symbol, x.dir, x.ind_lo, x.ind_hi, x.ind_t, x.dis_lo, x.dis_hi, x.dis_t, x.created || 0, x.status === 'ended' ? 'ended' : 'active', typeof x.seen === 'string' ? x.seen : '[]').changes;
    }
    return n;
  }

  recipients(symbolId, concept) {
    const out = [];
    for (const r of this.db.prepare('SELECT chat_id, muted, concepts FROM users WHERE subscribed=1').all()) {
      if (JSON.parse(r.muted || '[]').includes(symbolId)) continue;
      const c = JSON.parse(r.concepts || '[]');
      if (c.length && !c.includes(concept)) continue;
      out.push(r.chat_id);
    }
    return out;
  }

  close() { this.db.close(); }
}
