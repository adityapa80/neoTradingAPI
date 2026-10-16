"""Kotak Neo Trade API client, plus an offline mock for demo mode.

The rest of the app was written against Kite-shaped data (orders, positions,
quotes, instrument CSV). This client speaks Kotak Neo's REST API and returns
data in that same shape, so app.py, protect.py and the browser UI stay
broker-neutral. Neo-specific details live here:

* Login is TOTP + MPIN (no browser redirect). It yields a trade token, a
  session id and a per-account base URL used for every later call.
* Request bodies are a JSON string in a form field named ``jData``.
* Instruments are identified by (exchange segment, pSymbol). pSymbol is only
  unique within a segment, so the app uses a synthetic numeric token:
  ``segment_id * 1e9 + pSymbol`` (segment ids match the market-data feed).
* There is no GTT: every TP/SL is an app-managed OCO pair (see protect.py).
"""
import csv
import functools
import io
import itertools
import json
import math
import random
import re
import threading
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import logging

import requests

log = logging.getLogger("neo")

LOGIN_ROOT = "https://mis.kotaksecurities.com/login/1.0"
CONFIG_SERVICE_URL = "https://lapi.kotaksecurities.com/5config/config"
DEFAULT_FEED_URL = "wss://sfeed.kotaksecurities.com/apifeed"
NEO_FIN_KEY = "neotradeapi"
ORDER_SOURCE = "NEOTRADEAPI"
IST = timezone(timedelta(hours=5, minutes=30))

# App exchange code <-> Neo exchange segment <-> feed enum (used in synthetic tokens).
EXCH_TO_SEG = {"NSE": "nse_cm", "BSE": "bse_cm", "NFO": "nse_fo", "BFO": "bse_fo", "MCX": "mcx_fo"}
SEG_TO_EXCH = {v: k for k, v in EXCH_TO_SEG.items()}
SEG_ID = {"nse_cm": 1, "nse_fo": 2, "cde_fo": 3, "nse_com": 4, "bse_cm": 5, "bse_fo": 6, "mcx_fo": 9}
ID_TO_SEG = {v: k for k, v in SEG_ID.items()}
TOKEN_BASE = 1_000_000_000

# Indices in the scrip master: (segment, pSymbol) -> (app tradingsymbol, name Neo's quotes/feed expect).
INDEX_NAMES = {
    ("nse_cm", "26000"): ("NIFTY 50", "Nifty 50"),
    ("nse_cm", "26009"): ("NIFTY BANK", "Nifty Bank"),
    ("nse_cm", "26037"): ("NIFTY FIN SERVICE", "Nifty Fin Service"),
    ("nse_cm", "26074"): ("NIFTY MID SELECT", "NIFTY MID SELECT"),
    ("bse_cm", "1"): ("SENSEX", "SENSEX"),
    ("bse_cm", "12"): ("BANKEX", "BANKEX"),
    ("bse_cm", "47"): ("SENSEX50", "SNSX50"),
}
INDEX_BY_FEED_NAME = {(seg, names[1].lower()): psym for (seg, psym), names in INDEX_NAMES.items()}
INDEX_BY_FEED_NAME.update({(seg, names[0].lower()): psym for (seg, psym), names in INDEX_NAMES.items()})

ORDER_TYPES = {"LIMIT": "L", "MARKET": "MKT", "SL": "SL", "SL-M": "SL-M"}
ORDER_TYPES_BACK = {v: k for k, v in ORDER_TYPES.items()}
ORDER_TYPES_BACK.update({"LMT": "LIMIT", "SLM": "SL-M"})
SIDES = {"BUY": "B", "SELL": "S"}
SIDES_BACK = {"B": "BUY", "S": "SELL"}
# Neo reports a modified-but-still-working order as "modified"; it is live, like OPEN.
STATUS_MAP = {"modified": "OPEN", "after market order req received": "AMO REQ RECEIVED",
              "complete": "COMPLETE", "traded": "COMPLETE"}
# Neo interval name and max days per historical request.
HIST_INTERVALS = {"minute": ("1min", 30), "3minute": ("3min", 30), "5minute": ("5min", 30),
                  "10minute": ("10min", 60), "15minute": ("15min", 60), "30minute": ("30min", 90),
                  "60minute": ("60min", 90), "day": ("D", 180)}
HIST_MAX_CALLS = 4
# Kotak's positions call takes 0.5-1+ s. The TP/SL engine reuses a recent copy: positions only
# change on a fill, and every fill arrives on the order feed, which drops the copy at once.
POS_TTL_FEED_LIVE = 10  # seconds a copy may be reused while the order feed is connected
POS_TTL_NO_FEED = 2     # ... and while it isn't (fills could then go unnoticed for a moment)
# Kotak answers an empty order book, trade book or holdings with an error instead of [].
NO_DATA_CODES = {5203}
NO_DATA_TEXT = re.compile(r"no data|data not found|no (holdings|orders|trades|positions|records?)\b", re.I)


class NeoError(Exception):
    def __init__(self, message, error_type="GeneralException", status=500):
        super().__init__(message)
        self.message = message
        self.error_type = error_type
        self.status = status


def make_token(seg, psymbol):
    return SEG_ID[seg] * TOKEN_BASE + int(psymbol)


def split_token(token):
    seg_id, psym = divmod(int(token), TOKEN_BASE)
    return ID_TO_SEG.get(seg_id), str(psym)


def neo_symbol(token):
    """'segment|pSymbol' (or 'segment|Index Name' for indices), as quotes and the feed want."""
    seg, psym = split_token(token)
    idx = INDEX_NAMES.get((seg, psym))
    return f"{seg}|{idx[1] if idx else psym}"


def is_index_token(token):
    return split_token(token) in INDEX_NAMES


def _num(value, default=0.0):
    if value in (None, "", "--", "NA"):
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _ts(value, fmt="%d-%b-%Y %H:%M:%S"):
    """Neo's '22-Jan-2025 14:28:01' -> '2025-01-22 14:28:01'."""
    if not value or not value.strip() or value in ("NA", "--"):
        return None
    try:
        return datetime.strptime(value.strip(), fmt).strftime("%Y-%m-%d %H:%M:%S")
    except ValueError:
        return value


def _price(value):
    return f"{float(value or 0):.2f}"


def _token_of(seg, psym):
    return make_token(seg, psym) if seg in SEG_ID and str(psym or "").isdigit() else 0


