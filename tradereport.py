"""Points vs P&L report from the daily fills log (data/trades/*.json, written by tradelog.py).

A trade runs from flat to flat in one contract, so partial entries and exits count as one
trade. For each trade:
  points = average exit price - average entry price (per unit, sign flipped for shorts)
  P&L    = money made = points x quantity
For each day it compares the points you caught with the money you made, and works out the
"same-size P&L": what the day would have made with every trade at the day's average
size. The gap between the two is what your position sizing added or cost.
Points are only added up within one index: a SENSEX point is worth far less of a move
than a NIFTY point, so the two are shown side by side, never summed.

Risk: from the TP/SL changes the app logs, each trade gets the stop that was set when it
was entered (its planned risk in points), whether that stop was moved, and how it ended:
TP, SL or a manual exit. R = points won or lost / planned risk, so -1R is a normal stop-out
and anything worse than about -1.1R lost more than the plan allowed.

Usage:  python tradereport.py [DIR ...] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--trades] [--csv FILE]
DIR defaults to data/trades next to this file. Pass several to combine brokers.
"""
import argparse
import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

# Estimated charges for index options, per side. Brokers change these, so check a contract
# note and edit if they differ. Net P&L here is an estimate; the contract note is exact.
CHARGES = {
    "brokerage_per_order": 20.0,             # flat per executed order
    "stt_sell": 0.0015,                      # on sell premium
    "exchange_txn": {"NFO": 0.0003503, "BFO": 0.000325},  # on premium, both sides
    "sebi": 0.000001,                        # Rs 10 per crore, both sides
    "stamp_buy": 0.00003,                    # on buy premium
    "gst": 0.18,                             # on brokerage + exchange + SEBI
}


def underlying(symbol):
    m = re.match(r"[A-Z&-]+?(?=\d)", symbol)
    return m.group(0) if m else symbol


def load(dirs, start, end):
    fills, plans = [], []
    for d in dirs:
        for path in sorted(Path(d).glob("*.json")):
            day = path.stem
            if (start and day < start) or (end and day > end):
                continue
            data = json.loads(path.read_text(encoding="utf-8"))
            for f in data["fills"]:
                fills.append(dict(f, broker=data.get("broker", "?"), day=data.get("date", day)))
            for pl in data.get("plans", []):
                plans.append(dict(pl, broker=data.get("broker", "?"), day=data.get("date", day)))
    return fills, plans


def round_trips(fills):
    """Group fills into flat-to-flat trades per broker, day and contract."""
    by_contract = defaultdict(list)
    for f in fills:
        by_contract[(f["broker"], f["day"], f["exchange"], f["tradingsymbol"])].append(f)
    trades = []
    for (broker, day, exch, sym), rows in by_contract.items():
        rows.sort(key=lambda f: (f["fill_timestamp"] or "", f["trade_id"]))
        pos, cur = 0, None
        for f in rows:
            sign = 1 if f["transaction_type"] == "BUY" else -1
            left, price = int(f["quantity"]), float(f["average_price"])
            while left:
                if pos == 0:
                    cur = {"broker": broker, "day": day, "exchange": exch, "symbol": sym,
                           "underlying": underlying(sym), "side": "LONG" if sign > 0 else "SHORT",
                           "lot_size": f.get("lot_size"), "open": f["fill_timestamp"],
                           "entry_qty": 0, "entry_val": 0.0, "exit_qty": 0, "exit_val": 0.0,
                           "buy_val": 0.0, "sell_val": 0.0, "max_qty": 0, "orders": set(), "exits": []}
                # quantity that adds to the position, or closes it (a reversal splits the fill)
                qty = left if pos == 0 or (pos > 0) == (sign > 0) else min(left, abs(pos))
                adding = pos == 0 or (pos > 0) == (sign > 0)
                cur["entry_qty" if adding else "exit_qty"] += qty
                cur["entry_val" if adding else "exit_val"] += qty * price
                cur["buy_val" if sign > 0 else "sell_val"] += qty * price
                if not adding:
                    cur["exits"].append((f["order_id"], qty, price))
                cur["orders"].add((f["order_id"], f["transaction_type"]))
                pos += sign * qty
                left -= qty
                cur["max_qty"] = max(cur["max_qty"], abs(pos))
                cur["close"] = f["fill_timestamp"]
                if pos == 0:
                    trades.append(finish(cur))
                    cur = None
        if cur:  # still open at the end of the log: carried, not counted
            cur["open_end"] = True
            trades.append(finish(cur))
    trades.sort(key=lambda t: (t["day"], t["open"] or ""))
    return trades


