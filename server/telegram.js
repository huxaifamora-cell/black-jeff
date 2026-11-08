// Telegram Bot API (plain fetch, no library).
export class Bot {
  constructor(token) { this.token = token; this.base = `https://api.telegram.org/bot${token}/`; this.abort = new AbortController(); }

  async call(method, params = {}, signal) {
    const r = await fetch(this.base + method, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
      signal: signal || AbortSignal.timeout(70000),
    });
    const data = await r.json();
    if (!data.ok) throw new Error(`telegram ${method}: ${data.description}`);
    return data.result;
  }

  // button.plain = ordinary link button (channels do not allow mini app buttons)
  send(chatId, text, button) {
    const params = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true };
    if (button) params.reply_markup = { inline_keyboard: [[button.plain ? { text: button.text, url: button.url } : { text: button.text, web_app: { url: button.url } }]] };
    return this.call('sendMessage', params);
  }

  setMenuButton(url, text = 'SORK') {
    return this.call('setChatMenuButton', { menu_button: { type: 'web_app', text, web_app: { url } } });
  }

  // Long polling. Use only ONE running instance of the bot (two pollers fight over the updates).
  async poll(handler, log = console) {
    let offset = 0;
    while (!this.abort.signal.aborted) {
      try {
        const updates = await this.call('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] }, this.abort.signal);
        for (const u of updates) {
          offset = u.update_id + 1;
          try { await handler(u); } catch (e) { log.error('update handler failed', e); }
        }
      } catch (e) {
        if (this.abort.signal.aborted) return;
        const conflict = /Conflict/.test(e.message);       // another copy of the bot is polling with the same token
        if (!conflict || !this.warnedConflict) log.warn('getUpdates failed:', e.message);
        if (conflict) this.warnedConflict = true;
        await new Promise((r) => setTimeout(r, conflict ? 30000 : 5000));
      }
    }
  }

  stop() { this.abort.abort(); }
}
