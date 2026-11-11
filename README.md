# SORK Telegram mini app bot

A Telegram bot with a mini web app for the SORK trading concept (Market Structure, Order Flow, Reclamation, Key Level).
Plain Node.js, **no npm dependencies** (it uses Node's built-in `fetch`, `WebSocket` and `node:sqlite`, in memory by default).

- **Study guide**: the full guide as a readable page with 13 illustrations, plus the PDF.
- **Symbols**: the 23 Deriv Volatility indices. Tap one to see its own SORK view: H4 trend, order flow POIs,
  reclamation progress, key level (with entry, SL, TP), QML, advanced key level / bjeff zone, and a chart with the zones drawn on it.
- **Alerts**: a feed, and Telegram messages, when a SORK concept becomes valid on any symbol
  (S trend valid, O new inducement/disruption POI or invalidation, R valid reclamation, K valid RBS/SBR and entry
  confirmations, QML, bjeff zone). Per user: on/off, which concepts, and muted symbols.

## Deploy on Render (plain Web Service)

No Blueprint, no database and no disk. Everything is a normal Render **Web Service** with environment variables.

1. In Telegram, talk to **@BotFather**, send `/newbot`, and copy the bot token. Also find your own numeric Telegram id
   (for example with @userinfobot) and send `/start` to your new bot once.
2. Push this folder to a GitHub repository.
3. In Render: **New > Web Service**, pick the repository, and set:
   - Runtime: **Node**, build command `npm install`, start command `node server/app.js`
   - Health check path: `/healthz`
   - Environment: `NODE_VERSION=22.22.2`, `BOT_TOKEN=<token>`, `ALERT_CHATS=@your_channel`, `KEEP_ALIVE=1`
4. When the deploy is live, open `https://<your-service>.onrender.com/healthz` (it should say `{"ok":true}`),
   then send `/start` to your bot. The bot sets its own menu button, so the mini app opens from there.

### Alerts in your groups and channels (just add the bot)

Add the bot to your group (as a member) and to your channel (as an **administrator** that can post), then set
`ALERT_CHATS=@your_channel,-1001234567890` (usernames for public chats, numeric ids for private ones; any number of them).
Every alert is posted to each one. The chats are the recipient list, so nothing needs restoring after a restart.
To get a group's numeric id, add @RawDataBot or @getidsbot to it briefly (private chats and groups have ids like `-100...`).

Telegram only allows real mini app buttons in private chats, so the alert button is a link. Two choices:
- Default: the button uses the bot's own link (`https://t.me/<your_bot>?startapp=...`, found automatically) and opens the mini app inside Telegram, straight on the symbol. This needs the bot's main mini app set in @BotFather (`/mybots` > your bot > Bot Settings > Configure Mini App).
- Better: in @BotFather send `/newapp`, pick your bot, and point it at your Render address. BotFather gives a direct link
  like `https://t.me/your_bot/app`. Set `MINIAPP_LINK` to it to use that named mini app instead; the button then opens the mini app inside Telegram,
  straight on the symbol that fired.

### What groups and channels receive

Groups and channels get only **reclamation, key level, QML and advanced key level** alerts. Market structure (S) and order flow (O)
alerts stay in the app (and in private messages for people who turned them on). `ALERT_CHAT_CONCEPTS=R,K,QML,ADV` is the default; change it to widen or narrow the list.

Each message has five lines: alert type, symbol, H4 bias, status, and the timeframe that fired it. The button reads
**Open (symbol) chart** and opens the symbol in the mini app on the SORK page (S, O, R or K; QML and ADV sit under Key level) that fired the alert.

**3 points for the first open.** The first time a person opens a given alert from a group or channel button they earn 3 XP; opening the same alert
again earns nothing. Telegram does not tell a bot when a link button is tapped, so the open of the mini app is what counts. This needs `MINIAPP_LINK`
(a plain web link has no Telegram identity). The link is signed with the bot token, so hand-made links earn nothing, and it pays for 24 hours.
Which alerts a person has opened is kept in their own Telegram CloudStorage next to the rest of their rank progress.

### Telegram alert analysis (Rank tab mission)

A new alert is also a small mission. When someone opens an alert from its Telegram button (the signed link from a group or channel), the app saves that alert
in their Telegram CloudStorage for 24 hours, next to the +3 XP for the first open. In the Rank tab, under Missions, **Telegram alert analysis** shows the newest
saved alert: open its chart, then tick four checks written for that SORK concept (S, O, R, K, QML or advanced key level) once you have confirmed each one yourself.
Completing it gives 10 XP once per alert, with no daily limit; five analyses earn the Alert Analyst medal. Alerts opened from a private-message button use a plain link with no
signature, so they are not saved for this mission. It trains reading an alert the SORK way and is not a trade signal.

### Channel only (no alerts in the bot chat)

Set `ALERT_DMS=0`. The bot then posts alerts only to `ALERT_CHATS` and never as a private message, even to people who pressed
/start or opened the mini app. You can also drop `STATE_CHAT_ID` and `ALERT_CHAT_IDS`, since there are no private recipients to keep.

### Keeping direct-message recipients after a restart (only if people also message the bot privately)

Without a database or disk, the user list would be lost on every restart or deploy. Two options, usable together:

- `STATE_CHAT_ID` (automatic): the bot saves every user and their settings (alerts on/off, concepts, muted symbols) as a
  small `sork-users.json` file, sent to that chat and **pinned**. On start it reads the pinned file back.
  Use your own Telegram id (the chat must already have been started with `/start`). Do not unpin or delete that file.
  A private channel or group where the bot is an admin also works.
- `ALERT_CHAT_IDS` (fixed list): comma separated Telegram ids that always get alerts, e.g. `ALERT_CHAT_IDS=123456789,987654321`.
  Good for a small private group; it needs no backup at all.

Alerts are held in memory and rebuilt from the market feed. After a restart the first pass over the markets only fills
the list and sends no messages, so you are not re-alerted about things you already got.

### Keep-alive

A free Web Service spins down after 15 minutes without incoming requests, which stops monitoring and alerts.
`KEEP_ALIVE=1` makes the app ping its own public address every `KEEP_ALIVE_MINUTES` (default 10), which counts as traffic.
It needs `WEBAPP_URL` or Render's `RENDER_EXTERNAL_URL` (automatic). Caveats: Render's free plan has a monthly instance-hour
limit and can still restart the service, so for the most reliable alerts use a paid instance (the keep-alive is then not needed).
An outside pinger (for example UptimeRobot on `/healthz`) works as well and also wakes a service that did go down.

Notes:
- If the log says `Conflict: terminated by other getUpdates request`, a second copy of the bot is using the same token (see Troubleshooting below).
- Run exactly **one instance**. The bot uses long polling, and two instances would fight over Telegram's updates.
- `WEBAPP_URL` is optional on Render: the service uses the `RENDER_EXTERNAL_URL` that Render provides.
  Set `WEBAPP_URL` yourself if you use a custom domain.

## Run it on your own machine

Needs Node 22.13 or newer.

```
cp .env.example .env      # fill in BOT_TOKEN, and set DEV_ALLOW_NO_AUTH=1 to try it in a browser without Telegram
npm run dev               # http://localhost:8080
npm test
```

Telegram only opens mini apps over HTTPS, so to test inside Telegram locally use a tunnel
(for example `cloudflared tunnel --url http://localhost:8080`) and set `WEBAPP_URL` to the tunnel address.

## How it works

- `server/deriv.js` pulls closed H4, H1 and M5 candles from Deriv's public WebSocket (new gateway first, legacy second).
  Symbol codes are looked up from Deriv by display name; a name Deriv does not list shows as "not on Deriv".
- `server/engine.js` holds the SORK rules as pure functions. The rules that are "judged by eye" are numbers in
  `defaultParams` at the top of the file (swing size, "almost identical" tolerance, "longer than average" body, "slightly outside" buffer, and so on).
- H1 always means the last 2 months of H1 candles (`h1Days: 60`, about 1,440 candles; the feed requests that many). Key levels, order flow,
  reclamation and the QML liquidity check all use that window.
- Trend continuation: a key level only counts when it agrees with the H4 bias (RBS in a bullish bias, SBR in a bearish bias, none when there is no bias). The QML is the exception, because it is built from an invalidated key level and trades the other way. `klWithBias: false` turns the filter off.
- Key level edges: a resistant key level needs equal (or almost equal) body TOPS, a support key level needs equal body BOTTOMS; the other edge can be any length.
  RBS follows the resistant rule and SBR the support rule. Key level POI boxes start at the left edge of the first candle of the key level.
- M5 is live, with two rules. Invalidation (key level and QML) and price touching a level use the candle that is still forming, so they react at once. Signals wait for the candle to close: entry confirmations (engulf, harami, pin bar, move out of the box), M5 key levels for the bjeff zone, and the bjeff zone becoming active. So a signal never repaints. The feed flags the forming candle (`forming`), H1 and H4 use closed candles only, and `liveM5: false` turns the live feed off.
- The bjeff zone is a valid M5 RBS (for an H1 RBS, buy) or M5 SBR (for an H1 SBR, sell) that sits fully inside the 50% POI; other M5 key levels are ignored.
- A QML is only alerted when its reversal point is at, or within `plqNearAtr` x H1 ATR of, a point of liquidity (any H1 BOS in the window except the
  current inducement and disruption, and formed before the reversal).
- `server/service.js` evaluates each symbol, stores alerts (duplicates are ignored) and only notifies fresh events.
- `server/app.js` serves the mini app and the API, validates Telegram's login data, and runs the feed loop and the bot.
- `web/` is the mini app (plain HTML and JavaScript) and the study guide.

Commands in the bot: `/start`, `/help`, `/alerts_on`, `/alerts_off`.

## Study guide assets (optional)

`web/` already contains the generated guide. To rebuild the illustrations, the PDF and the in-app guide you need
Python with matplotlib, reportlab and Pillow: `python tools/make_figs2.py && python tools/build_pdf.py && python tools/make_guide_html.py`.

## Things to know

- The engine is covered by offline tests on hand-made candles, and its output was checked against an earlier
  reference implementation on 40 random markets. It has not yet been run against live Deriv data, so check the first
  alerts against your own chart reading and tune `defaultParams`.
- H1 and H4 use closed candles only. M5 signals wait for the candle to close; only invalidation uses the forming M5 candle.
- Educational tool, not financial advice.

## Troubleshooting

- `getUpdates ... Conflict: terminated by other getUpdates request`: two programs are polling the same bot token. During a Render
  deploy the old and new copies overlap for a minute, which is harmless and stops by itself. If it keeps repeating, something else
  is running with that token: an old Render service (for example from the earlier Blueprint), a copy on your computer, or another
  host. Stop or delete that one, or revoke the token in @BotFather (`/revoke`) and put the new one on Render only.
  If you only want alerts in groups and channels, set `POLL_COMMANDS=0`; the bot then never polls and cannot clash.