PLAN_LEAD_SECONDS = 120  # a stop saved this long before the entry fill still counts as its plan
NEAR = 0.015             # no order-id match: an exit within 1.5% of a TP/SL price counts as that leg


def _secs(stamp):
    h, m, sec = (stamp or "00:00:00")[11:19].split(":")
    return int(h) * 3600 + int(m) * 60 + int(sec)


def _avg_price(plan, leg):
    rows = [(t[leg], t.get("qty") or 0) for t in plan.get("tranches", []) if t.get(leg) is not None]
    qty = sum(q for _, q in rows)
    return (sum(p * q for p, q in rows) / qty if qty else rows[0][0]) if rows else None


def attach_plans(trades, plans):
    """Give each trade its planned stop, final stop and exit type from the logged TP/SL plans."""
    by_contract = defaultdict(list)
    for pl in plans:
        by_contract[(pl["broker"], pl["day"], pl["exchange"], pl["tradingsymbol"])].append(pl)
    for t in trades:
        t.update(init_sl=None, final_sl=None, risk_pts=None, r=None, sl_moves=0, exit_type=None, over_plan=None)
        if t.get("open_end"):
            continue
        start, end = _secs(t["open"]) - PLAN_LEAD_SECONDS, _secs(t["close"])
        window = sorted((pl for pl in by_contract.get((t["broker"], t["day"], t["exchange"], t["symbol"]), [])
                         if start <= _secs(pl["time"]) <= end), key=lambda pl: pl["time"])
        sls = [_avg_price(pl, "sl") for pl in window if not pl.get("removed")]
        sls = [x for x in sls if x is not None]
        roles = {}  # order id -> TP / SL
        for pl in window:
            for tr in pl.get("tranches", []):
                if tr.get("tp_order_id"):
                    roles[str(tr["tp_order_id"])] = "TP"
                if tr.get("sl_order_id"):
                    roles[str(tr["sl_order_id"])] = "TP" if tr.get("tp_fired") else "SL"
        last = next((pl for pl in reversed(window) if pl.get("tranches")), None)
        tps = [tr["tp"] for tr in (last or {}).get("tranches", []) if tr.get("tp") is not None]
        stops = [tr["sl"] for tr in (last or {}).get("tranches", []) if tr.get("sl") is not None]
        kinds = defaultdict(int)
        for oid, qty, price in t["exits"]:
            kind = roles.get(str(oid))
            if not kind:
                def near(levels):
                    return any(abs(price - lv) <= NEAR * lv for lv in levels)
                kind = "SL" if near(stops) else "TP" if near(tps) else "manual"
            kinds[kind] += qty
        t["exit_type"] = "+".join(k for k in ("TP", "SL", "manual") if kinds.get(k))
        long = t["side"] == "LONG"
        if sls:
            t["init_sl"], t["final_sl"] = sls[0], sls[-1]
            t["sl_moves"] = sum(1 for a, b in zip(sls, sls[1:]) if abs(a - b) > 1e-9)
            risk = (t["entry_avg"] - sls[0]) if long else (sls[0] - t["entry_avg"])
            if risk > 0:
                t["risk_pts"] = risk
                t["r"] = t["points"] / risk
                if t["points"] < 0:
                    t["over_plan"] = -t["points"] - risk  # > 0: lost more than the stop allowed
    return trades


def _widened(t):
    if t["final_sl"] is None or t["init_sl"] is None:
        return False
    return t["final_sl"] < t["init_sl"] if t["side"] == "LONG" else t["final_sl"] > t["init_sl"]


