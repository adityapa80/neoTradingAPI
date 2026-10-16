"""Kotak Neo trading web interface — Flask backend.

The API access token, session token and MPIN never leave this process; the
browser talks only to /api/* on localhost, which proxies to Kotak Neo.
"""
import csv
import io
import json
import logging
import os
import threading
import time
from datetime import date, datetime, timedelta
from functools import wraps
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request, send_from_directory

from neo import MockNeo, NeoClient, NeoError
from net import force_ipv4
from protect import ProtectionManager
from stream import MockTickHub, TickHub

load_dotenv()
# Feed, order-feed and TP/SL events go to the service log (journalctl -u neo-terminal).
logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
for _name in ("stream", "protect", "api", "neo"):
    logging.getLogger(_name).setLevel(logging.INFO)
if os.getenv("NEO_FORCE_IPV4", "1") == "1":
    force_ipv4()  # orders must come from the whitelisted static IPv4 address

BASE = Path(__file__).parent
DATA_DIR = BASE / "data"
DATA_DIR.mkdir(exist_ok=True)
SESSION_FILE = DATA_DIR / "session.json"

MOCK = os.getenv("NEO_MOCK", "0") == "1"
ACCESS_TOKEN = os.getenv("NEO_ACCESS_TOKEN", "")  # from the Neo app: Trade API -> your application
MOBILE = os.getenv("NEO_MOBILE", "")
UCC = os.getenv("NEO_UCC", "")
MPIN = os.getenv("NEO_MPIN", "")  # optional: if unset, the login screen asks for it
INSTRUMENT_EXCHANGES = [e.strip() for e in
                        os.getenv("NEO_EXCHANGES", "NSE,BSE,NFO,BFO").split(",") if e.strip()]
# The option chain needs the F&O segments for NIFTY/BANKNIFTY (NFO) and SENSEX (BFO).
INSTRUMENT_EXCHANGES += [e for e in ("NFO", "BFO") if e not in INSTRUMENT_EXCHANGES]

# Contract lot sizes to enforce for index derivatives, e.g. "NIFTY:65,SENSEX:20".
LOT_SIZES = {k.strip().upper(): int(v) for k, v in
             (pair.split(":") for pair in os.getenv("NEO_LOT_SIZES", "NIFTY:65,SENSEX:20").split(",") if ":" in pair)}
DERIV_SEGMENTS = {"NFO-OPT", "NFO-FUT", "BFO-OPT", "BFO-FUT"}
LOT_IN_UNITS_EXCHANGES = {"NFO", "BFO"}

# Underlyings offered in the option chain: spot quote key and options exchange.
UNDERLYINGS = {
    "NIFTY": {"spot": "NSE:NIFTY 50", "exchange": "NFO", "step_hint": 50},
    "BANKNIFTY": {"spot": "NSE:NIFTY BANK", "exchange": "NFO", "step_hint": 100},
    "SENSEX": {"spot": "BSE:SENSEX", "exchange": "BFO", "step_hint": 100},
}

if not MOCK and not (ACCESS_TOKEN and MOBILE and UCC):
    raise SystemExit("Set NEO_ACCESS_TOKEN, NEO_MOBILE and NEO_UCC in .env (or NEO_MOCK=1 for demo mode).")

app = Flask(__name__, static_folder="static", static_url_path="/static")
broker = MockNeo() if MOCK else NeoClient(ACCESS_TOKEN, MOBILE, UCC, tags_file=DATA_DIR / "order_tags.json")


# ---------------------------------------------------------------- session --
def load_session():
    if MOCK or not SESSION_FILE.exists():
        return
    try:
        saved = json.loads(SESSION_FILE.read_text())
        if saved.get("date") == date.today().isoformat():  # Neo sessions last the trading day
            broker.restore(saved)
    except (ValueError, OSError):
        pass


def save_session(data):
    if MOCK:
        return
    if data:
        SESSION_FILE.write_text(json.dumps({**data, "date": date.today().isoformat()}))
    elif SESSION_FILE.exists():
        SESSION_FILE.unlink()


load_session()


