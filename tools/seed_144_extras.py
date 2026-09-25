"""
seed_144_extras.py -- one-off, idempotent seed of the non-ledger facts that
workbook 144 added: the utilities registry (Ρυθμίσεις «ΠΑΡΟΧΕΣ ΑΝΑ ΑΚΙΝΗΤΟ»,
rows 96-101) and the real account counts noted in Λογαριασμοί.

The utilities block is free text, so the values below were transcribed from
it by hand (and checked) rather than regex-parsed. Κολωνάκι and
Αγ. Κωνσταντίνου have no numbers yet; the Vodafone mobile is not a property.

The counts go in as balance assertions (computed balance taken as of the
count's own date), NOT as new opening balances -- the workbook's opening
balance figures are plugs that would double-correct in the app.

Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python tools/seed_144_extras.py --env staging
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from reconcile_workbook import Db, PROJECT_REFS  # noqa: E402

UTILITIES = [
    {"project": "Q006_KAVOURI_AKTIS2", "kind": "electricity", "provider": "ΔΕΗ",
     "supply_number": "6 04042021-02 5", "contract_account": "300017322094",
     "rf_code": "RF74907738000300017322094", "meter_number": "01807260",
     "notes": "myHome4All Green Pass, στο όνομα KANSHA ΜΟΝΟΠΡΟΣΩΠΗ ΑΕ. Εγγύηση 100 €, σύμβαση λήγει 07/06/2027. ~487 kWh/μήνα, ~138 €."},
    {"project": "Q001_ILIOUPOLI_P15_RESIDENCES", "kind": "electricity", "provider": "ΔΕΗ",
     "supply_number": "6 04068561-02 2", "contract_account": "300001525696",
     "rf_code": "RF28907738000300001525696", "meter_number": None,
     "notes": "Γ1Ν οικιακό, Ψαρών 15Α (σπίτι μητέρας)."},
    {"project": "Q001_ILIOUPOLI_P15_RESIDENCES", "kind": "water", "provider": "ΕΥΔΑΠ",
     "supply_number": "11223100017Α001", "contract_account": "0753147-50",
     "rf_code": None, "meter_number": "A10E11874",
     "notes": "Η ΕΥΔΑΠ αναφέρει Ψαρών 17Α ενώ η ΔΕΗ 15Α — επιβεβαιώστε ότι είναι το ίδιο ακίνητο."},
    {"project": "Q001_ILIOUPOLI_P15_RESIDENCES", "kind": "internet", "provider": "Cosmote",
     "supply_number": "2109923703", "contract_account": "A4415435Ρ90",
     "rf_code": None, "meter_number": None, "notes": "Double Play Advanced XL."},
    {"project": "Q003_LAZARAKI32_GLYFADA", "kind": "electricity", "provider": "ΔΕΗ",
     "supply_number": "6 04185949-04 9", "contract_account": None, "rf_code": None, "meter_number": None,
     "notes": "Κοινόχρηστα πολυκατοικίας."},
]

# (account name, as_of_date, counted balance) -- from Λογαριασμοί notes and H8:J9.
COUNTS = [
    ("Πειραιώς Προσωπικός", "2026-09-21", 242693.83),
    ("Μετρητά", "2026-09-21", 139700.00),
    ("Μετρητά", "2026-09-22", 136700.00),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", required=True, choices=PROJECT_REFS)
    db = Db(ap.parse_args().env)

    org_id = db.select("orgs", "id")[0]["id"]
    projects = {p["code"]: p["id"] for p in db.select("projects", "id,code")}
    existing = {(u["project_id"], u["kind"], u["supply_number"]) for u in
                db.select("property_utilities", "project_id,kind,supply_number")}
    for u in UTILITIES:
        row = {k: v for k, v in u.items() if k != "project"}
        row.update(org_id=org_id, project_id=projects[u["project"]])
        if (row["project_id"], row["kind"], row["supply_number"]) in existing:
            print(f"  utility exists: {u['project']} {u['kind']}")
            continue
        db.insert("property_utilities", row)
        print(f"  + utility {u['project']} {u['kind']} {u['supply_number']}")

    accounts = {a["name"]: a["id"] for a in db.select("accounts", "id,name")}
    have = {(a["account_id"], a["as_of_date"]) for a in
            db.select("account_balance_assertions", "account_id,as_of_date")}
    for name, as_of, counted in COUNTS:
        account_id = accounts[name]
        if (account_id, as_of) in have:
            print(f"  count exists: {name} {as_of}")
            continue
        r = db.s.post(f"{db.url}/rest/v1/rpc/account_balance_as_of", json={"p_account": account_id, "p_date": as_of})
        r.raise_for_status()
        computed = float(r.json())
        db.insert("account_balance_assertions", {"org_id": org_id, "account_id": account_id, "as_of_date": as_of,
                                                 "asserted_balance": counted, "computed_balance": computed})
        print(f"  + count {name} {as_of}: counted {counted:,.2f} vs app {computed:,.2f} (drift {counted - computed:+,.2f})")


if __name__ == "__main__":
    main()
