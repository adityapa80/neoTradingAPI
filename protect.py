"""Take-profit / stop-loss ("protection") for open trades, with scale-out exits.

A position can have several target (TP) legs and several stop (SL) legs, each
for a number of lots: e.g. TP 1 lot @ x and 2 lots @ y, with SL 3 lots @ z.
The legs are paired lot by lot into *tranches* - the nearest target with the
farthest stop - and every tranche is protected as one OCO unit.

Kotak Neo has no GTT, and its risk system treats a second exit order on the
same lots as a fresh short (it demands full margin and rejects it). So:

* TP and SL: only the SL order rests at the exchange. The TP is "virtual":
  this process watches every tick and, the moment the price reaches the target,
  modifies that SL order into a MARKET exit. One order per lot, so both legs
  can never fill and no extra margin is blocked.
* TP only: a resting LIMIT order. SL only: a resting SL order.

The stop is always a real exchange order, so the position stays protected if
this app goes down; only the target needs the app running.

When a tranche exits, its quantity leaves both sides together, so the remaining
stops always cover exactly the remaining lots. If the position shrinks some
other way (manual exit, partial booking) the legs farthest from the market are
trimmed first.
"""
import itertools
import json
import logging
import threading
import time
import uuid
from collections import deque

from neo import NeoError

log = logging.getLogger(__name__)

SL_LIMIT_BUFFER = 0.01   # SL legs use a limit 1% beyond the trigger so they fill on gaps
OPEN_STATUSES = {"OPEN", "TRIGGER PENDING", "AMO REQ RECEIVED", "OPEN PENDING", "VALIDATION PENDING",
                 "PUT ORDER REQ RECEIVED", "MODIFY PENDING", "MODIFY VALIDATION PENDING"}
LEG_NAMES = {"tp": "Target", "sl": "Stop-loss"}
LOT_IN_UNITS_EXCHANGES = {"NFO", "BFO"}  # quantities there are units; must be whole lots
MAX_UNITS_PER_SIDE = 10_000
CANCEL_CONFIRM_SECONDS = 3   # fallback exit: how long to wait for the broker to confirm the stop's cancel
CANCEL_POLL_SECONDS = 0.25
TP_RETRY_SECONDS = 5         # after an unconfirmed fallback, wait this long before trying the target again


def round_tick(price, tick):
    tick = tick or 0.05
    return round(round(price / tick) * tick, 4)


def new_id():
    return uuid.uuid4().hex[:8]


def legs_of(tranches, kind):
    """Collapse tranches back into the legs the user set (id, price, total qty)."""
    legs = {}
    for t in tranches:
        lid = t.get(f"{kind}_id")
        if lid and t.get(kind) is not None:
            leg = legs.setdefault(lid, {"id": lid, "price": t[kind], "qty": 0})
            leg["qty"] += t["qty"]
    return list(legs.values())


