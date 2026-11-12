// Keeps alert recipients across restarts WITHOUT a database or disk.
// The user list is saved as a small JSON file that the bot sends to a Telegram chat of yours and pins.
// On start the bot reads the pinned file back. Telegram is the storage; nothing extra to set up or pay for.
export class TelegramBackup {
  constructor(bot, chatId, log = console, delayMs = 5000) {
    this.bot = bot; this.chatId = chatId; this.log = log; this.delayMs = delayMs;
    this.timer = null; this.dirty = null; this.lastMsgId = null; this.saving = Promise.resolve();
  }

  // Returns the saved user rows, or [] when there is no backup yet.
  async load() {
    const chat = await this.bot.call('getChat', { chat_id: this.chatId });
    const pin = chat.pinned_message;
    if (!pin || !pin.document || pin.document.file_name !== 'sork-users.json') return [];
    this.lastMsgId = pin.message_id;
    const file = await this.bot.call('getFile', { file_id: pin.document.file_id });
    const r = await fetch(`https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`download failed (${r.status})`);
    const data = await r.json();
    this.xp = Array.isArray(data.xp) ? data.xp : [];          // per-person alert XP status, saved in the same file
    return Array.isArray(data.users) ? data.users : [];
  }

  // Call whenever users change. Writes are batched into one upload every few seconds.
  schedule(getUsers, getXp) {
    this.dirty = getUsers; this.dirtyXp = getXp;
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, this.delayMs);
    this.timer.unref?.();
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const getUsers = this.dirty, getXp = this.dirtyXp;
    this.dirty = null;
    if (!getUsers) return this.saving;
    this.saving = this.saving.then(() => this.#save(getUsers(), getXp ? getXp() : [])).catch((e) => this.log.warn('user backup failed:', e.message));
    return this.saving;
  }

  async #save(users, xp = []) {
    const form = new FormData();
    form.append('chat_id', String(this.chatId));
    form.append('disable_notification', 'true');
    form.append('caption', `SORK user backup: ${users.length} users`);
    form.append('document', new Blob([JSON.stringify({ saved: new Date().toISOString(), users, xp })], { type: 'application/json' }), 'sork-users.json');
    const r = await fetch(this.bot.base + 'sendDocument', { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
    const data = await r.json();
    if (!data.ok) throw new Error(`telegram sendDocument: ${data.description}`);
    const id = data.result.message_id;
    await this.bot.call('pinChatMessage', { chat_id: this.chatId, message_id: id, disable_notification: true });
    if (this.lastMsgId) await this.bot.call('deleteMessage', { chat_id: this.chatId, message_id: this.lastMsgId }).catch(() => {});
    this.lastMsgId = id;
  }
}