class NeoClient:
    def __init__(self, consumer_key, mobile, ucc, timeout=10, tags_file=None):
        self.consumer_key = consumer_key
        mobile = (mobile or "").strip()
        self.mobile = mobile if mobile.startswith("+") or not mobile else f"+91{mobile[-10:]}"
        self.ucc = ucc
        self.timeout = timeout
        self.access_token = None  # trade token; None = logged out
        self.sid = None
        self.base_url = None
        self.feed_url = None
        self.order_feed_url = None
        self.greeting = None
        self.lookup = lambda key: None          # "EXCH:SYMBOL" -> instrument dict (set by app.py)
        self.token_to_key = lambda token: None  # synthetic token -> "EXCH:SYMBOL" (set by app.py)
        self.live_price = lambda key: None      # fresh LTP from the market feed, if any (set by app.py)
        self.order_feed_live = False            # set by the stream while the order feed is connected
        self._pos_cache = None                  # (monotonic time, positions())
        self._pos_gen = 0                       # bumped on every fill notice
        self.http = requests.Session()
        # Browser polling, the TP/SL watcher and order events call Neo from many threads at once.
        self.http.mount("https://", requests.adapters.HTTPAdapter(pool_connections=4, pool_maxsize=32))
        # Neo's order book has no tag field; remember the tags of orders placed here.
        self.tags_file = tags_file
        self._tags_lock = threading.Lock()
        self._tags = self._load_tags()

    # ---- session --------------------------------------------------------
    def login(self, totp, mpin):
        if not (self.consumer_key and self.mobile and self.ucc):
            raise NeoError("Set NEO_ACCESS_TOKEN, NEO_MOBILE and NEO_UCC in .env", "InputException", 400)
        headers = {"Authorization": self.consumer_key, "neo-fin-key": NEO_FIN_KEY,
                   "Content-Type": "application/json"}
        view = self._login_call(f"{LOGIN_ROOT}/tradeApiLogin", headers,
                                {"mobileNumber": self.mobile, "ucc": self.ucc, "totp": str(totp).strip()})
        trade = self._login_call(f"{LOGIN_ROOT}/tradeApiValidate",
                                 {**headers, "sid": view["sid"], "Auth": view["token"]},
                                 {"mpin": str(mpin).strip()})
        if not trade.get("baseUrl"):
            raise NeoError("Login response had no baseUrl", "LoginException", 502)
        self.sid, self.base_url = trade["sid"], trade["baseUrl"].rstrip("/")
        self.greeting = trade.get("greetingName")
        feed, orders = self._resolve_feed_urls(trade.get("dataCenter"))
        # Kotak hands these out as https:// URLs; the WebSocket client needs wss://.
        self.feed_url = _wss(feed or trade.get("feedUrl")) or DEFAULT_FEED_URL
        self.order_feed_url = _wss(orders or trade.get("rtUrl")) or _realtime_url(self.base_url)
        self.access_token = trade["token"]  # last: the stream threads start on this
        return self.session_data()

    def _login_call(self, url, headers, body):
        try:
            resp = self.http.post(url, headers=headers, json=body, timeout=self.timeout)
        except requests.RequestException as exc:
            raise NeoError(f"Network error talking to Kotak: {exc}", "NetworkException", 502)
        try:
            payload = resp.json()
        except ValueError:
            raise NeoError(f"Unexpected login response (HTTP {resp.status_code})", "LoginException", 502)
        data = payload.get("data") if isinstance(payload, dict) else None
        if resp.status_code >= 400 or not isinstance(data, dict) or not data.get("token"):
            msg = None
            if isinstance(payload, dict):
                msg = payload.get("message") or payload.get("emsg") or payload.get("errMsg")
            raise NeoError(msg or f"Login failed (HTTP {resp.status_code})", "LoginException",
                           401 if resp.status_code in (401, 403) else 400)
        return data

    def _resolve_feed_urls(self, data_center):
        """Kotak's config service names the market-data and order-feed sockets for the
        account's data center. Best effort, like the official SDK: None on any failure."""
        if not data_center:
            return None, None
        try:
            resp = self.http.get(CONFIG_SERVICE_URL, timeout=5,
                                 params={"appVersion": "2.0.0", "platform": "api", "environment": "prod"})
            configs = (resp.json().get("data") or {}).get("configs") or {}
            source = configs.get(f"{data_center}_broadcast_source")
            if source:
                return (configs.get(f"{data_center}_{source}_broadcast_endpoint"),
                        configs.get(f"{data_center}_{source}_interactive_endpoint"))
        except Exception:  # noqa: BLE001 - optional lookup
            pass
        return None, None

    def session_data(self):
        return {"access_token": self.access_token, "sid": self.sid, "base_url": self.base_url,
                "feed_url": self.feed_url, "order_feed_url": self.order_feed_url, "greeting": self.greeting}

    def restore(self, data):
        self.sid, self.base_url = data.get("sid"), data.get("base_url")
        self.feed_url = _wss(data.get("feed_url")) or DEFAULT_FEED_URL
        self.order_feed_url = _wss(data.get("order_feed_url")) or (
            _realtime_url(self.base_url) if self.base_url else None)
        self.greeting = data.get("greeting")
        if self.sid and self.base_url:
            self.access_token = data.get("access_token")

    def invalidate_session(self):
        if self.access_token:
            try:
                self._request("POST", "/apim/login/2.0/logout")
            except NeoError:
                pass  # the token is dropped locally either way
        self.access_token = None

    # ---- plumbing -------------------------------------------------------
    def _headers(self, kind):
        if kind == "consumer":  # quotes, scrip master, historical: dashboard token only
            return {"Authorization": self.consumer_key, "accept": "application/json"}
        return {"accept": "application/json", "Authorization": self.consumer_key, "Sid": self.sid or "",
                "Auth": self.access_token or "", "neo-fin-key": NEO_FIN_KEY}

    def _request(self, method, path, jdata=None, params=None, kind="session"):
        if not self.access_token:
            raise NeoError("Not logged in", "TokenException", 403)
        data = {"jData": json.dumps(jdata)} if jdata is not None else None
        for attempt in range(2):
            try:
                resp = self.http.request(method, self.base_url + path, params=params, data=data,
                                         headers=self._headers(kind), timeout=self.timeout)
            except requests.RequestException as exc:
                raise NeoError(f"Network error talking to Kotak: {exc}", "NetworkException", 502)
            if resp.status_code != 429 or attempt:
                break
            time.sleep(1)  # rate limited; retry once
        try:
            body = resp.json()
        except ValueError:
            raise NeoError(f"Unexpected response from Kotak (HTTP {resp.status_code})", "DataException", 502)
        if isinstance(body, dict):
            fault = body.get("fault") if isinstance(body.get("fault"), dict) else {}
            failed = (resp.status_code >= 400 or str(body.get("stat", "")).lower() == "not_ok"
                      or str(body.get("status", "")).lower() == "error")
            if failed:
                errs = body.get("error") if isinstance(body.get("error"), list) else []
                first = errs[0] if errs and isinstance(errs[0], dict) else {}
                msg = (body.get("emsg") or body.get("errMsg") or fault.get("message") or body.get("message")
                       or first.get("message") or f"Kotak error (HTTP {resp.status_code})")
                low = str(msg).lower()
                if body.get("stCode") in NO_DATA_CODES or NO_DATA_TEXT.search(f"{msg} {body.get('desc', '')}"):
                    raise NeoError(msg, "NoData", 404)
                if resp.status_code in (401, 403) or "session" in low or "invalid token" in low \
                        or "unauthori" in low or "jwt" in low:
                    raise NeoError(msg, "TokenException", 403)
                if "/order/" in path:  # refused orders: keep Kotak's full reply and what was sent
                    log.warning("Kotak refused %s %s (HTTP %s): %s | sent: %s", method, path, resp.status_code,
                                json.dumps(body)[:800], json.dumps(jdata)[:800])
                code = body.get("stCode") or body.get("code") or first.get("code")
                if code and str(code) not in str(msg):
                    msg = f"{msg} (Kotak code {code})"
                raise NeoError(msg, "InputException" if resp.status_code < 500 else "GeneralException",
                               resp.status_code if resp.status_code >= 400 else 400)
        return body

    def _inst(self, exchange, symbol):
        inst = self.lookup(f"{exchange}:{symbol}")
        if not inst:
            raise NeoError(f"Unknown instrument {exchange}:{symbol}", "InputException", 400)
        return inst

    def _key_for(self, seg, psym, fallback_symbol=""):
        token = _token_of(seg, psym)
        key = self.token_to_key(token) if token else None
        return key or f"{SEG_TO_EXCH.get(seg, seg)}:{fallback_symbol}"

    # ---- tags -----------------------------------------------------------
    def _load_tags(self):
        if self.tags_file and Path(self.tags_file).exists():
            try:
                saved = json.loads(Path(self.tags_file).read_text())
                if saved.get("date") == date.today().isoformat():
                    return saved.get("tags", {})
            except (ValueError, OSError):
                pass
        return {}

    def _remember_tag(self, order_id, tag, old_id=None):
        with self._tags_lock:
            tag = tag or (self._tags.get(old_id) if old_id else None)
            if not tag or not order_id or self._tags.get(order_id) == tag:
                return
            self._tags[order_id] = tag
            if self.tags_file:
                Path(self.tags_file).write_text(json.dumps({"date": date.today().isoformat(), "tags": self._tags}))

    # ---- user / portfolio ----------------------------------------------
    def profile(self):
        name = self.greeting or self.ucc
        return {"user_id": self.ucc, "user_name": name, "user_shortname": (name or "").split(" ")[0],
                "email": "", "broker": "KOTAK NEO", "exchanges": ["NSE", "BSE", "NFO", "BFO"],
                "products": ["CNC", "MIS", "NRML", "MTF"]}

    def margins(self):
        b = self._request("POST", "/quick/user/limits", {"seg": "ALL", "exch": "ALL", "prod": "ALL"})
        net, used = _num(b.get("Net")), _num(b.get("MarginUsed"))
        opening = next((_num(b[k]) for k in ("OpeningBalance", "CashOpeningBalance") if k in b), net + used)
        equity = {"enabled": True, "net": round(net, 2),
                  "available": {"cash": _num(b.get("NotionalCash")), "live_balance": round(net, 2),
                                "opening_balance": round(opening, 2), "collateral": _num(b.get("CollateralValue")),
                                "intraday_payin": 0},
                  "utilised": {"debits": round(used, 2), "span": _num(b.get("SpanMarginPrsnt")),
                               "exposure": _num(b.get("ExposureMarginPrsnt")),
                               "option_premium": _num(b.get("PremiumPrsnt"))}}
        commodity = {"enabled": False, "net": 0, "available": {"cash": 0, "live_balance": 0, "opening_balance": 0,
                                                             "collateral": 0, "intraday_payin": 0},
                     "utilised": {"debits": 0}}
        return {"equity": equity, "commodity": commodity}

    def _rows(self, method, path, jdata=None):
        """The 'data' list of a book/report endpoint; [] when Kotak says there is nothing."""
        try:
            body = self._request(method, path, jdata)
        except NeoError as exc:
            if exc.error_type == "NoData":
                return []
            raise
        rows = body.get("data") if isinstance(body, dict) else None
        return rows if isinstance(rows, list) else []

    def holdings(self):
        rows = self._rows("GET", "/portfolio/v1/holdings")
        out = []
        for h in rows:
            seg = h.get("exchangeSegment") or "nse_cm"
            key = self._key_for(seg, h.get("exchangeIdentifier"), f"{h.get('symbol')}-{h.get('series') or 'EQ'}")
            qty = int(_num(h.get("quantity")))
            sellable = int(_num(h.get("sellableQuantity"), qty))
            exch, sym = key.split(":", 1)
            out.append({"key": key, "tradingsymbol": sym, "exchange": exch,
                        "instrument_token": _token_of(seg, h.get("exchangeIdentifier")),
                        "product": "CNC", "quantity": qty, "t1_quantity": 0,
                        "used_quantity": max(0, qty - sellable), "average_price": _num(h.get("averagePrice")),
                        "close_price": _num(h.get("closingPrice"))})
        prices = self._ltps([h["key"] for h in out])
        for h in out:
            ltp = prices.get(h.pop("key")) or h["close_price"]
            close = h["close_price"] or ltp
            h.update(last_price=ltp, pnl=round((ltp - h["average_price"]) * h["quantity"], 2),
                     day_change=round(ltp - close, 2),
                     day_change_percentage=round((ltp - close) / close * 100, 2) if close else 0)
        return out

    def invalidate_positions(self):
        self._pos_gen += 1
        self._pos_cache = None

    def positions_cached(self):
        """positions(), reusing a copy that no fill can have changed (see POS_TTL_*)."""
        cached = self._pos_cache
        ttl = POS_TTL_FEED_LIVE if self.order_feed_live else POS_TTL_NO_FEED
        if cached and time.monotonic() - cached[0] < ttl:
            return cached[1]
        return self.positions()

    def positions(self):
        gen, started = self._pos_gen, time.monotonic()
        out = self._fetch_positions()
        if gen == self._pos_gen:  # no fill arrived while asking: safe to reuse
            self._pos_cache = (started, out)
        return out

    def _fetch_positions(self):
        try:
            rows = self._rows("GET", "/portfolio/v2/positions")
        except NeoError as exc:
            if exc.error_type == "TokenException":
                raise
            rows = self._rows("GET", "/quick/user/positions")
        out, missing = [], []
        for p in rows:
            seg = p.get("exSeg", "")
            key = self._key_for(seg, p.get("tok"), p.get("trdSym", ""))
            buy_q = _num(p.get("flBuyQty")) + _num(p.get("cfBuyQty"))
            sell_q = _num(p.get("flSellQty")) + _num(p.get("cfSellQty"))
            buy_amt = _num(p.get("buyAmt")) + _num(p.get("cfBuyAmt"))
            sell_amt = _num(p.get("sellAmt")) + _num(p.get("cfSellAmt"))
            nf = ((_num(p.get("multiplier"), 1) or 1) * (_num(p.get("genNum"), 1) or 1) / (_num(p.get("genDen"), 1) or 1)
                  * (_num(p.get("prcNum"), 1) or 1) / (_num(p.get("prcDen"), 1) or 1)) or 1
            qty = int(buy_q - sell_q)
            avg = (buy_amt / (buy_q * nf) if qty > 0 and buy_q else
                   sell_amt / (sell_q * nf) if qty < 0 and sell_q else 0)
            exch, sym = key.split(":", 1)
            row = {"key": key, "tradingsymbol": sym, "exchange": exch, "product": p.get("prod"), "quantity": qty,
                   "instrument_token": _token_of(seg, p.get("tok")),
                   "average_price": round(avg, 2), "multiplier": nf, "close_price": 0,
                   "buy_value": round(buy_amt, 2), "sell_value": round(sell_amt, 2),
                   "buy_quantity": int(buy_q), "sell_quantity": int(sell_q), "_ltp": _num(p.get("ltp"))}
            if not row["_ltp"] and qty:
                missing.append(key)
            out.append(row)
        prices = self._ltps(missing)
        for r in out:
            ltp = r.pop("_ltp") or prices.get(r.pop("key")) or r["average_price"]
            r.pop("key", None)
            pnl = r["sell_value"] - r["buy_value"] + r["quantity"] * ltp * r["multiplier"]
            r.update(last_price=ltp, pnl=round(pnl, 2), m2m=round(pnl, 2))
        return {"net": out, "day": out}

    # ---- orders ---------------------------------------------------------
    def _order(self, o):
        seg = o.get("exSeg", "")
        key = self._key_for(seg, o.get("tok"), o.get("trdSym", ""))
        status = str(o.get("ordSt") or o.get("stat") or "").strip().lower()
        qty = int(_num(o.get("qty")))
        filled = int(_num(o.get("fldQty")))
        reason = o.get("rejRsn")
        exch, sym = key.split(":", 1)
        return {"order_id": o.get("nOrdNo"), "exchange_order_id": o.get("exOrdId"),
                "variety": "amo" if str(o.get("ordGenTp", "")).upper() == "AMO" else "regular",
                "status": STATUS_MAP.get(status, status.upper()), "exchange": exch, "tradingsymbol": sym,
                "instrument_token": _token_of(seg, o.get("tok")),
                "transaction_type": SIDES_BACK.get(o.get("trnsTp"), o.get("trnsTp")),
                "order_type": ORDER_TYPES_BACK.get(o.get("prcTp"), o.get("prcTp")),
                "product": o.get("prod"), "validity": o.get("vldt") or o.get("ordDur") or "DAY",
                "quantity": qty, "filled_quantity": filled,
                "pending_quantity": int(_num(o.get("unFldSz"), max(qty - filled, 0))),
                "disclosed_quantity": int(_num(o.get("dscQty"))),
                "price": _num(o.get("prc")), "trigger_price": _num(o.get("trgPrc")),
                "average_price": _num(o.get("avgPrc")), "tag": self._tags.get(o.get("nOrdNo")),
                "status_message": None if reason in (None, "", "--", "NA") else reason,
                "order_timestamp": _ts(o.get("ordDtTm") or o.get("flDtTm")),
                "exchange_timestamp": _ts(o.get("exCfmTm")), "_raw": o}

    def _orders_raw(self):
        out = [self._order(o) for o in self._rows("GET", "/quick/user/orders")]
        self._order_cache = {o["order_id"]: o for o in out}
        return out

    def orders(self):
        return [{k: v for k, v in o.items() if k != "_raw"} for o in self._orders_raw()]

    def trades(self):
        out = []
        for t in self._rows("GET", "/quick/user/trades"):
            seg = t.get("exSeg", "")
            exch, sym = self._key_for(seg, t.get("tok"), t.get("trdSym", "")).split(":", 1)
            out.append({"trade_id": t.get("flId") or t.get("exTrdId") or t.get("exOrdId"),
                        "order_id": t.get("nOrdNo"), "exchange": exch, "tradingsymbol": sym,
                        "transaction_type": SIDES_BACK.get(t.get("trnsTp"), t.get("trnsTp")),
                        "product": t.get("prod"), "quantity": int(_num(t.get("fldQty") or t.get("qty"))),
                        "average_price": _num(t.get("avgPrc")),
                        "fill_timestamp": _ts(t.get("exTm")) or _ts(f"{t.get('flDt', '')} {t.get('flTm', '')}")})
        return out

    def order_history(self, order_id):
        rows = self._rows("POST", "/quick/order/history", {"nOrdNo": order_id})
        out = [{k: v for k, v in self._order(o).items() if k != "_raw"} for o in rows]
        if len(out) > 1 and (out[0]["order_timestamp"] or "") > (out[-1]["order_timestamp"] or ""):
            out.reverse()  # oldest first
        return out

    def place_order(self, variety, params):
        if variety not in ("regular", "amo"):
            raise NeoError(f"'{variety}' orders are not supported on Kotak Neo", "InputException", 400)
        exch, sym = params["exchange"], params["tradingsymbol"]
        if exch not in EXCH_TO_SEG:
            raise NeoError(f"Exchange {exch} is not supported", "InputException", 400)
        inst = self._inst(exch, sym)
        if inst.get("segment") == "INDICES":
            raise NeoError("Indices are not tradable", "InputException", 400)
        pt = ORDER_TYPES.get(params.get("order_type"))
        if not pt:
            raise NeoError(f"Order type {params.get('order_type')} is not supported", "InputException", 400)
        validity = params.get("validity") or "DAY"
        if validity not in ("DAY", "IOC"):
            raise NeoError(f"Validity {validity} is not supported on Kotak Neo", "InputException", 400)
        body = {"am": "YES" if variety == "amo" else "NO", "dq": str(int(_num(params.get("disclosed_quantity")))),
                "es": EXCH_TO_SEG[exch], "mp": "0", "pc": params["product"], "pf": "N",
                "pr": "0" if pt in ("MKT", "SL-M") else _price(params.get("price")),
                "pt": pt, "qt": str(int(params["quantity"])), "rt": validity,
                "tp": _price(params.get("trigger_price")) if pt in ("SL", "SL-M") else "0",
                "ts": sym, "tt": SIDES[params["transaction_type"]], "os": ORDER_SOURCE}
        # No "ig" (order tag) is sent: Kotak's order book doesn't return it and the app keeps its own
        # record of which orders are TP/SL legs, so it only adds a field Kotak might refuse.
        res = self._request("POST", "/quick/order/rule/ms/place", body)
        order_id = res.get("nOrdNo")
        if not order_id:
            raise NeoError(res.get("emsg") or "Order was not accepted", "OrderException", 400)
        self._remember_tag(order_id, params.get("tag"))
        return {"order_id": order_id}

    def modify_order(self, variety, order_id, params):
        o = getattr(self, "_order_cache", {}).get(order_id)
        if not o or o["status"] not in ("OPEN", "TRIGGER PENDING"):  # unknown or maybe stale: refresh
            o = next((x for x in self._orders_raw() if x["order_id"] == order_id), None)
        if not o:
            raise NeoError("Order not found", "InputException", 400)
        raw = o["_raw"]
        otype = params.get("order_type") or o["order_type"]
        pt = ORDER_TYPES.get(otype)
        if not pt:
            raise NeoError(f"Order type {otype} is not supported", "InputException", 400)
        price = params.get("price", o["price"])
        trigger = params.get("trigger_price", o["trigger_price"])
        body = {"tk": str(raw.get("tok", "")), "mp": "0", "pc": o["product"], "dd": "NA",
                "dq": str(int(_num(params.get("disclosed_quantity"), o["disclosed_quantity"]))),
                "vd": params.get("validity") or o["validity"], "ts": raw.get("trdSym"),
                "tt": SIDES[o["transaction_type"]], "pr": "0" if pt in ("MKT", "SL-M") else _price(price),
                "tp": _price(trigger) if pt in ("SL", "SL-M") else "0",
                "qt": str(int(params.get("quantity") or o["quantity"])), "fq": str(o["filled_quantity"]),
                "no": order_id, "es": raw.get("exSeg"), "pt": pt, "am": "YES" if o["variety"] == "amo" else "NO",
                "os": ORDER_SOURCE}
        res = self._request("POST", "/quick/order/vr/modify", body)
        new_id = res.get("nOrdNo") or order_id  # Neo may hand back a new order number
        self._remember_tag(new_id, None, old_id=order_id)
        return {"order_id": new_id}

    def cancel_order(self, variety, order_id):
        body = {"on": order_id, "am": "NO"}
        if variety == "amo":
            o = next((x for x in self._orders_raw() if x["order_id"] == order_id), None)
            body = {"on": order_id, "am": "YES", "ts": o["_raw"].get("trdSym") if o else ""}
        res = self._request("POST", "/quick/order/cancel", body)
        return {"order_id": res.get("nOrdNo") or order_id}

    def order_margins(self, orders):
        out = []
        for o in orders:
            inst = self._inst(o["exchange"], o["tradingsymbol"])
            seg, psym = split_token(inst["instrument_token"])
            pt = ORDER_TYPES.get(o.get("order_type"), "L")
            body = {"brkName": "KOTAK", "brnchId": "ONLINE", "exSeg": seg,
                    "prc": "0" if pt in ("MKT", "SL-M") else _price(o.get("price")), "prcTp": pt,
                    "prod": o.get("product"), "qty": str(int(o["quantity"])), "tok": psym,
                    "trnsTp": SIDES.get(o.get("transaction_type"), "B")}
            if pt in ("SL", "SL-M"):
                body["trgPrc"] = _price(o.get("trigger_price"))
            res = self._request("POST", "/quick/user/check-margin", body)
            out.append({"total": _num(res.get("ordMrgn") or res.get("reqdMrgn"))})
        return out

    # ---- market data ----------------------------------------------------
    def _quote_rows(self, keys, kind):
        """Fetch Neo quotes for app keys; returns {key: raw quote row}."""
        refs = {}
        for key in dict.fromkeys(keys):
            inst = self.lookup(key)
            if inst and inst.get("instrument_token"):
                refs[key] = neo_symbol(inst["instrument_token"])
        out = {}
        items = list(refs.items())
        for i in range(0, len(items), 50):
            chunk = items[i:i + 50]
            path = ("/script-details/1.0/quotes/neosymbol/"
                    + requests.utils.quote(",".join(ref for _, ref in chunk), safe="|,") + f"/{kind}")
            rows = self._request("GET", path, kind="consumer")
            rows = rows if isinstance(rows, list) else rows.get("data") or []
            by_ref = {f"{r.get('exchange')}|{r.get('exchange_token')}".lower(): r for r in rows if isinstance(r, dict)}
            for n, (key, ref) in enumerate(chunk):
                row = by_ref.get(ref.lower())
                if row is None and len(rows) == len(chunk):
                    row = rows[n]  # index names can come back cased differently; fall back on order
                if isinstance(row, dict):
                    out[key] = row
        return out

    def _ltps(self, keys):
        if not keys:
            return {}
        try:
            return {k: _num(r.get("ltp")) for k, r in self._quote_rows(keys, "ltp").items()}
        except NeoError as exc:
            if exc.error_type == "TokenException":
                raise
            return {}

    def ltp(self, instruments):
        live = {k: self.live_price(k) for k in instruments}
        if instruments and all(live.values()):  # ticks already here: skip the REST round trip
            return {k: {"instrument_token": self.lookup(k)["instrument_token"], "last_price": live[k]}
                    for k in instruments}
        return {k: {"instrument_token": self.lookup(k)["instrument_token"], "last_price": _num(r.get("ltp"))}
                for k, r in self._quote_rows(instruments, "ltp").items()}

    def quote(self, instruments):
        out = {}
        for key, r in self._quote_rows(instruments, "all").items():
            inst = self.lookup(key)
            ohlc = r.get("ohlc") or {}
            q = {"instrument_token": inst["instrument_token"], "last_price": _num(r.get("ltp")),
                 "last_quantity": int(_num(r.get("last_traded_quantity"))),
                 "volume": int(_num(r.get("volume") or r.get("last_volume"))),
                 "buy_quantity": int(_num(r.get("total_buy"))), "sell_quantity": int(_num(r.get("total_sell"))),
                 "ohlc": {k: _num(ohlc.get(k)) for k in ("open", "high", "low", "close")},
                 "net_change": _num(r.get("change"))}
            oi = r.get("oi") or r.get("open_int") or r.get("open_interest")
            if oi not in (None, ""):
                q["oi"] = int(_num(oi))
            depth = r.get("depth")
            if inst.get("segment") != "INDICES" and isinstance(depth, dict):
                q["depth"] = {side: [{"price": _num(d.get("price")), "quantity": int(_num(d.get("quantity"))),
                                      "orders": int(_num(d.get("orders")))} for d in (depth.get(side) or [])[:5]]
                              for side in ("buy", "sell")}
            out[key] = q
        return out

    def historical(self, token, interval, from_dt, to_dt):
        if interval not in HIST_INTERVALS:
            raise NeoError("Invalid interval", "InputException", 400)
        neo_iv, max_days = HIST_INTERVALS[interval]
        seg, psym = split_token(token)
        start = datetime.strptime(from_dt[:10], "%Y-%m-%d").date()
        end = datetime.strptime(to_dt[:10], "%Y-%m-%d").date()
        candles, calls = {}, 0
        while end >= start and calls < HIST_MAX_CALLS:  # Neo caps the range per request: walk back in windows
            lo = max(start, end - timedelta(days=max_days - 1))
            body = self._request("GET", "/market-data/1.0/historical/details", kind="consumer", params={
                "neosymbol": f"{seg}|{psym}", "fromdate": lo.isoformat(), "todate": end.isoformat(),
                "interval": neo_iv})
            rows = ((body.get("data") or {}).get("candles") or []) if isinstance(body, dict) else []
            for c in rows:
                candles[c[0]] = [c[0], *c[1:6]]
            calls += 1
            if not rows and calls > 1:
                break  # nothing older
            end = lo - timedelta(days=1)
        return {"candles": [candles[k] for k in sorted(candles)]}

    # ---- instruments ----------------------------------------------------
    def instruments_csv(self, exchange):
        """Download Neo's scrip master for one exchange, converted to the app's CSV layout."""
        seg = EXCH_TO_SEG.get(exchange)
        if not seg:
            return CSV_HEADER
        paths = (self._request("GET", "/script-details/1.0/masterscrip/file-paths", kind="consumer")
                 .get("data") or {}).get("filesPaths") or []
        files = [p for p in paths if p.rsplit("/", 1)[-1].startswith(seg)]
        files.sort(key=lambda p: "-v1" not in p)  # prefer the v1 cash files
        if not files:
            raise NeoError(f"No scrip master file for {seg}", "DataException", 502)
        try:
            resp = self.http.get(files[0], timeout=90)
            resp.raise_for_status()
        except requests.RequestException as exc:
            raise NeoError(f"Couldn't download the {seg} scrip master: {exc}", "NetworkException", 502)
        return convert_scrip_master(resp.content.decode("utf-8", errors="replace"), seg)


