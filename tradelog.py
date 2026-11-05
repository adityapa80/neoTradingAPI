"""Daily fills log: keeps a copy of each day's executed trades and their TP/SL plans.

The broker APIs only return today's trades, so a background thread saves them to
data/trades/YYYY-MM-DD.json every few minutes while logged in. Fills are merged by
trade id and never removed, so a later failed or partial fetch cannot lose any.

Every TP/SL change is also recorded (the "plans" list) with its time, so the report
can tell the stop that was set when a trade was entered, whether it was moved, and
whether a trade ended on its target, its stop or a manual exit.
tradereport.py reads these files.
"""
import json
import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

log = logging.getLogger(__name__)

IST = timezone(timedelta(hours=5, minutes=30))
EVERY_SECONDS = 300
START, STOP = "09:10", "23:55"  # IST; outside this window there are no new fills to save
FIELDS = ("trade_id", "order_id", "exchange", "tradingsymbol", "transaction_type", "product",
          "quantity", "average_price", "fill_timestamp")
TRANCHE_FIELDS = ("qty", "tp", "sl", "tp_order_id", "sl_order_id", "tp_fired", "gtt_id")


class TradeLog:
    def __init__(self, broker, directory, broker_name, lookup=None):
        self.broker = broker
        self.dir = Path(directory)
        self.broker_name = broker_name
        self.lookup = lookup  # "EXCH:SYMBOL" -> instrument dict with lot_size
        self.lock = threading.Lock()
        self._plans = {}  # key -> last recorded plan, to record only changes

    def start(self):
        threading.Thread(target=self._run, name="tradelog", daemon=True).start()

    def _run(self):
        while True:
            now = datetime.now(IST)
            if START <= now.strftime("%H:%M") <= STOP and getattr(self.broker, "access_token", None):
                try:
                    self.save(now.date().isoformat())
                except Exception as exc:  # never let logging break the app
                    log.warning("trade log: %s", exc)
            time.sleep(EVERY_SECONDS)

    def _read(self, day):
        path = self.dir / f"{day}.json"
        data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        data.setdefault("broker", self.broker_name)
        data.setdefault("date", day)
        data.setdefault("fills", [])
        data.setdefault("plans", [])
        return data

    def _write(self, day, data):
        self.dir.mkdir(parents=True, exist_ok=True)
        path = self.dir / f"{day}.json"
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
        tmp.replace(path)

    def save(self, day):
        """Fetch today's fills and merge them into the day's file. Returns the fill count."""
        fills = self.broker.trades() or []
        with self.lock:
            data = self._read(day)
            known = {f["trade_id"]: f for f in data["fills"]}
            changed = False
            for t in fills:
                stamp = str(t.get("fill_timestamp") or "")
                if stamp[:10] and stamp[:10] != day:
                    continue  # a stray fill from another day
                row = {k: t.get(k) for k in FIELDS}
                row["fill_timestamp"] = stamp or None
                tid = str(row["trade_id"] or f'{row["order_id"]}-{stamp}-{row["quantity"]}')
                row["trade_id"] = tid
                inst = self.lookup(f'{row["exchange"]}:{row["tradingsymbol"]}') if self.lookup else None
                if inst:
                    row["lot_size"] = inst.get("lot_size")
                if known.get(tid) != row:
                    known[tid] = row
                    changed = True
            if changed:
                data["fills"] = sorted(known.values(), key=lambda f: (f["fill_timestamp"] or "", f["trade_id"]))
                self._write(day, data)
            return len(known)

    def record_plans(self, items):
        """Called on every TP/SL change: append the plans that changed to today's file."""
        now = datetime.now(IST)
        rows = []
        current = {}
        for key, rec in list(items.items()):
            plan = {"exchange": rec.get("exchange"), "tradingsymbol": rec.get("tradingsymbol"),
                    "product": rec.get("product"), "side": rec.get("side"),
                    "tranches": [{k: t.get(k) for k in TRANCHE_FIELDS if t.get(k) is not None}
                                 for t in rec.get("tranches", [])]}
            current[key] = plan
            if self._plans.get(key) != plan:
                rows.append(dict(plan, key=key))
        for key, plan in self._plans.items():
            if key not in current:
                rows.append({"key": key, "exchange": plan["exchange"], "tradingsymbol": plan["tradingsymbol"],
                             "product": plan["product"], "side": plan["side"], "tranches": [], "removed": True})
        self._plans = current
        if not rows:
            return
        stamp = now.strftime("%Y-%m-%d %H:%M:%S")
        day = now.date().isoformat()
        with self.lock:
            data = self._read(day)
            data["plans"].extend(dict(r, time=stamp) for r in rows)
            self._write(day, data)
