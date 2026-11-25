# SORK Telegram mini app bot

A Telegram bot with a mini web app for the SORK trading concept (Market Structure, Order Flow, Reclamation, Key Level).
Plain Node.js, **no npm dependencies** (it uses Node's built-in `fetch`, `WebSocket` and `node:sqlite`, in memory by default).

- **Study guide**: the full guide as a readable page with 13 illustrations, plus the PDF.
- **Symbols**: the 23 Deriv Volatility indices. Tap one to see its own SORK view: H4 trend, order flow POIs,
  reclamation progress, key level (with entry, SL, TP), QML, advanced key level / bjeff zone, and a chart with the zones drawn on it.
- **Alerts**: a feed, and Telegram messages, when a SORK concept becomes valid on any symbol
  (S trend valid, O new inducement/disruption POI or invalidation, R valid reclamation, K valid RBS/SBR and entry
  confirmations, QML, bjeff zone). Per user: on/off, which concepts, and muted symbols.

## Battle plan (long / short position boxes)

On a symbol's chart, tap **BATTLE PLAN** to open the plan card (code: `web/positions.js`):

1. Pick **LONG** (buy) or **SHORT** (sell).
2. Check the three prices: **Entry** (starts at the live price), **Stop loss** and **Take profit**.
3. Tap **DEPLOY ON CHART**. A simple box appears (like the TradingView position tool): teal = profit zone, red = loss zone, a thin entry line, and the stop, entry and target prices as tags on the right price axis (selected box). The ratio and prices are shown and edited in the plan card.

The risk:reward ratio is not fixed. It is whatever the three prices work out to. Change any price and the ratio follows; type a ratio in the **Risk : Reward** field and the take profit moves to match.
The first plan starts at 1:1 and each new plan starts from the ratio you used last.

- **Drag on the chart** (the selected box shows blue squares): top/bottom-left square = stop or target, middle-left = move the whole box, right square = width. Stop and target can never cross the entry.
- **Tap a box** to select it. The plan card then shows and edits that box. **NEW PLAN** starts another one, **LOCK** freezes a box, **REMOVE** deletes it, the **eye** hides or shows all boxes. Up to 20 per symbol.
- Boxes are anchored to time and price, so they stay put across M5 / H1 / H4, zoom, pan and the live refresh. They are saved per symbol in the browser (`localStorage`, key `bj_pos_v1`).
- The suggested stop is one ATR of the timeframe (never less than two label heights on screen).

## SMC indicator (market structure, BOS, CHoCH, inducement, liquidity sweeps)

A second overlay on the symbol chart, separate from the SORK engine. It maps **market structure** (HH / HL / LH / LL), **BOS**, **CHoCH**, **inducement (IDM)**,
**liquidity sweeps** and **equal highs / lows** (CHoCH marks and sweeps are tracked but hidden on the chart, see `HIDE` in `web/smc.js`) straight from the live Deriv WebSocket, and draws them on the chart as the candles close.
Use the chips under the timeframe buttons: **SMC** (on / off), **STRUCTURE**, **IDM**, **LIQUIDITY**. The choice is remembered in the browser (`bj_smc_v1`).

How the data flows (no polling, no extra dependencies):

1. `server/deriv.js` has `subscribeCandles()`: a live `ticks_history` (`style: candles`, `subscribe: 1`) subscription on the same WebSocket the bot already uses. Its `ohlc` messages are routed by `req_id` (or the subscription id).
2. `server/smcfeed.js` keeps one `SmcEngine` per (symbol, timeframe) that somebody is looking at, seeds it from the subscription history, closes a candle when the next `open_time` arrives
   (it re-reads the official closed candle first), resubscribes after a dropped socket and rebuilds after a gap. Idle subscriptions stop after 10 minutes. `SMC_SYMBOLS` keeps chosen symbols always on.
3. `server/smc.js` is the engine: pure and incremental, no repainting (a mark is only committed when a candle **closes**; the forming candle only shows a dashed `...` preview).
4. `GET /api/smc?symbol=V75&tf=m5` returns the current marks. `GET /api/smc/stream?symbol=V75&tf=m5` is a Server-Sent Events stream with `snapshot`, `update` (a candle closed: new / changed marks) and `live` (provisional marks). Same Telegram login as the other API calls.
5. **M5 follows H1.** On the M5 chart `web/smc.js` opens a second stream for H1 (`REF` in the file) and draws the H1 trend (tag `SMC H1 ▲ BULL`) and the H1 `IDM` / `DISR` / `LIQ` zones; M5's own zones and trend are not shown. M5's own BOS lines and swing labels stay. The H1 timeframe must be in `SMC_TIMEFRAMES` (it is by default). H1 and H4 charts use their own engine.
6. `web/smc.js` draws the marks. Add your own consumer (alerts, a bot message, a strategy) by listening to the feed in `createApp`: `app.smc.on('update', ({ sym, tf, changed }) => ...)`.

Definitions (all numbers are in `smcDefaults` in `server/smc.js`):

| Mark | Rule |
|---|---|
| Swing | pivot with `swingLen` (5) candles on each side, confirmed that many candles later |
| BOS | a candle **body** closes beyond the latest unbroken swing, in the direction of the trend |
| Counter-trend break (`choch`, hidden) | a body closes beyond the latest unbroken swing **against** the trend. It does **not** flip the trend: a rally against the trend between the IDM and the DISR is only a pullback. The first break after a cold start is a BOS and sets the trend |
| Trend flip | only when the **DISR zone is invalidated** (SORK rule): a body closes beyond its far side (bull: below the zone, bear: above it). The old zones leave the chart and the order flow is mapped again in the new direction with no look-back window (original SMC rule): the newest BOS zones of the new direction, whenever they formed |
| Liquidity sweep | a **wick** goes beyond an unbroken swing (or an EQH / EQL pool) but the candle **closes back** inside. High swept = buy-side liquidity (dir -1), low swept = sell-side (dir +1) |
| Inducement | `idmMode: 'zone'` (default): every BOS gets a box on the zone that formed it. Up break = demand zone: the last bearish candle at the lowest low between the broken swing and the break, plus the first bullish candle after it, body to body. Down break = supply zone, mirrored. **IDM = the zone of the latest BOS in the trend direction**, `DISR` = the BOS before it, `LIQ` = the one before that (`idmMaxOpen` = 3). A wick back into a zone = taken (`IDM ✓`). **50% rule:** a candle with a long body (more than `longBodyMult` (1.5) x the average body of the previous `avgBodyLen` (20) candles) only gives the half of its body on the zone side (demand: bottom 50%, supply: top 50%); a long first candle is the zone on its own, like the long order block body in SORK. The IDM and DISR boxes run on to the right, slightly past the forming candle, with their label inside. `idmMode: 'swing'` is the old rule: up trend, the first minor swing low (`internalLen` = 2) after the latest major swing high, at least `idmMinDepthAtr` (0.3) ATR deep; a wick below it = taken. Down trend: mirrored |
| EQH / EQL | two swings of the same side within `eqTolAtr` (0.1) x ATR form one liquidity pool |

### SORK rules on the SMC order flow (reclamation, key level, M5 POI, 50% POI, bjeff zone, QML)
The SMC order flow is translated into the shape the SORK rules expect (`server/smcflow.js`): **IDM = inducement, DISR = disruption, LIQ = point of liquidity**. Then the same code that runs SORK (`evaluate()` in `server/engine.js`, option `flowOf`) runs on it, unchanged:
reclamation at the IDM and DISR, key levels (RKL / SKL to RBS / SBR, valid on a body close past the tip, 2 wicks = high probability, must fit the IDM / DISR, M5 invalidation, the key level bias flip after an invalidation), the pullback rule (a wick back into the IDM zone with an IDM and a DISR mapped; the first valid key level after the trend resumes is skipped), the M5 POI box, the 50% POI, the bjeff zone, the QML and the trade plan.
What the SMC decides is the trend (it flips when a body closes beyond the DISR zone) and the pullback / resume (a BOS in the trend direction after the pullback). The SORK order flow keeps running next to it until you switch.
- **Alerts:** the same alerts as SORK (reclamation, key level, entries, invalidation, QML, bjeff zone, 50% POI, trend and order flow), keyed `<symbol>|smc|...`, with a third line `🧭 SMC`. They go to the people subscribed to those alert types as private messages. They are **not** posted to groups and channels unless `SMC_ALERT_CHATS=1` (so the groups do not get every alert twice). `SMC_ALERTS=0` turns the SMC alerts off.
- **Chart (H1 and M5):** key level box (gold), the M5 key level POI box, 50% POI (dashed), bjeff zone, QML, `RECLAIM ✓` where a reclamation completed and `RECLAIM n/5` while it is in progress. Layer chip `KEY LEVEL`. Read from `GET /api/smc/flow?symbol=V75` (polled every 5 s).
- **Cost:** one extra evaluation per symbol per refresh (about 50 ms on 20,000 M5 candles). Tests: `test/smcflow.test.js` and the last tests of `test/smc.test.js`.

Settings (environment variables, all optional): `SMC=0` (turn off), `SMC_ALERTS=0`, `SMC_ALERT_CHATS=1`, `SMC_SWING_LEN=5`, `SMC_INTERNAL_LEN=2`, `SMC_TIMEFRAMES=m5,h1,h4`, `SMC_SYMBOLS=V75,V100s` (always watched). Tests: `test/smc.test.js`, `test/smcfeed.test.js`, `test/derivstream.test.js`.

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

### Rank requirements (mandatory promotions)

XP can be earned in any way, but a rank is only granted once its mission is done. Until then the person keeps their rank, XP keeps adding up, and the Rank page shows the open requirement.

| To become | Requirement |
|---|---|
| Private | Complete the Field guide (finish all chapters) |
| Corporal | Pass 33 chart reading drills (every correct drill counts, even past the daily XP limit) |
| Sergeant | Pass the Proficiency Exam (every chapter, all 3 right) |
| Lieutenant | Complete 99 Intercept Analyses |

The ranks above Lieutenant follow XP alone, once a service has been chosen. The rules live in `GATES` in `web/rank.js`.

**Choosing a service at Lieutenant.** When a person reaches Lieutenant, a full-screen picker asks them to join the **Army**, **Navy** or **Air Force** (each with its own icon). The choice is permanent and is saved with the rest of their rank progress. From then on every rank above Lieutenant is a rank of that service, up to the highest one at 6000 XP:

| XP | Army | Navy | Air Force |
| --- | --- | --- | --- |
| 700 | Captain | Lieutenant Commander | Flight Lieutenant |
| 1000 | Major | Commander | Squadron Leader |
| 1400 | Lieutenant Colonel | | Wing Commander |
| 1500 | | Captain | |
| 1900 | Colonel | | Group Captain |
| 2200 | | Commodore | |
| 2500 | Brigadier | | Air Commodore |
| 3000 | | Rear Admiral | |
| 3200 | Major General | | Air Vice-Marshal |
| 4000 | Lieutenant General | Vice Admiral | Air Marshal |
| 5000 | General | Admiral | Air Chief Marshal |
| 6000 | **Field Marshal** | **Admiral of the Fleet** | **Marshal of the Air Force** |

The Navy has one rank fewer in between, as in the real navy. Insignia: the Army wears stars (Captain, Major), an oak leaf (Lieutenant Colonel), an eagle (Colonel), 1 to 4 large silver stars (Brigadier to General) and a ring of five stars (Field Marshal). The Navy wears gold sleeve stripes on navy blue and the Air Force sky blue bars on air force blue: broad stripes for the officers, then a wide band with 0 to 4 thin stripes under it for the flag officers.

Until a service is chosen the person stays at Lieutenant, even with enough XP: choosing one is the requirement for the next rank. "Decide later" closes the picker, and it appears again on the next start, from the promotion requirement card on the Rank page. People who were already above Lieutenant before this existed keep their rank (the Army names are the old ones) and can still choose. The **Rank ladder** tab has its own menu: **Ranks** (the shared ranks up to Lieutenant, with their missions), one button each for **Army**, **Navy** and **Air Force** (every rank of that service with its insignia and XP; the service you chose opens first and is marked), and **Missions** (what each mission pays and requires). The services, rank names and icons are `BRANCHES` and `ICON` in `web/rank.js`.

**Promotional exam fail rule.** If a person gets more than 30% of any promotional exam wrong, they fail it and the whole promotional mission restarts from the beginning: every chapter pass of the Proficiency Exam is cleared and they start again at chapter 1. Each chapter exam has 3 questions, so one wrong answer (33%) is already a fail. XP and medals already earned are kept. Once a person holds Sergeant the exam is no longer promotional: a low score costs nothing and clears nothing. People who were already Sergeant or higher when the rule arrived keep their earlier passes. The limit is `EXAM_FAIL_MAX` in `web/rank.js`.

**The same rule for the Corporal drills.** While a person is a Private, the chart reading drills are their promotional mission. They may miss at most 30% of the 33 required drills (9 misses, `DRILL_MISS_MAX`). The 10th miss fails them and the drills restart from 0/33 (passes and the miss count are cleared; XP and medals are kept). Misses made at other ranks are not counted.

### What groups and channels receive

Groups and channels get only **reclamation, key level, QML and advanced key level** alerts. Market structure (S) and order flow (O)
alerts stay in the app (and in private messages for people who turned them on). Invalidation alerts (for example "K: key level invalidated") are never posted to groups or channels; they only appear in the app's Alerts tab and in private messages. `ALERT_CHAT_CONCEPTS=R,K,QML,ADV` is the default; change it to widen or narrow the list.

Each message is two lines: a bold headline with a status dot (🟢 buy, 🔴 sell, ⚪ invalidation or no direction) and the alert type (RECLAMATION, KEY LEVEL, QML, BJEFF ZONE or 50% KEYLEVEL POI), and below it the symbol name. The layout is `formatAlert` in `server/service.js`. The button reads
**Open (symbol) chart** and opens the symbol in the mini app on the SORK page (S, O, R or K; QML and ADV sit under Key level) that fired the alert.

**Chart screenshot.** Every alert comes with a picture of the chart where the event happened, placed between the text and the buttons (the text is the photo caption, shown above the picture with Telegram's `show_caption_above_media`). The picture is the timeframe that fired the alert (H1 or M5): about 80 candles ending just after the event, the POI box, the entry, SL and TP lines when the alert has a plan, a dashed line and arrow on the event candle, and a tag with the headline. It is drawn by `server/chartimg.js` with no npm packages (own PNG writer and font), from the data `chartSnap` in `server/service.js` puts on the alert (not stored in the database). If the picture cannot be drawn or sent, the plain text alert goes out as before. `Bot.sendPhoto` is in `server/telegram.js`, the fallback in `notify` in `server/app.js`.

### Price alerts (drag a line on the chart)

**Quickest way, straight from the chart:** press and hold on the chart (about half a second, without moving) where you want the alert. A line appears with **SET** and **✕** buttons on the chart. Drag the line to fine tune the price, then tap **SET** (or ✕ to cancel). A tap or a drag (panning) does nothing, and it is off while the Battle plan or Sniper Mode card is open. The alert remembers the timeframe you were looking at.

Or use the card:

On a symbol's page, the **Price alert** button (bell) opens a card and puts a line on the chart. Tap the chart where you want the alert, drag the gold tag up or down, or type the price, then tap **SET ALERT**. When price reaches that level the bot sends the person a private message with a chart picture (`PRICE ALERT`, the symbol, `rose to` / `fell to` the price, and the Open chart button). Telegram plays the person's own notification sound for it; a bot cannot pick the sound, so each person sets it in Telegram (the bot chat's Notifications, Sound). An alert fires once and is then removed. Dragging an existing tag moves it, REMOVE deletes it. Up to 20 per person (`MAX_PRICE_ALERTS` in `server/store.js`).

The person must have started the bot once (/start), or Telegram refuses the private message. The server watches the price (`checkPriceAlerts` in `server/app.js`, the test is `hitPriceAlerts` in `server/service.js`), so alerts work with the app closed. They also catch a spike that came and went between two polls (M5 candles after the alert was set). The alerts are saved in the same Telegram backup file as the users (`STATE_CHAT_ID`), so they survive a restart. The API is `/api/price-alerts` (GET, POST, `/update`, `/delete`) and the screen is `web/pricealerts.js`.

**Button colour.** The button is green for a buy setup and red for a sell setup (Telegram's button `style`: `success` / `danger`). Invalidation alerts and alerts without a direction keep Telegram's default colour. It is set in `notify` in `server/app.js` and passed on by `Bot.send` in `server/telegram.js`. Telegram clients that are too old to know button colours show the default button instead.

**3 points for the first open.** The first time a person opens a given alert from a group or channel button they earn 3 XP; opening the same alert
again earns nothing. Telegram does not tell a bot when a link button is tapped, so the open of the mini app is what counts. This needs `MINIAPP_LINK`
(a plain web link has no Telegram identity). The link is signed with the bot token, so hand-made links earn nothing, and it pays for 24 hours.
Which alerts a person has opened is kept in their own Telegram CloudStorage next to the rest of their rank progress.

### Sniper Mode (set your own order flow, the bot hunts the rest of SORK)

On a symbol's page, the **Sniper mode** button (crosshair) opens a card and puts two boxes on the chart: **inducement** and **disruption**.

1. Pick **bullish flow** or **bearish flow**. In a bullish flow the inducement sits above the disruption, in a bearish flow below it. The boxes start from the bot's own reading when it has one (button **use the bot's reading**), or from two thin boxes near the price.
2. Drag each box: the top and bottom squares set its price range, the round handle on its left edge moves it to where the POI formed (the bot only looks at candles after that time). You can also type the prices.
3. Tap **Arm Sniper Mode**. You can arm one flow per symbol (up to 10 symbols); arming again replaces it, **Stop** removes it.

From then on the bot sends **you** a private message, with a chart picture, for every new event on that symbol that comes after you armed it:

| Alert | When |
|---|---|
| **BREAK OF STRUCTURE** | a valid H1 break (body close, with structural liquidity) in the direction of your flow |
| **CHANGE OF STRUCTURE** | a valid H1 break against your flow |
| **RECLAMATION** | an H1 reclamation at your inducement or disruption POI |
| **KEY LEVEL** / **QML** / **BJEFF ZONE** / **50% KEYLEVEL POI** | the usual key level, QML and bjeff rules, run on YOUR order flow instead of the bot's |
| **INVALIDATED · ORDER FLOW** | an H1 candle went beyond your disruption POI (a wick is enough). The flow ends; set a new one. |

The messages use the usual format (green or red dot, the keyword, the symbol) plus a "Sniper Mode" line. The flow lives on the server (`/api/sniper`) and is part of the Telegram backup, so it works with the app closed and survives restarts. Rules that differ from the automatic flow: nothing is remapped after your disruption breaks, and the "first key level after the pullback is not traded" rule is not applied (you decide the flow, every valid key level counts). The name is one constant per place (`SNIPER MODE` in `server/service.js`, `web/sniper.js`) if you want to rename it.

### Intercept Analysis (Rank tab mission, Telegram alert analysis)

A new alert is also a small mission. When someone opens an alert from its Telegram button (the signed link from a group or channel), the app saves that alert
in their Telegram CloudStorage for 24 hours, next to the +3 XP for the first open. In the Rank tab, under Missions, **Intercept Analysis** shows the newest
saved alert: open its chart, then tick four checks written for that SORK concept (S, O, R, K, QML or advanced key level) once you have confirmed each one yourself.
Completing it gives 10 XP once per alert, with no daily limit; five analyses earn the Alert Analyst medal. Alerts opened from a private-message button use a plain link with no
signature, so they are not saved for this mission. It trains reading an alert the SORK way and is not a trade signal.

### Channel only (no alerts in the bot chat)

Set `ALERT_DMS=0`. The bot then posts alerts only to `ALERT_CHATS` and never as a private message, even to people who pressed
/start or opened the mini app. You can also drop `STATE_CHAT_ID` and `ALERT_CHAT_IDS`, since there are no private recipients to keep.

### Keeping direct-message recipients after a restart (only if people also message the bot privately)

Without a database or disk, the user list would be lost on every restart or deploy. Two options, usable together:

- `STATE_CHAT_ID` (automatic): the bot saves every user and their settings (alerts on/off, concepts, muted symbols) as a
  small `Bjeff-users.json` file (caption "BJeff user backup"), sent to that chat and **pinned**. On start it reads the pinned file back.
  Set it to the Telegram id you want the backup saved to (that chat must already have been started with `/start`). Do not unpin or delete that file.
  An older `sork-users.json` pin in the same chat is still read and is replaced by the new file on the next save.
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
- H1 always means the last 6 months of H1 candles (`h1Days: 180`, about 4,320 candles; the feed requests that many, and H4 covers the same span). Deriv allows at most 5,000 candles per request, so `h1Days` can go up to about 205. Key levels, order flow,
  reclamation and the QML liquidity check all use that window.
- Trend continuation: a key level only counts when it agrees with the internal (H1) order flow (RBS when it is bullish, SBR when it is bearish, none when there is no order flow). The QML is the exception, because it is built from an invalidated key level and trades the other way. `klWithBias: false` turns the filter off.
- Order flow (`orderFlow`): the H1 candles are walked in time order. First the previous INVALIDATED order flow is found (an H1 body closed beyond its disruption POI); then the new order flow is looked for only among the breaks of structure after that point. Only VALID breaks of structure count (structural liquidity, same rule as H4), so a small break with no liquidity never becomes an inducement. Inducement = latest valid BOS of the flow, disruption = the valid BOS before it, and both must exist or nothing is marked.
- Inducement, disruption and point-of-liquidity POIs: one band over the A and B candles at the BOS's point of liquidity, body to body (no wicks). HH BOS: A = last bearish candle, B = first bullish candle after it; LL BOS: A = last bullish candle, B = first bearish candle after it. The search for A has no candle limit. A long body uses only 50% of the body.
- A disruption is cancelled only by a pullback at it (a body close beyond its POI). Inducement is above the disruption in an uptrend and below it in a downtrend; a new BOS at or beyond the current disruption POI is skipped as an inducement.
- Key levels vs order flow: in an uptrend, once price is above the inducement (or the disruption) POI, a key level only counts when it formed after that POI's BOS and sits entirely above the POI box. Downtrend is the inverse. Each POI is checked on its own (`klFitsOrderFlow`).
- Key level edges: a resistant key level needs equal (or almost equal) body TOPS, a support key level needs equal body BOTTOMS; the other edge can be any length.
  RBS follows the resistant rule and SBR the support rule. Key level POI boxes start at the left edge of the first candle of the key level.
- M5 is live, with two rules. Invalidation (key level and QML) and price touching a level use the candle that is still forming, so they react at once. Signals wait for the candle to close: entry confirmations (engulf, harami, pin bar, move out of the box), M5 key levels for the bjeff zone, and the bjeff zone becoming active. So a signal never repaints. The feed flags the forming candle (`forming`) and `liveM5: false` turns the live M5 feed off. H1 and H4 are live too (`liveHtf`): the chart shows the forming candle, but every H1 / H4 rule (structure, order flow, reclamation, key levels, QML) is judged on closed candles only, because they depend on a body closing beyond a level. `liveHtf: false` goes back to closed H1 / H4 candles.
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


## Structural liquidity
Structural liquidity (SLQ) is an opposite-coloured BODY candle between the point of liquidity and the break of structure (downtrend: a green candle before the BOS). Its body must not go beyond the broken level; a wick beyond it is fine.

## Inducement and disruption (order flow)
- Every BOS has a swing that started it, and one candle cannot form a swing: a BOS needs at least 2 candles leaving the swing start, otherwise it is ignored.
- The inducement is ALWAYS the swing start of the most recent BOS (valid or not). The disruption is the swing start of the BOS before it (a different swing).
- The POI boxes start at the last candle before the swing started (the order block at the swing start) and run body to body.
- The H1 chart labels the newest HH + HL (uptrend) or LL + LH (downtrend).
- The trend still flips only when an H1 wick goes beyond the disruption POI.

## Hold the chart: price alert, position box, drawing tools
There are no cards or menu buttons for these. Press and hold on the chart (about half a second) and drag to the price you want. Only three chips show on the line: **PRICE ALERT**, **POSITION BOX**, **DRAWING TOOLS** (and an `X` to cancel). Pick one and the other chips disappear:
- **PRICE ALERT**: `SET` creates the alert for the timeframe you are on, `X` cancels. A saved alert has an `X` next to its tag to remove it; drag the tag to move it.
- **POSITION BOX**: the held price is the entry. `BUY` / `SELL` deploys the box with a one-ATR stop and a target at your last risk:reward. Drag the handles to adjust; the selected box has an `X` to remove it.
- **DRAWING TOOLS** (the bot's Sniper Mode): the held price is your inducement. `BULL` / `BEAR` draws the inducement and disruption boxes (drag the handles), then `ARM` on the chart starts the alerts. Once armed the chart shows `DRAW ARMED` with a `STOP` button. Hold the chart again to draw a new one.

## Key level confirmations (M5)
Inside the M5 key level POI box (the H1 box when there is no M5 order block) the bot waits for one of: bullish / bearish harami, bullish / bearish engulf, morning star (buys) or evening star (sells). A breakout out of the box is no longer a confirmation. The Telegram alert names it on the first line, e.g. `🟢 KEY LEVEL · BULLISH HARAMI` or `🔴 KEY LEVEL · EVENING STAR`, and so does the tag on the chart image.
- Harami: the confirming candle's body sits inside the body of the opposite candle before it.
- Engulf: its body covers the body of the opposite candle before it.
- Star: a long candle, a small body (at most half of it, at its far end, touching the box), then a candle of the other colour that closes beyond the middle of the first body.
The 50% POI / bjeff zone and QML confirmations are unchanged.

## Chart look (TradingView style)
Black canvas (`#000000`), faint grid at round prices and round times, teal `#089981` / red `#F23645` candles with wicks in the body colour, a time axis along the bottom (hours, bold day numbers at midnight, month name on the 1st; in your local time), price numbers on the right edge (hidden where a label or zone sits), and the last price as a filled tag in the colour of the live candle. The Telegram alert charts use the same palette.

### Candle time and prices (like MT5)
Tap a candle on the chart (or hover it with a mouse) to see a crosshair: the candle's open time on the time axis (`2026.11.24 12:00`, your local time), the price under your finger on the right edge, and an `O H L C` line at the bottom left. Tap another candle to move it, tap the same candle (or an empty spot) to hide it. Pressing and holding still starts a price alert / position box / drawing tools instead.