CSV_HEADER = ("instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,"
              "tick_size,lot_size,instrument_type,segment,exchange")


def convert_scrip_master(text, seg):
    """Neo scrip master CSV -> the app's instrument CSV (one row per tradable instrument)."""
    exch = SEG_TO_EXCH[seg]
    out = io.StringIO()
    w = csv.writer(out, lineterminator="\n")
    w.writerow(CSV_HEADER.split(","))
    fo = seg.endswith("_fo")
    for raw in csv.DictReader(io.StringIO(text)):
        r = {(k or "").strip(): (v or "").strip() for k, v in raw.items() if isinstance(v, str) or v is None}
        psym = r.get("pSymbol", "")
        if not psym.isdigit():
            continue
        token = make_token(seg, psym)
        tick = _num(r.get("dTickSize")) / 100  # paise
        lot = int(_num(r.get("lLotSize"), 1))
        if not fo:
            if tick <= 0:  # index rows carry no tick size
                idx = INDEX_NAMES.get((seg, psym))
                if idx:
                    w.writerow([token, psym, idx[0], idx[0], 0, "", 0, 0, 0, "EQ", "INDICES", exch])
                continue
            w.writerow([token, psym, r.get("pTrdSymbol"), r.get("pDesc") or r.get("pSymbolName"), 0, "", 0,
                        tick, max(lot, 1), "EQ", exch, exch])
            continue
        opt = r.get("pOptionType", "").upper()
        typ = opt if opt in ("CE", "PE") else "FUT"
        epoch = _num(r.get("lExpiryDate"), -1)
        expiry = ""
        if epoch > 0:  # nse_fo/cde_fo count from 1980, bse_fo/mcx_fo from 1970
            epoch += 315511200 if seg in ("nse_fo", "cde_fo") else 0
            expiry = datetime.fromtimestamp(epoch, IST).date().isoformat()
        strike = _num(r.get("dStrikePrice;") or r.get("dStrikePrice")) / 100 if typ != "FUT" else 0
        w.writerow([token, psym, r.get("pTrdSymbol"), r.get("pSymbolName"), 0, expiry, max(strike, 0),
                    tick if tick > 0 else 0.05, max(lot, 1), typ, f"{exch}-{'FUT' if typ == 'FUT' else 'OPT'}", exch])
    return out.getvalue()


