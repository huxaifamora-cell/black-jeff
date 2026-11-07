// Settings come from environment variables (see .env.example and render.yaml).
const e = process.env;

export function loadConfig() {
  return {
    botToken: e.BOT_TOKEN || '',
    // Render sets RENDER_EXTERNAL_URL for you, so WEBAPP_URL is optional there.
    webappUrl: (e.WEBAPP_URL || e.RENDER_EXTERNAL_URL || '').replace(/\/+$/, ''),
    port: Number(e.PORT || 8080),
    dbPath: e.DB_PATH || './data/sork.db',
    derivUrls: (e.DERIV_WS_URLS ||
      'wss://api.derivws.com/trading/v1/options/ws/public,wss://ws.derivws.com/websockets/v3?app_id={app_id}')
      .split(',').filter(Boolean),
    derivAppId: e.DERIV_APP_ID || '1089',
    requireAuth: e.DEV_ALLOW_NO_AUTH !== '1',
    pollSeconds: Number(e.POLL_SECONDS || 20),
  };
}
