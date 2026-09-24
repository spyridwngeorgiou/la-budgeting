"""
AADE monthly exports -> unified master workbook.

Fixes the naming convention of aade_exports/*.xls (the manually-downloaded
monthly myDATA reports) and builds one master workbook combining all months.

Problems with the original naming (e.g. "012026_expenses.xls"):
  - MM+YYYY order does not sort chronologically (e.g. "092025" sorts after
    "082026" alphabetically, even though Sep-2025 is earlier).
  - "revenue" vs "expenses" wording doesn't match the rest of the repo,
    which uses "income" (see aade_data/income.json, aade_fetch.py).
  - Legacy binary .xls format instead of .xlsx used everywhere else.

New convention: "YYYY-MM_<income|expenses>.xlsx" (sorts correctly, matches
repo terminology, modern format).

Also produces aade_exports/AADE_Master.xlsx with all months combined into
"Έξοδα" (expenses) and "Έσοδα" (income) sheets, each row tagged with the
period it came from.
"""
import re
from pathlib import Path

import pandas as pd
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

EXPORTS_DIR = Path(__file__).parent / "aade_exports"
MASTER_PATH = EXPORTS_DIR / "AADE_Master.xlsx"

OLD_NAME_RE = re.compile(r"^(\d{2})(\d{4})_(expenses|revenue)\.xls$")
KIND_MAP = {"expenses": "expenses", "revenue": "income"}
PERIOD_COL = "Περίοδος"
SOURCE_COL = "Πηγή Αρχείου"

# Identifier columns that must stay text, never numbers — otherwise Excel
# renders long marks in scientific notation and drops leading zeros from
# ΑΦΜ (Greek tax numbers, always 9 digits).
ID_COLUMNS = ["ΜΑΡΚ", "ΑΦΜ ΕΚΔΟΤΗ", "ΑΦΜ ΛΗΠΤΗ", "ΚΑΔ Αντισυμβαλλόμενου"]
AFM_ZERO_PAD = {"ΑΦΜ ΕΚΔΟΤΗ": 9, "ΑΦΜ ΛΗΠΤΗ": 9}


def clean_id_column(series, pad_width=None):
    """Turn a numeric-inferred ID column back into clean text, restoring
    leading zeros for fixed-width identifiers (e.g. 9-digit ΑΦΜ)."""

    def clean(v):
        if pd.isna(v):
            return ""
        s = str(v).strip()
        if s.endswith(".0"):
            s = s[:-2]
        if pad_width:
            s = s.zfill(pad_width)
        return s

    return series.apply(clean)


def autosize(ws):
    for col_cells in ws.columns:
        width = max(
            (len(str(c.value)) if c.value is not None else 0) for c in col_cells
        )
        ws.column_dimensions[get_column_letter(col_cells[0].column)].width = min(
            width + 2, 60
        )


def force_text_format(ws, columns):
    """Set the Excel number format of the given header names to Text so
    the cells never get reinterpreted/rendered as scientific numbers."""
    header = {cell.value: cell.column for cell in ws[1]}
    for col_name in columns:
        col_idx = header.get(col_name)
        if not col_idx:
            continue
        letter = get_column_letter(col_idx)
        for cell in ws[letter][1:]:
            cell.number_format = "@"


NEW_NAME_RE = re.compile(r"^(\d{4})-(\d{2})_(expenses|income)\.xlsx$")


def clean_ids(df):
    """Restore ID columns to readable text (no scientific notation, no
    lost leading zeros) in place."""
    for col in ID_COLUMNS:
        if col in df.columns:
            df[col] = clean_id_column(df[col], AFM_ZERO_PAD.get(col))


def save_source_file(df, path):
    df.to_excel(path, index=False, sheet_name="Δεδομένα")
    wb = load_workbook(path)
    force_text_format(wb["Δεδομένα"], ID_COLUMNS)
    wb.save(path)


def rename_and_load():
    """Migrate legacy .xls files to the new convention, re-clean any
    already-migrated .xlsx files, and return {'expenses': [...df],
    'income': [...df]} with every ID column stored as readable text."""
    by_kind = {"expenses": [], "income": []}

    for old_path in sorted(EXPORTS_DIR.glob("*.xls")):
        m = OLD_NAME_RE.match(old_path.name)
        if not m:
            print(f"  skip (unrecognized name): {old_path.name}")
            continue

        month, year, old_kind = m.groups()
        kind = KIND_MAP[old_kind]
        period = f"{year}-{month}"

        df = pd.read_excel(old_path)
        clean_ids(df)
        df.insert(0, SOURCE_COL, old_path.name)
        df.insert(0, PERIOD_COL, period)
        by_kind[kind].append(df)

        new_path = EXPORTS_DIR / f"{period}_{kind}.xlsx"
        save_source_file(df, new_path)
        old_path.unlink()
        print(f"  {old_path.name} -> {new_path.name}  ({len(df)} rows)")

    for xlsx_path in sorted(EXPORTS_DIR.glob("*.xlsx")):
        if xlsx_path.name == MASTER_PATH.name:
            continue
        m = NEW_NAME_RE.match(xlsx_path.name)
        if not m:
            continue

        df = pd.read_excel(xlsx_path, dtype={c: str for c in ID_COLUMNS})
        clean_ids(df)
        by_kind[m.group(3)].append(df)
        save_source_file(df, xlsx_path)
        print(f"  re-cleaned {xlsx_path.name}  ({len(df)} rows)")

    return by_kind


def write_master(by_kind):
    with pd.ExcelWriter(MASTER_PATH, engine="openpyxl") as writer:
        sheet_titles = {"expenses": "Έξοδα", "income": "Έσοδα"}
        for kind, dfs in by_kind.items():
            if not dfs:
                continue
            combined = pd.concat(dfs, ignore_index=True)
            combined = combined.sort_values(PERIOD_COL, kind="stable").reset_index(
                drop=True
            )
            combined.to_excel(writer, index=False, sheet_name=sheet_titles[kind])

        for ws in writer.book.worksheets:
            force_text_format(ws, ID_COLUMNS)
            autosize(ws)


def main():
    print("Renaming aade_exports/*.xls to YYYY-MM_<income|expenses>.xlsx ...")
    by_kind = rename_and_load()
    print(f"Writing master workbook -> {MASTER_PATH.name}")
    write_master(by_kind)
    for kind, dfs in by_kind.items():
        total = sum(len(d) for d in dfs)
        print(f"  {kind}: {len(dfs)} files, {total} rows total")


if __name__ == "__main__":
    main()