def _wss(url):
    if not url:
        return None
    return "wss://" + (url.split("://", 1)[1] if "://" in url else url)


def _realtime_url(base_url):
    host = base_url.split("://", 1)[-1].split("/", 1)[0]
    return f"wss://{host}/realtime"


# ==========================================================================
# Mock client: same interface, fake data. Enabled with NEO_MOCK=1 so the UI
# can be explored without credentials or market hours. Never touches Kotak.
# ==========================================================================
MOCK_INSTRUMENTS = [
    # pSymbol, segment, symbol, name, app segment, type, lot, tick, base price
    ("26000", "nse_cm", "NIFTY 50", "NIFTY 50", "INDICES", "EQ", 0, 0, 24850.0),
    ("26009", "nse_cm", "NIFTY BANK", "NIFTY BANK", "INDICES", "EQ", 0, 0, 54200.0),
    ("1", "bse_cm", "SENSEX", "SENSEX", "INDICES", "EQ", 0, 0, 81500.0),
    ("2885", "nse_cm", "RELIANCE-EQ", "RELIANCE INDUSTRIES LTD", "NSE", "EQ", 1, 0.1, 1385.0),
    ("1594", "nse_cm", "INFY-EQ", "INFOSYS LIMITED", "NSE", "EQ", 1, 0.1, 1520.0),
    ("11536", "nse_cm", "TCS-EQ", "TATA CONSULTANCY SERV LT", "NSE", "EQ", 1, 0.1, 3450.0),
    ("1333", "nse_cm", "HDFCBANK-EQ", "HDFC BANK LTD", "NSE", "EQ", 1, 0.1, 1960.0),
    ("4963", "nse_cm", "ICICIBANK-EQ", "ICICI BANK LTD.", "NSE", "EQ", 1, 0.1, 1410.0),
    ("3045", "nse_cm", "SBIN-EQ", "STATE BANK OF INDIA", "NSE", "EQ", 1, 0.05, 815.0),
    ("3456", "nse_cm", "TATAMOTORS-EQ", "TATA MOTORS LIMITED", "NSE", "EQ", 1, 0.05, 690.0),
    ("500325", "bse_cm", "RELIANCE", "RELIANCE INDUSTRIES LTD", "BSE", "EQ", 1, 0.05, 1385.5),
    ("52001", "nse_fo", "NIFTY26OCTFUT", "NIFTY", "NFO-FUT", "FUT", 65, 0.1, 24910.0),
]