def risk_summary(trades):
    closed = [t for t in trades if not t.get("open_end")]
    won = [t for t in closed if t["points"] > 0]
    lost = [t for t in closed if t["points"] < 0]

    def avg(xs):
        return sum(xs) / len(xs) if xs else None
    r = {"n": len(closed), "won": len(won), "lost": len(lost),
         "avg_win": avg([t["points"] for t in won]), "avg_loss": avg([-t["points"] for t in lost]),
         "best": max((t["points"] for t in closed), default=None),
         "worst": min((t["points"] for t in closed), default=None),
         "with_sl": sum(t["init_sl"] is not None for t in closed),
         "avg_risk": avg([t["risk_pts"] for t in closed if t["risk_pts"]]),
         "avg_r_win": avg([t["r"] for t in won if t["r"] is not None]),
         "avg_r_loss": avg([t["r"] for t in lost if t["r"] is not None]),
         "loss_exits": defaultdict(int),
         "over_plan": [t for t in lost if t["over_plan"] is not None
                       and t["over_plan"] > max(1.0, 0.1 * t["risk_pts"])],
         "widened": sum(1 for t in closed if _widened(t)),
         "no_sl_losses": sum(1 for t in lost if t["init_sl"] is None),
         "expectancy": sum(t["points"] for t in closed) / len(closed) if closed else None}
    for t in lost:
        r["loss_exits"][t["exit_type"] or "?"] += 1
    r["win_rate"] = len(won) / len(closed) if closed else None
    if r["avg_win"] and r["avg_loss"]:
        r["rr"] = r["avg_win"] / r["avg_loss"]
        r["breakeven"] = 1 / (1 + r["rr"])
    else:
        r["rr"] = r["breakeven"] = None
    return r


def print_risk(r, indent="  "):
    if not r["n"]:
        return

    def f(v, spec):
        return "-" if v is None else format(v, spec)

    def pct(v):
        return "-" if v is None else f"{v * 100:.0f}%"
    print(f"{indent}risk:")
    print(f"{indent}  points won per winner  {f(r['avg_win'], '+.2f'):>8}   best trade  {f(r['best'], '+.2f')}")
    print(f"{indent}  points lost per loser  {f(-r['avg_loss'] if r['avg_loss'] else None, '+.2f'):>8}"
          f"   worst trade {f(r['worst'], '+.2f')}")
    print(f"{indent}  reward : risk          {f(r['rr'], '.2f'):>8}   (avg points won / avg points lost)")
    print(f"{indent}  win rate               {pct(r['win_rate']):>8}   needed to break even at this "
          f"reward:risk: {pct(r['breakeven'])}")
    print(f"{indent}  expectancy             {f(r['expectancy'], '+.2f'):>8}   points per trade")
    print(f"{indent}  stop set at entry      {r['with_sl']} of {r['n']} trades, "
          f"planned risk {f(r['avg_risk'], '.2f')} pts on average")
    if r["avg_r_win"] is not None or r["avg_r_loss"] is not None:
        print(f"{indent}  in R (planned risk)    winners {f(r['avg_r_win'], '+.2f')}R, "
              f"losers {f(r['avg_r_loss'], '+.2f')}R")
    if r["lost"]:
        exits = ", ".join(f"{n} {k}" for k, n in sorted(r["loss_exits"].items(), key=lambda x: -x[1]))
        print(f"{indent}  losing trades ended by {exits}")
    if r["over_plan"]:
        print(f"{indent}  ! {len(r['over_plan'])} loss(es) bigger than the stop that was set")
    if r["widened"]:
        print(f"{indent}  ! {r['widened']} trade(s) with the stop moved further away")
    if r["no_sl_losses"]:
        print(f"{indent}  ! {r['no_sl_losses']} loss(es) with no stop set")


def charges(t):
    c = CHARGES
    txn = c["exchange_txn"].get(t["exchange"], 0.00035)
    turnover = t["buy_val"] + t["sell_val"]
    brokerage = c["brokerage_per_order"] * len(t["orders"])
    exchange = turnover * txn
    sebi = turnover * c["sebi"]
    return (brokerage + exchange + sebi + t["sell_val"] * c["stt_sell"] + t["buy_val"] * c["stamp_buy"]
            + (brokerage + exchange + sebi) * c["gst"])


def finish(t):
    entry = t["entry_val"] / t["entry_qty"]
    exit_ = t["exit_val"] / t["exit_qty"] if t["exit_qty"] else None
    t["entry_avg"], t["exit_avg"] = entry, exit_
    t["points"] = None if exit_ is None else (exit_ - entry) * (1 if t["side"] == "LONG" else -1)
    t["qty"] = t["entry_qty"]
    t["lots"] = t["qty"] / t["lot_size"] if t.get("lot_size") else None
    t["pnl"] = t["sell_val"] - t["buy_val"]
    t["charges"] = charges(t)
    t["n_orders"] = len(t.pop("orders"))
    return t


