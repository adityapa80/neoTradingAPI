# Neo Terminal

A modern trading web interface for Kotak Securities, built on the [Kotak Neo Trade API](https://www.kotakneo.com/platform/kotak-neo-trade-api/).
It is a port of Kite Terminal (the Zerodha version): the same screens, one-click orders and chart TP/SL,
talking to Kotak Neo instead of Kite Connect.

- **Real-time prices**: Kotak's market-data WebSocket is streamed to the browser (watchlist, option chain, depth, P&L, candles). Fills arrive instantly through Kotak's order-update WebSocket. A **LIVE** badge shows the feed status
- **Watchlists**: 5 lists, tick-by-tick prices with flashes, inline market depth, instrument search across NSE/BSE/NFO/BFO
- **Order window**: Buy/Sell toggle, Regular/AMO, MIS/CNC/NRML, Market/Limit/SL/SL-M, lots for F&O, live margin requirement, click-to-fill depth, optional confirmation step. A regular DAY **buy limit above the last price** is sent as a stop-limit (trigger = limit = your price), so it waits for the price to rise to it instead of filling at once at market
- **Orders**: pending, executed, and trades, with modify, cancel, and repeat; toasts when orders fill or get rejected
- **Positions and holdings**: live P&L, one-click exit, allocation breakdown, sortable columns
- **Charts**: candlesticks and volume (TradingView Lightweight Charts) from 1m to 1D, updating live, with drawing tools (trend and horizontal lines) saved per instrument
- **One or two charts**, **trades on the chart** (entry line with live P&L, fill markers)
- **TP / SL on the chart, live**: **+ TP** / **+ SL** on the entry line places the order at once; drag to modify, ✕ to cancel (with Undo)
- **Multi-lot TP / SL (F&O, 2+ lots)**: different exits for different lots (e.g. TP 1 lot @ x and 2 lots @ y, SL 3 lots @ z), with **− / +**, **+ TP 1L** and **Split**
- **Option chain**: NIFTY, BANK NIFTY and SENSEX, expiry picker, ATM, OI bars, PCR, one-click **B / S** for 1 lot
- **Lot-based F&O trading**, **quick partial booking** (1 lot / 25% / 50% / All), **Exit all F&O**, dashboard, dark/light themes and keyboard control (press `?`)

## Architecture

```
browser (static/*)  ──►  Flask (app.py) on 127.0.0.1  ──►  Kotak Neo REST (orders, portfolio, quotes, scrip master)
        ▲                       │
        └──── SSE (stream.py) ◄─┼──────────  market-data WebSocket (binary ticks: LTP/OHLC/OI/depth)
                                └──────────  order WebSocket /realtime (order + position updates)
```

`neo.py` talks to Kotak Neo and returns data in the same shape the UI was built for, so `app.py`,
`protect.py` and the browser code stay broker-neutral. Instruments are identified internally by a synthetic
token, `segment_id × 10⁹ + pSymbol`, because Kotak's `pSymbol` is only unique within one exchange segment.

The access token, session token and MPIN stay in the Python process and never reach the browser. The server
binds to localhost only. State-changing requests must carry an `X-Requested-With` header, which blocks
simple cross-site request forgery.

## Setup

1. In the Kotak Neo app: **More → Trade API**, create an application and copy its **access token**.
   Register **TOTP** (API dashboard → TOTP registration) with Google/Microsoft Authenticator, and register
   your **static IP** (Kotak requires it for API orders).
2. Install dependencies and configure:
   ```bash
   pip install -r requirements.txt
   copy .env.example .env      # then fill in NEO_ACCESS_TOKEN, NEO_MOBILE and NEO_UCC
   ```
3. Run it and open <http://127.0.0.1:5001>:
   ```bash
   python app.py
   ```
4. Log in with the 6-digit code from your authenticator app and your MPIN (or set `NEO_MPIN` in `.env` to type
   only the code). The session is cached in `data/session.json` for the rest of the day.

### Demo mode (no account needed)

```bash
set NEO_MOCK=1 && python app.py
```

Demo mode uses simulated prices, orders, positions and holdings. Nothing is sent to Kotak.

## How TP / SL is placed

Kotak Neo has **no GTT**, and bracket/cover orders were discontinued on the Trade API on 1 April 2026. So
every product (MIS, NRML, CNC, MTF) uses the mechanism the Kite version used for MIS:

- Each TP is a resting **LIMIT** exit order and each SL a resting **SL** (stop-limit) exit order, both at the
  exchange. The watcher in `protect.py` links each pair as an OCO: when one fills, it cancels the other. It
  reacts instantly to the order WebSocket and also sweeps every 3 seconds.
- **If the app goes down**, the stop is still a real exchange order, so the downside stays protected. Only
  the "cancel the other leg" step waits until the app is back. Don't leave the server stopped while TP/SL
  pairs are open.
- **Multiple lots**: TP and SL lines are paired lot by lot into *tranches* (nearest target with farthest
  stop), each tranche its own OCO pair. With TP 1L @ x, TP 2L @ y and SL 3L @ z, hitting x exits 1 lot and
  leaves an OCO covering exactly the remaining 2 lots. If the position shrinks some other way, the lines
  farthest from the market are trimmed first.
- **SL limit buffer**: SL legs use a limit 1% beyond the trigger (`SL_LIMIT_BUFFER` in `protect.py`) so they
  fill on gaps.
- **Records**: TP/SL records are stored in `data/protections.json`, chart drawings in `data/drawings.json`.

**Margin check (do this once, with 1 lot):** both exit legs rest at the exchange at the same time. On your
first live trade, confirm that Kotak accepts a TP and an SL on the same lots without blocking extra margin.

## Notes and things to verify on the first live session

- **Order tags**: Kotak's order book doesn't return order tags, so the app remembers which orders are its TP/SL
  legs in `data/order_tags.json` (per day).
- **Modify**: Kotak may give a modified order a new order number. The app follows the number Kotak returns.
- **Market orders**: Kotak converts market orders into protected limit orders on its side.
- **Historical candles**: Kotak limits the range per request (30 days for 1–5 min, 60 for 10–15 min, 90 for
  30–60 min, 180 for daily). The app fetches up to 4 windows back. Expired contracts have no history.
- **Market-data feed**: one connection, up to 3000 instruments; indices are subscribed by name (`Nifty 50`,
  `Nifty Bank`, `SENSEX`). If the feed drops, the badge shows **POLLING** and the app polls REST quotes.
- **Instrument search** downloads Kotak's scrip master once per day for each exchange in `NEO_EXCHANGES`,
  converts it, and caches it in `data/`. The first search of the day takes a few seconds.
- **Lot sizes**: `NEO_LOT_SIZES` (default `NIFTY:65,SENSEX:20`) overrides the scrip master for those
  underlyings; the app warns on startup if Kotak's master differs.

## Files

| File | Purpose |
| --- | --- |
| `app.py` | Flask server: TOTP login, REST proxy, instrument search, session persistence |
| `neo.py` | Kotak Neo client (maps Neo data to the app's shape), scrip-master converter, demo-mode mock |
| `stream.py` | Market-data feed decoder, order-update feed, SSE fan-out to browsers |
| `protect.py` | TP/SL engine: tranches, OCO linking, resize on partial exits |
| `static/index.html`, `style.css`, `app.js` | The UI (vanilla JS, no build step) |