# ------------------------------------------------------------ instruments --
class InstrumentStore:
    """Daily cache of the Neo scrip master (converted to one CSV layout), searchable in memory."""

    def __init__(self):
        self.items = []
        self.by_key = {}
        self.options = {}  # underlying -> expiry -> strike -> {"CE": inst, "PE": inst}
        self.by_token = {}
        self.loaded_for = None
        self.lock = threading.Lock()

    def ensure_loaded(self):
        today = date.today().isoformat()
        if self.loaded_for == today:
            return
        with self.lock:
            if self.loaded_for == today:
                return
            items = []
            options = {}
            lot_warnings = set()
            for exch in INSTRUMENT_EXCHANGES:
                cache = DATA_DIR / f"instruments-{exch}-{today}.csv"
                if MOCK:
                    text = broker.instruments_csv(exch)
                elif cache.exists():
                    text = cache.read_text(encoding="utf-8")
                else:
                    text = broker.instruments_csv(exch)
                    for old in DATA_DIR.glob(f"instruments-{exch}-*.csv"):
                        old.unlink()
                    cache.write_text(text, encoding="utf-8")
                for row in csv.DictReader(io.StringIO(text)):
                    if MOCK and row["exchange"] != exch:
                        continue
                    inst = {
                        "instrument_token": int(row["instrument_token"]),
                        "tradingsymbol": row["tradingsymbol"],
                        "name": row["name"],
                        "exchange": row["exchange"],
                        "segment": row["segment"],
                        "instrument_type": row["instrument_type"],
                        "expiry": row["expiry"],
                        "strike": float(row["strike"] or 0),
                        "lot_size": int(float(row["lot_size"] or 1)),
                        "tick_size": float(row["tick_size"] or 0.05),
                    }
                    name = (inst["name"] or "").upper()
                    if inst["segment"] in DERIV_SEGMENTS and name in LOT_SIZES:
                        if inst["lot_size"] != LOT_SIZES[name] and name not in lot_warnings:
                            lot_warnings.add(name)
                            print(f"  ! {name}: scrip master lot size {inst['lot_size']} "
                                  f"overridden by NEO_LOT_SIZES={LOT_SIZES[name]}")
                        inst["lot_size"] = LOT_SIZES[name]
                    if inst["segment"] in ("NFO-OPT", "BFO-OPT") and name in UNDERLYINGS \
                            and inst["expiry"] >= today:
                        (options.setdefault(name, {}).setdefault(inst["expiry"], {})
                         .setdefault(inst["strike"], {})[inst["instrument_type"]]) = inst
                    items.append(inst)
            self.items = items
            self.by_key = {f'{i["exchange"]}:{i["tradingsymbol"]}': i for i in items}
            self.options = options
            self.by_token = {i["instrument_token"]: f'{i["exchange"]}:{i["tradingsymbol"]}' for i in items}
            self.loaded_for = today

    def search(self, query, limit=25):
        self.ensure_loaded()
        q = query.upper().strip()
        if not q:
            return []
        terms = q.split()
        scored = []
        for inst in self.items:
            sym, name = inst["tradingsymbol"], (inst["name"] or "").upper()
            hay = f"{sym} {name}"
            if not all(t in hay for t in terms):
                continue
            score = 0
            base = sym[:-3] if sym.endswith("-EQ") else sym
            if sym == q or base == q:
                score += 100
            elif sym.startswith(terms[0]):
                score += 50
            elif name.startswith(terms[0]):
                score += 30
            if inst["segment"] in ("NSE", "INDICES"):
                score += 15
            elif inst["segment"] == "BSE":
                score += 10
            score -= len(sym) * 0.1
            scored.append((score, inst))
            if len(scored) > 2000:
                break
        scored.sort(key=lambda s: -s[0])
        return [i for _, i in scored[:limit]]

    def get(self, key):
        self.ensure_loaded()
        return self.by_key.get(key)

    def key_for_token(self, token):
        self.ensure_loaded()
        return self.by_token.get(token)

    def chain(self, underlying, expiry=None):
        self.ensure_loaded()
        expiries = sorted(self.options.get(underlying, {}))
        if not expiries:
            return {"expiries": [], "expiry": None, "strikes": []}
        expiry = expiry if expiry in expiries else expiries[0]
        rows = self.options[underlying][expiry]
        return {"expiries": expiries, "expiry": expiry,
                "strikes": [{"strike": k, "CE": rows[k].get("CE"), "PE": rows[k].get("PE")} for k in sorted(rows)]}


def check_lot_multiple(exchange, symbol, quantity):
    """Reject F&O quantities that aren't a whole number of lots."""
    inst = instruments.get(f"{exchange}:{symbol}")
    if not inst or inst["exchange"] not in LOT_IN_UNITS_EXCHANGES or inst["lot_size"] <= 1:
        return
    lot, qty = inst["lot_size"], int(quantity)
    if qty <= 0 or qty % lot:
        lower = qty // lot * lot
        hint = f" Try {lower} or {lower + lot}." if lower else f" Minimum is {lot}."
        raise NeoError(f"{symbol}: quantity {qty} is not a multiple of the lot size {lot}.{hint}",
                       "InputException", 400)


