#!/usr/bin/env python3
"""
Seed production content through the live admin API (no DB credentials needed).

Usage:
  API_BASE=https://c2027-backend-production.up.railway.app \
  ADMIN_USER=admin ADMIN_PASS='...' \
  python3 prisma/seed-prod-api.py
"""
import json
import os
import sys
import urllib.request
import urllib.error

API_BASE = os.environ.get("API_BASE", "https://c2027-backend-production.up.railway.app").rstrip("/")
ADMIN_USER = os.environ.get("ADMIN_USER", "admin")
ADMIN_PASS = os.environ.get("ADMIN_PASS", "")

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = json.load(open(os.path.join(HERE, "seed-prod-api.data.json"), encoding="utf-8"))


def request(method, path, token=None, body=None):
    url = f"{API_BASE}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8") or "{}")


def main():
    if not ADMIN_PASS:
        print("ERROR: set ADMIN_PASS env var", file=sys.stderr)
        sys.exit(1)

    print(f"Logging in to {API_BASE} ...")
    status, res = request("POST", "/api/admin/login", body={"username": ADMIN_USER, "password": ADMIN_PASS})
    if status != 200 or "token" not in res:
        print(f"  LOGIN FAILED (HTTP {status}): {res}", file=sys.stderr)
        sys.exit(1)
    token = res["token"]
    print("  OK")

    # Settings (headline)
    print("Updating settings (headline) ...")
    status, res = request("PUT", "/api/admin/settings", token, DATA["settings"])
    print(f"  HTTP {status}")

    # Biography sections
    print("Upserting biography sections ...")
    for section, content in DATA["biography"].items():
        status, res = request("PUT", f"/api/admin/biography/{section}", token, {"content": content})
        print(f"  {section}: HTTP {status}")

    # Manifesto pillars
    print("Creating manifesto pillars ...")
    ok = 0
    for item in DATA["manifesto"]:
        status, res = request("POST", "/api/admin/manifesto", token, item)
        flag = "OK" if status in (200, 201) else f"FAIL {res}"
        if status in (200, 201):
            ok += 1
        print(f"  {item['sortOrder']:>2}. {item['pillar']}: {flag}")
    print(f"Manifesto created: {ok}/{len(DATA['manifesto'])}")

    # Verify via public endpoint
    status, res = request("GET", "/api/content/manifesto")
    print(f"Verify: public manifesto now has {len(res)} items")


if __name__ == "__main__":
    main()
