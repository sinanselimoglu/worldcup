#!/usr/bin/env python3
"""Fetch every block of the project and aggregate apartment availability.

Runs hourly (GitHub Action). Writes data.json consumed by the static dashboard.
Status codes: 1 = available, 2 = sold, 3 = reserved.
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
        except Exception as e:
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
    by_block = []

    for b in blocks:
        bd = get(f"{API}/blocks/{b['id']}")
        bstat = blank()
        for fl in (bd.get("floors") or []):
            for a in (fl.get("apartments") or []):
                key = STATUS.get(a.get("status"))
                if not key:
                    continue
                rooms = a.get("number_of_rooms") or "?"
                for bucket in (status_totals, bstat, by_rooms[rooms]):
                    bucket["total"] += 1
                    bucket[key] += 1
        by_block.append({"name": bd.get("name", b.get("name")), **bstat})
        time.sleep(0.05)  # be gentle

    # rooms sorted 1+1, 2+1, 3+1, 4+1, ...
    def room_key(k):
        try:
            return int(k.split("+")[0])
        except Exception:
            return 99

    rooms_list = [{"key": k, **v} for k, v in sorted(by_rooms.items(), key=lambda kv: room_key(kv[0]))]
    # blocks sorted naturally by name
    by_block.sort(key=lambda x: (len(x["name"]), x["name"]))

    data = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "project": project["name"],
        "total": status_totals["total"],
        "status": {k: status_totals[k] for k in ("available", "sold", "reserved")},
        "by_rooms": rooms_list,
        "by_block": by_block,
    }
    with open("data.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"Wrote data.json: {data['total']} apartments, "
          f"{data['status']} across {len(by_block)} blocks")


if __name__ == "__main__":
    main()
