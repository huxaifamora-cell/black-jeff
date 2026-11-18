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

  // The inline keyboard: one row with the open chart button and, for channel posts, the XP status button next to it.
  // button.plain = ordinary link button (channels do not allow mini app buttons)
  // button.style: 'success' (green), 'danger' (red) or 'primary' (blue). Left out when not set, so the app's default colour is used.
  // button.callback: a second button that answers with a pop-up only the person who tapped it sees (used for the private XP status)
  static keyboard(button) {
    if (!button) return null;
    const b = button.plain ? { text: button.text, url: button.url } : { text: button.text, web_app: { url: button.url } };
    if (button.style) b.style = button.style;
    const row = [b];
    if (button.callback) {
      const cb = { text: button.callback.text, callback_data: button.callback.data };
      if (button.style) cb.style = button.style;                                                  // same colour as the open chart button
      row.push(cb);
    }
    return { inline_keyboard: [row] };
  }

  send(chatId, text, button) {
    const params = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true };
    const kb = Bot.keyboard(button);
    if (kb) params.reply_markup = kb;
    return this.call('sendMessage', params);
  }

  // Alert with a chart screenshot: the text (caption) sits ABOVE the picture, the buttons under it.
  // `png` is a Buffer. Multipart upload, because the picture is generated here and has no web address.
  async sendPhoto(chatId, png, caption, button) {
    const form = new FormData();
    form.set('chat_id', String(chatId));
    form.set('photo', new Blob([png], { type: 'image/png' }), 'chart.png');
    form.set('caption', caption);
    form.set('parse_mode', 'HTML');
    form.set('show_caption_above_media', 'true');
    const kb = Bot.keyboard(button);
    if (kb) form.set('reply_markup', JSON.stringify(kb));
    const r = await fetch(this.base + 'sendPhoto', { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
    const data = await r.json();
    if (!data.ok) throw new Error(`telegram sendPhoto: ${data.description}`);
    return data.result;
  }

  answerCallback(id, text) { return this.call('answerCallbackQuery', { callback_query_id: id, text, show_alert: true, cache_time: 0 }); }

  setMenuButton(url, text = 'B-JEFF TERMINAL') {
    return this.call('setChatMenuButton', { menu_button: { type: 'web_app', text, web_app: { url } } });
  }

  // Long polling. Use only ONE running instance of the bot (two pollers fight over the updates).
  async poll(handler, log = console) {
    let offset = 0;
    while (!this.abort.signal.aborted) {
      try {
        const updates = await this.call('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] }, this.abort.signal);
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