instruments = InstrumentStore()
if not MOCK:
    broker.lookup = instruments.get
    broker.token_to_key = instruments.key_for_token
protections = ProtectionManager(broker, instruments, None if MOCK else DATA_DIR / "protections.json")
protections.start()


_sync_state = {"running": False, "again": False}
_sync_lock = threading.Lock()


def _sync_protections(_order=None):
    """React to fills immediately instead of on the next 3 s sweep. The order feed sends
    several updates per order; while a sync is running, further ones just ask for one more
    pass, so a burst of orders can't pile up broker calls and hit the rate limit."""
    with _sync_lock:
        if _sync_state["running"]:
            _sync_state["again"] = True
            return
        _sync_state["running"] = True
    try:
        while True:
            with _sync_lock:
                _sync_state["again"] = False
            try:
                protections.sync()
            except NeoError as exc:
                print("protection sync:", exc.message)
            with _sync_lock:
                if not _sync_state["again"]:
                    _sync_state["running"] = False
                    return
    except BaseException:
        with _sync_lock:
            _sync_state["running"] = False
        raise


def _key_to_token(key):
    inst = instruments.get(key)
    return inst["instrument_token"] if inst else None


hub = (MockTickHub(broker, on_order=_sync_protections, watch_keys=protections.watch_keys,
                   on_tick=protections.on_tick) if MOCK else
       TickHub(broker, _key_to_token, instruments.key_for_token, on_order=_sync_protections,
               watch_keys=protections.watch_keys, on_tick=protections.on_tick))
hub.start()
if not MOCK:
    broker.live_price = hub.live_price  # TP/SL checks use the streamed price instead of a REST quote


# ---------------------------------------------------------------- helpers --
@app.errorhandler(NeoError)
def handle_neo_error(err):
    if err.error_type == "TokenException":
        broker.access_token = None
        save_session(None)
    status = err.status if 400 <= err.status < 600 else 500
    logging.getLogger("api").warning("%s %s -> %s %s: %s", request.method, request.path, status,
                                     err.error_type, err.message)
    return jsonify(error=err.message, error_type=err.error_type), status


def _csrf_ok():
    # Simple CSRF guard: browsers can't send custom headers cross-site without CORS.
    return request.method == "GET" or request.headers.get("X-Requested-With") == "kite-ui"


