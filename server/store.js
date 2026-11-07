// In-memory SQLite (Node's built-in node:sqlite): alert feed and Telegram users. Nothing is written to disk;
// users survive restarts through backup.js and ALERT_CHAT_IDS, alerts are rebuilt from the market feed.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const ALL_CONCEPTS = ['S', 'O', 'R', 'K', 'QML', 'ADV'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS alerts(
  id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE, ts INTEGER, symbol TEXT, symbol_name TEXT,
  concept TEXT, kind TEXT, dir INTEGER, title TEXT, body TEXT, payload TEXT);
CREATE INDEX IF NOT EXISTS alerts_symbol ON alerts(symbol, id);
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