def build_tranches(tps, sls, long, lot):
    """Pair TP and SL legs lot by lot: nearest target with the farthest stop."""
    def ordered(legs):  # long: ascending = nearest TP first / farthest SL first; short: the mirror
        return sorted(legs, key=lambda leg: leg["price"], reverse=not long)

    def expand(legs):
        return [leg for leg in ordered(legs) for _ in range(leg["qty"] // lot)]

    tp_seq, sl_seq = expand(tps), expand(sls)
    out = []
    for i in range(max(len(tp_seq), len(sl_seq))):
        tp = tp_seq[i] if i < len(tp_seq) else None
        sl = sl_seq[i] if i < len(sl_seq) else None
        ids = (tp["id"] if tp else None, sl["id"] if sl else None)
        if out and (out[-1]["tp_id"], out[-1]["sl_id"]) == ids:
            out[-1]["qty"] += lot
        else:
            out.append({"tp_id": ids[0], "sl_id": ids[1], "tp": tp["price"] if tp else None,
                        "sl": sl["price"] if sl else None, "qty": lot})
    return out


def trim(legs, qty, long, kind):
    """Cut legs down to `qty` in total, removing quantity farthest from the market first."""
    excess = sum(leg["qty"] for leg in legs) - qty
    if excess <= 0:
        return legs
    out = {leg["id"]: dict(leg) for leg in legs}
    farthest_first = sorted(legs, key=lambda leg: leg["price"], reverse=(kind == "tp") == long)
    for leg in farthest_first:
        if excess <= 0:
            break
        cut = min(excess, leg["qty"])
        out[leg["id"]]["qty"] -= cut
        excess -= cut
    return [leg for leg in out.values() if leg["qty"] > 0]


class ProtectionManager:
    def __init__(self, broker, instruments, path=None):
        self.broker = broker
        self.instruments = instruments
        self.path = path
        self.items = {}
        self.events = deque(maxlen=100)
        self.event_ids = itertools.count(1)
        self.last_event = 0
        self.lock = threading.RLock()
        self._watch = {}      # "EXCH:SYMBOL" -> [(tp price, long)] for virtual targets
        self._firing = set()  # keys whose target is being executed right now
        self._load()
        self._rebuild_watch()

    # ------------------------------------------------------------ persistence
    def _load(self):
        if self.path and self.path.exists():
            try:
                self.items = json.loads(self.path.read_text())
            except (ValueError, OSError):
                self.items = {}

    # ------------------------------------------------------------ virtual TP
    def _rebuild_watch(self):
        watch = {}
        for rec in self.items.values():
            for t in rec["tranches"]:
                if t.get("tp_virtual") and t.get("tp") is not None and t.get("sl_order_id") and not t.get("tp_fired"):
                    watch.setdefault(f"{rec['exchange']}:{rec['tradingsymbol']}", []).append(
                        (t["tp"], rec["side"] == "LONG"))
        self._watch = watch

    def watch_keys(self):
        """Instruments whose ticks must stream even when no browser shows them."""
        return list(self._watch)

    def on_tick(self, key, ltp):
        """Called for every tick (keep it cheap). Fires a target the moment it is reached."""
        levels = self._watch.get(key)
        if not levels or not ltp or key in self._firing:
            return
        if any((ltp >= tp) if long else (ltp <= tp) for tp, long in levels):
            self._firing.add(key)
            threading.Thread(target=self._fire_targets, args=(key, ltp), name="tp-fire", daemon=True).start()

    def _fire_targets(self, key, ltp):
        try:
            with self.lock:
                changed = False
                for rec in self.items.values():
                    if f"{rec['exchange']}:{rec['tradingsymbol']}" != key:
                        continue
                    long = rec["side"] == "LONG"
                    for t in rec["tranches"]:
                        tp = t.get("tp")
                        if not t.get("tp_virtual") or tp is None or t.get("tp_fired") or not t.get("sl_order_id"):
                            continue
                        if not ((ltp >= tp) if long else (ltp <= tp)) or time.time() < t.get("tp_retry_after", 0):
                            continue
                        hit = f"LTP {ltp} {'≥' if long else '≤'} TP {tp}"
                        try:  # the resting stop becomes the exit: never two orders on the same lots
                            res = self.broker.modify_order("regular", t["sl_order_id"],
                                                           {"order_type": "MARKET", "quantity": t["qty"]}) or {}
                            t["sl_order_id"] = res.get("order_id") or t["sl_order_id"]
                            t["tp_fired"] = True
                            changed = True
                            self._event("success", f"Target reached on {rec['tradingsymbol']}",
                                        f"{hit}: exiting {t['qty']} at market.")
                        except NeoError as exc:
                            log.warning("virtual TP %s: modify refused (%s), falling back", key, exc.message)
                            changed |= self._fallback_exit(rec, t, hit, exc.message)
                if changed:
                    self._save()
                self._rebuild_watch()
        finally:
            self._firing.discard(key)

    def _order_status(self, order_id):
        o = next((x for x in self.broker.orders() if x["order_id"] == order_id), None)
        return (o["status"], o) if o else (None, None)

    def _fallback_exit(self, rec, t, hit, why):
        """The broker refused to turn the stop into a market exit. Cancel the stop, wait until
        the cancel is confirmed (only then is a new sell order not a second exit on the same
        lots), and sell at market. If the stop fills meanwhile, the position is already out.
        If the market exit is refused, put the stop back."""
        sym, sl_id = rec["tradingsymbol"], t["sl_order_id"]
        exit_side = "SELL" if rec["side"] == "LONG" else "BUY"
        status, order = self._order_status(sl_id)
        if status == "COMPLETE":
            return False  # the stop already filled; the next sync reports it
        if status not in OPEN_STATUSES:
            self._event("error", f"Target reached on {sym}, exit failed",
                        f"Couldn't modify the stop-loss ({why}) and it is {status or 'not found'}.")
            return False
        try:
            self.broker.cancel_order("regular", sl_id)
        except NeoError as exc:
            log.warning("fallback cancel %s: %s", sl_id, exc.message)  # may still have gone through
        deadline = time.time() + CANCEL_CONFIRM_SECONDS
        while True:
            status, order = self._order_status(sl_id)
            if status in ("CANCELLED", "COMPLETE", "REJECTED") or time.time() >= deadline:
                break
            time.sleep(CANCEL_POLL_SECONDS)
        if status == "COMPLETE":
            return False  # filled while cancelling: already exited
        if status not in ("CANCELLED", "REJECTED"):
            t["tp_retry_after"] = time.time() + TP_RETRY_SECONDS
            self._event("error", f"Target reached on {sym}, exit failed",
                        f"Couldn't modify the stop-loss ({why}) or confirm its cancel ({status}). "
                        f"Check the order book: the stop may still be working. Retrying in {TP_RETRY_SECONDS} s.")
            return False
        filled = (order or {}).get("filled_quantity") or 0
        qty = t["qty"] - filled
        t["sl_order_id"] = None  # cancelled: nothing protects these lots until the exit fills
        try:
            res = self.broker.place_order("regular", {
                "exchange": rec["exchange"], "tradingsymbol": sym, "transaction_type": exit_side,
                "order_type": "MARKET", "quantity": qty, "product": rec["product"], "validity": "DAY",
                "tag": "ktTP"})
            t["tp_order_id"] = res["order_id"]
            t["tp_fired"] = True
            self._event("success", f"Target reached on {sym}",
                        f"{hit}: stop-loss cancelled, exiting {qty} at market (the broker refused to modify the stop: {why}).")
            return True
        except NeoError as exc:
            log.warning("fallback exit %s refused: %s", sym, exc.message)
        t["tp"] = t["tp_id"] = None  # the broker won't take this exit: drop the target, don't loop on it
        try:  # never leave the lots unprotected: restore the stop
            restored = self._apply_tranche(None, t, rec, None, {})
            t["sl_order_id"] = restored["sl_order_id"]
            self._event("error", f"Target reached on {sym}, exit failed",
                        "The market exit was refused, so the target was removed and the stop-loss placed again. "
                        "Exit manually if you still want out.")
        except NeoError as exc:
            t["sl"] = t["sl_id"] = None
            self._event("error", f"{sym}: NO STOP-LOSS - exit manually",
                        f"The target exit was refused and the stop-loss could not be restored: {exc.message}")
        return True

    # ------------------------------------------------------- manual exits
    @staticmethod
    def _resting(rec):
        """Quantity of exit orders this manager has resting at the exchange for a trade."""
        return sum(t["qty"] for t in rec["tranches"] if t.get("sl_order_id")) + \
            sum(t["qty"] for t in rec["tranches"] if t.get("tp_order_id"))

    def make_room(self, exchange, symbol, product, side, qty):
        """Before the user exits `qty` of a protected trade by hand: Kotak's risk system rejects
        exit orders beyond the open quantity (it margins the excess as a fresh short), so shrink
        the resting TP/SL orders to the lots that will still be held. Legs farthest from the
        market go first. Returns what is needed to put them back if the exit doesn't happen."""
        with self.lock:
            key = self.key(exchange, symbol, product)
            rec = self.items.get(key)
            if not rec or side != ("SELL" if rec["side"] == "LONG" else "BUY"):
                return None
            held = abs(self.trade_quantity(exchange, symbol, product))
            if not held or self._resting(rec) + qty <= held:
                return None  # no clash: the exit fits next to the resting orders
            long = rec["side"] == "LONG"
            tps, sls = legs_of(rec["tranches"], "tp"), legs_of(rec["tranches"], "sl")
            keep = max(held - qty, 0)
            old = rec["tranches"]
            rec["tranches"] = []
            try:
                if keep:
                    lot = self._lot(exchange, symbol)
                    desired = build_tranches(trim(tps, keep, long, "tp"), trim(sls, keep, long, "sl"), long, lot)
                    self._reconcile(old, desired, rec, self._ltp(exchange, symbol))
                else:
                    self._reconcile(old, [], rec, None)
                rec["quantity"] = keep or rec["quantity"]
            finally:
                if rec["tranches"]:
                    self.items[key] = rec
                else:
                    self.items.pop(key, None)
                self._save()
                self._rebuild_watch()
            return {"key": key, "exchange": exchange, "tradingsymbol": symbol, "product": product,
                    "tps": tps, "sls": sls}

    def exit_placed(self, room, order_id):
        """The manual exit was accepted. If the exchange later rejects or cancels it, the
        watcher restores the TP/SL legs (see sync)."""
        if not room:
            return
        with self.lock:
            self._pending_room = getattr(self, "_pending_room", {})
            self._pending_room[order_id] = room

    def restore_room(self, room, why):
        """Put the TP/SL legs back as they were (trimmed to what is held now)."""
        if not room:
            return
        with self.lock:
            try:
                held = abs(self.trade_quantity(room["exchange"], room["tradingsymbol"], room["product"]))
                if not held:
                    return
                rec = self.items.get(room["key"])
                long = (rec["side"] == "LONG") if rec else self.trade_quantity(
                    room["exchange"], room["tradingsymbol"], room["product"]) > 0
                tps = [dict(leg) for leg in trim(room["tps"], held, long, "tp")]
                sls = [dict(leg) for leg in trim(room["sls"], held, long, "sl")]
                self.set(room["exchange"], room["tradingsymbol"], room["product"], tps, sls)
                self._event("info", f"TP / SL on {room['tradingsymbol']} restored", why)
            except NeoError as exc:
                self._event("error", f"{room['tradingsymbol']}: TP / SL could not be restored - set it again",
                            f"{why} {exc.message}")

    def _check_rooms(self, orders):
        for oid, room in list(getattr(self, "_pending_room", {}).items()):
            o = orders.get(oid)
            status = o["status"] if o else None
            if status in ("REJECTED", "CANCELLED"):
                del self._pending_room[oid]
                self.restore_room(room, f"Your exit order was {status.lower()}"
                                        + (f": {o['status_message']}" if o.get("status_message") else "."))
            elif status == "COMPLETE" or (status is None and oid not in orders and orders):
                del self._pending_room[oid]

    def manages(self, order_id):
        """True if the order is a TP/SL exit leg placed by this manager."""
        with self.lock:
            return any(order_id in (t.get("tp_order_id"), t.get("sl_order_id"))
                       for r in self.items.values() for t in r["tranches"])

    def _save(self):
        if self.path:
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.items, indent=1))
            tmp.replace(self.path)

    def _event(self, kind, title, text=""):
        self.last_event = next(self.event_ids)
        self.events.append({"id": self.last_event, "kind": kind, "title": title, "text": text})

    def events_since(self, since):
        return [e for e in self.events if e["id"] > since] if since >= 0 else []

    @staticmethod
    def view(rec):
        out = {k: v for k, v in rec.items() if k != "tranches"}
        out["tps"] = legs_of(rec["tranches"], "tp")
        out["sls"] = legs_of(rec["tranches"], "sl")
        out["tranches"] = [{k: t.get(k) for k in ("tp", "sl", "qty")} for t in rec["tranches"]]
        return out

    def list(self):
        with self.lock:
            return [self.view(r) for r in self.items.values()]

    # ---------------------------------------------------------------- lookups
    @staticmethod
    def key(exchange, symbol, product):
        return f"{exchange}:{symbol}:{product}"

    def trade_quantity(self, exchange, symbol, product, positions=None, holdings=None):
        """Signed open quantity for a trade, using the same rules as the UI."""
        positions = self._positions() if positions is None else positions
        qty = sum(p["quantity"] for p in positions
                  if p["exchange"] == exchange and p["tradingsymbol"] == symbol and p["product"] == product)
        if product == "CNC" and exchange in ("NSE", "BSE"):
            holdings = self.broker.holdings() if holdings is None else holdings
            for h in holdings:
                if h["tradingsymbol"] == symbol:
                    held = h["quantity"] + h.get("t1_quantity", 0) - h.get("used_quantity", 0)
                    return held + max(qty, 0)
        return qty

    def _positions(self):
        fetch = getattr(self.broker, "positions_cached", self.broker.positions)
        return fetch()["net"]

    def _lot(self, exchange, symbol):
        if exchange not in LOT_IN_UNITS_EXCHANGES:
            return 1
        inst = self.instruments.get(f"{exchange}:{symbol}")
        return inst["lot_size"] if inst else 1

    def _tick(self, exchange, symbol):
        inst = self.instruments.get(f"{exchange}:{symbol}")
        return inst["tick_size"] if inst else 0.05

    def _ltp(self, exchange, symbol):
        key = f"{exchange}:{symbol}"
        data = self.broker.ltp([key])
        if key not in data:
            raise NeoError(f"No price available for {key}", "InputException", 400)
        return data[key]["last_price"]

    # ------------------------------------------------------------------- set
    @staticmethod
    def _clean_legs(legs, full_qty):
        out = {}
        for leg in legs or []:
            if not leg or leg.get("price") in (None, ""):
                continue
            price = float(leg["price"])
            qty = full_qty if leg.get("qty") in (None, "") else int(leg["qty"])
            if price <= 0 or qty <= 0:
                raise NeoError("Prices and quantities must be positive", "InputException", 400)
            if price in out:  # two legs at the same price are one leg
                out[price]["qty"] += qty
            else:
                out[price] = {"id": str(leg.get("id") or new_id())[:16], "price": price, "qty": qty}
        return list(out.values())

    def set(self, exchange, symbol, product, tps, sls):
        """Replace the TP/SL legs of a trade. Each leg: {id?, price, qty?} (qty in order units; None = all)."""
        with self.lock:
            qty = self.trade_quantity(exchange, symbol, product)
            if qty == 0:
                raise NeoError(f"No open {product} quantity in {symbol} to protect", "InputException", 400)
            long, full = qty > 0, abs(qty)
            tps, sls = self._clean_legs(tps, full), self._clean_legs(sls, full)
            if not tps and not sls:
                self.remove(exchange, symbol, product)
                return None
            lot = self._lot(exchange, symbol)
            ltp = self._ltp(exchange, symbol)
            side = "long" if long else "short"
            for leg in tps:
                if (long and leg["price"] <= ltp) or (not long and leg["price"] >= ltp):
                    raise NeoError(f"Target {leg['price']} must be {'above' if long else 'below'} the current price ({ltp}) "
                                    f"for a {side} trade", "InputException", 400)
            for leg in sls:
                if (long and leg["price"] >= ltp) or (not long and leg["price"] <= ltp):
                    raise NeoError(f"Stop-loss {leg['price']} must be {'below' if long else 'above'} the current price ({ltp}) "
                                    f"for a {side} trade", "InputException", 400)
            for kind, legs in (("tp", tps), ("sl", sls)):
                total = sum(leg["qty"] for leg in legs)
                if total > full:
                    raise NeoError(f"{LEG_NAMES[kind]} quantity ({total}) is more than the open position ({full})",
                                    "InputException", 400)
                if total > MAX_UNITS_PER_SIDE:
                    raise NeoError("Too many units in one TP/SL set", "InputException", 400)
                for leg in legs:
                    if leg["qty"] % lot:
                        raise NeoError(f"{LEG_NAMES[kind]} quantity {leg['qty']} is not a whole number of lots ({lot})",
                                        "InputException", 400)

            key = self.key(exchange, symbol, product)
            old = self.items.get(key)
            rec = {"key": key, "exchange": exchange, "tradingsymbol": symbol, "product": product,
                   "mode": "oco", "side": "LONG" if long else "SHORT",
                   "quantity": full, "updated_at": int(time.time()), "tranches": []}
            try:
                self._reconcile(old["tranches"] if old else [], build_tranches(tps, sls, long, lot), rec, ltp)
            finally:  # record whatever is actually live at the broker, even after a partial failure
                if rec["tranches"]:
                    self.items[key] = rec
                else:
                    self.items.pop(key, None)
                self._save()
                self._rebuild_watch()
            return self.view(rec)

    def _reconcile(self, old, desired, rec, ltp):
        """Turn the live tranches `old` into `desired` with as few broker calls as possible."""
        live = rec["tranches"]
        pool = list(old)
        todo = []
        for d in desired:  # unchanged tranches are kept as they are
            same = next((o for o in pool if o.get("tp") == d["tp"] and o.get("sl") == d["sl"] and o["qty"] == d["qty"]), None)
            if same:
                pool.remove(same)
                live.append({**same, "tp_id": d["tp_id"], "sl_id": d["sl_id"]})
            else:
                todo.append(d)
        orders = {o["order_id"]: o for o in self.broker.orders()} if pool else {}
        try:
            for d in todo:  # reuse an existing order pair where possible (modify), else create
                o = pool.pop(0) if pool else None
                try:
                    live.append(self._apply_tranche(o, d, rec, ltp, orders))
                except Exception:
                    if o:
                        pool.insert(0, o)
                    raise
            while pool:
                self._drop_tranche(pool[0], rec, orders)
                pool.pop(0)
        except Exception:
            live.extend(pool)  # not dropped yet: still live at the broker
            raise

    def _apply_tranche(self, o, d, rec, ltp, orders):
        t = {k: d[k] for k in ("tp_id", "sl_id", "tp", "sl", "qty")}
        exit_side = "SELL" if rec["side"] == "LONG" else "BUY"
        tick = self._tick(rec["exchange"], rec["tradingsymbol"])
        for leg in ("tp", "sl"):
            oid = o.get(f"{leg}_order_id") if o else None
            is_open = bool(oid) and orders.get(oid, {}).get("status") in OPEN_STATUSES
            virtual = leg == "tp" and t["tp"] is not None and t["sl"] is not None
            if leg == "tp":
                t["tp_virtual"] = virtual
            if t[leg] is None or virtual:
                if is_open:
                    self._cancel_quietly(oid)
                t[f"{leg}_order_id"] = None
                continue
            if leg == "tp":
                params = {"order_type": "LIMIT", "price": t["tp"]}
            else:
                buf = -SL_LIMIT_BUFFER if exit_side == "SELL" else SL_LIMIT_BUFFER
                params = {"order_type": "SL", "trigger_price": t["sl"], "price": round_tick(t["sl"] * (1 + buf), tick)}
            params["quantity"] = t["qty"]
            if is_open:
                res = self.broker.modify_order("regular", oid, params) or {}
                t[f"{leg}_order_id"] = res.get("order_id") or oid  # Neo may renumber a modified order
            else:
                res = self.broker.place_order("regular", {
                    **params, "exchange": rec["exchange"], "tradingsymbol": rec["tradingsymbol"],
                    "transaction_type": exit_side, "product": rec["product"], "validity": "DAY",
                    "tag": "ktTP" if leg == "tp" else "ktSL"})
                t[f"{leg}_order_id"] = res["order_id"]
        return t

    def _drop_tranche(self, t, rec, orders=None):
        if orders is None:
            orders = {o["order_id"]: o for o in self.broker.orders()}
        for leg in ("tp", "sl"):
            oid = t.get(f"{leg}_order_id")
            if oid and orders.get(oid, {}).get("status") in OPEN_STATUSES:
                self._cancel_quietly(oid)

    def _cancel_quietly(self, order_id):
        try:
            self.broker.cancel_order("regular", order_id)
        except NeoError as exc:
            log.info("cancel %s failed: %s", order_id, exc.message)

    # ---------------------------------------------------------------- remove
    def remove(self, exchange, symbol, product):
        with self.lock:
            rec = self.items.pop(self.key(exchange, symbol, product), None)
            self._save()
            self._rebuild_watch()
            if not rec:
                return
            orders = {o["order_id"]: o for o in self.broker.orders()}
            for t in rec["tranches"]:
                self._drop_tranche(t, rec, orders)

    # --------------------------------------------------------------- watcher
    def sync(self):
        with self.lock:
            if not self.broker.access_token or not (self.items or getattr(self, "_pending_room", None)):
                return
            changed = False
            orders = {o["order_id"]: o for o in self.broker.orders()}
            self._check_rooms(orders)
            positions = self._positions()
            holdings = (self.broker.holdings() if any(r["product"] == "CNC" for r in self.items.values()) else [])
            for key, rec in list(self.items.items()):
                sym = rec["tradingsymbol"]
                keep = []
                for t in rec["tranches"]:
                    legs = {leg: orders.get(t.get(f"{leg}_order_id")) for leg in ("tp", "sl")}
                    done = next((leg for leg, o in legs.items() if o and o["status"] == "COMPLETE"), None)
                    if done:
                        other = "sl" if done == "tp" else "tp"
                        if legs[other] and legs[other]["status"] in OPEN_STATUSES:
                            self._cancel_quietly(legs[other]["order_id"])
                        changed = True
                        if t.get("tp_fired"):  # the stop order was turned into the target's market exit
                            self._event("success", f"Target hit on {sym}",
                                        f"Exited {t['qty']} @ {legs[done]['average_price']}; stop-loss done with it.")
                        else:
                            self._event("success", f"{LEG_NAMES[done]} hit on {sym}",
                                        f"Exited {t['qty']} @ {legs[done]['average_price']}"
                                        + (f"; matching {LEG_NAMES[other].lower()} cancelled." if legs[other] else "."))
                        continue
                    for leg, o in legs.items():
                        if o and o["status"] in ("REJECTED", "CANCELLED"):
                            changed = True
                            t[leg] = t[f"{leg}_id"] = t[f"{leg}_order_id"] = None
                            if o["status"] == "REJECTED":
                                self._event("error", f"{LEG_NAMES[leg]} order for {sym} rejected", o.get("status_message") or "")
                            else:
                                self._event("info", f"{LEG_NAMES[leg]} order for {sym} was cancelled")
                    if t.get("tp") is not None and t.get("sl") is None and not t.get("tp_order_id"):
                        try:  # the stop is gone: the target can't stay virtual, so rest it at the exchange
                            t = self._apply_tranche(None, t, rec, None, orders)
                            changed = True
                        except NeoError as exc:
                            t["tp"] = t["tp_id"] = None
                            self._event("error", f"Couldn't place the target for {sym}", exc.message)
                    if t.get("tp") is not None or t.get("sl") is not None:
                        keep.append(t)
                rec["tranches"] = keep

                qty = self.trade_quantity(rec["exchange"], sym, rec["product"], positions, holdings)
                long = rec["side"] == "LONG"
                if not keep or qty == 0 or (qty > 0) != long:
                    for t in keep:
                        self._drop_tranche(t, rec, orders)
                    del self.items[key]
                    changed = True
                    if keep:
                        self._event("info", f"{sym} position closed", "Its remaining TP/SL orders were cancelled.")
                    continue
                full = abs(qty)
                if full != rec["quantity"]:
                    rec["quantity"] = full
                    changed = True
                tps, sls = legs_of(keep, "tp"), legs_of(keep, "sl")
                if sum(leg["qty"] for leg in tps) > full or sum(leg["qty"] for leg in sls) > full:
                    lot = self._lot(rec["exchange"], sym)
                    desired = build_tranches(trim(tps, full, long, "tp"), trim(sls, full, long, "sl"), long, lot)
                    rec["tranches"] = []
                    changed = True
                    try:
                        self._reconcile(keep, desired, rec, self._ltp(rec["exchange"], sym))
                        self._event("info", f"TP/SL on {sym} resized", f"Now covers {full} qty.")
                    except NeoError as exc:
                        self._event("error", f"Couldn't resize TP/SL on {sym}", exc.message)
                    if not rec["tranches"]:
                        del self.items[key]
            if changed:
                self._save()
            self._rebuild_watch()
        # Backstop for the tick trigger (e.g. while the feed reconnects): use the positions' LTP.
        for p in positions:
            key = f"{p['exchange']}:{p['tradingsymbol']}"
            if key in self._watch:
                self.on_tick(key, p.get("last_price"))

    def start(self, interval=3):
        def run():
            while True:
                time.sleep(interval)
                try:
                    self.sync()
                except NeoError as exc:
                    log.info("protection sync: %s", exc.message)
                except Exception:  # keep the watcher alive no matter what
                    log.exception("protection sync crashed")
        threading.Thread(target=run, name="tp-sl-watcher", daemon=True).start()
