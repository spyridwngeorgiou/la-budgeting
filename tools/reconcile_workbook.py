"""
reconcile_workbook.py -- field-by-field diff of the operational workbook
against a live database (staging or prod). Read-only unless --apply is given.

Three-way comparison: the workbook the DB was originally seeded from (107,
the "base"), the workbook now (144), and the DB now. That is what lets the
report tell "the workbook moved on since the import -> apply" apart from
"someone edited this in the app -> keep".

Usage (Git Bash):
    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
      python tools/reconcile_workbook.py --env staging
    # review tools/out/reconcile_staging_<date>.csv, edit the `action` column
    python tools/reconcile_workbook.py --env staging --apply tools/out/<approved>.csv

--apply only touches rows whose action is 'apply', and every PATCH is guarded
by the row's updated_at as seen when the report was generated: if anything
edited the row since, the apply stops instead of overwriting it.
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
from datetime import date, datetime
from pathlib import Path

import openpyxl
import requests

sys.path.insert(0, str(Path(__file__).parent))
from mappings import DIRECTION, ORIGIN, STATUS, map_literal  # noqa: E402
from migrate_workbook import normalize_name  # noqa: E402

ROOT = Path(__file__).parent.parent
OUT_DIR = Path(__file__).parent / "out"
PROJECT_REFS = {"prod": "hjypszddhwohgvubirkc", "staging": "jpxxixhiudwjbzagidmn"}

# The Καθημερινά sheet mixes per-transaction cash rows with monthly bank-statement
# aggregates. Only cash rows from the accounts' opening-balance date onward are
# real transactions for the app; earlier rows are already inside the opening
# balances and bank aggregates are sums, not movements.
KATH_FIRST_MONTH = "2026-08"
KATH_AGGREGATE_ORIGIN = "Τραπεζικό αρχείο"

# Fields an installment plan owns once a row belongs to it -- regenerate_plan
# rewrites them, so a workbook value there is never "newer".
MARK_RE = re.compile(r"^\d{15}$")

PLAN_MANAGED = {"tx_date", "paid_on", "due_date", "status", "net_amount", "vat_amount",
                "withholding_amount", "gross_amount", "description"}


class Db:
    def __init__(self, env: str):
        url = os.environ.get("SUPABASE_URL", "").rstrip("/")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        if not url or not key:
            sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")
        if PROJECT_REFS[env] not in url:
            sys.exit(f"--env {env} does not match SUPABASE_URL {url} -- refusing to run.")
        self.url, self.env = url, env
        self.s = requests.Session()
        self.s.headers.update({"apikey": key, "Authorization": f"Bearer {key}"})
        print(f"Target: {env} ({url})")

    def select(self, table: str, select: str, **filters) -> list[dict]:
        rows, start = [], 0
        while True:
            r = self.s.get(f"{self.url}/rest/v1/{table}", params={"select": select, **filters},
                           headers={"Range": f"{start}-{start + 999}"})
            r.raise_for_status()
            page = r.json()
            rows += page
            if len(page) < 1000:
                return rows
            start += 1000

    def patch_guarded(self, table: str, row_id: str, updated_at: str, values: dict) -> None:
        r = self.s.patch(f"{self.url}/rest/v1/{table}",
                         params={"id": f"eq.{row_id}", "updated_at": f"eq.{updated_at}"},
                         json=values, headers={"Prefer": "return=representation"})
        r.raise_for_status()
        if len(r.json()) != 1:
            raise RuntimeError(f"{table} {row_id} changed since the report (updated_at != {updated_at}); aborting.")

    def insert(self, table: str, values: dict) -> dict:
        r = self.s.post(f"{self.url}/rest/v1/{table}", json=values, headers={"Prefer": "return=representation"})
        r.raise_for_status()
        return r.json()[0]


# ---------------------------------------------------------------- workbook

def as_date(v) -> str | None:
    if isinstance(v, datetime):
        v = v.date()
    return v.isoformat() if isinstance(v, date) else None


def money(v) -> float:
    return round(float(v or 0), 2)


def text(v) -> str | None:
    s = " ".join(str(v).split()) if v is not None else ""
    return s or None


def read_kiniseis(path: Path) -> dict[str, dict]:
    ws = openpyxl.load_workbook(path, data_only=True)["Κινήσεις"]
    out = {}
    for row_no, row in enumerate(ws.iter_rows(min_row=4, max_col=18, values_only=True), start=4):
        if row[0] in (None, ""):
            continue
        (tx_date, paid, due, contact, _afm, project, category, description, tx_type,
         net, vat, wh, _gross, account, status, origin, invoice_no, notes) = row
        direction = map_literal(DIRECTION, tx_type, column="Τύπος", row=row_no)
        net, vat, wh = money(net), money(vat), money(wh)
        gross = round(net + vat - wh, 2)
        if gross < 0:  # credit notes: same flip as migrate_workbook.py
            direction = "income" if direction == "expense" else "expense"
            net, vat, wh, gross = -net, -vat, -wh, -gross
        # Column Q «Αρ. Παραστατικού» holds either a real invoice number
        # ("ΤΠΥ 2") or, far more often, the 15-digit myDATA ΜΑΡΚ.
        invoice_no = text(invoice_no)
        mark = invoice_no if invoice_no and MARK_RE.match(invoice_no) else None
        out[f"kiniseis-row-{row_no}"] = {
            "tx_date": as_date(tx_date), "paid_on": as_date(paid), "due_date": as_date(due),
            "counterparty_name": text(contact), "project": text(project), "category": text(category),
            "description": text(description), "direction": direction,
            "net_amount": net, "vat_amount": vat, "withholding_amount": wh, "gross_amount": gross,
            "account": text(account), "status": map_literal(STATUS, status, column="Κατάσταση", row=row_no),
            "origin": map_literal(ORIGIN, origin, column="Προέλευση", row=row_no) or "manual",
            "invoice_number": None if mark else invoice_no, "mydata_mark": mark, "notes": text(notes),
        }
    return out


def read_kathimerina(path: Path) -> tuple[dict[str, dict], dict[str, str]]:
    """Returns (rows expected in the DB, rows excluded by rule -> reason)."""
    ws = openpyxl.load_workbook(path, data_only=True)["Καθημερινά"]
    expected, excluded = {}, {}
    for row_no, row in enumerate(ws.iter_rows(min_row=4, max_col=13, values_only=True), start=4):
        month_key = text(row[1])
        if not month_key:
            continue
        key = f"kathimerina-row-{row_no}"
        if month_key < KATH_FIRST_MONTH:
            excluded[key] = "before opening-balance date"
            continue
        if text(row[6]) == KATH_AGGREGATE_ORIGIN:
            excluded[key] = "monthly bank aggregate"
            continue
        expected[key] = {
            "month_key": month_key, "description": text(row[2]), "gross_amount": money(row[3]),
            "account": text(row[5]), "notes": text(row[7]), "property": text(row[12]),
        }
    return expected, excluded


# ---------------------------------------------------------------- compare

def db_value(tx: dict, field: str):
    if field == "project":
        return (tx.get("projects") or {}).get("code")
    if field == "category":
        return (tx.get("categories") or {}).get("name")
    if field == "account":
        return (tx.get("accounts") or {}).get("name")
    v = tx.get(field)
    if field.endswith("_amount") and v is not None:
        return money(v)
    if isinstance(v, str):
        return text(v)
    return v


def same(field: str, wb, db) -> bool:
    if wb is None and db in (None, ""):
        return True
    if field == "counterparty_name":
        return normalize_name(wb) == normalize_name(db)
    if field == "notes":
        # The importer appends provenance ("· Προέλευση: ...") to notes, so the
        # workbook text being contained in the DB text counts as a match.
        return wb is None or (db is not None and normalize_name(wb) in normalize_name(db))
    return wb == db


def classify(field: str, wb, base, db, tx: dict, in_base: bool) -> str:
    if tx.get("plan_id") and field in PLAN_MANAGED:
        return "keep"  # plan-managed
    if db in (None, "") and wb is not None:
        return "apply"
    if not in_base or tx.get("origin", "").startswith("ai_"):
        return "review"
    if same(field, base, db):
        return "apply"  # DB still holds the originally imported value; workbook moved on
    return "keep"  # edited in the app after import


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", required=True, choices=PROJECT_REFS)
    ap.add_argument("--workbook", type=Path, default=ROOT / "Επιχειρησιακό_Αρχείο_144.xlsx")
    ap.add_argument("--base", type=Path, default=ROOT / "Επιχειρησιακό_Αρχείο_107.xlsx")
    ap.add_argument("--apply", type=Path, help="approved CSV: patch rows whose action is 'apply'")
    args = ap.parse_args()
    db = Db(args.env)

    if args.apply:
        return apply_csv(db, args.apply)

    current, base = read_kiniseis(args.workbook), read_kiniseis(args.base)
    kath_expected, kath_excluded = read_kathimerina(args.workbook)

    txs = db.select("transactions", "id,legacy_excel_id,plan_id,origin,updated_at,tx_date,paid_on,due_date,"
                    "counterparty_name,description,direction,net_amount,vat_amount,withholding_amount,"
                    "gross_amount,status,invoice_number,mydata_mark,notes,month_key,"
                    "projects(code),categories(name),accounts(name)",
                    legacy_excel_id="not.is.null")
    by_key = {t["legacy_excel_id"]: t for t in txs}

    diffs, missing = [], []
    for key, wb in current.items():
        tx = by_key.get(key)
        if tx is None:
            missing.append((key, wb))
            continue
        for field, wv in wb.items():
            if field == "origin":
                continue  # 'Εφαρμογή' vs 'Χειρόγραφο' both land as 'manual'; not meaningful
            dv = db_value(tx, field)
            if same(field, wv, dv):
                continue
            bv = base.get(key, {}).get(field)
            action = classify(field, wv, bv, dv, tx, key in base)
            diffs.append({"legacy_id": key, "db_id": tx["id"], "field": field, "workbook_107": bv,
                          "workbook_now": wv, "db": dv, "action": action, "db_updated_at": tx["updated_at"]})

    for key, wb in kath_expected.items():
        tx = by_key.get(key)
        if tx is None:
            missing.append((key, wb))
            continue
        for field in ("month_key", "description", "gross_amount", "account", "notes"):
            dv, wv = db_value(tx, field), wb[field]
            if not same(field, wv, dv):
                diffs.append({"legacy_id": key, "db_id": tx["id"], "field": field, "workbook_107": None,
                              "workbook_now": wv, "db": dv, "action": "review", "db_updated_at": tx["updated_at"]})

    workbook_keys = set(current) | set(kath_expected) | set(kath_excluded)
    orphans = sorted(k for k in by_key if k not in workbook_keys)
    wrongly_imported = sorted(k for k in by_key if k in kath_excluded)

    OUT_DIR.mkdir(exist_ok=True)
    stamp = date.today().strftime("%Y%m%d")
    csv_path = OUT_DIR / f"reconcile_{args.env}_{stamp}.csv"
    with csv_path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(diffs[0].keys()) if diffs else ["legacy_id"])
        w.writeheader()
        w.writerows(diffs)

    md = [f"# Reconciliation — {args.workbook.name} vs {args.env} ({date.today()})", ""]
    md += [f"- Κινήσεις rows in workbook: {len(current)} · Καθημερινά rows expected: {len(kath_expected)} "
           f"(+{len(kath_excluded)} excluded by rule) · DB rows with a legacy id: {len(by_key)}",
           f"- Missing from DB: **{len(missing)}** · Field diffs: **{len(diffs)}** "
           f"(apply {sum(d['action'] == 'apply' for d in diffs)}, keep {sum(d['action'] == 'keep' for d in diffs)}, "
           f"review {sum(d['action'] == 'review' for d in diffs)})",
           f"- DB rows whose legacy id is no longer in the workbook: {len(orphans)} · "
           f"excluded-by-rule rows present in DB anyway: {len(wrongly_imported)}", ""]
    if missing:
        md += ["## Missing from DB", "", "| key | date / month | description | gross |", "|---|---|---|---|"]
        md += [f"| {k} | {v.get('tx_date') or v.get('month_key')} | {v.get('description')} | {v.get('gross_amount')} |"
               for k, v in missing]
        md.append("")
    for action in ("apply", "review", "keep"):
        rows = [d for d in diffs if d["action"] == action]
        if rows:
            md += [f"## {action} ({len(rows)})", "", "| key | field | 107 | workbook now | DB |", "|---|---|---|---|---|"]
            md += [f"| {d['legacy_id']} | {d['field']} | {d['workbook_107']} | {d['workbook_now']} | {d['db']} |" for d in rows]
            md.append("")
    if orphans or wrongly_imported:
        md += ["## Other", "", f"- Orphans: {', '.join(orphans) or '—'}",
               f"- Excluded by rule but present: {', '.join(wrongly_imported) or '—'}", ""]
    md_path = OUT_DIR / f"reconcile_{args.env}_{stamp}.md"
    md_path.write_text("\n".join(md), encoding="utf-8")
    print(f"Wrote {md_path}\nWrote {csv_path}")
    print("\n".join(md[2:6]))


def apply_csv(db: Db, path: Path) -> None:
    with path.open(encoding="utf-8-sig") as f:
        rows = [r for r in csv.DictReader(f) if r["action"].strip() == "apply"]
    projects = {p["code"]: p["id"] for p in db.select("projects", "id,code")}
    categories = {p["name"]: p["id"] for p in db.select("categories", "id,name")}
    accounts = {p["name"]: p["id"] for p in db.select("accounts", "id,name")}
    contacts = {normalize_name(c["name"]): c["id"] for c in db.select("contacts", "id,name")}
    org_id = db.select("orgs", "id")[0]["id"]

    by_tx: dict[tuple[str, str], dict] = {}
    for r in rows:
        values = by_tx.setdefault((r["db_id"], r["db_updated_at"]), {})
        field, v = r["field"], r["workbook_now"] or None
        if field == "project":
            values["project_id"] = projects[v]
        elif field == "category":
            if v not in categories:
                code = v.upper().replace(" ", "_").replace("&", "AND")  # same rule as migrate_workbook.py
                categories[v] = db.insert("categories", {"org_id": org_id, "code": code, "name": v})["id"]
                print(f"  created category {v}")
            values["category_id"] = categories[v]
        elif field == "account":
            values["account_id"] = accounts[v]
        elif field == "counterparty_name":
            cid = contacts.get(normalize_name(v))
            if cid is None:
                cid = db.insert("contacts", {"org_id": org_id, "name": v})["id"]
                contacts[normalize_name(v)] = cid
                print(f"  created contact {v}")
            values.update(counterparty_name=v, contact_id=cid)
        else:
            values[field] = v

    for (tx_id, updated_at), values in by_tx.items():
        db.patch_guarded("transactions", tx_id, updated_at, values)
        print(f"  patched {tx_id}: {', '.join(values)}")
    print(f"Applied {len(rows)} field change(s) across {len(by_tx)} transaction(s) on {db.env}.")


if __name__ == "__main__":
    main()
