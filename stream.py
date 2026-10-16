"""Real-time market data and order updates from Kotak Neo.

Two upstream sockets are shared by every open browser tab:

* the market-data feed (``native_batch`` protocol): JSON control frames,
  little-endian binary tick packets, prices scaled by a per-exchange divider;
* the order feed (``/realtime``): JSON order and position updates.

Ticks are decoded here and pushed to browsers over Server-Sent Events,
coalesced for at most ~15 ms per tab. Order updates are forwarded too, so
fills show up (and TP/SL legs get linked) instantly.
"""
import json
import logging
import struct
import threading
import time

from neo import ID_TO_SEG, INDEX_BY_FEED_NAME, INDEX_NAMES, is_index_token, make_token, neo_symbol

log = logging.getLogger(__name__)

LIVE_PRICE_MAX_AGE = 3  # s: a tick older than this isn't trusted as the current price
PUSH_INTERVAL = 0.015  # coalesce ticks for at most ~one screen frame before pushing
SUB_CHUNK = 100  # tokens per subscribe frame
EVENTS = {"index": ("subscribeIndices", "unsubscribeIndices"),
          "scrip": ("subscribeScrips", "unsubscribeScrips"),
          "depth": ("subscribeDepth", "unsubscribeDepth")}
AUTH_OK = {1117, 1119}
AUTH_FAILED = 1120
SDK_DATE = "2026-08-07T09:41:17.667Z"

_HEADER = struct.Struct("<HHbBBBB")  # length, message code, exchange, level, reserved, seq, bitmask
_DEPTH_ROW = struct.Struct("<qii")    # qty, price, orders


def deframe(frame):
    """Split a binary batch into packets; each starts with its own total length."""
    off, out = 0, []
    while off + 2 <= len(frame):
        size = struct.unpack_from("<H", frame, off)[0]
        if size < _HEADER.size or off + size > len(frame):
            break  # truncated tail
        out.append(frame[off:off + size])
        off += size
    return out


def parse_packet(p, dividers):
    """Decode one packet into (segment, token or index name, quote dict), or None."""
    if len(p) < _HEADER.size + 4:
        return None
    _, code, exch_id, level, _, _, _ = _HEADER.unpack_from(p)
    seg = ID_TO_SEG.get(exch_id)
    if not seg:
        return None
    div = float(dividers.get(exch_id) or 100)

    def u32(o):
        return struct.unpack_from("<I", p, o)[0]

    def i32(o):
        return struct.unpack_from("<i", p, o)[0]

    def i64(o):
        return struct.unpack_from("<q", p, o)[0]

    if code == 7207:  # index
        if len(p) < 33:
            return None
        token = u32(9)
        name = p[66:87].split(b"\0", 1)[0].decode("utf-8", "ignore").strip() if len(p) >= 87 else ""
        close, value = i32(17) / div, i32(29) / div
        q = {"last_price": value, "ohlc": {"open": i32(13) / div, "high": i32(21) / div,
                                           "low": i32(25) / div, "close": close},
             "net_change": round(value - close, 2) if close else 0}
        return seg, (name or str(token), str(token)), q
    if code != 7208:
        return None
    if level == 1:  # mini touch line
        if len(p) < 45:
            return None
        return seg, str(u32(9)), {"last_price": u32(21) / div, "last_quantity": i64(25),
                                  "net_change": i32(41) / div}
    if level not in (2, 4, 8) or len(p) < 144:
        return None
    q = {"last_price": u32(69) / div, "last_quantity": i64(73), "average_price": u32(81) / div,
         "volume": i64(29), "buy_quantity": i64(13), "sell_quantity": i64(21),
         "ohlc": {"open": u32(53) / div, "high": u32(61) / div, "low": u32(65) / div, "close": u32(57) / div},
         "net_change": i32(115) / div, "oi": u32(103)}
    if level == 8:
        buys, sells = u32(89), u32(93)
        rows = []
        off = 144
        while len(rows) < buys + sells and off + _DEPTH_ROW.size <= len(p):
            qty, price, orders = _DEPTH_ROW.unpack_from(p, off)
            rows.append({"quantity": qty, "price": price / div, "orders": orders})
            off += _DEPTH_ROW.size
        q["depth"] = {"buy": rows[:buys][:5], "sell": rows[buys:][:5]}
    return seg, str(u32(9)), q


