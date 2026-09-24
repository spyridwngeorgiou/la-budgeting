"""
verify_migration.py -- reconciles the migrated database against
Επιχειρησιακό_Αρχείο_107.xlsx to the cent. This is the acceptance test for
the whole migration: nothing gets trusted until this passes clean.

Requires DATABASE_URL (the Supabase project's Postgres connection string,
Project Settings -> Database -> Connection string -- use the "session"
pooler on port 5432, not the transaction pooler, since this runs a handful
of ad hoc queries rather than a connection-per-request web workload).

Usage:
    py tools/verify_migration.py

Scope note: this checks the masters + 102 one-off transactions landed by
migrate_workbook.py. Once installment plans, budgets and wealth land (see
MIGRATION_NOTES.md), extend the checks here against
back_office_operations_values.xlsx (produced by bake_values.ps1), which is
the only version of the generated workbook with real cached formula values.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import openpyxl
import psycopg2

ROOT = Path(__file__).parent.parent
SOURCE_WORKBOOK = ROOT / "Επιχειρησιακό_Αρχείο_107.xlsx"
TOLERANCE = 0.01

sys.path.insert(0, str(Path(__file__).parent))
from mappings import DIRECTION, STATUS  # noqa: E402


def load_kiniseis_rows():
    wb = openpyxl.load_workbook(SOURCE_WORKBOOK, data_only=True)
    ws = wb["Κινήσεις"]
    rows = []
    for row in ws.iter_rows(min_row=4, values_only=True):
        if row[0] in (None, ""):
            continue
        rows.append(row)
    return rows


def excel_totals(rows):
    total_by_direction = {"income": 0.0, "expense": 0.0}
    total_by_project: dict[str, float] = {}
    row_count = 0
    for row in rows:
        (tx_date, _, _, _, _, project_code, _, _, tx_type_lit,
         net, vat, withholding, *_rest) = row[:12]
        direction = DIRECTION.get(str(tx_type_lit).strip()) if tx_type_lit else None
        if direction is None:
            continue
        net = float(net or 0)
        vat = float(vat or 0)
        withholding = float(withholding or 0)
        gross = round(net + vat - withholding, 2)

        # migrate_workbook.py flips direction and takes absolute values for
        # the rare negative-amount row (a credit note/αντιλογισμός) so the
        # DB's positive-amounts invariant holds. Apply the same
        # transformation here, or this check compares two different things.
        if gross < 0:
            direction = "income" if direction == "expense" else "expense"
            gross = -gross

        total_by_direction[direction] += gross
        if project_code:
            key = str(project_code).strip()
            total_by_project[key] = total_by_project.get(key, 0.0) + (
                gross if direction == "expense" else 0.0
            )
        row_count += 1
    return row_count, total_by_direction, total_by_project


def db_totals(conn):
    with conn.cursor() as cur:
        cur.execute("select count(*) from transactions")
        (row_count,) = cur.fetchone()

        cur.execute("""
            select direction, sum(gross_amount)
            from transactions
            where status <> 'cancelled'
            group by direction
        """)
        by_direction = {d: float(s) for d, s in cur.fetchall()}

        cur.execute("""
            select p.code, sum(t.gross_amount)
            from transactions t join projects p on p.id = t.project_id
            where t.direction = 'expense' and t.status <> 'cancelled'
            group by p.code
        """)
        by_project = {c: float(s) for c, s in cur.fetchall()}

    return row_count, by_direction, by_project


def compare(label, expected, actual, tolerance=TOLERANCE) -> bool:
    diff = abs(expected - actual)
    ok = diff <= tolerance
    status = "OK" if ok else "MISMATCH"
    print(f"  [{status}] {label}: excel={expected:.2f} db={actual:.2f} diff={diff:.2f}")
    return ok


def main():
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("Set DATABASE_URL to the Supabase Postgres connection string first.")
        sys.exit(2)

    rows = load_kiniseis_rows()
    excel_row_count, excel_by_direction, excel_by_project = excel_totals(rows)

    conn = psycopg2.connect(dsn)
    try:
        db_row_count, db_by_direction, db_by_project = db_totals(conn)
    finally:
        conn.close()

    all_ok = True
    print("Row count:")
    ok = excel_row_count == db_row_count
    all_ok &= ok
    print(f"  [{'OK' if ok else 'MISMATCH'}] excel={excel_row_count} db={db_row_count}")

    print("\nTotals by direction:")
    for direction in ("income", "expense"):
        all_ok &= compare(
            direction, excel_by_direction.get(direction, 0), db_by_direction.get(direction, 0)
        )

    print("\nTotals by project (expenses only):")
    for code in sorted(set(excel_by_project) | set(db_by_project)):
        all_ok &= compare(
            code, excel_by_project.get(code, 0), db_by_project.get(code, 0)
        )

    print()
    if all_ok:
        print("Verification PASSED -- migration matches the workbook to the cent.")
    else:
        print("Verification FAILED -- see MISMATCH lines above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