# Weekly index option chains generated around spot:
# name, spot key, exchange, segment, lot, strike step, expiry weekday (Mon=0)
MOCK_OPTION_CHAINS = [
    ("NIFTY", "NSE:NIFTY 50", "NFO", "NFO-OPT", 65, 50, 1),
    ("SENSEX", "BSE:SENSEX", "BFO", "BFO-OPT", 20, 100, 3),
]
MONTH_CODES = "123456789OND"


def _norm_cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def _bs_price(spot, strike, days, typ, vol=0.13):
    t = max(days, 0.05) / 365
    d1 = (math.log(spot / strike) + 0.5 * vol * vol * t) / (vol * math.sqrt(t))
    d2 = d1 - vol * math.sqrt(t)
    if typ == "CE":
        return spot * _norm_cdf(d1) - strike * _norm_cdf(d2)
    return strike * _norm_cdf(-d2) - spot * _norm_cdf(-d1)


OPEN_STATUSES = {"OPEN", "TRIGGER PENDING", "AMO REQ RECEIVED"}


class MockNeo:
    def __init__(self):
        self.access_token = None
        self.by_key = {}
        for psym, seg, sym, name, app_seg, typ, lot, tick, px in MOCK_INSTRUMENTS:
            exch = SEG_TO_EXCH[seg]
            self.by_key[f"{exch}:{sym}"] = {
                "instrument_token": make_token(seg, psym), "tradingsymbol": sym, "name": name,
                "exchange": exch, "segment": app_seg, "instrument_type": typ,
                "lot_size": lot, "tick_size": tick, "close": px, "last": px,
            }
        self.by_key["NFO:NIFTY26OCTFUT"]["expiry"] = "2026-10-27"
        self._gen_options()
        self.orders_list = []
        self.trades_list = []
        self.net = {}  # (exchange, symbol, product) -> {qty, buy_value, sell_value, ...}
        self.cash = 500000.0
        self._lock = threading.RLock()

    def login(self, totp=None, mpin=None):
        self.access_token = "mock-token"
        return {"access_token": self.access_token}

    def invalidate_session(self):
        self.access_token = None

    def _gen_options(self):
        psym = itertools.count(40000)
        today = date.today()
        for name, spot_key, exch, seg, lot, step, weekday in MOCK_OPTION_CHAINS:
            spot = self.by_key[spot_key]["close"]
            atm = round(spot / step) * step
            first = today + timedelta(days=(weekday - today.weekday()) % 7)
            for week in range(3):
                exp = first + timedelta(days=7 * week)
                code = f"{name}{exp:%y}{MONTH_CODES[exp.month - 1]}{exp.day:02d}"
                for k in range(-30, 31):
                    strike = atm + k * step
                    for typ in ("CE", "PE"):
                        sym = f"{code}{int(strike)}{typ}"
                        inst = {"instrument_token": make_token(EXCH_TO_SEG[exch], next(psym)), "tradingsymbol": sym,
                                "name": name, "exchange": exch, "segment": seg, "instrument_type": typ,
                                "lot_size": lot, "tick_size": 0.05, "expiry": exp.isoformat(),
                                "strike": float(strike), "underlying": spot_key,
                                "oi_base": int(random.uniform(2e5, 6e6) / (1 + abs(k) / 6)) // lot * lot}
                        inst["close"] = inst["last"] = self._option_price(inst, spot)
                        self.by_key[f"{exch}:{sym}"] = inst

    @staticmethod
    def _option_price(inst, spot):
        exp = datetime.fromisoformat(inst["expiry"]).replace(hour=15, minute=30)
        days = (exp - datetime.now()).total_seconds() / 86400
        px = _bs_price(spot, inst["strike"], days + 0.3, inst["instrument_type"])
        return round(max(0.05, round(px / 0.05) * 0.05), 2)

    def _tick(self, inst):
        self._move(inst)
        self._on_price(inst)
        return inst["last"]

    def _move(self, inst):
        if "underlying" in inst:  # options follow the simulated index
            inst["last"] = self._option_price(inst, self.by_key[inst["underlying"]]["last"])
            return
        vol = 0.00005 if inst["segment"] == "INDICES" else 0.0003
        step = inst["close"] * vol * random.gauss(0, 1)
        inst["last"] = round(max(inst["close"] * 0.9, min(inst["close"] * 1.1, inst["last"] + step)), 2)

    def _on_price(self, inst):
        """React to every price change the way an exchange would, so a brief touch of a
        trigger or limit price is never missed between polls."""
        ex, sym, ltp = inst["exchange"], inst["tradingsymbol"], inst["last"]
        for o in self.orders_list:
            if o["exchange"] == ex and o["tradingsymbol"] == sym and o["status"] in ("OPEN", "TRIGGER PENDING"):
                self._match(o, ltp)
        if inst["segment"] == "INDICES":  # re-price options that have working orders
            key = f"{ex}:{sym}"
            for dep in self._working_instruments():
                if dep.get("underlying") == key:
                    self._move(dep)
                    self._on_price(dep)

    def _working_instruments(self):
        keys = {(o["exchange"], o["tradingsymbol"]) for o in self.orders_list if o["status"] in ("OPEN", "TRIGGER PENDING")}
        return [self.by_key[f"{e}:{t}"] for e, t in keys if f"{e}:{t}" in self.by_key]

    def _inst(self, exchange, symbol):
        inst = self.by_key.get(f"{exchange}:{symbol}")
        if not inst:
            raise NeoError(f"Invalid instrument {exchange}:{symbol}", "InputException", 400)
        return inst

    def profile(self):
        return {"user_id": "DEMO01", "user_name": "Demo Trader", "user_shortname": "Demo",
                "email": "demo@example.com", "broker": "KOTAK NEO",
                "exchanges": ["NSE", "BSE", "NFO", "BFO"], "products": ["CNC", "MIS", "NRML"]}

    def margins(self):
        used = sum(abs(p["quantity"]) * p["average_price"] * (0.2 if p["product"] == "MIS" else 1)
                   for p in self._positions())
        seg = {"enabled": True, "net": round(self.cash - used, 2),
               "available": {"cash": self.cash, "live_balance": round(self.cash - used, 2),
                             "opening_balance": self.cash, "collateral": 0, "intraday_payin": 0},
               "utilised": {"debits": round(used, 2), "span": 0, "exposure": 0, "option_premium": 0}}
        return {"equity": seg, "commodity": {**seg, "enabled": False, "net": 0,
                "available": {"cash": 0, "live_balance": 0, "opening_balance": 0, "collateral": 0,
                              "intraday_payin": 0}, "utilised": {"debits": 0}}}

    def holdings(self):
        out = []
        for sym, qty, avg in [("INFY-EQ", 40, 1410.25), ("HDFCBANK-EQ", 25, 1655.8), ("SBIN-EQ", 100, 842.1)]:
            inst = self._inst("NSE", sym)
            ltp = self._tick(inst)
            p = self.net.get(("NSE", sym, "CNC"))
            used = max(0, p["sell_qty"] - p["buy_qty"]) if p else 0
            out.append({"tradingsymbol": sym, "exchange": "NSE", "instrument_token": inst["instrument_token"],
                        "product": "CNC", "quantity": qty, "t1_quantity": 0, "used_quantity": used,
                        "average_price": avg,
                        "last_price": ltp, "close_price": inst["close"],
                        "pnl": round((ltp - avg) * qty, 2),
                        "day_change": round(ltp - inst["close"], 2),
                        "day_change_percentage": round((ltp - inst["close"]) / inst["close"] * 100, 2)})
        return out

    def _positions(self):
        out = []
        for (exch, sym, prod), p in self.net.items():
            inst = self._inst(exch, sym)
            ltp = self._tick(inst)
            qty = p["buy_qty"] - p["sell_qty"]
            avg = (p["buy_value"] / p["buy_qty"] if qty > 0 else
                   p["sell_value"] / p["sell_qty"] if qty < 0 else 0)
            pnl = p["sell_value"] - p["buy_value"] + qty * ltp
            out.append({"tradingsymbol": sym, "exchange": exch, "product": prod, "quantity": qty,
                        "instrument_token": inst["instrument_token"],
                        "average_price": round(avg, 2), "last_price": ltp, "close_price": inst["close"],
                        "pnl": round(pnl, 2), "m2m": round(pnl, 2), "multiplier": 1,
                        "buy_value": round(p["buy_value"], 2), "sell_value": round(p["sell_value"], 2),
                        "buy_quantity": p["buy_qty"], "sell_quantity": p["sell_qty"]})
        return out

    def positions(self):
        net = self._positions()
        return {"net": net, "day": net}

    def orders(self):
        self._match_open_orders()
        return list(self.orders_list)

    def trades(self):
        return list(self.trades_list)

    def order_history(self, order_id):
        return [o for o in self.orders_list if o["order_id"] == order_id]

    def _fill(self, order, price):
        order.update(status="COMPLETE", filled_quantity=order["quantity"], pending_quantity=0,
                     average_price=price, status_message=None)
        key = (order["exchange"], order["tradingsymbol"], order["product"])
        p = self.net.setdefault(key, {"buy_qty": 0, "sell_qty": 0, "buy_value": 0.0, "sell_value": 0.0})
        side = "buy" if order["transaction_type"] == "BUY" else "sell"
        p[f"{side}_qty"] += order["quantity"]
        p[f"{side}_value"] += order["quantity"] * price
        self.trades_list.append({
            "trade_id": str(random.randint(10**7, 10**8)), "order_id": order["order_id"],
            "exchange": order["exchange"], "tradingsymbol": order["tradingsymbol"],
            "transaction_type": order["transaction_type"], "product": order["product"],
            "quantity": order["quantity"], "average_price": price,
            "fill_timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")})

    def _match(self, o, ltp):
        buy = o["transaction_type"] == "BUY"
        if o["status"] == "TRIGGER PENDING":
            trig = o["trigger_price"]
            if not ((buy and ltp >= trig) or (not buy and ltp <= trig)):
                return
            if o["order_type"] == "SL-M":
                self._fill(o, ltp)
                return
            o["status"] = "OPEN"
        if (buy and ltp <= o["price"]) or (not buy and ltp >= o["price"]):
            self._fill(o, ltp)

    def _match_open_orders(self):
        for inst in self._working_instruments():
            self._tick(inst)

    def place_order(self, variety, params):
        if variety not in ("regular", "amo"):
            raise NeoError(f"'{variety}' orders are not supported on Kotak Neo", "InputException", 400)
        inst = self._inst(params["exchange"], params["tradingsymbol"])
        if inst["segment"] == "INDICES":
            raise NeoError("Indices are not tradable", "InputException", 400)
        qty = int(params["quantity"])
        if qty <= 0 or (inst["lot_size"] > 1 and qty % inst["lot_size"]):
            raise NeoError(f"Quantity should be a multiple of lot size {inst['lot_size']}",
                           "InputException", 400)
        order_id = str(int(time.time() * 1000)) + str(random.randint(10, 99))
        rms = self._rms_reject(params, qty)
        order = {"order_id": order_id, "variety": variety, "status": "OPEN",
                 "exchange": params["exchange"], "tradingsymbol": params["tradingsymbol"],
                 "instrument_token": inst["instrument_token"],
                 "transaction_type": params["transaction_type"], "order_type": params["order_type"],
                 "product": params["product"], "validity": params.get("validity", "DAY"),
                 "quantity": qty, "filled_quantity": 0, "pending_quantity": qty,
                 "price": float(params.get("price") or 0),
                 "trigger_price": float(params.get("trigger_price") or 0),
                 "average_price": 0, "tag": params.get("tag"), "status_message": None,
                 "order_timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
        self.orders_list.append(order)
        if rms:  # like Kotak: accepted, then rejected by the risk system
            order.update(status="REJECTED", status_message=rms)
        elif variety == "amo":
            order["status"] = "AMO REQ RECEIVED"
        elif order["order_type"] == "MARKET":
            self._move(inst)  # not _tick: the matcher must not see this order before it is filled
            self._fill(order, inst["last"])
        elif order["order_type"] in ("SL", "SL-M"):
            order["status"] = "TRIGGER PENDING"
        else:
            self._match(order, inst["last"])
        return {"order_id": order_id}

    def _rms_reject(self, params, qty):
        """Kotak's RMS counts exit orders beyond the open quantity as fresh shorts needing full
        margin; with a small account that means a rejection. Emulate that for demo testing."""
        p = self.net.get((params["exchange"], params["tradingsymbol"], params["product"]))
        held = (p["buy_qty"] - p["sell_qty"]) if p else 0
        closing = "SELL" if held > 0 else "BUY"
        if not held or params["transaction_type"] != closing:
            return None
        pending = sum(o["pending_quantity"] for o in self.orders_list
                      if o["status"] in ("OPEN", "TRIGGER PENDING") and o["transaction_type"] == closing
                      and (o["exchange"], o["tradingsymbol"], o["product"]) ==
                      (params["exchange"], params["tradingsymbol"], params["product"]))
        if pending + qty > abs(held):
            return "RMS:Margin Exceeds (demo: exit orders exceed the open quantity)"
        return None

    def modify_order(self, variety, order_id, params):
        for o in self.orders_list:
            if o["order_id"] == order_id:
                if o["status"] not in OPEN_STATUSES:
                    raise NeoError("Order cannot be modified as it is not open", "OrderException", 400)
                for k in ("quantity", "price", "trigger_price"):
                    if params.get(k) not in (None, ""):
                        o[k] = int(params[k]) if k == "quantity" else float(params[k])
                if params.get("order_type"):
                    o["order_type"] = params["order_type"]
                o["pending_quantity"] = o["quantity"]
                if o["order_type"] == "MARKET":  # e.g. a stop turned into a market exit: fills now
                    inst = self._inst(o["exchange"], o["tradingsymbol"])
                    self._move(inst)
                    self._fill(o, inst["last"])
                return {"order_id": order_id}
        raise NeoError("Order not found", "InputException", 400)

    def cancel_order(self, variety, order_id):
        for o in self.orders_list:
            if o["order_id"] == order_id:
                if o["status"] not in OPEN_STATUSES:
                    raise NeoError("Order cannot be cancelled as it is not open", "OrderException", 400)
                o["status"] = "CANCELLED"
                return {"order_id": order_id}
        raise NeoError("Order not found", "InputException", 400)

    def order_margins(self, orders):
        out = []
        for o in orders:
            inst = self._inst(o["exchange"], o["tradingsymbol"])
            price = float(o.get("price") or 0) or inst["last"]
            factor = 0.2 if o.get("product") == "MIS" else (0.12 if inst["segment"] == "NFO-FUT" else 1)
            out.append({"total": round(price * int(o["quantity"]) * factor, 2)})
        return out

    @staticmethod
    def _volume(inst):
        # Cumulative day volume: grows a little on every tick.
        lot = max(inst.get("lot_size") or 1, 1)
        inst["day_volume"] = inst.get("day_volume", random.randint(10**5, 10**6) * lot) + random.randint(0, 40) * lot
        return inst["day_volume"]

    def ltp(self, instruments):
        return {k: {"instrument_token": self.by_key[k]["instrument_token"], "last_price": self._tick(self.by_key[k])}
                for k in instruments if k in self.by_key}

    def quote(self, instruments):
        out = {}
        for key in instruments:
            inst = self.by_key.get(key)
            if not inst:
                continue
            ltp = self._tick(inst)
            spread = inst["tick_size"] or 0.05
            out[key] = {
                "instrument_token": inst["instrument_token"], "last_price": ltp,
                "volume": self._volume(inst),
                "ohlc": {"open": inst["close"], "high": max(ltp, inst["close"] * 1.01),
                         "low": min(ltp, inst["close"] * 0.99), "close": inst["close"]},
                "net_change": 0,
                **({"oi": int(inst["oi_base"] * random.uniform(0.98, 1.02))} if "oi_base" in inst else {}),
                "depth": None if inst["segment"] == "INDICES" else {
                    "buy": [{"price": round(ltp - spread * (i + 1), 2), "quantity": random.randint(1, 900),
                             "orders": random.randint(1, 20)} for i in range(5)],
                    "sell": [{"price": round(ltp + spread * (i + 1), 2), "quantity": random.randint(1, 900),
                              "orders": random.randint(1, 20)} for i in range(5)]},
            }
        return out

    def historical(self, token, interval, from_dt, to_dt):
        inst = next((i for i in self.by_key.values() if str(i["instrument_token"]) == str(token)), None)
        if not inst:
            raise NeoError("Invalid token", "InputException", 400)
        step = {"minute": 1, "3minute": 3, "5minute": 5, "10minute": 10, "15minute": 15,
                "30minute": 30, "60minute": 60}.get(interval)
        start = datetime.strptime(from_dt, "%Y-%m-%d %H:%M:%S")
        # Intraday candles step from the 09:15 open, daily ones at midnight.
        start = start.replace(hour=9, minute=15, second=0) if step else start.replace(hour=0, minute=0, second=0)
        end = datetime.strptime(to_dt, "%Y-%m-%d %H:%M:%S")
        rng = random.Random(token)
        price = inst["close"] * 0.9
        candles, t = [], start
        while t <= end and len(candles) < 3000:
            if t.weekday() < 5 and (step is None or (9 * 60 + 15) <= t.hour * 60 + t.minute < 15 * 60 + 30):
                o = price
                c = o * (1 + rng.gauss(0.0002, 0.004 if step else 0.012))
                h, lo = max(o, c) * (1 + abs(rng.gauss(0, 0.002))), min(o, c) * (1 - abs(rng.gauss(0, 0.002)))
                candles.append([t.strftime("%Y-%m-%dT%H:%M:%S+0530"), round(o, 2), round(h, 2),
                                round(lo, 2), round(c, 2), rng.randint(10**4, 10**6)])
                price = c
            t += timedelta(minutes=step) if step else timedelta(days=1)
            if step and t.hour * 60 + t.minute >= 15 * 60 + 30:
                t = (t + timedelta(days=1)).replace(hour=9, minute=15)
        if candles:  # anchor the series so it ends at the current simulated price
            f = inst["last"] / candles[-1][4]
            candles = [[c[0], *(round(v * f, 2) for v in c[1:5]), c[5]] for c in candles]
        return {"candles": candles}

    def instruments_csv(self, exchange=None):
        out = io.StringIO()
        w = csv.writer(out, lineterminator="\n")
        w.writerow(CSV_HEADER.split(","))
        for i in self.by_key.values():
            w.writerow([i["instrument_token"], 0, i["tradingsymbol"], i["name"], 0, i.get("expiry", ""),
                        i.get("strike", 0), i["tick_size"], i["lot_size"], i["instrument_type"],
                        i["segment"], i["exchange"]])
        return out.getvalue()


def _locked(fn):
    @functools.wraps(fn)
    def wrapper(self, *args, **kwargs):
        with self._lock:
            return fn(self, *args, **kwargs)
    return wrapper


# The mock is shared by Flask request threads and the TP/SL watcher thread.
for _name, _fn in list(vars(MockNeo).items()):
    if callable(_fn) and not _name.startswith("_"):
        setattr(MockNeo, _name, _locked(_fn))