def size_label(t):
    return f'{t["lots"]:g} lot' if t["lots"] is not None else f'{t["qty"]} qty'


def day_summary(trades):
    closed = [t for t in trades if not t.get("open_end")]
    s = {"trades": len(closed), "open": len(trades) - len(closed),
         "wins": sum(t["points"] > 0 for t in closed), "losses": sum(t["points"] < 0 for t in closed),
         "points": sum(t["points"] for t in closed), "pnl": sum(t["pnl"] for t in closed),
         "charges": sum(t["charges"] for t in closed)}
    s["net"] = s["pnl"] - s["charges"]
    # same-size P&L: each underlying's trades at that underlying's average size for the day
    same, by_und = 0.0, defaultdict(list)
    for t in closed:
        by_und[t["underlying"]].append(t)
    for und_trades in by_und.values():
        avg_qty = sum(t["qty"] for t in und_trades) / len(und_trades)
        same += sum(t["points"] for t in und_trades) * avg_qty
    s["same_size"] = same
    s["sizing"] = s["pnl"] - same
    lots = all(t["lots"] is not None for t in closed)
    s["size_unit"] = "lots" if lots else "qty"
    avg = lambda xs: sum(xs) / len(xs) if xs else None
    won = [t for t in closed if t["points"] > 0]
    lost = [t for t in closed if t["points"] < 0]
    s["avg_size_win"] = avg([t["lots" if lots else "qty"] for t in won])
    s["avg_size_loss"] = avg([t["lots" if lots else "qty"] for t in lost])
    s["avg_pts_win"], s["avg_pts_loss"] = avg([t["points"] for t in won]), avg([t["points"] for t in lost])
    s["avg_pnl_win"], s["avg_pnl_loss"] = avg([t["pnl"] for t in won]), avg([t["pnl"] for t in lost])
    s["by_und"] = {u: (sum(t["points"] for t in ts), sum(t["pnl"] for t in ts), len(ts))
                   for u, ts in by_und.items()}
    s["verdict"] = verdict(s)
    return s


def verdict(s):
    if not s["trades"]:
        return "no closed trades"
    pts, gross, net = s["same_size"], s["pnl"], s["net"]  # same-size P&L: points in rupees at constant size
    if pts > 0 and gross < 0:
        return "SIZING: caught points but lost money - losers were bigger than winners"
    if pts < 0 and gross > 0:
        return "sizing helped: lost points but made money - winners were bigger"
    if pts > 0 and gross >= 0 > net:
        return "CHARGES: made money before charges, lost after - too many orders for the gain"
    if pts <= 0 and gross <= 0:
        return "STRATEGY: lost points (entries/exits), not a sizing problem"
    return "good day"


def print_by_index(trades):
    """Points, average winner / loser and risk for each index on its own."""
    by_und = defaultdict(list)
    for t in trades:
        if not t.get("open_end"):
            by_und[t["underlying"]].append(t)
    fmt = lambda v, f: "-" if v is None else format(v, f)
    for u, ts in sorted(by_und.items()):
        s = day_summary(ts)
        print(f"  {u} points {s['points']:+9.2f}   P&L {rupees(s['pnl'])}   "
              f"({s['trades']} trades, {s['wins']} won, {s['losses']} lost)")
        print(f"    average winner   {fmt(s['avg_pts_win'], '+.2f')} pts, {fmt(s['avg_size_win'], '.1f')} "
              f"{s['size_unit']}, Rs {fmt(s['avg_pnl_win'], '+,.0f')}")
        print(f"    average loser    {fmt(s['avg_pts_loss'], '+.2f')} pts, {fmt(s['avg_size_loss'], '.1f')} "
              f"{s['size_unit']}, Rs {fmt(s['avg_pnl_loss'], '+,.0f')}")
        print_risk(risk_summary(ts), indent="    ")


