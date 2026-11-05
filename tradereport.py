"""Points vs P&L report from the daily fills log (data/trades/*.json, written by tradelog.py).

A trade runs from flat to flat in one contract, so partial entries and exits count as one
trade. For each trade:
  points = average exit price - average entry price (per unit, sign flipped for shorts)
  P&L    = money made = points x quantity
For each day it compares the points you caught with the money you made, and works out the
"same-size P&L": what the day would have made with every trade at the day's average
size. The gap between the two is what your position sizing added or cost.

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
    fills = []
    for d in dirs:
        for path in sorted(Path(d).glob("*.json")):
            day = path.stem
            if (start and day < start) or (end and day > end):
                continue
            data = json.loads(path.read_text(encoding="utf-8"))
            for f in data["fills"]:
                fills.append(dict(f, broker=data.get("broker", "?"), day=data.get("date", day)))
    return fills


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
                           "buy_val": 0.0, "sell_val": 0.0, "max_qty": 0, "orders": set()}
                # quantity that adds to the position, or closes it (a reversal splits the fill)
                qty = left if pos == 0 or (pos > 0) == (sign > 0) else min(left, abs(pos))
                adding = pos == 0 or (pos > 0) == (sign > 0)
                cur["entry_qty" if adding else "exit_qty"] += qty
                cur["entry_val" if adding else "exit_val"] += qty * price
                cur["buy_val" if sign > 0 else "sell_val"] += qty * price
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
    pts, gross, net = s["points"], s["pnl"], s["net"]
    if pts > 0 and gross < 0:
        return "SIZING: caught points but lost money - losers were bigger than winners"
    if pts < 0 and gross > 0:
        return "sizing helped: lost points but made money - winners were bigger"
    if pts > 0 and gross >= 0 > net:
        return "CHARGES: made money before charges, lost after - too many orders for the gain"
    if pts <= 0 and gross <= 0:
        return "STRATEGY: lost points (entries/exits), not a sizing problem"
    return "good day"


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

    trades = round_trips(load(args.dirs, args.start, args.end))
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
                print(f'  {(t["open"] or "")[11:16]}-{(t.get("close") or "")[11:16]}  {t["symbol"]:<22} '
                      f'{t["side"]:<5} {size_label(t):>9}  {t["entry_avg"]:8.2f} -> '
                      f'{t["exit_avg"]:8.2f}  pts {t["points"]:+7.2f}  P&L {rupees(t["pnl"])}')
        print(f"  points caught      {s['points']:+10.2f}   (sum over trades, per unit)")
        if len(s["by_und"]) > 1:
            for u, (p, g, n) in sorted(s["by_und"].items()):
                print(f"    {u:<10} {p:+10.2f} pts  P&L {rupees(g)}  ({n} trades)")
        print(f"  gross P&L        {rupees(s['pnl'])}")
        print(f"  est. charges     {rupees(-s['charges'])}")
        print(f"  net P&L          {rupees(s['net'])}")
        print(f"  same-size P&L    {rupees(s['same_size'])}   (every trade at the day's average size)")
        print(f"  sizing effect    {rupees(s['sizing'])}   (gross minus same-size)")
        fmt = lambda v, f: "-" if v is None else format(v, f)
        print(f"  average winner   {fmt(s['avg_pts_win'], '+.2f')} pts, {fmt(s['avg_size_win'], '.1f')} "
              f"{s['size_unit']}, Rs {fmt(s['avg_pnl_win'], '+,.0f')}")
        print(f"  average loser    {fmt(s['avg_pts_loss'], '+.2f')} pts, {fmt(s['avg_size_loss'], '.1f')} "
              f"{s['size_unit']}, Rs {fmt(s['avg_pnl_loss'], '+,.0f')}")
        print(f"  -> {s['verdict']}")
        for k in ("points", "pnl", "charges", "net", "same_size", "sizing", "trades", "wins", "losses"):
            totals[k] += s[k]
        kinds[s["verdict"].split(":")[0]] += 1

    if len(days) > 1:
        print(f"\n=== ALL {len(days)} days  -  {int(totals['trades'])} trades "
              f"({int(totals['wins'])} won, {int(totals['losses'])} lost)")
        print(f"  points caught      {totals['points']:+10.2f}")
        for k, label in (("pnl", "gross P&L"), ("charges", "est. charges"), ("net", "net P&L"),
                         ("same_size", "same-size P&L"), ("sizing", "sizing effect")):
            v = -totals[k] if k == "charges" else totals[k]
            print(f"  {label:<16} {rupees(v)}")
        print("  days: " + ", ".join(f"{n} {k}" for k, n in sorted(kinds.items(), key=lambda x: -x[1])))

    if args.csv:
        cols = ["day", "broker", "symbol", "underlying", "side", "open", "close", "qty", "lot_size", "lots",
                "entry_avg", "exit_avg", "points", "pnl", "charges", "n_orders"]
        with open(args.csv, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(cols + ["still_open"])
            for t in trades:
                w.writerow([round(t[c], 2) if isinstance(t.get(c), float) else t.get(c) for c in cols]
                           + [bool(t.get("open_end"))])
        print(f"\nWrote {len(trades)} trades to {args.csv}")


if __name__ == "__main__":
    sys.exit(main())
