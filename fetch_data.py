#!/usr/bin/env python3
"""Fetch every block of the project and aggregate apartment availability + pricing.

Runs hourly (GitHub Action). Writes data.json consumed by the static dashboard.
Status codes: 1 = available, 2 = sold, 3 = reserved.

Note: some blocks share a display name (e.g. two "A1") but are different
buildings on different ada (island). Such names are disambiguated with the ada.
"""
import json
import time
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

API = "https://api.gayrimenkulsertifika.com"
PROJECT_ID = 1
STATUS = {1: "available", 2: "sold", 3: "reserved"}


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


def blank():
    return {"total": 0, "available": 0, "sold": 0, "reserved": 0}


def main():
    project = get(f"{API}/projects/{PROJECT_ID}")["project"]
    blocks = project["blocks"]

    status_totals = blank()
    by_rooms = defaultdict(blank)
    room_prices = defaultdict(list)   # available prices per room type
    by_block = []
    avail_prices = []                 # all available prices
    sold_value = 0
    avail_value = 0

    for b in blocks:
        bd = get(f"{API}/blocks/{b['id']}")
        bstat = blank()
        bprices = []                  # available prices in this block
        for fl in (bd.get("floors") or []):
            for a in (fl.get("apartments") or []):
                key = STATUS.get(a.get("status"))
                if not key:
                    continue
                rooms = a.get("number_of_rooms") or "?"
                price = a.get("price") or 0
                for bucket in (status_totals, bstat, by_rooms[rooms]):
                    bucket["total"] += 1
                    bucket[key] += 1
                if key == "available":
                    avail_prices.append(price)
                    avail_value += price
                    bprices.append(price)
                    room_prices[rooms].append(price)
                elif key == "sold":
                    sold_value += price
        by_block.append({
            "name": bd.get("name", b.get("name")),
            "island": bd.get("island"),
            "parcel": bd.get("parcel"),
            "avg_available_price": round(sum(bprices) / len(bprices)) if bprices else 0,
            **bstat,
        })
        time.sleep(0.05)

    # Disambiguate duplicate block names with their ada.
    name_counts = defaultdict(int)
    for b in by_block:
        name_counts[b["name"]] += 1
    for b in by_block:
        b["label"] = f'{b["name"]} · Ada {b["island"]}' if name_counts[b["name"]] > 1 else b["name"]

    def room_key(k):
        try:
            return int(k.split("+")[0])
        except Exception:
            return 99

    rooms_list = []
    for k, v in sorted(by_rooms.items(), key=lambda kv: room_key(kv[0])):
        prices = room_prices.get(k, [])
        rooms_list.append({
            "key": k,
            **v,
            "avg_available_price": round(sum(prices) / len(prices)) if prices else 0,
            "min_available_price": min(prices) if prices else 0,
        })

    by_block.sort(key=lambda x: (len(x["name"]), x["name"], x["island"] or ""))

    n = len(avail_prices)
    pricing = {
        "available_value": avail_value,
        "sold_value": sold_value,
        "avg_available_price": round(avail_value / n) if n else 0,
        "min_available_price": min(avail_prices) if avail_prices else 0,
        "max_available_price": max(avail_prices) if avail_prices else 0,
    }

    data = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "project": project["name"],
        "total": status_totals["total"],
        "status": {k: status_totals[k] for k in ("available", "sold", "reserved")},
        "pricing": pricing,
        "by_rooms": rooms_list,
        "by_block": by_block,
    }
    with open("data.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"Wrote data.json: {data['total']} apartments, {data['status']}, "
          f"available value {pricing['available_value']:,} TL across {len(by_block)} blocks")


if __name__ == "__main__":
    main()