def rupees(x):
    return f"{x:>+12,.0f}"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dirs", nargs="*", default=[str(Path(__file__).parent / "data" / "trades")])
    ap.add_argument("--from", dest="start")
    ap.add_argument("--to", dest="end")
    ap.add_argument("--trades", action="store_true", help="list every trade, not just the day totals")
    ap.add_argument("--csv", help="also write every trade to this CSV file")
    args = ap.parse_args()

    fills, plans = load(args.dirs, args.start, args.end)
    trades = attach_plans(round_trips(fills), plans)
    if not trades:
        print("No fills logged for that range.")
        return
    days = defaultdict(list)
    for t in trades:
        days[(t["day"], t["broker"])].append(t)

    totals = defaultdict(float)
    kinds = defaultdict(int)
    for (day, broker), ts in sorted(days.items()):
        s = day_summary(ts)
        print(f"\n=== {day}  {broker}  -  {s['trades']} trades ({s['wins']} won, {s['losses']} lost)"
              + (f", {s['open']} still open (not counted)" if s["open"] else ""))
        if args.trades:
            for t in ts:
                if t.get("open_end"):
                    print(f'  {(t["open"] or "")[11:16]}        {t["symbol"]:<22} {t["side"]:<5} '
                          f'{t["max_qty"] if t["lots"] is None else t["max_qty"] / t["lot_size"]:>5g} '
                          f'{"lot" if t["lots"] is not None else "qty"}  {t["entry_avg"]:8.2f} -> still open')
                    continue
                if t["risk_pts"]:
                    risk = f'SL {t["risk_pts"]:5.2f} pts'
                else:
                    risk = "no SL" if t["init_sl"] is None else "SL in profit"
                r = f'{t["r"]:+5.2f}R' if t["r"] is not None else ""
                extra = (" moved SL" if t["sl_moves"] else "") + \
                    (f' lost {t["over_plan"]:.2f} more than SL' if t["over_plan"] and t["over_plan"] > 0.5 else "")
                print(f'  {(t["open"] or "")[11:16]}-{(t.get("close") or "")[11:16]}  {t["symbol"]:<22} '
                      f'{t["side"]:<5} {size_label(t):>9}  {t["entry_avg"]:8.2f} -> '
                      f'{t["exit_avg"]:8.2f}  pts {t["points"]:+7.2f}  P&L {rupees(t["pnl"])}  '
                      f'{risk:<12} {r:>6}  {t["exit_type"] or "":<9}{extra}')
        print_by_index(ts)
        print(f"  gross P&L        {rupees(s['pnl'])}")
        print(f"  est. charges     {rupees(-s['charges'])}")
        print(f"  net P&L          {rupees(s['net'])}")
        print(f"  same-size P&L    {rupees(s['same_size'])}   (every trade at the day's average size)")
        print(f"  sizing effect    {rupees(s['sizing'])}   (gross minus same-size)")
        print(f"  -> {s['verdict']}")
        for k in ("pnl", "charges", "net", "same_size", "sizing", "trades", "wins", "losses"):
            totals[k] += s[k]
        kinds[s["verdict"].split(":")[0]] += 1

    if len(days) > 1:
        print(f"\n=== ALL {len(days)} days  -  {int(totals['trades'])} trades "
              f"({int(totals['wins'])} won, {int(totals['losses'])} lost)")
        for k, label in (("pnl", "gross P&L"), ("charges", "est. charges"), ("net", "net P&L"),
                         ("same_size", "same-size P&L"), ("sizing", "sizing effect")):
            v = -totals[k] if k == "charges" else totals[k]
            print(f"  {label:<16} {rupees(v)}")
        print("  days: " + ", ".join(f"{n} {k}" for k, n in sorted(kinds.items(), key=lambda x: -x[1])))
        print_by_index(trades)

    if args.csv:
        cols = ["day", "broker", "symbol", "underlying", "side", "open", "close", "qty", "lot_size", "lots",
                "entry_avg", "exit_avg", "points", "pnl", "charges", "n_orders",
                "init_sl", "final_sl", "risk_pts", "r", "sl_moves", "exit_type", "over_plan"]
        with open(args.csv, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(cols + ["still_open"])
            for t in trades:
                w.writerow([round(t[c], 2) if isinstance(t.get(c), float) else t.get(c) for c in cols]
                           + [bool(t.get("open_end"))])
        print(f"\nWrote {len(trades)} trades to {args.csv}")


if __name__ == "__main__":
    sys.exit(main())
