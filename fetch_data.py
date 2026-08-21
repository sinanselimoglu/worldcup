#!/usr/bin/env python3
"""Fetch every block of the project and aggregate apartment availability + pricing.

Runs hourly (GitHub Action). Writes data.json consumed by the static dashboard.
Status codes: 1 = available, 2 = sold, 3 = reserved.

Note: some blocks share a display name (e.g. two "A1") but are different
buildings on different ada (island). Such names are disambiguated with the ada.
"""
import json
import os
import time
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

API = "https://api.gayrimenkulsertifika.com"
PROJECT_ID = 1
STATUS = {1: "available", 2: "sold", 3: "reserved"}
STATE_FILE = "state.json"       # {apartment_id: status} snapshot from the previous run
HISTORY_FILE = "history.json"   # append-only log of status-change events
MAX_HISTORY = 2000              # keep the most recent N events


def get(url, retries=3):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception:
            if i == retries - 1:
                raise
            time.sleep(2)


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def blank():
    return {"total": 0, "available": 0, "sold": 0, "reserved": 0}


def main():
    project = get(f"{API}/projects/{PROJECT_ID}")["project"]
    blocks = project["blocks"]

    status_totals = blank()
    by_rooms = defaultdict(blank)
    room_prices = defaultdict(list)   # available prices per room type
    room_available = defaultdict(list)  # available units per room type (for cheapest lists)
    by_block = []
    avail_prices = []                 # all available prices
    sold_value = 0
    avail_value = 0
    all_apts = {}                     # id -> details (for state diff + history)

    for b in blocks:
        bd = get(f"{API}/blocks/{b['id']}")
        bname = bd.get("name", b.get("name"))
        bstat = blank()
        bprices = []                  # available prices in this block
        for fl in (bd.get("floors") or []):
            for a in (fl.get("apartments") or []):
                key = STATUS.get(a.get("status"))
                if not key:
                    continue
                rooms = a.get("number_of_rooms") or "?"
                price = a.get("price") or 0
                aid = a.get("id")
                if aid is not None:
                    all_apts[str(aid)] = {
                        "id": aid,
                        "status": a.get("status"),
                        "room": rooms,
                        "net_area": a.get("net_area"),
                        "no": a.get("no"),
                        "block": bname,
                        "island": bd.get("island"),
                        "price": price,
                    }
                for bucket in (status_totals, bstat, by_rooms[rooms]):
                    bucket["total"] += 1
                    bucket[key] += 1
                if key == "available":
                    avail_prices.append(price)
                    avail_value += price
                    bprices.append(price)
                    room_prices[rooms].append(price)
                    room_available[rooms].append({
                        "id": aid,
                        "block": bname,
                        "island": bd.get("island"),
                        "no": a.get("no"),
                        "price": price,
                        "net_area": a.get("net_area"),
                    })
        by_block.append({
            "name": bname,
            "island": bd.get("island"),
            "parcel": bd.get("parcel"),
            "avg_available_price": round(sum(bprices) / len(bprices)) if bprices else 0,
            "min_available_price": min(bprices) if bprices else 0,
            "max_available_price": max(bprices) if bprices else 0,
            **bstat,
        })
        time.sleep(0.05)

    # Disambiguate duplicate block names with their ada.
    name_counts = defaultdict(int)
    for b in by_block:
        name_counts[b["name"]] += 1

    def label_for(name, island):
        return f"{name} · Ada {island}" if name_counts[name] > 1 else name

    for b in by_block:
        b["label"] = label_for(b["name"], b["island"])

    def room_key(k):
        try:
            return int(k.split("+")[0])
        except Exception:
            return 99

    rooms_list = []
    available_by_room = {}
    for k, v in sorted(by_rooms.items(), key=lambda kv: room_key(kv[0])):
        prices = room_prices.get(k, [])
        rooms_list.append({
            "key": k,
            **v,
            "avg_available_price": round(sum(prices) / len(prices)) if prices else 0,
            "min_available_price": min(prices) if prices else 0,   # starting price
            "max_available_price": max(prices) if prices else 0,   # maximum price
        })
        # ALL available units for this room type, cheapest first (for paginated list)
        units = sorted(room_available.get(k, []), key=lambda u: u["price"])
        available_by_room[k] = [{
            "id": u["id"],
            "block": label_for(u["block"], u["island"]),
            "no": u["no"],
            "price": u["price"],
            "net_area": u["net_area"],
        } for u in units]

    by_block.sort(key=lambda x: (len(x["name"]), x["name"], x["island"] or ""))

    n = len(avail_prices)
    pricing = {
        "available_value": avail_value,
        "sold_value": sold_value,
        "avg_available_price": round(avail_value / n) if n else 0,
        "min_available_price": min(avail_prices) if avail_prices else 0,
        "max_available_price": max(avail_prices) if avail_prices else 0,
    }

    # --- Status-change tracking (sold / reserved dates going forward) ----------
    now_iso = datetime.now(timezone.utc).isoformat()
    prev_state = load_json(STATE_FILE, None)   # {id: status} or None on first run
    history = load_json(HISTORY_FILE, [])
    new_state = {aid: a["status"] for aid, a in all_apts.items()}

    if prev_state is not None:
        for aid, a in all_apts.items():
            old = prev_state.get(aid)
            new = a["status"]
            if old is not None and old != new:
                history.append({
                    "ts": now_iso,
                    "id": a["id"],
                    "label": label_for(a["block"], a["island"]),
                    "no": a["no"],
                    "room": a["room"],
                    "net_area": a["net_area"],
                    "price": a["price"],
                    "from": old,
                    "to": new,
                    "from_key": STATUS.get(old, str(old)),
                    "to_key": STATUS.get(new, str(new)),
                })
    baseline = prev_state is None
    history = history[-MAX_HISTORY:]
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(new_state, f)
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False)

    # recent-sale counters for the dashboard
    now_ts = datetime.now(timezone.utc)
    def within(ev, hours):
        try:
            return (now_ts - datetime.fromisoformat(ev["ts"])).total_seconds() <= hours * 3600
        except Exception:
            return False
    sold_24h = sum(1 for e in history if e["to"] == 2 and within(e, 24))
    sold_7d = sum(1 for e in history if e["to"] == 2 and within(e, 24 * 7))

    data = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "project": project["name"],
        # All *price* values below are CERTIFICATE COUNTS (Sertifika Adedi), not TL.
        # TL value = certificate_count * live certificate price (DMLKT.G on Borsa).
        "unit": "certificates",
        "ipo_price": 7.59,          # halka arz birim fiyatı
        "stock_symbol": "DMLKT.G",
        "total": status_totals["total"],
        "status": {k: status_totals[k] for k in ("available", "sold", "reserved")},
        "pricing": pricing,
        "tracking_since": (prev_state is not None) and load_json("data.json", {}).get("tracking_since", now_iso) or now_iso,
        "sold_24h": sold_24h,
        "sold_7d": sold_7d,
        "recent_changes": list(reversed(history))[:40],  # newest first
        "available_by_room": available_by_room,
        "by_rooms": rooms_list,
        "by_block": by_block,
    }
    with open("data.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"Wrote data.json: {data['total']} apartments, {data['status']}, "
          f"available value {pricing['available_value']:,} TL, "
          f"{'BASELINE run' if baseline else str(len(history)) + ' history events'}")


if __name__ == "__main__":
    main()
