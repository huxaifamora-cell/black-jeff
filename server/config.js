// Settings come from environment variables (see .env.example).
const e = process.env;

export function loadConfig() {
  return {
    botToken: e.BOT_TOKEN || '',
    // Render sets RENDER_EXTERNAL_URL for you, so WEBAPP_URL is optional there.
    webappUrl: (e.WEBAPP_URL || e.RENDER_EXTERNAL_URL || '').replace(/\/+$/, ''),
    port: Number(e.PORT || 8080),
    dbPath: e.DB_PATH || ':memory:',                         // default: in memory, no database or disk needed
    // Alert recipients that always receive alerts (comma separated Telegram user ids), even after a restart.
    alertChatIds: (e.ALERT_CHAT_IDS || '').split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n !== 0),
    // Telegram chat (usually your own user id) where the bot keeps its pinned user backup. Empty = no backup.
    stateChatId: (e.STATE_CHAT_ID || '').trim(),
    // Keep-alive: ping our own public URL every N minutes so a free Web Service does not spin down. 0 = off.
    keepAliveMinutes: e.KEEP_ALIVE === '1' || e.KEEP_ALIVE === 'true' ? Number(e.KEEP_ALIVE_MINUTES || 10) : 0,
    derivUrls: (e.DERIV_WS_URLS ||
      'wss://api.derivws.com/trading/v1/options/ws/public,wss://ws.derivws.com/websockets/v3?app_id={app_id}')
      .split(',').filter(Boolean),
    derivAppId: e.DERIV_APP_ID || '1089',
    requireAuth: e.DEV_ALLOW_NO_AUTH !== '1',
    pollSeconds: Number(e.POLL_SECONDS || 20),
  };
}