def require_login(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not broker.access_token:
            return jsonify(error="Not logged in", error_type="TokenException"), 403
        if not _csrf_ok():
            return jsonify(error="Missing X-Requested-With header", error_type="InputException"), 400
        return fn(*args, **kwargs)
    return wrapper


ORDER_FIELDS = ("exchange", "tradingsymbol", "transaction_type", "order_type", "quantity",
                "product", "price", "trigger_price", "validity", "disclosed_quantity", "tag")
VARIETIES = {"regular", "amo"}


def clean_order_params(body, fields=ORDER_FIELDS):
    params = {k: body[k] for k in fields if body.get(k) not in (None, "")}
    if params.get("order_type") in ("MARKET", "SL-M"):
        params.pop("price", None)
    if params.get("order_type") in ("MARKET", "LIMIT"):
        params.pop("trigger_price", None)
    return params


# ----------------------------------------------------------------- routes --
@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.post("/api/login")
def login():
    if not _csrf_ok():
        return jsonify(error="Missing X-Requested-With header", error_type="InputException"), 400
    b = request.get_json(force=True) or {}
    totp, mpin = str(b.get("totp") or "").strip(), str(b.get("mpin") or MPIN).strip()
    if not MOCK and not (totp.isdigit() and len(totp) == 6):
        return jsonify(error="Enter the 6-digit code from your authenticator app", error_type="InputException"), 400
    if not MOCK and not mpin:
        return jsonify(error="Enter your MPIN", error_type="InputException"), 400
    try:
        data = broker.login(totp, mpin)
    except NeoError as err:
        return jsonify(error=err.message, error_type=err.error_type), 400 if err.status < 500 else err.status
    save_session(data)
    return jsonify(ok=True)


@app.post("/api/logout")
@require_login
def logout():
    try:
        broker.invalidate_session()
    finally:
        broker.access_token = None
        save_session(None)
    return jsonify(ok=True)


@app.get("/api/session")
def session_info():
    return jsonify(logged_in=bool(broker.access_token), mock=MOCK, needs_mpin=not MPIN, broker="Kotak Neo")


@app.get("/api/profile")
@require_login
def profile():
    return jsonify(broker.profile())


@app.get("/api/margins")
@require_login
def margins():
    return jsonify(broker.margins())


@app.get("/api/holdings")
@require_login
def holdings():
    return jsonify(broker.holdings())


@app.get("/api/positions")
@require_login
def positions():
    return jsonify(broker.positions())


@app.get("/api/orders")
@require_login
def orders():
    return jsonify(broker.orders())


@app.get("/api/orders/<order_id>")
@require_login
def order_history(order_id):
    return jsonify(broker.order_history(order_id))


@app.get("/api/trades")
@require_login
def trades():
    return jsonify(broker.trades())


def limit_as_stop(params, exchange, symbol, side):
    """A buy LIMIT above the market would fill at once at the market price. Send it as a
    stop-limit instead (trigger = limit = the chosen price), so it only buys once the price
    rises to it. Sells are left alone: a sell limit below the market is often a quick exit."""
    if side != "BUY" or params.get("order_type") != "LIMIT" or params.get("validity", "DAY") != "DAY" \
            or not params.get("price"):
        return None
    key = f"{exchange}:{symbol}"
    ltp = broker.ltp([key]).get(key, {}).get("last_price")
    price = float(params["price"])
    if not ltp or price <= ltp:
        return None
    params.update(order_type="SL", trigger_price=price)
    return ltp


@app.post("/api/orders/<variety>")
@require_login
def place_order(variety):
    if variety not in VARIETIES:
        return jsonify(error="Invalid variety", error_type="InputException"), 400
    params = clean_order_params(request.get_json(force=True))
    check_lot_multiple(params.get("exchange"), params.get("tradingsymbol"), params.get("quantity", 0))
    ltp = limit_as_stop(params, params.get("exchange"), params.get("tradingsymbol"),
                        params.get("transaction_type")) if variety == "regular" else None
    res = broker.place_order(variety, params)
    return jsonify({**res, "as_stop": ltp is not None, "ltp": ltp})


@app.put("/api/orders/<variety>/<order_id>")
@require_login
def modify_order(variety, order_id):
    body = request.get_json(force=True)
    params = clean_order_params(body, ("order_type", "quantity", "price", "trigger_price",
                                       "validity", "disclosed_quantity"))
    if "quantity" in params:
        check_lot_multiple(body.get("exchange"), body.get("tradingsymbol"), params["quantity"])
    ltp = None
    if variety == "regular" and params.get("order_type") == "LIMIT" and not protections.manages(order_id):
        order = next((o for o in broker.orders() if o["order_id"] == order_id), None)
        if order and order.get("tag") not in ("ktTP", "ktSL"):  # TP/SL exit legs are managed by protect.py
            ltp = limit_as_stop(params, order["exchange"], order["tradingsymbol"], order["transaction_type"])
    res = broker.modify_order(variety, order_id, params)
    return jsonify({**(res or {}), "as_stop": ltp is not None, "ltp": ltp})


@app.delete("/api/orders/<variety>/<order_id>")
@require_login
def cancel_order(variety, order_id):
    return jsonify(broker.cancel_order(variety, order_id))


@app.post("/api/margins/orders")
@require_login
def order_margins():
    body = request.get_json(force=True)
    orders = [{**clean_order_params(o), "variety": o.get("variety", "regular")} for o in body]
    for o in orders:
        o["quantity"] = int(o.get("quantity", 0))
        o["price"] = float(o.get("price", 0))
        o["trigger_price"] = float(o.get("trigger_price", 0))
    return jsonify(broker.order_margins(orders))


@app.get("/api/quote")
@require_login
def quote():
    keys = [k for k in request.args.getlist("i") if k][:500]
    return jsonify(broker.quote(keys) if keys else {})


@app.get("/api/stream")
@require_login
def stream():
    cid = request.args.get("cid", "")[:40]
    if not cid:
        return jsonify(error="cid required", error_type="InputException"), 400
    return Response(hub.stream(cid), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/stream/subscribe")
@require_login
def stream_subscribe():
    b = request.get_json(force=True)
    keys = [k for k in b.get("keys", []) if isinstance(k, str)][:2900]  # Neo allows 3000 tokens
    depth = [k for k in b.get("depth", []) if isinstance(k, str)][:50]
    if not hub.set_keys(b.get("cid", ""), keys, depth):
        return jsonify(error="Unknown stream; reconnect", error_type="InputException"), 404
    return jsonify(ok=True, status=hub.status)


@app.get("/api/instruments/search")
@require_login
def search_instruments():
    return jsonify(instruments.search(request.args.get("q", "")))


@app.get("/api/instruments/lookup")
@require_login
def lookup_instruments():
    keys = request.args.getlist("i")[:200]
    return jsonify({k: instruments.get(k) for k in keys if instruments.get(k)})


def _price(value):
    if value in (None, ""):
        return None
    value = float(value)
    if value <= 0:
        raise NeoError("Prices must be positive", "InputException", 400)
    return value


# ---------------------------------------------------------------- drawings --
DRAWINGS_FILE = DATA_DIR / "drawings.json"
_drawings_lock = threading.Lock()


def _load_drawings():
    try:
        return json.loads(DRAWINGS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


@app.get("/api/drawings")
@require_login
def get_drawings():
    key = request.args.get("key", "")
    with _drawings_lock:
        return jsonify(items=_load_drawings().get(key, []))


@app.put("/api/drawings")
@require_login
def put_drawings():
    b = request.get_json(force=True)
    key, items = b.get("key", ""), b.get("items", [])
    if not key or not isinstance(items, list) or len(items) > 500 or len(json.dumps(items)) > 200_000:
        return jsonify(error="Invalid drawings payload", error_type="InputException"), 400
    with _drawings_lock:
        data = _load_drawings()
        if items:
            data[key] = items
        else:
            data.pop(key, None)
        tmp = DRAWINGS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(data), encoding="utf-8")
        tmp.replace(DRAWINGS_FILE)  # atomic: a crash never leaves a half-written file
    return jsonify(ok=True)


@app.get("/api/protections")
@require_login
def list_protections():
    since = request.args.get("since", default=-1, type=int)
    return jsonify(items=protections.list(), events=protections.events_since(since),
                   last_event=protections.last_event)


@app.post("/api/protections")
@require_login
def set_protection():
    b = request.get_json(force=True)
    if "tps" in b or "sls" in b:  # scale-out legs: [{id, price, qty}], qty in order units
        legs = {k: [{"id": leg.get("id"), "price": _price(leg.get("price")), "qty": leg.get("qty")}
                    for leg in (b.get(k) or []) if isinstance(leg, dict)][:50] for k in ("tps", "sls")}
        tps, sls = legs["tps"], legs["sls"]
    else:  # single TP / SL for the whole position
        tps = [{"price": _price(b.get("tp"))}] if b.get("tp") not in (None, "") else []
        sls = [{"price": _price(b.get("sl"))}] if b.get("sl") not in (None, "") else []
    started = time.perf_counter()
    rec = protections.set(b["exchange"], b["tradingsymbol"], b["product"], tps, sls)
    logging.getLogger("api").info("TP/SL saved for %s in %.0f ms", b["tradingsymbol"], (time.perf_counter() - started) * 1000)
    return jsonify(rec)


@app.post("/api/protections/remove")
@require_login
def remove_protection():
    b = request.get_json(force=True)
    protections.remove(b["exchange"], b["tradingsymbol"], b["product"])
    return jsonify(ok=True)


@app.get("/api/options/chain")
@require_login
def option_chain():
    name = request.args.get("underlying", "NIFTY").upper()
    if name not in UNDERLYINGS:
        return jsonify(error="Unknown underlying", error_type="InputException"), 400
    data = instruments.chain(name, request.args.get("expiry"))
    any_inst = next((s["CE"] or s["PE"] for s in data["strikes"]), None)
    return jsonify(underlying=name, spot=UNDERLYINGS[name]["spot"], exchange=UNDERLYINGS[name]["exchange"],
                   lot_size=any_inst["lot_size"] if any_inst else LOT_SIZES.get(name),
                   underlyings=list(UNDERLYINGS), **data)


INTERVAL_DAYS = {"minute": 7, "3minute": 20, "5minute": 30, "10minute": 60, "15minute": 90,
                 "30minute": 120, "60minute": 180, "day": 720}


@app.get("/api/historical/<int:token>/<interval>")
@require_login
def historical(token, interval):
    if interval not in INTERVAL_DAYS:
        return jsonify(error="Invalid interval", error_type="InputException"), 400
    to_dt = datetime.now()
    from_dt = to_dt - timedelta(days=INTERVAL_DAYS[interval])
    fmt = "%Y-%m-%d %H:%M:%S"
    return jsonify(broker.historical(token, interval, from_dt.strftime(fmt), to_dt.strftime(fmt)))


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5001"))
    host = os.getenv("HOST", "127.0.0.1")  # keep private; reach it through an SSH tunnel
    print(f"\n  Neo Terminal running at http://127.0.0.1:{port}  ({'DEMO / mock' if MOCK else 'LIVE'} mode)\n")
    app.run(host=host, port=port, debug=False, threaded=True)
