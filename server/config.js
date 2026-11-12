// Settings come from environment variables (see .env.example).
const e = process.env;

export function loadConfig() {
  return {
    botToken: e.BOT_TOKEN || '',
    // Render sets RENDER_EXTERNAL_URL for you, so WEBAPP_URL is optional there.
    webappUrl: (e.WEBAPP_URL || e.RENDER_EXTERNAL_URL || '').replace(/\/+$/, ''),
    // POLL_COMMANDS=0: do not listen for /start and /alerts_on commands. Alerts to groups and channels still work, and no
    // other copy of the bot can clash with this one.
    pollCommands: e.POLL_COMMANDS !== '0',
    port: Number(e.PORT || 8080),
    dbPath: e.DB_PATH || ':memory:',                         // default: in memory, no database or disk needed
    // Alert recipients that always receive alerts (comma separated Telegram user ids), even after a restart.
    alertChatIds: (e.ALERT_CHAT_IDS || '').split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n !== 0),
    // Channels and groups that receive every alert: @channelname or numeric ids (-100...). The bot must be added there (admin in a channel).
    // Several are allowed, comma separated. ALERT_CHANNEL is the older name and still works.
    alertChats: (e.ALERT_CHATS || e.ALERT_CHANNEL || '').split(',').map((x) => x.trim()).filter(Boolean),
    // Which alerts groups and channels receive. Market structure (S) and order flow (O) are left out on purpose.
    chatConcepts: (e.ALERT_CHAT_CONCEPTS || 'R,K,QML,ADV').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean),
    // ALERT_DMS=0: never send alerts as private messages from the bot. Only ALERT_CHATS get them.
    dmAlerts: e.ALERT_DMS !== '0',
    // Direct link of the mini app (from BotFather /newapp), e.g. https://t.me/your_bot/app. Makes the alert button open the
    // mini app inside a group or channel, straight on the symbol. Without it the button opens the plain web address.
    miniAppLink: (e.MINIAPP_LINK || '').trim().replace(/\/+$/, ''),
    // Links for the app's Barracks tab (t.me addresses of your community group and channel). A link left empty is not shown.
    groupUrl: (e.BARRACKS_GROUP_URL || '').trim(),
    channelUrl: (e.BARRACKS_CHANNEL_URL || '').trim(),
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
