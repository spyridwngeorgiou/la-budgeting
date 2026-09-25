"""
promote_staging.py -- copy verified data rows from staging to prod.

Staging and prod share row ids (staging was cloned from prod), so rows are
matched by primary key: missing in prod -> insert, present but different ->
update. Dry-run by default; writes tools/out/promote_<date>.md. --apply to write.

Deliberately NOT promoted:
  - accounts.opening_balance: the workbook's figures there are plugs, and the
    app already subtracts every payment itself; the real counts go in as
    balance assertions instead. Account notes are promoted.
  - AI/test artefacts: transactions with origin ai_*, transaction_drafts,
    documents, ai_usage, email_inbound_addresses.
  - created_by / auth-user references: staging's users don't exist in prod.

Env: PROD_URL, PROD_KEY, STAGING_URL, STAGING_KEY.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import date
from pathlib import Path

import requests

OUT_DIR = Path(__file__).parent / "out"

# Dependency order: parents before children.
TABLES = ["contacts", "categories", "accounts", "installment_plans", "assets", "liabilities",
          "expected_income", "transactions"]
GENERATED = {"transactions": {"signed_amount", "month_key", "fingerprint"}}
NEVER_COPY = {"created_at", "updated_at", "created_by", "uploaded_by"}
SKIP_FIELDS = {"accounts": {"opening_balance", "opening_balance_date"}}


class Env:
    def __init__(self, url: str, key: str, name: str):
        self.url, self.name = url.rstrip("/"), name
        self.s = requests.Session()
        self.s.headers.update({"apikey": key, "Authorization": f"Bearer {key}"})

    def all(self, table: str) -> list[dict]:
        rows, start = [], 0
        while True:
            r = self.s.get(f"{self.url}/rest/v1/{table}", params={"select": "*"},
                           headers={"Range": f"{start}-{start + 999}"})
            r.raise_for_status()
            page = r.json()
            rows += page
            if len(page) < 1000:
                return rows
            start += 1000

    def insert(self, table: str, rows: list[dict]) -> None:
        for i in range(0, len(rows), 200):
            r = self.s.post(f"{self.url}/rest/v1/{table}", json=rows[i:i + 200], headers={"Prefer": "return=minimal"})
            if not r.ok:
                raise RuntimeError(f"insert {table}: {r.status_code} {r.text}")

    def update(self, table: str, row_id: str, values: dict) -> None:
        r = self.s.patch(f"{self.url}/rest/v1/{table}", params={"id": f"eq.{row_id}"}, json=values,
                         headers={"Prefer": "return=minimal"})
        if not r.ok:
            raise RuntimeError(f"update {table} {row_id}: {r.status_code} {r.text}")


def excluded(table: str, row: dict) -> bool:
    return table == "transactions" and str(row.get("origin", "")).startswith("ai_")


def copyable(table: str, row: dict) -> dict:
    drop = NEVER_COPY | GENERATED.get(table, set()) | SKIP_FIELDS.get(table, set())
    return {k: v for k, v in row.items() if k not in drop}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    for var in ("PROD_URL", "PROD_KEY", "STAGING_URL", "STAGING_KEY"):
        if not os.environ.get(var):
            sys.exit(f"Set {var}.")
    prod = Env(os.environ["PROD_URL"], os.environ["PROD_KEY"], "prod")
    stg = Env(os.environ["STAGING_URL"], os.environ["STAGING_KEY"], "staging")
    if prod.url == stg.url:
        sys.exit("PROD_URL and STAGING_URL are the same -- refusing.")

    plan: list[tuple[str, list[dict], list[tuple[str, dict]]]] = []
    md = [f"# Promote staging → prod ({date.today()})", "", "| table | insert | update | skipped |", "|---|---|---|---|"]
    details: list[str] = []
    for table in TABLES:
        prod_rows = {r["id"]: r for r in prod.all(table)}
        inserts, updates, skipped = [], [], 0
        for row in stg.all(table):
            if excluded(table, row):
                skipped += 1
                continue
            want = copyable(table, row)
            have = prod_rows.get(row["id"])
            if have is None:
                inserts.append(want)
                continue
            changed = {k: v for k, v in want.items() if have.get(k) != v}
            if changed:
                updates.append((row["id"], changed))
                label = row.get("legacy_excel_id") or row.get("name") or row.get("label") or row["id"]
                details.append(f"- {table} `{label}`: " + ", ".join(
                    f"{k}: {have.get(k)!r} → {v!r}" for k, v in changed.items()))
        plan.append((table, inserts, updates))
        md.append(f"| {table} | {len(inserts)} | {len(updates)} | {skipped} |")

    md += ["", "## Updates", ""] + (details or ["(none)"])
    OUT_DIR.mkdir(exist_ok=True)
    out = OUT_DIR / f"promote_{date.today():%Y%m%d}.md"
    out.write_text("\n".join(md), encoding="utf-8")
    print("\n".join(md[:len(TABLES) + 4]))
    print(f"\nWrote {out}")

    if not args.apply:
        print("Dry run -- nothing written. Re-run with --apply to write to prod.")
        return
    for table, inserts, updates in plan:
        if inserts:
            prod.insert(table, inserts)
        for row_id, values in updates:
            prod.update(table, row_id, values)
        print(f"  {table}: inserted {len(inserts)}, updated {len(updates)}")
    print("Promotion applied to prod.")


if __name__ == "__main__":
    main()