class _Client:
    def __init__(self):
        self.keys = set()
        self.depth_keys = set()  # only these get market depth
        self.dirty = set()
        self.orders = False
        self.status = True  # send status on first loop
        self.closed = False
        self.event = threading.Event()


class TickHub:
    def __init__(self, broker, key_to_token, token_to_key, on_order=None, watch_keys=None, on_tick=None):
        self.broker = broker
        self.watch_keys = watch_keys or (lambda: [])  # streamed even with no browser open (virtual TPs)
        self.on_tick = on_tick
        self.key_to_token = key_to_token
        self.token_to_key = token_to_key
        self.on_order = on_order
        self.clients = {}
        self.latest = {}
        self.lock = threading.RLock()
        self.status = "connecting"
        self.ws = None
        self.order_ws = None
        self.subscribed = {}  # neo symbol -> kind
        self.seen = {}        # key -> monotonic time of its last tick
        self.dividers = {}
        self._token_in_use = None

    # ----------------------------------------------------------- browser side
    def register(self, cid):
        """Each connection gets its own client. A browser that reconnects (network blip)
        reuses its cid: the old, probably dead connection is told to stop, so it can't
        swallow ticks meant for the new one or unregister it when it finally errors out."""
        with self.lock:
            old = self.clients.get(cid)
            client = self.clients[cid] = _Client()
            if old:
                old.closed = True
                old.event.set()
                client.keys, client.depth_keys = old.keys, old.depth_keys
                client.dirty = {k for k in client.keys if k in self.latest}
            return client

    def unregister(self, cid, client):
        with self.lock:
            if self.clients.get(cid) is client:
                del self.clients[cid]
                self._resubscribe()

    def set_keys(self, cid, keys, depth_keys=()):
        with self.lock:
            c = self.clients.get(cid)
            if not c:
                return False
            c.keys = set(keys)
            c.depth_keys = set(depth_keys) & c.keys
            c.dirty |= {k for k in c.keys if k in self.latest}  # immediate snapshot
            c.event.set()
            self._resubscribe()
            return True

    def stream(self, cid):
        client = self.register(cid)
        try:
            yield "retry: 2000\n\n"
            while not client.closed:
                if not client.event.wait(15):
                    yield "event: ping\ndata: {}\n\n"  # an event, not a comment: the browser's watchdog sees it
                    continue
                if client.closed:
                    break
                time.sleep(PUSH_INTERVAL)
                with self.lock:
                    client.event.clear()
                    ticks = {k: (self.latest[k] if k in client.depth_keys else
                                 {f: v for f, v in self.latest[k].items() if f != "depth"})
                             for k in client.dirty if k in self.latest}
                    client.dirty = set()
                    orders, client.orders = client.orders, False
                    status, client.status = client.status, False
                if status:
                    yield f"event: status\ndata: {json.dumps({'status': self.status})}\n\n"
                if ticks:
                    yield f"event: ticks\ndata: {json.dumps(ticks)}\n\n"
                if orders:
                    yield "event: order\ndata: {}\n\n"
        finally:
            self.unregister(cid, client)

    # ------------------------------------------------------------ fan-out
    def _publish(self, key, quote):
        prev = self.latest.get(key)
        if prev:
            if not quote.get("last_price"):  # no trade yet in this packet: keep the last known price
                quote = {**quote, "last_price": prev.get("last_price", 0)}
            if "depth" not in quote and "depth" in prev:
                quote = {**quote, "depth": prev["depth"]}
            quote = {**prev, **quote}
        self.latest[key] = quote
        self.seen[key] = time.monotonic()
        if self.on_tick and quote.get("last_price"):
            self.on_tick(key, quote["last_price"])
        for c in self.clients.values():
            if key in c.keys:
                c.dirty.add(key)
                c.event.set()

    def live_price(self, key):
        """The last traded price from the feed, if the feed is live and the tick is fresh."""
        q = self.latest.get(key)
        if self.status != "live" or not q or time.monotonic() - self.seen.get(key, 0) > LIVE_PRICE_MAX_AGE:
            return None
        return q.get("last_price") or None

    def _order_update(self, data=None):
        with self.lock:
            for c in self.clients.values():
                c.orders = True
                c.event.set()
        if self.on_order:
            threading.Thread(target=self.on_order, args=(data,), daemon=True).start()

    def _set_status(self, status):
        if status == self.status:
            return
        self.status = status
        with self.lock:
            for c in self.clients.values():
                c.status = True
                c.event.set()

    # ------------------------------------------------------- market data feed
    def _wanted(self):
        want = {}
        for c in self.clients.values():
            for k in c.keys:
                token = self.key_to_token(k)
                if not token:
                    continue
                kind = "index" if is_index_token(token) else "depth" if k in c.depth_keys else "scrip"
                ref = neo_symbol(token)
                if want.get(ref) != "depth":
                    want[ref] = kind
        for k in self.watch_keys():
            token = self.key_to_token(k)
            if token:
                want.setdefault(neo_symbol(token), "index" if is_index_token(token) else "scrip")
        return want

    def _send(self, ws, payload):
        try:
            ws.send(payload if isinstance(payload, str) else json.dumps(payload))
        except Exception as exc:  # socket closing; the reconnect will resubscribe
            log.info("feed send failed: %s", exc)

    def _resubscribe(self):
        ws = self.ws
        if not ws or self.status != "live":
            return
        want = self._wanted()
        drop, add = {}, {}
        for ref, kind in self.subscribed.items():
            if want.get(ref) != kind:
                drop.setdefault(kind, []).append(ref)
        for ref, kind in want.items():
            if self.subscribed.get(ref) != kind:
                add.setdefault(kind, []).append(ref)
        for kind, refs in drop.items():
            for i in range(0, len(refs), SUB_CHUNK):
                self._send(ws, {"event": EVENTS[kind][1], "inputtoken": ",".join(refs[i:i + SUB_CHUNK])})
        for kind, refs in add.items():
            for i in range(0, len(refs), SUB_CHUNK):
                self._send(ws, {"event": EVENTS[kind][0], "inputtoken": ",".join(refs[i:i + SUB_CHUNK])})
        self.subscribed = want

    def _key_for_packet(self, seg, ref):
        if isinstance(ref, tuple):  # index: (name, token)
            name, token = ref
            psym = INDEX_BY_FEED_NAME.get((seg, name.lower())) or (token if (seg, token) in INDEX_NAMES else None)
            return self.token_to_key(make_token(seg, psym)) if psym else None
        return self.token_to_key(make_token(seg, ref)) if ref.isdigit() else None

    def _on_open(self, ws):
        log.info("market feed connected")
        self.subscribed = {}
        self._send(ws, {"user": self.broker.ucc, "auth": self.broker.sid, "format": "native_batch",
                        "source": "NEOTRADEAPI", "platform": "Web", "version": "1.2.3", "sdk_version": 2,
                        "sdk_date": SDK_DATE, "conn_req_time": int(time.time() * 1000),
                        "sessionValidation": False})

    def _on_message(self, ws, message):
        if isinstance(message, (bytes, bytearray)):
            decoded = [parse_packet(p, self.dividers) for p in deframe(bytes(message))]
            with self.lock:
                for item in decoded:
                    if not item:
                        continue
                    seg, ref, quote = item
                    key = self._key_for_packet(seg, ref)
                    if key:
                        token = self.key_to_token(key)
                        self._publish(key, {"instrument_token": token, **quote})
            return
        try:
            msg = json.loads(message)
        except ValueError:
            return
        code = msg.get("message_code")
        if code in AUTH_OK:
            for name, info in (msg.get("exchanges") or {}).items():
                if isinstance(info, dict):
                    exch_id = info.get("value")
                    if exch_id is None:
                        exch_id = next((i for i, s in ID_TO_SEG.items() if s == name), None)
                    if exch_id is not None:
                        self.dividers[int(exch_id)] = info.get("divider") or 100
            if msg.get("format") == "native_fallback":
                log.warning("market feed downgraded to native_fallback; ticks can't be decoded")
                return
            if self.status != "live":
                self._set_status("live")
                with self.lock:
                    self._resubscribe()
        elif code == AUTH_FAILED:
            log.warning("market feed auth failed: %s", msg.get("message"))
        elif msg.get("error_code"):
            log.info("market feed: %s", msg)

    # -------------------------------------------------------------- order feed
    def _on_order_open(self, ws):
        log.info("order feed connected")
        b = self.broker
        self._send(ws, f"{{type:cn,Authorization:{b.access_token},Sid:{b.sid},src:WEB}}")

    def _on_order_message(self, ws, message):
        try:
            msg = json.loads(message)
        except (ValueError, TypeError):
            return
        if isinstance(msg, dict) and msg.get("type") in ("order", "position"):
            if hasattr(self.broker, "invalidate_positions"):
                self.broker.invalidate_positions()  # a fill may have changed them
            self._order_update(msg.get("data"))
        elif isinstance(msg, dict) and (msg.get("ak") == "ok" or msg.get("type") == "cn"):
            self.broker.order_feed_live = True

    # ----------------------------------------------------------------- loops
    def start(self):
        threading.Thread(target=self._run_feed, name="neo-feed", daemon=True).start()
        threading.Thread(target=self._run_orders, name="neo-order-feed", daemon=True).start()
        threading.Thread(target=self._watch_token, name="neo-feed-token", daemon=True).start()

    def _watch_token(self):
        # Re-login issues a new session: drop the old sockets so the loops reconnect.
        while True:
            time.sleep(2)
            if self.broker.access_token != self._token_in_use:
                for ws in (self.ws, self.order_ws):
                    if ws:
                        ws.close()
            with self.lock:  # picks up new virtual-TP instruments; sends nothing if unchanged
                self._resubscribe()

    def _run_feed(self):
        from websocket import WebSocketApp  # websocket-client

        backoff = 1
        while True:
            token = self.broker.access_token
            if not token:
                self._set_status("offline")
                time.sleep(1)
                continue
            self._token_in_use = token
            self._set_status("connecting")
            self.dividers = {}
            self.ws = WebSocketApp(self.broker.feed_url, on_open=self._on_open, on_message=self._on_message,
                                   on_error=lambda ws, err: log.warning("market feed: %s", err))
            started = time.time()
            self.ws.run_forever(ping_interval=20, ping_timeout=10)
            self.ws = None
            self.subscribed = {}
            self._set_status("connecting" if self.broker.access_token else "offline")
            backoff = 1 if time.time() - started > 60 else min(backoff * 2, 30)
            time.sleep(backoff)

    def _run_orders(self):
        from websocket import WebSocketApp

        backoff = 1
        while True:
            if not self.broker.access_token or not self.broker.order_feed_url:
                time.sleep(1)
                continue
            self.order_ws = WebSocketApp(self.broker.order_feed_url, on_open=self._on_order_open,
                                         on_message=self._on_order_message,
                                         on_error=lambda ws, err: log.warning("order feed: %s", err))
            started = time.time()
            self.order_ws.run_forever(ping_interval=20, ping_timeout=10)
            self.order_ws = None
            self.broker.order_feed_live = False
            backoff = 1 if time.time() - started > 60 else min(backoff * 2, 30)
            time.sleep(backoff)


class MockTickHub(TickHub):
    """Demo mode: synthesise ticks from MockNeo several times a second."""

    def __init__(self, broker, on_order=None, interval=0.25, watch_keys=None, on_tick=None):
        super().__init__(broker, lambda k: k, lambda t: t, on_order, watch_keys, on_tick)
        self.interval = interval

    def start(self):
        threading.Thread(target=self._run, name="mock-ticker", daemon=True).start()

    def _resubscribe(self):
        pass

    def _run(self):
        last_orders = None
        while True:
            time.sleep(self.interval)
            if not self.broker.access_token:
                self._set_status("offline")
                continue
            self._set_status("live")
            with self.lock:
                keys = set().union(*(c.keys for c in self.clients.values())) if self.clients else set()
            keys |= set(self.watch_keys())
            quotes = self.broker.quote(sorted(keys)) if keys else {}
            sig = [(o["order_id"], o["status"]) for o in self.broker.orders_list]
            with self.lock:
                for key, q in quotes.items():
                    self._publish(key, q)
            if last_orders is not None and sig != last_orders:
                self._order_update()
            last_orders = sig
