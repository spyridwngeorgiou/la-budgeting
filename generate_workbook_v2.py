"""
LA Budgeting — Excel Workbook Generator (v2)
Produces LA_Budgeting_GR_v2.xlsx (Greek only), 7 tabs:
  1. Κέντρο Ελέγχου  — cockpit dashboard (read-only)
  2. Κινήσεις        — THE single source of truth (Excel Table): every income
                        & expense, every invoice, and every recurring /
                        installment plan (via the "Επαναλαμβανόμενο" flag) —
                        one unified ledger, entered once
  3. Έργα            — project registry + per-project totals (paid / upcoming
                        / +1, +6, +12-month forecast), all derived from Κινήσεις
  4. Ανάλυση         — KPIs + month filter + a real PivotTable
  5. Επαφές          — contact master list + per-contact financial summary
  6. Λογαριασμοί     — bank / cash / gold balances
  7. Οδηγίες         — user guide (Greek)

All transaction and contact data is pulled straight from
aade_exports/AADE_Master.xlsx (built by aade_exports_master.py from the
monthly myDATA exports) on every run; recurring/installment plans and manual
entries are then added by hand directly in Κινήσεις (see the Οδηγίες tab).
"""
import os
import copy
import datetime
from openpyxl import Workbook, load_workbook
from openpyxl.styles import PatternFill, Font, Alignment, Border, Side, Protection
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.utils import get_column_letter, column_index_from_string
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.chart import LineChart, Reference
from openpyxl.cell.text import InlineFont
from openpyxl.cell.rich_text import TextBlock, CellRichText

# ─── AADE / myDATA IMPORT (aade_exports/AADE_Master.xlsx) ────────────────────
OUR_AFM = "802801650"


def _load_aade_rows(base_dir):
    """Read aade_exports/AADE_Master.xlsx ("Έξοδα" + "Έσοδα" sheets, built by
    aade_exports_master.py from the monthly myDATA exports) and return a flat,
    date-sorted list of invoice rows ready to be dropped into the Κινήσεις
    table. This is the single source of truth for transactions & contacts."""
    master_path = os.path.join(base_dir, "aade_exports", "AADE_Master.xlsx")
    if not os.path.exists(master_path):
        return []

    def _num(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return 0.0

    def _date(v):
        if isinstance(v, datetime.datetime):
            return v.date()
        if isinstance(v, datetime.date):
            return v
        try:
            return datetime.datetime.strptime(str(v).strip(), "%d/%m/%Y").date()
        except ValueError:
            return None

    wb = load_workbook(master_path, data_only=True)
    sheets = {"expense": "Έξοδα", "income": "Έσοδα"}
    rows = []
    for kind, sheet_name in sheets.items():
        if sheet_name not in wb.sheetnames:
            continue
        ws = wb[sheet_name]
        headers = [c.value for c in ws[1]]
        idx = {h: i for i, h in enumerate(headers)}

        def val(cells, key):
            return cells[idx[key]].value if key in idx else None

        for cells in ws.iter_rows(min_row=2):
            issuer_afm = str(val(cells, "ΑΦΜ ΕΚΔΟΤΗ") or "").strip()
            receiver_afm = str(val(cells, "ΑΦΜ ΛΗΠΤΗ") or "").strip()
            counter_afm = receiver_afm if issuer_afm == OUR_AFM else issuer_afm
            name = str(val(cells, "Επωνυμία Αντισυμβαλλόμενου") or "").strip()
            rows.append({
                "date": _date(val(cells, "ΗΜΕΡΟΜΗΝΙΑ ΕΚΔΟΣΗΣ")),
                "contact": name or f"ΑΦΜ {counter_afm}",
                "afm": counter_afm,
                "desc": str(val(cells, "ΠΕΡΙΓΡΑΦΗ") or "").strip(),
                "net": _num(val(cells, "ΚΑΘΑΡΗ ΑΞΙΑ")),
                "amount": _num(val(cells, "ΣΥΝΟΛΙΚΗ ΑΞΙΑ")),
                "vat": _num(val(cells, "Φ.Π.Α.")),
                "withheld": _num(val(cells, "ΠΑΡΑΚΡ. ΦΟΡΟΙ")),
                "mark": str(val(cells, "ΜΑΡΚ") or ""),
                "kind": kind,
                "_afm_blank": not counter_afm,
            })

    # drop myDATA "recipient self-classification" duplicates: when the
    # issuer's own transmission is missing/mismatched, myDATA also creates a
    # stand-in row (blank counterparty ΑΦΜ) for the same underlying invoice
    # that the real, correctly-attributed row already covers. Keep the real
    # one whenever both exist for the same date/net/withheld amount.
    groups = {}
    for r in rows:
        key = (r["kind"], r["date"], round(r["net"], 2), round(r["withheld"], 2))
        groups.setdefault(key, []).append(r)
    deduped = []
    for group in groups.values():
        if len(group) > 1 and any(not g["_afm_blank"] for g in group):
            group = [g for g in group if not g["_afm_blank"]]
        deduped.extend(group)
    for r in deduped:
        del r["_afm_blank"]

    deduped.sort(key=lambda r: r["date"] or datetime.date.min)
    return deduped

# ─── COLOUR PALETTE — Clean Corporate (8-digit ARGB) ─────────────────────────
DARK_BLUE    = "FF1A2F4A"   # deep navy  — titles & primary headers
MED_BLUE     = "FF1868A8"   # ocean blue — sub-headers & accents
LIGHT_BLUE   = "FFE3EFF8"   # pale ice   — column headers & totals rows
YELLOW       = "FFFDF8ED"   # warm ivory — input / editable cells
LIGHT_GREY   = "FFF6F8FA"   # near-white — body row backgrounds
GREEN_BG     = "FFE8F8F1"   # mint       — Paid status background
GREEN_FG     = "FF0B6640"   # emerald    — Paid status text
RED_BG       = "FFFCEFEF"   # blush      — warning backgrounds
RED_FG       = "FF991B1B"   # crimson    — warning text
WHITE        = "FFFFFFFF"
BLACK        = "FF000000"
DARK_GREY    = "FF374151"   # slate      — secondary text
ORANGE_LIGHT = "FFFDF0D8"   # warm cream — Lazaraki section tint
PURPLE_LIGHT = "FFF0EEFF"   # soft lavender — Agiou K section tint
HAIRLINE     = "FFE2E8F0"   # faint line — row/section structure, not fill
# backgrounds treated as "no real fill" by the neutral-bg helpers below —
# lets every existing call site keep passing its old bg= kwarg unchanged
# while the busy alternating-grey look flattens to plain white everywhere.
_NEUTRAL_BG  = (LIGHT_GREY, WHITE, None)
EUR = '\u20ac#,##0.00'
# summary/dashboard sheets drop the cents \u2014 reconciliation-grade tabs
# (\u039a\u03b9\u03bd\u03ae\u03c3\u03b5\u03b9\u03c2, \u0395\u03c0\u03b1\u03c6\u03ad\u03c2, \u03a6\u03a0\u0391) keep EUR's two decimals since exact-to-the-cent
# matching is the point there.
EUR0 = '\u20ac#,##0'
EUR0_NEG = '\u20ac#,##0;[RED](\u20ac#,##0)'   # negative = red, in parentheses
PCT = '0.0%'

# ─── LANGUAGE ────────────────────────────────────────────────────────────────
LANG = "gr"          # set per build; "gr" or "en"
def t(gr, en):
    """Return the Greek or English string for the current build language."""
    return en if LANG == "en" else gr

# ─── STYLE HELPERS ───────────────────────────────────────────────────────────
def F(color):
    return PatternFill(start_color=color, end_color=color, fill_type="solid")

# ─── PROTECTION ──────────────────────────────────────────────────────────────
# Formula cells stay locked (openpyxl's default). Only cells the user is
# meant to type into are explicitly unlocked, then the sheet is protected —
# this stops a stray keystroke/drag-fill from silently overwriting a formula
# (which would look identical to a real value until the next recalc drifts).
UNLOCKED = Protection(locked=False)

def unlock_yellow(ws, max_row=None):
    """Unlock every cell filled with YELLOW (the workbook-wide "editable
    cell" colour, per the Info tab's colour guide) so protecting the sheet
    doesn't block the inputs that colour already tells the user to use."""
    for row in ws.iter_rows(min_row=1, max_row=max_row or ws.max_row):
        for cell in row:
            fg = cell.fill.fgColor
            if fg and fg.rgb == YELLOW:
                cell.protection = UNLOCKED

def protect_sheet(ws, max_row=None):
    """Turn on sheet protection while explicitly keeping sorting, filtering,
    row-insertion (needed for Table_Kin's Tab-to-add-row) and pivot refresh
    working — SheetProtection's booleans mean "this IS restricted", so each
    of these must be set False to stay allowed under protection."""
    unlock_yellow(ws, max_row)
    ws.protection.sheet = True
    ws.protection.formatCells = False
    ws.protection.formatColumns = False
    ws.protection.formatRows = False
    ws.protection.insertRows = False
    ws.protection.sort = False
    ws.protection.autoFilter = False
    ws.protection.pivotTables = False
    ws.protection.selectLockedCells = False

def Fnt(size=11, bold=False, color=None, italic=False):
    fg = color[2:] if color and color.startswith("FF") and len(color) == 8 else color
    return Font(name="Calibri", size=size, bold=bold,
                color=fg if fg else "000000", italic=italic)

def Aln(h="left", v="center", wrap=False):
    return Alignment(horizontal=h, vertical=v, wrap_text=wrap)

def Brd(color=HAIRLINE, sides="bottom"):
    """A thin hairline border — bottom-only by default. Row/section structure
    comes from this line, not from a filled background, matching the sparse
    reference-photo look: plain white rows separated by a faint rule instead
    of alternating grey/white fills."""
    side = Side(style="thin", color=color)
    if sides == "bottom":
        return Border(bottom=side)
    if sides == "all":
        return Border(top=side, bottom=side, left=side, right=side)
    return Border()

def _bg(color):
    """Fill colour to actually use — neutral (grey/white/unset) backgrounds
    collapse to plain white; a real status colour (green/red/amber/yellow/
    blue) passes straight through. Lets every existing call site keep its
    old bg= kwarg while the busy per-row tinting flattens out everywhere."""
    return WHITE if color in _NEUTRAL_BG else color

def col_hdr(ws, row, col, text, bg=LIGHT_BLUE, fg=DARK_GREY, size=10):
    c = ws.cell(row=row, column=col, value=text)
    c.fill = F(bg); c.font = Fnt(size=size, bold=True, color=fg)
    c.alignment = Aln(h="center"); c.border = Brd()

def wrap_lines(text, col_width):
    """Estimate how many wrapped lines `text` needs in an Excel column
    `col_width` units wide, so row heights can be sized to fit — instead of
    silently clipping wrapped text at a fixed row height."""
    if not text:
        return 1
    chars_per_line = max(6, int(col_width * 1.05))
    n, cur = 1, 0
    for word in str(text).split(" "):
        w = len(word) + 1
        if cur + w > chars_per_line and cur > 0:
            n += 1
            cur = w
        else:
            cur += w
    return n

def inp(ws, row, col, value, fmt=None, align_h="right"):
    c = ws.cell(row=row, column=col, value=value)
    c.fill = F(YELLOW); c.font = Fnt(); c.alignment = Aln(h=align_h)
    c.border = Brd(); c.protection = UNLOCKED
    if fmt: c.number_format = fmt
    return c

def calc(ws, row, col, formula, fmt=None, bg=LIGHT_GREY, bold=False, size=11, fg=None):
    c = ws.cell(row=row, column=col, value=formula)
    c.fill = F(_bg(bg)); c.font = Fnt(size=size, bold=bold, color=fg if fg else DARK_GREY)
    c.alignment = Aln(h="right"); c.border = Brd()
    if fmt: c.number_format = fmt
    return c

def lbl(ws, row, col, text, bg=LIGHT_GREY, bold=False, size=11, h="left"):
    c = ws.cell(row=row, column=col, value=text)
    c.fill = F(_bg(bg)); c.font = Fnt(size=size, bold=bold)
    c.alignment = Aln(h=h); c.border = Brd()
    return c

# ─── LAYOUT HELPERS ──────────────────────────────────────────────────────────
def mrow(ws, row, label, value, note="",
         label_bg=WHITE, value_bg=WHITE, note_bg=WHITE,
         label_bold=False, value_bold=False, value_size=11,
         value_color=None, value_fmt=None,
         accent=DARK_BLUE, height=22, col0=1):
    """col0 picks which 4-column block this KPI row lands in — col0=1 (the
    default, A-D) for a single-column sheet; col0=5 (E-H) for a second card
    sitting beside the first, used by Κέντρο Ελέγχου's two-column layout."""
    # auto-grow the row to fit whichever of label/note needs more wrapped
    # lines instead of trusting every caller's `height` to already match its
    # own text length — most callers leave the 22pt default even when their
    # note is a full sentence, so the wrapped text overflowed past the
    # row's boundary into whatever sits below it (numbers stayed compact,
    # long notes visually "bled" into neighbouring rows). Skipped for
    # formula-driven label/note text (starts with "=", e.g. ="..."&ViewMode)
    # since the rendered length can't be measured statically — those keep
    # the caller's explicit height, same as before.
    label_col_w = ws.column_dimensions[get_column_letter(col0 + 1)].width or 20
    note_col_w = ws.column_dimensions[get_column_letter(col0 + 3)].width or 20
    label_lines = 1 if str(label).startswith("=") else wrap_lines(label, label_col_w)
    note_lines = 1 if str(note).startswith("=") else wrap_lines(note, note_col_w)
    needed_lines = max(label_lines, note_lines)
    if needed_lines > 1:
        height = max(height, 14 * needed_lines + 8)
    # Κέντρο Ελέγχου's two-column layout calls mrow() TWICE per row — once
    # at col0=1 for the left card, once at col0=5 for the right card — and
    # row height is a whole-row property, not per-column. Without this, the
    # second call always overwrote whatever height the first call computed,
    # so a row with a long note on one side and a short one on the other
    # ended up sized for whichever call happened to run last, clipping the
    # other column's text — exactly the "some things compressed, others
    # full" symptom. Only ever growing (never shrinking) makes the row fit
    # BOTH columns regardless of call order.
    existing_height = ws.row_dimensions[row].height
    if existing_height:
        height = max(height, existing_height)
    ws.row_dimensions[row].height = height
    # thin left-edge accent line instead of a solid filled stripe — keeps a
    # hint of structure without the heavy colour-bar look the reference
    # photo doesn't have. accent=None (or a neutral colour) draws no line.
    a = ws.cell(row=row, column=col0)
    a.border = Border(left=Side(style="medium", color=accent)) if accent and accent not in _NEUTRAL_BG else Brd()
    b = ws.cell(row=row, column=col0 + 1, value=label)
    b.font = Fnt(size=11, bold=label_bold, color="FF374151")
    b.alignment = Aln(h="left", v="center", wrap=True); b.fill = F(_bg(label_bg))
    b.border = Brd()
    c = ws.cell(row=row, column=col0 + 2, value=value)
    fg = value_color if value_color else "FF374151"
    c.font = Fnt(size=value_size, bold=value_bold, color=fg)
    c.alignment = Aln(h="right", v="center"); c.fill = F(_bg(value_bg))
    c.border = Brd()
    if value_fmt: c.number_format = value_fmt
    d = ws.cell(row=row, column=col0 + 3, value=note)
    d.font = Fnt(size=10, italic=True, color="FF6B7280")
    d.alignment = Aln(h="left", v="center", wrap=True); d.fill = F(_bg(note_bg))
    d.border = Brd()
    return c

def sec_hdr(ws, row, text, number=None, height=28, end_col="D"):
    """Section heading: bold navy text (optionally numbered, e.g. "1 ·
    ΡΕΥΣΤΟΤΗΤΑ"), plain white background, faint hairline rule underneath —
    replaces the old solid dark-navy full-width bar with the reference
    photo's lighter, numbered-heading style. end_col="H" spans a two-column
    (A-D + E-H) layout instead of the default single A-D block."""
    ws.row_dimensions[row].height = height
    ws.merge_cells(f"A{row}:{end_col}{row}")
    label = f"{number} · {text}" if number else text
    c = ws.cell(row=row, column=1, value=label)
    c.font = Fnt(size=13, bold=True, color=DARK_BLUE)
    c.alignment = Aln(h="left", v="center")
    for col in range(1, column_index_from_string(end_col) + 1):
        ws.cell(row=row, column=col).border = Brd()

def spacer(ws, row, height=10, bg=WHITE):
    ws.row_dimensions[row].height = height
    for ci in range(1, 5): ws.cell(row=row, column=ci).fill = F(bg)

def sheet_intro(ws, row, text, end_col="D", height=None):
    """A short (1-3 sentence) italic narrative paragraph sitting directly
    under a sheet's title banner — the same treatment first used on
    19. Καθημερινά's row 2 (9pt italic slate FF6B7280 on near-white
    FFF6F8FA, left-aligned, wrapped), applied identically on every sheet so
    it reads as one deliberate design choice. Always reuses a row that was
    already blank/spacer beneath the title — never inserts a new row, so no
    downstream row-numbered formula reference ever shifts."""
    end_ci = column_index_from_string(end_col)
    total_width = sum((ws.column_dimensions[get_column_letter(ci)].width or 10)
                       for ci in range(1, end_ci + 1))
    if height is None:
        lines = wrap_lines(text, total_width)
        height = 14 + lines * 13
    ws.row_dimensions[row].height = height
    ws.merge_cells(f"A{row}:{end_col}{row}")
    c = ws.cell(row=row, column=1, value="  " + text)
    c.fill = F("FFF6F8FA"); c.font = Fnt(size=9, italic=True, color="FF6B7280")
    c.alignment = Aln(h="left", v="center", wrap=True)
    return c

def _info_tab(wb, title, tab_title, sections):
    """Build a styled info/guide tab."""
    ws = wb.create_sheet(tab_title)
    ws.sheet_view.showGridLines = False
    B_W, C_W = 60, 32
    ws.column_dimensions["A"].width = 3
    ws.column_dimensions["B"].width = B_W
    ws.column_dimensions["C"].width = C_W
    ws.column_dimensions["D"].width = 4

    def est_lines(s, width):
        """Estimate how many wrapped lines `s` needs in a column `width` chars wide."""
        if not s:
            return 1
        cpl = max(8, int(width * 1.05))
        n, cur = 1, 0
        for word in str(s).split(" "):
            w = len(word) + 1
            if cur + w > cpl and cur > 0:
                n += 1
                cur = w
            else:
                cur += w
        return n

    ACCENT = "FF1A2F4A"
    ws.row_dimensions[1].height = 40
    ws.merge_cells("A1:D1")
    c = ws.cell(row=1, column=1, value=f"  {title}")
    c.fill = PatternFill(start_color=ACCENT, end_color=ACCENT, fill_type="solid")
    c.font = Font(name="Calibri", size=16, bold=True, color="FFFFFF")
    c.alignment = Alignment(horizontal="left", vertical="center")

    ws.row_dimensions[2].height = 6
    for ci in range(1, 5):
        ws.cell(row=2, column=ci).fill = PatternFill(start_color="FFF6F8FA",
                                                     end_color="FFF6F8FA", fill_type="solid")

    row = 3
    thin = Side(border_style="thin", color="FFCCD5DF")

    for sec_title, sec_color, items in sections:
        ws.row_dimensions[row].height = 26
        ws.cell(row=row, column=1).fill = PatternFill(start_color=sec_color,
                                                      end_color=sec_color, fill_type="solid")
        ws.merge_cells(f"B{row}:D{row}")
        c = ws.cell(row=row, column=2, value=f"  {sec_title}")
        c.fill = PatternFill(start_color="FFF6F8FA", end_color="FFF6F8FA", fill_type="solid")
        c.font = Font(name="Calibri", size=11, bold=True, color="1A2F4A")
        c.alignment = Alignment(horizontal="left", vertical="center")
        c.border = Border()
        row += 1

        for (rtype, text, note) in items:
            if rtype == "sp":
                ws.row_dimensions[row].height = int(text) if text else 8
                for ci in range(1, 5):
                    ws.cell(row=row, column=ci).fill = PatternFill(
                        start_color="FFFFFFFF", end_color="FFFFFFFF", fill_type="solid")
                row += 1
                continue

            a = ws.cell(row=row, column=1)

            if rtype == "h":
                bg = "FFE3EFF8"; fg = "1A2F4A"; bold = True; size = 11
                a.fill = PatternFill(start_color="FF1868A8", end_color="FF1868A8", fill_type="solid")
            elif rtype == "s":
                bg = "FFFFFFFF"; fg = "374151"; bold = False; size = 11
                a.fill = PatternFill(start_color="FF1A2F4A", end_color="FF1A2F4A", fill_type="solid")
            elif rtype == "tip":
                bg = "FFFDF8ED"; fg = "7A3800"; bold = False; size = 10
                a.fill = PatternFill(start_color="FFFF9800", end_color="FFFF9800", fill_type="solid")
            elif rtype == "clr":
                bg, fg, bold, size = text[0], text[1], False, 10
                a.fill = PatternFill(start_color=bg, end_color=bg, fill_type="solid")
                a.border = Border()
                ws.merge_cells(f"B{row}:D{row}")
                bcell = ws.cell(row=row, column=2, value=f"  {note}")
                bcell.fill = PatternFill(start_color=bg, end_color=bg, fill_type="solid")
                fgc = fg[2:] if fg.startswith("FF") and len(fg) == 8 else fg
                bcell.font = Font(name="Calibri", size=10, bold=True, color=fgc)
                bcell.alignment = Alignment(horizontal="left", vertical="center")
                bcell.border = Border()
                ws.cell(row=row, column=4).fill = PatternFill(
                    start_color=bg, end_color=bg, fill_type="solid")
                ws.row_dimensions[row].height = 22
                row += 1
                continue
            else:
                bg = "FFFFFFFF"; fg = "374151"; bold = False; size = 11
                a.fill = PatternFill(start_color="FFF6F8FA", end_color="FFF6F8FA", fill_type="solid")

            a.border = Border()

            has_note = bool(note)
            if not has_note:
                ws.merge_cells(f"B{row}:C{row}")
            main_w = (B_W + C_W) if not has_note else B_W

            bcell = ws.cell(row=row, column=2, value=text)
            fgc = fg[2:] if fg.startswith("FF") and len(fg) == 8 else fg
            bcell.font = Font(name="Calibri", size=size, bold=bold, color=fgc)
            bcell.fill = PatternFill(start_color=bg, end_color=bg, fill_type="solid")
            bcell.border = Border()

            ncell = None
            if has_note:
                ncell = ws.cell(row=row, column=3, value=note)
                ncell.font = Font(name="Calibri", size=10, italic=True, color="6B7280")
                ncell.fill = PatternFill(start_color=bg, end_color=bg, fill_type="solid")
                ncell.border = Border()

            dcell = ws.cell(row=row, column=4)
            dcell.fill = PatternFill(start_color=bg, end_color=bg, fill_type="solid")
            dcell.border = Border()

            # dynamic row height so wrapped guide text is never clipped
            lines = max(est_lines(text, main_w), est_lines(note, C_W))
            per = 15 if size >= 11 else 14
            ws.row_dimensions[row].height = max(20, lines * per + 7)
            vtop = "top" if lines > 1 else "center"
            bcell.alignment = Alignment(horizontal="left", vertical=vtop, wrap_text=True)
            if ncell is not None:
                ncell.alignment = Alignment(horizontal="left", vertical=vtop, wrap_text=True)
            row += 1

        ws.row_dimensions[row].height = 10
        for ci in range(1, 5):
            ws.cell(row=row, column=ci).fill = PatternFill(
                start_color="FFFFFFFF", end_color="FFFFFFFF", fill_type="solid")
        row += 1

    return ws


# ══════════════════════════════════════════════════════════════════════════════
# BUILD ONE WORKBOOK (language driven by the global LANG via t())
# ══════════════════════════════════════════════════════════════════════════════
def build_workbook():
    # localized status / source values (also used inside formulas & dropdowns)
    S_PAID   = t("\u03a0\u03bb\u03b7\u03c1\u03c9\u03bc\u03ad\u03bd\u03bf", "Paid")
    S_UPCOM  = t("\u0395\u03ba\u03ba\u03c1\u03b5\u03bc\u03b5\u03af", "Upcoming")
    S_HOLD   = t("\u03a3\u03b5 \u03b1\u03bd\u03b1\u03bc\u03bf\u03bd\u03ae", "On Hold")
    # a firm forecast line (a modeled construction phase, an estimated
    # legal fee) that is NOT yet a real commitment the way \u0395\u03ba\u03ba\u03c1\u03b5\u03bc\u03b5\u03af is \u2014
    # matches \u0395\u03c0\u03b9\u03c7\u03b5\u03b9\u03c1\u03b7\u03c3\u03b9\u03b1\u03ba\u03cc_\u0391\u03c1\u03c7\u03b5\u03af\u03bf_107.xlsx's own \u039a\u03b1\u03c4\u03ac\u03c3\u03c4\u03b1\u03c3\u03b7 value and its
    # explicit rule (\u039a\u03b9\u03bd\u03ae\u03c3\u03b5\u03b9\u03c2 row 90's note): "\u0394\u0395\u039d \u03bc\u03b5\u03c4\u03c1\u03ac\u03b5\u03b9 \u03c3\u03c4\u03bf \u03c4\u03b1\u03bc\u03b5\u03af\u03bf" \u2014
    # excluded from \u03a4\u03b1\u03bc\u03b5\u03af\u03bf's cash forecast (see exclude_status= below),
    # while still showing normally everywhere else (\u0388\u03c1\u03b3\u03b1, \u0391\u03bd\u03ac\u03bb\u03c5\u03c3\u03b7, \u03a6\u03a0\u0391).
    S_SCHED  = t("\u03a0\u03c1\u03bf\u03b3\u03c1\u03b1\u03bc\u03bc\u03b1\u03c4\u03b9\u03c3\u03bc\u03ad\u03bd\u03bf", "Scheduled")
    SRC_CASH = t("\u039c\u03b5\u03c4\u03c1\u03b7\u03c4\u03ac", "Cash")
    SRC_TBD  = t("\u03a0\u03c1\u03bf\u03c2 \u03ba\u03b1\u03b8\u03bf\u03c1\u03b9\u03c3\u03bc\u03cc", "TBD")
    SRC_GOLD = t("\u03a7\u03c1\u03c5\u03c3\u03cc\u03c2", "Gold")
    SRC_OPT_CORP = "Optima \u0395\u03c4\u03b1\u03b9\u03c1\u03b9\u03ba\u03cc\u03c2"
    SRC_PIR_PERS = "\u03a0\u03b5\u03b9\u03c1\u03b1\u03b9\u03ce\u03c2 \u03a0\u03c1\u03bf\u03c3\u03c9\u03c0\u03b9\u03ba\u03cc\u03c2"
    SRC_ALPHA    = "Alpha \u03a0\u03c1\u03bf\u03c3\u03c9\u03c0\u03b9\u03ba\u03cc\u03c2"
    SRC_OPT_PERS = "Optima \u03a0\u03c1\u03bf\u03c3\u03c9\u03c0\u03b9\u03ba\u03cc\u03c2"
    SRC_N26      = "N26 \u03a0\u03c1\u03bf\u03c3\u03c9\u03c0\u03b9\u03ba\u03cc\u03c2"
    SRC_CRYPTO   = "\u039a\u03c1\u03c5\u03c0\u03c4\u03bf\u03bd\u03bf\u03bc\u03af\u03c3\u03bc\u03b1\u03c4\u03b1 (Exodus)"
    A_PEND   = t("\u0395\u03ba\u03ba\u03c1\u03b5\u03bc\u03b5\u03af", "Pending")
    A_RECV   = t("\u0395\u03bb\u03ae\u03c6\u03b8\u03b7", "Received")
    A_CANC   = t("\u0391\u03ba\u03c5\u03c1\u03ce\u03b8\u03b7\u03ba\u03b5", "Cancelled")

    # business vs. personal split \u2014 everything still lives in ONE ledger
    # (Table_Kin), so cash runway / income / expense totals cover both by
    # just not filtering on this column; only the VAT-specific KPIs
    # (\u039a\u03ad\u03bd\u03c4\u03c1\u03bf \u0395\u03bb\u03ad\u03b3\u03c7\u03bf\u03c5's \u03a6\u03a0\u0391 tiles + the whole \u03a6\u03a0\u0391 sheet) filter down to
    # SCOPE_BIZ, since personal spending has no business VAT-filing relevance.
    # Defined here (not down in the \u039a\u03b9\u03bd\u03ae\u03c3\u03b5\u03b9\u03c2 section) because \u039a\u03ad\u03bd\u03c4\u03c1\u03bf \u0395\u03bb\u03ad\u03b3\u03c7\u03bf\u03c5,
    # built first, already needs H_SCOPE/SCOPE_BIZ for its VAT KPIs.
    H_SCOPE     = "\u03a0\u03b5\u03b4\u03af\u03bf"
    H_CATEGORY  = "\u039a\u03b1\u03c4\u03b7\u03b3\u03bf\u03c1\u03af\u03b1"
    SCOPE_BIZ   = t("\u0395\u03c0\u03b9\u03c7\u03b5\u03b9\u03c1\u03b7\u03bc\u03b1\u03c4\u03b9\u03ba\u03cc", "Business")
    SCOPE_PERS  = t("\u03a0\u03c1\u03bf\u03c3\u03c9\u03c0\u03b9\u03ba\u03cc", "Personal")
    # \u039b\u03bf\u03b3\u03b1\u03c1\u03b9\u03b1\u03c3\u03bc\u03bf\u03af's account Owner tag \u2014 a real constant (not the inline
    # literal it used to be per account row) so the company-only filter
    # this drives on \u039a\u03ad\u03bd\u03c4\u03c1\u03bf \u0395\u03bb\u03ad\u03b3\u03c7\u03bf\u03c5/\u03a4\u03b1\u03bc\u03b5\u03af\u03bf can never drift out of sync with
    # what's actually written on each account row.
    OWNER_CORP  = t("\u0395\u03c4\u03b1\u03b9\u03c1\u03b9\u03ba\u03cc\u03c2", "Corporate")
    OWNER_PERS  = t("\u03a0\u03c1\u03bf\u03c3\u03c9\u03c0\u03b9\u03ba\u03cc\u03c2", "Personal")
    # three-way cash-view toggle, now a visible control on \u039a\u03ad\u03bd\u03c4\u03c1\u03bf \u0395\u03bb\u03ad\u03b3\u03c7\u03bf\u03c5
    # itself (top-right of row 1) rather than buried on \u03a1\u03c5\u03b8\u03bc\u03af\u03c3\u03b5\u03b9\u03c2 \u2014 defined
    # here, not down on \u03a1\u03c5\u03b8\u03bc\u03af\u03c3\u03b5\u03b9\u03c2, for the same reason as OWNER_CORP above:
    # \u039a\u03ad\u03bd\u03c4\u03c1\u03bf \u0395\u03bb\u03ad\u03b3\u03c7\u03bf\u03c5 builds its funds formulas before \u03a1\u03c5\u03b8\u03bc\u03af\u03c3\u03b5\u03b9\u03c2 exists.
    VIEW_CORP = t("\u0395\u03c4\u03b1\u03b9\u03c1\u03b9\u03ba\u03ac", "Corporate")
    VIEW_PERS = t("\u03a0\u03c1\u03bf\u03c3\u03c9\u03c0\u03b9\u03ba\u03ac", "Personal")
    VIEW_ALL  = t("\u038c\u03bb\u03b1", "All")
    # \u039b\u03bf\u03b3\u03b1\u03c1\u03b9\u03b1\u03c3\u03bc\u03bf\u03af's account-table geometry, hoisted here (not just declared
    # inside the \u039b\u03bf\u03b3\u03b1\u03c1\u03b9\u03b1\u03c3\u03bc\u03bf\u03af section, which builds after \u039a\u03ad\u03bd\u03c4\u03c1\u03bf \u0395\u03bb\u03ad\u03b3\u03c7\u03bf\u03c5) so
    # the dashboard's Section 1 breakdown rows can reference the real
    # ranges directly \u2014 SUMIFS over an actual table \u2014 instead of the old
    # fixed D5:D9/D10:D10/D11:D12 slices, which silently ignored Extra
    # Accounts and (for D11:D12) used to double as the now-removed
    # \u03a7\u03c1\u03c5\u03c3\u03cc\u03c2/\u039a\u03c1\u03c5\u03c0\u03c4\u03cc rows. Keep in sync with the `accounts` list built in
    # the \u039b\u03bf\u03b3\u03b1\u03c1\u03b9\u03b1\u03c3\u03bc\u03bf\u03af section \u2014 an assert there catches drift.
    ACC_FIRST = 5
    ACC_LAST = ACC_FIRST + 6 - 1   # 5 banks + \u039c\u03b5\u03c4\u03c1\u03b7\u03c4\u03ac (\u03c6\u03c5\u03c3\u03b9\u03ba\u03ac)
    EXTRA_ACC_FIRST, EXTRA_ACC_LAST = ACC_LAST + 27, ACC_LAST + 36
    ACC_TYPE_BANK = t("\u03a4\u03c1\u03ac\u03c0\u03b5\u03b6\u03b1", "Bank")
    ACC_TYPE_CASH = t("\u039c\u03b5\u03c4\u03c1\u03b7\u03c4\u03ac", "Cash")
    CAT_HOUSING   = t("\u03a3\u03c0\u03af\u03c4\u03b9/\u0395\u03bd\u03bf\u03af\u03ba\u03b9\u03bf", "Housing/Rent")
    CAT_UTILS     = t("\u039b\u03bf\u03b3\u03b1\u03c1\u03b9\u03b1\u03c3\u03bc\u03bf\u03af (\u0394\u0395\u0397/\u039f\u03a4\u0395/\u039d\u03b5\u03c1\u03cc)", "Utilities")
    CAT_GROCERY   = t("\u0394\u03b9\u03b1\u03c4\u03c1\u03bf\u03c6\u03ae", "Groceries")
    CAT_TRANSPORT = t("\u039c\u03b5\u03c4\u03b1\u03ba\u03af\u03bd\u03b7\u03c3\u03b7/\u0391\u03c5\u03c4\u03bf\u03ba\u03af\u03bd\u03b7\u03c4\u03bf", "Transport/Car")
    CAT_HEALTH    = t("\u03a5\u03b3\u03b5\u03af\u03b1", "Health")
    CAT_INSURANCE = t("\u0391\u03c3\u03c6\u03ac\u03bb\u03b5\u03b9\u03b5\u03c2", "Insurance")
    CAT_EDU       = t("\u0395\u03ba\u03c0\u03b1\u03af\u03b4\u03b5\u03c5\u03c3\u03b7", "Education")
    CAT_FUN       = t("\u0394\u03b9\u03b1\u03c3\u03ba\u03ad\u03b4\u03b1\u03c3\u03b7", "Entertainment")
    CAT_CLOTHES   = t("\u03a1\u03bf\u03cd\u03c7\u03b1", "Clothing")
    CAT_OTHER     = t("\u039b\u03bf\u03b9\u03c0\u03ac \u03a0\u03c1\u03bf\u03c3\u03c9\u03c0\u03b9\u03ba\u03ac", "Other Personal")
    PERSONAL_CATEGORIES = [CAT_HOUSING, CAT_UTILS, CAT_GROCERY, CAT_TRANSPORT, CAT_HEALTH,
                            CAT_INSURANCE, CAT_EDU, CAT_FUN, CAT_CLOTHES, CAT_OTHER]

    # ── richer personal-spending taxonomy, ported from Επιχειρησιακό_
    # Αρχείο_107.xlsx's own Καθημερινά sheet (its real category values, read
    # directly off that sheet — not guessed) — ADDED alongside the original
    # 10 CAT_* categories above, not replacing them: PERSONAL_CATEGORIES/
    # the dashboard's fixed 2×5 Personal Spending card grid (rows 37-42,
    # further below) and the original LIST_CATEGORY 10 values stay exactly
    # as they were, so this is purely additive. These 15 values are
    # appended to the SAME Ρυθμίσεις dropdown column (see set_lists below)
    # so they become selectable on Κινήσεις immediately, and they drive the
    # new 19. Καθημερινά / 20. Μηνιάτικα sheets' rollups.
    PCAT_SUBS    = t("Συνδρομές & Ψηφιακά", "Subscriptions & Digital")
    PCAT_UTIL    = t("ΔΕΚΟ & Τηλεπικοινωνίες", "Utilities & Telecom")
    PCAT_TRANSFER = t("Εμβάσματα σε τρίτους", "Transfers to Others")
    PCAT_DINING  = t("Εστίαση & Καφέ", "Dining & Coffee")
    PCAT_BANKFEE = t("Τραπεζικά έξοδα", "Bank Fees")
    PCAT_TAXES   = t("Φόροι & Οφειλές", "Taxes & Dues")
    PCAT_SUPER   = t("Supermarket & Τρόφιμα", "Supermarket & Groceries")
    PCAT_CLOTHCARE = t("Ένδυση & Προσωπική φροντίδα", "Clothing & Personal Care")
    PCAT_BIZCHECK = t("Επιχειρησιακά (προς έλεγχο)", "Business (to review)")
    PCAT_TRANSPORT2 = t("Μεταφορές & Καύσιμα", "Transport & Fuel")
    PCAT_FUN2    = t("Ψυχαγωγία & Αθλητισμός", "Entertainment & Sports")
    PCAT_PETS    = t("Κατοικίδια", "Pets")
    PCAT_HEALTH2 = t("Υγεία & Φαρμακείο", "Health & Pharmacy")
    PCAT_GOLDINV = t("Χρυσός & Επενδύσεις", "Gold & Investments")
    PCAT_INSUR2  = t("Ασφάλειες", "Insurance")
    PERSONAL_CATEGORIES_DETAIL = [PCAT_SUBS, PCAT_UTIL, PCAT_TRANSFER, PCAT_DINING, PCAT_BANKFEE,
                                   PCAT_TAXES, PCAT_SUPER, PCAT_CLOTHCARE, PCAT_BIZCHECK,
                                   PCAT_TRANSPORT2, PCAT_FUN2, PCAT_PETS, PCAT_HEALTH2,
                                   PCAT_GOLDINV, PCAT_INSUR2]
    # the 6 real spending groups from the source file's own Καθημερινά
    # "Ομάδα" column, read directly off that sheet. Επιχειρησιακά (προς
    # έλεγχο) and Χρυσός & Επενδύσεις are tagged "— εκτός —" (excluded) in
    # the source itself — they aren't personal spending (one is a mis-
    # coded business charge pending reclassification, the other is an
    # investment purchase, not an expense) — so they're deliberately left
    # OUT of this map; the two new sheets below skip them from the 6-group
    # rollup for the same reason the source file does.
    PGRP_PEOPLE  = t("Άνθρωποι", "People")
    PGRP_EAT     = t("Τρώω & κινούμαι", "Eating & Getting Around")
    PGRP_HOME    = t("Στέγη & πάγια", "Home & Fixed Costs")
    PGRP_SELF    = t("Εαυτός", "Self")
    PGRP_MISC    = t("Αταξινόμητα", "Unclassified")
    PGRP_PETSHOME = t("Σπίτι & ζώα", "House & Pets")
    PERSONAL_GROUPS = [PGRP_PEOPLE, PGRP_EAT, PGRP_HOME, PGRP_SELF, PGRP_MISC, PGRP_PETSHOME]
    PERSONAL_CATEGORY_GROUP = {
        PCAT_TRANSFER:   PGRP_PEOPLE,
        PCAT_DINING:     PGRP_EAT,
        PCAT_SUPER:      PGRP_EAT,
        PCAT_TRANSPORT2: PGRP_EAT,
        PCAT_SUBS:       PGRP_HOME,
        PCAT_UTIL:       PGRP_HOME,
        PCAT_BANKFEE:    PGRP_HOME,
        PCAT_INSUR2:     PGRP_HOME,
        PCAT_CLOTHCARE:  PGRP_SELF,
        PCAT_FUN2:       PGRP_SELF,
        PCAT_HEALTH2:    PGRP_SELF,
        PCAT_TAXES:      PGRP_MISC,
        PCAT_PETS:       PGRP_PETSHOME,
        # PCAT_BIZCHECK, PCAT_GOLDINV deliberately absent — "— εκτός —" in
        # the source, excluded from the group rollup (see comment above).
    }

    # business-income sub-tag — Κατηγορία is otherwise only meaningful on
    # Personal rows (Personal Spending only reads it when Πεδίο=Προσωπικό),
    # so reusing it here for Έσοδο rows doesn't collide with anything.
    # Needed because Προϋπολογισμοί's "Δανειακή χρηματοδότηση" used to sum
    # EVERY income row for a project — a client fee reduced the reported
    # financing gap exactly like a loan drawdown would have.
    CAT_LOAN = t("Δάνειο", "Loan")

    # Κινήσεις column-header keys, also used as Table_Kin structured-reference
    # names in formulas everywhere (Κέντρο Ελέγχου, Ταμείο, ΦΠΑ, Έργα, ...).
    # Defined here rather than down in the Κινήσεις section because Κέντρο
    # Ελέγχου, built first, already needs several of them (via _recur_monthly
    # below) for its VAT KPIs and Personal Spending rollup.
    TYPE_INC = "Έσοδο"
    TYPE_EXP = "Έξοδο"
    ORIG_MANUAL = "Χειρόγραφο"
    ORIG_AADE   = "AADE"
    FIRST_DATA_ROW = 13   # first Κινήσεις data row — used by Ανάλυση's Top-5 lookup

    H_DATE      = "Ημερομηνία"
    H_CONTACT   = "Επαφή"
    H_AFM       = "ΑΦΜ"
    H_PROJECT   = "Έργο"
    H_DESC      = "Περιγραφή"
    H_TYPE      = "Τύπος"
    H_AMOUNT    = "Ποσό"
    H_VAT       = "ΦΠΑ"
    H_WITHHELD  = "Παρακράτηση"
    H_SOURCE    = "Πηγή"
    H_STATUS    = "Κατάσταση"
    H_ORIGIN    = "Προέλευση"
    H_MARK      = "Αρ. Παραστατικού"
    H_DUE       = "Ημ/νία Λήξης"
    H_NET       = "Καθαρή Αξία"
    H_NOTES     = "Σημειώσεις"
    H_MONTH     = "Μήνας"
    H_REC       = "Επαναλαμβανόμενο"
    H_RECCOUNT  = "Αριθμός Επαναλήψεων"
    H_RECEND    = "Ημ/νία Λήξης Επανάληψης"
    H_RECPAID_ACTUAL = "Ημ/νία Τελ. Πληρωμένης Δόσης"
    H_RECPAID_EXP     = "Αναμενόμενες Δόσεις Μέχρι Σήμερα"
    H_OVERDUE_N = "Ληξιπρόθεσμες Δόσεις"
    H_PAIDTOTAL = "Πληρωμένο Μέχρι Σήμερα"
    H_REMAINING = "Υπόλοιπο Δέσμευσης"
    H_OVERDUE_AMT = "Ληξιπρόθεσμο Ποσό"
    H_NEXT30    = "Ποσό Επόμ. 30 Ημ."
    H_NEXT180   = "Ποσό Επόμ. 180 Ημ."
    H_NEXT365   = "Ποσό Επόμ. 365 Ημ."
    H_NEXTDUE   = "Επόμενη Δόση"
    H_YEAR      = "Έτος"
    H_MONTHNUM  = "Μήνας (Αριθμός)"
    H_DAYNUM    = "Ημέρα"
    # plain (non-grouped) helper columns for the "6. Ελεύθερη Ανάλυση"
    # pivot's date-as-columns layout — Excel's own automatic date GROUPING
    # (Group() on the real Ημερομηνία field) always renders its generated
    # Year/Quarter/Month/Day fields in a fixed finest-to-coarsest order when
    # placed on the COLUMN axis, not reorderable via Position,
    # ColumnFields(i).Position, or re-insertion — confirmed by direct,
    # exhaustive testing against this exact file. Ordinary un-grouped
    # fields DO respect insertion order on columns (also confirmed) — BUT
    # only once more fact was confirmed: after a save+reload, Excel
    # silently re-sorts multiple column fields to match their SOURCE TABLE
    # COLUMN ORDER, overriding whatever order they were inserted in. Since
    # the real Ημερομηνία column is fixed at column A (used by hundreds of
    # formulas — moving it is not an option) and the real Μήνας column is
    # fixed at column Q, those two would always render as the OUTERMOST
    # column fields (lowest column index) regardless of insertion order —
    # backwards from the wanted coarse-outer/fine-inner nesting. The fix:
    # 4 entirely new TRAILING columns (Έτος, Τρίμηνο, H_MONTH_PIVOT,
    # H_DAYNUM below), added in exactly coarse-to-fine order, so their
    # relative table-column position — which is what actually determines
    # pivot column order after a save — already matches what's wanted. Each
    # mirrors an existing column's value under a new name/position; nothing
    # about Ημερομηνία or Μήνας themselves changes.
    H_QUARTER   = "Τρίμηνο"
    H_MONTH_PIVOT = "Μήνας (Ανάλυση)"
    REC_YES     = "Ναι"
    REC_NO      = "Όχι"
    # per-row collection probability for NOT-YET-PAID income (loan tranches
    # "in application", unconfirmed client fees, etc.) — Ταμείο used to
    # treat every Εκκρεμεί Έσοδο row as 100% certain cash, which is how a
    # €1.6M loan application still "in application" showed up as €1.9M of
    # real 2027 cash in the forecast. Blank = 100% (unaffected) so ordinary
    # confirmed-but-unpaid income (an issued invoice, a signed lease) isn't
    # penalized by default — only rows someone has explicitly flagged as
    # uncertain get discounted.
    H_PROB      = "Πιθανότητα Είσπραξης"
    H_AMOUNT_WEIGHTED = "Ποσό Σταθμισμένο"
    # a stable per-row fingerprint (date+contact AFM+amount+invoice mark) so
    # a re-import from myDATA can be checked for "does this ID already
    # exist?" before appending — the fetch/import scripts still need to do
    # that check themselves, this column just gives them (and the QC sheet)
    # something deterministic to check against.
    H_TXID = "Μοναδικό ID"
    # months-since-epoch (YEAR*12+MONTH) for this row's own Ημερομηνία,
    # computed ONCE per row — _recur_monthly's months_since expression used
    # to call YEAR()/MONTH() on the WHOLE Ημερομηνία column inline, every
    # single time it's evaluated (dozens of SUMPRODUCTs across Κέντρο
    # Ελέγχου/Ταμείο/ΦΠΑ/Προϋπολογισμοί/Μισθώματα, each scanning the same
    # ~54+ rows). Referencing this column instead turns that into one
    # subtraction against an already-computed number.
    H_MONTH_EPOCH = "Δείκτης Μήνα"

    def _recur_monthly(col_name, type_filter, month_ref, project_ref=None, mode="any", scope=None, category_ref=None, exclude_status=None):
        """Monthly total for `col_name`/`type_filter` in the month named by
        `month_ref` (a cell holding "YYYY-MM" text) — used by every monthly
        rollup sheet (Κέντρο Ελέγχου, Ταμείο, ΦΠΑ, Προϋπολογισμοί's monthly table).

        A plain SUMIFS on Table_Kin[Μήνας] only ever matches a recurring
        row's OWN recorded date (the 1st installment), because that's the
        only date stored on the row — so a 72-installment plan would show up
        as an expense in exactly one month and then silently vanish from
        every monthly view for the other 71, even though it's still owed
        every month. This combines a plain SUMIFS for ordinary (non-
        recurring) rows with a SUMPRODUCT that walks each recurring row's
        own schedule (same technique as Ανάλυση's "Δόσεις Επιλεγμένου Μήνα")
        to determine whether THIS month falls inside it.

        mode: "any" = due that month regardless of paid status (for
        Έσοδα/Έξοδα/ΦΠΑ totals); "paid" = only installments already marked
        paid via «Ημ/νία Τελ. Πληρωμένης Δόσης»; "outstanding" = only
        installments not yet marked paid.

        scope: pass SCOPE_BIZ to restrict to business rows only (used by the
        ΦΠΑ sheet — personal spending isn't part of a VAT filing); leave
        None for combined business+personal totals (Ταμείο's cash forecast,
        which is meant to cover the whole household/company cash pool).

        category_ref: a cell/literal holding a Κατηγορία value (or a quoted
        literal like '"Σπίτι/Ενοίκιο"') to restrict to one personal spending
        category — used by the Personal Spending rollup.

        exclude_status: a Κατάσταση value to leave out of an "any"-mode
        total — used by Ταμείο only, to keep S_SCHED (Προγραμματισμένο)
        rows out of the cash forecast per Επιχειρησιακό_Αρχείο_107.xlsx's
        own rule for that status ("ΔΕΝ μετράει στο ταμείο"), while every
        other sheet (Έργα, Ανάλυση, ΦΠΑ, Προϋπολογισμοί) keeps counting
        them normally — those aren't a cash-timing view, so a modeled/
        forecast line is still real budget exposure there.
        """
        proj_sumifs = f',Table_Kin[{H_PROJECT}],{project_ref}' if project_ref else ''
        proj_mult = f'*(Table_Kin[{H_PROJECT}]={project_ref})' if project_ref else ''
        cat_sumifs = f',Table_Kin[{H_CATEGORY}],{category_ref}' if category_ref else ''
        cat_mult = f'*(Table_Kin[{H_CATEGORY}]={category_ref})' if category_ref else ''
        status_sumifs = ''
        if mode == "paid":
            status_sumifs = f',Table_Kin[{H_STATUS}],"{S_PAID}"'
        elif mode == "outstanding":
            status_sumifs = f',Table_Kin[{H_STATUS}],"{S_UPCOM}"'
        elif exclude_status:
            status_sumifs = f',Table_Kin[{H_STATUS}],"<>{exclude_status}"'
        excl_mult = f'*(Table_Kin[{H_STATUS}]<>"{exclude_status}")' if (exclude_status and mode == "any") else ''
        scope_sumifs = f',Table_Kin[{H_SCOPE}],"{scope}"' if scope else ''
        scope_mult = f'*(Table_Kin[{H_SCOPE}]="{scope}")' if scope else ''
        oneoff = (f'SUMIFS(Table_Kin[{col_name}],Table_Kin[{H_TYPE}],"{type_filter}",'
                  f'Table_Kin[{H_MONTH}],{month_ref},Table_Kin[{H_REC}],"<>{REC_YES}"{status_sumifs}{proj_sumifs}{scope_sumifs}{cat_sumifs})')

        sel_year, sel_month = f'VALUE(LEFT({month_ref},4))', f'VALUE(RIGHT({month_ref},2))'
        kdate, kcount = f'Table_Kin[{H_DATE}]', f'Table_Kin[{H_RECCOUNT}]'
        kactual, kcol = f'Table_Kin[{H_RECPAID_ACTUAL}]', f'Table_Kin[{col_name}]'
        krec, ktype = f'Table_Kin[{H_REC}]', f'Table_Kin[{H_TYPE}]'
        # Δείκτης Μήνα (Table_Kin's own precomputed YEAR*12+MONTH per row)
        # instead of calling YEAR()/MONTH() on the whole Ημερομηνία column
        # inline every time this SUMPRODUCT runs — this expression fires
        # dozens of times across Κέντρο Ελέγχου/Ταμείο/ΦΠΑ/Προϋπολογισμοί/
        # Μισθώματα, each rescanning every row, so replacing two function
        # calls per row with one column reference is a real recalculation
        # cost cut, not a cosmetic change.
        months_since = f'(({sel_year}*12+{sel_month})-Table_Kin[{H_MONTH_EPOCH}])'
        # kactual now holds a DATE (last paid installment), not a raw
        # count, so the number of installments paid has to be derived —
        # months between the row's own start date and that last-paid date,
        # +1 inclusive. Built with YEAR()/MONTH() rather than DATEDIF() on
        # purpose: DATEDIF raises #NUM! if its end date is before its start
        # date, which blank kactual cells would trigger across the WHOLE
        # array the moment this SUMPRODUCT runs (multiplying an error by 0
        # still yields an error, it doesn't zero it out) — YEAR/MONTH treat
        # a blank cell as 0 without erroring, so the same
        # comparison+multiply guard used elsewhere in this expression
        # (rather than IF(), which was proven to get silently auto-@-
        # qualified by Excel inside a whole-column SUMPRODUCT and turn into
        # #VALUE! — see git history) stays safe here too.
        actual_count = f'((YEAR({kactual})-YEAR({kdate}))*12+(MONTH({kactual})-MONTH({kdate}))+1)'
        actual_n = f'(({kactual}<>"")*{actual_count})'
        if mode == "any":
            bound = f'(({kcount}="")+({months_since}<{kcount}))'
        elif mode == "paid":
            bound = f'({months_since}<{actual_n})'
        else:   # outstanding
            bound = f'(({kcount}="")+({months_since}<{kcount}))*({months_since}>={actual_n})'
        recurring = (f'SUMPRODUCT(({krec}="{REC_YES}")*({ktype}="{type_filter}")*'
                     f'({months_since}>=0)*{bound}*{kcol}{proj_mult}{scope_mult}{cat_mult}{excl_mult})')
        return f'({oneoff})+({recurring})'

    wb = Workbook()
    ws_cc   = wb.active;          ws_cc.title = "1. Κέντρο Ελέγχου"
    ws_kin  = wb.create_sheet("2. Κινήσεις")
    ws_proj = wb.create_sheet("3. Έργα")
    ws_bud  = wb.create_sheet("4. Προϋπολογισμοί")
    ws_an   = wb.create_sheet("5. Ανάλυση")
    ws_piv  = wb.create_sheet("6. Ελεύθερη Ανάλυση")
    ws_con  = wb.create_sheet("7. Επαφές")
    ws_acc  = wb.create_sheet("8. Λογαριασμοί")
    ws_cash = wb.create_sheet("9. Ταμείο")
    ws_vat  = wb.create_sheet("10. ΦΠΑ")
    ws_wh   = wb.create_sheet("11. Παρακράτηση")
    ws_qc   = wb.create_sheet("12. Έλεγχοι Ποιότητας")
    ws_rent = wb.create_sheet("13. Μισθώματα & Αποδόσεις")
    ws_loans = wb.create_sheet("14. Δάνεια")
    ws_scurve = wb.create_sheet("15. Πρόοδος Έργου")
    ws_bankrec = wb.create_sheet("16. Συμφωνία Τραπεζών")
    ws_sum  = wb.create_sheet("17. Σύνοψη")
    ws_wf   = wb.create_sheet("18. Απόδοση Εταίρων")
    # two new sheets ported from Επιχειρησιακό_Αρχείο_107.xlsx's own
    # Καθημερινά/Μηνιάτικα tabs — numbered like every other primary sheet
    # (Ρυθμίσεις/Οδηγίες are the only unnumbered tabs, both reference/meta
    # content; these two carry real monthly rollups, same category as
    # 9. Ταμείο or 17. Σύνοψη, so they take the next free numbers) rather
    # than a second manually-entered ledger — both are live rollups over
    # the existing Table_Kin, matching the single-ledger design.
    ws_daily = wb.create_sheet("19. Καθημερινά")
    ws_monthly = wb.create_sheet("20. Μηνιάτικα")
    # consolidates the two already-tracked monthly deadlines (ΦΠΑ,
    # Παρακράτηση) with the periodic/annual admin obligations that today
    # live nowhere in the workbook (ΕΝΦΙΑ, ΕΦΚΑ, ΓΕΜΗ, insurance/license
    # renewals) — takes the next free number, same reasoning as 19/20 above.
    ws_taxcal = wb.create_sheet("21. Φορολογικό Ημερολόγιο")
    # a short-range, WEEKLY companion to 9. Ταμείο's 66-MONTH forecast — the
    # monthly view can smooth over a specific week running dangerously low
    # even in a month that nets positive overall. Next free number, same
    # reasoning as 19/20/21 above.
    ws_liquidity = wb.create_sheet("22. Ρευστότητα 13 Εβδομάδων")
    # occupancy/ADR/RevPAR for the two "Ξενοδοχείο / Μίσθωση" projects
    # (Q003, Q004) — the one new sheet in this batch that starts a manual
    # data-entry habit that didn't exist before (nobody's nightly
    # rooms-sold/room-revenue figures live in the workbook today).
    ws_occ = wb.create_sheet("23. Απόδοση Ξενοδοχείου")

    # ══════════════════════════════════════════════════════════════════════════
    # TAB: ΕΛΕΓΧΟΣ ΝΕΟΥ ΕΡΓΟΥ  —  a plain reference checklist (no live
    # formulas — nothing here depends on any other sheet, so it's built with
    # _info_tab right here rather than filled in later) walking through what
    # ACTUALLY happens when a 7th+ project is typed into 3. Έργα: what's
    # already automatic across the 12-slot design, what needs a one-time
    # manual figure, and what genuinely needs a brand-new hardcoded block
    # (the deal-specific investment sheets — 13/14/15/18/23 — are only
    # relevant to SOME projects and can't be made 12-slot-generic without
    # losing the deal-specific analysis they exist for). ──
    # ══════════════════════════════════════════════════════════════════════════
    _checklist_sections = [
        (t("ΑΥΤΟΜΑΤΑ — ΚΑΜΙΑ ΕΝΕΡΓΕΙΑ", "AUTOMATIC — NO ACTION NEEDED"), "FF0B6640", [
            ("b", t("Το όνομα εμφανίζεται αμέσως στο dropdown επιλογής έργου στις Κινήσεις, στη μηνιαία ανάλυση του Προϋπολογισμοί, στο ΑΝΑ ΕΡΓΟ της Ανάλυσης και στο ΑΝΑ ΕΡΓΟ της Σύνοψης — και τα 12 σημεία διαβάζουν ζωντανά την ίδια λίστα Έργα!A3:A14.",
                    "The name shows up immediately in the project dropdown on Κινήσεις, in Προϋπολογισμοί's monthly breakdown, in Ανάλυση's ΑΝΑ ΕΡΓΟ, and in Σύνοψη's ΑΝΑ ΕΡΓΟ — all 12 read live off the same Έργα!A3:A14 list."), ""),
            ("b", t("Στο Προϋπολογισμοί, η αντίστοιχη στήλη-κεφαλίδα (12 θέσεις διαθέσιμες) εμφανίζεται μόνη της με το όνομα του νέου έργου, έτοιμη για αριθμούς.",
                    "In Προϋπολογισμοί, the matching column header (12 slots available) appears on its own with the new project's name, ready for numbers."), ""),
            ("b", t("Έλεγχοι Ποιότητας, ΦΠΑ, Παρακράτηση, Φορολογικό Ημερολόγιο και Ρευστότητα 13 Εβδομάδων είναι όλα εταιρικού επιπέδου — καμία αλλαγή ανά έργο.",
                    "Έλεγχοι Ποιότητας, ΦΠΑ, Παρακράτηση, Φορολογικό Ημερολόγιο and Ρευστότητα 13 Εβδομάδων are all company-level — nothing changes per project."), ""),
        ]),
        (t("ΧΡΕΙΑΖΕΤΑΙ INPUT ΜΙΑ ΦΟΡΑ — ΚΑΜΙΑ ΑΛΛΑΓΗ ΚΩΔΙΚΑ", "NEEDS ONE-TIME INPUT — NO CODE CHANGE"), "FF965800", [
            ("s", t("1.  Γράψτε το όνομα του έργου στην πρώτη κενή γραμμή της «3. Έργα» (12 θέσεις συνολικά).",
                    "1.  Type the project's name into the first empty row of «3. Έργα» (12 slots total)."), ""),
            ("s", t("2.  Στο «4. Προϋπολογισμοί», συμπληρώστε τα κίτρινα κελιά της νέας στήλης — Μοντέλο, Προϋπολογισμός, Χρονοδιάγραμμα, Μίσθωμα, ό,τι ισχύει.",
                    "2.  In «4. Προϋπολογισμοί», fill in the new column's yellow cells — Model, Budget, Timeline, Lease, whichever apply."), ""),
            ("s", t("3.  Αν έχει αντισυμβαλλόμενους (προμηθευτές, πελάτη, ενοικιαστή), προσθέστε τους στην «7. Επαφές» αν δεν υπάρχουν ήδη.",
                    "3.  If it has counterparties (suppliers, a client, a tenant), add them to «7. Επαφές» if not already there."), ""),
            ("s", t("4.  Καταχωρίστε τις πρώτες του κινήσεις στις «2. Κινήσεις», επιλέγοντας το νέο όνομα στη στήλη Έργο.",
                    "4.  Enter its first transactions on «2. Κινήσεις», picking the new name in the Project column."), ""),
        ]),
        (t("ΧΡΕΙΑΖΕΤΑΙ ΝΕΟ BLOCK — ΜΟΝΟ ΑΝ ΙΣΧΥΕΙ", "NEEDS A NEW BLOCK — ONLY IF IT APPLIES"), "FF991B1B", [
            ("h", t("Ελέγξτε ποια από τα παρακάτω αφορούν το νέο έργο:", "Check which of these apply to the new project:"), ""),
            ("s", t("Είναι επένδυση με μίσθωση/ξενοδοχείο, όχι έργο περιθωρίου;  →  νέο block στο «13. Μισθώματα & Αποδόσεις» (IRR/NPV) και στο «23. Απόδοση Ξενοδοχείου» (πληρότητα/ADR/RevPAR).",
                    "Is it a lease/hotel investment, not a margin project?  →  a new block on «13. Μισθώματα & Αποδόσεις» (IRR/NPV) and «23. Απόδοση Ξενοδοχείου» (occupancy/ADR/RevPAR)."), ""),
            ("s", t("Έχει τραπεζικό δάνειο;  →  νέο block στο «14. Δάνεια» (χρεολύσιο/DSCR).",
                    "Does it have a bank loan?  →  a new block on «14. Δάνεια» (amortization/DSCR)."), ""),
            ("s", t("Είναι υπό κατασκευή με δικό του χρονοδιάγραμμα;  →  νέο block στο «15. Πρόοδος Έργου» (cost-to-complete/S-curve).",
                    "Is it under construction on its own timeline?  →  a new block on «15. Πρόοδος Έργου» (cost-to-complete/S-curve)."), ""),
            ("s", t("Έχει εξωτερικούς εταίρους/επενδυτές με δικό τους waterfall διανομών;  →  νέο block στο «18. Απόδοση Εταίρων».",
                    "Does it have outside partners/investors with their own distribution waterfall?  →  a new block on «18. Απόδοση Εταίρων»."), ""),
            ("tip", t("Αυτά τα 4 φύλλα είναι σκόπιμα φτιαγμένα στα μέτρα κάθε έργου — IRR, δάνεια και waterfalls διαφέρουν πολύ μεταξύ συμφωνιών, οπότε δεν έγιναν 12-θέσιων γενικά όπως τα υπόλοιπα. Αν κάτι από τα παραπάνω ισχύει για το νέο έργο, αυτό είναι το σημείο να ζητηθεί η αντίστοιχη προσθήκη.",
                       "These 4 sheets are deliberately built to each deal's own shape — IRR, loans and waterfalls vary too much between deals to be made generically 12-slot like the rest. If any of the above applies to the new project, this is the point to ask for that addition."), ""),
        ]),
    ]
    ws_checklist = _info_tab(wb, t("ΕΛΕΓΧΟΣ ΝΕΟΥ ΕΡΓΟΥ", "NEW PROJECT CHECKLIST"),
                              "24. Έλεγχος Νέου Έργου", _checklist_sections)
    # multi-year trend on top of 17. Σύνοψη's existing (trailing-12-month
    # only) P&L — same definitions (Πληρωμένο, Επιχειρηματικό, εκτός
    # Δανείου), just broken out by CALENDAR YEAR so the company's trajectory
    # shows instead of only the latest 12 months.
    ws_scorecard = wb.create_sheet("25. Πολυετές KPI Scorecard")
    ws_setup = wb.create_sheet("0. Setup")
    ws_set  = wb.create_sheet("Ρυθμίσεις")
    # helper/ranking math that isn't a real, explainable business figure
    # (e.g. the Έργα sort key below) lives here instead of leaking onto a
    # visible sheet. veryHidden (not just hidden) means it can't be
    # un-hidden from Excel's normal Right-click > Unhide UI at all.
    ws_calc = wb.create_sheet("_calc")
    ws_calc.sheet_state = "veryHidden"

    # ══════════════════════════════════════════════════════════════════════════
    # TAB: CONTROL CENTER  —  4 numbered sections (Ρευστότητα / Υποχρεώσεις &
    # ΦΠΑ / Έργα / Ειδοποιήσεις) laid out as two side-by-side KPI cards
    # (A-D and E-H) so the whole top-line fits one screen at 100% zoom,
    # instead of the previous 9-section, single-column, ~90-row stack.
    # Every figure that used to repeat 2-3 times (Total Confirmed Funds,
    # ΦΠΑ Εξόδων, Έξοδα Επόμενων 30 Ημερών) now appears exactly once.
    # ══════════════════════════════════════════════════════════════════════════
    ws = ws_cc
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 3
    ws.column_dimensions["B"].width = 26
    ws.column_dimensions["C"].width = 31
    ws.column_dimensions["D"].width = 26
    ws.column_dimensions["E"].width = 3
    ws.column_dimensions["F"].width = 26
    ws.column_dimensions["G"].width = 31
    ws.column_dimensions["H"].width = 26

    ws.row_dimensions[1].height = 36
    ws.merge_cells("A1:E1")
    c = ws.cell(row=1, column=1,
                value="  " + t("ΠΡΟΫΠΟΛΟΓΙΣΜΟΣ LA  —  ΚΕΝΤΡΟ ΕΛΕΓΧΟΥ",
                          "LA BUDGETING  —  CONTROL CENTER"))
    c.fill = F(DARK_BLUE); c.font = Fnt(size=15, bold=True, color=WHITE)
    c.alignment = Aln(h="left", v="center")

    # ── Προβολή toggle — Εταιρικά / Προσωπικά / Όλα — top-right of the
    # dashboard, driving every funds figure below. This used to live only
    # on Ρυθμίσεις, invisible unless you went looking for it, which is how
    # the dashboard ended up showing several different "cash" numbers with
    # no way to tell which pot each one meant. ──
    ws.merge_cells("F1:G1")
    vmlbl = ws.cell(row=1, column=6, value="  " + t("ΠΡΟΒΟΛΗ", "VIEW"))
    vmlbl.fill = F(DARK_BLUE); vmlbl.font = Fnt(size=11, bold=True, color=WHITE)
    vmlbl.alignment = Aln(h="right", v="center")
    vmc = ws.cell(row=1, column=8, value=VIEW_CORP)
    vmc.fill = F(YELLOW); vmc.font = Fnt(size=11, bold=True, color=DARK_BLUE)
    vmc.alignment = Aln(h="center", v="center")
    dv_view = DataValidation(type="list", formula1=f'"{VIEW_CORP},{VIEW_PERS},{VIEW_ALL}"',
                             allow_blank=False, showDropDown=False)
    ws.add_data_validation(dv_view); dv_view.sqref = "H1"
    wb.defined_names["ViewMode"] = DefinedName(
        "ViewMode", attr_text="\'1. Κέντρο Ελέγχου\'!$H$1")

    # shared building blocks used by both this banner and the sections below
    KIN_PAID_F = 'SUMIFS(Table_Kin[Πληρωμένο Μέχρι Σήμερα],Table_Kin[Τύπος],"Έξοδο")'
    KIN_UPCOMING_F = 'SUMIFS(Table_Kin[Υπόλοιπο Δέσμευσης],Table_Kin[Τύπος],"Έξοδο")'
    KIN_OVERDUE_F = 'SUMIFS(Table_Kin[Ληξιπρόθεσμο Ποσό],Table_Kin[Τύπος],"Έξοδο")'
    KIN_OVERDUE_N_F = 'SUMIFS(Table_Kin[Ληξιπρόθεσμες Δόσεις],Table_Kin[Τύπος],"Έξοδο")'
    # ViewMode (now a visible dropdown at H1 above) picks which funds figure
    # drives the dashboard: CompanyFunds, PersonalFunds, or AllFunds — see
    # the three defined names built alongside Λογαριασμοί's account table.
    FUNDS_F = f'IF(ViewMode="{VIEW_CORP}",CompanyFunds,IF(ViewMode="{VIEW_PERS}",PersonalFunds,AllFunds))'
    FREE_CASH_F = f"({FUNDS_F})-({KIN_UPCOMING_F})"
    # owner-scoped, TYPE-scoped pooled sum so Section 1's Μετρητά/Τράπεζες
    # rows move in lockstep with ViewMode AND actually include Extra
    # Accounts — each `pools` entry is a (current-balance, owner, type)
    # column-range triple for one physical accounts table on Λογαριασμοί;
    # they don't need to be contiguous, so the main account table and Extra
    # Accounts (a separate range further down the same sheet) sum together
    # as one logical pool instead of the old fixed D5:D9/D10:D10 slices
    # that silently stopped at the edge of the main table.
    def _pool_sum(pools, type_val=None):
        owner_f = f'IF(ViewMode="{VIEW_CORP}","{OWNER_CORP}","{OWNER_PERS}")'
        parts = []
        for d_range, e_range, g_range in pools:
            type_crit = f',{g_range},"{type_val}"' if type_val else ''
            scoped = f'SUMIFS({d_range},{e_range},{owner_f}{type_crit})'
            allmode = f'SUMIFS({d_range},{g_range},"{type_val}")' if type_val else f'SUM({d_range})'
            parts.append(f'IF(ViewMode="{VIEW_ALL}",{allmode},{scoped})')
        return "+".join(parts)
    LOG = "'8. Λογαριασμοί'"
    ACC_POOL = (f'{LOG}!D{ACC_FIRST}:D{ACC_LAST}', f'{LOG}!E{ACC_FIRST}:E{ACC_LAST}', f'{LOG}!G{ACC_FIRST}:G{ACC_LAST}')
    # column H (current balance, post-Κινήσεις) — not B (opening balance) —
    # matches the fix on Λογαριασμοί itself: an Extra Account tagged as a
    # real Πηγή in Κινήσεις now actually moves the numbers shown here too.
    EXTRA_ACC_POOL = (f'{LOG}!H{EXTRA_ACC_FIRST}:H{EXTRA_ACC_LAST}', f'{LOG}!E{EXTRA_ACC_FIRST}:E{EXTRA_ACC_LAST}',
                       f'{LOG}!F{EXTRA_ACC_FIRST}:F{EXTRA_ACC_LAST}')
    VAT_INC_F = f'SUMIFS(Table_Kin[ΦΠΑ],Table_Kin[Τύπος],"Έσοδο",Table_Kin[{H_SCOPE}],"{SCOPE_BIZ}")'
    VAT_EXP_F = f'SUMIFS(Table_Kin[ΦΠΑ],Table_Kin[Τύπος],"Έξοδο",Table_Kin[{H_SCOPE}],"{SCOPE_BIZ}")'

    # ── STATUS BANNER — actionable: names the real trigger (N overdue
    # installments · €X, or a negative free-cash figure) and is itself a
    # clickable HYPERLINK() straight to Κινήσεις, instead of a static
    # "ACTION REQUIRED" label that doesn't say what the action is. ──
    ws.row_dimensions[2].height = 24
    ws.merge_cells("A2:H2")
    ST_OK = t("✓ ΛΕΙΤΟΥΡΓΙΚΟ — καμία εκκρεμότητα", "✓ OPERATIONAL — nothing pending")
    _overdue_label = t("ληξιπρόθεσμη(ες) δόση(εις) · ", "overdue installment(s) · ")
    _click_label = t("πατήστε για τις Κινήσεις", "click for Κινήσεις")
    _neg_cash_label = t("Αρνητικό ελεύθερο μετρητό: ", "Negative free cash: ")
    banner_formula = (
        f'=IF({KIN_OVERDUE_F}>0,'
        f'HYPERLINK("#\'2. Κινήσεις\'!A13",TEXT({KIN_OVERDUE_N_F},"0")&" {_overdue_label}"'
        f'&TEXT({KIN_OVERDUE_F},"€#.##0")&" — {_click_label}"),'
        f'IF({FREE_CASH_F}<0,'
        f'HYPERLINK("#\'8. Λογαριασμοί\'!A1","{_neg_cash_label}"'
        f'&TEXT({FREE_CASH_F},"€#.##0")),'
        f'"{ST_OK}"))'
    )
    banner_cell = ws.cell(row=2, column=1, value=banner_formula)
    banner_cell.font = Fnt(size=11, bold=True, color="FF059669")
    banner_cell.alignment = Aln(h="left", v="center")
    banner_cell.fill = F("FFF0FAF8")

    # ── NARRATIVE SUMMARY — one plain sentence with the numbers a business
    # owner asks first: how much cash is there, does the 60-month forecast
    # ever dip below the safety buffer, and the burn-rate-in-words runway.
    # Built entirely from figures already computed elsewhere (Λογαριασμοί,
    # Ταμείο, and this sheet's own Section 4 runway KPI cells C30/C31/C32
    # below) — no new calculation logic, just a sentence instead of tiles. ──
    ws.row_dimensions[3].height = 58
    ws.merge_cells("A3:H3")
    AVG_BURN = 'AVERAGE(\'9. Ταμείο\'!$D$4:$D$9)'
    # the ACTUAL minimum over the whole 66-month window — C31/C32 (Section
    # 4 below) find the FIRST month that dips under MinCashBuffer, which
    # is a different, legitimate "early warning" metric but is NOT the
    # same thing as the worst point in the forecast (that first breach can
    # be far shallower than a later, deeper dip the same forecast still
    # makes). Labeling C32's value "lowest point" here understated a real
    # -€1.16M trough by roughly 10x versus this true MIN().
    _MIN_BAL = "MIN('9. Ταμείο'!$F$4:$F$69)"
    _MIN_MONTH = f"INDEX('9. Ταμείο'!$A$4:$A$69,MATCH({_MIN_BAL},'9. Ταμείο'!$F$4:$F$69,0))"
    if LANG == "en":
        _summary_burn = (f'IF({AVG_BURN}<0," At current rates, cash on hand covers roughly "&'
                          f'TEXT(({FUNDS_F})/(-{AVG_BURN}),"#.##0")&" months."," Cash is growing at current rates.")')
        _summary_low = f'" Lowest point in the forecast: €"&TEXT({_MIN_BAL},"#.##0")&" in "&{_MIN_MONTH}&"."'
        _summary_safe = '" 66-month forecast: safe, never dips below the safety buffer."'
        _summary_net = (f'IF(({FREE_CASH_F})-TotalLiabilities<0,'
                         f'"  Net position is negative ("&TEXT(({FREE_CASH_F})-TotalLiabilities,"€#.##0")&") until the Antonis debt is settled.",'
                         f'"  Net position is positive after all liabilities.")')
        _summary_funding = '"  Expected incoming funding: €"&TEXT(TotalIncoming,"#.##0")&"."'
        _summary_lead = f'="Cash on hand ("&ViewMode&"): €"&TEXT({FUNDS_F},"#.##0")&"."&'
    else:
        _summary_burn = (f'IF({AVG_BURN}<0," Στους σημερινούς ρυθμούς, το ταμείο επαρκεί για περίπου "&'
                          f'TEXT(({FUNDS_F})/(-{AVG_BURN}),"#.##0")&" μήνες."," Το ταμείο αυξάνεται στους σημερινούς ρυθμούς.")')
        _summary_low = f'" Χαμηλότερο σημείο πρόβλεψης: "&TEXT({_MIN_BAL},"#.##0")&" € τον "&{_MIN_MONTH}&"."'
        _summary_safe = '" Πρόβλεψη 66 μηνών: ασφαλής, δεν πέφτει κάτω από το όριο ασφαλείας."'
        _summary_net = (f'IF(({FREE_CASH_F})-TotalLiabilities<0,'
                         f'"  Η καθαρή θέση είναι αρνητική ("&TEXT(({FREE_CASH_F})-TotalLiabilities,"€#.##0")&") μέχρι να τακτοποιηθεί το χρέος προς Αντώνη.",'
                         f'"  Η καθαρή θέση είναι θετική μετά από όλες τις υποχρεώσεις.")')
        _summary_funding = '"  Αναμενόμενη χρηματοδότηση: "&TEXT(TotalIncoming,"#.##0")&" €."'
        _summary_lead = f'="Ταμείο ("&ViewMode&"): "&TEXT({FUNDS_F},"#.##0")&" €."&'
    summary_cell = ws.cell(row=3, column=1,
        value=(f'{_summary_lead}{_summary_burn}&'
               f'IF(ISNUMBER(C30),{_summary_low},{_summary_safe})&'
               f'{_summary_net}&'
               f'IF(TotalIncoming>0,{_summary_funding},"")'))
    summary_cell.font = Fnt(size=12, color="FF1F2937")
    summary_cell.alignment = Aln(h="left", v="center", wrap=True)
    summary_cell.fill = F(WHITE)

    # ══════════════════════════════ SECTION 1 ══════════════════════════════
    sec_hdr(ws, 5, t("ΡΕΥΣΤΟΤΗΤΑ", "LIQUIDITY"), number="1", end_col="H")
    spacer(ws, 6, 5, LIGHT_GREY)
    # rows 7-9 are scoped by the same ViewMode toggle as everything else on
    # this dashboard, so they always sum exactly to row 10 — no more "three
    # different cash numbers" that don't reconcile with each other.
    mrow(ws, 7, t('="Μετρητά στο χέρι — "&ViewMode', '="Cash in hand — "&ViewMode'),
         f"={_pool_sum([ACC_POOL, EXTRA_ACC_POOL], type_val=ACC_TYPE_CASH)}",
         t("Διαθέσιμα μετρητά, στην τρέχουσα προβολή — Λογαριασμοί + Έξτρα Λογαριασμοί", "Physical cash available, in the current view — Λογαριασμοί + Extra Accounts"),
         value_fmt=EUR0, value_size=12, value_color=MED_BLUE, col0=1)
    mrow(ws, 8, t('="Τράπεζες — "&ViewMode', '="Banks — "&ViewMode'),
         f"={_pool_sum([ACC_POOL, EXTRA_ACC_POOL], type_val=ACC_TYPE_BANK)}",
         t("Υπόλοιπα τραπεζικών λογαριασμών, στην τρέχουσα προβολή — Λογαριασμοί + Έξτρα Λογαριασμοί", "Bank account balances, in the current view — Λογαριασμοί + Extra Accounts"),
         value_fmt=EUR0, value_size=12, value_color=MED_BLUE, col0=1)
    # deliberately NOT styled/labelled as liquidity like the two rows above,
    # and NOT part of row 10's sum — gold/crypto live in Λογαριασμοί's own
    # separate ΑΠΟΘΕΜΑΤΑ table now, excluded from ΣΥΝΟΛΟ ΣΗΜΕΡΑ/CompanyFunds/
    # PersonalFunds/AllFunds (and therefore Ταμείο's Opening Balance) by
    # construction, not just by this label.
    RESERVES_F = f'IF(ViewMode="{VIEW_CORP}",ReserveFundsCorp,IF(ViewMode="{VIEW_PERS}",ReserveFundsPers,ReserveFunds))'
    mrow(ws, 9, t('="Αποθέματα (Χρυσός+Κρυπτό) — "&ViewMode&" — ΕΚΤΟΣ ρευστότητας, ΕΚΤΟΣ του συνόλου κάτω"', '="Reserves (Gold+Crypto) — "&ViewMode&" — EXCLUDED from liquidity and from the total below"'),
         f"={RESERVES_F}",
         t("Μεταβλητής αξίας, όχι άμεσα ρευστό — δεν μετράει σαν διαθέσιμο μετρητό ούτε στο ΣΥΝΟΛΟ ΔΙΑΘΕΣΙΜΩΝ", "Variable value, not instant cash — doesn't count as available cash or in TOTAL CONFIRMED FUNDS"),
         value_fmt=EUR0, value_size=11, value_color="FF6B7280", col0=1)
    mrow(ws, 10, t('="ΣΥΝΟΛΟ ΔΙΑΘΕΣΙΜΩΝ ΚΕΦΑΛΑΙΩΝ — "&ViewMode', '="TOTAL CONFIRMED FUNDS — "&ViewMode'), f'={FUNDS_F}',
         t("Άθροισμα Μετρητά+Τράπεζες (πάνω), στην ίδια προβολή — ΔΕΝ περιλαμβάνει Αποθέματα — βλ. Λογαριασμοί για πλήρη ανάλυση ανά Owner",
           "Sum of Cash+Banks above, in the same view — does NOT include Reserves — see Λογαριασμοί for the full per-Owner breakdown"),
         value_fmt=EUR0, value_bold=True, value_size=14, value_color=DARK_BLUE,
         label_bg=LIGHT_BLUE, value_bg=LIGHT_BLUE, note_bg=LIGHT_BLUE, label_bold=True, height=30, col0=1)

    # ── two of the four dashboard "hero" tiles (the other two are the
    # runway KPIs in Section 4 below) — roughly double the font size of an
    # ordinary KPI row so the numbers a business owner asks first stand
    # out from the ~40 supporting figures around them. ──
    mrow(ws, 7, t('="ΕΛΕΥΘΕΡΟ ΜΕΤΡΗΤΟ — "&ViewMode', '="FREE CASH — "&ViewMode'), f"={FREE_CASH_F}",
         t("Διαθέσιμα μετά από όλες τις υποχρεώσεις Κινήσεων, στην τρέχουσα προβολή", "Available after all Κινήσεις commitments, in the current view"),
         value_fmt=EUR0, value_bold=True, value_size=26, value_color=GREEN_FG,
         label_bg=GREEN_BG, value_bg=GREEN_BG, note_bg=GREEN_BG, label_bold=True, height=36, col0=5)
    mrow(ws, 8, t('="ΚΑΘΑΡΗ ΘΕΣΗ ΜΕΤΑ ΟΦΕΙΛΩΝ — "&ViewMode', '="NET POSITION AFTER LIABILITIES — "&ViewMode'),
         f"={FREE_CASH_F}-TotalLiabilities",
         t("Ελεύθερο μετρητό ΜΕΙΟΝ το Σύνολο Οφειλών (βλ. παρακάτω) — αυτό αγνοούσε παλιότερα το χρέος προς Αντώνη",
           "Free cash MINUS Total Liabilities (see below) — this used to ignore the Antonis debt entirely"),
         value_fmt=EUR0_NEG, value_bold=True, value_size=22, value_color="FF965800",
         label_bg="FFFEF0D8", value_bg="FFFEF0D8", note_bg="FFFEF0D8", label_bold=True, height=32, col0=5)
    mrow(ws, 9, t("Σύνολο Οφειλών", "Total Liabilities"), "=TotalLiabilities",
         t("Κυρίως το χρέος προς Αντώνη — πλήρη στοιχεία στο Λογαριασμοί", "Mainly the Antonis debt — full detail on Λογαριασμοί"),
         value_fmt=EUR0, value_color=RED_FG, col0=5)
    mrow(ws, 10, t("Αναμενόμενα Εισερχόμενα", "Expected Incoming"), "=ExpectedFromAntonis+ExpectedFromAlbert",
         '="' + t("Αντώνη: ", "Antonis: ") + '"&TEXT(ExpectedFromAntonis,"€#.##0")&"  ·  ' +
         t("Άλμπερτ: ", "Albert: ") + '"&TEXT(ExpectedFromAlbert,"€#.##0")',
         value_fmt=EUR0, value_color="FF965800", col0=5)

    spacer(ws, 11, 6)

    # ══════════════════════════════ SECTION 2 ══════════════════════════════
    sec_hdr(ws, 12, t("ΥΠΟΧΡΕΩΣΕΙΣ & ΦΠΑ", "OBLIGATIONS & VAT"), number="2", end_col="H")
    spacer(ws, 13, 5, LIGHT_GREY)
    mrow(ws, 14, t("Σύνολο Υποχρεώσεων", "Total Committed"), f"=({KIN_UPCOMING_F})",
         t("Εκκρεμή όλων των έργων", "Upcoming across all projects"),
         value_fmt=EUR0, value_color="FF7A3800", col0=1)
    # was pure SUMIFS on Ημ/νία Λήξης — a column that's blank on almost
    # every row, so this read as €0 even with real installments due within
    # 30 days. Now two parts that don't need a due date at all: the
    # recurring side reads Ποσό Επόμ. 30 Ημ. (already date-driven off each
    # plan's own schedule), and the non-recurring side just counts every
    # pending expense invoice, since due dates aren't reliably entered.
    NEXT30_F = (f'SUMIFS(Table_Kin[{H_NEXT30}],Table_Kin[{H_REC}],"{REC_YES}")'
                f'+SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_TYPE}],"{TYPE_EXP}",'
                f'Table_Kin[{H_STATUS}],"{S_UPCOM}",Table_Kin[{H_REC}],"<>{REC_YES}")')
    mrow(ws, 15, t("Έξοδα Επόμενων 30 Ημερών + Εκκρεμή Τιμολόγια", "Expenses Due Next 30 Days + Pending Invoices"),
         f"=({NEXT30_F})",
         t("Επαναλαμβανόμενα: βάσει προγράμματος δόσεων. Μη επαναλαμβανόμενα: κάθε εκκρεμές τιμολόγιο (η Ημ/νία Λήξης είναι σπάνια συμπληρωμένη)",
           "Recurring: based on each plan's own schedule. Non-recurring: every pending invoice (Due Date is rarely filled in)"),
         value_fmt=EUR0, value_bold=True, value_color=RED_FG,
         label_bg=RED_BG, value_bg=RED_BG, note_bg=RED_BG, col0=1)
    mrow(ws, 16, t("Ληξιπρόθεσμες Δόσεις (Ποσό)", "Overdue Installments (Amount)"), f"=({KIN_OVERDUE_F})",
         t("Δόσεις που πέρασε η ημερομηνία τους χωρίς να καταχωρηθούν πληρωμένες — βλ. Ειδοποιήσεις",
           "Installments past due, not yet marked paid — see Alerts"),
         value_fmt=EUR0, value_color=RED_FG, col0=1)

    mrow(ws, 14, "ΦΠΑ Εσόδων", f'={VAT_INC_F}',
         t("Σύνολο ΦΠΑ επιχειρηματικών εσόδων", "Total VAT on business income"),
         value_fmt=EUR0, col0=5)
    mrow(ws, 15, "ΦΠΑ Εξόδων", f'={VAT_EXP_F}',
         t("Σύνολο ΦΠΑ επιχειρηματικών εξόδων", "Total VAT on business expenses"),
         value_fmt=EUR0, col0=5)
    mrow(ws, 16, t("ΚΑΘΑΡΗ ΘΕΣΗ ΦΠΑ", "NET VAT POSITION"),
         f'=ROUND({VAT_INC_F}-{VAT_EXP_F},2)',
         t("Θετικό = οφειλή προς Εφορία. Αρνητικό = πιστωτικό. Μόνο επιχειρηματικές κινήσεις.",
           "Positive = owed to tax office. Negative = credit. Business transactions only."),
         value_fmt=EUR0_NEG, value_bold=True, value_color="FF965800",
         label_bg="FFFEF0D8", value_bg="FFFEF0D8", note_bg="FFFEF0D8", col0=5)

    spacer(ws, 17, 6)

    # ══════════════════════════════ SECTION 3 ══════════════════════════════
    # projects ranked DESCENDING by total value via LARGE()/MATCH() (no
    # dynamic-array SORT() dependency — works in any modern Excel), split
    # across the two cards (top 6 left, next 6 right) so live projects
    # surface at a glance instead of being buried among empty €0 slots.
    sec_hdr(ws, 18, t("ΕΡΓΑ", "PROJECTS"), number="3", end_col="H")
    spacer(ws, 19, 5, LIGHT_GREY)

    _white_fill_cc = PatternFill(start_color=WHITE, end_color=WHITE, fill_type="solid")
    _white_font_cc = Font(name="Calibri", color="FFFFFFFF")
    _L_PAID90 = t("Πληρ.", "Paid")
    _L_DUE90 = t("Εκκρ.", "Due")
    # $L (friendly display name), not $A (raw code) — project codes like
    # Q004_AGIOU_KWNSTANTINOU20_GLYFADA aren't meant for a dashboard reader.
    PROJ_RANGE_A, PROJ_RANGE_F = "\'3. Έργα\'!$L$3:$L$14", "\'3. Έργα\'!$F$3:$F$14"
    PROJ_RANGE_B, PROJ_RANGE_C = "\'3. Έργα\'!$B$3:$B$14", "\'3. Έργα\'!$C$3:$C$14"
    # LARGE()+MATCH() alone breaks on ties (two projects with the same
    # total, or several genuinely-zero ones) — MATCH always returns the
    # FIRST row with that value, so every tied rank would show the same
    # project name. _calc!$A$3:$A$14 (veryHidden sheet, built alongside the
    # Έργα project loop) is a ranking key with a per-row IF() breaking ties
    # by ROW() and sending blank slots to the bottom — a genuine RANGE
    # reference here, not an
    # array formula, because an array-context IF() over a whole range was
    # proven NOT to implicitly evaluate without Ctrl+Shift+Enter in this
    # Excel, even wrapped in the INDEX(...,0) trick that works for bare
    # comparison operators (like the cash-runway MATCH above).
    PROJ_KEY = "_calc!$A$3:$A$14"

    for _i in range(12):
        _rank = _i + 1
        _row = 20 + (_i if _i < 6 else _i - 6)
        _col0 = 1 if _i < 6 else 5
        _match_f = f'MATCH(LARGE({PROJ_KEY},{_rank}),{PROJ_KEY},0)'
        _val_f = f'IFERROR(INDEX({PROJ_RANGE_F},{_match_f}),"")'
        _name_f = f'IFERROR(INDEX({PROJ_RANGE_A},{_match_f}),"")'
        _paid_f = f'IFERROR(INDEX({PROJ_RANGE_B},{_match_f}),0)'
        _due_f = f'IFERROR(INDEX({PROJ_RANGE_C},{_match_f}),0)'

        ws.row_dimensions[_row].height = 22
        _bc = ws.cell(row=_row, column=_col0 + 1, value=f'={_name_f}')
        _bc.fill = F(WHITE); _bc.font = Fnt(size=11, bold=True, color=DARK_BLUE)
        _bc.alignment = Aln(h="left", v="center"); _bc.border = Brd()
        _vc = ws.cell(row=_row, column=_col0 + 2, value=f'={_val_f}')
        _vc.fill = F(WHITE); _vc.font = Fnt(size=12, bold=True, color=DARK_BLUE)
        _vc.alignment = Aln(h="right", v="center"); _vc.number_format = EUR0; _vc.border = Brd()
        _dc = ws.cell(row=_row, column=_col0 + 3,
                       value=(f'=IF({_name_f}="","","{_L_PAID90}: "&TEXT({_paid_f},"€#.##0")&"  '
                              f'{_L_DUE90}: "&TEXT({_due_f},"€#.##0"))'))
        _dc.fill = F(WHITE); _dc.font = Fnt(size=9, italic=True, color="FF6B7280")
        _dc.alignment = Aln(h="left", v="center"); _dc.border = Brd()

        _col_letter0 = get_column_letter(_col0 + 1)
        _col_letterH = get_column_letter(_col0 + 3)
        # $-anchor the columns: a conditional-formatting formula applied to
        # a multi-cell range is relative to that range's own top-left cell,
        # so an unanchored "B22=..." silently shifts to "C22=...","D22=..."
        # as Excel evaluates it against each subsequent cell in the range —
        # without the $, this rule would only ever fire correctly on the
        # range's first column.
        # INDEX() on a genuinely blank Excel cell (Έργα's "Όνομα Εμφάνισης"
        # for the unused project slots is a true None, not an ="" formula)
        # returns numeric 0, not text "" — so a name-cell check of ="" alone
        # never catches those slots and they render as a bare "0". Checking
        # =0 on the name cell too (harmless for real project names, which
        # are always text and never equal numeric 0) closes that gap.
        #
        # Deliberately NOT also hiding on "value=0": a real, active project
        # can legitimately have a €0 net (income - expense) for this metric
        # — e.g. Ηλιούπολη with real paid/pending amounts still nets to
        # exactly 0 — and hiding the whole row whenever that happens made a
        # real project silently vanish from the dashboard. Only an empty
        # ranking slot (no project name at all) should be hidden.
        ws.conditional_formatting.add(
            f"{_col_letter0}{_row}:{_col_letterH}{_row}",
            FormulaRule(formula=[f'OR(${_col_letter0}{_row}="",${_col_letter0}{_row}=0)'],
                        fill=_white_fill_cc, font=_white_font_cc))

    ws.row_dimensions[26].height = 24
    _tl90 = ws.cell(row=26, column=2, value=t("ΣΥΝΟΛΟ ΟΛΩΝ ΕΡΓΩΝ", "TOTAL ALL PROJECTS"))
    _tl90.fill = F(LIGHT_BLUE); _tl90.font = Fnt(size=11, bold=True, color=DARK_BLUE)
    _tl90.alignment = Aln(h="left", v="center"); _tl90.border = Brd()
    _tv90 = ws.cell(row=26, column=3, value="=SUM(\'3. Έργα\'!F3:F14)")
    _tv90.fill = F(LIGHT_BLUE); _tv90.font = Fnt(size=12, bold=True, color=DARK_BLUE)
    _tv90.alignment = Aln(h="right", v="center"); _tv90.number_format = EUR0; _tv90.border = Brd()
    _td90 = ws.cell(row=26, column=4, value=t("Σύνολο εκκρεμών+πληρωμένων όλων των έργων", "Sum of paid+upcoming across all projects"))
    _td90.fill = F(LIGHT_BLUE); _td90.font = Fnt(size=9, italic=True, color="FF6B7280")
    _td90.alignment = Aln(h="left", v="center"); _td90.border = Brd()
    for _ci in range(5, 9):
        ws.cell(row=26, column=_ci).fill = F(LIGHT_BLUE); ws.cell(row=26, column=_ci).border = Brd()

    spacer(ws, 27, 6)

    # ══════════════════════════════ SECTION 4 ══════════════════════════════
    # CASH RUNWAY — reads Ταμείο's 60-month forecast for the first month
    # Closing Balance drops under Ρυθμίσεις' MinCashBuffer. INDEX(...,0)
    # forces MATCH to evaluate the F4:F63<MinCashBuffer comparison as an
    # array WITHOUT Ctrl+Shift+Enter (a plain array formula saved via
    # openpyxl would silently return a wrong, non-array result in Excel).
    sec_hdr(ws, 28, t("ΕΙΔΟΠΟΙΗΣΕΙΣ", "ALERTS"), number="4", end_col="H")
    spacer(ws, 29, 5, LIGHT_GREY)
    RUNWAY_SAFE = t("Ασφαλές", "Safe")
    MATCH_LOW = 'MATCH(TRUE,INDEX(\'9. Ταμείο\'!$F$4:$F$69<MinCashBuffer,0),0)'
    # the other two hero tiles (see the Section 1 pair above)
    mrow(ws, 30, t("Μήνες Μέχρι το Όριο Ασφαλείας", "Months Until Safety Buffer"),
         f'=IFERROR({MATCH_LOW}-1,"{RUNWAY_SAFE}")',
         t("Πρώτος μήνας που το Υπόλοιπο Λήξης στο Ταμείο πέφτει κάτω από το Ελάχιστο Απόθεμα Ασφαλείας",
           "First month the Ταμείο Closing Balance drops below the Minimum Cash Safety Buffer"),
         value_bold=True, value_size=24, label_bold=True, height=36, col0=1)
    mrow(ws, 31, t("Μήνας Χαμηλού Ταμείου", "Low-Cash Month"),
         f'=IFERROR(INDEX(\'9. Ταμείο\'!$A$4:$A$69,{MATCH_LOW}),"—")',
         t("Μορφή ΕΕΕΕ-ΜΜ — δείτε την ακριβή γραμμή στο Ταμείο", "YYYY-MM format — see the exact row on Ταμείο"),
         value_bold=True, value_color="FF965800",
         label_bg="FFFEF0D8", value_bg="FFFEF0D8", note_bg="FFFEF0D8", col0=1)
    mrow(ws, 32, t("Υπόλοιπο Εκείνον τον Μήνα", "Balance That Month"),
         f'=IFERROR(INDEX(\'9. Ταμείο\'!$F$4:$F$69,{MATCH_LOW}),"—")',
         t("Αρνητικό = πραγματική έλλειψη ρευστού, όχι απλώς κάτω από το απόθεμα ασφαλείας",
           "Negative means an actual cash shortfall, not just below the safety buffer"),
         value_fmt=EUR0, value_bold=True, value_color="FF965800",
         label_bg="FFFEF0D8", value_bg="FFFEF0D8", note_bg="FFFEF0D8", col0=1)
    mrow(ws, 33, t("Ελάχιστο Απόθεμα Ασφαλείας", "Minimum Safety Buffer"), "=MinCashBuffer",
         t("Ρυθμιζόμενο στο Ρυθμίσεις", "Adjustable on Ρυθμίσεις"),
         value_fmt=EUR0, col0=1)
    # every paid row sitting at "Προς καθορισμό" (or blank) Πηγή is a paid
    # transaction no bank account's "Μεταβολή από Κινήσεις" (Λογαριασμοί)
    # will ever see — this is the count of that exact gap, so it's visible
    # here instead of only as a red cell buried in a 1000+ row ledger. A
    # plain number invites "someone will get to it"; a clickable link that
    # jumps straight to the offending column turns it into an actual to-do.
    _unattr_n = (f'COUNTIFS(Table_Kin[{H_STATUS}],"{S_PAID}",Table_Kin[{H_SOURCE}],"{SRC_TBD}")'
                 f'+COUNTIFS(Table_Kin[{H_STATUS}],"{S_PAID}",Table_Kin[{H_SOURCE}],"")')
    mrow(ws, 33, t("Δεν Έχει Αποδοθεί σε Λογαριασμό", "Not Attributed To An Account"),
         f'=IF(({_unattr_n})=0,0,HYPERLINK("#\'2. Κινήσεις\'!J13",{_unattr_n}))',
         t("Πληρωμένες κινήσεις χωρίς πραγματική Πηγή — πατήστε για να τις βρείτε στις Κινήσεις",
           "Paid transactions with no real Source — click to find them on Κινήσεις"),
         value_bold=True, value_color=RED_FG,
         label_bg=RED_BG, value_bg=RED_BG, note_bg=RED_BG, col0=5)

    mrow(ws, 30, t("ΛΗΞΙΠΡΟΘΕΣΜΑ", "OVERDUE"), f"=({KIN_OVERDUE_F})",
         t("Δόσεις που πέρασε η ημερομηνία τους — ενημερώστε «Ημ/νία Τελ. Πληρωμένης Δόσης»",
           "Installments past due — update Date of Last Paid Installment"),
         value_fmt=EUR0, value_bold=True, value_size=24, value_color=RED_FG,
         label_bg=RED_BG, value_bg=RED_BG, note_bg=RED_BG, height=36, col0=5)
    mrow(ws, 31, t("ΕΣΟΔΑ (Εισπραγμένα)", "REVENUE (Received)"),
         '=SUMIFS(Table_Kin[Ποσό],Table_Kin[Τύπος],"Έσοδο",Table_Kin[Κατάσταση],"Πληρωμένο")',
         t("Πραγματικό έσοδο, όχι εκκρεμή δάνεια", "Real revenue, not pending loans"),
         value_fmt=EUR0, value_bold=True, value_color=GREEN_FG,
         label_bg=GREEN_BG, value_bg=GREEN_BG, note_bg=GREEN_BG, col0=5)
    mrow(ws, 32, t("— εκκρεμή (ενδ. δάνεια)", "— pending (may incl. loans)"),
         '=SUMIFS(Table_Kin[Ποσό],Table_Kin[Τύπος],"Έσοδο",Table_Kin[Κατάσταση],"Εκκρεμεί")',
         t("Μην το αναφέρετε ως έσοδα σε τρίτους", "Don't quote this externally as revenue"),
         value_fmt=EUR0, value_color="FF965800", col0=5)

    spacer(ws, 34, 6)

    # ── conditional formatting ──
    red_fill = PatternFill(start_color=RED_BG, end_color=RED_BG, fill_type="solid")
    green_fill = PatternFill(start_color=GREEN_BG, end_color=GREEN_BG, fill_type="solid")
    orng_fill = PatternFill(start_color="FFFEF0D8", end_color="FFFEF0D8", fill_type="solid")
    ws.conditional_formatting.add("G7",
        CellIsRule(operator="greaterThanOrEqual", formula=["0"], fill=green_fill,
                   font=Font(name="Calibri", size=26, bold=True, color="0B6640")))
    ws.conditional_formatting.add("G7",
        CellIsRule(operator="lessThan", formula=["0"], fill=red_fill,
                   font=Font(name="Calibri", size=26, bold=True, color="991B1B")))
    ws.conditional_formatting.add("G8",
        CellIsRule(operator="greaterThanOrEqual", formula=["0"], fill=orng_fill,
                   font=Font(name="Calibri", size=22, bold=True, color="965800")))
    ws.conditional_formatting.add("G8",
        CellIsRule(operator="lessThan", formula=["0"], fill=red_fill,
                   font=Font(name="Calibri", size=22, bold=True, color="991B1B")))
    ws.conditional_formatting.add("C30",
        FormulaRule(formula=['AND(ISNUMBER(C30),C30<=6)'], fill=red_fill,
                    font=Font(name="Calibri", size=24, bold=True, color="991B1B")))
    ws.conditional_formatting.add("C30",
        FormulaRule(formula=['AND(ISNUMBER(C30),C30>6)'], fill=orng_fill,
                    font=Font(name="Calibri", size=24, bold=True, color="965800")))
    ws.conditional_formatting.add("C30",
        FormulaRule(formula=['NOT(ISNUMBER(C30))'], fill=green_fill,
                    font=Font(name="Calibri", size=24, bold=True, color="0B6640")))

    # ── PERSONAL SPENDING — by category, two cards of 5. "This Month" uses
    # _recur_monthly (so a recurring personal expense like rent counts
    # correctly even though its own recorded date is months in the past).
    # Zero-value categories fade to white-on-white instead of cluttering
    # the view with a wall of €0 rows. ──
    sec_hdr(ws, 35, t("ΠΡΟΣΩΠΙΚΑ ΕΞΟΔΑ — ΑΝΑ ΚΑΤΗΓΟΡΙΑ", "PERSONAL SPENDING — BY CATEGORY"), end_col="H")
    spacer(ws, 36, 5, LIGHT_GREY)
    MONTH_NOW = 'YEAR(TODAY())&"-"&TEXT(MONTH(TODAY()),"00")'
    _pers_last12_refs = []
    for i, cat in enumerate(PERSONAL_CATEGORIES):
        row = 37 + (i if i < 5 else i - 5)
        col0 = 1 if i < 5 else 5
        cat_lit = f'"{cat}"'
        last12_formula = (f'SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_TYPE}],"{TYPE_EXP}",'
                           f'Table_Kin[{H_SCOPE}],"{SCOPE_PERS}",Table_Kin[{H_CATEGORY}],{cat_lit},'
                           f'Table_Kin[{H_DATE}],">="&EDATE(TODAY(),-12),Table_Kin[{H_DATE}],"<="&TODAY())')
        note = (t(f'="12μ: "&TEXT({last12_formula},"€#.##0")&"  Μ.Ο.: "&TEXT(({last12_formula})/12,"€#.##0")',
                  f'="12mo: "&TEXT({last12_formula},"€#.##0")&"  Avg: "&TEXT(({last12_formula})/12,"€#.##0")'))
        mrow(ws, row, cat,
             f'={_recur_monthly(H_AMOUNT, TYPE_EXP, MONTH_NOW, scope=SCOPE_PERS, category_ref=cat_lit)}',
             note, value_fmt=EUR0, value_size=10, accent=None, height=18, col0=col0)
        _col_l = get_column_letter(col0 + 1); _col_v = get_column_letter(col0 + 2); _col_n = get_column_letter(col0 + 3)
        # $-anchor the value column — see the Section 3 comment above for
        # why an unanchored reference here silently shifts per cell across
        # the range and only ever fires correctly on the first column.
        ws.conditional_formatting.add(f"{_col_l}{row}:{_col_n}{row}",
            FormulaRule(formula=[f'${_col_v}{row}=0'], fill=_white_fill_cc, font=_white_font_cc))
        _pers_last12_refs.append(last12_formula)

    PERS_TOTAL_ROW = 42
    total_last12 = "+".join(f'({r})' for r in _pers_last12_refs)
    mrow(ws, PERS_TOTAL_ROW, t("ΣΥΝΟΛΟ ΠΡΟΣΩΠΙΚΩΝ (ΜΗΝΑ)", "TOTAL PERSONAL (MONTH)"),
         '=SUM(C37:C41)+SUM(G37:G41)',
         t(f'="Τελευταίοι 12 μήνες: "&TEXT({total_last12},"€#.##0")',
           f'="Last 12 months: "&TEXT({total_last12},"€#.##0")'),
         value_fmt=EUR0, value_bold=True, label_bold=True, value_color=DARK_BLUE,
         label_bg=LIGHT_BLUE, value_bg=LIGHT_BLUE, note_bg=LIGHT_BLUE, accent=None, height=22, col0=1)
    ws.conditional_formatting.add("B42:D42",
        FormulaRule(formula=['$C42=0'], fill=_white_fill_cc, font=_white_font_cc))

    # collapsed by default — ten mostly-€0 tiles ate a third of the
    # dashboard for a company back office where personal spending isn't
    # the point. The section header (35) and the total row (42) stay
    # visible either way; only the category detail (36-41) is grouped.
    for _r in range(36, 42):
        ws.row_dimensions[_r].outline_level = 1
        ws.row_dimensions[_r].hidden = True
    ws.sheet_properties.outlinePr.summaryBelow = True

    spacer(ws, PERS_TOTAL_ROW + 1, 6)

    # ══════════════════════════════ SECTION 5 ══════════════════════════════
    # ΠΟΙΟΤΗΤΑ & ΕΠΕΝΔΥΤΙΚΗ ΕΙΚΟΝΑ — the 6 sheets added this round (Έλεγχοι
    # Ποιότητας, Δάνεια, Μισθώματα & Αποδόσεις, Πρόοδος Έργου, Παρακράτηση,
    # Συμφωνία Τραπεζών) were completely invisible from here; 75 open data-
    # quality issues and a negative-IRR/sub-1.2x-DSCR project sat on other
    # tabs nobody would think to open from the dashboard. Every value here
    # is a defined-name reference into those sheets, resolved by Excel at
    # open time — not duplicated math. ──
    INV_SEC = PERS_TOTAL_ROW + 2
    sec_hdr(ws, INV_SEC, t("ΠΟΙΟΤΗΤΑ & ΕΠΕΝΔΥΤΙΚΗ ΕΙΚΟΝΑ (Q003)", "DATA QUALITY & INVESTMENT SNAPSHOT (Q003)"), number="5", end_col="H")
    spacer(ws, INV_SEC + 1, 5, LIGHT_GREY)
    mrow(ws, INV_SEC + 2, t("Ποιότητα Δεδομένων", "Data Quality"),
         '=HYPERLINK("#\'12. Έλεγχοι Ποιότητας\'!B3",QCIssueCount&" '
         + t("ανοιχτά θέματα", "open issues") + '")',
         t("Πατήστε για να πάτε στο Έλεγχοι Ποιότητας", "Click to jump to Έλεγχοι Ποιότητας"),
         value_bold=True, value_color=RED_FG, label_bg=RED_BG, value_bg=RED_BG, note_bg=RED_BG, col0=1)
    mrow(ws, INV_SEC + 3, t("Χρηματοδοτικό Κενό (όλα τα έργα)", "Financing Gap (all projects)"),
         '=HYPERLINK("#\'4. Προϋπολογισμοί\'!A1",TEXT(TotalFinancingGap,"€#.##0"))',
         t("Απαιτούμενο κεφάλαιο μείον ίδια συμμετοχή και δανειακή χρηματοδότηση — βλ. Προϋπολογισμοί", "Required capital minus own equity and loan financing — see Προϋπολογισμοί"),
         value_bold=True, value_color=RED_FG, col0=1)
    # Both TEXT()'s format-string argument AND plain cell .number_format
    # codes use the SYSTEM LOCALE's own decimal separator, not a literal
    # period — confirmed via COM on this Greek-locale Excel: a PERIOD
    # decimal ("0.0%", "0.00", "0.00\"x\"") silently produces garbled text
    # ("02%", "001", "003x") instead of erroring outright, in BOTH
    # contexts. "0,0%"/"0,00" (comma) is the locale-correct form here,
    # same class of bug as the earlier ΗΗ/ΜΜ/ΕΕΕΕ date-format fix on
    # Σύνοψη — an entire-file audit (not just TEXT() calls) found and
    # fixed 15 more instances of this across Ρυθμίσεις/Προϋπολογισμοί/
    # Μισθώματα/Δάνεια/Απόδοση Εταίρων.
    mrow(ws, INV_SEC + 2, t("Q003 — IRR (unlevered)", "Q003 — IRR (unlevered)"),
         '=HYPERLINK("#\'13. Μισθώματα & Αποδόσεις\'!A1",TEXT(Q003IRR,"0,0%"))',
         t("Χωρίς μόχλευση δανείων — βλ. Μισθώματα & Αποδόσεις", "Unlevered, before loan financing — see Μισθώματα & Αποδόσεις"),
         value_bold=True, value_color="FF965800", label_bg="FFFEF0D8", value_bg="FFFEF0D8", note_bg="FFFEF0D8", col0=5)
    mrow(ws, INV_SEC + 3, t("Q003 — DSCR (Έτος 1)", "Q003 — DSCR (Year 1)"),
         '=HYPERLINK("#\'14. Δάνεια\'!A1",TEXT(Q003DSCRYear1,"0,00"))',
         t("<1,20 = τα ενοίκια δεν καλύπτουν τη δόση — βλ. Δάνεια", "<1.20 = rent doesn't cover the loan payment — see Δάνεια"),
         value_bold=True, value_color="FF965800", label_bg="FFFEF0D8", value_bg="FFFEF0D8", note_bg="FFFEF0D8", col0=5)
    mrow(ws, INV_SEC + 4, t("Λογαριασμός Αποτελεσμάτων (12μηνο)", "Profit & Loss (12mo)"),
         '=HYPERLINK("#\'17. Σύνοψη\'!A1",TEXT(PnLNetResult,"€#.##0"))',
         t("Καθαρό αποτέλεσμα, ταμειακή βάση — βλ. Σύνοψη", "Net result, cash basis — see Σύνοψη"),
         value_bold=True, value_color=DARK_BLUE, col0=1)
    mrow(ws, INV_SEC + 4, t("Waterfall Εταίρων — Σύνολο Διανομών", "Partner Waterfall — Total Distributions"),
         '=HYPERLINK("#\'18. Απόδοση Εταίρων\'!A1",TEXT(WaterfallTotalDist,"€#.##0")&"   ("&TEXT(WaterfallMOIC_A,"0,00""x""")&" MOIC)")',
         t("Πρότυπο υπόδειγμα — βλ. Απόδοση Εταίρων", "Template only — see Απόδοση Εταίρων"),
         value_bold=True, value_color="FF965800", label_bg="FFFEF0D8", value_bg="FFFEF0D8", note_bg="FFFEF0D8", col0=5)
    INV_SEC_LAST = INV_SEC + 4
    spacer(ws, INV_SEC_LAST + 1, 6)

    # ══════════════════════════════ SECTION 6 ══════════════════════════════
    # ΑΝΑΜΕΝΟΜΕΝΑ ΕΙΣΕΡΧΟΜΕΝΑ ΜΕ ΒΑΘΜΟ ΒΕΒΑΙΟΤΗΤΑΣ + 6-month cash-runway
    # coverage ratio — ported from Επιχειρησιακό_Αρχείο_107.xlsx's own
    # "4 · ΑΝΑΜΕΝΟΜΕΝΑ ΕΙΣΕΡΧΟΜΕΝΑ" and "Κάλυψη εξαμήνου από τα σημερινά
    # ρευστά" dashboard rows. Left-hand card (A-D) is a NEW itemized table
    # (yellow inputs + a Βεβαιότητα dropdown) — distinct from the existing
    # single-figure "Αναμενόμενα Εισερχόμενα" tile in Section 1 above
    # (left untouched), which only ever summed the two named
    # ExpectedFromAntonis/ExpectedFromAlbert cells on Λογαριασμοί. Right-
    # hand card (E-H) is the runway ratio, reusing AllFunds and the exact
    # same AVG_BURN formula (9. Ταμείο's own Net Change column, D4:D9)
    # already used by this sheet's own free-text cash-runway narrative
    # above — not a new burn calculation. ──
    SEC6 = INV_SEC_LAST + 2
    sec_hdr(ws, SEC6, t("ΑΝΑΜΕΝΟΜΕΝΑ ΕΙΣΕΡΧΟΜΕΝΑ ΜΕ ΒΕΒΑΙΟΤΗΤΑ  ·  ΚΑΛΥΨΗ ΕΞΑΜΗΝΟΥ",
                        "EXPECTED INCOMING WITH CERTAINTY  ·  6-MONTH COVERAGE"), number="6", end_col="H")
    spacer(ws, SEC6 + 1, 5, LIGHT_GREY)

    INC2_HDR = SEC6 + 2
    for ci, h in enumerate([t("Περιγραφή", "Description"), t("Ποσό", "Amount"),
                            t("Αναμ. Μήνας", "Expected Month"), t("Βεβαιότητα", "Certainty")], 1):
        col_hdr(ws, INC2_HDR, ci, h)
    INC2_FIRST = INC2_HDR + 1
    # first two rows mirror the real Αντώνης/Άλμπερτ figures already on
    # Λογαριασμοί (same amounts/timing, not re-derived) so the certainty
    # split is meaningful from the first open; the other two are blank
    # slots ready for a real bank-financing line once one exists, per the
    # "don't fabricate a number" rule for anything not already in the file.
    incoming2 = [
        (t("Αντώνης — δάνειο (βλ. Λογαριασμοί)", "Antonis — loan (see Λογαριασμοί)"), 160000, "2026-09", t("Βέβαιη", "Certain")),
        (t("Άλμπερτ — δάνειο (βλ. Λογαριασμοί)", "Albert — loan (see Λογαριασμοί)"), 70000, "2026-09", t("Πιθανή", "Probable")),
        (None, None, None, None),
        (None, None, None, None),
    ]
    for i, (desc, amt, month, cert) in enumerate(incoming2):
        row = INC2_FIRST + i
        ws.row_dimensions[row].height = 18
        inp(ws, row, 1, desc, align_h="left")
        inp(ws, row, 2, amt, EUR0)
        inp(ws, row, 3, month, align_h="center")
        inp(ws, row, 4, cert, align_h="center")
    INC2_LAST = INC2_FIRST + len(incoming2) - 1
    dv_cert2 = DataValidation(type="list", formula1="LIST_CERTAINTY", allow_blank=True, showDropDown=False)
    ws.add_data_validation(dv_cert2); dv_cert2.sqref = f"D{INC2_FIRST}:D{INC2_LAST}"

    INC2_TOTAL_ROW = INC2_LAST + 1
    ws.row_dimensions[INC2_TOTAL_ROW].height = 20
    lbl(ws, INC2_TOTAL_ROW, 1, t("ΣΥΝΟΛΟ (όλα)", "TOTAL (all)"), bold=True, bg=LIGHT_BLUE)
    calc(ws, INC2_TOTAL_ROW, 2, f"=SUM(B{INC2_FIRST}:B{INC2_LAST})", EUR0, bg=LIGHT_BLUE, bold=True, fg=DARK_BLUE)
    for ci in (3, 4):
        ws.cell(row=INC2_TOTAL_ROW, column=ci).fill = F(LIGHT_BLUE)
    INC2_CERTAIN_ROW = INC2_TOTAL_ROW + 1
    ws.row_dimensions[INC2_CERTAIN_ROW].height = 18
    lbl(ws, INC2_CERTAIN_ROW, 1, t("— εκ των οποίων Βέβαιη", "— of which Certain"), bg=WHITE)
    calc(ws, INC2_CERTAIN_ROW, 2,
         f'=SUMIFS(B{INC2_FIRST}:B{INC2_LAST},D{INC2_FIRST}:D{INC2_LAST},"{t("Βέβαιη","Certain")}")',
         EUR0, bg=WHITE, fg=GREEN_FG)

    # 6-month coverage ratio — same AVG_BURN string already computed above
    # for the free-text runway narrative (line ~829), reused verbatim.
    mrow(ws, INC2_FIRST, t("Κάλυψη Εξαμήνου (Ρευστά ÷ Μ.Ο. Burn)", "6-Month Coverage (Liquid ÷ Avg. Burn)"),
         f'=IF({AVG_BURN}>=0,"—",ROUND(AllFunds/(-{AVG_BURN}),1))',
         t("Ρευστά Διαθέσιμα Σήμερα διά τον μέσο μηνιαίο burn — <1 σημαίνει ανάγκη εισροών μέσα στο εξάμηνο", "Liquid funds today over avg. monthly burn — <1 means inflows are needed within the half-year"),
         value_fmt="0,0", value_bold=True, value_color="FF965800", label_bg="FFFEF0D8", value_bg="FFFEF0D8", note_bg="FFFEF0D8",
         height=18, col0=5)
    mrow(ws, INC2_FIRST + 1, t("Ρευστά Διαθέσιμα Σήμερα (Όλα)", "Liquid Funds Today (All)"), "=AllFunds", "",
         value_fmt=EUR0, value_color=DARK_BLUE, height=18, col0=5)
    mrow(ws, INC2_FIRST + 2, t("Μέσος Μηνιαίος Burn (επόμενο εξάμηνο)", "Avg. Monthly Burn (next 6 months)"),
         f"={AVG_BURN}", "", value_fmt=EUR0_NEG, value_color=RED_FG, height=18, col0=5)

    SEC6_LAST = max(INC2_CERTAIN_ROW, INC2_FIRST + 2)
    spacer(ws, SEC6_LAST + 1, 6)

    # ══════════════════════════════ SECTION 7 ══════════════════════════════
    # ΔΑΝΕΙΑΚΗ ΘΕΣΗ (Εγκεκριμένα/Εκταμιευθέντα/Εκκρεμεί) + Q004 IRR/Payback,
    # next to Section 5's existing Q003 IRR/DSCR card above — every value
    # here is a defined-name reference into 14. Δάνεια / 13. Μισθώματα &
    # Αποδόσεις, resolved by Excel at open time, same pattern as Section 5.
    # ──
    SEC7 = SEC6_LAST + 2
    sec_hdr(ws, SEC7, t("ΔΑΝΕΙΑΚΗ ΘΕΣΗ  ·  Q004 ΑΠΟΔΟΣΗ", "LOAN POSITION  ·  Q004 RETURNS"), number="7", end_col="H")
    spacer(ws, SEC7 + 1, 5, LIGHT_GREY)
    mrow(ws, SEC7 + 2, t("Εγκεκριμένα (Δάνεια Α+Β)", "Approved (Loan A+B)"),
         '=HYPERLINK("#\'14. Δάνεια\'!A1",TEXT(LoanApprovedTotal,"€#.##0"))', "",
         value_bold=True, value_color=DARK_BLUE, col0=1)
    mrow(ws, SEC7 + 3, t("Εκταμιευθέντα", "Disbursed"),
         '=HYPERLINK("#\'14. Δάνεια\'!A1",TEXT(LoanDisbursedTotal,"€#.##0"))', "",
         value_bold=True, value_color=GREEN_FG, label_bg=GREEN_BG, value_bg=GREEN_BG, note_bg=GREEN_BG, col0=1)
    mrow(ws, SEC7 + 4, t("Εκκρεμεί προς Εκταμίευση", "Pending Disbursement"),
         '=HYPERLINK("#\'14. Δάνεια\'!A1",TEXT(LoanPendingDisbursement,"€#.##0"))',
         t("Δεν υπάρχει μοντελοποιημένο δάνειο «σε αίτηση» — δείτε Δάνεια", "No modeled loan is “in application” — see Δάνεια"),
         value_bold=True, value_color="FF965800", label_bg="FFFEF0D8", value_bg="FFFEF0D8", note_bg="FFFEF0D8", col0=1)
    mrow(ws, SEC7 + 2, t("Q004 — IRR (unlevered)", "Q004 — IRR (unlevered)"),
         '=HYPERLINK("#\'13. Μισθώματα & Αποδόσεις\'!A1",TEXT(Q004IRR,"0,0%"))',
         t("Χωρίς μόχλευση δανείων — βλ. Μισθώματα & Αποδόσεις", "Unlevered, before loan financing — see Μισθώματα & Αποδόσεις"),
         value_bold=True, value_color="FF965800", label_bg="FFFEF0D8", value_bg="FFFEF0D8", note_bg="FFFEF0D8", col0=5)
    mrow(ws, SEC7 + 3, t("Q004 — Payback (έτη)", "Q004 — Payback (years)"),
         '=HYPERLINK("#\'13. Μισθώματα & Αποδόσεις\'!A1","Payback: "&Q004Payback)',
         t("Δεν υπάρχει μοντελοποιημένο δάνειο για Q004 — δεν έχει δικό του DSCR (βλ. Δάνεια)", "No loan is modeled against Q004 — it has no DSCR of its own (see Δάνεια)"),
         value_bold=True, value_color="FF965800", label_bg="FFFEF0D8", value_bg="FFFEF0D8", note_bg="FFFEF0D8", col0=5)
    SEC7_LAST = SEC7 + 4
    spacer(ws, SEC7_LAST + 1, 6)

    CASH_CHART_ANCHOR = "J5"   # top-right, beside Sections 1-3 — cash-trend
    # chart is built once Ταμείο exists further down (needs its
    # CASH_FIRST/CASH_MONTHS/data to be real first) — see the
    # chart-creation block right after Ταμείο's table.

    # print area / page setup — dashboard is landscape (A-H content plus the
    # cash-trend chart parked to the right around J-X), fit to one page wide
    # so it never splits a KPI card in half sideways; height is left
    # unconstrained (fitToHeight=0) since the sheet is tall by design and
    # splitting across a few pages top-to-bottom is fine for print/PDF.
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_area = f"A1:X{max(SEC7_LAST + 2, 24)}"

    # ══════════════════════════════════════════════════════════════════════════
    # TAB: ΚΙΝΗΣΕΙΣ  (income & expenses — single source of truth)
    # ══════════════════════════════════════════════════════════════════════════
    ws = ws_kin
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 13
    ws.column_dimensions["B"].width = 30
    ws.column_dimensions["C"].width = 13
    ws.column_dimensions["D"].width = 32
    ws.column_dimensions["E"].width = 24
    ws.column_dimensions["F"].width = 10
    ws.column_dimensions["G"].width = 13
    ws.column_dimensions["H"].width = 11
    ws.column_dimensions["I"].width = 13
    ws.column_dimensions["J"].width = 24
    ws.column_dimensions["K"].width = 13
    ws.column_dimensions["L"].width = 13
    ws.column_dimensions["M"].width = 16
    ws.column_dimensions["N"].width = 14
    ws.column_dimensions["O"].width = 16
    ws.column_dimensions["P"].width = 30
    ws.column_dimensions["Q"].width = 11
    for letter, w in zip(("R", "S", "T", "U", "V", "W", "X", "Y", "Z", "AA", "AB", "AC", "AD", "AE", "AF", "AG", "AH", "AI", "AJ", "AK", "AL", "AM", "AN"),
                         (12, 10, 12, 12, 12, 12, 14, 14, 13, 12, 12, 12, 13, 15, 16, 14, 14, 22, 12, 10, 12, 14, 13)):
        ws.column_dimensions[letter].width = w
    ws.column_dimensions["AI"].outline_level = 1
    ws.column_dimensions["AI"].hidden = True
    ws.column_dimensions["AJ"].outline_level = 1
    ws.column_dimensions["AJ"].hidden = True
    # Έτος/Τρίμηνο (AK/AL) exist purely as helper fields for the Ελεύθερη
    # Ανάλυση pivot's column hierarchy (see H_QUARTER's comment) — nothing a
    # user types into or reads directly here, so hidden like AI/AJ.
    ws.column_dimensions["AK"].outline_level = 1
    ws.column_dimensions["AK"].hidden = True
    ws.column_dimensions["AL"].outline_level = 1
    ws.column_dimensions["AL"].hidden = True
    ws.column_dimensions["AM"].outline_level = 1
    ws.column_dimensions["AM"].hidden = True
    ws.column_dimensions["AN"].outline_level = 1
    ws.column_dimensions["AN"].hidden = True
    # the purely-derived installment columns (Αναμενόμενες Δόσεις Μέχρι
    # Σήμερα → Επόμενη Δόση) collapse into one band by default — you never
    # type into any of them, they're all computed from Επαναλαμβανόμενο/
    # Ημ/νία Τελ. Πληρωμένης Δόσης further left, which stay visible/
    # ungrouped since those ARE the inputs. Cuts the sheet from 32 visible
    # columns down to a workable width without deleting anything.
    for letter in ("V", "W", "X", "Y", "Z", "AA", "AB", "AC", "AD"):
        ws.column_dimensions[letter].outline_level = 1
        ws.column_dimensions[letter].hidden = True
    ws.sheet_properties.outlinePr.summaryRight = False
    ws.freeze_panes = "C13"

    ws.row_dimensions[1].height = 34
    ws.merge_cells("A1:P1")
    c = ws.cell(row=1, column=1, value="  ΚΙΝΗΣΕΙΣ  —  ΕΣΟΔΑ & ΕΞΟΔΑ")
    c.fill = F(DARK_BLUE); c.font = Fnt(size=14, bold=True, color=WHITE)
    c.alignment = Aln(h="left", v="center")

    sheet_intro(ws, 2,
        "Η μοναδική βάση δεδομένων του αρχείου — κάθε έσοδο, έξοδο, τιμολόγιο, δόση και προσωπικό έξοδο "
        "καταχωρείται εδώ, μία φορά. Εδώ τα ΛΕΥΚΑ κελιά είναι τα δικά σας (τα γκρι είναι τύποι) — όλα τα "
        "υπόλοιπα φύλλα απλώς διαβάζουν από αυτόν τον πίνακα, ζωντανά.",
        end_col="P", height=30)

    # TYPE_INC/H_*/REC_* constants and _recur_monthly() now live near the top
    # of build_workbook() (with SCOPE_BIZ/CAT_*) — Κέντρο Ελέγχου, built
    # before this sheet, already needs them for its VAT KPIs and Personal
    # Spending rollup.

    # rows 3-11: intentionally left blank (the old mini "ΓΕΝΙΚΗ ΕΙΚΟΝΑ" summary
    # was removed — it duplicated the Κέντρο Ελέγχου dashboard).
    for rr in range(3, 12):
        ws.row_dimensions[rr].height = 8
        for ci in range(1, 17): ws.cell(row=rr, column=ci).fill = F(WHITE)

    ws.row_dimensions[12].height = 22
    headers = [H_DATE, H_CONTACT, H_AFM, H_PROJECT, H_DESC, H_TYPE, H_AMOUNT,
               H_VAT, H_WITHHELD, H_SOURCE, H_STATUS, H_ORIGIN, H_MARK,
               H_DUE, H_NET, H_NOTES]
    for ci, txt in enumerate(headers, 1):
        c = ws.cell(row=12, column=ci, value=txt)
        c.fill = F(DARK_BLUE); c.font = Fnt(size=10, bold=True, color=WHITE)
        c.alignment = Aln(h="center", v="center")
    mc = ws.cell(row=12, column=17, value=H_MONTH)
    mc.fill = F(DARK_BLUE); mc.font = Fnt(size=10, bold=True, color=WHITE)
    mc.alignment = Aln(h="center", v="center")
    rec_headers = [H_REC, H_RECCOUNT, H_RECEND, H_RECPAID_ACTUAL, H_RECPAID_EXP, H_OVERDUE_N,
                   H_PAIDTOTAL, H_REMAINING, H_OVERDUE_AMT,
                   H_NEXT30, H_NEXT180, H_NEXT365, H_NEXTDUE,
                   H_SCOPE, H_CATEGORY, H_PROB, H_AMOUNT_WEIGHTED, H_TXID, H_MONTH_EPOCH,
                   H_YEAR, H_QUARTER, H_MONTH_PIVOT, H_DAYNUM]
    for j, txt in enumerate(rec_headers):
        c = ws.cell(row=12, column=18 + j, value=txt)
        c.fill = F(DARK_BLUE); c.font = Fnt(size=9, bold=True, color=WHITE)
        c.alignment = Aln(h="center", v="center", wrap=True)

    def kin_data_row(row, date, contact, project, desc, typ, amt, vat, withheld,
                      source, status, origin, mark, notes, due_date=None, net=None,
                      recurring=False, rec_count=None, rec_end=None, rec_paid_actual=None,
                      scope=None, category=None, collect_prob=None):
        lines = wrap_lines(notes, 30)
        ws.row_dimensions[row].height = 18 if lines <= 1 else 15 * lines + 8
        proj_bg, proj_fg = (LIGHT_GREY, "FF6B7280") if not project else (LIGHT_BLUE, DARK_BLUE)
        status_bg = GREEN_BG if status == S_PAID else (YELLOW if status else WHITE)
        # every real transaction generated here (manual list / AADE import)
        # defaults to Business; personal entries get scope=SCOPE_PERS
        # explicitly. Pre-provisioned blank rows pass scope="" (not None) so
        # they stay genuinely empty instead of being defaulted to Business.
        if scope is None:
            scope = SCOPE_BIZ

        dc = ws.cell(row=row, column=1, value=date)
        dc.fill = F(WHITE); dc.alignment = Aln(h="center"); dc.protection = UNLOCKED
        if date: dc.number_format = "DD/MM/YYYY"

        cc = ws.cell(row=row, column=2, value=contact)
        cc.fill = F(WHITE); cc.alignment = Aln(h="left", v="center"); cc.protection = UNLOCKED

        afc = ws.cell(row=row, column=3,
            value=f'=IFERROR(VLOOKUP($B{row},\'7. Επαφές\'!$A$5:$B$30,2,FALSE),"")')
        afc.fill = F(LIGHT_GREY); afc.alignment = Aln(h="center", v="center")
        afc.font = Fnt(size=9, color="FF6B7280")

        pc = ws.cell(row=row, column=4, value=project)
        pc.fill = F(proj_bg); pc.alignment = Aln(h="center", v="center")
        pc.font = Fnt(size=9, bold=True, color=proj_fg); pc.protection = UNLOCKED

        dsc = ws.cell(row=row, column=5, value=desc)
        dsc.fill = F(WHITE); dsc.alignment = Aln(h="left", v="center"); dsc.protection = UNLOCKED

        tc = ws.cell(row=row, column=6, value=typ)
        tc.fill = F(GREEN_BG if typ == TYPE_INC else WHITE)
        tc.alignment = Aln(h="center"); tc.protection = UNLOCKED

        ac = ws.cell(row=row, column=7, value=amt)
        ac.number_format = EUR; ac.alignment = Aln(h="right"); ac.fill = F(WHITE); ac.protection = UNLOCKED

        vc = ws.cell(row=row, column=8, value=(vat or None))
        vc.number_format = EUR; vc.alignment = Aln(h="right"); vc.fill = F(WHITE); vc.protection = UNLOCKED

        wc = ws.cell(row=row, column=9, value=(withheld or None))
        wc.number_format = EUR; wc.alignment = Aln(h="right"); wc.fill = F(WHITE); wc.protection = UNLOCKED

        srcc = ws.cell(row=row, column=10, value=source)
        srcc.fill = F(WHITE); srcc.alignment = Aln(h="center"); srcc.protection = UNLOCKED

        sc = ws.cell(row=row, column=11, value=status)
        sc.fill = F(status_bg); sc.alignment = Aln(h="center"); sc.protection = UNLOCKED

        oc = ws.cell(row=row, column=12, value=origin)
        oc.fill = F(LIGHT_GREY if origin == ORIG_AADE else WHITE)
        oc.alignment = Aln(h="center"); oc.protection = UNLOCKED
        oc.font = Fnt(size=9, italic=(origin == ORIG_AADE), color="FF6B7280")

        mc = ws.cell(row=row, column=13, value=(mark or None))
        mc.fill = F(WHITE); mc.alignment = Aln(h="center"); mc.protection = UNLOCKED
        mc.font = Fnt(size=9, color="FF6B7280")

        duc = ws.cell(row=row, column=14, value=due_date)
        duc.fill = F(YELLOW if (status == S_UPCOM and typ == TYPE_EXP) else WHITE)
        duc.alignment = Aln(h="center"); duc.protection = UNLOCKED
        if due_date: duc.number_format = "DD/MM/YYYY"

        nc = ws.cell(row=row, column=15, value=(net or None))
        nc.number_format = EUR; nc.alignment = Aln(h="right"); nc.fill = F(WHITE); nc.protection = UNLOCKED

        ntc = ws.cell(row=row, column=16, value=notes)
        ntc.fill = F(WHITE); ntc.protection = UNLOCKED
        ntc.alignment = Alignment(horizontal="left", vertical=("top" if lines > 1 else "center"), wrap_text=True)

        mnc = ws.cell(row=row, column=17, value=f'=IF($A{row}="","",YEAR($A{row})&"-"&TEXT(MONTH($A{row}),"00"))')
        mnc.fill = F(LIGHT_GREY); mnc.alignment = Aln(h="center", v="center")
        mnc.font = Fnt(size=9, color="FF6B7280")

        rc = ws.cell(row=row, column=18, value=(REC_YES if recurring else None))
        rc.fill = F(YELLOW if recurring else WHITE); rc.alignment = Aln(h="center"); rc.protection = UNLOCKED
        sc2 = ws.cell(row=row, column=19, value=rec_count)
        sc2.fill = F(WHITE); sc2.alignment = Aln(h="center"); sc2.protection = UNLOCKED
        tc2 = ws.cell(row=row, column=20, value=rec_end)
        tc2.fill = F(WHITE); tc2.alignment = Aln(h="center"); tc2.protection = UNLOCKED
        if rec_end: tc2.number_format = "DD/MM/YYYY"

        # manual: the DATE of the last installment you actually paid — you
        # update this by hand each time a δόση is paid (a date is more
        # natural to enter and self-documenting than a running count).
        # Everything else below derives the paid-count from it, so a missed
        # payment surfaces automatically as a "Ληξιπρόθεσμες Δόσεις" instead
        # of being silently assumed paid just because the calendar date has
        # gone by.
        # own distinct colour (amber, not the standard input yellow) — this
        # is the ONE field on a recurring row that needs a human to come
        # back and update it every single month it stays open, unlike
        # every other input here that's set once and left alone. Blending
        # it into the same yellow as "just fill this in" made it too easy
        # to forget it needs re-touching on a schedule, not just once.
        pac = ws.cell(row=row, column=21, value=rec_paid_actual)
        pac.fill = F("FFFFCC80" if recurring else WHITE); pac.alignment = Aln(h="center"); pac.protection = UNLOCKED
        pac.font = Fnt(size=9, bold=True, color=("FF7A3800" if recurring else DARK_GREY))
        if rec_paid_actual: pac.number_format = "DD/MM/YYYY"

        _eff_today = f'IF($T{row}<>"",MIN(TODAY(),$T{row}),TODAY())'
        # derive the paid-count from the last-paid DATE in $U — same
        # YEAR/MONTH arithmetic (not DATEDIF) as _recur_monthly's actual_n,
        # for the same reason: safe on a blank $U without erroring.
        _actual = f'IF($U{row}="",0,(YEAR($U{row})-YEAR($A{row}))*12+(MONTH($U{row})-MONTH($A{row}))+1)'
        exp_formula = (f'=IF($R{row}<>"{REC_YES}","",IF($A{row}="","",'
                       f'IF({_eff_today}<$A{row},0,'
                       f'IF($S{row}="",DATEDIF($A{row},{_eff_today},"m")+1,'
                       f'MIN($S{row},DATEDIF($A{row},{_eff_today},"m")+1)))))')
        expc = ws.cell(row=row, column=22, value=exp_formula)
        expc.fill = F(LIGHT_GREY); expc.alignment = Aln(h="center"); expc.font = Fnt(size=9, color="FF6B7280")

        overdue_n_formula = f'=IF($R{row}<>"{REC_YES}","",MAX(0,$V{row}-{_actual}))'
        ovc = ws.cell(row=row, column=23, value=overdue_n_formula)
        ovc.fill = F(LIGHT_GREY); ovc.alignment = Aln(h="center"); ovc.font = Fnt(size=9, bold=True, color=RED_FG)

        v_formula = (f'=IF($A{row}="","",IF($R{row}="{REC_YES}",{_actual}*$G{row},'
                     f'IF($K{row}="{S_PAID}",$G{row},0)))')
        vc2 = ws.cell(row=row, column=24, value=v_formula)
        vc2.number_format = EUR; vc2.alignment = Aln(h="right"); vc2.fill = F(LIGHT_GREY)
        vc2.font = Fnt(size=9, bold=True, color=GREEN_FG)

        # an indefinite plan (blank $S) used to return the TEXT "Αόριστο"
        # here — every SUMIFS across the workbook silently treats text as 0,
        # so an open-ended rent contributed nothing to Σύνολο Υποχρεώσεων.
        # IndefiniteHorizonMonths (Ρυθμίσεις) turns it into a real number:
        # remaining = horizon-months-worth minus what's already counted as
        # paid, floored at 0 so a plan already past the horizon doesn't
        # show a negative commitment.
        # S_SCHED (Προγραμματισμένο) counts here alongside S_UPCOM — it's a
        # real, not-yet-paid project commitment (a modeled construction
        # phase, an estimated legal fee), just not cash-certain the way
        # Εκκρεμεί is. Only Ταμείο (via exclude_status= in _recur_monthly)
        # excludes it, per Επιχειρησιακό_Αρχείο_107.xlsx's own rule for
        # that status — Έργα's Εκκρεμή/Σύνολο still needs to show it as
        # real project exposure, or a €1.8M Q003 construction estimate
        # would silently vanish from the project's own totals.
        w_formula = (f'=IF($A{row}="","",IF($R{row}="{REC_YES}",IF($S{row}="",MAX(0,IndefiniteHorizonMonths-{_actual})*$G{row},'
                     f'($S{row}-{_actual})*$G{row}),'
                     f'IF(OR($K{row}="{S_UPCOM}",$K{row}="{S_SCHED}"),$G{row},0)))')
        wc2 = ws.cell(row=row, column=25, value=w_formula)
        wc2.number_format = EUR; wc2.alignment = Aln(h="right"); wc2.fill = F(LIGHT_GREY)
        wc2.font = Fnt(size=9, bold=True, color="FF965800")

        overdue_amt_formula = f'=IF($R{row}<>"{REC_YES}","",$W{row}*$G{row})'
        oac = ws.cell(row=row, column=26, value=overdue_amt_formula)
        oac.number_format = EUR; oac.alignment = Aln(h="right"); oac.fill = F(LIGHT_GREY)
        oac.font = Fnt(size=9, bold=True, color=RED_FG)

        def _next_n_days_formula(n):
            next_due = f'EDATE($A{row},{_actual})'
            rec_amt = (f'IF({next_due}>TODAY()+{n},0,IF($S{row}="",DATEDIF({next_due},TODAY()+{n},"m")+1,'
                       f'MIN(MAX($S{row}-{_actual},0),DATEDIF({next_due},TODAY()+{n},"m")+1)))*$G{row}')
            nonrec_amt = f'IF(AND($K{row}="{S_UPCOM}",$N{row}<>"",$N{row}<=TODAY()+{n}),$G{row},0)'
            return f'=IF($R{row}="{REC_YES}",{rec_amt},{nonrec_amt})'

        for ci, n in ((27, 30), (28, 180), (29, 365)):
            fc = ws.cell(row=row, column=ci, value=_next_n_days_formula(n))
            fc.number_format = EUR; fc.alignment = Aln(h="right"); fc.fill = F(LIGHT_GREY)
            fc.font = Fnt(size=9, color="FF6B7280")

        # visible "next due date" — the exact same EDATE($A,actual_paid) used
        # internally by the forecast columns above, surfaced explicitly so it
        # isn't a black box: the moment you bump $U (actual paid) by 1 after
        # paying an installment, this date jumps forward by one month on its own.
        nd_formula = f'=IF($R{row}="{REC_YES}",EDATE($A{row},{_actual}),"")'
        ndc = ws.cell(row=row, column=30, value=nd_formula)
        ndc.alignment = Aln(h="center"); ndc.fill = F(LIGHT_GREY)
        ndc.font = Fnt(size=9, bold=True, color=DARK_BLUE)
        ndc.number_format = "DD/MM/YYYY"

        # Business/Personal split — see SCOPE_BIZ/SCOPE_PERS above. Manual,
        # not derived, so it stays editable like every other classification
        # column (Έργο, Τύπος, Κατάσταση, ...).
        scc = ws.cell(row=row, column=31, value=(scope or None))
        scc.fill = F("FFEFEAFB" if scope == SCOPE_PERS else WHITE)
        scc.alignment = Aln(h="center"); scc.protection = UNLOCKED
        scc.font = Fnt(size=9, bold=True, color=("FF5B3A9E" if scope == SCOPE_PERS else DARK_GREY))

        catc = ws.cell(row=row, column=32, value=category)
        catc.fill = F(WHITE); catc.alignment = Aln(h="left", v="center"); catc.protection = UNLOCKED
        catc.font = Fnt(size=9)

        # manual: how likely this Έσοδο is to actually be collected — only
        # meaningful on an Εκκρεμεί income row (a loan still "in
        # application", an unconfirmed fee); blank means "no reason to
        # doubt it", not "unknown 0%". $AH turns this into an actual euro
        # figure Ταμείο can sum: paid rows and expenses always weight at
        # 100% regardless of what's typed here.
        pbc = ws.cell(row=row, column=33, value=collect_prob)
        pbc.fill = F(YELLOW if (typ == TYPE_INC and status == S_UPCOM) else WHITE)
        pbc.alignment = Aln(h="center"); pbc.protection = UNLOCKED
        pbc.font = Fnt(size=9, bold=True)
        if collect_prob is not None: pbc.number_format = "0%"

        # ScenarioProbFactor (Ρυθμίσεις) stacks on top of this row's own
        # Πιθανότητα Είσπραξης — Conservative knocks another 30% off every
        # not-yet-paid income row, Aggressive adds 20% back (capped at
        # MIN(1,...) — collecting more than 100% of an invoice isn't a
        # thing, so a row already at full confidence genuinely can't move
        # under Aggressive, only a discounted one can climb toward 100%).
        # NOTE: this formula must stay purely numeric (no IF($A="","",...)
        # text branch) — it's multiplied element-wise inside SUMPRODUCT by
        # _recur_monthly()'s "recurring" branch (Ταμείο, Κέντρο Ελέγχου, ΦΠΑ,
        # Προϋπολογισμοί all depend on it). SUMPRODUCT poisons its ENTIRE
        # result to #VALUE! if even one cell in a multiplied array is text,
        # so a blank row must evaluate to a real 0, not "". The zero-hiding
        # 3-section number format below keeps blank rows visually empty.
        wac = ws.cell(row=row, column=34,
            value=f'=IF($A{row}="",0,$G{row}*IF(AND($F{row}="{TYPE_INC}",$K{row}="{S_UPCOM}"),MIN(1,IF($AG{row}="",1,$AG{row})*ScenarioProbFactor),1))')
        wac.number_format = '€#,##0.00;-€#,##0.00;'; wac.alignment = Aln(h="right"); wac.fill = F(LIGHT_GREY)
        wac.font = Fnt(size=9, color="FF6B7280")

        # date+AFM+amount+invoice-mark fingerprint — deterministic, so
        # re-running the myDATA import can check "does this ID already
        # exist in Table_Kin?" before appending a row, instead of trusting
        # that the source file was never fetched twice. "0" needs no
        # decimal separator so it's locale-neutral, but the amount portion
        # needs 2 decimals — "0.00" (period) is the locale-BROKEN form on
        # this Greek-locale Excel (same TEXT()-argument bug as elsewhere in
        # this file); "0,00" (comma) is required here.
        idc = ws.cell(row=row, column=35,
            value=f'=IF($A{row}="","",TEXT($A{row},"0")&"-"&$C{row}&"-"&TEXT($G{row},"0,00")&"-"&$M{row})')
        idc.fill = F(LIGHT_GREY); idc.alignment = Aln(h="left", v="center")
        idc.font = Fnt(size=8, color="FF9CA3AF")

        # deliberately NOT blank-guarded (no IF($A="","",...)) — a blank
        # date must stay a NUMBER here (YEAR/MONTH coerce blank to 0
        # without erroring, landing this at a harmless out-of-range value),
        # because this column feeds arithmetic subtraction inside a
        # SUMPRODUCT array; an explicit "" text result would throw #VALUE!
        # across the ENTIRE array the moment one row has no date, not just
        # that row — multiplying an array error by zero elsewhere doesn't
        # clear it.
        epc = ws.cell(row=row, column=36, value=f'=YEAR($A{row})*12+MONTH($A{row})')
        epc.fill = F(LIGHT_GREY); epc.alignment = Aln(h="center", v="center")
        epc.font = Fnt(size=8, color="FF9CA3AF")

        # Έτος / Τρίμηνο — blank-guarded (unlike Δείκτης Μήνα above): these
        # feed the Ελεύθερη Ανάλυση pivot as plain column-header text/number
        # fields, never a SUMPRODUCT array, so a text "" for blank rows is
        # safe here (see H_QUARTER's comment for why Group()-based hierarchy
        # fields aren't used instead).
        yrc = ws.cell(row=row, column=37, value=f'=IF($A{row}="","",YEAR($A{row}))')
        yrc.fill = F(LIGHT_GREY); yrc.alignment = Aln(h="center", v="center")
        yrc.font = Fnt(size=8, color="FF9CA3AF")
        qc = ws.cell(row=row, column=38,
            value=f'=IF($A{row}="","","Τρίμ. "&ROUNDUP(MONTH($A{row})/3,0))')
        qc.fill = F(LIGHT_GREY); qc.alignment = Aln(h="center", v="center")
        qc.font = Fnt(size=8, color="FF9CA3AF")
        # mirrors of Μήνας/Ημερομηνία under new trailing names — see
        # H_MONTH_PIVOT's comment for why the pivot needs its own copies
        # rather than reusing the real Μήνας ($Q) / Ημερομηνία ($A) columns
        # directly.
        mpc = ws.cell(row=row, column=39, value=f'=$Q{row}')
        mpc.fill = F(LIGHT_GREY); mpc.alignment = Aln(h="center", v="center")
        mpc.font = Fnt(size=8, color="FF9CA3AF")
        mpc.number_format = "@"
        dpc = ws.cell(row=row, column=40, value=f'=IF($A{row}="","",$A{row})')
        dpc.fill = F(LIGHT_GREY); dpc.alignment = Aln(h="center", v="center")
        dpc.font = Fnt(size=8, color="FF9CA3AF")
        dpc.number_format = "DD/MM/YYYY"

    # ── all rows pulled straight from AADE_Master.xlsx — no manual data ──
    aade_base_dir = os.path.dirname(os.path.abspath(__file__))
    aade_rows = _load_aade_rows(aade_base_dir)

    # known project tags for AADE-imported income invoices, cross-checked
    # against business_planning&operation.xlsx — those invoices were real
    # income the AADE import already pulled in, just never tagged to a
    # project, so they were invisible on Έργα/Προϋπολογισμοί until now.
    AADE_PROJECT_BY_AFM = {
        "802596520": "Q000_GENERAL",             # VK DEVELOPMENT CONSTRUCTION
        "802936082": "Q002_VOULIAGMENI_309",      # HAOS VOULIAGMENI Ε Ε
    }

    next_row = 13
    aade_contacts = []
    seen_contacts = set()
    for r in aade_rows:
        typ = TYPE_EXP if r["kind"] == "expense" else TYPE_INC
        # myDATA credit invoices (πιστωτικά τιμολόγια) carry a NEGATIVE
        # ΣΥΝΟΛΙΚΗ ΑΞΙΑ, passed straight through as r["amount"] — left as-is
        # this would land as a negative Ποσό on an "income" row, breaking
        # this workbook's own rule that Ποσό is always positive and the
        # sign comes from Τύπος (every SUMIFS/formula in this file assumes
        # that). Flip it: a negative amount becomes a positive amount of
        # the OPPOSITE type instead — a credit note against income is
        # modeled as an expense (reduces net the same way, structurally
        # correct), and vice versa.
        amt, vat, withheld, net = r["amount"], r["vat"], r["withheld"], r["net"]
        if amt < 0:
            typ = TYPE_EXP if typ == TYPE_INC else TYPE_INC
            amt, vat, withheld, net = -amt, -vat, -withheld, -net
        desc = r["desc"] or (t("Τιμολόγιο Παροχής Υπηρεσιών", "Expense invoice") if r["kind"] == "expense"
                              else t("Τιμολόγιο Εσόδου", "Income invoice"))
        proj = AADE_PROJECT_BY_AFM.get(r["afm"], "")
        # every AADE-imported row is a real business tax invoice, and
        # Optima Εταιρικός is the only CORPORATE account in Λογαριασμοί
        # (the rest are personal) — defaulting to it instead of SRC_TBD is
        # what actually happened for ~30 of these real rows, confirmed
        # against Προέλευση="AADE"; still editable per-row if a specific
        # invoice really was paid from somewhere else.
        kin_data_row(next_row, r["date"], r["contact"], proj, desc, typ, amt,
                     vat, withheld, SRC_OPT_CORP, S_PAID, ORIG_AADE, r["mark"], "",
                     net=net)
        next_row += 1
        if r["contact"] not in seen_contacts:
            seen_contacts.add(r["contact"])
            aade_contacts.append((r["contact"], r["afm"]))

    # ── real ΑΑΔΕ tax-settlement plans (ΚΕ.Β.ΕΙΣ. Αττικής, ΑΦΜ 079020543) ──
    # entered manually from the official ρύθμιση confirmation pages — one
    # deposit (one-off) + 3 recurring installment plans, all tied to the
    # project they were taken out for.
    PROJ_AGK = "Q004_AGIOU_KWNSTANTINOU20_GLYFADA"
    # date corrected 24/06→22/06/2026 and source Μετρητά→Πειραιώς Προσωπικός
    # per Επιχειρησιακό_Αρχείο_107.xlsx Κινήσεις row 47 note: "Ημερομηνία
    # διορθώθηκε 24/06 → 22/06/2026 βάσει extrait Πειραιώς (ΕΞΛ ΕΞΟΦΛΗΣΗ
    # ΛΟΓ/ΜΟΥ, PX261733592074)" — an actual bank-statement match, not a guess.
    kin_data_row(next_row, datetime.date(2026, 6, 22), "", PROJ_AGK,
                 "Προκαταβολή ρύθμισης εφορίας (Α/Α 9271572)", TYPE_EXP, 1428.56, 0, 0,
                 SRC_PIR_PERS, S_PAID, ORIG_MANUAL, "",
                 "ΔΟΥ: ΚΕ.Β.ΕΙΣ. Αττικής · ΠΑΓΙΑ Ν.4646/19 έως 16 δόσεις (Α/Α 9271572)")
    next_row += 1
    # source Μετρητά→Optima Εταιρικός per business file's Κινήσεις row 54
    # (Πηγή column for this same installment plan).
    kin_data_row(next_row, datetime.date(2026, 7, 31), "", PROJ_AGK,
                 "Ρύθμιση εφορίας 16 δόσεων (Α/Α 9271572)", TYPE_EXP, 714.28, 0, 0,
                 SRC_OPT_CORP, S_UPCOM, ORIG_MANUAL, "",
                 "ΔΟΥ: ΚΕ.Β.ΕΙΣ. Αττικής · ΤΡΟ 079020543 901977691 260092715120",
                 recurring=True, rec_count=16, rec_paid_actual=datetime.date(2026, 7, 31))
    next_row += 1
    # source Μετρητά→Optima Εταιρικός per business file's Κινήσεις row 49.
    kin_data_row(next_row, datetime.date(2026, 7, 27), "", PROJ_AGK,
                 "Ρύθμιση εφορίας 72 δόσεων (Α/Α 9273853)", TYPE_EXP, 636.04, 0, 0,
                 SRC_OPT_CORP, S_UPCOM, ORIG_MANUAL, "",
                 "ΔΟΥ: ΚΕ.Β.ΕΙΣ. Αττικής · ΤΡΟ 079020543 901977697 260092738530",
                 recurring=True, rec_count=72, rec_paid_actual=datetime.date(2026, 7, 27))
    next_row += 1
    # source Μετρητά→Optima Εταιρικός per business file's Κινήσεις row 50.
    kin_data_row(next_row, datetime.date(2026, 7, 29), "", PROJ_AGK,
                 "Ρύθμιση εφορίας 24 δόσεων (Α/Α 9283760)", TYPE_EXP, 723.93, 0, 0,
                 SRC_OPT_CORP, S_UPCOM, ORIG_MANUAL, "",
                 "ΔΟΥ: ΚΕ.Β.ΕΙΣ. Αττικής · ΤΡΟ 079020543 901977695 260092837600",
                 recurring=True, rec_count=24, rec_paid_actual=datetime.date(2026, 7, 29))
    next_row += 1

    # ── real recurring rent rows, imported from business_planning&operation.xlsx —
    # now tagged to their own project codes (Q006/Q007 exist as real projects
    # as of this session — the user overrode the earlier "not worth standalone
    # project codes" decision below and asked to follow the business file's
    # own mapping), matching the other Q006 rows already on Q006_KAVOURI_AKTIS2. ──
    kin_data_row(next_row, datetime.date(2026, 9, 1), "", "Q006_KAVOURI_AKTIS2",
                 "Ενοίκιο Καβούρι, Ακτής 2", TYPE_EXP, 600, 0, 0,
                 SRC_OPT_CORP, S_UPCOM, ORIG_MANUAL, "",
                 "600€/μήνα, 20 δόσεις Σεπ 2026–Απρ 2028",
                 recurring=True, rec_count=20, rec_paid_actual=None)
    next_row += 1
    # amount 600→550 and start date 01/09→01/08/2026, plus rec_paid_actual
    # set to the August installment, per Επιχειρησιακό_Αρχείο_107.xlsx
    # Κινήσεις row 72: "550 €/μήνα σε μετρητά ... Τρέχει από Αύγουστο 2026 —
    # η δόση Αυγούστου πληρώθηκε. ΛΗΞΗ ΜΙΣΘΩΣΗΣ ΔΕΝ ΔΗΛΩΘΗΚΕ, προσωρινά 24
    # δόσεις" — rec_count stays 24 (unconfirmed lease end, unchanged).
    kin_data_row(next_row, datetime.date(2026, 8, 1), "", "Q007_KOLONAKI_KARNEADOU37",
                 "Ενοίκιο Κολωνάκι", TYPE_EXP, 550, 0, 0,
                 SRC_CASH, S_UPCOM, ORIG_MANUAL, "",
                 "550€/μήνα σε μετρητά — λήξη μίσθωσης ανεπιβεβαίωτη, ο αριθμός δόσεων είναι προσωρινή εκτίμηση (24, έως Ιούλιο 2028)",
                 recurring=True, rec_count=24, rec_paid_actual=datetime.date(2026, 8, 1))
    next_row += 1

    # ── real Q003 financing tranches (loan draws), imported from
    # business_planning&operation.xlsx — all "Σε αίτηση" (not yet secured),
    # so they're upcoming income until the source file's Κατάσταση changes.
    # €1.6M of these used to hit Ταμείο's forecast at full face value the
    # moment they were dated, which is what made the "ασφαλής" 2027 cash
    # figure fictitious. 50% is a flagged placeholder, not a real
    # assessment of loan-approval odds — adjust «Πιθανότητα Είσπραξης» per
    # tranche once you have an actual read on each application. ──
    PROJ_LAZ = "Q003_LAZARAKI32_GLYFADA"
    LOAN_PROB_PLACEHOLDER = 0.5
    for tranche_date, amount, note in [
        (datetime.date(2027, 1, 31), 375000, "Δάνειο Α — επιδοτούμενο 0,35% · Φάση Α · Σε αίτηση"),
        (datetime.date(2027, 1, 31), 225000, "Δάνειο Β — συμβατικό 3,5% · Φάση Α · Σε αίτηση"),
        (datetime.date(2027, 4, 30), 375000, "Δάνειο Α — επιδοτούμενο 0,35% · Φάση Β · Σε αίτηση"),
        (datetime.date(2027, 4, 30), 225000, "Δάνειο Β — συμβατικό 3,5% · Φάση Β · Σε αίτηση"),
        (datetime.date(2027, 7, 31), 250000, "Δάνειο Α — επιδοτούμενο 0,35% · Φάση Γ · Σε αίτηση"),
        (datetime.date(2027, 7, 31), 150000, "Δάνειο Β — συμβατικό 3,5% · Φάση Γ · Σε αίτηση"),
    ]:
        # blank Πηγή, not SRC_TBD — genuinely unknown (the loan is still
        # "Σε αίτηση", so which account it lands in isn't decided yet),
        # and these rows are Εκκρεμεί (not Πληρωμένο) so the "paid needs a
        # source" rule doesn't apply to them anyway.
        kin_data_row(next_row, tranche_date, "", PROJ_LAZ,
                     "Εκταμίευση δανείου κατασκευής", TYPE_INC, amount, 0, 0,
                     "", S_UPCOM, ORIG_MANUAL, "", note,
                     category=CAT_LOAN, collect_prob=LOAN_PROB_PLACEHOLDER)
        next_row += 1

    # ── remaining manual rows imported from Επιχειρησιακό_Αρχείο_107.xlsx's
    # Κινήσεις sheet (Προέλευση=Χειρόγραφο) — 60 of the 66 total manual rows
    # in that sheet; the other 6 (3 ΑΓΚ tax-settlement installment plans +
    # 1 προκαταβολή ρύθμισης εφορίας + the recurring Ενοίκιο Καβούρι/Κολωνάκι
    # rows) are already merged above. Amounts are the source file's Καθαρή
    # Αξία; ΦΠΑ/Παρακράτηση are 0 unless the source shows a non-null value
    # (the two Αμοιβή Μεσιτείας income rows carry real ΦΠΑ). The source
    # status "Προγραμματισμένο" now has its own dedicated Κατάσταση
    # constant, S_SCHED — added to match Επιχειρησιακό_Αρχείο_107.xlsx as
    # source of truth, since its own note on one such row is explicit that
    # this status is meant to behave differently from Εκκρεμεί (excluded
    # from Ταμείο's cash forecast; see exclude_status= in _recur_monthly). ──
    kin_data_row(next_row, datetime.date(2025, 9, 18), '', "Q001_ILIOUPOLI_P15_RESIDENCES",
                 'ΦΜΑ αγοράς', TYPE_EXP, 3708, 0, 0,
                 SRC_OPT_CORP, S_PAID, ORIG_MANUAL, "", 'Χειρόγραφη καταγραφή χρήστη 19/08/2026. ΗΜΕΡΟΜΗΝΙΑ ΠΡΟΣ ΕΠΙΒΕΒΑΙΩΣΗ. Ημερομηνία και λογαριασμός από statement Optima.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2025, 10, 1), '', "Q001_ILIOUPOLI_P15_RESIDENCES",
                 'Προκαταβολή αγοράς (Βάσω)', TYPE_EXP, 50000, 0, 0,
                 SRC_OPT_CORP, S_PAID, ORIG_MANUAL, "", 'Χειρόγραφη καταγραφή χρήστη 19/08/2026. ΗΜΕΡΟΜΗΝΙΑ ΠΡΟΣ ΕΠΙΒΕΒΑΙΩΣΗ. Ημερομηνία και λογαριασμός από statement Optima.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2025, 10, 10), '', "Q001_ILIOUPOLI_P15_RESIDENCES",
                 'Κτηματολόγιο', TYPE_EXP, 749.5, 0, 0,
                 SRC_OPT_CORP, S_PAID, ORIG_MANUAL, "", 'Χειρόγραφη καταγραφή χρήστη 19/08/2026. ΗΜΕΡΟΜΗΝΙΑ ΠΡΟΣ ΕΠΙΒΕΒΑΙΩΣΗ. Ημερομηνία και λογαριασμός από statement Optima.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 4, 2), 'Ευγενία Θεοφανοπούλου', "Q006_KAVOURI_AKTIS2",
                 'Εγγύηση μίσθωσης', TYPE_EXP, 1200, 0, 0,
                 SRC_OPT_CORP, S_PAID, ORIG_MANUAL, "", 'Επιστρέφεται στη λήξη της μίσθωσης — απαίτηση, όχι έξοδο.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 4, 2), 'Ευγενία Θεοφανοπούλου', "Q006_KAVOURI_AKTIS2",
                 'Ενοίκιο Καβούρι — Απρίλιος 2026', TYPE_EXP, 600, 0, 0,
                 SRC_OPT_CORP, S_PAID, ORIG_MANUAL, "", 'Εφάπαξ πληρωμή Απριλίου 2026. Το επαναλαμβανόμενο ενοίκιο των 600 €/μήνα βρίσκεται στη γρ. 71. Επιπλέον 16.800 € δόθηκαν σε μετρητά στις 05/04/2026 για δύο χρόνια (700 €/μήνα έως 04/2028). Πραγματικό κόστος Καβουρίου: 1.300 €/μήνα, εκ των οποίων 700 προπληρωμένα.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 4, 30), '', "Q003_LAZARAKI32_GLYFADA",
                 'Προκαταβολή ενοικίου', TYPE_EXP, 5000, 0, 0,
                 SRC_OPT_CORP, S_PAID, ORIG_MANUAL, "", 'Απρίλιος 2026 Πηγή διορθώθηκε: Πειραιώς Προσωπικός → Optima Εταιρικός. Τα extraits Πειραιώς 30/04/2026 δεν δείχνουν χρέωση 5.000 € (όλος ο Απρίλιος: 2.285,21 €).')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 5, 5), '', "Q003_LAZARAKI32_GLYFADA",
                 'Αρχιτέκτονες', TYPE_EXP, 4000, 0, 0,
                 SRC_CASH, S_PAID, ORIG_MANUAL, "", '')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 5, 5), '', "Q003_LAZARAKI32_GLYFADA",
                 'ΕΟΤ (Ορέστης)', TYPE_EXP, 1000, 0, 0,
                 SRC_CASH, S_PAID, ORIG_MANUAL, "", 'Προκαταβολή. Υπόλοιπο 1.000 € εκκρεμεί')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 5, 5), '', "Q003_LAZARAKI32_GLYFADA",
                 'Θέρμανση / μπάνιο ξήλωμα', TYPE_EXP, 1020, 0, 0,
                 SRC_CASH, S_PAID, ORIG_MANUAL, "", 'Εκκρεμούν επιπλέον ποσά προς καθορισμό')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 5, 5), '', "Q003_LAZARAKI32_GLYFADA",
                 'Κατεδάφιση (γκρεμίσματα)', TYPE_EXP, 2400, 0, 0,
                 SRC_CASH, S_PAID, ORIG_MANUAL, "", 'Εκκρεμούν επιπλέον ποσά προς καθορισμό')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 5, 5), '', "Q003_LAZARAKI32_GLYFADA",
                 'Κοινόχρηστα', TYPE_EXP, 290, 0, 0,
                 SRC_CASH, S_PAID, ORIG_MANUAL, "", '')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 5, 5), '', "Q003_LAZARAKI32_GLYFADA",
                 'Κοινόχρηστα', TYPE_EXP, 210.24, 0, 0,
                 SRC_CASH, S_PAID, ORIG_MANUAL, "", '')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 5, 5), '', "Q003_LAZARAKI32_GLYFADA",
                 'Κοινόχρηστα ασανσέρ', TYPE_EXP, 78.6, 0, 0,
                 SRC_CASH, S_PAID, ORIG_MANUAL, "", '')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 5, 5), '', "Q003_LAZARAKI32_GLYFADA",
                 'Κοινόχρηστα λογαριασμοί', TYPE_EXP, 516.24, 0, 0,
                 SRC_CASH, S_PAID, ORIG_MANUAL, "", '276 € από τράπεζα')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 5, 5), '', "Q003_LAZARAKI32_GLYFADA",
                 'Λογιστής (Άκης)', TYPE_EXP, 500, 0, 0,
                 SRC_CASH, S_PAID, ORIG_MANUAL, "", '')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 5, 5), '', "Q003_LAZARAKI32_GLYFADA",
                 'Λογιστής — ρυθμίσεις', TYPE_EXP, 300, 0, 0,
                 SRC_CASH, S_PAID, ORIG_MANUAL, "", '')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 5, 5), '', "Q003_LAZARAKI32_GLYFADA",
                 'Μηχανικός / πιστοποιητικά', TYPE_EXP, 350, 0, 0,
                 SRC_CASH, S_PAID, ORIG_MANUAL, "", 'Ολοκληρώθηκε')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 5, 5), '', "Q003_LAZARAKI32_GLYFADA",
                 'Προκαταβολή ενοικίου', TYPE_EXP, 1000, 0, 0,
                 SRC_CASH, S_PAID, ORIG_MANUAL, "", '')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 5, 11), 'OPENVIEW   TAILOR MADE BUSINES', "Q001_ILIOUPOLI_P15_RESIDENCES",
                 'Εκτίμηση ακινήτου για εισφορά σε ΑΕ (Openview) — μετρητά', TYPE_EXP, 1500, 0, 0,
                 SRC_CASH, S_PAID, ORIG_MANUAL, "", 'Περίπου 1.500 € σε μετρητά, πέραν του τιμολογίου των 200 €. ΕΚΤΙΜΗΣΗ — να επιβεβαιωθεί.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 5, 18), 'ΑΙΜΙΛΙΑ ΚΟΝΣΟΥΛΑ ', "Q000_GENERAL",
                 'KANSHA', TYPE_EXP, 1800, 0, 0,
                 SRC_CASH, S_PAID, ORIG_MANUAL, "", '')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 8, 1), '', "Q001_ILIOUPOLI_P15_RESIDENCES",
                 'Rteco — στατικά & μηχανολογικά', TYPE_EXP, 7000, 0, 0,
                 SRC_CASH, S_PAID, ORIG_MANUAL, "", 'Χειρόγραφη καταγραφή χρήστη 19/08/2026. ΗΜΕΡΟΜΗΝΙΑ ΠΡΟΣ ΕΠΙΒΕΒΑΙΩΣΗ.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 8, 1), '', "Q001_ILIOUPOLI_P15_RESIDENCES",
                 'Αποδοχή ύψους — συμβολαιογράφος', TYPE_EXP, 450, 0, 0,
                 SRC_CASH, S_PAID, ORIG_MANUAL, "", 'Χειρόγραφη καταγραφή χρήστη 19/08/2026. ΗΜΕΡΟΜΗΝΙΑ ΠΡΟΣ ΕΠΙΒΕΒΑΙΩΣΗ.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 8, 1), '', "Q000_GENERAL",
                 'Δικηγόρος', TYPE_EXP, 2500, 0, 0,
                 SRC_OPT_CORP, S_PAID, ORIG_MANUAL, "", 'Μεταφέρθηκε στα γενικά της εταιρείας.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 8, 1), '', "Q001_ILIOUPOLI_P15_RESIDENCES",
                 'Εισφορά σε ΑΕ — καταστατικό', TYPE_EXP, 247, 0, 0,
                 SRC_CASH, S_PAID, ORIG_MANUAL, "", 'Χειρόγραφη καταγραφή χρήστη 19/08/2026. ΗΜΕΡΟΜΗΝΙΑ ΠΡΟΣ ΕΠΙΒΕΒΑΙΩΣΗ.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 8, 1), '', "Q001_ILIOUPOLI_P15_RESIDENCES",
                 'Συμβολαιογράφος — εισφορά σε ΑΕ', TYPE_EXP, 350, 0, 0,
                 SRC_CASH, S_PAID, ORIG_MANUAL, "", 'Χειρόγραφη καταγραφή χρήστη 19/08/2026. ΗΜΕΡΟΜΗΝΙΑ ΠΡΟΣ ΕΠΙΒΕΒΑΙΩΣΗ.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 8, 1), '', "Q001_ILIOUPOLI_P15_RESIDENCES",
                 'Τακτοποιήσεις', TYPE_EXP, 7500, 0, 0,
                 SRC_CASH, S_PAID, ORIG_MANUAL, "", 'Χειρόγραφη καταγραφή χρήστη 19/08/2026. ΗΜΕΡΟΜΗΝΙΑ ΠΡΟΣ ΕΠΙΒΕΒΑΙΩΣΗ.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 8, 1), '', "Q001_ILIOUPOLI_P15_RESIDENCES",
                 'Τοπογραφικό', TYPE_EXP, 300, 0, 0,
                 SRC_CASH, S_PAID, ORIG_MANUAL, "", 'Χειρόγραφη καταγραφή χρήστη 19/08/2026. ΗΜΕΡΟΜΗΝΙΑ ΠΡΟΣ ΕΠΙΒΕΒΑΙΩΣΗ.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 8, 1), '', "Q001_ILIOUPOLI_P15_RESIDENCES",
                 'ΦΜΑ εισφοράς σε ΑΕ', TYPE_EXP, 7917.92, 0, 0,
                 SRC_OPT_CORP, S_PAID, ORIG_MANUAL, "", 'Εισφορά του ακινήτου σε ανώνυμη εταιρεία.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 8, 20), 'SPECTER DESIGN GROUP Ι Κ Ε', "Q000_GENERAL",
                 '', TYPE_EXP, 1275, 0, 0,
                 SRC_CASH, S_PAID, ORIG_MANUAL, "", '')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 9, 30), '', "Q004_AGIOU_KWNSTANTINOU20_GLYFADA",
                 'Ανακαίνιση — Α΄ δόση', TYPE_EXP, 30000, 0, 0,
                 SRC_CASH, S_UPCOM, ORIG_MANUAL, "", 'Εκτίμηση χρήστη: 30.000 € μετρητά τον Σεπτέμβριο.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 9, 30), '', "Q003_LAZARAKI32_GLYFADA",
                 'Δικηγόροι & συμβολαιογράφοι — μετρητά', TYPE_EXP, 15000, 0, 0,
                 SRC_CASH, S_SCHED, ORIG_MANUAL, "", 'Έως τέλος Σεπτεμβρίου 2026. Το μισό από τα 30.000. Θα ενσωματωθεί στον συνολικό προϋπολογισμό των 2.000.000 όταν αναλυθεί — προσοχή στη διπλομέτρηση. Προσωρινό: εκκρεμεί συνάντηση με δικηγόρους — τα ποσά μπορεί να μεταβληθούν ελαφρώς.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 9, 30), '', "Q003_LAZARAKI32_GLYFADA",
                 'Δικηγόροι & συμβολαιογράφοι — τραπεζικό μέρος', TYPE_EXP, 15000, 0, 0,
                 SRC_OPT_CORP, S_SCHED, ORIG_MANUAL, "", 'Έως τέλος Σεπτεμβρίου 2026. Το μισό από τα 30.000. Θα ενσωματωθεί στον συνολικό προϋπολογισμό των 2.000.000 όταν αναλυθεί — προσοχή στη διπλομέτρηση. Προσωρινό: εκκρεμεί συνάντηση με δικηγόρους — τα ποσά μπορεί να μεταβληθούν ελαφρώς.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 9, 30), '', "Q003_LAZARAKI32_GLYFADA",
                 'ΕΝΦΙΑ ιδιοκτητών — εφάπαξ εξόφληση', TYPE_EXP, 7000, 0, 0,
                 SRC_OPT_CORP, S_UPCOM, ORIG_MANUAL, "", 'Μέρος του χρέους 41.768 €. Εξοφλείται πριν τις ρυθμίσεις ώστε να μειωθούν οι δόσεις. Προσωρινό: εκκρεμεί συνάντηση με δικηγόρους — τα ποσά μπορεί να μεταβληθούν ελαφρώς.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 9, 30), '', "Q000_GENERAL",
                 'Λογιστής — μηνιαία αμοιβή', TYPE_EXP, 300, 0, 0,
                 SRC_OPT_CORP, S_UPCOM, ORIG_MANUAL, "", '300 €/μήνα από Σεπτέμβριο 2026. 36 δόσεις — επεκτείνετε αν χρειαστεί.', recurring=True, rec_count=36)
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 9, 30), '', "Q001_ILIOUPOLI_P15_RESIDENCES",
                 'Ολοκλήρωση αγοράς (Βάσω)', TYPE_EXP, 70000, 0, 0,
                 SRC_OPT_CORP, S_UPCOM, ORIG_MANUAL, "", 'Έως τέλος Σεπτεμβρίου 2026. Υπόλοιπο τιμήματος μετά την προκαταβολή των 50.000.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 9, 30), '', "Q003_LAZARAKI32_GLYFADA",
                 'Προσύμφωνο — καταβολή στους ιδιοκτήτες', TYPE_EXP, 19000, 0, 0,
                 SRC_CASH, S_UPCOM, ORIG_MANUAL, "", 'Με την υπογραφή του συμβολαιογραφικού προσυμφώνου. ΔΕΝ συμψηφίζεται με μισθώματα. Προσωρινό: εκκρεμεί συνάντηση με δικηγόρους — τα ποσά μπορεί να μεταβληθούν ελαφρώς.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 9, 30), '', "Q003_LAZARAKI32_GLYFADA",
                 'Ρύθμιση ιδιοκτητών Α — 24 δόσεις', TYPE_EXP, 276.2, 0, 0,
                 SRC_OPT_CORP, S_UPCOM, ORIG_MANUAL, "", 'Χρέος ιδιοκτητών. Οι δόσεις αθροίζουν ακριβώς το υπόλοιπο των 34.768 € μετά την εφάπαξ εξόφληση ΕΝΦΙΑ 7.000 €. Άτοκη ρύθμιση — αν προκύψουν τόκοι, τα ποσά θα ανέβουν. ΔΕΝ συμψηφίζεται με μισθώματα. Προσωρινό: εκκρεμεί συνάντηση με δικηγόρους — τα ποσά μπορεί να μεταβληθούν ελαφρώς.', recurring=True, rec_count=24)
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 9, 30), '', "Q003_LAZARAKI32_GLYFADA",
                 'Ρύθμιση ιδιοκτητών Β — 72 δόσεις', TYPE_EXP, 61.53, 0, 0,
                 SRC_OPT_CORP, S_UPCOM, ORIG_MANUAL, "", 'Χρέος ιδιοκτητών. Οι δόσεις αθροίζουν ακριβώς το υπόλοιπο των 34.768 € μετά την εφάπαξ εξόφληση ΕΝΦΙΑ 7.000 €. Άτοκη ρύθμιση — αν προκύψουν τόκοι, τα ποσά θα ανέβουν. ΔΕΝ συμψηφίζεται με μισθώματα. Προσωρινό: εκκρεμεί συνάντηση με δικηγόρους — τα ποσά μπορεί να μεταβληθούν ελαφρώς.', recurring=True, rec_count=72)
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 9, 30), '', "Q003_LAZARAKI32_GLYFADA",
                 'Ρύθμιση ιδιοκτητών Γ — 48 δόσεις', TYPE_EXP, 184.59, 0, 0,
                 SRC_OPT_CORP, S_UPCOM, ORIG_MANUAL, "", 'Χρέος ιδιοκτητών. Οι δόσεις αθροίζουν ακριβώς το υπόλοιπο των 34.768 € μετά την εφάπαξ εξόφληση ΕΝΦΙΑ 7.000 €. Άτοκη ρύθμιση — αν προκύψουν τόκοι, τα ποσά θα ανέβουν. ΔΕΝ συμψηφίζεται με μισθώματα. Προσωρινό: εκκρεμεί συνάντηση με δικηγόρους — τα ποσά μπορεί να μεταβληθούν ελαφρώς.', recurring=True, rec_count=48)
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 9, 30), '', "Q003_LAZARAKI32_GLYFADA",
                 'Ρύθμιση ιδιοκτητών Δ — 72 δόσεις', TYPE_EXP, 70.42, 0, 0,
                 SRC_OPT_CORP, S_UPCOM, ORIG_MANUAL, "", 'Χρέος ιδιοκτητών. Οι δόσεις αθροίζουν ακριβώς το υπόλοιπο των 34.768 € μετά την εφάπαξ εξόφληση ΕΝΦΙΑ 7.000 €. Άτοκη ρύθμιση — αν προκύψουν τόκοι, τα ποσά θα ανέβουν. ΔΕΝ συμψηφίζεται με μισθώματα. Προσωρινό: εκκρεμεί συνάντηση με δικηγόρους — τα ποσά μπορεί να μεταβληθούν ελαφρώς.', recurring=True, rec_count=72)
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 9, 30), '', "Q003_LAZARAKI32_GLYFADA",
                 'Ρύθμιση ιδιοκτητών Ε — 48 δόσεις', TYPE_EXP, 203.73, 0, 0,
                 SRC_OPT_CORP, S_UPCOM, ORIG_MANUAL, "", 'Χρέος ιδιοκτητών. Οι δόσεις αθροίζουν ακριβώς το υπόλοιπο των 34.768 € μετά την εφάπαξ εξόφληση ΕΝΦΙΑ 7.000 €. Άτοκη ρύθμιση — αν προκύψουν τόκοι, τα ποσά θα ανέβουν. ΔΕΝ συμψηφίζεται με μισθώματα. Προσωρινό: εκκρεμεί συνάντηση με δικηγόρους — τα ποσά μπορεί να μεταβληθούν ελαφρώς.', recurring=True, rec_count=48)
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 10, 31), '', "Q004_AGIOU_KWNSTANTINOU20_GLYFADA",
                 'Ανακαίνιση — Β΄ δόση', TYPE_EXP, 30000, 0, 0,
                 SRC_CASH, S_SCHED, ORIG_MANUAL, "", 'Ισομερής κατανομή του υπολοίπου — η ημερομηνία είναι εκτίμηση.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 11, 30), '', "Q004_AGIOU_KWNSTANTINOU20_GLYFADA",
                 'Ανακαίνιση — Γ΄ δόση', TYPE_EXP, 30000, 0, 0,
                 SRC_CASH, S_SCHED, ORIG_MANUAL, "", 'Ισομερής κατανομή του υπολοίπου — η ημερομηνία είναι εκτίμηση.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 11, 30), 'ΝΕΚΤΑΡΙΑ', "Q004_AGIOU_KWNSTANTINOU20_GLYFADA",
                 'μεσιτικη αμοιβη', TYPE_EXP, 20000, 0, 0,
                 SRC_CASH, S_UPCOM, ORIG_MANUAL, "", 'Β΄ δόση μεσιτικής αμοιβής. Σύνολο 55.000 €, εκ των οποίων 35.000 € καταβλήθηκαν 30/07/2026 (γρ. 53).')
    next_row += 1

    kin_data_row(next_row, datetime.date(2027, 1, 31), '', "Q003_LAZARAKI32_GLYFADA",
                 'Κατασκευή — φάση Α', TYPE_EXP, 690557.91, 0, 0,
                 SRC_OPT_CORP, S_SCHED, ORIG_MANUAL, "", 'Αναλογικά προσαρμοσμένο ώστε ο συνολικός προϋπολογισμός Λαζαρακίου να κλείνει στα 2.000.000 €. Προσωρινό: εκκρεμεί συνάντηση με δικηγόρους — τα ποσά μπορεί να μεταβληθούν ελαφρώς.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2027, 3, 31), '', "Q003_LAZARAKI32_GLYFADA",
                 'Οριστικό συμβόλαιο — καταβολή στους ιδιοκτήτες', TYPE_EXP, 50000, 0, 0,
                 SRC_CASH, S_UPCOM, ORIG_MANUAL, "", '6 μήνες μετά το προσύμφωνο (εκτίμηση). ΔΕΝ συμψηφίζεται με μισθώματα. Προσωρινό: εκκρεμεί συνάντηση με δικηγόρους — τα ποσά μπορεί να μεταβληθούν ελαφρώς.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2027, 4, 30), '', "Q003_LAZARAKI32_GLYFADA",
                 'Κατασκευή — φάση Β', TYPE_EXP, 690557.91, 0, 0,
                 SRC_OPT_CORP, S_SCHED, ORIG_MANUAL, "", 'Αναλογικά προσαρμοσμένο ώστε ο συνολικός προϋπολογισμός Λαζαρακίου να κλείνει στα 2.000.000 €. Προσωρινό: εκκρεμεί συνάντηση με δικηγόρους — τα ποσά μπορεί να μεταβληθούν ελαφρώς.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2027, 7, 31), '', "Q003_LAZARAKI32_GLYFADA",
                 'Κατασκευή — φάση Γ', TYPE_EXP, 460371.94, 0, 0,
                 SRC_OPT_CORP, S_SCHED, ORIG_MANUAL, "", 'Αναλογικά προσαρμοσμένο ώστε ο συνολικός προϋπολογισμός Λαζαρακίου να κλείνει στα 2.000.000 €. Προσωρινό: εκκρεμεί συνάντηση με δικηγόρους — τα ποσά μπορεί να μεταβληθούν ελαφρώς.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 3, 15), '', "Q005_LEGRENA",
                 'Καθαρισμοί & κηπουρός', TYPE_EXP, 410, 0, 0,
                 SRC_CASH, S_PAID, ORIG_MANUAL, "", 'Λεγρενά: κληρονομιά πατέρα, 50% συνιδιοκτησία. Το πλήρες ποσό πληρώθηκε από τον χρήστη — επιβεβαιωμένο 21/08/2026. Δεν υπάρχει απαίτηση προς τον συνιδιοκτήτη.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 7, 31), '', "Q005_LEGRENA",
                 'Τοπογράφος', TYPE_EXP, 700, 0, 0,
                 SRC_CASH, S_PAID, ORIG_MANUAL, "", 'Λεγρενά: κληρονομιά πατέρα, 50% συνιδιοκτησία. Το πλήρες ποσό πληρώθηκε από τον χρήστη — επιβεβαιωμένο 21/08/2026. Δεν υπάρχει απαίτηση προς τον συνιδιοκτήτη.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 8, 4), 'RTECO ΖΑΦΕΙΡΟΠΟΥΛΟΣ', "Q002_VOULIAGMENI_309",
                 'Στατικά μελέτης άδειας', TYPE_EXP, 2000, 0, 0,
                 SRC_CASH, S_PAID, ORIG_MANUAL, "", 'Επιβεβαιωμένο από τον χρήστη 21/08/2026. Εκκρεμεί: υπάρχει τιμολόγιο; Αν ναι, χρειάζονται καθαρή αξία, ΦΠΑ και αριθμός παραστατικού.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 12, 31), 'ΣΑΜΙΝΟ ΕΚΤΕΛΩΝΙΣΤΕΣ', "Q000_GENERAL",
                 'Μεσιτεία οικοπέδου — Σαμινό εκτελωνιστές', TYPE_INC, 100000, 24000, 0,
                 SRC_OPT_CORP, S_UPCOM, ORIG_MANUAL, "", 'Μεσιτεία οικοπέδου — πελάτης Φαής. ΒΕΒΑΙΗ ΑΠΑΙΤΗΣΗ, γι᾽ αυτό «Εκκρεμεί» και μετράει στο ταμείο. Μεικτό 124.000 (100.000 + ΦΠΑ). ΠΡΟΣΟΧΗ: περίπου το μισό αποδίδεται σε συνεργαζόμενους μεσίτες — δεν έχει καταχωρηθεί ακόμη.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2027, 4, 30), 'CARIATIDES', "Q000_GENERAL",
                 'Μεσιτεία Ψυρρή, Αγίου Δημητρίου 5–7', TYPE_INC, 85000, 20400, 0,
                 SRC_OPT_CORP, S_SCHED, ORIG_MANUAL, "", 'Μεσιτεία Ψυρρή — ΠΡΟΒΛΕΨΗ. Μένει «Προγραμματισμένο», οπότε ΔΕΝ μετράει στο ταμείο: μόνο τα έσοδα με δέσμευση ενισχύουν τη ρευστότητα.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 4, 5), 'ΙΔΙΟΚΤΗΤΗΣ ΚΑΒΟΥΡΙΟΥ', "Q006_KAVOURI_AKTIS2",
                 'Ενοίκιο Καβούρι — προπληρωμή 24 μηνών σε μετρητά (700 €/μήνα)', TYPE_EXP, 16800, 0, 0,
                 SRC_CASH, S_PAID, ORIG_MANUAL, "", '700 €/μήνα × 24, εφάπαξ 05/04/2026, καλύπτουν έως Απρίλιο 2028. ΔΕΝ επηρεάζει το ταμείο: προηγείται της 21/08/2026. Πραγματικό κόστος Καβουρίου: 600 Optima + 700 μετρητά = 1.300 €/μήνα. ΠΡΟΣΟΧΗ: από Μάιο 2028 τα 700 ξαναγίνονται τρέχον έξοδο.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 8, 27), 'ΕΛΛΗΝΙΚΟ ΚΤΗΜΑΤΟΛΟΓΙΟ', "Q001_ILIOUPOLI_P15_RESIDENCES",
                 'Τέλη Κτηματολογίου — εισφορά ακινήτου Ηλιούπολης στην ΑΕ', TYPE_EXP, 1566.96, 0, 0,
                 SRC_OPT_CORP, S_PAID, ORIG_MANUAL, "", 'Κτηματολογικό Γραφείο Αθηνών, αρ. πρωτ. 82050/2026. Δημόσια τέλη — χωρίς ΦΠΑ. Προσαυξάνει το κόστος κτήσης, δεν είναι τρέχον έξοδο.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 8, 27), 'ΕΛΛΗΝΙΚΟ ΚΤΗΜΑΤΟΛΟΓΙΟ', "Q004_AGIOU_KWNSTANTINOU20_GLYFADA",
                 'Τέλη Κτηματολογίου — καταχώριση μίσθωσης Αγ. Κωνσταντίνου', TYPE_EXP, 569.5, 0, 0,
                 SRC_OPT_CORP, S_PAID, ORIG_MANUAL, "", 'Κτηματολογικό Γραφείο Πειραιώς και Νήσων, αρ. πρωτ. 34198/2026. Δημόσια τέλη — χωρίς ΦΠΑ.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 8, 27), 'ΑΑΔΕ', "Q001_ILIOUPOLI_P15_RESIDENCES",
                 'Απόδοση παρακρατηθέντος φόρου 20% — τιμολόγιο Δημητρέλου ΣΤΠΥ 427', TYPE_EXP, 482.14, 0, 0,
                 SRC_OPT_CORP, S_UPCOM, ORIG_MANUAL, "", 'Παρακράτηση 20% επί των 2.410,70 του τιμολογίου ΣΤΠΥ 427. Κρατήθηκε από την πληρωμή προς τη Δημητρέλου (γρ. 68). Πρέπει να πληρωθεί ΚΑΙ να αναρτηθεί. Συνολικό κόστος της πράξης: 3.009,27 (2.527,13 + 482,14).')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 8, 30), 'ΚΗΠΟΥΡΟΣ', "Q003_LAZARAKI32_GLYFADA",
                 'Κηπουρός — συντήρηση κήπου Λαζαράκη (Αύγουστος, σύνολο)', TYPE_EXP, 340, 0, 0,
                 SRC_CASH, S_PAID, ORIG_MANUAL, "", 'Τρεις πληρωμές μέσα στον Αύγουστο. Χωρίς παραστατικό.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 8, 20), 'ΣΠΥΡΟΣ', "Q000_GENERAL",
                 'Σπύρος — αμοιβή για εργασίες', TYPE_EXP, 500, 0, 0,
                 SRC_CASH, S_PAID, ORIG_MANUAL, "", 'Γενικές εργασίες Kansha. Χωρίς παραστατικό — ΠΡΟΣ ΤΙΜΟΛΟΓΗΣΗ.')
    next_row += 1

    kin_data_row(next_row, datetime.date(2026, 8, 20), 'DESIGN', "Q006_KAVOURI_AKTIS2",
                 'Design Καβούρι', TYPE_EXP, 150, 0, 0,
                 SRC_CASH, S_PAID, ORIG_MANUAL, "", 'Χωρίς παραστατικό.')
    next_row += 1

    # Pre-extend + protect resolves the earlier Tab-vs-protection tradeoff
    # (confirmed dead-end via direct COM testing both ways — protection
    # genuinely blocks a Table's own row-growth, no way around it, so
    # this stops trying to have both at once). Every formula that reads
    # Table_Kin (SUMIFS/SUMPRODUCT throughout the whole workbook) already
    # ignores blank rows on its own — a blank Ημερομηνία/Τύπος/Ποσό never
    # matches any criteria — so ~1000 pre-built blank rows cost nothing in
    # correctness, only a bit of file size, and the user never has to
    # press Tab at all: just type into the next empty row.
    KIN_TABLE_ROWS = 1000   # total rows the Table_Kin data area should span
    BLANK_ROWS = max(0, KIN_TABLE_ROWS - (next_row - 13))
    for _ in range(BLANK_ROWS):
        kin_data_row(next_row, None, "", None, "", "", None, None, None,
                     "", "", "", "", "", scope="")
        next_row += 1

    LAST_ROW = next_row - 1   # table ends after the real data + pre-provisioned blank rows

    # print area / page setup — real header+data extent of Table_Kin
    # (A12:AN, matching the table ref below). Fit to 1 page wide so the
    # ~40-column table never splits mid-row sideways across pages; height
    # is left unconstrained (fitToHeight=0) since this is a ~1000-row
    # table and forcing it to 1 page tall would shrink text to nothing —
    # it prints across as many pages tall as needed instead.
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_area = f"A1:AN{LAST_ROW}"

    tbl_kin = Table(displayName="Table_Kin", ref=f"A12:AN{LAST_ROW}")
    tbl_kin.tableStyleInfo = TableStyleInfo(
        name="TableStyleLight9", showFirstColumn=False, showLastColumn=False,
        showRowStripes=True, showColumnStripes=False)
    ws.add_table(tbl_kin)

    # overdue installments (date has passed but "Πραγματικές Δόσεις
    # Πληρωμένες" hasn't been updated to match) light up in red so a missed
    # payment is impossible to miss while scanning the ledger.
    red_fill_kin = PatternFill(start_color=RED_BG, end_color=RED_BG, fill_type="solid")
    for col_letter in ("W", "Z"):
        ws.conditional_formatting.add(f"{col_letter}13:{col_letter}{LAST_ROW}",
            CellIsRule(operator="greaterThan", formula=["0"], fill=red_fill_kin,
                       font=Font(name="Calibri", size=9, bold=True, color=RED_FG)))

    # a Πληρωμένο row with no real Πηγή is exactly why bank balances never
    # move — Λογαριασμοί's "Μεταβολή από Κινήσεις" per account is a SUMIFS
    # keyed on this exact column, so a row parked at "Προς καθορισμό" (or
    # left blank) is invisible to every account's balance forever. Flag it
    # the moment it's marked paid instead of relying on someone noticing a
    # zero balance change weeks later.
    ws.conditional_formatting.add(f"J13:J{LAST_ROW}",
        FormulaRule(formula=[f'AND($K13="{S_PAID}",OR($J13="",$J13="{SRC_TBD}"))'],
                    fill=red_fill_kin,
                    font=Font(name="Calibri", size=10, bold=True, color=RED_FG)))

    TIP_ROW = LAST_ROW + 1
    ws.row_dimensions[TIP_ROW].height = 22
    ws.merge_cells(f"A{TIP_ROW}:AF{TIP_ROW}")
    c = ws.cell(row=TIP_ROW, column=1,
                value=f"  Συμβουλή: Επιλέξτε κίτρινα/λευκά κελιά για λίστες.  Το φύλλο έχει ήδη ~1000 έτοιμες κενές γραμμές — απλώς γράψτε στην επόμενη κενή γραμμή, δεν χρειάζεται Tab. Το φύλλο είναι προστατευμένο (μόνο οι στήλες εισαγωγής είναι ξεκλείδωτες) ώστε ένα τυχαίο paste να μην σβήσει έναν τύπο.  Η στήλη ΑΦΜ συμπληρώνεται αυτόματα από τις Επαφές.  Γραμμές με Προέλευση «AADE» εισήχθησαν αυτόματα από το myDATA.  Για δόσεις/ρυθμίσεις/πάγια έξοδα: βάλτε «Ναι» στη στήλη «Επαναλαμβανόμενο», γράψτε την 1η ημερομηνία στο «Ημερομηνία» και το ποσό ανά επανάληψη στο «Ποσό» — αφήστε τον «Αριθμό Επαναλήψεων» κενό για αόριστη επανάληψη (π.χ. ενοίκιο, καθαρισμός). Κάθε φορά που πληρώνετε μια δόση, γράψτε τη ΝΕΑ ημερομηνία στη στήλη «Ημ/νία Τελ. Πληρωμένης Δόσης» με το χέρι — η στήλη «Επόμενη Δόση» δείχνει αμέσως πότε πέφτει η επόμενη, και αν ξεχάσετε να ενημερώσετε, η δόση εμφανίζεται αυτόματα κόκκινη στις στήλες «Ληξιπρόθεσμες Δόσεις» / «Ληξιπρόθεσμο Ποσό» μόλις περάσει η ημερομηνία της. Όλες οι υπόλοιπες στήλες (Αναμενόμενες Δόσεις, Πληρωμένο Μέχρι Σήμερα, Υπόλοιπο Δέσμευσης, Επόμενη Δόση, Ποσό Επόμ. 30/180/365 Ημ.) υπολογίζονται αυτόματα — μην τις αλλάζετε με το χέρι.  Για προσωπικά έξοδα/έσοδα: βάλτε «Προσωπικό» στη στήλη «Πεδίο» και διαλέξτε «Κατηγορία» — μπαίνουν στο ταμείο και στην Ανάλυση όπως όλα τα υπόλοιπα, αλλά ΔΕΝ μετράνε στο ΦΠΑ.")
    c.font = Fnt(size=10, italic=True, color="FF6B7280")
    c.fill = F("FFF6F8FA"); c.alignment = Aln(h="left", wrap=True)
    ws.row_dimensions[TIP_ROW].height = 46

    # Dropdowns  (project list now lives on its own Έργα tab — see below)
    dv_project = DataValidation(type="list", formula1="\'3. Έργα\'!$A$3:$A$14",
                                allow_blank=True, showDropDown=False)
    ws.add_data_validation(dv_project); dv_project.sqref = f"D13:D{LAST_ROW}"

    dv_contact = DataValidation(type="list", formula1="\'7. Επαφές\'!$A$5:$A$30",
                                allow_blank=True, showDropDown=False)
    ws.add_data_validation(dv_contact); dv_contact.sqref = f"B13:B{LAST_ROW}"

    # dropdown VALUES live on Ρυθμίσεις (built later in this function) and
    # are referenced here via dynamic named ranges (LIST_*, defined once
    # Ρυθμίσεις's lists are written — see build_list_names() below) that
    # auto-grow with COUNTA, so adding a new status/source/category directly
    # in Excel makes it appear in the dropdown immediately, with no fixed
    # row-count ceiling and no regenerate needed.
    dv_type = DataValidation(type="list", formula1="LIST_TYPE",
                             allow_blank=True, showDropDown=False)
    ws.add_data_validation(dv_type); dv_type.sqref = f"F13:F{LAST_ROW}"

    # custom, not a plain list — ALSO blocks setting Κατάσταση to Πληρωμένο
    # while Πηγή is still blank/"Προς καθορισμό". This is the actual fix
    # for the 36-transactions-with-no-source problem, not just a red-cell
    # warning after the fact: you can no longer mark something paid
    # without saying where the money came from/went, so a real bank
    # balance can never silently stay frozen at €0 again.
    dv_status = DataValidation(type="custom",
        formula1=(f'=AND(OR(K13="",COUNTIF(LIST_STATUS,K13)>0),'
                  f'NOT(AND(K13="{S_PAID}",OR(J13="",J13="{SRC_TBD}"))))'),
        allow_blank=True, showDropDown=False)
    dv_status.error = t("Ορίστε πρώτα την πραγματική Πηγή πριν βάλετε Κατάσταση = Πληρωμένο.",
                         "Set a real Πηγή (Source) before marking Κατάσταση = Paid.")
    dv_status.errorTitle = t("Λείπει η Πηγή", "Missing Source")
    ws.add_data_validation(dv_status); dv_status.sqref = f"K13:K{LAST_ROW}"

    dv_source = DataValidation(type="list", formula1="LIST_SOURCE",
                               allow_blank=True, showDropDown=False)
    ws.add_data_validation(dv_source); dv_source.sqref = f"J13:J{LAST_ROW}"

    dv_origin = DataValidation(type="list", formula1="LIST_ORIGIN",
                               allow_blank=True, showDropDown=False)
    ws.add_data_validation(dv_origin); dv_origin.sqref = f"L13:L{LAST_ROW}"

    dv_rec = DataValidation(type="list", formula1="LIST_REC",
                            allow_blank=True, showDropDown=False)
    ws.add_data_validation(dv_rec); dv_rec.sqref = f"R13:R{LAST_ROW}"

    dv_scope = DataValidation(type="list", formula1="LIST_SCOPE",
                              allow_blank=True, showDropDown=False)
    ws.add_data_validation(dv_scope); dv_scope.sqref = f"AE13:AE{LAST_ROW}"

    dv_category = DataValidation(type="list", formula1="LIST_CATEGORY",
                                 allow_blank=True, showDropDown=False)
    ws.add_data_validation(dv_category); dv_category.sqref = f"AF13:AF{LAST_ROW}"

    # protect_sheet() now applies here too — the ~1000-row pre-extension
    # above means Tab-to-grow is no longer needed at all (the Table
    # already spans every row anyone will realistically use; you just
    # type into the next blank one), so the "protection blocks Table
    # growth" conflict simply doesn't arise anymore. Every input cell in
    # kin_data_row() already sets .protection = UNLOCKED explicitly
    # (columns 1,2,4-16,18-21,31-33); every formula/derived column
    # (3, 17, 22-30, 34-36) was deliberately left at openpyxl's default
    # locked=True — so this now blocks exactly the ~15 formula columns a
    # stray paste used to be able to silently wipe (e.g. "Πληρωμένο Μέχρι
    # Σήμερα"), while every real input across all ~1000 rows stays
    # editable.
    protect_sheet(ws)

    # ══════════════════════════════════════════════════════════════════════════
    # TAB: ΕΡΓΑ  (project registry — name + per-project totals)
    # ══════════════════════════════════════════════════════════════════════════
    ws = ws_proj
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 30
    for letter in "BCDEFGHIJK":
        ws.column_dimensions[letter].width = 15
    ws.freeze_panes = "A3"

    ws.row_dimensions[1].height = 34
    ws.merge_cells("A1:K1")
    c = ws.cell(row=1, column=1, value="  ΕΡΓΑ")
    c.fill = F(DARK_BLUE); c.font = Fnt(size=14, bold=True, color=WHITE)
    c.alignment = Aln(h="left", v="center")

    ws.column_dimensions["L"].width = 26
    # 2 new columns (M/N) — Τύπος Έργου / Κατάσταση Έργου, ported from
    # Επιχειρησιακό_Αρχείο_107.xlsx's own Ρυθμίσεις sheet dimension of the
    # same name. Appended after L (Όνομα Εμφάνισης) so nothing already
    # referencing columns A-L by letter (Προϋπολογισμοί's Έργα!L lookup,
    # Κέντρο Ελέγχου) shifts.
    ws.column_dimensions["M"].width = 16
    ws.column_dimensions["N"].width = 16

    # narrative intro lives beside the title, in L1:N1 (unused in row 1) —
    # row 2 is already the real column-header row here (freeze_panes="A3",
    # and Έλεγχοι Ποιότητας hardcodes 'Έργα'!A3:A14), so there is no blank
    # spacer row to reuse without shifting every project row underneath.
    ws.row_dimensions[1].height = 40
    ws.merge_cells("L1:N1")
    ic = ws.cell(row=1, column=12,
                 value="Τα σύνολα κάθε έργου (πληρωμένα, εκκρεμή, προβλέψεις +1/+6/+12 μηνών) — ζωντανά από τις Κινήσεις.")
    ic.fill = F(DARK_BLUE); ic.font = Fnt(size=8, italic=True, color="FFC9D3DE")
    ic.alignment = Aln(h="left", v="center", wrap=True)

    ws.row_dimensions[2].height = 30
    proj_col_headers = ["Έργο", "Πληρωμένα", "Εκκρεμή", "Ληξιπρόθεσμο", "Σύνολο", "Πρόβλεψη +1 Μήνα",
                        "Πρόβλεψη +6 Μήνες", "Πρόβλεψη +12 Μήνες", "Έσοδα",
                        "Έσοδα Εισπραγμένα", "Έσοδα Αναμενόμενα", t("Όνομα Εμφάνισης", "Display Name"),
                        t("Τύπος Έργου", "Project Type"), t("Κατάσταση Έργου", "Project Status")]
    for j, htxt in enumerate(proj_col_headers):
        hc = ws.cell(row=2, column=1 + j, value=htxt)
        hc.fill = F(LIGHT_BLUE); hc.font = Fnt(size=10, bold=True, color=DARK_GREY)
        hc.alignment = Aln(h="center" if j else "left", wrap=True)

    proj_base = [
        "Q001_ILIOUPOLI_P15_RESIDENCES",
        "Q002_VOULIAGMENI_309",
        "Q003_LAZARAKI32_GLYFADA",
        "Q004_AGIOU_KWNSTANTINOU20_GLYFADA",
        "Q005_LEGRENA",
        "Q000_GENERAL",
        "Q006_KAVOURI_AKTIS2",
        "Q007_KOLONAKI_KARNEADOU37",
    ]
    # project codes (Q004_AGIOU_KWNSTANTINOU20_GLYFADA) stay the real ID —
    # every SUMIFS/lookup across the whole workbook is keyed on them — but
    # nobody should have to read that as a label. This is the one place the
    # friendly name is written down; everywhere it needs to show up
    # (Κέντρο Ελέγχου's project ranking, Προϋπολογισμοί's column headers)
    # reads it from Έργα's new "Όνομα Εμφάνισης" column instead of the code.
    PROJECT_DISPLAY = {
        "Q001_ILIOUPOLI_P15_RESIDENCES": t("Ηλιούπολη, Π15 Residences", "Ilioupoli, P15 Residences"),
        "Q002_VOULIAGMENI_309": t("Βουλιαγμένη 309", "Vouliagmeni 309"),
        "Q003_LAZARAKI32_GLYFADA": t("Λαζαράκη 32, Γλυφάδα", "Lazaraki 32, Glyfada"),
        "Q004_AGIOU_KWNSTANTINOU20_GLYFADA": t("Αγ. Κωνσταντίνου 20, Γλυφάδα", "Ag. Konstantinou 20, Glyfada"),
        "Q005_LEGRENA": t("Λεγρενά", "Legrena"),
        "Q000_GENERAL": t("Γενικά / Εταιρικά", "General / Corporate"),
        "Q006_KAVOURI_AKTIS2": t("Καβούρι, Ακτής 2", "Kavouri, Aktis 2"),
        "Q007_KOLONAKI_KARNEADOU37": t("Κολωνάκι, Καρνεάδου 37", "Kolonaki, Karneadou 37"),
    }
    # every total here comes from ONE table — Table_Kin — since Κινήσεις now
    # absorbs both real transactions and recurring/installment plans (via the
    # Επαναλαμβανόμενο flag); a project's numbers are never split across
    # separate tables, matching the single-source-of-truth design.
    for i in range(12):
        r = 3 + i
        ws.row_dimensions[r].height = 22
        nm = ws.cell(row=r, column=1, value=(proj_base[i] if i < len(proj_base) else None))
        nm.fill = F(YELLOW); nm.alignment = Aln(h="left")
        nm.font = Fnt(size=11, bold=(i < len(proj_base)))
        code = proj_base[i] if i < len(proj_base) else None
        disp = ws.cell(row=r, column=12, value=(PROJECT_DISPLAY.get(code, code) if code else None))
        disp.fill = F(WHITE); disp.alignment = Aln(h="left", v="center")
        disp.font = Fnt(size=10, italic=True, color="FF6B7280")
        # Τύπος Έργου / Κατάσταση Έργου — yellow input, left BLANK for all 8
        # real projects: Επιχειρησιακό_Αρχείο_107.xlsx's own "8 · ΚΑΤΑΣΤΑΣΗ
        # ΕΡΓΩΝ" dashboard section and its Ρυθμίσεις sheet's Έργο column
        # don't pair a status/type value to each project row anywhere — the
        # Τύπος Έργου/Κατάσταση Έργου columns there are just standalone
        # dropdown-source lists, not a per-project mapping — so there's no
        # real value to port without guessing. Only rows with a real
        # project code get the yellow input styling; the 4 unused slots
        # stay plain white like the rest of that row.
        ptc = ws.cell(row=r, column=13, value=None)
        ptc.fill = F(YELLOW if code else WHITE); ptc.alignment = Aln(h="left", v="center")
        ptc.font = Fnt(size=10)
        psc = ws.cell(row=r, column=14, value=None)
        psc.fill = F(YELLOW if code else WHITE); psc.alignment = Aln(h="left", v="center")
        psc.font = Fnt(size=10)
        pd = ws.cell(row=r, column=2,
            value=f'=IF($A{r}="","",SUMIFS(Table_Kin[{H_PAIDTOTAL}],Table_Kin[{H_PROJECT}],$A{r},Table_Kin[{H_TYPE}],"{TYPE_EXP}"))')
        up = ws.cell(row=r, column=3,
            value=f'=IF($A{r}="","",SUMIFS(Table_Kin[{H_REMAINING}],Table_Kin[{H_PROJECT}],$A{r},Table_Kin[{H_TYPE}],"{TYPE_EXP}"))')
        ov = ws.cell(row=r, column=4,
            value=f'=IF($A{r}="","",SUMIFS(Table_Kin[{H_OVERDUE_AMT}],Table_Kin[{H_PROJECT}],$A{r},Table_Kin[{H_TYPE}],"{TYPE_EXP}"))')
        tt = ws.cell(row=r, column=5, value=f'=IF($A{r}="","",B{r}+C{r})')
        f1 = ws.cell(row=r, column=6,
            value=f'=IF($A{r}="","",SUMIFS(Table_Kin[{H_NEXT30}],Table_Kin[{H_PROJECT}],$A{r},Table_Kin[{H_TYPE}],"{TYPE_EXP}"))')
        f6 = ws.cell(row=r, column=7,
            value=f'=IF($A{r}="","",SUMIFS(Table_Kin[{H_NEXT180}],Table_Kin[{H_PROJECT}],$A{r},Table_Kin[{H_TYPE}],"{TYPE_EXP}"))')
        f12 = ws.cell(row=r, column=8,
            value=f'=IF($A{r}="","",SUMIFS(Table_Kin[{H_NEXT365}],Table_Kin[{H_PROJECT}],$A{r},Table_Kin[{H_TYPE}],"{TYPE_EXP}"))')
        # appended, not inserted — income was invisible on this sheet before
        # (every other column here is expense-only by design); adding it at
        # the end avoids re-shifting the columns Κέντρο Ελέγχου already
        # references by letter.
        inc = ws.cell(row=r, column=9,
            value=f'=IF($A{r}="","",SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_PROJECT}],$A{r},Table_Kin[{H_TYPE}],"{TYPE_INC}"))')
        # income-side status split, mirroring the expense-side Πληρωμένα/Εκκρεμή
        # discipline — without this, a merely-applied-for loan tranche reads
        # identically to money already received.
        inc_paid = ws.cell(row=r, column=10,
            value=f'=IF($A{r}="","",SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_PROJECT}],$A{r},Table_Kin[{H_TYPE}],"{TYPE_INC}",Table_Kin[{H_STATUS}],"{S_PAID}"))')
        inc_upcom = ws.cell(row=r, column=11,
            value=f'=IF($A{r}="","",SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_PROJECT}],$A{r},Table_Kin[{H_TYPE}],"{TYPE_INC}",Table_Kin[{H_STATUS}],"{S_UPCOM}"))')
        for cc in (pd, up, f1, f6, f12, inc, inc_paid, inc_upcom):
            cc.number_format = EUR0; cc.alignment = Aln(h="right")
            cc.font = Fnt(size=11, color="FF6B7280")
        inc_paid.font = Fnt(size=11, color=GREEN_FG)
        inc_upcom.font = Fnt(size=11, color="FF965800")
        ov.number_format = EUR0; ov.alignment = Aln(h="right")
        ov.font = Fnt(size=11, bold=True, color=RED_FG)
        tt.number_format = EUR0; tt.alignment = Aln(h="right")
        tt.font = Fnt(size=11, bold=True, color=DARK_BLUE)

        # ranking key for Κέντρο Ελέγχου's "projects sorted by value" list —
        # lives on the veryHidden _calc sheet, not here: a back-office user
        # should never see a number they can't explain on Έργα itself. A
        # plain per-cell IF (not an array formula spanning the whole range)
        # deliberately, because an array-context IF() over a range was
        # proven NOT to implicitly evaluate without Ctrl+Shift+Enter in this
        # Excel, even wrapped in the INDEX(...,0) trick that works for bare
        # comparison operators elsewhere in this file. Scaling Σύνολο by
        # 100000 and subtracting ROW() breaks ties between projects with
        # identical (often zero) totals; blank slots get a large negative
        # sentinel so they always sort last.
        rk = ws_calc.cell(row=r, column=1, value=f'=IF(\'3. Έργα\'!$A{r}="",-999999999,\'3. Έργα\'!$E{r}*100000-ROW())')
        rk.number_format = "0"

    ws.conditional_formatting.add("D3:D15",
        CellIsRule(operator="greaterThan", formula=["0"],
                   fill=PatternFill(start_color=RED_BG, end_color=RED_BG, fill_type="solid"),
                   font=Font(name="Calibri", size=11, bold=True, color=RED_FG)))

    dv_proj_type = DataValidation(type="list", formula1="LIST_PROJTYPE", allow_blank=True, showDropDown=False)
    ws.add_data_validation(dv_proj_type); dv_proj_type.sqref = "M3:M14"
    dv_proj_status = DataValidation(type="list", formula1="LIST_PROJSTATUS", allow_blank=True, showDropDown=False)
    ws.add_data_validation(dv_proj_status); dv_proj_status.sqref = "N3:N14"

    ws.row_dimensions[15].height = 26
    tl = ws.cell(row=15, column=1, value="ΣΥΝΟΛΟ ΟΛΩΝ")
    tl.fill = F(LIGHT_BLUE); tl.font = Fnt(size=11, bold=True); tl.alignment = Aln(h="left")
    for col, letter in [(2, "B"), (3, "C"), (4, "D"), (5, "E"), (6, "F"), (7, "G"), (8, "H"), (9, "I"), (10, "J"), (11, "K")]:
        sc = ws.cell(row=15, column=col, value=f'=SUM({letter}3:{letter}14)')
        sc.number_format = EUR0; sc.font = Fnt(size=11, bold=True, color=DARK_BLUE)
        sc.alignment = Aln(h="right"); sc.fill = F(LIGHT_BLUE)

    ws.merge_cells("A17:K17")
    c = ws.cell(row=17, column=1,
                value="  Συμβουλή: Γράψτε ένα όνομα έργου εδώ (έως 12), μετά επιλέξτε το από τη λίστα στη στήλη «Έργο» των Κινήσεων — τα σύνολα ενημερώνονται αυτόματα, μαζί με τα επαναλαμβανόμενα/πάγια έξοδα που έχετε ετικετάρει σε αυτό το έργο. Η στήλη «Ληξιπρόθεσμο» δείχνει δόσεις που πέρασε η ημερομηνία τους χωρίς να έχουν καταχωρηθεί ως πληρωμένες στις Κινήσεις. Η στήλη «Έσοδα» δείχνει όλα τα έσοδα που έχουν καταχωρηθεί για το έργο (π.χ. εκταμιεύσεις δανείων, αμοιβές πελατών) — και οι στήλες «Έσοδα Εισπραγμένα»/«Έσοδα Αναμενόμενα» δείχνουν πόσο από αυτό είναι ήδη στο χέρι έναντι πόσο εκκρεμεί (π.χ. δάνειο που δεν έχει ακόμα εγκριθεί).")
    c.font = Fnt(size=10, italic=True, color="FF6B7280")
    c.fill = F("FFF6F8FA"); c.alignment = Aln(h="left", wrap=True)
    ws.row_dimensions[17].height = 32

    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_area = "A1:N17"

    # ══════════════════════════════════════════════════════════════════════════
    # TAB: ΠΡΟΫΠΟΛΟΓΙΣΜΟΙ  (budget-vs-actual per project, one column per project
    # + a live, project-agnostic monthly actuals table — everything sourced
    # from Table_Kin, no separate data source, no project singled out) ──
    # ══════════════════════════════════════════════════════════════════════════
    ws = ws_bud
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 34
    for j in range(12):
        ws.column_dimensions[get_column_letter(2 + j)].width = 16
    ws.column_dimensions[get_column_letter(14)].width = 16   # ΣΥΝΟΛΟ
    ws.freeze_panes = "B4"

    ws.row_dimensions[1].height = 34
    ws.merge_cells("A1:N1")
    # title banner grows a 2nd line for the narrative intro instead of
    # touching row 2 — row 2 here is a live formula helper (every SUMIFS on
    # this sheet filters against it) and row 3 is the project-header row,
    # so there is no blank spacer beneath the title to reuse safely.
    ws.row_dimensions[1].height = 48
    c = ws.cell(row=1, column=1, value=CellRichText(
        TextBlock(InlineFont(rFont="Calibri", b=True, sz="14", color="FFFFFFFF"), "  ΠΡΟΫΠΟΛΟΓΙΣΜΟΙ\n"),
        TextBlock(InlineFont(rFont="Calibri", i=True, sz="9", color="FFC9D3DE"),
                  "  Μία στήλη ανά έργο. Συμπληρώνετε μόνο τα κίτρινα κελιά — τα υπόλοιπα υπολογίζονται μόνα "
                  "τους και τα «δαπανηθέντα» έρχονται ζωντανά από τις Κινήσεις."),
    ))
    c.fill = F(DARK_BLUE); c.font = Fnt(size=14, bold=True, color=WHITE)
    c.alignment = Aln(h="left", v="center", wrap=True)

    # row 2 is a hidden-by-height (8px) helper row holding the raw project
    # CODE per column — every SUMIFS below filters Table_Kin[Έργο] against
    # THIS row, not row 3. Row 3 shows the friendly display name instead
    # (readable header), but Table_Kin only ever stores the code, so
    # filtering against the display name silently matched nothing and
    # every Budget-vs-Actual total read as 0.
    ws.row_dimensions[2].height = 8
    for ci in range(1, 15): ws.cell(row=2, column=ci).fill = F(WHITE)

    # 12 slots, matching \'3. Έργα\'!A3:A14 exactly (not just the 6 projects that
    # happen to be filled in today) — column headers below are FORMULAS
    # reading Έργα live, so typing a new project directly into Έργα gives it
    # a Προϋπολογισμοί column immediately, no regenerate needed. The first
    # len(proj_base) slots line up with the known real projects (so their
    # manual budget/timeline/lease figures below can still be seeded); the
    # rest start blank, ready for the user to fill in.
    BUD_SLOTS = 12
    BUD_LAST_COL = 1 + BUD_SLOTS + 1   # A + 12 projects + ΣΥΝΟΛΟ = 14
    bud_col_letters = [get_column_letter(2 + j) for j in range(BUD_SLOTS)]
    slot_codes = [proj_base[j] if j < len(proj_base) else None for j in range(BUD_SLOTS)]

    for j in range(BUD_SLOTS):
        codec = ws.cell(row=2, column=2 + j, value=f'=IF(\'3. Έργα\'!A{3 + j}="","",\'3. Έργα\'!A{3 + j})')
        codec.font = Fnt(size=1, color=WHITE)

    ws.row_dimensions[3].height = 24
    hc = ws.cell(row=3, column=1, value="")
    hc.fill = F(DARK_BLUE)
    for j in range(BUD_SLOTS):
        hc = ws.cell(row=3, column=2 + j, value=f'=IF(\'3. Έργα\'!A{3 + j}="","",\'3. Έργα\'!L{3 + j})')
        hc.fill = F(DARK_BLUE); hc.font = Fnt(size=9, bold=True, color=WHITE)
        hc.alignment = Aln(h="center", v="center", wrap=True)
    hc = ws.cell(row=3, column=BUD_LAST_COL, value=t("ΣΥΝΟΛΟ", "TOTAL"))
    hc.fill = F(DARK_BLUE); hc.font = Fnt(size=9, bold=True, color=WHITE)
    hc.alignment = Aln(h="center", v="center")

    def _bud_sec(row, text):
        ws.row_dimensions[row].height = 22
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=BUD_LAST_COL)
        c = ws.cell(row=row, column=1, value="  " + text)
        c.fill = F(LIGHT_GREY); c.font = Fnt(size=10, bold=True, color=DARK_BLUE)
        c.alignment = Aln(h="left", v="center")
        c.border = Border()

    def _bud_label(row, text, bold=False):
        lc = ws.cell(row=row, column=1, value=text)
        lc.fill = F(LIGHT_GREY if not bold else LIGHT_BLUE)
        lc.font = Fnt(size=10, bold=bold, color=DARK_BLUE if bold else "FF374151")
        lc.alignment = Aln(h="left", v="center", wrap=True)
        return lc

    def _bud_input(row, col, value, fmt=None):
        cc = ws.cell(row=row, column=col, value=value)
        cc.fill = F(YELLOW); cc.alignment = Aln(h="right" if fmt else "center")
        cc.font = Fnt(size=10)
        if fmt: cc.number_format = fmt
        return cc

    def _bud_formula(row, col, formula, fmt=EUR0, bold=False, color=None):
        cc = ws.cell(row=row, column=col, value=formula)
        cc.fill = F(WHITE); cc.alignment = Aln(h="right", v="center")
        cc.font = Fnt(size=10, bold=bold, color=(color or "FF374151"))
        if fmt: cc.number_format = fmt
        return cc

    def _bud_total_row(row, fmt=EUR0):
        first_l, last_l = get_column_letter(2), get_column_letter(1 + BUD_SLOTS)
        cc = ws.cell(row=row, column=BUD_LAST_COL, value=f"=SUM({first_l}{row}:{last_l}{row})")
        cc.fill = F(LIGHT_BLUE); cc.alignment = Aln(h="right", v="center")
        cc.font = Fnt(size=10, bold=True, color=DARK_BLUE)
        if fmt: cc.number_format = fmt
        return cc

    # ── ΤΑΥΤΟΤΗΤΑ ──
    _bud_sec(4, t("ΤΑΥΤΟΤΗΤΑ ΕΡΓΟΥ", "PROJECT IDENTITY"))
    _bud_label(5, t("Μοντέλο", "Model"))
    models = {
        "Q001_ILIOUPOLI_P15_RESIDENCES": t("Ιδιόκτητη Ανάπτυξη", "Owned Development"),
        "Q002_VOULIAGMENI_309": t("Έργο Πελάτη", "Client Project"),
        "Q003_LAZARAKI32_GLYFADA": t("Ξενοδοχείο / Μίσθωση", "Hotel / Lease"),
        "Q004_AGIOU_KWNSTANTINOU20_GLYFADA": t("Ξενοδοχείο / Μίσθωση", "Hotel / Lease"),
        "Q005_LEGRENA": "",
        "Q000_GENERAL": t("Γενικά", "General"),
    }
    for j, code in enumerate(slot_codes):
        cc = ws.cell(row=5, column=2 + j, value=models.get(code, ""))
        cc.fill = F(WHITE); cc.alignment = Aln(h="center", v="center", wrap=True); cc.font = Fnt(size=10)
    ws.cell(row=5, column=BUD_LAST_COL).fill = F(LIGHT_GREY)

    _bud_label(6, t("Μονάδες", "Units"))
    units = {"Q001_ILIOUPOLI_P15_RESIDENCES": 4, "Q003_LAZARAKI32_GLYFADA": 21, "Q004_AGIOU_KWNSTANTINOU20_GLYFADA": 1}
    for j, code in enumerate(slot_codes):
        cc = ws.cell(row=6, column=2 + j, value=units.get(code))
        cc.fill = F(WHITE); cc.alignment = Aln(h="center", v="center"); cc.font = Fnt(size=10)
    _bud_total_row(6, fmt="#,##0")

    spacer(ws, 7, 6)

    # ── ΠΡΟΫΠΟΛΟΓΙΣΜΟΣ ──
    _bud_sec(8, t("ΠΡΟΫΠΟΛΟΓΙΣΜΟΣ", "BUDGET"))
    budget_rows = [
        (t("Απόκτηση / δικαιώματα μίσθωσης", "Acquisition / lease rights"),
         {"Q001_ILIOUPOLI_P15_RESIDENCES": 137276, "Q003_LAZARAKI32_GLYFADA": 116768.56}),
        (t("Μελέτες, άδειες, νομικά", "Studies, permits, legal"),
         {"Q001_ILIOUPOLI_P15_RESIDENCES": 33050, "Q003_LAZARAKI32_GLYFADA": 41743.68,
          "Q004_AGIOU_KWNSTANTINOU20_GLYFADA": 15217.78}),
        (t("Κατασκευή & εξοπλισμός", "Construction & equipment"),
         {"Q001_ILIOUPOLI_P15_RESIDENCES": 564483, "Q003_LAZARAKI32_GLYFADA": 1841487.76,
          "Q004_AGIOU_KWNSTANTINOU20_GLYFADA": 90000}),
        (t("Λοιπά κόστη", "Other costs"),
         # Q004: 55000 added — missing from this row entirely before. Per
         # Επιχειρησιακό_Αρχείο_107.xlsx Προϋπολογισμοί row 16 (Λοιπά κόστη)
         # and corroborated by its own Q004 Αγ Κωνσταντίνου sheet row 18
         # ("Έξοδα προ-έναρξης (προσωπικό, marketing)" = 55000).
         {"Q001_ILIOUPOLI_P15_RESIDENCES": 143408, "Q004_AGIOU_KWNSTANTINOU20_GLYFADA": 55000}),
    ]
    for i, (label, values) in enumerate(budget_rows):
        row = 9 + i
        _bud_label(row, label)
        for j, code in enumerate(slot_codes):
            _bud_input(row, 2 + j, values.get(code), EUR0)
        _bud_total_row(row)
    BUD_ITEMS_FIRST, BUD_ITEMS_LAST = 9, 8 + len(budget_rows)

    CONTINGENCY_ROW = BUD_ITEMS_LAST + 1
    _bud_label(CONTINGENCY_ROW, t("Απρόβλεπτα (%)", "Contingency (%)"))
    # Q003/Q004 used to sit at exactly 0% while every other project carries
    # 5-10% — on the two BIGGEST construction budgets in the file (Λαζαράκη
    # ~€2M, Αγ. Κωνσταντίνου), a bank reviewing this reads a literal zero as
    # "no contingency planned", not "not filled in yet". 8% is a flagged
    # placeholder in the middle of the range used elsewhere here — replace
    # with your real number once you have one.
    contingency_pct = {"Q001_ILIOUPOLI_P15_RESIDENCES": 0.05, "Q002_VOULIAGMENI_309": 0.10,
                        "Q003_LAZARAKI32_GLYFADA": 0.08, "Q004_AGIOU_KWNSTANTINOU20_GLYFADA": 0.08,
                        "Q005_LEGRENA": 0.10}
    for j, code in enumerate(slot_codes):
        _bud_input(CONTINGENCY_ROW, 2 + j, contingency_pct.get(code), "0%")
    ws.cell(row=CONTINGENCY_ROW, column=BUD_LAST_COL).fill = F(LIGHT_GREY)

    TOTAL_BUDGET_ROW = CONTINGENCY_ROW + 1
    _bud_label(TOTAL_BUDGET_ROW, t("ΣΥΝΟΛΙΚΟΣ ΠΡΟΫΠΟΛΟΓΙΣΜΟΣ", "TOTAL BUDGET"), bold=True)
    for j, col_l in enumerate(bud_col_letters):
        _bud_formula(TOTAL_BUDGET_ROW, 2 + j,
            f'=SUM({col_l}{BUD_ITEMS_FIRST}:{col_l}{BUD_ITEMS_LAST})*(1+IF({col_l}{CONTINGENCY_ROW}="",0,{col_l}{CONTINGENCY_ROW}))',
            bold=True, color=DARK_BLUE)
    _bud_total_row(TOTAL_BUDGET_ROW)

    SCENARIO_BUDGET_ROW = TOTAL_BUDGET_ROW + 1
    _bud_label(SCENARIO_BUDGET_ROW, t("— ΣΕΝΑΡΙΟ (βλ. Ρυθμίσεις)", "— SCENARIO (see Ρυθμίσεις)"))
    for j, col_l in enumerate(bud_col_letters):
        _bud_formula(SCENARIO_BUDGET_ROW, 2 + j,
            f'=IF({col_l}{TOTAL_BUDGET_ROW}="","",{col_l}{TOTAL_BUDGET_ROW}*ScenarioCostFactor)',
            color="FF965800")
    _bud_total_row(SCENARIO_BUDGET_ROW)

    PAID_ROW = SCENARIO_BUDGET_ROW + 1
    _bud_label(PAID_ROW, t("Πληρωμένα μέχρι σήμερα", "Paid to date"))
    for j, col_l in enumerate(bud_col_letters):
        hdr_ref = f"{col_l}$2"
        _bud_formula(PAID_ROW, 2 + j,
            f'=IF({hdr_ref}="","",SUMIFS(Table_Kin[{H_PAIDTOTAL}],Table_Kin[{H_PROJECT}],{hdr_ref},Table_Kin[{H_TYPE}],"{TYPE_EXP}"))',
            color=GREEN_FG)
    _bud_total_row(PAID_ROW)

    COMMITTED_ROW = PAID_ROW + 1
    _bud_label(COMMITTED_ROW, t("Δεσμευμένα & εκκρεμή", "Committed & outstanding"))
    for j, col_l in enumerate(bud_col_letters):
        hdr_ref = f"{col_l}$2"
        _bud_formula(COMMITTED_ROW, 2 + j,
            f'=IF({hdr_ref}="","",SUMIFS(Table_Kin[{H_REMAINING}],Table_Kin[{H_PROJECT}],{hdr_ref},Table_Kin[{H_TYPE}],"{TYPE_EXP}"))',
            color="FF965800")
    _bud_total_row(COMMITTED_ROW)

    # both use the SCENARIO-adjusted total (row below TOTAL_BUDGET_ROW), not
    # the base one — Μισθώματα & Αποδόσεις (φύλλο 13) already reads the
    # scenario row for its own "Investment" figure, so these two need to
    # agree with it instead of quietly tracking a different "cost of
    # project" number that never moves when you change Σενάριο.
    REMAIN_ROW = COMMITTED_ROW + 1
    _bud_label(REMAIN_ROW, t("ΑΠΡΟΫΠΟΛΟΓΙΣΤΟ ΥΠΟΛΟΙΠΟ (Σενάριο)", "UNBUDGETED REMAINDER (Scenario)"), bold=True)
    for j, col_l in enumerate(bud_col_letters):
        _bud_formula(REMAIN_ROW, 2 + j,
            f"=IF({col_l}{SCENARIO_BUDGET_ROW}=0,\"\",{col_l}{SCENARIO_BUDGET_ROW}-{col_l}{PAID_ROW}-{col_l}{COMMITTED_ROW})",
            bold=True, color=DARK_BLUE)
    _bud_total_row(REMAIN_ROW)

    PCT_ROW = REMAIN_ROW + 1
    _bud_label(PCT_ROW, t("Ποσοστό ολοκλήρωσης δαπανών (Σενάριο)", "Spend completion % (Scenario)"))
    for j, col_l in enumerate(bud_col_letters):
        _bud_formula(PCT_ROW, 2 + j,
            f"=IF({col_l}{SCENARIO_BUDGET_ROW}=0,\"\",{col_l}{PAID_ROW}/{col_l}{SCENARIO_BUDGET_ROW})",
            fmt="0,0%", color="FF6B7280")

    spacer(ws, PCT_ROW + 1, 6)

    # ── ΧΡΟΝΟΔΙΑΓΡΑΜΜΑ ──
    TL_HDR = PCT_ROW + 2
    _bud_sec(TL_HDR, t("ΧΡΟΝΟΔΙΑΓΡΑΜΜΑ", "TIMELINE"))
    timeline_rows = [
        (t("Έναρξη εργασιών", "Works start"), {"Q003_LAZARAKI32_GLYFADA": datetime.date(2026, 10, 1)}),
        (t("Λήξη κατασκευής / Άνοιγμα", "Construction end / Opening"),
         {"Q003_LAZARAKI32_GLYFADA": datetime.date(2027, 7, 31), "Q004_AGIOU_KWNSTANTINOU20_GLYFADA": datetime.date(2026, 11, 30)}),
        # new row, additive — Επιχειρησιακό_Αρχείο_107.xlsx Προϋπολογισμοί
        # rows 26/27 track "Λήξη κατασκευής" and "Άνοιγμα / πρώτη πώληση" as
        # two DISTINCT dates per project; the row above only carries the
        # construction-end date, so this adds the separate opening date
        # rather than overloading/renaming the existing row.
        (t("Άνοιγμα / Πρώτη πώληση", "Opening / First sale"),
         {"Q003_LAZARAKI32_GLYFADA": datetime.date(2027, 9, 1), "Q004_AGIOU_KWNSTANTINOU20_GLYFADA": datetime.date(2026, 12, 1)}),
        (t("Έναρξη πληρωμής μισθώματος", "Rent payments start"), {"Q003_LAZARAKI32_GLYFADA": datetime.date(2027, 9, 1)}),
    ]
    for i, (label, values) in enumerate(timeline_rows):
        row = TL_HDR + 1 + i
        _bud_label(row, label)
        for j, code in enumerate(slot_codes):
            cc = _bud_input(row, 2 + j, values.get(code))
            if values.get(code): cc.number_format = "DD/MM/YYYY"
        ws.cell(row=row, column=BUD_LAST_COL).fill = F(LIGHT_GREY)
    spacer(ws, TL_HDR + 1 + len(timeline_rows), 6)

    # ── ΜΙΣΘΩΣΗ (lease terms — Q003/Q004 only) ──
    LEASE_HDR = TL_HDR + 2 + len(timeline_rows)
    _bud_sec(LEASE_HDR, t("ΜΙΣΘΩΣΗ", "LEASE"))
    lease_rows = [
        (t("Μηνιαίο μίσθωμα (έτος 1)", "Monthly rent (year 1)"),
         {"Q003_LAZARAKI32_GLYFADA": 6000, "Q004_AGIOU_KWNSTANTINOU20_GLYFADA": 750}, EUR0),
        (t("Ετήσια αναπροσαρμογή", "Annual escalation"),
         {"Q003_LAZARAKI32_GLYFADA": 0.035, "Q004_AGIOU_KWNSTANTINOU20_GLYFADA": 0}, "0,0%"),
        (t("Διάρκεια μίσθωσης (έτη)", "Lease term (years)"),
         {"Q003_LAZARAKI32_GLYFADA": 23, "Q004_AGIOU_KWNSTANTINOU20_GLYFADA": 16}, "#,##0"),
        (t("Έτος έναρξης μίσθωσης", "Lease start year"),
         {"Q003_LAZARAKI32_GLYFADA": 2027, "Q004_AGIOU_KWNSTANTINOU20_GLYFADA": 2026}, "#,##0"),
        # Q004's lease is stepped, not compounded — flat rent with two fixed
        # bumps (confirmed against the Q004 Αγ Κωνσταντίνου detail sheet in
        # Επιχειρησιακό_Αρχείο_107.xlsx), unlike Q003's smooth 3.5%/year
        # escalation above. Q003 gets 0 here so its formula is unaffected.
        (t("Προσαύξηση έτους 11 (μηνιαίως)", "Year-11 step-up (monthly)"),
         {"Q003_LAZARAKI32_GLYFADA": 0, "Q004_AGIOU_KWNSTANTINOU20_GLYFADA": 550}, EUR0),
        (t("Προσαύξηση έτους 14 (μηνιαίως)", "Year-14 step-up (monthly)"),
         {"Q003_LAZARAKI32_GLYFADA": 0, "Q004_AGIOU_KWNSTANTINOU20_GLYFADA": 400}, EUR0),
    ]
    for i, (label, values, fmt) in enumerate(lease_rows):
        row = LEASE_HDR + 1 + i
        _bud_label(row, label)
        for j, code in enumerate(slot_codes):
            _bud_input(row, 2 + j, values.get(code), fmt)
        ws.cell(row=row, column=BUD_LAST_COL).fill = F(LIGHT_GREY)
    spacer(ws, LEASE_HDR + 1 + len(lease_rows), 6)

    # ── ΤΑΜΕΙΑΚΗ ΑΝΑΓΚΗ ──
    CASH_HDR = LEASE_HDR + 2 + len(lease_rows)
    _bud_sec(CASH_HDR, t("ΤΑΜΕΙΑΚΗ ΑΝΑΓΚΗ", "CASH NEED"))

    REQUIRED_ROW = CASH_HDR + 1
    _bud_label(REQUIRED_ROW, t("Απαιτούμενο κεφάλαιο μέχρι το άνοιγμα", "Capital required to opening"))
    required_capital = {"Q001_ILIOUPOLI_P15_RESIDENCES": 823001.38, "Q003_LAZARAKI32_GLYFADA": 1983256.32,
                         "Q004_AGIOU_KWNSTANTINOU20_GLYFADA": 90000}
    for j, code in enumerate(slot_codes):
        _bud_input(REQUIRED_ROW, 2 + j, required_capital.get(code), EUR0)
    _bud_total_row(REQUIRED_ROW)

    OWN_ROW = REQUIRED_ROW + 1
    _bud_label(OWN_ROW, t("Ίδια συμμετοχή", "Own equity"))
    own_equity = {"Q003_LAZARAKI32_GLYFADA": 400000}
    for j, code in enumerate(slot_codes):
        _bud_input(OWN_ROW, 2 + j, own_equity.get(code), EUR0)
    _bud_total_row(OWN_ROW)

    # a €400k equity line with no date attached never actually reached
    # Ταμείο — the loan side had real dated tranches on Κινήσεις, but
    # equity had no equivalent, so the cash forecast modeled the
    # construction spend and the loan funding but silently left the
    # third financing source out of the cash timeline entirely. Blank by
    # default (no real date is known) rather than guessed — Ταμείο below
    # only injects it once a real date is typed in here.
    OWN_DATE_ROW = OWN_ROW + 1
    _bud_label(OWN_DATE_ROW, t("Ημερομηνία Ίδιας Συμμετοχής (συμπληρώστε όταν οριστεί)", "Own Equity Injection Date (fill in once known)"))
    for j, code in enumerate(slot_codes):
        _bud_input(OWN_DATE_ROW, 2 + j, None, "DD/MM/YYYY")
    ws.cell(row=OWN_DATE_ROW, column=BUD_LAST_COL).fill = F(LIGHT_GREY)
    wb.defined_names["OwnEquityDates"] = DefinedName(
        "OwnEquityDates", attr_text=f"'4. Προϋπολογισμοί'!${bud_col_letters[0]}${OWN_DATE_ROW}:${bud_col_letters[-1]}${OWN_DATE_ROW}")
    wb.defined_names["OwnEquityAmounts"] = DefinedName(
        "OwnEquityAmounts", attr_text=f"'4. Προϋπολογισμοί'!${bud_col_letters[0]}${OWN_ROW}:${bud_col_letters[-1]}${OWN_ROW}")

    LOAN_ROW = OWN_DATE_ROW + 1
    _bud_label(LOAN_ROW, t("Δανειακή χρηματοδότηση (Κατηγορία=Δάνειο — δείτε Έργα για Εισπραγμένα/Αναμενόμενα)",
                            "Loan financing (Category=Loan — see Έργα for Received/Pending)"))
    for j, col_l in enumerate(bud_col_letters):
        hdr_ref = f"{col_l}$2"
        # Κατηγορία="Δάνειο" — NOT every income row for the project. This
        # used to sum ALL income (client fees included), so a paid invoice
        # shrank the reported financing gap exactly like a loan drawdown
        # would have. Tag any future loan-drawdown row with Κατηγορία=Δάνειο
        # on Κινήσεις for it to count here.
        _bud_formula(LOAN_ROW, 2 + j,
            f'=IF({hdr_ref}="","",SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_PROJECT}],{hdr_ref},Table_Kin[{H_TYPE}],"{TYPE_INC}",Table_Kin[{H_CATEGORY}],"{CAT_LOAN}"))',
            color=GREEN_FG)
    _bud_total_row(LOAN_ROW)

    GAP_ROW = LOAN_ROW + 1
    _bud_label(GAP_ROW, t("ΧΡΗΜΑΤΟΔΟΤΙΚΟ ΚΕΝΟ", "FINANCING GAP"), bold=True)
    for j, col_l in enumerate(bud_col_letters):
        _bud_formula(GAP_ROW, 2 + j,
            f"=IF({col_l}{REQUIRED_ROW}=0,\"\",{col_l}{REQUIRED_ROW}-{col_l}{OWN_ROW}-{col_l}{LOAN_ROW})",
            bold=True, color="FF965800")
    _bud_total_row(GAP_ROW)
    wb.defined_names["TotalFinancingGap"] = DefinedName(
        "TotalFinancingGap", attr_text=f"'4. Προϋπολογισμοί'!${get_column_letter(BUD_LAST_COL)}${GAP_ROW}")

    spacer(ws, GAP_ROW + 1, 6)

    BUD_TIP_ROW = GAP_ROW + 2
    ws.merge_cells(start_row=BUD_TIP_ROW, start_column=1, end_row=BUD_TIP_ROW, end_column=BUD_LAST_COL)
    c = ws.cell(row=BUD_TIP_ROW, column=1,
                value="  " + t("Συμβουλή: Τα κίτρινα κελιά είναι χειροκίνητα (προϋπολογισμός, χρονοδιάγραμμα, μίσθωση) — τα λευκά υπολογίζονται αυτόματα από τις Κινήσεις. Δεν υπάρχει στήλη Q003-only P&L εδώ επίτηδες: μόνο το Q003 έχει σήμερα αναλυτικό μοντέλο εσόδων, οπότε ξεχωριστή στήλη θα ήταν παραπλανητική για τα υπόλοιπα έργα.",
                          "Tip: Yellow cells are manual (budget, timeline, lease) — white cells calculate automatically from Κινήσεις. There's deliberately no Q003-only P&L row here: only Q003 currently has a detailed revenue model, so a dedicated column would be misleading for the other projects."))
    c.font = Fnt(size=10, italic=True, color="FF6B7280")
    c.fill = F("FFF6F8FA"); c.alignment = Aln(h="left", wrap=True)
    ws.row_dimensions[BUD_TIP_ROW].height = 40

    # ── ΜΗΝΙΑΙΑ ΑΝΑΛΥΣΗ ΚΙΝΗΣΕΩΝ ΑΝΑ ΕΡΓΟ — project-agnostic, live, drillable ──
    MON_HDR = BUD_TIP_ROW + 2
    _bud_sec(MON_HDR, t("ΜΗΝΙΑΙΑ ΑΝΑΛΥΣΗ ΚΙΝΗΣΕΩΝ ΑΝΑ ΕΡΓΟ", "MONTHLY TRANSACTION ANALYSIS BY PROJECT"))

    SEL_ROW = MON_HDR + 1
    ws.row_dimensions[SEL_ROW].height = 24
    lc = ws.cell(row=SEL_ROW, column=1, value=t("Επιλογή Έργου", "Select Project"))
    lc.fill = F(LIGHT_BLUE); lc.font = Fnt(size=10, bold=True, color=DARK_BLUE); lc.alignment = Aln(h="left", v="center")
    sel = ws.cell(row=SEL_ROW, column=2, value=proj_base[0])
    sel.fill = F(YELLOW); sel.font = Fnt(size=11, bold=True); sel.alignment = Aln(h="left", v="center")
    dv_bud_proj = DataValidation(type="list", formula1="\'3. Έργα\'!$A$3:$A$14", allow_blank=True, showDropDown=False)
    ws.add_data_validation(dv_bud_proj); dv_bud_proj.sqref = f"B{SEL_ROW}"
    SEL_CELL = f"$B${SEL_ROW}"
    ws.merge_cells(start_row=SEL_ROW, start_column=3, end_row=SEL_ROW, end_column=BUD_LAST_COL)
    note = ws.cell(row=SEL_ROW, column=3,
                   value=t("← επιλέξτε οποιοδήποτε έργο, ο πίνακας παρακάτω ενημερώνεται αυτόματα",
                            "← pick any project, the table below updates automatically"))
    note.fill = F(WHITE); note.font = Fnt(size=9, italic=True, color="FF6B7280"); note.alignment = Aln(h="left", v="center")

    MON_TBL_HDR = SEL_ROW + 2
    ws.row_dimensions[MON_TBL_HDR].height = 20
    mon_headers = [t("Μήνας", "Month"), t("Έσοδα", "Income"), t("Έξοδα", "Expenses"),
                   t("ΦΠΑ Εσόδων", "VAT Income"), t("ΦΠΑ Εξόδων", "VAT Expenses"),
                   t("Καθαρό", "Net"), t("Πληρωμένα", "Paid"), t("Εκκρεμή", "Outstanding")]
    for ci, h in enumerate(mon_headers, 1):
        col_hdr(ws, MON_TBL_HDR, ci, h)

    MON_FIRST = MON_TBL_HDR + 1
    MONTHS_BACK, MONTHS_FWD = 6, 17   # 24-month rolling window centred just after today
    for i in range(MONTHS_BACK + MONTHS_FWD):
        row = MON_FIRST + i
        offset = i - MONTHS_BACK
        ws.row_dimensions[row].height = 18
        edate = f"EDATE(TODAY(),{offset})"
        mc = ws.cell(row=row, column=1, value=f'=YEAR({edate})&"-"&TEXT(MONTH({edate}),"00")')
        mc.fill = F(LIGHT_GREY); mc.alignment = Aln(h="center", v="center"); mc.font = Fnt(size=9, bold=True, color=DARK_BLUE)
        mref = f"$A{row}"
        inc = ws.cell(row=row, column=2, value=f'={_recur_monthly(H_AMOUNT, TYPE_INC, mref, project_ref=SEL_CELL)}')
        exp = ws.cell(row=row, column=3, value=f'={_recur_monthly(H_AMOUNT, TYPE_EXP, mref, project_ref=SEL_CELL)}')
        vin = ws.cell(row=row, column=4, value=f'={_recur_monthly(H_VAT, TYPE_INC, mref, project_ref=SEL_CELL)}')
        vex = ws.cell(row=row, column=5, value=f'={_recur_monthly(H_VAT, TYPE_EXP, mref, project_ref=SEL_CELL)}')
        net = ws.cell(row=row, column=6, value=f"=B{row}-C{row}")
        pd_ = ws.cell(row=row, column=7,
            value=f'={_recur_monthly(H_AMOUNT, TYPE_EXP, mref, project_ref=SEL_CELL, mode="paid")}')
        up = ws.cell(row=row, column=8,
            value=f'={_recur_monthly(H_AMOUNT, TYPE_EXP, mref, project_ref=SEL_CELL, mode="outstanding")}')
        for cc in (inc, exp, vin, vex, pd_, up):
            cc.number_format = EUR0; cc.alignment = Aln(h="right"); cc.fill = F(WHITE); cc.font = Fnt(size=9)
        net.number_format = EUR0; net.alignment = Aln(h="right"); net.fill = F(LIGHT_BLUE)
        net.font = Fnt(size=9, bold=True, color=DARK_BLUE)
    MON_LAST = MON_FIRST + MONTHS_BACK + MONTHS_FWD - 1

    MON_TIP_ROW = MON_LAST + 2
    ws.merge_cells(start_row=MON_TIP_ROW, start_column=1, end_row=MON_TIP_ROW, end_column=BUD_LAST_COL)
    c = ws.cell(row=MON_TIP_ROW, column=1,
                value="  " + t("Κυλιόμενο παράθυρο 24 μηνών (6 πίσω, 17 μπρος από σήμερα). Για ανάλυση ανά ημέρα: χρησιμοποιήστε το PivotTable στο «Ελεύθερη Ανάλυση» — ομαδοποιήστε την Ημερομηνία σε Ημέρες + Μήνες και φιλτράρετε με το slicer «Έργο».",
                          "Rolling 24-month window (6 back, 17 forward from today). For day-level analysis: use the PivotTable on “Ελεύθερη Ανάλυση” — group the Date field into Days + Months and filter with the “Έργο” slicer."))
    c.font = Fnt(size=10, italic=True, color="FF6B7280")
    c.fill = F("FFF6F8FA"); c.alignment = Aln(h="left", wrap=True)
    ws.row_dimensions[MON_TIP_ROW].height = 32

    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_area = f"A1:{get_column_letter(BUD_LAST_COL)}{MON_TIP_ROW}"

    # ══════════════════════════════════════════════════════════════════════════
    # TAB: ΑΝΑΛΥΣΗ  (KPIs + month filter + monthly trend, all driven by Table_Kin)
    # ══════════════════════════════════════════════════════════════════════════
    ws = ws_an
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 3
    ws.column_dimensions["B"].width = 34
    ws.column_dimensions["C"].width = 18
    ws.column_dimensions["D"].width = 40
    ws.column_dimensions["H"].width = 12

    ALL_LABEL = "Όλοι οι μήνες"
    months = sorted({r["date"].strftime("%Y-%m") for r in aade_rows if r["date"]})

    ws.row_dimensions[1].height = 34
    ws.merge_cells("A1:D1")
    c = ws.cell(row=1, column=1, value="  ΑΝΑΛΥΣΗ")
    c.fill = F(DARK_BLUE); c.font = Fnt(size=14, bold=True, color=WHITE)
    c.alignment = Aln(h="left", v="center")

    # ── month filter, styled as a slicer-look card (caption bar in row 2 +
    # a prominent bordered value in row 3) even though underneath it's still
    # the exact same $B$3 dropdown cell driving the same SUMIFS formulas —
    # this is a pure visual restyle, not a real functional Slicer (a real
    # Slicer can only filter PivotTables/Tables, not arbitrary SUMIFS KPIs). ──
    ws.row_dimensions[2].height = 20
    for ci in (1, 3, 4):
        ws.cell(row=2, column=ci).fill = F(WHITE)
    cap = ws.cell(row=2, column=2, value="  " + t("ΜΗΝΑΣ", "MONTH"))
    cap.fill = F(DARK_BLUE); cap.font = Fnt(size=9, bold=True, color=WHITE)
    cap.alignment = Aln(h="left", v="center")

    # ── hidden helper list feeding the month dropdown ──
    hc = ws.cell(row=1, column=8, value=ALL_LABEL)
    hc.font = Fnt(size=9, color="FFFFFFFF")
    for i, m in enumerate(months):
        mc = ws.cell(row=2 + i, column=8, value=m)
        mc.font = Fnt(size=9, color="FFFFFFFF")
    month_list_ref = f"$H$1:$H${1 + len(months)}"

    ws.row_dimensions[3].height = 30
    ws.cell(row=3, column=1).fill = F(DARK_BLUE)
    fc = ws.cell(row=3, column=2, value=ALL_LABEL)
    fc.fill = F(YELLOW); fc.font = Fnt(size=13, bold=True, color=DARK_BLUE)
    fc.alignment = Aln(h="left", v="center")
    fc.border = Border(left=Side(style="medium", color="FF1A2F4A"), right=Side(style="medium", color="FF1A2F4A"),
                        top=Side(style="thin", color="FF1A2F4A"), bottom=Side(style="medium", color="FF1A2F4A"))
    lbl(ws, 3, 3, "", bg=WHITE)
    lbl(ws, 3, 4, "Επιλέξτε μήνα (YYYY-MM) ή «Όλοι οι μήνες» για τα KPIs παρακάτω", bg=WHITE)
    dv_month = DataValidation(type="list", formula1=month_list_ref, allow_blank=False, showDropDown=False)
    ws.add_data_validation(dv_month); dv_month.sqref = "B3"

    sheet_intro(ws, 4,
        "KPIs για τον μήνα που επιλέγετε πάνω — αλλάξτε το φίλτρο και όλοι οι αριθμοί από κάτω ενημερώνονται "
        "αμέσως. Χρήσιμο για να δείτε γρήγορα πώς πήγε ένας συγκεκριμένος μήνας, χωρίς να ψάχνετε μέσα στις Κινήσεις.",
        end_col="D")
    FILTER = "$B$3"

    def _an_metric(row, label, col_name, type_filter, note, **kw):
        if type_filter:
            all_f   = f'SUMIFS(Table_Kin[{col_name}],Table_Kin[{H_TYPE}],"{type_filter}")'
            month_f = f'SUMIFS(Table_Kin[{col_name}],Table_Kin[{H_TYPE}],"{type_filter}",Table_Kin[{H_MONTH}],{FILTER})'
        else:
            all_f   = f'SUM(Table_Kin[{col_name}])'
            month_f = f'SUMIFS(Table_Kin[{col_name}],Table_Kin[{H_MONTH}],{FILTER})'
        formula = f'=IF({FILTER}="{ALL_LABEL}",{all_f},{month_f})'
        mrow(ws, row, label, formula, note, value_fmt=EUR0, label_bg=LIGHT_GREY, value_bg=WHITE, **kw)

    sec_hdr(ws, 5, "KPIs — ΓΙΑ ΤΗΝ ΕΠΙΛΟΓΗ")
    spacer(ws, 6, 5, LIGHT_GREY)
    # headline = actually-received revenue, split three ways (Εισπραγμένα /
    # Τιμολογημένα / Υπό έγκριση, mapping straight onto the three real
    # Κατάσταση values) instead of one merged "Σύνολο Εσόδων" figure that's
    # mostly unconfirmed loan drawdowns — same fix already applied to
    # Κέντρο Ελέγχου's revenue tile this session, here without adding a row
    # (Ανάλυση's later sections all hardcode absolute row numbers off this
    # one, so the three figures share row 7: headline value + note text).
    def _an_rev_status(status):
        all_f = f'SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_TYPE}],"{TYPE_INC}",Table_Kin[{H_STATUS}],"{status}")'
        month_f = (f'SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_TYPE}],"{TYPE_INC}",Table_Kin[{H_STATUS}],"{status}",'
                   f'Table_Kin[{H_MONTH}],{FILTER})')
        return f'IF({FILTER}="{ALL_LABEL}",{all_f},{month_f})'
    _rev_paid, _rev_upcom, _rev_hold = _an_rev_status(S_PAID), _an_rev_status(S_UPCOM), _an_rev_status(S_HOLD)
    mrow(ws, 7, t("ΕΣΟΔΑ (Εισπραγμένα)", "REVENUE (Received)"), f'={_rev_paid}',
         t(f'="Τιμολογημένα: "&TEXT({_rev_upcom},"€#.##0")&"   Υπό έγκριση: "&TEXT({_rev_hold},"€#.##0")&"   — μην αθροίζετε ως έσοδα"',
           f'="Invoiced: €"&TEXT({_rev_upcom},"#.##0")&"   Pending approval: €"&TEXT({_rev_hold},"#.##0")&"   — don\'t sum these as revenue"'),
         value_fmt=EUR0, label_bg=LIGHT_GREY, value_bg=WHITE,
         value_bold=True, value_size=12, value_color=GREEN_FG)
    _an_metric(8, "Σύνολο Εξόδων", H_AMOUNT, TYPE_EXP,
               "Έξοδα για τον επιλεγμένο μήνα (ή όλους)",
               value_bold=True, value_size=12, value_color="FF7A3800")
    mrow(ws, 9, "Καθαρό Αποτέλεσμα", "=C7-C8",
         "Έσοδα μείον Έξοδα, για την ίδια περίοδο",
         value_fmt=EUR0, value_bold=True, value_size=14, value_color=DARK_BLUE,
         label_bg=LIGHT_BLUE, value_bg=LIGHT_BLUE, note_bg=LIGHT_BLUE, label_bold=True)
    _an_metric(10, "ΦΠΑ Εσόδων", H_VAT, TYPE_INC,
               "ΦΠΑ επί εσόδων της περιόδου", value_color="FF6B7280")
    _an_metric(11, "ΦΠΑ Εξόδων", H_VAT, TYPE_EXP,
               "ΦΠΑ επί εξόδων της περιόδου", value_color="FF6B7280")
    mrow(ws, 12, "Καθαρή Θέση ΦΠΑ", "=C10-C11",
         "Θετικό = οφειλή προς Εφορία για την περίοδο",
         value_fmt=EUR0, value_bold=True, value_size=12, value_color="FF965800",
         label_bg="FFFEF0D8", value_bg="FFFEF0D8", note_bg="FFFEF0D8")
    _an_metric(13, "Σύνολο Παρακράτησης", H_WITHHELD, None,
               "Παρακρατηθέντες φόροι της περιόδου", value_color="FF6B7280")
    mrow(ws, 14, "Πληρωμένα Έξοδα",
         (f'=IF({FILTER}="{ALL_LABEL}",SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_TYPE}],"{TYPE_EXP}",Table_Kin[{H_STATUS}],"{S_PAID}"),'
          f'SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_TYPE}],"{TYPE_EXP}",Table_Kin[{H_STATUS}],"{S_PAID}",Table_Kin[{H_MONTH}],{FILTER}))'),
         "Εκδοθέντα και πληρωμένα έξοδα της περιόδου",
         value_fmt=EUR0, value_color=GREEN_FG, label_bg=LIGHT_GREY, value_bg=WHITE)
    mrow(ws, 15, "Εκκρεμή Έξοδα",
         (f'=IF({FILTER}="{ALL_LABEL}",SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_TYPE}],"{TYPE_EXP}",Table_Kin[{H_STATUS}],"{S_UPCOM}"),'
          f'SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_TYPE}],"{TYPE_EXP}",Table_Kin[{H_STATUS}],"{S_UPCOM}",Table_Kin[{H_MONTH}],{FILTER}))'),
         "Εκκρεμή έξοδα της περιόδου",
         value_fmt=EUR0, value_color="FF7A3800", label_bg=LIGHT_GREY, value_bg=WHITE)
    mrow(ws, 16, "Αριθμός Κινήσεων",
         (f'=IF({FILTER}="{ALL_LABEL}",COUNTIF(Table_Kin[{H_TYPE}],"{TYPE_INC}")+COUNTIF(Table_Kin[{H_TYPE}],"{TYPE_EXP}"),'
          f'COUNTIFS(Table_Kin[{H_MONTH}],{FILTER},Table_Kin[{H_TYPE}],"{TYPE_INC}")+'
          f'COUNTIFS(Table_Kin[{H_MONTH}],{FILTER},Table_Kin[{H_TYPE}],"{TYPE_EXP}"))'),
         "Πλήθος κινήσεων της περιόδου", value_fmt="#,##0",
         value_color="FF6B7280", label_bg=LIGHT_GREY, value_bg=WHITE)
    spacer(ws, 17, 6)

    # ── ΑΝΑ ΕΡΓΟ — per-project breakdown, respecting the same B3 month filter ──
    proj_hdr = 18
    sec_hdr(ws, proj_hdr, "ΑΝΑ ΕΡΓΟ")
    spacer(ws, proj_hdr + 1, 5, LIGHT_GREY)

    def _an_proj_f(col_name, type_filter, pref):
        all_f = f'SUMIFS(Table_Kin[{col_name}],Table_Kin[{H_PROJECT}],{pref},Table_Kin[{H_TYPE}],"{type_filter}")'
        month_f = (f'SUMIFS(Table_Kin[{col_name}],Table_Kin[{H_PROJECT}],{pref},Table_Kin[{H_TYPE}],"{type_filter}",'
                   f'Table_Kin[{H_MONTH}],{FILTER})')
        return f'IF({FILTER}="{ALL_LABEL}",{all_f},{month_f})'

    _white_fill_an = PatternFill(start_color=WHITE, end_color=WHITE, fill_type="solid")
    _white_font_an = Font(name="Calibri", color="FFFFFFFF")
    _L_INC, _L_PD, _L_UP, _L_OV = t("Έσοδα", "Income"), t("Πληρ.", "Paid"), t("Εκκρ.", "Due"), t("Ληξιπρ.", "Overdue")

    for _pi in range(12):
        _pr = proj_hdr + 2 + _pi
        _pref = f"\'3. Έργα\'!$A${3 + _pi}"
        _pdisp = f"\'3. Έργα\'!$L${3 + _pi}"
        ws.row_dimensions[_pr].height = 22

        _bc = ws.cell(row=_pr, column=2, value=f'=IF({_pref}="","",{_pdisp})')
        _bc.fill = F(LIGHT_GREY); _bc.font = Fnt(size=11, bold=True, color=DARK_BLUE)
        _bc.alignment = Aln(h="left", v="center")

        _inc_f = _an_proj_f(H_AMOUNT, TYPE_INC, _pref)
        _exp_f = _an_proj_f(H_AMOUNT, TYPE_EXP, _pref)
        _vc = ws.cell(row=_pr, column=3, value=f'=IF({_pref}="","",({_inc_f})-({_exp_f}))')
        _vc.fill = F(WHITE); _vc.font = Fnt(size=12, bold=True, color=DARK_BLUE)
        _vc.alignment = Aln(h="right", v="center"); _vc.number_format = EUR0

        _pd_f = _an_proj_f(H_PAIDTOTAL, TYPE_EXP, _pref)
        _up_f = _an_proj_f(H_REMAINING, TYPE_EXP, _pref)
        _ov_f = _an_proj_f(H_OVERDUE_AMT, TYPE_EXP, _pref)
        _dc = ws.cell(row=_pr, column=4,
                      value=(f'=IF({_pref}="","","{_L_INC}: "&TEXT({_inc_f},"€#.##0")&"   '
                             f'{_L_PD}: "&TEXT({_pd_f},"€#.##0")&"   '
                             f'{_L_UP}: "&TEXT({_up_f},"€#.##0")&"   '
                             f'{_L_OV}: "&TEXT({_ov_f},"€#.##0"))'))
        _dc.fill = F(LIGHT_GREY); _dc.font = Fnt(size=10, italic=True, color="FF6B7280")
        _dc.alignment = Aln(h="left", v="center")

        ws.conditional_formatting.add(f"A{_pr}:D{_pr}",
            FormulaRule(formula=[f'{_pref}=""'], fill=_white_fill_an, font=_white_font_an))

    proj_total_row = proj_hdr + 14
    ws.row_dimensions[proj_total_row].height = 22
    _ptl = ws.cell(row=proj_total_row, column=2, value=t("ΣΥΝΟΛΟ ΟΛΩΝ ΕΡΓΩΝ", "TOTAL ALL PROJECTS"))
    _ptl.fill = F(LIGHT_BLUE); _ptl.font = Fnt(size=11, bold=True, color=DARK_BLUE); _ptl.alignment = Aln(h="left")
    _ptv = ws.cell(row=proj_total_row, column=3, value=f'=SUM(C{proj_hdr + 2}:C{proj_hdr + 13})')
    _ptv.fill = F(LIGHT_BLUE); _ptv.font = Fnt(size=12, bold=True, color=DARK_BLUE)
    _ptv.alignment = Aln(h="right", v="center"); _ptv.number_format = EUR0
    _ptd = ws.cell(row=proj_total_row, column=4,
                   value=t("Καθαρό αποτέλεσμα όλων των έργων για την επιλεγμένη περίοδο",
                            "Net result across all projects for the selected period"))
    _ptd.fill = F(LIGHT_BLUE); _ptd.font = Fnt(size=10, italic=True, color="FF6B7280")
    _ptd.alignment = Aln(h="left", v="center")
    spacer(ws, proj_total_row + 1, 6)

    # ── comparison vs previous month (depends on the B3 filter) ──
    PREV_CELL = "$J$3"
    prev_formula = (
        f'=IF({FILTER}="{ALL_LABEL}","",'
        f'YEAR(EDATE(DATE(VALUE(LEFT({FILTER},4)),VALUE(RIGHT({FILTER},2)),1),-1))&"-"&'
        f'TEXT(MONTH(EDATE(DATE(VALUE(LEFT({FILTER},4)),VALUE(RIGHT({FILTER},2)),1),-1)),"00"))'
    )
    pc = ws.cell(row=3, column=10, value=prev_formula)
    pc.font = Fnt(size=9, color="FFFFFFFF")

    cmp_hdr = proj_total_row + 2
    sec_hdr(ws, cmp_hdr, "ΣΥΓΚΡΙΣΗ ΜΕ ΠΡΟΗΓΟΥΜΕΝΟ ΜΗΝΑ")
    spacer(ws, cmp_hdr + 1, 5, LIGHT_GREY)
    mrow(ws, cmp_hdr + 2, "Προηγούμενος Μήνας", f'=IF({PREV_CELL}="","—",{PREV_CELL})',
         "Κενό όταν έχει επιλεγεί «Όλοι οι μήνες»",
         label_bg=LIGHT_GREY, value_bg=WHITE, value_bold=True)

    cmp_tbl_hdr = cmp_hdr + 4
    ws.row_dimensions[cmp_tbl_hdr].height = 20
    for ci, htxt in enumerate(["", "Τρέχων Μήνας", "Προηγ. Μήνας", "Διαφορά (Δ)", "Μεταβολή %"], 1):
        col_hdr(ws, cmp_tbl_hdr, ci, htxt)

    def _cmp_row(row, label, cur_ref, col_name, type_filter):
        prev_f = (f'IF({PREV_CELL}="","",SUMIFS(Table_Kin[{col_name}],Table_Kin[{H_TYPE}],'
                  f'"{type_filter}",Table_Kin[{H_MONTH}],{PREV_CELL}))')
        ws.row_dimensions[row].height = 20
        lc = ws.cell(row=row, column=1, value=label)
        lc.fill = F(LIGHT_GREY); lc.font = Fnt(size=10, bold=True); lc.alignment = Aln(h="left")
        cc = ws.cell(row=row, column=2, value=f'={cur_ref}')
        pv = ws.cell(row=row, column=3, value=f'=IF({prev_f}="","",{prev_f})')
        dl = ws.cell(row=row, column=4, value=f'=IF(C{row}="","",B{row}-C{row})')
        pct = ws.cell(row=row, column=5,
                       value=f'=IF(OR(C{row}="",C{row}=0),"",D{row}/C{row})')
        for cell in (cc, pv, dl):
            cell.number_format = EUR0; cell.alignment = Aln(h="right"); cell.fill = F(WHITE)
            cell.font = Fnt(size=10)
        pct.number_format = "+0,0%;-0,0%"; pct.alignment = Aln(h="right"); pct.fill = F(WHITE)
        pct.font = Fnt(size=10, bold=True)
        return row

    _cmp_row(cmp_tbl_hdr + 1, "Έσοδα", "C7", H_AMOUNT, TYPE_INC)
    _cmp_row(cmp_tbl_hdr + 2, "Έξοδα", "C8", H_AMOUNT, TYPE_EXP)
    net_cmp_row = cmp_tbl_hdr + 3
    ws.row_dimensions[net_cmp_row].height = 20
    lc = ws.cell(row=net_cmp_row, column=1, value="Καθαρό")
    lc.fill = F(LIGHT_BLUE); lc.font = Fnt(size=10, bold=True, color=DARK_BLUE); lc.alignment = Aln(h="left")
    cc = ws.cell(row=net_cmp_row, column=2, value="=C9")
    pv = ws.cell(row=net_cmp_row, column=3,
                 value=f'=IF(OR(C{cmp_tbl_hdr+1}="",C{cmp_tbl_hdr+2}=""),"",C{cmp_tbl_hdr+1}-C{cmp_tbl_hdr+2})')
    dl = ws.cell(row=net_cmp_row, column=4, value=f'=IF(C{net_cmp_row}="","",B{net_cmp_row}-C{net_cmp_row})')
    pct = ws.cell(row=net_cmp_row, column=5,
                   value=f'=IF(OR(C{net_cmp_row}="",C{net_cmp_row}=0),"",D{net_cmp_row}/C{net_cmp_row})')
    for cell in (cc, pv, dl):
        cell.number_format = EUR0; cell.alignment = Aln(h="right"); cell.fill = F(LIGHT_BLUE)
        cell.font = Fnt(size=10, bold=True, color=DARK_BLUE)
    pct.number_format = "+0,0%;-0,0%"; pct.alignment = Aln(h="right"); pct.fill = F(LIGHT_BLUE)
    pct.font = Fnt(size=10, bold=True, color=DARK_BLUE)
    spacer(ws, net_cmp_row + 1, 6)

    # ── tie-in with recurring/installment rows (Επαναλαμβανόμενο="Ναι" in Table_Kin) ──
    pag_kpi_hdr = net_cmp_row + 2
    sec_hdr(ws, pag_kpi_hdr, "ΕΠΑΝΑΛΑΜΒΑΝΟΜΕΝΑ & ΡΥΘΜΙΣΕΙΣ")
    spacer(ws, pag_kpi_hdr + 1, 5, LIGHT_GREY)
    mrow(ws, pag_kpi_hdr + 2, "Δεσμευμένο σε Επαναλαμβανόμενα (Υπόλοιπο)",
         f'=SUMIFS(Table_Kin[{H_REMAINING}],Table_Kin[{H_REC}],"{REC_YES}")',
         "Σύνολο ό,τι απομένει να πληρωθεί σε όλα τα ενεργά επαναλαμβανόμενα/ρυθμίσεις (πεπερασμένα μόνο — τα αόριστα δεν έχουν πεπερασμένο σύνολο)",
         value_fmt=EUR0, value_bold=True, value_size=12, value_color="FF965800",
         label_bg="FFFEF0D8", value_bg="FFFEF0D8", note_bg="FFFEF0D8")
    # $B$3 is plain text "YYYY-MM" (not a real date) — pull year/month out via
    # LEFT/RIGHT/VALUE instead of coercing it into a date, which is exactly
    # the kind of locale-dependent text-to-date parsing that bit us before.
    sel_year  = 'VALUE(LEFT($B$3,4))'
    sel_month = 'VALUE(RIGHT($B$3,2))'
    kdate_rng = f"Table_Kin[{H_DATE}]"
    kcount_rng = f"Table_Kin[{H_RECCOUNT}]"
    kamt_rng   = f"Table_Kin[{H_AMOUNT}]"
    krec_rng   = f"Table_Kin[{H_REC}]"
    months_since_sel = f'(({sel_year}-YEAR({kdate_rng}))*12+({sel_month}-MONTH({kdate_rng})))'
    mrow(ws, pag_kpi_hdr + 3, "Δόσεις Επιλεγμένου Μήνα",
         (f'=IF({FILTER}="{ALL_LABEL}","Επιλέξτε συγκεκριμένο μήνα",'
          f'SUMPRODUCT(({krec_rng}="{REC_YES}")*({months_since_sel}>=0)*'
          f'(({kcount_rng}="")+({months_since_sel}<{kcount_rng}))*{kamt_rng}))'),
         "Σύνολο δόσεων που πέφτουν στον επιλεγμένο μήνα, σε όλα τα επαναλαμβανόμενα/ρυθμίσεις",
         label_bg=LIGHT_GREY, value_bg=WHITE, value_color=DARK_BLUE, value_bold=True)
    mrow(ws, pag_kpi_hdr + 4, "Ληξιπρόθεσμο Ποσό (Επαναλαμβανόμενα)",
         f'=SUMIFS(Table_Kin[{H_OVERDUE_AMT}],Table_Kin[{H_REC}],"{REC_YES}")',
         "Δόσεις που πέρασε η ημερομηνία τους χωρίς να έχουν καταχωρηθεί ως πληρωμένες — ενημερώστε τη στήλη «Ημ/νία Τελ. Πληρωμένης Δόσης» στις Κινήσεις",
         value_fmt=EUR0, value_bold=True, value_size=12, value_color=RED_FG,
         label_bg=RED_BG, value_bg=RED_BG, note_bg=RED_BG)
    spacer(ws, pag_kpi_hdr + 5, 6)

    # ══════════════════════════════════════════════════════════════════════════
    # TAB: ΕΛΕΥΘΕΡΗ ΑΝΑΛΥΣΗ  (the real PivotTable + slicers, on its own sheet —
    # moved off Ανάλυση so a wide/tall pivot never crowds out the KPIs above
    # it or the slicers next to it. Slicers sit in a fixed zone ABOVE the
    # pivot anchor, since the pivot only ever grows down/right from its
    # anchor — that ordering guarantees they can never collide.) ──
    # ══════════════════════════════════════════════════════════════════════════
    ws = ws_piv
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 3
    ws.column_dimensions["B"].width = 20

    ws.row_dimensions[1].height = 34
    ws.merge_cells("A1:D1")
    c = ws.cell(row=1, column=1, value="  ΕΛΕΥΘΕΡΗ ΑΝΑΛΥΣΗ")
    c.fill = F(DARK_BLUE); c.font = Fnt(size=14, bold=True, color=WHITE)
    c.alignment = Aln(h="left", v="center")
    sheet_intro(ws, 2,
        "Εδώ διερευνάτε τις Κινήσεις ελεύθερα, με πραγματικό PivotTable — διασταυρώστε έργο, μήνα, "
        "κατηγορία, ό,τι θέλετε, χωρίς να αγγίξετε κανένα άλλο φύλλο.",
        end_col="D")

    sec_hdr(ws, 3, "ΦΙΛΤΡΑ")
    spacer(ws, 4, 5, LIGHT_GREY)
    ws.merge_cells("A5:N5")
    c = ws.cell(row=5, column=1,
                value="  Χρησιμοποιήστε τα φίλτρα (slicers) παρακάτω για να περιορίσετε το PivotTable — π.χ. διαλέξτε ένα Έργο ή έναν Μήνα με ένα κλικ.")
    c.font = Fnt(size=10, italic=True, color="FF6B7280")
    c.fill = F("FFF6F8FA"); c.alignment = Aln(h="left", wrap=True)
    ws.row_dimensions[5].height = 20

    # generous reserved zone: 6 slicers at up to 150pt tall each, laid out in
    # build_pivots.ps1 as 2 rows x 3 cols = up to 300pt of real slicer height
    # needed. 30 rows x 15pt = 450pt gives real margin — a previous version
    # of this zone was too short (225pt) and the slicers spilled down onto
    # the pivot table below; don't shrink this without checking the actual
    # slicer height/layout in build_pivots.ps1 still fits comfortably inside.
    PIV_FILTER_ZONE_LAST = 30
    for r in range(6, PIV_FILTER_ZONE_LAST + 1):
        ws.row_dimensions[r].height = 15

    spacer(ws, PIV_FILTER_ZONE_LAST + 1, 6)

    # ── anchor for the real PivotTable added by build_pivots.ps1 ──
    pivot_hdr = PIV_FILTER_ZONE_LAST + 2
    sec_hdr(ws, pivot_hdr, "PIVOT TABLE")
    spacer(ws, pivot_hdr + 1, 5, LIGHT_GREY)
    c = ws.cell(row=pivot_hdr + 2, column=1,
                value="  " + t("(Το PivotTable εμφανίζεται εδώ μετά το άνοιγμα του αρχείου· κάντε δεξί κλικ πάνω του και «Ανανέωση» αν προσθέσετε νέες κινήσεις)",
                                "(The PivotTable appears here once the file is opened; right-click it and “Refresh” after adding new transactions)"))
    c.font = Fnt(size=10, italic=True, color="FF6B7280")
    ws.row_dimensions[pivot_hdr + 2].height = 20
    PIVOT_ANCHOR_ROW = pivot_hdr + 4
    # a real Excel defined name, not a code comment, keeps build_pivots.ps1 in
    # sync with wherever this row ends up — no human has to notice the sheet
    # grew and manually update a hardcoded cell in a second file.
    wb.defined_names["PivotAnchor"] = DefinedName(
        "PivotAnchor", attr_text=f"\'6. Ελεύθερη Ανάλυση\'!$A${PIVOT_ANCHOR_ROW}")
    print(f"Pivot anchor: \'6. Ελεύθερη Ανάλυση\'!A{PIVOT_ANCHOR_ROW}")

    # ══════════════════════════════════════════════════════════════════════════
    # TAB: ΕΠΑΦΕΣ  (contact master list + financial totals, one unified table)
    # ══════════════════════════════════════════════════════════════════════════
    ws = ws_con
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 22
    ws.column_dimensions["B"].width = 13
    ws.column_dimensions["C"].width = 14
    ws.column_dimensions["D"].width = 22
    ws.column_dimensions["E"].width = 14
    ws.column_dimensions["F"].width = 14
    ws.column_dimensions["G"].width = 14
    ws.column_dimensions["H"].width = 14
    ws.column_dimensions["I"].width = 16
    ws.column_dimensions["J"].width = 24
    ws.freeze_panes = "A5"

    ws.row_dimensions[1].height = 34
    ws.merge_cells("A1:J1")
    c = ws.cell(row=1, column=1, value="  ΕΠΑΦΕΣ")
    c.fill = F(DARK_BLUE); c.font = Fnt(size=14, bold=True, color=WHITE)
    c.alignment = Aln(h="left", v="center")

    sheet_intro(ws, 2,
        "Κάθε επαφή που θα χρησιμοποιήσετε στις Κινήσεις πρέπει να υπάρχει πρώτα εδώ — προσθέστε τη μία "
        "φορά και μετά εμφανίζεται αυτόματα στο μενού επιλογής, με το ΑΦΜ έτοιμο.",
        end_col="J")

    ws.row_dimensions[3].height = 24
    ws.merge_cells("A3:J3")
    c = ws.cell(row=3, column=1, value="  ΕΠΑΦΕΣ & ΣΥΝΟΛΑ ΑΝΑ ΕΠΑΦΗ")
    c.fill = F(LIGHT_GREY); c.font = Fnt(size=10, bold=True, color=DARK_BLUE)
    c.alignment = Aln(h="left", v="center")
    c.border = Border()

    con_headers = ["Επαφή", "ΑΦΜ", "Τηλέφωνο", "Ηλ. Διεύθυνση", "Σύνολο Εσόδων",
                   "Σύνολο Εξόδων", "Πληρωμένα Έξοδα", "Εκκρεμή Έξοδα",
                   "Σύνολο (Έσοδα − Έξοδα)", "Σημειώσεις"]
    for ci, h in enumerate(con_headers, 1):
        col_hdr(ws, 4, ci, h)

    # every contact is pulled automatically from AADE_Master invoices — no manual entries
    for i in range(26):
        r = 5 + i
        ws.row_dimensions[r].height = 18
        name, afm = aade_contacts[i] if i < len(aade_contacts) else (None, None)
        nm = ws.cell(row=r, column=1, value=name)
        nm.fill = F(YELLOW); nm.border = Brd(); nm.alignment = Aln(h="left")
        nm.font = Fnt(size=10, bold=(i < len(aade_contacts)))
        af = ws.cell(row=r, column=2, value=afm)
        af.fill = F(YELLOW); af.border = Brd(); af.alignment = Aln(h="center")
        for ci in (3, 4):
            cc = ws.cell(row=r, column=ci)
            cc.fill = F(YELLOW); cc.border = Brd(); cc.alignment = Aln(h="left")
        inc = ws.cell(row=r, column=5,
            value=f'=IF($A{r}="","",SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_CONTACT}],$A{r},Table_Kin[{H_TYPE}],"{TYPE_INC}"))')
        exp = ws.cell(row=r, column=6,
            value=f'=IF($A{r}="","",SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_CONTACT}],$A{r},Table_Kin[{H_TYPE}],"{TYPE_EXP}"))')
        pd = ws.cell(row=r, column=7,
            value=f'=IF($A{r}="","",SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_CONTACT}],$A{r},Table_Kin[{H_TYPE}],"{TYPE_EXP}",Table_Kin[{H_STATUS}],"{S_PAID}"))')
        up = ws.cell(row=r, column=8,
            value=f'=IF($A{r}="","",SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_CONTACT}],$A{r},Table_Kin[{H_TYPE}],"{TYPE_EXP}",Table_Kin[{H_STATUS}],"{S_UPCOM}"))')
        net = ws.cell(row=r, column=9, value=f'=IF($A{r}="","",E{r}-F{r})')
        for cc in (inc, exp, pd, up):
            cc.number_format = EUR0; cc.alignment = Aln(h="right"); cc.border = Brd()
            cc.fill = F(WHITE); cc.font = Fnt(size=10)
        net.number_format = EUR0; net.alignment = Aln(h="right"); net.border = Brd()
        net.fill = F(LIGHT_BLUE); net.font = Fnt(size=10, bold=True, color=DARK_BLUE)
        nt = ws.cell(row=r, column=10)
        nt.fill = F(YELLOW); nt.border = Brd(); nt.alignment = Aln(h="left", wrap=True)

    tbl_con = Table(displayName="Table_Contacts", ref="A4:J30")
    tbl_con.tableStyleInfo = TableStyleInfo(
        name="TableStyleMedium2", showFirstColumn=False, showLastColumn=False,
        showRowStripes=True, showColumnStripes=False)
    ws.add_table(tbl_con)

    ws.row_dimensions[31].height = 22
    tl = ws.cell(row=31, column=1, value="ΣΥΝΟΛΑ ΟΛΩΝ")
    tl.fill = F(LIGHT_BLUE); tl.font = Fnt(size=10, bold=True); tl.alignment = Aln(h="left"); tl.border = Brd()
    for ci in (2, 3, 4):
        ws.cell(row=31, column=ci).fill = F(LIGHT_BLUE); ws.cell(row=31, column=ci).border = Brd()
    for col, letter in [(5, "E"), (6, "F"), (7, "G"), (8, "H"), (9, "I")]:
        sc = ws.cell(row=31, column=col, value=f'=SUM({letter}5:{letter}30)')
        sc.number_format = EUR0; sc.font = Fnt(size=10, bold=True, color=DARK_BLUE)
        sc.alignment = Aln(h="right"); sc.border = Brd(); sc.fill = F(LIGHT_BLUE)
    ws.cell(row=31, column=10).fill = F(LIGHT_BLUE); ws.cell(row=31, column=10).border = Brd()

    ws.row_dimensions[32].height = 8
    for ci in range(1, 11): ws.cell(row=32, column=ci).fill = F(WHITE)

    ws.merge_cells("A33:J33")
    c = ws.cell(row=33, column=1,
                value="  Συμβουλή: Η Επαφή στις Κινήσεις επιλέγεται από αυτή τη λίστα — το ΑΦΜ συνδέει αυτόματα τις δύο καρτέλες. Προσθέστε νέα επαφή εδώ πρώτα, μετά θα εμφανιστεί στη λίστα επιλογών. Η στήλη «Σύνολο» δείχνει το καθαρό υπόλοιπο (Έσοδα − Έξοδα) ανά επαφή.")
    c.font = Fnt(size=10, italic=True, color="FF6B7280")
    c.fill = F("FFF6F8FA"); c.alignment = Aln(h="left")
    ws.row_dimensions[33].height = 20

    # ══════════════════════════════════════════════════════════════════════════
    # TAB: ACCOUNTS
    # ══════════════════════════════════════════════════════════════════════════
    ws = ws_acc
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 30
    ws.column_dimensions["B"].width = 16
    ws.column_dimensions["C"].width = 18
    ws.column_dimensions["D"].width = 16
    ws.column_dimensions["E"].width = 16
    ws.column_dimensions["F"].width = 28
    ws.column_dimensions["G"].width = 16
    ws.column_dimensions["H"].width = 16
    ws.freeze_panes = "A3"

    ws.row_dimensions[1].height = 34
    ws.merge_cells("A1:D1")
    c = ws.cell(row=1, column=1, value="  " + t("ΛΟΓΑΡΙΑΣΜΟΙ & ΥΠΟΛΟΙΠΑ", "ACCOUNTS & BALANCES"))
    c.fill = F(DARK_BLUE); c.font = Fnt(size=14, bold=True, color=WHITE)
    c.alignment = Aln(h="left", v="center")
    # balances here are manual, so trust depends on knowing how stale they
    # are — a plain yellow input, not =TODAY(), so it actually reflects the
    # last time someone updated the numbers rather than always claiming
    # "today" regardless of whether anyone touched the sheet.
    lu = ws.cell(row=1, column=5, value="  " + t("ΕΝΗΜΕΡΩΘΗΚΕ:", "UPDATED:"))
    lu.fill = F(DARK_BLUE); lu.font = Fnt(size=10, bold=True, color=WHITE)
    lu.alignment = Aln(h="right", v="center")
    luv = ws.cell(row=1, column=6)
    luv.fill = F(YELLOW); luv.font = Fnt(size=10, bold=True, color=DARK_BLUE)
    luv.alignment = Aln(h="center", v="center"); luv.number_format = "DD/MM/YYYY"

    sheet_intro(ws, 2,
        t("Η στήλη «Κάτοχος» δείχνει αν το ποσό είναι σε εταιρικό ή προσωπικό λογαριασμό — έχει σημασία μόλις "
          "τα χρήματα μπουν στην εταιρεία. Χρυσός και κρυπτονομίσματα είναι περιουσία, όχι ρευστό — μην τα "
          "μετράτε σαν διαθέσιμα μετρητά.",
          "The “Owner” column shows whether the balance sits in a business or personal account — it "
          "matters once the money moves into the company. Gold and crypto are wealth, not liquidity — don't "
          "count them as available cash."),
        end_col="F")

    ws.row_dimensions[3].height = 24
    ws.merge_cells("A3:F3")
    c = ws.cell(row=3, column=1, value="  " + t("ΤΑ ΧΡΗΜΑΤΑ ΣΑΣ ΣΗΜΕΡΑ", "YOUR MONEY TODAY"))
    c.fill = F(LIGHT_GREY); c.font = Fnt(size=10, bold=True, color=DARK_BLUE)
    c.alignment = Aln(h="left", v="center")
    c.border = Border()

    # ACC_TYPE_BANK/CASH/ACC_FIRST are hoisted near the top of
    # build_workbook() — Κέντρο Ελέγχου needs them before this section runs.

    acc_headers = [t("Λογαριασμός", "Account"),
                   t("Υπόλοιπο Έναρξης (€)", "Opening Balance (€)"),
                   t("Μεταβολή από Κινήσεις", "Change from Transactions"),
                   t("Τρέχον Υπόλοιπο (€)", "Current Balance (€)"),
                   t("Κάτοχος", "Owner"),
                   t("Σημειώσεις", "Notes"),
                   t("Τύπος", "Type")]
    for ci, h in enumerate(acc_headers, 1):
        col_hdr(ws, 4, ci, h)

    # ONLY liquid accounts (spendable today) — 5 banks + physical cash.
    # Χρυσός/Κρυπτό used to sit in this same table, which is how they
    # silently ended up inside ΣΥΝΟΛΟ ΣΗΜΕΡΑ/CompanyFunds/PersonalFunds/
    # AllFunds and Ταμείο's Opening Balance despite the dashboard's own
    # "ΕΚΤΟΣ ρευστότητας" label — they now live in their own ΑΠΟΘΕΜΑΤΑ table
    # below, excluded from every liquidity total by construction, not by a
    # note asking the reader to remember to subtract them.
    accounts = [
        # 210625.99→213861.99 per Επιχειρησιακό_Αρχείο_107.xlsx Λογαριασμοί:
        # "Επιβεβαιωμένο υπόλοιπο e-banking 20/08/2026, μετά την είσπραξη
        # του ΦΠΑ Βουλιαγμένης".
        ("Optima Εταιρικός", SRC_OPT_CORP, 213861.99, OWNER_CORP, ACC_TYPE_BANK,
         t("Το μόνο πραγματικά εταιρικό ρευστό σήμερα", "The only genuinely corporate liquid funds today")),
        # 245593.70→244294.50 per Επιχειρησιακό_Αρχείο_107.xlsx Λογαριασμοί:
        # "Δηλωμένο υπόλοιπο 02/09/2026. Το προηγούμενο ήταν 245.547,48 στις
        # 21/08." — 02/09/2026 is the most current confirmed figure available.
        (t("Πειραιώς Προσωπικός", "Piraeus Personal"), SRC_PIR_PERS, 244294.50, OWNER_PERS, ACC_TYPE_BANK,
         t("Προορίζεται για επενδύσεις στα έργα", "Earmarked for investment in the projects")),
        ("Alpha Προσωπικός", SRC_ALPHA, 1501.17, OWNER_PERS, ACC_TYPE_BANK, ""),
        ("Optima Προσωπικός", SRC_OPT_PERS, 492, OWNER_PERS, ACC_TYPE_BANK, ""),
        ("N26 Προσωπικός", SRC_N26, 82, OWNER_PERS, ACC_TYPE_BANK, ""),
        (t("Μετρητά (φυσικά)", "Cash (physical)"), SRC_CASH, 175000, OWNER_PERS, ACC_TYPE_CASH,
         t("Χρειάζεται τεκμηρίωση προέλευσης όταν εισφερθεί", "Needs source documentation once contributed")),
    ]
    assert ACC_LAST == ACC_FIRST + len(accounts) - 1, "hoisted ACC_LAST must match the accounts list length"
    for i, (account, src_key, amount, owner, acc_type, notes) in enumerate(accounts):
        row = ACC_FIRST + i
        ws.row_dimensions[row].height = 22
        lbl(ws, row, 1, account, bg=WHITE)
        inp(ws, row, 2, amount, EUR0)
        # ">"&AccountBalanceDate — only Κινήσεις rows dated AFTER the
        # confirmed opening-balance date count toward the movement; without
        # this, every Πληρωμένο row ever recorded for this Πηγή (including
        # years of AADE history predating the opening balance) was summed
        # too, double-counting money already baked into Υπόλοιπο Έναρξης.
        chg = ws.cell(row=row, column=3,
            value=(f'=SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_SOURCE}],"{src_key}",Table_Kin[{H_TYPE}],"{TYPE_INC}",Table_Kin[{H_STATUS}],"{S_PAID}",Table_Kin[{H_DATE}],">"&AccountBalanceDate)'
                   f'-SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_SOURCE}],"{src_key}",Table_Kin[{H_TYPE}],"{TYPE_EXP}",Table_Kin[{H_STATUS}],"{S_PAID}",Table_Kin[{H_DATE}],">"&AccountBalanceDate)'))
        chg.number_format = EUR0; chg.fill = F(LIGHT_GREY)
        chg.font = Fnt(size=11, italic=True, color="FF6B7280"); chg.alignment = Aln(h="right", v="center")
        cur = ws.cell(row=row, column=4, value=f"=B{row}+C{row}")
        cur.number_format = EUR0; cur.fill = F(WHITE)
        cur.font = Fnt(size=11, bold=True, color=DARK_BLUE); cur.alignment = Aln(h="right", v="center")
        lbl(ws, row, 5, owner, bg=WHITE)
        lbl(ws, row, 6, notes, bg=WHITE)
        lbl(ws, row, 7, acc_type, bg=WHITE)

    SPACER1 = ACC_LAST + 1
    ws.row_dimensions[SPACER1].height = 8
    for ci in range(1, 8): ws.cell(row=SPACER1, column=ci).fill = F(WHITE)

    TOTAL_TODAY_ROW = SPACER1 + 1
    ws.row_dimensions[TOTAL_TODAY_ROW].height = 30
    lbl(ws, TOTAL_TODAY_ROW, 1, t("ΣΥΝΟΛΟ ΣΗΜΕΡΑ (Επιβεβαιωμένα)", "TOTAL TODAY (Confirmed)"), bold=True, bg=LIGHT_BLUE)
    # EXTRA_ACC_FIRST/LAST are hoisted (Κέντρο Ελέγχου needs them too).
    # Extra Accounts now carries its own Owner column (E), so it's summed
    # the same way as the main table instead of being invisible to every
    # Owner-based breakdown below.
    calc(ws, TOTAL_TODAY_ROW, 2, f"=ROUND(SUM(D{ACC_FIRST}:D{ACC_LAST})+SUM(H{EXTRA_ACC_FIRST}:H{EXTRA_ACC_LAST}),2)",
         EUR0, bg=LIGHT_BLUE, bold=True, size=14, fg=DARK_BLUE)
    for ci in [3, 4, 5, 6]:
        ws.cell(row=TOTAL_TODAY_ROW, column=ci).fill = F(LIGHT_BLUE)

    # company-only total, reusing what used to be a blank spacer row rather
    # than inserting a new one — Κέντρο Ελέγχου/Ταμείο reference these two
    # totals by NAME (CompanyFunds/PersonalFunds), not by row number, so
    # this table can grow without breaking anything downstream. SUMIFS runs
    # over BOTH physical tables (main account rows + Extra Accounts) keyed
    # on each one's own Owner column — a real "unified" total, not a single
    # hardcoded range that silently excludes whatever's added in Extra
    # Accounts. Χρυσός/Κρυπτό live in the separate ΑΠΟΘΕΜΑΤΑ table below and
    # are deliberately absent from both ranges.
    SPACER2A, SPACER2B = TOTAL_TODAY_ROW + 1, TOTAL_TODAY_ROW + 2
    ws.row_dimensions[SPACER2A].height = 20
    lbl(ws, SPACER2A, 1, t("— εκ των οποίων Εταιρικά (Owner=Εταιρικός)", "— of which Corporate (Owner=Corporate)"), bg=WHITE)
    company_cell = ws.cell(row=SPACER2A, column=2,
        value=(f'=ROUND(SUMIFS(D{ACC_FIRST}:D{ACC_LAST},E{ACC_FIRST}:E{ACC_LAST},"{OWNER_CORP}")'
               f'+SUMIFS(H{EXTRA_ACC_FIRST}:H{EXTRA_ACC_LAST},E{EXTRA_ACC_FIRST}:E{EXTRA_ACC_LAST},"{OWNER_CORP}"),2)'))
    company_cell.number_format = EUR0; company_cell.fill = F(WHITE)
    company_cell.font = Fnt(size=11, bold=True, color=MED_BLUE); company_cell.alignment = Aln(h="right", v="center")
    for ci in range(3, 7): ws.cell(row=SPACER2A, column=ci).fill = F(WHITE)
    wb.defined_names["CompanyFunds"] = DefinedName("CompanyFunds", attr_text=f"\'8. Λογαριασμοί\'!$B${SPACER2A}")
    wb.defined_names["AllFunds"] = DefinedName("AllFunds", attr_text=f"\'8. Λογαριασμοί\'!$B${TOTAL_TODAY_ROW}")

    # personal-only total — the third leg of the dashboard's Προβολή
    # toggle (Εταιρικά / Προσωπικά / Όλα), same reused-spacer-row trick.
    ws.row_dimensions[SPACER2B].height = 20
    lbl(ws, SPACER2B, 1, t("— εκ των οποίων Προσωπικά (Owner=Προσωπικός)", "— of which Personal (Owner=Personal)"), bg=WHITE)
    personal_cell = ws.cell(row=SPACER2B, column=2,
        value=(f'=ROUND(SUMIFS(D{ACC_FIRST}:D{ACC_LAST},E{ACC_FIRST}:E{ACC_LAST},"{OWNER_PERS}")'
               f'+SUMIFS(H{EXTRA_ACC_FIRST}:H{EXTRA_ACC_LAST},E{EXTRA_ACC_FIRST}:E{EXTRA_ACC_LAST},"{OWNER_PERS}"),2)'))
    personal_cell.number_format = EUR0; personal_cell.fill = F(WHITE)
    personal_cell.font = Fnt(size=11, bold=True, color=MED_BLUE); personal_cell.alignment = Aln(h="right", v="center")
    for ci in range(3, 7): ws.cell(row=SPACER2B, column=ci).fill = F(WHITE)
    wb.defined_names["PersonalFunds"] = DefinedName("PersonalFunds", attr_text=f"\'8. Λογαριασμοί\'!$B${SPACER2B}")

    # ── ΑΠΟΘΕΜΑΤΑ — variable-value, NOT spendable cash today, deliberately
    # excluded from ΣΥΝΟΛΟ ΣΗΜΕΡΑ/CompanyFunds/PersonalFunds/AllFunds and
    # therefore from Ταμείο's Opening Balance too. Used to sit inside the
    # liquid accounts table above despite the dashboard calling them "ΕΚΤΟΣ
    # ρευστότητας" right next to a number that quietly included them. ──
    RESERVE_HDR_ROW = SPACER2B + 1
    ws.row_dimensions[RESERVE_HDR_ROW].height = 24
    ws.merge_cells(start_row=RESERVE_HDR_ROW, start_column=1, end_row=RESERVE_HDR_ROW, end_column=7)
    c = ws.cell(row=RESERVE_HDR_ROW, column=1,
                value="  " + t("ΑΠΟΘΕΜΑΤΑ  (μεταβλητής αξίας — ΕΚΤΟΣ ρευστότητας, ΕΚΤΟΣ ΣΥΝΟΛΟΥ ΣΗΜΕΡΑ)",
                                "RESERVES  (variable value — EXCLUDED from liquidity, EXCLUDED from Total Today)"))
    c.fill = F(LIGHT_GREY); c.font = Fnt(size=10, bold=True, color=DARK_BLUE)
    c.alignment = Aln(h="left", v="center")
    c.border = Border()

    RESERVE_COLHDR_ROW = RESERVE_HDR_ROW + 1
    for ci, h in enumerate(acc_headers[:6], 1):
        col_hdr(ws, RESERVE_COLHDR_ROW, ci, h)

    RESERVE_FIRST = RESERVE_COLHDR_ROW + 1
    reserves = [
        (t("Χρυσός (εκτ. αξία)", "Gold (est. value)"), SRC_GOLD, 11219, OWNER_PERS,
         t("Εκτιμώμενη αγοραία αξία", "Estimated market value")),
        (SRC_CRYPTO, SRC_CRYPTO, 4785, OWNER_PERS,
         t("Πορτοφόλι Exodus — ρευστοποιήσιμο αλλά μεταβλητής αξίας", "Exodus wallet — liquid but volatile value")),
    ]
    for i, (account, src_key, amount, owner, notes) in enumerate(reserves):
        row = RESERVE_FIRST + i
        ws.row_dimensions[row].height = 22
        lbl(ws, row, 1, account, bg=WHITE)
        inp(ws, row, 2, amount, EUR0)
        chg = ws.cell(row=row, column=3,
            value=(f'=SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_SOURCE}],"{src_key}",Table_Kin[{H_TYPE}],"{TYPE_INC}",Table_Kin[{H_STATUS}],"{S_PAID}",Table_Kin[{H_DATE}],">"&AccountBalanceDate)'
                   f'-SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_SOURCE}],"{src_key}",Table_Kin[{H_TYPE}],"{TYPE_EXP}",Table_Kin[{H_STATUS}],"{S_PAID}",Table_Kin[{H_DATE}],">"&AccountBalanceDate)'))
        chg.number_format = EUR0; chg.fill = F(LIGHT_GREY)
        chg.font = Fnt(size=11, italic=True, color="FF6B7280"); chg.alignment = Aln(h="right", v="center")
        cur = ws.cell(row=row, column=4, value=f"=B{row}+C{row}")
        cur.number_format = EUR0; cur.fill = F(WHITE)
        cur.font = Fnt(size=11, bold=True, color=DARK_BLUE); cur.alignment = Aln(h="right", v="center")
        lbl(ws, row, 5, owner, bg=WHITE)
        lbl(ws, row, 6, notes, bg=WHITE)
    RESERVE_LAST = RESERVE_FIRST + len(reserves) - 1

    RESERVE_TOTAL_ROW = RESERVE_LAST + 1
    ws.row_dimensions[RESERVE_TOTAL_ROW].height = 26
    lbl(ws, RESERVE_TOTAL_ROW, 1, t("ΣΥΝΟΛΟ ΜΗ ΡΕΥΣΤΩΝ ΑΠΟΘΕΜΑΤΩΝ", "TOTAL NON-LIQUID RESERVES"), bold=True, bg="FFF6F0E4")
    calc(ws, RESERVE_TOTAL_ROW, 2, f"=SUM(D{RESERVE_FIRST}:D{RESERVE_LAST})",
         EUR0, bg="FFF6F0E4", bold=True, size=12, fg="FF6B7280")
    for ci in range(3, 8): ws.cell(row=RESERVE_TOTAL_ROW, column=ci).fill = F("FFF6F0E4")
    wb.defined_names["ReserveFunds"] = DefinedName("ReserveFunds", attr_text=f"\'8. Λογαριασμοί\'!$B${RESERVE_TOTAL_ROW}")
    # owner-scoped variants tucked into the same total row (columns C/D,
    # otherwise unused) — Κέντρο Ελέγχου's Section 1 "Αποθέματα" row needs
    # these to respect ViewMode exactly like the liquid figures do, the
    # same 3-way pattern as CompanyFunds/PersonalFunds/AllFunds.
    rc_corp = ws.cell(row=RESERVE_TOTAL_ROW, column=3,
        value=f'=ROUND(SUMIFS(D{RESERVE_FIRST}:D{RESERVE_LAST},E{RESERVE_FIRST}:E{RESERVE_LAST},"{OWNER_CORP}"),2)')
    rc_corp.number_format = EUR0; rc_corp.font = Fnt(size=8, color="FF6B7280"); rc_corp.alignment = Aln(h="right")
    wb.defined_names["ReserveFundsCorp"] = DefinedName("ReserveFundsCorp", attr_text=f"\'8. Λογαριασμοί\'!$C${RESERVE_TOTAL_ROW}")
    rc_pers = ws.cell(row=RESERVE_TOTAL_ROW, column=4,
        value=f'=ROUND(SUMIFS(D{RESERVE_FIRST}:D{RESERVE_LAST},E{RESERVE_FIRST}:E{RESERVE_LAST},"{OWNER_PERS}"),2)')
    rc_pers.number_format = EUR0; rc_pers.font = Fnt(size=8, color="FF6B7280"); rc_pers.alignment = Aln(h="right")
    wb.defined_names["ReserveFundsPers"] = DefinedName("ReserveFundsPers", attr_text=f"\'8. Λογαριασμοί\'!$D${RESERVE_TOTAL_ROW}")

    SPACER_RES = RESERVE_TOTAL_ROW + 1
    ws.row_dimensions[SPACER_RES].height = 8
    for ci in range(1, 8): ws.cell(row=SPACER_RES, column=ci).fill = F(WHITE)

    # ── ΟΦΕΙΛΕΣ (private debts owed) — replaces the old single TEPIX slot,
    # which no longer reflects reality; real financing today is 2 private
    # loans, not TEPIX. ──
    DEBT_HDR_ROW = SPACER_RES + 1
    ws.row_dimensions[DEBT_HDR_ROW].height = 24
    ws.merge_cells(start_row=DEBT_HDR_ROW, start_column=1, end_row=DEBT_HDR_ROW, end_column=6)
    c = ws.cell(row=DEBT_HDR_ROW, column=1, value="  " + t("ΟΦΕΙΛΕΣ  (χρωστάμε σε τρίτους)", "LIABILITIES  (owed to others)"))
    c.fill = F(LIGHT_GREY); c.font = Fnt(size=10, bold=True, color=DARK_BLUE)
    c.alignment = Aln(h="left", v="center")
    c.border = Border()

    debt_headers = [t("Δανειστής", "Creditor"), t("Οφειλή Σήμερα (€)", "Owed Today (€)"),
                    t("Λήξη", "Due"), t("Τόκος", "Interest"), t("Σημειώσεις", "Notes")]
    DEBT_COLHDR_ROW = DEBT_HDR_ROW + 1
    for ci, h in enumerate(debt_headers, 1):
        col_hdr(ws, DEBT_COLHDR_ROW, ci, h)

    DEBT_FIRST = DEBT_COLHDR_ROW + 1
    debts = [
        ("Αντώνης", 340000, datetime.date(2031, 9, 30), t("Άτοκο", "Interest-free"),
         t("Με την είσπραξη των 160.000 τον Σεπτ 2026 η οφειλή γίνεται 500.000. Τρόπος επιστροφής δεν έχει συμφωνηθεί.",
            "Once the 160,000 is received in Sep 2026 the debt becomes 500,000. Repayment method not yet agreed.")),
        ("Άλμπερτ", None, None, "",
         t("Πιθανή μελλοντική οφειλή — δεν είναι σίγουρη.", "Possible future liability — not confirmed.")),
    ]
    for i, (creditor, amount, due, interest, notes) in enumerate(debts):
        row = DEBT_FIRST + i
        ws.row_dimensions[row].height = 22
        lbl(ws, row, 1, creditor, bg=WHITE)
        inp(ws, row, 2, amount, EUR0)
        dc = ws.cell(row=row, column=3, value=due)
        dc.fill = F(WHITE); dc.alignment = Aln(h="center"); dc.border = Brd()
        if due: dc.number_format = "DD/MM/YYYY"
        lbl(ws, row, 4, interest, bg=WHITE)
        lbl(ws, row, 5, notes, bg=WHITE)
        ws.cell(row=row, column=6).fill = F(WHITE)
    DEBT_LAST = DEBT_FIRST + len(debts) - 1

    DEBT_TOTAL_ROW = DEBT_LAST + 1
    ws.row_dimensions[DEBT_TOTAL_ROW].height = 26
    lbl(ws, DEBT_TOTAL_ROW, 1, t("ΣΥΝΟΛΟ ΟΦΕΙΛΩΝ", "TOTAL LIABILITIES"), bold=True, bg="FFFEF0D8")
    calc(ws, DEBT_TOTAL_ROW, 2, f"=SUM(B{DEBT_FIRST}:B{DEBT_LAST})", EUR0, bg="FFFEF0D8", bold=True, size=12, fg="FF965800")
    for ci in [3, 4, 5, 6]:
        ws.cell(row=DEBT_TOTAL_ROW, column=ci).fill = F("FFFEF0D8")
    # named so Κέντρο Ελέγχου can net this against Free Cash without
    # hardcoding a row number that shifts if this table ever grows — this
    # is exactly the figure that was previously invisible on the dashboard.
    wb.defined_names["TotalLiabilities"] = DefinedName(
        "TotalLiabilities", attr_text=f"\'8. Λογαριασμοί\'!$B${DEBT_TOTAL_ROW}")

    SPACER3 = DEBT_TOTAL_ROW + 1
    ws.row_dimensions[SPACER3].height = 8
    for ci in range(1, 7): ws.cell(row=SPACER3, column=ci).fill = F(WHITE)

    INCOMING_HDR_ROW = SPACER3 + 1
    ws.row_dimensions[INCOMING_HDR_ROW].height = 24
    ws.merge_cells(start_row=INCOMING_HDR_ROW, start_column=1, end_row=INCOMING_HDR_ROW, end_column=6)
    c = ws.cell(row=INCOMING_HDR_ROW, column=1, value="  " + t("ΕΙΣΕΡΧΟΜΕΝΑ ΚΕΦΑΛΑΙΑ  (δεν έχουν εισπραχθεί)", "INCOMING FUNDS  (not yet received)"))
    c.fill = F(LIGHT_GREY); c.font = Fnt(size=10, bold=True, color=DARK_BLUE)
    c.alignment = Aln(h="left", v="center")
    c.border = Border()

    INCOMING_FIRST = INCOMING_HDR_ROW + 1
    incoming = [
        (t("Αναμενόμενο από Αντώνη", "Expected from Antonis"), 160000, A_PEND,
         t("Δάνειο — Βέβαιο, αναμ. Σεπτέμβριος 2026", "Loan — Certain, expected September 2026")),
        (t("Αναμενόμενο από Άλμπερτ", "Expected from Albert"), 70000, A_PEND,
         t("Πιθανό, ΟΧΙ σίγουρο — αναμ. Σεπτέμβριος 2026", "Probable, NOT certain — expected September 2026")),
    ]
    for i, (label, amount, status, notes) in enumerate(incoming):
        row = INCOMING_FIRST + i
        ws.row_dimensions[row].height = 22 if i else 28
        lbl(ws, row, 1, label, bold=(i == 0), bg=("FFFEF0D8" if i == 0 else WHITE))
        inp(ws, row, 2, amount, EUR0)
        c = ws.cell(row=row, column=3, value=status)
        c.fill = F(YELLOW); c.alignment = Aln(h="center")
        lbl(ws, row, 4, notes, bg=("FFFEF0D8" if i == 0 else WHITE))
    INCOMING_LAST = INCOMING_FIRST + len(incoming) - 1
    # named so Κέντρο Ελέγχου/Σύνοψη reference these by NAME, not by literal
    # cell address — this table's row position now moves whenever the
    # sections above it change (e.g. the new ΑΠΟΘΕΜΑΤΑ table), so a
    # hardcoded "B24"/"B25" would have silently pointed at the wrong row.
    wb.defined_names["ExpectedFromAntonis"] = DefinedName(
        "ExpectedFromAntonis", attr_text=f"\'8. Λογαριασμοί\'!$B${INCOMING_FIRST}")
    wb.defined_names["ExpectedFromAlbert"] = DefinedName(
        "ExpectedFromAlbert", attr_text=f"\'8. Λογαριασμοί\'!$B${INCOMING_FIRST + 1}")
    wb.defined_names["ExpectedFromAntonisStatus"] = DefinedName(
        "ExpectedFromAntonisStatus", attr_text=f"\'8. Λογαριασμοί\'!$C${INCOMING_FIRST}")

    # the Αντώνης debt's own stated rule — "once the €160k is received the
    # debt becomes €500k" — is now actually encoded instead of just noted
    # in a comment: this checks the SAME incoming-funds status cell Ταμείο
    # already reads, so once you flip it to Ελήφθη, TotalLiabilities moves
    # from €340k to €500k on its own everywhere that name is used.
    calc(ws, DEBT_FIRST, 2, f'=IF(C{INCOMING_FIRST}="{A_RECV}",500000,340000)', EUR0)

    SPACER4 = INCOMING_LAST + 1
    ws.row_dimensions[SPACER4].height = 8
    for ci in range(1, 7): ws.cell(row=SPACER4, column=ci).fill = F(WHITE)

    INCOMING_TOTAL_ROW = SPACER4 + 1
    ws.row_dimensions[INCOMING_TOTAL_ROW].height = 30
    EXTRA_INC_FIRST, EXTRA_INC_LAST = EXTRA_ACC_LAST + 4, EXTRA_ACC_LAST + 8
    lbl(ws, INCOMING_TOTAL_ROW, 1, t("ΣΥΝΟΛΟ ΕΙΣΕΡΧΟΜΕΝΩΝ (εκκρεμή, αν εισπραχθούν όλα)", "TOTAL INCOMING (pending, if all received)"), bold=True, bg=LIGHT_BLUE)
    # excludes any row already flipped to Ελήφθη — once received it's a
    # real balance on Λογαριασμοί already, not still "incoming"; counting
    # both would double it. Still an "if everything pending comes in"
    # ceiling, not a probability-weighted figure — Άλμπερτ's own row says
    # "not certain" right next to it, so B25/B{EXTRA_INC} stay unweighted
    # on purpose; see the confirmed-only figure below for the honest one.
    calc(ws, INCOMING_TOTAL_ROW, 2,
         (f'=SUMIFS(B{INCOMING_FIRST}:B{INCOMING_LAST},C{INCOMING_FIRST}:C{INCOMING_LAST},"<>{A_RECV}")'
          f'+SUM(B{EXTRA_INC_FIRST}:B{EXTRA_INC_LAST})'),
         EUR0, bg=LIGHT_BLUE, bold=True, size=14, fg=DARK_BLUE)
    for ci in [3, 4, 5, 6]:
        ws.cell(row=INCOMING_TOTAL_ROW, column=ci).fill = F(LIGHT_BLUE)
    certain_note = ws.cell(row=INCOMING_TOTAL_ROW, column=3,
        value=(f'="{t("εκ των οποίων βέβαιο (Αντώνη): ", "of which certain (Antonis): ")}"'
               f'&TEXT(IF(C{INCOMING_FIRST}="{A_RECV}",0,B{INCOMING_FIRST}),"€#.##0")'))
    certain_note.font = Fnt(size=9, italic=True, color=DARK_BLUE); certain_note.alignment = Aln(h="left", v="center")
    wb.defined_names["TotalIncoming"] = DefinedName(
        "TotalIncoming", attr_text=f"\'8. Λογαριασμοί\'!$B${INCOMING_TOTAL_ROW}")

    SPACER5 = INCOMING_TOTAL_ROW + 1
    ws.row_dimensions[SPACER5].height = 12
    for ci in range(1, 7): ws.cell(row=SPACER5, column=ci).fill = F(WHITE)

    TIP_ROW_ACC = SPACER5 + 1
    ws.merge_cells(start_row=TIP_ROW_ACC, start_column=1, end_row=TIP_ROW_ACC, end_column=6)
    c = ws.cell(row=TIP_ROW_ACC, column=1,
                value="  " + t("Συμβουλή: Ενημερώνετε τα κίτρινα κελιά όταν αλλάζουν τα υπόλοιπα.  Αλλάξτε την κατάσταση σε 'Ελήφθη' όταν φτάσουν τα χρήματα.",
                          "Tip: Update yellow cells whenever balances change.  Change status to Received when funds arrive."))
    c.font = Fnt(size=10, italic=True, color="FF6B7280")
    c.fill = F("FFF6F8FA"); c.alignment = Aln(h="left")
    ws.row_dimensions[TIP_ROW_ACC].height = 20

    # ── EXTRA ACCOUNTS & INCOMING — add more here; the totals above update. ──
    def _acc_section(row, title):
        ws.row_dimensions[row].height = 24
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=6)
        hc = ws.cell(row=row, column=1, value="  " + title)
        hc.fill = F(LIGHT_GREY); hc.font = Fnt(size=10, bold=True, color=DARK_BLUE)
        hc.alignment = Aln(h="left", v="center")
        hc.border = Border()

    # Owner + Τύπος appended — without Owner, an Extra Account balance had
    # nowhere to go in ANY Owner-based breakdown (CompanyFunds/PersonalFunds,
    # or Section 1's Μετρητά/Τράπεζες rows), so it counted in ΣΥΝΟΛΟ ΣΗΜΕΡΑ
    # but simply vanished the moment ViewMode was set to anything but Όλα.
    acc_headers_simple = [t("Λογαριασμός", "Account"),
                          t("Υπόλοιπο Έναρξης (€)", "Opening Balance (€)"),
                          t("Τελευταία Ενημέρωση", "Last Updated"),
                          t("Σημειώσεις", "Notes"),
                          t("Κάτοχος", "Owner"),
                          t("Τύπος", "Type"),
                          t("Μεταβολή από Κινήσεις", "Change from Transactions"),
                          t("Τρέχον Υπόλοιπο (€)", "Current Balance (€)")]
    inc_headers_simple = [t("Λογαριασμός", "Account"),
                          t("Υπόλοιπο (€)", "Balance (€)"),
                          t("Τελευταία Ενημέρωση", "Last Updated"),
                          t("Σημειώσεις", "Notes")]

    SPACER6 = TIP_ROW_ACC + 1
    ws.row_dimensions[SPACER6].height = 14
    for ci in range(1, 7): ws.cell(row=SPACER6, column=ci).fill = F(WHITE)

    EXTRA_ACC_HDR = SPACER6 + 1
    _acc_section(EXTRA_ACC_HDR, t("ΕΞΤΡΑ ΛΟΓΑΡΙΑΣΜΟΙ (πρόσθεσε εδώ)", "EXTRA ACCOUNTS (add here)"))
    EXTRA_ACC_COLHDR = EXTRA_ACC_HDR + 1
    for ci, h in enumerate(acc_headers_simple, 1):
        col_hdr(ws, EXTRA_ACC_COLHDR, ci, h)
    assert EXTRA_ACC_COLHDR + 1 == EXTRA_ACC_FIRST, "EXTRA_ACC_FIRST must match the pre-declared range used above"
    dv_extra_owner = DataValidation(type="list", formula1=f'"{OWNER_CORP},{OWNER_PERS}"',
                                    allow_blank=True, showDropDown=False)
    ws.add_data_validation(dv_extra_owner)
    dv_extra_type = DataValidation(type="list", formula1=f'"{ACC_TYPE_BANK},{ACC_TYPE_CASH}"',
                                   allow_blank=True, showDropDown=False)
    ws.add_data_validation(dv_extra_type)
    for r in range(EXTRA_ACC_FIRST, EXTRA_ACC_LAST + 1):   # 10 spare accounts
        ws.row_dimensions[r].height = 20
        inp(ws, r, 1, None, align_h="left")
        inp(ws, r, 2, None, EUR0)
        lbl(ws, r, 3, "", bg=WHITE)
        lbl(ws, r, 4, "", bg=WHITE)
        inp(ws, r, 5, None, align_h="center"); dv_extra_owner.add(ws.cell(row=r, column=5))
        inp(ws, r, 6, None, align_h="center"); dv_extra_type.add(ws.cell(row=r, column=6))
        # matched on the account's OWN typed name (column A) as the Πηγή —
        # without this, an Extra Account's balance was pure manual entry
        # that never moved even after real Κινήσεις got tagged to it,
        # unlike every account in the main table above.
        chg = ws.cell(row=r, column=7,
            value=(f'=IF($A{r}="","",SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_SOURCE}],$A{r},Table_Kin[{H_TYPE}],"{TYPE_INC}",Table_Kin[{H_STATUS}],"{S_PAID}",Table_Kin[{H_DATE}],">"&AccountBalanceDate)'
                   f'-SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_SOURCE}],$A{r},Table_Kin[{H_TYPE}],"{TYPE_EXP}",Table_Kin[{H_STATUS}],"{S_PAID}",Table_Kin[{H_DATE}],">"&AccountBalanceDate))'))
        chg.number_format = EUR0; chg.fill = F(LIGHT_GREY)
        chg.font = Fnt(size=10, italic=True, color="FF6B7280"); chg.alignment = Aln(h="right", v="center")
        cur = ws.cell(row=r, column=8, value=f'=IF($A{r}="","",B{r}+IF(G{r}="",0,G{r}))')
        cur.number_format = EUR0; cur.fill = F(WHITE)
        cur.font = Fnt(size=10, bold=True, color=DARK_BLUE); cur.alignment = Aln(h="right", v="center")

    SPACER7 = EXTRA_ACC_LAST + 1
    ws.row_dimensions[SPACER7].height = 14
    for ci in range(1, 7): ws.cell(row=SPACER7, column=ci).fill = F(WHITE)

    EXTRA_INC_HDR = SPACER7 + 1
    _acc_section(EXTRA_INC_HDR, t("ΕΞΤΡΑ ΕΙΣΕΡΧΟΜΕΝΑ (πρόσθεσε εδώ)", "EXTRA INCOMING (add here)"))
    EXTRA_INC_COLHDR = EXTRA_INC_HDR + 1
    for ci, h in enumerate(inc_headers_simple, 1):
        col_hdr(ws, EXTRA_INC_COLHDR, ci, h)
    assert EXTRA_INC_COLHDR + 1 == EXTRA_INC_FIRST, "EXTRA_INC_FIRST must match the pre-declared range used above"
    for r in range(EXTRA_INC_FIRST, EXTRA_INC_LAST + 1):   # 5 spare incoming
        ws.row_dimensions[r].height = 20
        inp(ws, r, 1, None, align_h="left")
        inp(ws, r, 2, None, EUR0)
        st = ws.cell(row=r, column=3); st.fill = F(YELLOW)
        st.alignment = Aln(h="center"); st.border = Brd()
        lbl(ws, r, 4, "", bg=WHITE)

    dv_acc_status = DataValidation(type="list", formula1="LIST_INCSTATUS",
                                   allow_blank=True, showDropDown=False)
    ws.add_data_validation(dv_acc_status)
    dv_acc_status.sqref = f"C{INCOMING_FIRST}:C{INCOMING_LAST} C{EXTRA_INC_FIRST}:C{EXTRA_INC_LAST}"

    # ══════════════════════════════════════════════════════════════════════════
    # TAB: SETUP  (first tab a new copy of this file needs — who owns it,
    # what version it is, and the disclaimer that belongs on anything
    # handed to a bank or partner. Version/changelog is text, not a formula
    # — bump WORKBOOK_VERSION below and add a line each time you regenerate
    # with a real content change.) ──
    # ══════════════════════════════════════════════════════════════════════════
    WORKBOOK_VERSION = "3.2"
    WORKBOOK_CHANGELOG = [
        ("3.2", t("Ταμείο πλέον βλέπει κόστος κατασκευής Q003 + δόση δανείων + NOI ενοικίων· ζωντανή μετατροπή οφειλής Αντώνη σε €500k· διορθώσεις IRR/NPV/Yield Μισθωμάτων (Levered στήλη, σταθεροπ. έτος)· μηνιαία λεπτομέρεια εκταμιεύσεων Έτους 1 στα Δάνεια· P&L & ανάλυση ευαισθησίας & waterfall εταίρων στη Σύνοψη/Μισθώματα· επιπλέον Έλεγχοι Ποιότητας.",
                   "Ταμείο now sees Q003 construction cost + loan debt service + rent NOI; live Αντώνης €500k debt conversion; Rent Roll IRR/NPV/Yield fixes (Levered column, stabilized year); Year-1 monthly draw detail on Δάνεια; P&L, sensitivity grid & partner waterfall added; extra Quality Checks.")),
        ("3.1", t("Έλεγχοι Ποιότητας, Παρακράτηση, Πιστωτικό ΦΠΑ, μίνι ισολογισμός, διόρθωση Χρυσού/Κρυπτού & Δανειακής Χρηματοδότησης.",
                   "Data Quality Checks, Withholding tax tab, VAT credit carry-forward, mini balance sheet, Gold/Crypto & Loan Financing fixes.")),
        ("3.0", t("Προβολή Εταιρικά/Προσωπικά/Όλα, ημερομηνία αντί μετρητή δόσεων, ομαδοποιημένες στήλες Κινήσεων, Σύνοψη μίας σελίδας.",
                   "Corporate/Personal/All view toggle, date instead of installment counter, grouped Κινήσεις columns, one-page Σύνοψη.")),
        ("2.0", t("Πλήρης επανασχεδίαση Κέντρου Ελέγχου, πραγματικό PivotTable, ρεαλιστική πρόβλεψη Ταμείου.",
                   "Full Control Center redesign, real PivotTable, realistic Ταμείο forecast.")),
        ("1.0", t("Αρχική έκδοση.", "Initial version.")),
    ]
    ws = ws_setup
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 30
    ws.column_dimensions["B"].width = 40
    ws.column_dimensions["C"].width = 50

    ws.row_dimensions[1].height = 34
    ws.merge_cells("A1:C1")
    c = ws.cell(row=1, column=1, value="  " + t("SETUP  —  ΣΤΟΙΧΕΙΑ ΑΡΧΕΙΟΥ", "SETUP  —  FILE INFORMATION"))
    c.fill = F(DARK_BLUE); c.font = Fnt(size=14, bold=True, color=WHITE)
    c.alignment = Aln(h="left", v="center")
    sheet_intro(ws, 2,
        t("Τα βασικά στοιχεία του αρχείου — εταιρεία, νόμισμα, τελευταία ενημέρωση. Καθαρά αναφορά, δεν "
          "επηρεάζει κανέναν υπολογισμό στα υπόλοιπα φύλλα.",
          "The file's basic reference info — company, currency, last update. Pure reference; it drives no "
          "calculation elsewhere in the workbook."),
        end_col="C")

    sec_hdr(ws, 3, t("ΣΤΟΙΧΕΙΑ ΕΤΑΙΡΕΙΑΣ", "COMPANY DETAILS"), number="1", end_col="C")
    spacer(ws, 4, 3, LIGHT_GREY)
    setup_rows = [
        (t("Επωνυμία", "Company Name"), "LA Budgeting"),
        (t("Νόμισμα", "Currency"), "EUR (€)"),
        (t("Ιδιοκτήτης Αρχείου", "File Owner"), ""),
    ]
    for i, (label, default) in enumerate(setup_rows):
        row = 5 + i
        ws.row_dimensions[row].height = 22
        lbl(ws, row, 1, label, bg=LIGHT_GREY)
        inp(ws, row, 2, default or None, align_h="left")
        ws.cell(row=row, column=3).fill = F(WHITE)
    SETUP_LAST = 4 + len(setup_rows)
    spacer(ws, SETUP_LAST + 1, 3)

    sec_hdr(ws, SETUP_LAST + 2, t("ΚΑΘΑΡΙΣΜΟΣ DEMO ΔΕΔΟΜΕΝΩΝ", "CLEARING DEMO DATA"), number="2", end_col="C")
    spacer(ws, SETUP_LAST + 3, 3, LIGHT_GREY)
    ws.merge_cells(start_row=SETUP_LAST + 4, start_column=1, end_row=SETUP_LAST + 4, end_column=3)
    cln = ws.cell(row=SETUP_LAST + 4, column=1,
        value="  " + t("Αυτό το αρχείο ξεκινά με πραγματικά δεδομένα (έργα, κινήσεις, λογαριασμοί) ως παράδειγμα δομής, όχι fake demo — δεν χρειάζεται «καθαρισμός», αλλά αν δίνετε το αρχείο σε τρίτο για νέο σκοπό: (1) διαγράψτε τις γραμμές στις Κινήσεις (Table_Kin) κρατώντας τις κεφαλίδες, (2) καθαρίστε τα ονόματα/κωδικούς στο Έργα, (3) μηδενίστε τα υπόλοιπα στο Λογαριασμοί, (4) διαγράψτε τις επαφές στο Επαφές.",
                          "This file starts with real data (projects, transactions, accounts) as a structural example, not fake demo data — no “clearing” needed, but if handing the file to someone else for a new purpose: (1) delete the rows in Κινήσεις (Table_Kin), keeping the headers, (2) clear the names/codes on Έργα, (3) zero the balances on Λογαριασμοί, (4) delete the contacts on Επαφές."))
    cln.font = Fnt(size=10, italic=True, color="FF6B7280")
    cln.fill = F("FFF6F8FA"); cln.alignment = Aln(h="left", wrap=True)
    ws.row_dimensions[SETUP_LAST + 4].height = 60
    SETUP_LAST2 = SETUP_LAST + 4
    spacer(ws, SETUP_LAST2 + 1, 3)

    sec_hdr(ws, SETUP_LAST2 + 2, t("ΕΚΔΟΣΗ & ΙΣΤΟΡΙΚΟ ΑΛΛΑΓΩΝ", "VERSION & CHANGELOG"), number="3", end_col="C")
    spacer(ws, SETUP_LAST2 + 3, 3, LIGHT_GREY)
    ws.row_dimensions[SETUP_LAST2 + 4].height = 20
    lbl(ws, SETUP_LAST2 + 4, 1, t("Τρέχουσα Έκδοση", "Current Version"), bold=True, bg=LIGHT_BLUE)
    vc = ws.cell(row=SETUP_LAST2 + 4, column=2, value=WORKBOOK_VERSION)
    vc.font = Fnt(size=11, bold=True, color=DARK_BLUE); vc.fill = F(LIGHT_BLUE); vc.alignment = Aln(h="left", v="center")
    ws.cell(row=SETUP_LAST2 + 4, column=3).fill = F(LIGHT_BLUE)
    CHANGELOG_FIRST = SETUP_LAST2 + 5
    for i, (ver, note) in enumerate(WORKBOOK_CHANGELOG):
        row = CHANGELOG_FIRST + i
        lines = wrap_lines(note, 50)
        ws.row_dimensions[row].height = 15 * lines + 8
        vc2 = ws.cell(row=row, column=1, value=ver)
        vc2.font = Fnt(size=10, bold=True, color=DARK_BLUE); vc2.fill = F(WHITE); vc2.alignment = Aln(h="left", v="top")
        nc2 = ws.cell(row=row, column=2, value=note)
        nc2.font = Fnt(size=9, color="FF374151"); nc2.fill = F(WHITE)
        nc2.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
        ws.merge_cells(start_row=row, start_column=2, end_row=row, end_column=3)
    CHANGELOG_LAST = CHANGELOG_FIRST + len(WORKBOOK_CHANGELOG) - 1
    spacer(ws, CHANGELOG_LAST + 1, 3)

    sec_hdr(ws, CHANGELOG_LAST + 2, t("ΠΑΡΑΔΟΧΕΣ & ΑΠΟΠΟΙΗΣΗ ΕΥΘΥΝΗΣ", "ASSUMPTIONS & DISCLAIMER"), number="4", end_col="C")
    spacer(ws, CHANGELOG_LAST + 3, 3, LIGHT_GREY)
    ws.merge_cells(start_row=CHANGELOG_LAST + 4, start_column=1, end_row=CHANGELOG_LAST + 4, end_column=3)
    disc = ws.cell(row=CHANGELOG_LAST + 4, column=1,
        value="  " + t("Αυτό το αρχείο είναι εργαλείο εσωτερικής παρακολούθησης, όχι λογιστική/φορολογική γνωμοδότηση. Όλες οι προβλέψεις (Ταμείο, IRR-τύπου δείκτες όπου υπάρχουν, χρηματοδοτικό κενό) βασίζονται σε δεδομένα και παραδοχές που καταχωρείτε εσείς (βλ. Ρυθμίσεις) και μπορεί να αλλάξουν χωρίς προειδοποίηση. Πριν χρησιμοποιηθεί για δανειακή αίτηση, φορολογική δήλωση ή άλλη επίσημη χρήση, επιβεβαιώστε τους αριθμούς με λογιστή/σύμβουλο.",
                          "This file is an internal tracking tool, not accounting or tax advice. Every forecast in it (Ταμείο, any IRR-style metrics, the financing gap) is built from data and assumptions you enter yourself (see Ρυθμίσεις) and can change without notice. Before using it for a loan application, tax filing, or other official purpose, confirm the numbers with an accountant/advisor."))
    disc.font = Fnt(size=10, italic=True, color="FF6B7280")
    disc.fill = F("FFF6F8FA"); disc.alignment = Aln(h="left", wrap=True)
    ws.row_dimensions[CHANGELOG_LAST + 4].height = 60

    # ══════════════════════════════════════════════════════════════════════════
    # TAB: ΡΥΘΜΙΣΕΙΣ  (dropdown source lists + standing assumptions, in ONE
    # editable place — every DataValidation elsewhere in the workbook points
    # here instead of an inline hardcoded list, so adding a new status/source
    # value is a plain Excel edit, no regenerate needed.) ──
    # ══════════════════════════════════════════════════════════════════════════
    ws = ws_set
    ws.sheet_view.showGridLines = False
    for letter, w in zip("ABCDEFGHI", (16, 16, 24, 14, 16, 20, 20, 16, 20)):
        ws.column_dimensions[letter].width = w
    # J/K/L widths for the 3 new lists appended below (Τύπος/Κατάσταση
    # Έργου, Βεβαιότητα) — additive, doesn't touch A-I.
    for letter, w in zip("JKL", (16, 16, 16)):
        ws.column_dimensions[letter].width = w
    ws.freeze_panes = "A5"

    ws.row_dimensions[1].height = 34
    ws.merge_cells("A1:I1")
    c = ws.cell(row=1, column=1, value="  ΡΥΘΜΙΣΕΙΣ")
    c.fill = F(DARK_BLUE); c.font = Fnt(size=14, bold=True, color=WHITE)
    c.alignment = Aln(h="left", v="center")

    ws.row_dimensions[2].height = 20
    ws.merge_cells("A2:I2")
    c = ws.cell(row=2, column=1,
                value="  " + t("Οι λίστες παρακάτω τροφοδοτούν όλα τα dropdown του αρχείου — προσθέστε μια νέα τιμή εδώ και θα εμφανιστεί αυτόματα παντού.",
                                "The lists below feed every dropdown in this workbook — add a new value here and it appears everywhere automatically."))
    c.font = Fnt(size=10, italic=True, color="FF6B7280")
    c.fill = F("FFF6F8FA"); c.alignment = Aln(h="left", wrap=True)

    spacer(ws, 3, 6)

    set_headers = [t("Τύπος", "Type"), t("Κατάσταση", "Status"), t("Πηγή", "Source"),
                   t("Προέλευση", "Origin"), t("Επαναλαμβανόμενο", "Recurring"),
                   t("Κατάσταση Εισερχομένων", "Incoming Status"), t("Κατάσταση Υποβολής ΦΠΑ", "VAT Filing Status"),
                   t("Πεδίο", "Scope"), t("Κατηγορία (Προσωπικά)", "Category (Personal)"),
                   # 3 new lists, ported from Επιχειρησιακό_Αρχείο_107.xlsx's own
                   # Ρυθμίσεις sheet (Τύπος Έργου/Κατάσταση Έργου columns, read
                   # directly off that sheet) plus a new certainty scale for the
                   # dashboard's incoming-funds table — appended after the
                   # existing 9 columns, doesn't touch them.
                   t("Τύπος Έργου", "Project Type"), t("Κατάσταση Έργου", "Project Status"),
                   t("Βεβαιότητα", "Certainty")]
    for ci, h in enumerate(set_headers, 1):
        col_hdr(ws, 4, ci, h)

    VAT_FILED, VAT_PENDING = t("Υποβλήθηκε", "Filed"), t("Εκκρεμεί", "Pending")
    # CAT_* (personal spending categories) defined near SCOPE_BIZ/H_SCOPE at
    # the top of build_workbook() — Κέντρο Ελέγχου's Personal Spending
    # rollup, built before this sheet, already needs them.
    set_lists = [
        [TYPE_INC, TYPE_EXP],
        [S_PAID, S_UPCOM, S_HOLD, S_SCHED],
        # SRC_TBD deliberately NOT in this list — it's "don't know yet",
        # not a real account, and as long as it was selectable it kept
        # getting selected (that's exactly how 36 real transactions ended
        # up with no account and stopped moving any bank balance). The
        # constant itself still exists for formulas/legacy-data checks
        # (the Κατάσταση validation, the QC check, Bank Rec) — only the
        # dropdown option is gone.
        [SRC_OPT_CORP, SRC_PIR_PERS, SRC_ALPHA, SRC_OPT_PERS, SRC_N26, SRC_CASH, SRC_GOLD, SRC_CRYPTO],
        [ORIG_MANUAL, ORIG_AADE],
        [REC_YES, REC_NO],
        [A_PEND, A_RECV, A_CANC],
        [VAT_FILED, VAT_PENDING],
        [SCOPE_BIZ, SCOPE_PERS],
        # the original 10 CAT_* values PLUS the 15-category taxonomy ported
        # from Επιχειρησιακό_Αρχείο_107.xlsx's Καθημερινά sheet, appended —
        # every existing value/order stays exactly as it was.
        [CAT_HOUSING, CAT_UTILS, CAT_GROCERY, CAT_TRANSPORT, CAT_HEALTH,
         CAT_INSURANCE, CAT_EDU, CAT_FUN, CAT_CLOTHES, CAT_OTHER] + PERSONAL_CATEGORIES_DETAIL,
        # Τύπος Έργου / Κατάσταση Έργου — values read directly off
        # Επιχειρησιακό_Αρχείο_107.xlsx's own Ρυθμίσεις sheet columns of the
        # same name (rows 4-8 there).
        [t("Κατασκευή", "Construction"), t("Εγκατάσταση", "Installation"),
         t("Ανακαίνιση", "Renovation"), t("Φιλοξενία", "Hospitality"), t("Γενικά", "General")],
        [t("Προσφορά", "Offer"), t("Ενεργό", "Active"), t("Σε αναμονή", "On Hold"),
         t("Ολοκληρωμένο", "Completed"), t("Ακυρωμένο", "Cancelled")],
        # Βεβαιότητα — new 3-way certainty scale for the dashboard's
        # incoming-funds table (Section 6, Κέντρο Ελέγχου).
        [t("Βέβαιη", "Certain"), t("Πιθανή", "Probable"), t("Σε αίτηση", "In Application")],
    ]
    LIST_NAMES = ["LIST_TYPE", "LIST_STATUS", "LIST_SOURCE", "LIST_ORIGIN", "LIST_REC",
                  "LIST_INCSTATUS", "LIST_VATSTATUS", "LIST_SCOPE", "LIST_CATEGORY",
                  "LIST_PROJTYPE", "LIST_PROJSTATUS", "LIST_CERTAINTY"]
    SET_LIST_FIRST = 5
    set_max_len = max(len(l) for l in set_lists)
    for ci, values in enumerate(set_lists, 1):
        for ri, val in enumerate(values):
            row = SET_LIST_FIRST + ri
            cc = ws.cell(row=row, column=ci, value=val)
            cc.fill = F(YELLOW); cc.alignment = Aln(h="left", v="center")
            cc.font = Fnt(size=10); cc.protection = UNLOCKED

    # blank rows past the longest list, per column, stay unlocked too
    # (unfilled so no YELLOW fill to key off) — this is what lets someone add
    # a brand-new status/source/category value directly under a shorter
    # list, per the "add a new value here" note above, without hitting
    # sheet protection. LIST_MAX_ROW also bounds the COUNTA scan below, so
    # it needs real headroom past what's pre-filled today.
    LIST_MAX_ROW = SET_LIST_FIRST + 200
    for ci in range(1, len(set_lists) + 1):
        for row in range(SET_LIST_FIRST, LIST_MAX_ROW + 1):
            ws.cell(row=row, column=ci).protection = UNLOCKED

    # every dropdown elsewhere in the workbook (Κινήσεις's Τύπος/Κατάσταση/
    # Πηγή/Προέλευση/Επαναλαμβανόμενο/Πεδίο/Κατηγορία, Λογαριασμοί's incoming
    # status, ΦΠΑ's filing status) points at one of these named ranges
    # instead of a fixed "$X$5:$X$N" address. COUNTA sizes each range to
    # exactly the non-blank cells starting at row 5, so appending a new
    # value to a list makes it show up in every dropdown that uses it
    # immediately — no fixed row-count ceiling, no regenerate needed. This
    # is what actually fixes the old fixed-range limitation, not just the
    # unlocked cells above (which only made typing the new value possible).
    for ci, name in enumerate(LIST_NAMES, 1):
        letter = get_column_letter(ci)
        formula = (f"OFFSET('Ρυθμίσεις'!${letter}${SET_LIST_FIRST},0,0,"
                   f"COUNTA('Ρυθμίσεις'!${letter}${SET_LIST_FIRST}:${letter}${LIST_MAX_ROW}),1)")
        wb.defined_names[name] = DefinedName(name, attr_text=formula)

    ASSUMP_HDR = SET_LIST_FIRST + set_max_len + 1
    spacer(ws, ASSUMP_HDR - 1, 6)
    sec_hdr(ws, ASSUMP_HDR, t("ΠΑΡΑΔΟΧΕΣ", "ASSUMPTIONS"))
    spacer(ws, ASSUMP_HDR + 1, 5, LIGHT_GREY)
    ws.row_dimensions[ASSUMP_HDR + 2].height = 20
    lbl(ws, ASSUMP_HDR + 2, 1, t("Συντελεστής ΦΠΑ", "VAT Rate"), bg=LIGHT_GREY)
    vrc = ws.cell(row=ASSUMP_HDR + 2, column=2, value=0.24)
    vrc.number_format = "0%"; vrc.fill = F(YELLOW); vrc.alignment = Aln(h="right")
    ws.row_dimensions[ASSUMP_HDR + 3].height = 20
    lbl(ws, ASSUMP_HDR + 3, 1, t("Ελάχιστο Απόθεμα Ασφαλείας", "Minimum Cash Safety Buffer"), bg=LIGHT_GREY)
    cbc = ws.cell(row=ASSUMP_HDR + 3, column=2, value=50000)
    cbc.number_format = EUR0; cbc.fill = F(YELLOW); cbc.alignment = Aln(h="right")
    # named so Κέντρο Ελέγχου's runway KPI and Ταμείο's amber warning can
    # reference "the safety buffer" without hardcoding this cell address —
    # change the number here and both update on their own.
    wb.defined_names["MinCashBuffer"] = DefinedName(
        "MinCashBuffer", attr_text=f"Ρυθμίσεις!$B${ASSUMP_HDR + 3}")

    # Προβολή (Εταιρικά/Προσωπικά/Όλα) is now a visible dropdown at H1 on
    # Κέντρο Ελέγχου itself — it drives that dashboard's headline funds
    # figures AND Ταμείο's Opening Balance, so it lives where those numbers
    # are actually read instead of buried here. This is a read-only mirror,
    # not a second input, so there's only ever one place to change it.
    ws.row_dimensions[ASSUMP_HDR + 4].height = 20
    lbl(ws, ASSUMP_HDR + 4, 1, t("Προβολή Ταμείου (βλ. Κέντρο Ελέγχου)", "Cash View (see Κέντρο Ελέγχου)"), bg=LIGHT_GREY)
    vmc = ws.cell(row=ASSUMP_HDR + 4, column=2, value="=ViewMode")
    vmc.fill = F(LIGHT_GREY); vmc.alignment = Aln(h="right")
    vmc.font = Fnt(italic=True, color="FF6B7280")

    # an indefinite recurring plan (blank Αριθμός Επαναλήψεων — an
    # open-ended rent, a subscription with no end date) used to make
    # Υπόλοιπο Δέσμευσης return the TEXT "Αόριστο", which every SUMIFS
    # silently treats as 0 — so an indefinite rent contributed nothing to
    # Σύνολο Υποχρεώσεων at all. This horizon turns that into a real,
    # adjustable number of months' worth of commitment instead.
    ws.row_dimensions[ASSUMP_HDR + 5].height = 20
    lbl(ws, ASSUMP_HDR + 5, 1, t("Ορίζοντας Αόριστων Επαναλήψεων (μήνες)", "Indefinite Recurring Horizon (months)"), bg=LIGHT_GREY)
    ihc = ws.cell(row=ASSUMP_HDR + 5, column=2, value=24)
    ihc.number_format = "0"; ihc.fill = F(YELLOW); ihc.alignment = Aln(h="right")
    wb.defined_names["IndefiniteHorizonMonths"] = DefinedName(
        "IndefiniteHorizonMonths", attr_text=f"Ρυθμίσεις!$B${ASSUMP_HDR + 5}")

    # ── ΣΕΝΑΡΙΟ — Base/Conservative/Aggressive. Reuses the Ποσό Σταθμισμένο
    # infrastructure (Κινήσεις!AH, already multiplying each upcoming Έσοδο
    # by its own per-row collection probability) instead of duplicating it:
    # ScenarioProbFactor is a SECOND multiplier stacked on top of that
    # per-row probability, so the switch discounts every not-yet-paid
    # income across the board without touching what's already paid or any
    # expense. ScenarioCostFactor does the equivalent for the budget side
    # (Προϋπολογισμοί's ΣΥΝΟΛΙΚΟΣ ΠΡΟΫΠΟΛΟΓΙΣΜΟΣ). Drawdown-delay-in-months
    # (the third lever you asked for) is NOT wired in this pass — shifting
    # dated cash events per scenario touches Ταμείο's month-matching logic
    # in a way that needs its own careful pass, not bolted on here.
    ws.row_dimensions[ASSUMP_HDR + 6].height = 20
    lbl(ws, ASSUMP_HDR + 6, 1, t("Σενάριο", "Scenario"), bg=LIGHT_GREY)
    SCN_BASE = t("Βασικό", "Base")
    SCN_CONS = t("Συντηρητικό", "Conservative")
    SCN_AGGR = t("Επιθετικό", "Aggressive")
    scnc = ws.cell(row=ASSUMP_HDR + 6, column=2, value=SCN_BASE)
    scnc.fill = F(YELLOW); scnc.alignment = Aln(h="right")
    dv_scn = DataValidation(type="list", formula1=f'"{SCN_BASE},{SCN_CONS},{SCN_AGGR}"',
                            allow_blank=False, showDropDown=False)
    ws.add_data_validation(dv_scn); dv_scn.sqref = f"B{ASSUMP_HDR + 6}"
    wb.defined_names["Scenario"] = DefinedName("Scenario", attr_text=f"Ρυθμίσεις!$B${ASSUMP_HDR + 6}")
    # Conservative: knock 30% off every not-yet-paid income row's own
    # probability, and load 10% onto the total budget. Aggressive: boost
    # every not-yet-paid income row's own probability by 20% — capped at
    # 100% downstream (see H_AMOUNT_WEIGHTED), so a row already at 100%
    # genuinely can't move further, but a flagged 50%-confidence tranche
    # becomes 60% under Aggressive — it has real effect now, not the same
    # ×1 as Base. Aggressive also shaves 5% off the budget.
    scn_prob_c = ws.cell(row=ASSUMP_HDR + 6, column=3,
        value=f'=IF(B{ASSUMP_HDR+6}="{SCN_CONS}",0.7,IF(B{ASSUMP_HDR+6}="{SCN_AGGR}",1.2,1))')
    scn_prob_c.number_format = "0%"; scn_prob_c.fill = F(WHITE)
    scn_prob_c.font = Fnt(size=9, italic=True, color="FF6B7280"); scn_prob_c.alignment = Aln(h="center")
    wb.defined_names["ScenarioProbFactor"] = DefinedName("ScenarioProbFactor", attr_text=f"Ρυθμίσεις!$C${ASSUMP_HDR + 6}")
    scn_cost_c = ws.cell(row=ASSUMP_HDR + 6, column=4,
        value=f'=IF(B{ASSUMP_HDR+6}="{SCN_CONS}",1.1,IF(B{ASSUMP_HDR+6}="{SCN_AGGR}",0.95,1))')
    scn_cost_c.number_format = "0%"; scn_cost_c.fill = F(WHITE)
    scn_cost_c.font = Fnt(size=9, italic=True, color="FF6B7280"); scn_cost_c.alignment = Aln(h="center")
    wb.defined_names["ScenarioCostFactor"] = DefinedName("ScenarioCostFactor", attr_text=f"Ρυθμίσεις!$D${ASSUMP_HDR + 6}")

    # Ημερομηνία Υπολοίπων Έναρξης — the date the "Υπόλοιπο Έναρξης" column
    # on Λογαριασμοί/8. Λογαριασμοί is confirmed AS OF (mirrors
    # Επιχειρησιακό_Αρχείο_107.xlsx's own Ρυθμίσεις!C28: "Τα υπόλοιπα στο
    # φύλλο Λογαριασμοί ισχύουν αυτή την ημέρα. Μόνο κινήσεις ΜΕΤΑ από αυτήν
    # τα μεταβάλλουν."). Without this, "Μεταβολή από Κινήσεις" summed EVERY
    # Πληρωμένο row ever recorded for that Πηγή — including years of
    # AADE-imported history that predates the confirmed opening balance —
    # double-counting money already baked into Υπόλοιπο Έναρξης and
    # overstating the swing (e.g. Optima Εταιρικός showed a -84.553 €
    # "movement" against a real bank-confirmed opening balance, most of it
    # AADE rows back to March 2025 plus a handful of 2025 manual rows, none
    # of which happened after the balance was confirmed). Table_Kin rows
    # dated ON OR BEFORE this date are excluded from every account's
    # Μεταβολή SUMIFS below — the strict ">" match is the same operator the
    # business file's own formula uses.
    ws.row_dimensions[ASSUMP_HDR + 7].height = 20
    lbl(ws, ASSUMP_HDR + 7, 1, t("Ημερομηνία Υπολοίπων Έναρξης", "Opening Balances As-Of Date"), bg=LIGHT_GREY)
    bdc = ws.cell(row=ASSUMP_HDR + 7, column=2, value=datetime.date(2026, 8, 21))
    bdc.number_format = "DD/MM/YYYY"; bdc.fill = F(YELLOW); bdc.alignment = Aln(h="right")
    wb.defined_names["AccountBalanceDate"] = DefinedName(
        "AccountBalanceDate", attr_text=f"Ρυθμίσεις!$B${ASSUMP_HDR + 7}")

    ws.merge_cells(start_row=ASSUMP_HDR + 8, start_column=1, end_row=ASSUMP_HDR + 8, end_column=7)
    c = ws.cell(row=ASSUMP_HDR + 8, column=1,
                value="  " + t("Ο Συντελεστής ΦΠΑ είναι σημείο αναφοράς. Το Ελάχιστο Απόθεμα Ασφαλείας ΟΔΗΓΕΙ την πρόβλεψη «πότε θα τρέξουμε χαμηλά σε ρευστό» στο Κέντρο Ελέγχου και στο Ταμείο. Ο Ορίζοντας Αόριστων Επαναλήψεων ΟΔΗΓΕΙ το Υπόλοιπο Δέσμευσης/Σύνολο Υποχρεώσεων για ρυθμίσεις χωρίς καθορισμένο αριθμό δόσεων. Το Σενάριο ΟΔΗΓΕΙ την πρόβλεψη εσόδων στο Ταμείο (Συντηρητικό = ×70% σε κάθε εκκρεμές έσοδο) και τον προϋπολογισμό στο Προϋπολογισμοί (Συντηρητικό = +10%, Επιθετικό = −5%). Η Ημερομηνία Υπολοίπων Έναρξης ΟΔΗΓΕΙ ποιες Κινήσεις μετράνε στο «Μεταβολή από Κινήσεις» του Λογαριασμοί — μόνο κινήσεις ΜΕΤΑ από αυτή την ημερομηνία· ενημερώστε την όποτε επιβεβαιώνετε νέο υπόλοιπο τραπέζης — αλλάξτε τα εδώ κι όλα ενημερώνονται αυτόματα.",
                                "The VAT Rate is for reference only. The Minimum Cash Safety Buffer DRIVES the 'when do we run low on cash' forecast on Κέντρο Ελέγχου and Ταμείο. The Indefinite Recurring Horizon DRIVES Remaining Commitment/Total Committed for plans with no set installment count. Scenario DRIVES the income forecast on Ταμείο (Conservative = ×70% on every pending income row) and the budget on Προϋπολογισμοί (Conservative = +10%, Aggressive = −5%). Opening Balances As-Of Date DRIVES which Κινήσεις rows count in Λογαριασμοί's 'Change from Transactions' — only transactions AFTER this date; update it whenever you confirm a new bank balance — change them here and everything updates automatically."))
    c.font = Fnt(size=10, italic=True, color="FF6B7280")
    c.fill = F("FFF6F8FA"); c.alignment = Aln(h="left", wrap=True)
    ws.row_dimensions[ASSUMP_HDR + 8].height = 40

    # ── ΕΠΕΝΔΥΤΙΚΑ & ΔΑΝΕΙΑ — feeds Μισθώματα & Αποδόσεις (IRR/NPV/yield)
    # and Δάνεια (amortization/DSCR), both built later in this file. All
    # four are flagged placeholders, not real terms — replace with the
    # actual agreed numbers once you have them. ──
    INV_HDR = ASSUMP_HDR + 10
    spacer(ws, INV_HDR - 1, 6)
    sec_hdr(ws, INV_HDR, t("ΕΠΕΝΔΥΤΙΚΑ & ΔΑΝΕΙΑ", "INVESTMENT & LOANS"))
    spacer(ws, INV_HDR + 1, 5, LIGHT_GREY)
    ws.row_dimensions[INV_HDR + 2].height = 20
    lbl(ws, INV_HDR + 2, 1, t("Προεξοφλητικό Επιτόκιο (NPV/IRR)", "Discount Rate (NPV/IRR)"), bg=LIGHT_GREY)
    drc = ws.cell(row=INV_HDR + 2, column=2, value=0.08)
    drc.number_format = "0,0%"; drc.fill = F(YELLOW); drc.alignment = Aln(h="right")
    wb.defined_names["DiscountRate"] = DefinedName("DiscountRate", attr_text=f"Ρυθμίσεις!$B${INV_HDR + 2}")
    ws.row_dimensions[INV_HDR + 3].height = 20
    lbl(ws, INV_HDR + 3, 1, t("Λειτουργικά Έξοδα (% Μισθώματος)", "Operating Expenses (% of Rent)"), bg=LIGHT_GREY)
    opc = ws.cell(row=INV_HDR + 3, column=2, value=0.15)
    opc.number_format = "0%"; opc.fill = F(YELLOW); opc.alignment = Aln(h="right")
    wb.defined_names["DefaultOpexPct"] = DefinedName("DefaultOpexPct", attr_text=f"Ρυθμίσεις!$B${INV_HDR + 3}")
    ws.row_dimensions[INV_HDR + 4].height = 20
    lbl(ws, INV_HDR + 4, 1, t("Περίοδος Χάριτος Δανείων (μήνες)", "Loan Grace Period (months)"), bg=LIGHT_GREY)
    gpc = ws.cell(row=INV_HDR + 4, column=2, value=12)
    gpc.number_format = "0"; gpc.fill = F(YELLOW); gpc.alignment = Aln(h="right")
    wb.defined_names["LoanGraceMonths"] = DefinedName("LoanGraceMonths", attr_text=f"Ρυθμίσεις!$B${INV_HDR + 4}")
    ws.row_dimensions[INV_HDR + 5].height = 20
    lbl(ws, INV_HDR + 5, 1, t("Διάρκεια Αποπληρωμής Δανείων (έτη)", "Loan Repayment Term (years)"), bg=LIGHT_GREY)
    ltc = ws.cell(row=INV_HDR + 5, column=2, value=15)
    ltc.number_format = "0"; ltc.fill = F(YELLOW); ltc.alignment = Aln(h="right")
    wb.defined_names["LoanTermYears"] = DefinedName("LoanTermYears", attr_text=f"Ρυθμίσεις!$B${INV_HDR + 5}")
    ws.merge_cells(start_row=INV_HDR + 6, start_column=1, end_row=INV_HDR + 6, end_column=7)
    c2 = ws.cell(row=INV_HDR + 6, column=1,
        value="  " + t("Και τα 4 είναι σημειωμένες παραδοχές, όχι πραγματικοί συμφωνημένοι όροι — αντικαταστήστε τα με τους πραγματικούς αριθμούς μόλις τους έχετε. Οδηγούν το Μισθώματα & Αποδόσεις (IRR/NPV/yield) και το Δάνεια (χρεολύσιο/DSCR).",
                        "All four are flagged placeholders, not real agreed terms — replace with the real numbers once you have them. They drive Μισθώματα & Αποδόσεις (IRR/NPV/yield) and Δάνεια (amortization/DSCR)."))
    c2.font = Fnt(size=10, italic=True, color="FF6B7280")
    c2.fill = F("FFF6F8FA"); c2.alignment = Aln(h="left", wrap=True)
    ws.row_dimensions[INV_HDR + 6].height = 32

    # ══════════════════════════════════════════════════════════════════════════
    # TAB: ΤΑΜΕΙΟ  (66-month rolling cash flow — chained Opening -> Net Change
    # -> Closing balance, entirely SUMIFS off Table_Kin + Λογαριασμοί's real
    # current total; nothing here is a second data source.) ──
    # ══════════════════════════════════════════════════════════════════════════
    ws = ws_cash
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 14
    for letter in "BCDEF":
        ws.column_dimensions[letter].width = 18
    ws.column_dimensions["G"].width = 16
    ws.column_dimensions["H"].width = 18
    ws.column_dimensions["I"].width = 18
    for letter in ("J", "K", "L"):
        ws.column_dimensions[letter].width = 18
    ws.freeze_panes = "A4"

    ws.row_dimensions[1].height = 34
    ws.merge_cells("A1:I1")
    c = ws.cell(row=1, column=1, value="  " + t("ΤΑΜΕΙΟ  —  ΚΥΛΙΟΜΕΝΗ ΠΡΟΒΛΕΨΗ 66 ΜΗΝΩΝ", "CASH FLOW  —  ROLLING 66-MONTH FORECAST"))
    c.fill = F(DARK_BLUE); c.font = Fnt(size=14, bold=True, color=WHITE)
    c.alignment = Aln(h="left", v="center")
    sheet_intro(ws, 2,
        t("Η κυλιόμενη πρόβλεψη 66 μηνών — κάθε μήνας παίρνει το υπόλοιπο λήξης του προηγούμενου ως υπόλοιπο "
          "έναρξης. Το «Όριο Ασφαλείας» δείχνει πότε το ρευστό πέφτει επικίνδυνα χαμηλά, πολύ πιο νωρίς από "
          "ό,τι θα φαινόταν αν κοιτούσατε μόνο το σημερινό υπόλοιπο.",
          "The rolling 66-month forecast — each month's opening balance is the prior month's closing balance. "
          "The Safety Buffer column flags when cash runs dangerously low, far earlier than a single today's-"
          "balance figure ever would."),
        end_col="I")

    cash_headers = [t("Μήνας", "Month"), t("Έσοδα (Πραγματικό+Μοντέλο)", "Income (Actual+Model)"),
                    t("Έξοδα (Πραγματικό+Μοντέλο)", "Expenses (Actual+Model)"),
                    t("Καθαρή Μεταβολή", "Net Change"), t("Υπόλοιπο Έναρξης", "Opening Balance"),
                    t("Υπόλοιπο Λήξης (Πραγματικό+Μοντέλο)", "Closing Balance (Actual+Model)"),
                    t("Όριο Ασφαλείας", "Safety Buffer"),
                    t("— εκ των οποίων Βεβαιωμένα", "— of which Confirmed"),
                    t("— εκ των οποίων Πιθανά (σταθμ.)", "— of which Probable (weighted)"),
                    t("Έσοδα (Πραγματικό μόνο)", "Income (Actual only)"),
                    t("Έξοδα (Πραγματικό μόνο)", "Expenses (Actual only)"),
                    t("Υπόλοιπο Λήξης (Πραγματικό μόνο)", "Closing Balance (Actual only)")]
    for ci, h in enumerate(cash_headers, 1):
        col_hdr(ws, 3, ci, h)

    CASH_FIRST = 4
    CASH_MONTHS = 66   # 5.5 years forward — extended from 5 years so
                       # Αντώνη's 2031-09-30 debt maturity (below) actually
                       # falls inside the visible window instead of the
                       # "ασφαλής" verdict silently ignoring it. Otherwise
                       # long enough to show the tail of the longest
                       # recurring plan in the ledger (the 72-installment
                       # settlement runs 6 years). Forward-looking only,
                       # starting this month — chaining backward from
                       # "today" has no well-defined opening balance.
    # Λογαριασμοί's ΟΦΕΙΛΕΣ/incoming tables track two real, dated cash
    # events the month-by-month build below otherwise never sees (it only
    # reads Table_Kin): Αντώνη's €340k debt, due on its stated date, and
    # his €160k incoming, expected per the existing note text. Deliberately
    # NOT modeling the debt's stated "becomes €500k once the €160k lands"
    # compounding, and NOT injecting Άλμπερτ's incoming — neither has an
    # agreed date, so guessing one would fabricate certainty that isn't
    # there. See the tip text below for the same caveat in the workbook.
    DEBT_MONTH, DEBT_AMOUNT = "2031-09", 340000
    INCOMING_MONTH, INCOMING_AMOUNT = "2026-09", 160000
    # actual VAT payments (ΦΠΑ!G/H — Ποσό Πληρωμής/Ημ/νία Πληρωμής), matched
    # by the payment date's own year-month against this row's month — not
    # ΦΠΑ's Net Position, which is a filing-period POSITION, not a cash
    # event, and not every position gets paid in full or on time. Blank
    # payment dates just never match any {mref} string, so they contribute
    # 0 without needing an IFERROR/ISBLANK guard.
    VAT_PAY_RNG_AMT, VAT_PAY_RNG_DATE = "\'10. ΦΠΑ\'!$G$4:$G$27", "\'10. ΦΠΑ\'!$H$4:$H$27"

    def _view_scoped(col_name, type_filter, mode="any", exclude_status=None):
        """Same ViewMode switch as FUNDS_F (Εταιρικά/Προσωπικά/Όλα), applied
        to a monthly Table_Kin total instead of a Λογαριασμοί balance —
        Opening Balance already followed ViewMode, but the monthly Income/
        Expense rows summed every Table_Kin row regardless of Πεδίο, so a
        Corporate-only view still had personal spending eating into it.
        ViewMode's own text ("Εταιρικά") and Table_Kin[Πεδίο]'s text
        ("Επιχειρηματικό") are different words for the same idea, not
        interchangeable strings — so the mapping is done in Python via
        _recur_monthly's scope= kwarg (building three complete, correctly-
        filtered formulas ahead of time), not via a live text comparison
        between the two columns."""
        corp_f = _recur_monthly(col_name, type_filter, mref, scope=SCOPE_BIZ, mode=mode, exclude_status=exclude_status)
        pers_f = _recur_monthly(col_name, type_filter, mref, scope=SCOPE_PERS, mode=mode, exclude_status=exclude_status)
        all_f = _recur_monthly(col_name, type_filter, mref, mode=mode, exclude_status=exclude_status)
        return f'IF(ViewMode="{VIEW_CORP}",{corp_f},IF(ViewMode="{VIEW_PERS}",{pers_f},{all_f}))'

    for i in range(CASH_MONTHS):
        row = CASH_FIRST + i
        ws.row_dimensions[row].height = 18
        edate = f"EDATE(TODAY(),{i})"
        mc = ws.cell(row=row, column=1, value=f'=YEAR({edate})&"-"&TEXT(MONTH({edate}),"00")')
        mc.fill = F(LIGHT_GREY); mc.alignment = Aln(h="center", v="center"); mc.font = Fnt(size=10, bold=True, color=DARK_BLUE)
        mref = f"$A{row}"
        vat_pay_f = (f'SUMPRODUCT((YEAR({VAT_PAY_RNG_DATE})&"-"&TEXT(MONTH({VAT_PAY_RNG_DATE}),"00")={mref})'
                     f'*({VAT_PAY_RNG_DATE}<>"")*{VAT_PAY_RNG_AMT})')
        # H_AMOUNT_WEIGHTED (not H_AMOUNT) — every Έσοδο row's amount is
        # already pre-multiplied by its own Πιθανότητα Είσπραξης (100% for
        # everything except rows someone has explicitly flagged uncertain),
        # so a loan tranche "in application" no longer counts as full-value
        # confirmed cash the moment it's dated. ExpectedFromAntonis (not a
        # hardcoded 160000) so editing Λογαριασμοί actually moves this, and
        # gated on the SAME status cell Λογαριασμοί itself uses — once you
        # flip it to Ελήφθη the money is already counted as a real balance,
        # so injecting it here again would double it.
        # Q003's rent NOI (Μισθώματα & Αποδόσεις), spread evenly across each
        # calendar year it applies to — the hotel opens, rents out, and
        # this used to never reach Ταμείο at all.
        rent_noi_f = f'SUMPRODUCT((Q003RentCalYears=VALUE(LEFT({mref},4)))*Q003RentNOI)/12'
        not_personal = f'ViewMode<>"{VIEW_PERS}"'
        # Αντώνη's debt/incoming ARE the company's (the €1.6M/€500k figures
        # live on Λογαριασμοί's own ΟΦΕΙΛΕΣ/ΕΙΣΕΡΧΟΜΕΝΑ tables tied to Q003
        # financing) — previously left ungated on the theory that private-
        # party debt ownership was ambiguous, but a Personal-only Ταμείο
        # crediting the company's incoming loan and debiting the company's
        # debt is the same leak already fixed for VAT/Q003/loan-DS below;
        # gated the same way now.
        # Ίδια συμμετοχή (Προϋπολογισμοί) — the equity side of Q003's
        # financing, previously invisible here entirely (see OwnEquityDates
        # above). Blank injection dates contribute €0, same "don't guess a
        # date" rule as everywhere else in this sheet.
        own_equity_f = (f'SUMPRODUCT((TEXT(YEAR(OwnEquityDates),"0000")&"-"'
                        f'&TEXT(MONTH(OwnEquityDates),"00")={mref})*(OwnEquityDates<>"")*OwnEquityAmounts)')
        inc = ws.cell(row=row, column=2,
            value=(f'=ROUND({_view_scoped(H_AMOUNT_WEIGHTED, TYPE_INC, exclude_status=S_SCHED)}'
                   f'+IF(AND({not_personal},{mref}="{INCOMING_MONTH}",ExpectedFromAntonisStatus<>"{A_RECV}"),ExpectedFromAntonis,0)'
                   f'+IF({not_personal},{rent_noi_f}+({own_equity_f}),0),2)'))
        # Q003's planned construction spend (Πρόοδος Έργου) and BOTH loans'
        # debt service (Δάνεια) used to be entirely invisible here — the
        # forecast showed a stable positive balance while a real €2.16M
        # commitment sat completely off this sheet. q003_planned_f adds
        # whatever THIS month's planned spend isn't covered by an actual
        # Κινήσεις entry yet (now scaled by ScenarioCostFactor, same as the
        # budget total it's drawn from); loan_ds_f spreads each calendar
        # year's combined annual debt service evenly across its 12 months.
        # All three of VAT/Q003-construction/loan-debt-service are real
        # company-only obligations, so — unlike the Αντώνη debt/incoming
        # (a private, ambiguously-owned debt left unconditional on
        # purpose) — they're gated OUT of the Personal view: a Personal-
        # only Ταμείο shouldn't be charged the company's VAT bill or Q003's
        # construction loan. The recorded Table_Kin expenses ARE scaled by
        # ScenarioCostFactor too now — weighted income against unweighted
        # expenses was comparing two different bases.
        # gated to the CURRENT month or later — every cell on this sheet
        # recalculates live against today's real date, so a PAST month's
        # planned/unbooked estimate would otherwise get "spent" here even
        # after the real invoice for it later shows up (dated in whatever
        # month it actually posted, possibly a different one than the
        # smoothed S-curve planned) — Sheet 15's H column nets planned
        # against actual WITHIN that same month, but can't undo an already-
        # spent phantom estimate sitting in an earlier, already-passed
        # month row here. Restricting the injection to current/future
        # months means a past month only ever shows its real actuals (via
        # the direct SUMIFS term below), eliminating the double-count the
        # first real construction invoice used to trigger.
        _cur_month_ref = 'YEAR(TODAY())&"-"&TEXT(MONTH(TODAY()),"00")'
        q003_planned_f = (f'IF({mref}>=({_cur_month_ref}),SUMPRODUCT((TEXT(YEAR(Q003PlannedOutflowDates),"0000")&"-"'
                          f'&TEXT(MONTH(Q003PlannedOutflowDates),"00")={mref})*Q003PlannedOutflowAmounts)*ScenarioCostFactor,0)')
        loan_ds_f = f'SUMPRODUCT((LoanDebtServiceYears=VALUE(LEFT({mref},4)))*LoanDebtServiceAmounts)/12'
        exp = ws.cell(row=row, column=3,
            value=(f'=ROUND(({_view_scoped(H_AMOUNT, TYPE_EXP, exclude_status=S_SCHED)})*ScenarioCostFactor'
                   f'+IF(AND({not_personal},{mref}="{DEBT_MONTH}"),TotalLiabilities,0)'
                   f'+IF({not_personal},({vat_pay_f})+({q003_planned_f})+({loan_ds_f}),0),2)'))
        net = ws.cell(row=row, column=4, value=f'=ROUND(B{row}-C{row},2)')
        if i == 0:
            opening = ws.cell(row=row, column=5, value=f'={FUNDS_F}')
        else:
            opening = ws.cell(row=row, column=5, value=f'=F{row - 1}')
        closing = ws.cell(row=row, column=6, value=f'=ROUND(E{row}+D{row},2)')
        # transparency pair — NOT summed into B, just shown alongside it so
        # "how much of this month's income is actually certain" is visible
        # instead of hidden inside one blended number.
        inc_conf = ws.cell(row=row, column=8, value=f'=ROUND({_view_scoped(H_AMOUNT_WEIGHTED, TYPE_INC, mode="paid")},2)')
        inc_prob = ws.cell(row=row, column=9, value=f'=ROUND(B{row}-H{row},2)')
        # Layer 1 (REAL only): every dated, face-value Κινήσεις entry for
        # this month — no probability weighting, no Scenario factor, and
        # none of the top-down model layers (Q003 S-curve estimate, rent
        # NOI projection, loan-DS estimate, VAT estimate, Antonis, equity
        # injection). mode="paid" here (only ALREADY-paid rows) was
        # structurally dead: every paid transaction in this dataset is
        # dated in the past, while Ταμείο only covers the current month
        # forward, so the column could never show anything but €0 — the
        # exact column a bank/accountant would open first. mode="any"
        # (real, dated Κινήσεις rows regardless of paid/upcoming status)
        # is what "real" has to mean on a FORWARD-looking sheet: a
        # committed, individually-recorded entry (e.g. the real Q003 loan
        # tranches, dated 2027) is not a probabilistic model layer just
        # because it hasn't been paid yet.
        real_inc = ws.cell(row=row, column=10, value=f'=ROUND({_view_scoped(H_AMOUNT, TYPE_INC, mode="any", exclude_status=S_SCHED)},2)')
        real_exp = ws.cell(row=row, column=11, value=f'=ROUND({_view_scoped(H_AMOUNT, TYPE_EXP, mode="any", exclude_status=S_SCHED)},2)')
        if i == 0:
            real_opening = f'={FUNDS_F}'
        else:
            real_opening = f'=L{row - 1}'
        real_closing = ws.cell(row=row, column=12, value=f'=ROUND(({real_opening[1:]})+J{row}-K{row},2)')
        for cc in (inc, exp, opening, inc_conf, inc_prob, real_inc, real_exp):
            cc.number_format = EUR0; cc.alignment = Aln(h="right"); cc.fill = F(WHITE); cc.font = Fnt(size=10)
        net.number_format = EUR0_NEG; net.alignment = Aln(h="right"); net.fill = F(WHITE); net.font = Fnt(size=10)
        closing.number_format = EUR0; closing.alignment = Aln(h="right"); closing.fill = F(LIGHT_BLUE)
        closing.font = Fnt(size=10, bold=True, color=DARK_BLUE)
        real_closing.number_format = EUR0; real_closing.alignment = Aln(h="right"); real_closing.fill = F(GREEN_BG)
        real_closing.font = Fnt(size=10, bold=True, color=GREEN_FG)
        # flat reference-line series for the cash-trend chart below — same
        # value every row, so it plots as a straight line against Closing
        # Balance without needing a second chart axis.
        buf = ws.cell(row=row, column=7, value="=MinCashBuffer")
        buf.number_format = EUR0; buf.alignment = Aln(h="right"); buf.fill = F(LIGHT_GREY)
        buf.font = Fnt(size=10, color="FF6B7280")
    CASH_LAST = CASH_FIRST + CASH_MONTHS - 1

    # months 25-66 collapse into an Excel outline group by default — the
    # tail of a 5.5-year forecast driven by a handful of recurring lines is
    # mostly flat repetition, not real precision; still there and still
    # calculating for anyone who expands it, just not cluttering the view.
    # The ANNUAL TOTALS table further down covers that collapsed tail at a
    # useful grain (money in/out per year, balance at year-end) instead of
    # leaving nothing but an empty collapsed gap.
    CASH_VISIBLE_MONTHS = 18
    for r in range(CASH_FIRST + CASH_VISIBLE_MONTHS, CASH_LAST + 1):
        ws.row_dimensions[r].outline_level = 1
        ws.row_dimensions[r].hidden = True
    ws.sheet_properties.outlinePr.summaryBelow = True

    ws.conditional_formatting.add(f"F{CASH_FIRST}:F{CASH_LAST}",
        CellIsRule(operator="lessThan", formula=["0"],
                   fill=PatternFill(start_color=RED_BG, end_color=RED_BG, fill_type="solid"),
                   font=Font(name="Calibri", size=10, bold=True, color=RED_FG)))
    # amber: still positive but under the safety buffer — the early warning
    # that feeds Κέντρο Ελέγχου's "Months Until Safety Buffer" KPI.
    ws.conditional_formatting.add(f"F{CASH_FIRST}:F{CASH_LAST}",
        CellIsRule(operator="between", formula=["0", "MinCashBuffer"],
                   fill=PatternFill(start_color="FFFEF0D8", end_color="FFFEF0D8", fill_type="solid"),
                   font=Font(name="Calibri", size=10, bold=True, color="FF965800")))

    # ── ANNUAL TOTALS for the collapsed tail — months 25+ are still there
    # and still calculating (expand the group above to see them month by
    # month), but a monthly row repeating the same recurring-plan total 42
    # times is noise, not information. One row per year (or part-year)
    # instead: money in/out that year, and where the balance actually
    # stands at the end of it. ──
    ANNUAL_HDR = CASH_LAST + 2
    ws.row_dimensions[ANNUAL_HDR].height = 22
    annual_headers = [t("Περίοδος", "Period"), t("Έσοδα", "Income"), t("Έξοδα", "Expenses"),
                      t("Καθαρή Μεταβολή", "Net Change"), t("Υπόλοιπο Τέλους Περιόδου", "Balance At Period End")]
    for ci, h in enumerate(annual_headers, 1):
        col_hdr(ws, ANNUAL_HDR, ci, h)
    ANNUAL_FIRST = ANNUAL_HDR + 1
    _year_row = ANNUAL_FIRST
    _bucket_start = CASH_FIRST + CASH_VISIBLE_MONTHS
    while _bucket_start <= CASH_LAST:
        _bucket_end = min(_bucket_start + 11, CASH_LAST)
        ws.row_dimensions[_year_row].height = 20
        lbl_cell = ws.cell(row=_year_row, column=1,
            value=f'=A{_bucket_start}&" → "&A{_bucket_end}')
        lbl_cell.fill = F(WHITE); lbl_cell.font = Fnt(size=10, bold=True); lbl_cell.alignment = Aln(h="left", v="center")
        inc_y = ws.cell(row=_year_row, column=2, value=f'=SUM(B{_bucket_start}:B{_bucket_end})')
        exp_y = ws.cell(row=_year_row, column=3, value=f'=SUM(C{_bucket_start}:C{_bucket_end})')
        net_y = ws.cell(row=_year_row, column=4, value=f'=SUM(D{_bucket_start}:D{_bucket_end})')
        bal_y = ws.cell(row=_year_row, column=5, value=f'=F{_bucket_end}')
        for cc in (inc_y, exp_y, net_y, bal_y):
            cc.number_format = EUR0; cc.alignment = Aln(h="right"); cc.fill = F(WHITE); cc.font = Fnt(size=10)
        bal_y.font = Fnt(size=10, bold=True, color=DARK_BLUE); bal_y.fill = F(LIGHT_BLUE)
        _year_row += 1
        _bucket_start = _bucket_end + 1
    ANNUAL_LAST = _year_row - 1

    TIP_CASH = ANNUAL_LAST + 2
    ws.merge_cells(start_row=TIP_CASH, start_column=1, end_row=TIP_CASH, end_column=7)
    c = ws.cell(row=TIP_CASH, column=1,
                value="  " + t("Κυλιόμενη πρόβλεψη 5,5 ετών (66 μηνών). Το Υπόλοιπο Έναρξης παίρνει το σύνολο από Λογαριασμοί σύμφωνα με την Προβολή (Κέντρο Ελέγχου, πάνω δεξιά)· κάθε επόμενος μήνας παίρνει σαν έναρξη το υπόλοιπο λήξης του προηγούμενου. Το χρέος προς Αντώνη (TotalLiabilities, αυτόματα 500.000 € μόλις η κατάσταση των 160.000 € γίνει Ελήφθη) και τα αναμενόμενα 160.000 € (ExpectedFromAntonis, μηδενίζονται μόλις εισπραχθούν) είναι πλέον ονόματα, όχι σταθερά νούμερα μέσα στον τύπο. Η στήλη Έξοδα σταθμίζεται με το ίδιο ScenarioCostFactor όπως και τα Έσοδα — πριν συγκρίνονταν σταθμισμένα έσοδα με αστάθμιστα έξοδα. ΦΠΑ, το προγραμματισμένο κόστος κατασκευής του Q003 (Πρόοδος Έργου), το χρεολύσιο+τόκοι και των δύο δανείων (Δάνεια) και ΤΩΡΑ το μίσθωμα NOI του Q003 (Μισθώματα & Αποδόσεις) μπαίνουν όλα εδώ — τα τέσσερα αυτά αποκλείονται από την προβολή Προσωπικά (καθαρά εταιρικές υποχρεώσεις/έσοδα), ενώ το χρέος/εισερχόμενο Αντώνη παραμένει σε όλες τις προβολές. Κόκκινο = προβλεπόμενο αρνητικό ταμείο. Κίτρινο/πορτοκαλί = θετικό αλλά κάτω από το Ελάχιστο Απόθεμα Ασφαλείας.",
                          "Rolling 5.5-year (66-month) forecast. Opening Balance pulls the total from Λογαριασμοί per the View (Κέντρο Ελέγχου, top-right); every following month opens with the previous month's closing balance. The Antonis debt (TotalLiabilities, automatically €500k once the €160k's status flips to Received) and the expected €160k (ExpectedFromAntonis, zeroes out once received) are now names, not hardcoded numbers inside the formula. The Expenses column is now scaled by the same ScenarioCostFactor as Income — weighted income used to be compared against unweighted expenses. VAT, Q003's planned construction cost (Πρόοδος Έργου), both loans' principal+interest (Δάνεια), and NOW Q003's rent NOI (Μισθώματα & Αποδόσεις) all feed in here — those four are excluded from the Personal view (purely company obligations/income), while the Antonis debt/incoming stays in every view. Red = projected negative cash. Amber = positive but under the Minimum Cash Safety Buffer."))
    c.font = Fnt(size=10, italic=True, color="FF6B7280")
    c.fill = F("FFF6F8FA"); c.alignment = Aln(h="left", wrap=True)
    ws.row_dimensions[TIP_CASH].height = 40

    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_area = f"A1:L{TIP_CASH}"

    # ── CASH TREND CHART — visual companion to Κέντρο Ελέγχου's "When Do We
    # Run Low On Cash" KPI: the whole 60-month forecast at a glance, with
    # the safety buffer as a flat dashed reference line so a dip below it is
    # visible without reading numbers. Built here (data now exists) but
    # anchored on Κέντρο Ελέγχου, right under the Personal Spending rollup,
    # since that's the dashboard people actually look at day to day. ──
    cash_chart = LineChart()
    cash_chart.title = t("Πρόβλεψη Ταμειακής Ρευστότητας (60 Μήνες)", "Cash Flow Forecast (60 Months)")
    cash_chart.style = 2
    cash_chart.y_axis.title = t("Υπόλοιπο (€)", "Balance (€)")
    cash_chart.x_axis.title = t("Μήνας", "Month")
    cash_chart.height = 9
    cash_chart.width = 24
    balance_ref = Reference(ws_cash, min_col=6, min_row=3, max_row=CASH_LAST)
    buffer_ref = Reference(ws_cash, min_col=7, min_row=3, max_row=CASH_LAST)
    months_ref = Reference(ws_cash, min_col=1, min_row=CASH_FIRST, max_row=CASH_LAST)
    cash_chart.add_data(balance_ref, titles_from_data=True)
    cash_chart.add_data(buffer_ref, titles_from_data=True)
    cash_chart.set_categories(months_ref)
    cash_chart.series[0].graphicalProperties.line.width = 22000
    cash_chart.series[0].graphicalProperties.line.solidFill = "1A2F4A"
    cash_chart.series[0].marker.symbol = "none"
    cash_chart.series[0].smooth = False
    cash_chart.series[1].graphicalProperties.line.width = 12000
    cash_chart.series[1].graphicalProperties.line.solidFill = "991B1B"
    cash_chart.series[1].graphicalProperties.line.dashStyle = "dash"
    cash_chart.series[1].marker.symbol = "none"
    cash_chart.series[1].smooth = False
    ws_cc.add_chart(cash_chart, CASH_CHART_ANCHOR)

    # ══════════════════════════════════════════════════════════════════════════
    # TAB: ΦΠΑ  (monthly VAT rollup + filing tracker — pure SUMIFS off
    # Table_Kin[ΦΠΑ], same figures as Κέντρο Ελέγχου's all-time VAT KPIs,
    # just broken out per month, plus a manual filing-status column.) ──
    # ══════════════════════════════════════════════════════════════════════════
    ws = ws_vat
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 14
    for letter in "BCD":
        ws.column_dimensions[letter].width = 16
    ws.column_dimensions["E"].width = 18
    ws.column_dimensions["F"].width = 20
    ws.column_dimensions["G"].width = 16
    ws.column_dimensions["H"].width = 16
    ws.column_dimensions["I"].width = 16
    ws.column_dimensions["J"].width = 18
    ws.freeze_panes = "A4"

    ws.row_dimensions[1].height = 34
    ws.merge_cells("A1:J1")
    c = ws.cell(row=1, column=1, value="  " + t("ΦΠΑ  —  ΜΗΝΙΑΙΑ ΘΕΣΗ & ΥΠΟΒΟΛΕΣ", "VAT  —  MONTHLY POSITION & FILINGS"))
    c.fill = F(DARK_BLUE); c.font = Fnt(size=14, bold=True, color=WHITE)
    c.alignment = Aln(h="left", v="center")
    sheet_intro(ws, 2,
        t("Ο ΦΠΑ υπολογίζεται με ημερομηνία παραστατικού, όχι πληρωμής. Το πιστωτικό υπόλοιπο μεταφέρεται "
          "μόνο του στον επόμενο μήνα — πληρώνετε μόνο ό,τι πραγματικά απομένει. Επιβεβαιώνετε πάντα με τον "
          "λογιστή πριν την υποβολή.",
          "VAT is calculated by invoice date, not payment date. A credit balance rolls forward on its own — "
          "you only ever pay what's actually left owing. Always confirm with the accountant before filing."),
        end_col="J")

    # Ποσό Πληρωμής/Ημ/νία Πληρωμής track what was ACTUALLY paid to the tax
    # office — separate from Καθαρή Θέση (what's owed), since VAT tracked
    # position vs. VAT paid used to be the same number in this workbook, and
    # a filed-but-unpaid month or a partial payment had nowhere to go. This
    # pair also feeds Ταμείο's cash forecast (see VAT_PAY_F there) — without
    # it, a VAT payment never showed up as a cash outflow anywhere.
    vat_headers = [t("Μήνας", "Month"), t("ΦΠΑ Εσόδων", "VAT on Income"), t("ΦΠΑ Εξόδων", "VAT on Expenses"),
                   t("Καθαρή Θέση", "Net Position"), t("Προθεσμία Υποβολής", "Filing Deadline"),
                   t("Κατάσταση Υποβολής", "Filing Status"), t("Ποσό Πληρωμής", "Amount Paid"),
                   t("Ημ/νία Πληρωμής", "Payment Date"), t("Πιστωτικό Υπόλοιπο", "Credit Balance"),
                   t("Πληρωτέο (μετά Πίστωση)", "Payable (after Credit)")]
    for ci, h in enumerate(vat_headers, 1):
        col_hdr(ws, 3, ci, h)

    VAT_FIRST = 4
    VAT_MONTHS_BACK, VAT_MONTHS_FWD = 12, 12   # mostly backward-looking —
                       # VAT is filed for periods already closed, unlike Ταμείο.
    for i in range(VAT_MONTHS_BACK + VAT_MONTHS_FWD):
        row = VAT_FIRST + i
        offset = i - VAT_MONTHS_BACK
        ws.row_dimensions[row].height = 18
        edate = f"EDATE(TODAY(),{offset})"
        mc = ws.cell(row=row, column=1, value=f'=YEAR({edate})&"-"&TEXT(MONTH({edate}),"00")')
        mc.fill = F(LIGHT_GREY); mc.alignment = Aln(h="center", v="center"); mc.font = Fnt(size=10, bold=True, color=DARK_BLUE)
        mref = f"$A{row}"
        vin = ws.cell(row=row, column=2, value=f'={_recur_monthly(H_VAT, TYPE_INC, mref, scope=SCOPE_BIZ)}')
        vex = ws.cell(row=row, column=3, value=f'={_recur_monthly(H_VAT, TYPE_EXP, mref, scope=SCOPE_BIZ)}')
        net = ws.cell(row=row, column=4, value=f'=B{row}-C{row}')
        deadline = ws.cell(row=row, column=5,
            value=f'=EOMONTH(DATE(VALUE(LEFT({mref},4)),VALUE(RIGHT({mref},2)),1),1)')
        for cc in (vin, vex):
            cc.number_format = EUR0; cc.alignment = Aln(h="right"); cc.fill = F(WHITE); cc.font = Fnt(size=10)
        net.number_format = EUR0; net.alignment = Aln(h="right"); net.fill = F(LIGHT_BLUE)
        net.font = Fnt(size=10, bold=True, color=DARK_BLUE)
        deadline.number_format = "DD/MM/YYYY"; deadline.alignment = Aln(h="center")
        deadline.fill = F(LIGHT_GREY); deadline.font = Fnt(size=9, color="FF6B7280")
        status = ws.cell(row=row, column=6)
        status.fill = F(YELLOW); status.alignment = Aln(h="center")
        paid_amt = ws.cell(row=row, column=7)
        paid_amt.fill = F(YELLOW); paid_amt.alignment = Aln(h="right"); paid_amt.number_format = EUR0
        paid_date = ws.cell(row=row, column=8)
        paid_date.fill = F(YELLOW); paid_date.alignment = Aln(h="center"); paid_date.number_format = "DD/MM/YYYY"
        # a credit month (Καθαρή Θέση < 0) used to just vanish — next
        # month's "owed to tax office" restarted from 0 with no memory of
        # it, when in reality a VAT credit carries forward and offsets what
        # you owe later. Running balance: this row's credit = whatever's
        # still negative after applying last row's credit against this
        # row's own Net Position; Payable is whatever's left over positive.
        prev_credit = "0" if i == 0 else f"I{row - 1}"
        credit = ws.cell(row=row, column=9, value=f'=MIN(0,D{row}+{prev_credit})')
        credit.number_format = EUR0; credit.alignment = Aln(h="right"); credit.fill = F(WHITE)
        credit.font = Fnt(size=10, color="FF6B7280")
        payable = ws.cell(row=row, column=10, value=f'=MAX(0,D{row}+{prev_credit})')
        payable.number_format = EUR0; payable.alignment = Aln(h="right"); payable.fill = F(LIGHT_BLUE)
        payable.font = Fnt(size=10, bold=True, color=DARK_BLUE)
    VAT_LAST = VAT_FIRST + VAT_MONTHS_BACK + VAT_MONTHS_FWD - 1

    dv_vat_status = DataValidation(type="list", formula1="LIST_VATSTATUS",
                                   allow_blank=True, showDropDown=False)
    ws.add_data_validation(dv_vat_status); dv_vat_status.sqref = f"F{VAT_FIRST}:F{VAT_LAST}"

    ws.conditional_formatting.add(f"F{VAT_FIRST}:F{VAT_LAST}",
        FormulaRule(formula=[f'AND(F{VAT_FIRST}="{VAT_PENDING}",E{VAT_FIRST}<TODAY())'],
                    fill=PatternFill(start_color=RED_BG, end_color=RED_BG, fill_type="solid"),
                    font=Font(name="Calibri", size=10, bold=True, color=RED_FG)))

    TIP_VAT = VAT_LAST + 2
    ws.merge_cells(start_row=TIP_VAT, start_column=1, end_row=TIP_VAT, end_column=10)
    c = ws.cell(row=TIP_VAT, column=1,
                value="  " + t("12 μήνες πίσω, 12 μπρος από σήμερα. Ενημερώστε το «Κατάσταση Υποβολής» όταν υποβάλλετε δήλωση ΦΠΑ — αν περάσει η προθεσμία χωρίς να έχει ενημερωθεί σε «Υποβλήθηκε», η γραμμή κοκκινίζει. Όταν πληρώσετε, καταχωρήστε «Ποσό Πληρωμής» και «Ημ/νία Πληρωμής» — αυτά (όχι η Καθαρή Θέση) είναι που μπαίνουν σαν πραγματική εκροή στην πρόβλεψη του Ταμείου. Το «Πιστωτικό Υπόλοιπο» μεταφέρεται αυτόματα μήνα με μήνα και μειώνει το «Πληρωτέο» μέχρι να εξαντληθεί.",
                          "12 months back, 12 forward from today. Update “Filing Status” once you submit a VAT return — if the deadline passes without it being marked “Filed”, the row turns red. Once you pay, enter “Amount Paid” and “Payment Date” — those (not Net Position) are what feed into Ταμείο's cash forecast as a real outflow. “Credit Balance” carries forward month to month automatically and reduces “Payable” until it's used up."))
    c.font = Fnt(size=10, italic=True, color="FF6B7280")
    c.fill = F("FFF6F8FA"); c.alignment = Aln(h="left", wrap=True)
    ws.row_dimensions[TIP_VAT].height = 32

    # ══════════════════════════════════════════════════════════════════════════
    # TAB: ΠΑΡΑΚΡΑΤΗΣΗ  (withholding tax — same monthly-rollup + remittance-
    # tracker shape as ΦΠΑ, since Παρακράτηση had a running total on
    # Κινήσεις but nowhere that tracked what's actually been remitted.) ──
    # ══════════════════════════════════════════════════════════════════════════
    ws = ws_wh
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 14
    for letter in "BC":
        ws.column_dimensions[letter].width = 18
    ws.column_dimensions["D"].width = 20
    ws.column_dimensions["E"].width = 16
    ws.column_dimensions["F"].width = 18
    ws.freeze_panes = "A4"

    ws.row_dimensions[1].height = 34
    ws.merge_cells("A1:F1")
    c = ws.cell(row=1, column=1, value="  " + t("ΠΑΡΑΚΡΑΤΗΣΗ ΦΟΡΟΥ  —  ΜΗΝΙΑΙΑ ΘΕΣΗ & ΑΠΟΔΟΣΕΙΣ", "WITHHOLDING TAX  —  MONTHLY POSITION & REMITTANCES"))
    c.fill = F(DARK_BLUE); c.font = Fnt(size=14, bold=True, color=WHITE)
    c.alignment = Aln(h="left", v="center")
    sheet_intro(ws, 2,
        t("Ο παρακρατούμενος φόρος κάθε τιμολογίου, μαζεμένος ανά μήνα με την προθεσμία απόδοσης στο δημόσιο. "
          "Χρησιμοποιήστε το για να μην ξεχάσετε μια απόδοση — δεν έχει σχέση με τον ΦΠΑ, που ζει στο δικό "
          "του φύλλο.",
          "Withheld tax per invoice, rolled up by month with the remittance deadline to the tax office. Use "
          "it to not miss a remittance — it's unrelated to VAT, which has its own sheet."),
        end_col="F")

    wh_headers = [t("Μήνας", "Month"), t("Παρακράτηση Μήνα", "Withheld This Month"),
                  t("Προθεσμία Απόδοσης", "Remittance Deadline"), t("Κατάσταση Απόδοσης", "Remittance Status"),
                  t("Ποσό Απόδοσης", "Amount Remitted"), t("Ημ/νία Απόδοσης", "Remittance Date")]
    for ci, h in enumerate(wh_headers, 1):
        col_hdr(ws, 3, ci, h)

    WH_FIRST = 4
    WH_MONTHS_BACK, WH_MONTHS_FWD = 12, 12
    for i in range(WH_MONTHS_BACK + WH_MONTHS_FWD):
        row = WH_FIRST + i
        offset = i - WH_MONTHS_BACK
        ws.row_dimensions[row].height = 18
        edate = f"EDATE(TODAY(),{offset})"
        mc = ws.cell(row=row, column=1, value=f'=YEAR({edate})&"-"&TEXT(MONTH({edate}),"00")')
        mc.fill = F(LIGHT_GREY); mc.alignment = Aln(h="center", v="center"); mc.font = Fnt(size=10, bold=True, color=DARK_BLUE)
        mref = f"$A{row}"
        # withholding tax in this dataset lives on EXPENSE rows (paying a
        # contractor/supplier and withholding tax on their behalf, to remit
        # separately to the tax office) — TYPE_INC here was filtering out
        # every real withheld amount, leaving the whole sheet at €0 despite
        # €4.149,54 of real withheld tax actually existing in Κινήσεις.
        wamt = ws.cell(row=row, column=2, value=f'={_recur_monthly(H_WITHHELD, TYPE_EXP, mref, scope=SCOPE_BIZ)}')
        wamt.number_format = EUR0; wamt.alignment = Aln(h="right"); wamt.fill = F(WHITE); wamt.font = Fnt(size=10)
        deadline = ws.cell(row=row, column=3,
            value=f'=EOMONTH(DATE(VALUE(LEFT({mref},4)),VALUE(RIGHT({mref},2)),1),1)')
        deadline.number_format = "DD/MM/YYYY"; deadline.alignment = Aln(h="center")
        deadline.fill = F(LIGHT_GREY); deadline.font = Fnt(size=9, color="FF6B7280")
        status = ws.cell(row=row, column=4)
        status.fill = F(YELLOW); status.alignment = Aln(h="center")
        rem_amt = ws.cell(row=row, column=5)
        rem_amt.fill = F(YELLOW); rem_amt.alignment = Aln(h="right"); rem_amt.number_format = EUR0
        rem_date = ws.cell(row=row, column=6)
        rem_date.fill = F(YELLOW); rem_date.alignment = Aln(h="center"); rem_date.number_format = "DD/MM/YYYY"
    WH_LAST = WH_FIRST + WH_MONTHS_BACK + WH_MONTHS_FWD - 1

    dv_wh_status = DataValidation(type="list", formula1=f'"{VAT_PENDING},{VAT_FILED}"',
                                   allow_blank=True, showDropDown=False)
    ws.add_data_validation(dv_wh_status); dv_wh_status.sqref = f"D{WH_FIRST}:D{WH_LAST}"

    ws.conditional_formatting.add(f"D{WH_FIRST}:D{WH_LAST}",
        FormulaRule(formula=[f'AND(D{WH_FIRST}="{VAT_PENDING}",C{WH_FIRST}<TODAY())'],
                    fill=PatternFill(start_color=RED_BG, end_color=RED_BG, fill_type="solid"),
                    font=Font(name="Calibri", size=10, bold=True, color=RED_FG)))

    WH_TOTAL_ROW = WH_LAST + 1
    ws.row_dimensions[WH_TOTAL_ROW].height = 24
    lbl(ws, WH_TOTAL_ROW, 1, t("ΣΥΝΟΛΟ 24 ΜΗΝΩΝ", "24-MONTH TOTAL"), bold=True, bg=LIGHT_BLUE)
    _wtv = ws.cell(row=WH_TOTAL_ROW, column=2, value=f"=SUM(B{WH_FIRST}:B{WH_LAST})")
    _wtv.number_format = EUR0; _wtv.fill = F(LIGHT_BLUE); _wtv.font = Fnt(size=11, bold=True, color=DARK_BLUE)
    _wtv.alignment = Aln(h="right", v="center")
    for ci in range(3, 7): ws.cell(row=WH_TOTAL_ROW, column=ci).fill = F(LIGHT_BLUE)

    TIP_WH = WH_TOTAL_ROW + 2
    ws.merge_cells(start_row=TIP_WH, start_column=1, end_row=TIP_WH, end_column=6)
    c = ws.cell(row=TIP_WH, column=1,
                value="  " + t("Η στήλη «Παρακράτηση» στις Κινήσεις είναι ένα συσσωρευμένο σύνολο χωρίς φύλλο απόδοσης — αυτό είναι το φύλλο. Ενημερώστε «Κατάσταση Απόδοσης», «Ποσό Απόδοσης» και «Ημ/νία Απόδοσης» όταν αποδίδετε την παρακράτηση στην εφορία, ίδια λογική με το ΦΠΑ.",
                          "The “Παρακράτηση” (Withheld) running total on Κινήσεις had no remittance tracker — this is it. Update “Remittance Status”, “Amount Remitted” and “Remittance Date” when you remit the withheld tax, same logic as ΦΠΑ."))
    c.font = Fnt(size=10, italic=True, color="FF6B7280")
    c.fill = F("FFF6F8FA"); c.alignment = Aln(h="left", wrap=True)
    ws.row_dimensions[TIP_WH].height = 32

    # ══════════════════════════════════════════════════════════════════════════
    # TAB: ΕΛΕΓΧΟΙ ΠΟΙΟΤΗΤΑΣ  (data-quality checks — one clickable red/green
    # line per check instead of a data-quality problem you only discover by
    # accident while scrolling Κινήσεις.) ──
    # ══════════════════════════════════════════════════════════════════════════
    ws = ws_qc
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 3
    ws.column_dimensions["B"].width = 42
    ws.column_dimensions["C"].width = 14
    ws.column_dimensions["D"].width = 55
    ws.freeze_panes = "A5"

    ws.row_dimensions[1].height = 34
    ws.merge_cells("A1:D1")
    c = ws.cell(row=1, column=1, value="  " + t("ΕΛΕΓΧΟΙ ΠΟΙΟΤΗΤΑΣ ΔΕΔΟΜΕΝΩΝ", "DATA QUALITY CHECKS"))
    c.fill = F(DARK_BLUE); c.font = Fnt(size=14, bold=True, color=WHITE)
    c.alignment = Aln(h="left", v="center")
    sheet_intro(ws, 2,
        t("Αυτόματοι έλεγχοι πάνω στις Κινήσεις — διπλά παραστατικά, κενή Πηγή, λάθος ΦΠΑ και τα λοιπά. Αν "
          "κάτι εδώ δείχνει κόκκινο, διορθώστε το στις Κινήσεις πριν εμπιστευτείτε τα υπόλοιπα φύλλα.",
          "Automatic checks on top of Κινήσεις — duplicate invoices, blank Source, bad VAT, and so on. If "
          "anything here shows red, fix it in Κινήσεις before trusting any other tab's numbers."),
        end_col="D")

    QC_FIRST = 3
    dup_mark_f = (f'SUMPRODUCT((Table_Kin[{H_MARK}]<>"")*(COUNTIF(Table_Kin[{H_MARK}],Table_Kin[{H_MARK}])>1))')
    no_project_f = f'COUNTIFS(Table_Kin[{H_PROJECT}],"",Table_Kin[{H_DATE}],"<>")'
    # PAID-only — matches the actual enforced rule (the Κατάσταση
    # validation only requires a Πηγή once something is marked Πληρωμένο).
    # An Εκκρεμεί row with no source yet (e.g. a loan still "Σε αίτηση" —
    # genuinely not tied to an account until it's approved) isn't a data
    # problem, it's an honest "not decided yet"; flagging it here trained
    # the same "ignore the checks" habit as every other false positive
    # this file has already had fixed.
    no_source_f = (f'COUNTIFS(Table_Kin[{H_SOURCE}],"",Table_Kin[{H_DATE}],"<>",Table_Kin[{H_STATUS}],"{S_PAID}")'
                    f'+COUNTIFS(Table_Kin[{H_SOURCE}],"{SRC_TBD}",Table_Kin[{H_DATE}],"<>",Table_Kin[{H_STATUS}],"{S_PAID}")')
    bad_vat_f = (f'SUMPRODUCT((Table_Kin[{H_SCOPE}]="{SCOPE_BIZ}")*(Table_Kin[{H_VAT}]>0)*'
                 f'((Table_Kin[{H_AMOUNT}]-Table_Kin[{H_VAT}])<>0)*'
                 f'(ABS(Table_Kin[{H_VAT}]-ROUND((Table_Kin[{H_AMOUNT}]-Table_Kin[{H_VAT}])*0.24,2))>1))')
    no_afm_f = 'COUNTIFS(Table_Contacts[Επαφή],"<>",Table_Contacts[ΑΦΜ],"")'
    dup_txid_f = f'SUMPRODUCT((Table_Kin[{H_TXID}]<>"")*(COUNTIF(Table_Kin[{H_TXID}],Table_Kin[{H_TXID}])>1))'
    # excludes Κατηγορία=Δάνειο — a real, deliberately-scheduled future loan
    # tranche (e.g. the Q003 construction draws) is supposed to be future-
    # dated; flagging those as a "typo" every time trained users to ignore
    # this check entirely, since ~6 of the real future-dated rows are
    # exactly this and not an error.
    future_dated_f = f'COUNTIFS(Table_Kin[{H_DATE}],">"&TODAY(),Table_Kin[{H_CATEGORY}],"<>{CAT_LOAN}")'
    negative_amt_f = f'COUNTIFS(Table_Kin[{H_AMOUNT}],"<0")'
    # a real project (Έργα!A3:A14 non-blank) whose Προϋπολογισμοί total
    # budget is still €0 — the 12 columns line up 1:1 with Έργα's 12 rows
    # by position, so this is a plain paired-range SUMPRODUCT, not a
    # lookup — a project can HAVE a column (it always does, live) and
    # still have nobody having typed a budget into it yet.
    # TRANSPOSE — Έργα!A3:A14 is a 12-row VERTICAL range, Προϋπολογισμοί's
    # budget row is a 12-column HORIZONTAL one; SUMPRODUCT needs matching
    # shapes to multiply elementwise, it won't auto-align a row against a
    # column the way some functions do.
    proj_no_budget_f = (f"SUMPRODUCT(('3. Έργα'!$A$3:$A$14<>\"\")*"
                        f"(TRANSPOSE('4. Προϋπολογισμοί'!${bud_col_letters[0]}${TOTAL_BUDGET_ROW}:${bud_col_letters[-1]}${TOTAL_BUDGET_ROW})=0))")
    zero_amt_f = f'COUNTIFS(Table_Kin[{H_AMOUNT}],0,Table_Kin[{H_DATE}],"<>")'
    dup_afm_f = (f'SUMPRODUCT((Table_Contacts[ΑΦΜ]<>"")*'
                 f'(COUNTIF(Table_Contacts[ΑΦΜ],Table_Contacts[ΑΦΜ])>1))')
    # "Required capital until opening" (Προϋπολογισμοί row REQUIRED_ROW) is
    # a separately-typed manual figure per project, not a formula derived
    # from the Total Budget row — real projects can legitimately need LESS
    # than their full lifetime budget by opening day (some costs land
    # after), but never MORE than the total budget itself. This doesn't
    # know which number is "right" when they disagree — it only catches
    # the one relationship that's never valid regardless.
    req_gt_total_f = (f"SUMPRODUCT(('3. Έργα'!$A$3:$A$14<>\"\")*"
                      f"(TRANSPOSE('4. Προϋπολογισμοί'!${bud_col_letters[0]}${REQUIRED_ROW}:${bud_col_letters[-1]}${REQUIRED_ROW})>"
                      f"TRANSPOSE('4. Προϋπολογισμοί'!${bud_col_letters[0]}${TOTAL_BUDGET_ROW}:${bud_col_letters[-1]}${TOTAL_BUDGET_ROW})))")
    checks = [
        (t("Διπλά Παραστατικά", "Duplicate Invoice Numbers"), dup_mark_f,
         t("Ίδιος Αρ. Παραστατικού σε περισσότερες από μία κινήσεις — πιθανή διπλή καταχώρηση (π.χ. από επανεισαγωγή myDATA)",
           "Same invoice number on more than one transaction — possible double entry (e.g. from re-importing myDATA)"),
         "#'2. Κινήσεις'!M13"),
        (t("Κινήσεις Χωρίς Έργο", "Transactions Without a Project"), no_project_f,
         t("Η στήλη Έργο είναι κενή — δεν μπαίνει σε κανένα σύνολο ΑΝΑ ΕΡΓΟ", "Έργο is blank — invisible to every per-project total"),
         "#'2. Κινήσεις'!D13"),
        (t("Κινήσεις Χωρίς Πηγή", "Transactions Without a Source"), no_source_f,
         t("Η στήλη Πηγή είναι κενή ή «Προς καθορισμό» — τα υπόλοιπα τραπεζών δεν κινούνται", "Πηγή is blank or “To be determined” — bank balances don't move"),
         "#'2. Κινήσεις'!J13"),
        (t("ΦΠΑ Εκτός 24%", "VAT Not Matching 24%"), bad_vat_f,
         t("Επιχειρηματική κίνηση με ΦΠΑ που αποκλίνει από το 24% της καθαρής αξίας πάνω από 1€ — έλεγχος πληκτρολόγησης",
           "Business transaction whose VAT deviates from 24% of net value by more than €1 — a typo check"),
         "#'2. Κινήσεις'!H13"),
        (t("Επαφές Χωρίς ΑΦΜ", "Contacts Without a Tax ID"), no_afm_f,
         t("Επωνυμία χωρίς ΑΦΜ στο Επαφές — η αυτόματη σύνδεση με τις Κινήσεις δεν λειτουργεί χωρίς αυτό", "Name with no ΑΦΜ on Επαφές — the automatic link to Κινήσεις doesn't work without it"),
         "#'7. Επαφές'!A5"),
        (t("Διπλότυπο ID Κίνησης", "Duplicate Transaction ID"), dup_txid_f,
         t("Ίδιο Μοναδικό ID (ημερομηνία+ΑΦΜ+ποσό+παραστατικό) σε περισσότερες από μία κινήσεις — πολύ πιθανή διπλή εισαγωγή από myDATA",
           "Same Μοναδικό ID (date+AFM+amount+invoice mark) on more than one transaction — very likely a duplicate myDATA import"),
         "#'2. Κινήσεις'!AI13"),
        (t("Κινήσεις με Μελλοντική Ημερομηνία", "Transactions With a Future Date"), future_dated_f,
         t("Ημερομηνία μετά το σήμερα — συνήθως typo στο έτος", "Date after today — usually a typo in the year"),
         "#'2. Κινήσεις'!A13"),
        (t("Αρνητικά Ποσά", "Negative Amounts"), negative_amt_f,
         t("Το Ποσό είναι πάντα θετικό εδώ — το πρόσημο έρχεται από τη στήλη Τύπος, όχι το ίδιο το ποσό", "Ποσό is always positive here — sign comes from the Τύπος column, not the amount itself"),
         "#'2. Κινήσεις'!G13"),
        (t("Έργα Χωρίς Προϋπολογισμό", "Projects Without a Budget"), proj_no_budget_f,
         t("Υπάρχει στο Έργα αλλά ο ΣΥΝΟΛΙΚΟΣ ΠΡΟΫΠΟΛΟΓΙΣΜΟΣ στο Προϋπολογισμοί είναι ακόμα €0", "Exists on Έργα but TOTAL BUDGET on Προϋπολογισμοί is still €0"),
         "#'4. Προϋπολογισμοί'!A1"),
        (t("Κινήσεις με Μηδενικό Ποσό", "Transactions With a Zero Amount"), zero_amt_f,
         t("Ποσό = €0 σε κίνηση με ημερομηνία — συνήθως ξεχασμένη γραμμή ή σφάλμα εισαγωγής", "Amount = €0 on a dated transaction — usually a forgotten row or an import glitch"),
         "#'2. Κινήσεις'!G13"),
        (t("Διπλότυπο ΑΦΜ σε Επαφές", "Duplicate Tax ID on Contacts"), dup_afm_f,
         t("Ίδιο ΑΦΜ σε περισσότερες από μία επαφές — πιθανή διπλή καταχώρηση της ίδιας εταιρείας/ατόμου", "Same ΑΦΜ on more than one contact — possible duplicate entry of the same company/person"),
         "#'7. Επαφές'!A5"),
        (t("Απαιτούμενο Κεφάλαιο > Συνολικό Προϋπολογισμό", "Required Capital > Total Budget"), req_gt_total_f,
         t("Το «Απαιτούμενο κεφάλαιο μέχρι το άνοιγμα» δεν μπορεί να ξεπερνά τον ΣΥΝΟΛΙΚΟ ΠΡΟΫΠΟΛΟΓΙΣΜΟ του ίδιου έργου — ελέγξτε ποιο κελί είναι σωστό",
           "“Required capital to opening” can't exceed that project's TOTAL BUDGET — check which cell is correct"),
         "#'4. Προϋπολογισμοί'!A1"),
    ]

    green_fill_qc = PatternFill(start_color=GREEN_BG, end_color=GREEN_BG, fill_type="solid")
    red_fill_qc = PatternFill(start_color=RED_BG, end_color=RED_BG, fill_type="solid")
    for i, (label, count_f, note, jump_ref) in enumerate(checks):
        row = QC_FIRST + i
        ws.row_dimensions[row].height = 26
        lc = ws.cell(row=row, column=2, value=label)
        lc.font = Fnt(size=11, bold=True, color="FF374151"); lc.alignment = Aln(h="left", v="center")
        lc.border = Brd()
        # the raw count lives in column E (same sheet, plain number) — both
        # the display cell and the conditional formatting read THAT instead
        # of embedding the cross-sheet SUMPRODUCT/Table_Kin[...] expression
        # directly into the conditional-formatting formula. Confirmed via
        # Excel's own repair log ("Removed Feature: Conditional formatting
        # from sheet12") that a CF rule referencing a structured Table
        # reference on ANOTHER sheet gets silently stripped on open — CF
        # formulas need to stay same-sheet.
        ec = ws.cell(row=row, column=5, value=f'=({count_f})')
        ec.font = Fnt(size=1, color=WHITE)
        vc = ws.cell(row=row, column=3,
            value=f'=IF($E{row}=0,"{t("✓ OK","✓ OK")}",HYPERLINK("{jump_ref}",$E{row}&" {t("εγγραφές","rows")}"))')
        vc.font = Fnt(size=11, bold=True); vc.alignment = Aln(h="center", v="center"); vc.border = Brd()
        nc = ws.cell(row=row, column=4, value=note)
        nc.font = Fnt(size=9, italic=True, color="FF6B7280"); nc.alignment = Aln(h="left", v="center", wrap=True)
        nc.border = Brd()
        ws.conditional_formatting.add(f"B{row}:D{row}",
            FormulaRule(formula=[f'$E{row}=0'], fill=green_fill_qc))
        ws.conditional_formatting.add(f"B{row}:D{row}",
            FormulaRule(formula=[f'$E{row}>0'], fill=red_fill_qc))
    QC_LAST = QC_FIRST + len(checks) - 1

    QC_SUMMARY_ROW = QC_LAST + 2
    ws.row_dimensions[QC_SUMMARY_ROW].height = 30
    sc = ws.cell(row=QC_SUMMARY_ROW, column=2, value=t("ΣΥΝΟΛΟ ΘΕΜΑΤΩΝ", "TOTAL ISSUES"))
    sc.font = Fnt(size=12, bold=True, color=DARK_BLUE); sc.alignment = Aln(h="left", v="center")
    stv = ws.cell(row=QC_SUMMARY_ROW, column=3, value=f"=SUM(E{QC_FIRST}:E{QC_LAST})")
    stv.font = Fnt(size=14, bold=True, color=DARK_BLUE); stv.alignment = Aln(h="center", v="center")
    wb.defined_names["QCIssueCount"] = DefinedName("QCIssueCount", attr_text=f"'12. Έλεγχοι Ποιότητας'!$C${QC_SUMMARY_ROW}")
    # references the SAME-SHEET column E helper cells (see the per-check
    # loop above), not the cross-sheet SUMPRODUCT/Table_Kin[...] expressions
    # directly — confirmed via Excel's own repair log ("Removed Feature:
    # Conditional formatting from sheet12") that a CF rule pointing at a
    # structured Table reference on ANOTHER sheet gets silently stripped on
    # open, regardless of formula length.
    ws.conditional_formatting.add(f"B{QC_SUMMARY_ROW}:C{QC_SUMMARY_ROW}",
        FormulaRule(formula=[f'$C{QC_SUMMARY_ROW}=0'], fill=green_fill_qc))
    ws.conditional_formatting.add(f"B{QC_SUMMARY_ROW}:C{QC_SUMMARY_ROW}",
        FormulaRule(formula=[f'$C{QC_SUMMARY_ROW}>0'], fill=red_fill_qc))

    TIP_QC = QC_SUMMARY_ROW + 2
    ws.merge_cells(start_row=TIP_QC, start_column=1, end_row=TIP_QC, end_column=4)
    c = ws.cell(row=TIP_QC, column=1,
                value="  " + t("Κάθε πράσινο «✓ OK» σημαίνει μηδέν προβλήματα του τύπου αυτού σήμερα. Ένας κόκκινος αριθμός είναι σύνδεσμος — πατήστε τον για να πάτε κατευθείαν στο σχετικό φύλλο και να βρείτε τις εγγραφές.",
                          "Every green “✓ OK” means zero problems of that type today. A red number is a link — click it to jump straight to the relevant sheet and find the rows."))
    c.font = Fnt(size=10, italic=True, color="FF6B7280")
    c.fill = F("FFF6F8FA"); c.alignment = Aln(h="left", wrap=True)
    ws.row_dimensions[TIP_QC].height = 32

    # ══════════════════════════════════════════════════════════════════════════
    # TAB: ΜΙΣΘΩΜΑΤΑ & ΑΠΟΔΟΣΕΙΣ  (rent roll → IRR/NPV/yield-on-cost/payback,
    # for the two projects that actually have lease terms on Προϋπολογισμοί
    # — Q003/Q004. Every input here is a REFERENCE to Προϋπολογισμοί/
    # Ρυθμίσεις, not a re-typed number, so changing the rent or the discount
    # rate in one place moves the returns here automatically.) ──
    # ══════════════════════════════════════════════════════════════════════════
    ws = ws_rent
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 30
    for letter in "BCDEFGH":
        ws.column_dimensions[letter].width = 15
    ws.freeze_panes = "A3"

    ws.row_dimensions[1].height = 34
    ws.merge_cells("A1:H1")
    c = ws.cell(row=1, column=1, value="  " + t("ΜΙΣΘΩΜΑΤΑ & ΑΠΟΔΟΣΕΙΣ", "RENT ROLL & RETURNS"))
    c.fill = F(DARK_BLUE); c.font = Fnt(size=14, bold=True, color=WHITE)
    c.alignment = Aln(h="left", v="center")
    sheet_intro(ws, 2,
        t("Δεν είναι έργα με απλό περιθώριο — είναι επενδύσεις. Ξοδεύετε κεφάλαιο τώρα και το παίρνετε πίσω "
          "σε βάθος ετών μέσω μισθώματος· το IRR/NPV παρακάτω δείχνει αν αξίζει τη δέσμευση.",
          "These aren't margin projects — they're investments. You spend capital now and get it back over "
          "years of rent; the IRR/NPV below shows whether the commitment is worth it."),
        end_col="H")

    rent_projects = [
        (PROJ_LAZ, "D", t("Λαζαράκη 32, Γλυφάδα", "Lazaraki 32, Glyfada")),
        ("Q004_AGIOU_KWNSTANTINOU20_GLYFADA", "E", t("Αγ. Κωνσταντίνου 20, Γλυφάδα", "Ag. Konstantinou 20, Glyfada")),
    ]
    RENT_YEARS = 25
    _rent_next = 3
    for proj_code, bud_col, proj_name in rent_projects:
        hdr_row = _rent_next
        ws.row_dimensions[hdr_row].height = 24
        ws.merge_cells(start_row=hdr_row, start_column=1, end_row=hdr_row, end_column=8)
        ph = ws.cell(row=hdr_row, column=1, value="  " + t("ΈΡΓΟ: ", "PROJECT: ") + proj_name)
        ph.fill = F(LIGHT_BLUE); ph.font = Fnt(size=11, bold=True, color=DARK_BLUE); ph.alignment = Aln(h="left", v="center")

        # ── assumptions: live references, not re-typed numbers ──
        A_RENT, A_ESC, A_TERM, A_START, A_STEP11, A_STEP14, A_OPEX, A_INV, A_LSTART, A_LOANPRIN, A_EXIT = (
            hdr_row + 1, hdr_row + 2, hdr_row + 3, hdr_row + 4, hdr_row + 5, hdr_row + 6, hdr_row + 7, hdr_row + 8, hdr_row + 9, hdr_row + 10, hdr_row + 11)
        assum = [
            (A_RENT, t("Μηνιαίο Μίσθωμα (Έτος 1)", "Monthly Rent (Year 1)"), f"='4. Προϋπολογισμοί'!{bud_col}{LEASE_HDR + 1}", EUR0, False),
            (A_ESC, t("Ετήσια Αναπροσαρμογή", "Annual Escalation"), f"='4. Προϋπολογισμοί'!{bud_col}{LEASE_HDR + 2}", "0,0%", False),
            (A_TERM, t("Διάρκεια Μίσθωσης (έτη)", "Lease Term (years)"), f"='4. Προϋπολογισμοί'!{bud_col}{LEASE_HDR + 3}", "0", False),
            (A_START, t("Έτος Έναρξης Μίσθωσης", "Lease Start Year"), f"='4. Προϋπολογισμοί'!{bud_col}{LEASE_HDR + 4}", "0", False),
            # stepped-rent bumps — 0 for a project with pure compound escalation
            # (e.g. Q003), a real fixed monthly bump for a project like Q004
            # whose lease has flat steps instead of an annual %.
            (A_STEP11, t("Προσαύξηση Έτους 11 (μηνιαίως)", "Year-11 Step-up (monthly)"), f"='4. Προϋπολογισμοί'!{bud_col}{LEASE_HDR + 5}", EUR0, False),
            (A_STEP14, t("Προσαύξηση Έτους 14 (μηνιαίως)", "Year-14 Step-up (monthly)"), f"='4. Προϋπολογισμοί'!{bud_col}{LEASE_HDR + 6}", EUR0, False),
            (A_OPEX, t("Λειτουργικά Έξοδα (% Μισθώματος)", "Operating Expenses (% of Rent)"), "=DefaultOpexPct", "0%", False),
            (A_INV, t("Επένδυση (Σεναριακός Προϋπολογισμός)", "Investment (Scenario Budget)"), f"='4. Προϋπολογισμοί'!{bud_col}{SCENARIO_BUDGET_ROW}", EUR0, False),
            # a blank source cell (Προϋπολογισμοί hasn't had a lease-start
            # date entered yet) makes a bare "=SourceCell" reference
            # evaluate to numeric 0, which a DD/MM/YYYY format then shows
            # as "00/01/1900" — reads as a real date, not as "missing".
            # IF(...="","",...) keeps it genuinely blank instead.
            (A_LSTART, t("Έναρξη Πληρωμής Μισθώματος", "Lease Payment Start Date"),
             f"=IF('4. Προϋπολογισμοί'!{bud_col}{TL_HDR + 3}=\"\",\"\",'4. Προϋπολογισμοί'!{bud_col}{TL_HDR + 3})", "DD/MM/YYYY", False),
            (A_LOANPRIN, t("Δανειακό Κεφάλαιο (Κατηγορία=Δάνειο)", "Loan Principal (Category=Loan)"),
             f'=SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_PROJECT}],"{proj_code}",Table_Kin[{H_CATEGORY}],"{CAT_LOAN}")', EUR0, False),
        ]
        # row numbers for the annual table below are fixed offsets from
        # A_EXIT, known now even though those cells aren't WRITTEN until
        # later — Excel resolves formula references at calc time, not at
        # write time, so A_EXIT's own default can forward-reference them.
        _TBL_HDR_PRE = A_EXIT + 2
        _YEAR0_PRE = _TBL_HDR_PRE + 1
        _YEAR_FIRST_PRE = _YEAR0_PRE + 1
        _YEAR_LAST_PRE = _YEAR_FIRST_PRE + RENT_YEARS - 1
        _stabilized_row_pre = f'IFERROR(MATCH(TRUE,INDEX(B{_YEAR_FIRST_PRE}:B{_YEAR_LAST_PRE}>YEAR(B{A_LSTART}),0),0),1)'
        # default exit value = stabilized NOI capitalized at the discount
        # rate (going-in cap rate = exit cap rate — the standard
        # simplifying assumption when a real appraisal isn't available
        # yet) — a LIVE, defensible starting number instead of a blank
        # that silently reads as "definitely €0" in the headline NPV, but
        # still a plain yellow cell you can overtype with a real appraisal.
        _default_exit_f = f"=ROUND(INDEX(E{_YEAR_FIRST_PRE}:E{_YEAR_LAST_PRE},{_stabilized_row_pre})/DiscountRate,0)"
        assum.append((A_EXIT, t("Υπολειμματική Αξία στο Τέλος Ορίζοντα (προεπιλογή: σταθεροπ. NOI / προεξοφλητικό — αντικαταστήστε με πραγματική εκτίμηση)",
                                 "Residual/Exit Value at Horizon End (default: stabilized NOI / discount rate — overwrite with a real appraisal)"),
                      _default_exit_f, EUR0, True))
        for r, lbl_txt, formula, fmt, is_input in assum:
            ws.row_dimensions[r].height = 18
            lbl(ws, r, 1, lbl_txt, bg=WHITE)
            if is_input:
                vc = ws.cell(row=r, column=2, value=formula)
                vc.number_format = fmt; vc.fill = F(YELLOW); vc.font = Fnt(size=10, bold=True, color=DARK_BLUE)
                vc.alignment = Aln(h="right", v="center"); vc.protection = UNLOCKED
            else:
                vc = ws.cell(row=r, column=2, value=formula)
                vc.number_format = fmt; vc.fill = F(WHITE); vc.font = Fnt(size=10, bold=True, color=DARK_BLUE)
                vc.alignment = Aln(h="right", v="center")

        # ── annual cash-flow table: year 0 = -investment, years 1..25 =
        # NOI while the lease term is still running, 0 after. Two cash-flow
        # columns — F (unlevered: full investment out, pure NOI in) and H
        # (levered: EQUITY only out — investment minus the real loan
        # principal from Κινήσεις — and NOI minus that same loan's debt
        # service in) — instead of the old single column that put the
        # FULL investment out without ever subtracting or servicing the
        # €1.6M loan anywhere, which was neither a clean unlevered nor a
        # clean levered view. H naturally reduces to the same as F for a
        # project with no loan tranches (A_LOANPRIN=0). ──
        TBL_HDR = A_EXIT + 2
        ann_headers = [t("Έτος", "Year"), t("Ημερ. Έτος", "Cal. Year"), t("Ετήσιο Μίσθωμα", "Annual Rent"),
                       t("Λειτουργικά Έξοδα", "Opex"), "NOI", t("Ταμειακή Ροή (Unlevered)", "Cash Flow (Unlevered)"),
                       t("Σωρευτική Ροή", "Cumulative"), t("Ταμειακή Ροή (Levered)", "Cash Flow (Levered)")]
        for ci, h in enumerate(ann_headers, 1):
            col_hdr(ws, TBL_HDR, ci, h)
        YEAR0 = TBL_HDR + 1
        ws.row_dimensions[YEAR0].height = 18
        y0c = ws.cell(row=YEAR0, column=1, value=0); y0c.fill = F(LIGHT_GREY); y0c.alignment = Aln(h="center")
        y0c.font = Fnt(size=9, bold=True, color=DARK_BLUE)
        for ci in (2, 3, 4, 5):
            ws.cell(row=YEAR0, column=ci).fill = F(LIGHT_GREY)
        cf0 = ws.cell(row=YEAR0, column=6, value=f"=-B{A_INV}")
        cf0.number_format = EUR0; cf0.fill = F(LIGHT_GREY); cf0.font = Fnt(size=9, bold=True, color=RED_FG); cf0.alignment = Aln(h="right")
        cum0 = ws.cell(row=YEAR0, column=7, value=f"=F{YEAR0}")
        cum0.number_format = EUR0; cum0.fill = F(LIGHT_GREY); cum0.font = Fnt(size=9, bold=True); cum0.alignment = Aln(h="right")
        cf0_lev = ws.cell(row=YEAR0, column=8, value=f"=-(B{A_INV}-B{A_LOANPRIN})")
        cf0_lev.number_format = EUR0; cf0_lev.fill = F(LIGHT_GREY); cf0_lev.font = Fnt(size=9, bold=True, color=RED_FG); cf0_lev.alignment = Aln(h="right")
        YEAR_FIRST = YEAR0 + 1
        for yi in range(RENT_YEARS):
            row = YEAR_FIRST + yi
            yr = yi + 1
            ws.row_dimensions[row].height = 16
            yc = ws.cell(row=row, column=1, value=yr); yc.alignment = Aln(h="center"); yc.font = Fnt(size=9); yc.fill = F(WHITE)
            calc_yr = ws.cell(row=row, column=2, value=f"=B{A_START}+{yr}-1")
            calc_yr.alignment = Aln(h="center"); calc_yr.font = Fnt(size=9, color="FF6B7280"); calc_yr.fill = F(WHITE)
            # Prorated by CALENDAR YEAR against the real lease-start date,
            # not just "is this row #1" — the old version prorated
            # whichever row happened to be Year 1 regardless of whether the
            # lease-start YEAR actually landed there, so a lease starting
            # in a later calendar year than B{A_START} would still get
            # (wrongly) prorated at row 1 instead of getting zero rent
            # until the year it actually starts. Now: years before the
            # lease-start year get €0, the exact start year gets the
            # month-prorated amount, later years get the full escalated
            # rent. Blank start date (no such data for this project) falls
            # back to a full first year, unchanged.
            full_rent = f"(B{A_RENT}+IF({yr}>=11,B{A_STEP11},0)+IF({yr}>=14,B{A_STEP14},0))*12*(1+B{A_ESC})^({yr}-1)"
            yr_frac = f'(13-MONTH(B{A_LSTART}))/12'
            prorated_f = (f'IF(B{A_LSTART}="",{full_rent},'
                          f'IF(B{row}<YEAR(B{A_LSTART}),0,'
                          f'IF(B{row}=YEAR(B{A_LSTART}),{full_rent}*{yr_frac},{full_rent})))')
            rent_f = ws.cell(row=row, column=3,
                value=f"=IF({yr}<=B{A_TERM},{prorated_f},0)")
            rent_f.number_format = EUR0; rent_f.alignment = Aln(h="right"); rent_f.font = Fnt(size=9); rent_f.fill = F(WHITE)
            opex_f = ws.cell(row=row, column=4, value=f"=C{row}*B{A_OPEX}")
            opex_f.number_format = EUR0; opex_f.alignment = Aln(h="right"); opex_f.font = Fnt(size=9, color=RED_FG); opex_f.fill = F(WHITE)
            noi_f = ws.cell(row=row, column=5, value=f"=C{row}-D{row}")
            noi_f.number_format = EUR0; noi_f.alignment = Aln(h="right"); noi_f.font = Fnt(size=9, bold=True, color=GREEN_FG); noi_f.fill = F(WHITE)
            # optional residual/exit value lands in the FINAL modeled year
            # only — a real terminal cash flow (sale/refinance), not
            # fabricated: blank by default, stays €0 unless you type one in.
            exit_term = f"+B{A_EXIT}" if yi == RENT_YEARS - 1 else ""
            cf_f = ws.cell(row=row, column=6, value=f"=E{row}{exit_term}")
            cf_f.number_format = EUR0; cf_f.alignment = Aln(h="right"); cf_f.font = Fnt(size=9); cf_f.fill = F(WHITE)
            cum_f = ws.cell(row=row, column=7, value=f"=G{row-1}+F{row}")
            cum_f.number_format = EUR0; cum_f.alignment = Aln(h="right"); cum_f.font = Fnt(size=9, bold=True, color=DARK_BLUE); cum_f.fill = F(WHITE)
            # levered: NOI minus this project's own loan debt service for
            # the matching calendar year — guarded by A_LOANPRIN so a
            # project with no loan tranches (A_LOANPRIN=0) never picks up
            # ANOTHER project's LoanDebtServiceAmounts by coincidence of
            # calendar-year overlap.
            loan_ds_this_yr = (f'IF(B{A_LOANPRIN}=0,0,SUMPRODUCT((LoanDebtServiceYears=B{row})*LoanDebtServiceAmounts))')
            cf_lev = ws.cell(row=row, column=8, value=f"=E{row}-({loan_ds_this_yr}){exit_term}")
            cf_lev.number_format = EUR0; cf_lev.alignment = Aln(h="right"); cf_lev.font = Fnt(size=9, color="FF965800"); cf_lev.fill = F(WHITE)
        YEAR_LAST = YEAR_FIRST + RENT_YEARS - 1
        for r in range(YEAR_FIRST + 8, YEAR_LAST + 1):
            ws.row_dimensions[r].outline_level = 1
            ws.row_dimensions[r].hidden = True
        if proj_code == PROJ_LAZ:
            RENT_Q003_YEAR_FIRST, RENT_Q003_NOI_COL = YEAR_FIRST, "E"
            wb.defined_names["Q003RentNOI"] = DefinedName(
                "Q003RentNOI", attr_text=f"'13. Μισθώματα & Αποδόσεις'!$E${YEAR_FIRST}:$E${YEAR_LAST}")
            wb.defined_names["Q003RentCalYears"] = DefinedName(
                "Q003RentCalYears", attr_text=f"'13. Μισθώματα & Αποδόσεις'!$B${YEAR_FIRST}:$B${YEAR_LAST}")

        # ── returns metrics — all live formulas over the table above ──
        MET_HDR = YEAR_LAST + 2
        ws.row_dimensions[MET_HDR].height = 22
        ws.merge_cells(start_row=MET_HDR, start_column=1, end_row=MET_HDR, end_column=8)
        mh = ws.cell(row=MET_HDR, column=1, value="  " + t("ΔΕΙΚΤΕΣ ΑΠΟΔΟΣΗΣ", "RETURN METRICS"))
        mh.fill = F("FFFEF0D8"); mh.font = Fnt(size=10, bold=True, color="FF965800"); mh.alignment = Aln(h="left", v="center")
        irr_row, npv_row, yield_row, payback_row = MET_HDR + 1, MET_HDR + 2, MET_HDR + 3, MET_HDR + 4
        irr_lev_row, npv_lev_row = MET_HDR + 5, MET_HDR + 6
        mrow(ws, irr_row, t("IRR (Unlevered)", "IRR (Unlevered)"), f"=IFERROR(IRR(F{YEAR0}:F{YEAR_LAST}),\"—\")", "",
             value_fmt="0,0%", value_bold=True, value_color="FF965800", col0=1)
        # a blank Υπολειμματική Αξία isn't "zero, confirmed" — it's "not
        # estimated yet", and NPV silently treats it as €0 either way. This
        # note makes that assumption visible right next to the number
        # instead of leaving a viewer to assume the model already accounts
        # for a resale/refinance value when it doesn't.
        _exit_warn = (f'IF(B{A_EXIT}="","  ⚠ '
                      + t("χωρίς Υπολειμματική Αξία (υποθέτει €0 έξοδο)", "no Exit Value set (assumes €0 residual)")
                      + '","")')
        mrow(ws, npv_row, t("NPV (Unlevered)", "NPV (Unlevered)"), f"=ROUND(NPV(DiscountRate,F{YEAR_FIRST}:F{YEAR_LAST})+F{YEAR0},0)",
             f'={_exit_warn}',
             value_fmt=EUR0_NEG, value_bold=True, value_color="FF965800", col0=1)
        # levered — equity-only in, NOI-minus-debt-service out (see column
        # H above). Same investment/return question, different capital
        # base: the old sheet mixed the two by putting the FULL investment
        # out without ever crediting or servicing the €1.6M loan anywhere.
        mrow(ws, irr_lev_row, t("IRR (Levered, μετά δανείου)", "IRR (Levered, after loan)"),
             f"=IFERROR(IRR(H{YEAR0}:H{YEAR_LAST}),\"—\")", "",
             value_fmt="0,0%", value_bold=True, value_color=GREEN_FG, label_bg=GREEN_BG, value_bg=GREEN_BG, note_bg=GREEN_BG, col0=1)
        mrow(ws, npv_lev_row, t("NPV (Levered, μετά δανείου)", "NPV (Levered, after loan)"),
             f"=ROUND(NPV(DiscountRate,H{YEAR_FIRST}:H{YEAR_LAST})+H{YEAR0},0)", "",
             value_fmt=EUR0_NEG, value_bold=True, value_color=GREEN_FG, label_bg=GREEN_BG, value_bg=GREEN_BG, note_bg=GREEN_BG, col0=1)
        # first STABILIZED (full, non-prorated) year's NOI, not Year 1's —
        # Year 1 is only a partial year whenever the lease starts mid-year,
        # so using it directly understated the real run-rate yield (a
        # €20k 4-month NOI over a €2.16M cost read as ~0.9% instead of the
        # ~2.9% a full year like Year 2 actually produces). INDEX(...,0)
        # forces the comparison to array-evaluate without Ctrl+Shift+Enter,
        # same technique as the payback MATCH right below. Blank lease-
        # start date (YEAR(blank)=1900) makes every real row qualify, so
        # this falls back to Year 1 exactly like before when there's no
        # start-date data at all.
        stabilized_row = f'IFERROR(MATCH(TRUE,INDEX(B{YEAR_FIRST}:B{YEAR_LAST}>YEAR(B{A_LSTART}),0),0),1)'
        mrow(ws, yield_row, t("Yield on Cost (σταθεροπ. έτος)", "Yield on Cost (stabilized year)"),
             f"=IFERROR(INDEX(E{YEAR_FIRST}:E{YEAR_LAST},{stabilized_row})/B{A_INV},\"—\")", "",
             value_fmt="0,0%", value_bold=True, value_color="FF965800", col0=1)
        # payback: first year the cumulative flow crosses zero. INDEX(...,0)
        # forces the comparison to evaluate as an array without Ctrl+Shift+
        # Enter — same technique already used for the cash-runway MATCH on
        # Κέντρο Ελέγχου.
        payback_f = f'IFERROR(MATCH(TRUE,INDEX(G{YEAR_FIRST}:G{YEAR_LAST}>=0,0),0),"{t("Δεν αποσβένεται","Never")}")'
        mrow(ws, payback_row, t("Payback (έτη από έναρξη λειτουργίας)", "Payback (years from operation start)"),
             f"={payback_f}", "", value_bold=True, value_color="FF965800", col0=1)
        for ci in range(5, 9):
            for r in (irr_row, npv_row, yield_row, payback_row, irr_lev_row, npv_lev_row):
                ws.cell(row=r, column=ci).fill = F(WHITE)
        if proj_code == PROJ_LAZ:
            wb.defined_names["Q003IRR"] = DefinedName("Q003IRR", attr_text=f"'13. Μισθώματα & Αποδόσεις'!$C${irr_row}")
            wb.defined_names["Q003FinancingNPV"] = DefinedName("Q003FinancingNPV", attr_text=f"'13. Μισθώματα & Αποδόσεις'!$C${npv_row}")
            wb.defined_names["Q003LeveredIRR"] = DefinedName("Q003LeveredIRR", attr_text=f"'13. Μισθώματα & Αποδόσεις'!$C${irr_lev_row}")
            wb.defined_names["Q003LeveredCF0"] = DefinedName("Q003LeveredCF0", attr_text=f"'13. Μισθώματα & Αποδόσεις'!$H${YEAR0}")
            wb.defined_names["Q003LeveredCFRange"] = DefinedName("Q003LeveredCFRange", attr_text=f"'13. Μισθώματα & Αποδόσεις'!$H${YEAR_FIRST}:$H${YEAR_LAST}")
            wb.defined_names["Q003HorizonYears"] = DefinedName("Q003HorizonYears", attr_text=f"'13. Μισθώματα & Αποδόσεις'!${get_column_letter(1)}${YEAR_LAST}")
        # Q004's own metrics block (this loop already computes it, same as
        # Q003's above — nothing new is calculated here, just named so
        # Κέντρο Ελέγχου can reference it. No DSCR name for Q004: unlike
        # Q003, no loan is modeled against this project anywhere in
        # 14. Δάνεια (that sheet's whole DSCR block is Q003-specific — the
        # €1.6M Δάνειο Α/Β financing), so IRR + Payback are the two live
        # metrics actually available for the Q004 dashboard card.
        if proj_code == PROJ_AGK:
            wb.defined_names["Q004IRR"] = DefinedName("Q004IRR", attr_text=f"'13. Μισθώματα & Αποδόσεις'!$C${irr_row}")
            wb.defined_names["Q004Payback"] = DefinedName("Q004Payback", attr_text=f"'13. Μισθώματα & Αποδόσεις'!$C${payback_row}")

            # ── Sensitivity grid — NPV (Levered) vs. Discount Rate × Exit
            # Value. openpyxl can't write a real Excel "What-If Data Table"
            # (it needs a special {=TABLE(...)} array record Excel itself
            # generates — same class of limitation as PivotTables, already
            # hit earlier this session), so each cell here is its own
            # self-contained formula rather than one live data table. The
            # algebra: NPV(rate,H_range)+H_YEAR0 already reflects the
            # CURRENT exit value once (it's baked into the last row of H);
            # swapping in a different exit value only changes that one
            # terminal cash flow, discounted back N periods — so
            # NPV(rate,H_range)+H_YEAR0+(exit-B{A_EXIT})/(1+rate)^N gives
            # the correct NPV for ANY (rate,exit) pair without touching the
            # live H column or the live A_EXIT input at all.
            SENS_HDR = npv_lev_row + 2
            ws.row_dimensions[SENS_HDR].height = 22
            ws.merge_cells(start_row=SENS_HDR, start_column=1, end_row=SENS_HDR, end_column=8)
            sh = ws.cell(row=SENS_HDR, column=1,
                value="  " + t("ΑΝΑΛΥΣΗ ΕΥΑΙΣΘΗΣΙΑΣ  —  NPV (Levered) έναντι Προεξοφλητικού Επιτοκίου × Υπολειμματικής Αξίας",
                                "SENSITIVITY ANALYSIS  —  NPV (Levered) vs. Discount Rate × Exit Value"))
            sh.fill = F("FFFEF0D8"); sh.font = Fnt(size=10, bold=True, color="FF965800"); sh.alignment = Aln(h="left", v="center")
            SENS_N = RENT_YEARS   # periods from YEAR_FIRST to the exit-value row
            sens_rates = [0.04, 0.06, 0.08, 0.10]
            sens_exits = [0, 300000, 600000, 900000]
            SENS_TOP = SENS_HDR + 1
            corner = ws.cell(row=SENS_TOP, column=2, value=t("Επιτόκιο ↓ / Έξοδος →", "Rate ↓ / Exit →"))
            corner.font = Fnt(size=8, italic=True, color="FF6B7280"); corner.fill = F(WHITE); corner.alignment = Aln(h="center")
            for ci, exit_val in enumerate(sens_exits):
                hc = ws.cell(row=SENS_TOP, column=3 + ci, value=exit_val)
                hc.number_format = EUR0; hc.font = Fnt(size=9, bold=True, color=DARK_BLUE); hc.fill = F(LIGHT_BLUE)
                hc.alignment = Aln(h="center")
            for ri, rate in enumerate(sens_rates):
                row = SENS_TOP + 1 + ri
                ws.row_dimensions[row].height = 16
                rc = ws.cell(row=row, column=2, value=rate)
                rc.number_format = "0%"; rc.font = Fnt(size=9, bold=True, color=DARK_BLUE); rc.fill = F(LIGHT_BLUE)
                rc.alignment = Aln(h="center")
                for ci, exit_val in enumerate(sens_exits):
                    col = 3 + ci
                    cell_f = (f"=ROUND(NPV({rate},H{YEAR_FIRST}:H{YEAR_LAST})+H{YEAR0}"
                              f"+({exit_val}-B{A_EXIT})/(1+{rate})^{SENS_N},0)")
                    vc = ws.cell(row=row, column=col, value=cell_f)
                    vc.number_format = EUR0_NEG; vc.font = Fnt(size=9); vc.fill = F(WHITE)
                    vc.alignment = Aln(h="right")
            ws.conditional_formatting.add(f"C{SENS_TOP+1}:F{SENS_TOP+len(sens_rates)}",
                CellIsRule(operator="lessThan", formula=["0"],
                           fill=PatternFill(start_color=RED_BG, end_color=RED_BG, fill_type="solid"),
                           font=Font(name="Calibri", size=9, color=RED_FG)))
            ws.conditional_formatting.add(f"C{SENS_TOP+1}:F{SENS_TOP+len(sens_rates)}",
                CellIsRule(operator="greaterThanOrEqual", formula=["0"],
                           fill=PatternFill(start_color=GREEN_BG, end_color=GREEN_BG, fill_type="solid"),
                           font=Font(name="Calibri", size=9, color="0B6640")))
            SENS_LAST = SENS_TOP + len(sens_rates)
            snote = ws.cell(row=SENS_LAST + 1, column=1,
                value=t("Στατικός πίνακας ευαισθησίας (όχι live Excel Data Table — τεχνικός περιορισμός) — αλλάξτε τις τιμές επιτοκίου/εξόδου παραπάνω απευθείας αν χρειάζεστε άλλο εύρος.",
                        "Static sensitivity grid (not a live Excel Data Table — a tooling limitation) — edit the rate/exit values above directly if you need a different range."))
            ws.merge_cells(start_row=SENS_LAST + 1, start_column=1, end_row=SENS_LAST + 1, end_column=8)
            snote.font = Fnt(size=8, italic=True, color="FF6B7280"); snote.fill = F(WHITE); snote.alignment = Aln(h="left", wrap=True)

            # ── Grid 2 — the more directly relevant construction-risk axis:
            # Discount Rate × Cost Overrun % on the investment itself. A
            # cost overrun raises the equity funded at Year 0 by
            # overrun%×Investment (the loan amount is assumed fixed — an
            # overrun is funded by more equity, not a bigger loan) and
            # doesn't touch the NOI stream at all, so the algebra is a
            # direct subtraction: NPV(rate,H_range)+H_YEAR0 -
            # Investment×overrun%. Same non-live-Data-Table caveat as Grid 1.
            SENS2_HDR = SENS_LAST + 2
            ws.row_dimensions[SENS2_HDR].height = 22
            ws.merge_cells(start_row=SENS2_HDR, start_column=1, end_row=SENS2_HDR, end_column=8)
            sh2 = ws.cell(row=SENS2_HDR, column=1,
                value="  " + t("ΑΝΑΛΥΣΗ ΕΥΑΙΣΘΗΣΙΑΣ 2  —  NPV (Levered) έναντι Προεξοφλητικού Επιτοκίου × Υπέρβασης Κόστους Κατασκευής",
                                "SENSITIVITY ANALYSIS 2  —  NPV (Levered) vs. Discount Rate × Construction Cost Overrun"))
            sh2.fill = F("FFFEF0D8"); sh2.font = Fnt(size=10, bold=True, color="FF965800"); sh2.alignment = Aln(h="left", v="center")
            sens_overruns = [0, 0.10, 0.20, 0.30]
            SENS2_TOP = SENS2_HDR + 1
            corner2 = ws.cell(row=SENS2_TOP, column=2, value=t("Επιτόκιο ↓ / Υπέρβαση →", "Rate ↓ / Overrun →"))
            corner2.font = Fnt(size=8, italic=True, color="FF6B7280"); corner2.fill = F(WHITE); corner2.alignment = Aln(h="center")
            for ci, ov in enumerate(sens_overruns):
                hc = ws.cell(row=SENS2_TOP, column=3 + ci, value=ov)
                hc.number_format = "0%"; hc.font = Fnt(size=9, bold=True, color=DARK_BLUE); hc.fill = F(LIGHT_BLUE)
                hc.alignment = Aln(h="center")
            for ri, rate in enumerate(sens_rates):
                row = SENS2_TOP + 1 + ri
                ws.row_dimensions[row].height = 16
                rc = ws.cell(row=row, column=2, value=rate)
                rc.number_format = "0%"; rc.font = Fnt(size=9, bold=True, color=DARK_BLUE); rc.fill = F(LIGHT_BLUE)
                rc.alignment = Aln(h="center")
                for ci, ov in enumerate(sens_overruns):
                    col = 3 + ci
                    cell_f = f"=ROUND(NPV({rate},H{YEAR_FIRST}:H{YEAR_LAST})+H{YEAR0}-B{A_INV}*{ov},0)"
                    vc = ws.cell(row=row, column=col, value=cell_f)
                    vc.number_format = EUR0_NEG; vc.font = Fnt(size=9); vc.fill = F(WHITE)
                    vc.alignment = Aln(h="right")
            ws.conditional_formatting.add(f"C{SENS2_TOP+1}:F{SENS2_TOP+len(sens_rates)}",
                CellIsRule(operator="lessThan", formula=["0"],
                           fill=PatternFill(start_color=RED_BG, end_color=RED_BG, fill_type="solid"),
                           font=Font(name="Calibri", size=9, color=RED_FG)))
            ws.conditional_formatting.add(f"C{SENS2_TOP+1}:F{SENS2_TOP+len(sens_rates)}",
                CellIsRule(operator="greaterThanOrEqual", formula=["0"],
                           fill=PatternFill(start_color=GREEN_BG, end_color=GREEN_BG, fill_type="solid"),
                           font=Font(name="Calibri", size=9, color="0B6640")))
            SENS2_LAST = SENS2_TOP + len(sens_rates)
            _sens_bottom = SENS2_LAST + 1
        else:
            _sens_bottom = npv_lev_row + 1

        _rent_next = max(npv_lev_row + 2, _sens_bottom + 1)
    RENT_TIP = _rent_next
    ws.merge_cells(start_row=RENT_TIP, start_column=1, end_row=RENT_TIP, end_column=8)
    rtip = ws.cell(row=RENT_TIP, column=1,
        value="  " + t("Όλες οι παραδοχές (μίσθωμα, αναπροσαρμογή, διάρκεια) τραβιούνται ζωντανά από το Προϋπολογισμοί· Λειτουργικά Έξοδα και Προεξοφλητικό Επιτόκιο από το Ρυθμίσεις. NOI = Μίσθωμα μείον Λειτουργικά Έξοδα — δεν αφαιρεί χρεολύσιο δανείου (βλ. Δάνεια για DSCR). Γραμμές έτους 9-25 συμπτυγμένες από προεπιλογή.",
                      "Every assumption (rent, escalation, term) is a live reference to Προϋπολογισμοί; Operating Expenses and Discount Rate come from Ρυθμίσεις. NOI = Rent minus Operating Expenses — does NOT subtract loan debt service (see Δάνεια for DSCR). Year 9-25 rows are collapsed by default."))
    rtip.font = Fnt(size=9, italic=True, color="FF6B7280")
    rtip.fill = F("FFF6F8FA"); rtip.alignment = Aln(h="left", wrap=True)
    ws.row_dimensions[RENT_TIP].height = 40

    # ══════════════════════════════════════════════════════════════════════════
    # TAB: ΔΑΝΕΙΑ  (amortization + DSCR for the Q003 financing — Δάνειο Α
    # 0,35% and Δάνειο Β 3,5%, the €1.6M that used to land in Ταμείο as pure
    # income with no interest, grace period, or principal repayment
    # anywhere. ANNUAL granularity, not monthly — the three real tranches
    # (Ιαν/Απρ/Ιουλ 2027) all land inside the same calendar year, so a
    # monthly schedule would mean 240 rows of formulas for no real
    # precision gain over a 20-row annual one; flagged in the tip below.) ──
    # ══════════════════════════════════════════════════════════════════════════
    ws = ws_loans
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 14
    for letter in "BCDEFG":
        ws.column_dimensions[letter].width = 16
    ws.freeze_panes = "A3"

    ws.row_dimensions[1].height = 34
    ws.merge_cells("A1:G1")
    c = ws.cell(row=1, column=1, value="  " + t("ΔΑΝΕΙΑ  —  ΧΡΕΟΛΥΣΙΟ & DSCR (Q003)", "LOANS  —  AMORTIZATION & DSCR (Q003)"))
    c.fill = F(DARK_BLUE); c.font = Fnt(size=14, bold=True, color=WHITE)
    c.alignment = Aln(h="left", v="center")
    sheet_intro(ws, 2,
        t("Το χρεολύσιο και ο δείκτης DSCR των δανείων Α+Β του Q003 — δείχνει αν τα έσοδα του έργου καλύπτουν "
          "άνετα τη δόση κάθε χρόνο, όχι μόνο αν απλώς τη φτάνουν.",
          "Amortization and the DSCR ratio for Q003's Loan A+B — shows whether the project's income covers "
          "the yearly installment comfortably, not just barely."),
        end_col="G")

    LOAN_YEARS = 20
    loan_defs = [
        (t("Δάνειο Α (επιδοτούμενο)", "Loan A (subsidized)"), 0.0035, "Δάνειο Α"),
        (t("Δάνειο Β (συμβατικό)", "Loan B (conventional)"), 0.035, "Δάνειο Β"),
    ]
    _loan_next = 3
    loan_ds_rows = []   # (annual_first_row, annual_last_row) per loan, for the combined DSCR block
    loan_prin_rows = []   # A_PRIN row per loan, for the new ΣΥΝΟΨΗ ΔΑΝΕΙΑΚΗΣ ΘΕΣΗΣ block below
    for loan_name, rate, match_text in loan_defs:
        hdr_row = _loan_next
        ws.row_dimensions[hdr_row].height = 24
        ws.merge_cells(start_row=hdr_row, start_column=1, end_row=hdr_row, end_column=7)
        lh = ws.cell(row=hdr_row, column=1, value="  " + loan_name)
        lh.fill = F(LIGHT_BLUE); lh.font = Fnt(size=11, bold=True, color=DARK_BLUE); lh.alignment = Aln(h="left", v="center")

        A_PRIN, A_RATE = hdr_row + 1, hdr_row + 2
        ws.row_dimensions[A_PRIN].height = 18
        lbl(ws, A_PRIN, 1, t("Κεφάλαιο (σύνολο τραγχών)", "Principal (all tranches)"), bg=WHITE)
        # SUMIFS off the real Κινήσεις tranches (matched on Σημειώσεις
        # starting with "Δάνειο Α"/"Δάνειο Β" — the exact text already on
        # each of the 6 real tranche rows) instead of a hardcoded number —
        # add/edit a tranche in Κινήσεις and this sheet now moves with it.
        pc = ws.cell(row=A_PRIN, column=2,
            value=(f'=SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_PROJECT}],"{PROJ_LAZ}",'
                   f'Table_Kin[{H_CATEGORY}],"{CAT_LOAN}",Table_Kin[{H_NOTES}],"{match_text}*")'))
        pc.number_format = EUR0; pc.fill = F(WHITE); pc.font = Fnt(size=10, bold=True, color=DARK_BLUE); pc.alignment = Aln(h="right")
        loan_prin_rows.append(A_PRIN)
        ws.row_dimensions[A_RATE].height = 18
        lbl(ws, A_RATE, 1, t("Επιτόκιο", "Interest Rate"), bg=WHITE)
        rc = ws.cell(row=A_RATE, column=2, value=rate)
        rc.number_format = "0,00%"; rc.fill = F(WHITE); rc.font = Fnt(size=10, bold=True, color=DARK_BLUE); rc.alignment = Aln(h="right")

        TBL_HDR = A_RATE + 2
        loan_headers = [t("Έτος", "Year"), t("Υπόλοιπο Έναρξης", "Opening Balance"), t("Εκταμιεύσεις", "Draws"),
                        t("Τόκοι", "Interest"), t("Χρεολύσιο", "Principal"), t("Σύνολο Δόσης", "Total Payment"),
                        t("Υπόλοιπο Λήξης", "Closing Balance")]
        for ci, h in enumerate(loan_headers, 1):
            col_hdr(ws, TBL_HDR, ci, h)
        YEAR_FIRST = TBL_HDR + 1
        for yi in range(LOAN_YEARS):
            row = YEAR_FIRST + yi
            yr = yi + 1
            ws.row_dimensions[row].height = 16
            yc = ws.cell(row=row, column=1, value=yr); yc.alignment = Aln(h="center"); yc.font = Fnt(size=9); yc.fill = F(WHITE)
            opening = ws.cell(row=row, column=2,
                value=(0 if yi == 0 else f"=G{row-1}"))
            opening.number_format = EUR0; opening.alignment = Aln(h="right"); opening.font = Fnt(size=9); opening.fill = F(WHITE)
            draws = ws.cell(row=row, column=3, value=(f"=B{A_PRIN}" if yi == 0 else 0))
            draws.number_format = EUR0; draws.alignment = Aln(h="right"); draws.font = Fnt(size=9, color="FF6B7280"); draws.fill = F(WHITE)
            # year 1's balance starts at 0 and the full principal draws in
            # during the year (all three real tranches land in the same
            # calendar year) — interest is charged on the DRAWN amount, not
            # the (zero) opening balance, only in year 1.
            if yi == 0:
                interest = ws.cell(row=row, column=4, value=f"=C{row}*B{A_RATE}")
            else:
                # MAX(0,B{row}) — a repeating-decimal straight-line slice
                # (e.g. €500.000/7 years) never divides evenly, so the
                # Opening Balance can land a few cents off zero in the
                # loan's final year; without this floor that residual
                # (positive OR the tiny negative float noise from repeated
                # subtraction) kept generating phantom interest for years
                # after the loan was actually fully repaid.
                interest = ws.cell(row=row, column=4, value=f"=MAX(0,B{row})*B{A_RATE}")
            interest.number_format = EUR0; interest.alignment = Aln(h="right"); interest.font = Fnt(size=9, color="FF965800"); interest.fill = F(WHITE)
            # straight-line principal over the post-grace years — 0 during
            # LoanGraceMonths (rounded to whole years) and 0 once the term
            # is fully repaid. MAX(1,...) on the denominator — if someone
            # sets the grace period at or past the full term (e.g. 15-year
            # term, 180-month grace), the post-grace year count would
            # otherwise hit 0 and this whole sheet (and DSCR, and Ταμείο)
            # would break on a straight #DIV/0!. MIN(...,MAX(0,B{row})) —
            # never pay more than what's actually still owed: a straight-
            # line slice off a non-divisible principal (€500.000/7 years)
            # otherwise overpays in the final year, driving the Closing
            # Balance negative and cascading tiny negative "debt" through
            # every later year (exactly what previously showed up as
            # -2,6e-10 balances/interest in years 16-20).
            principal_f = (f'=IF({yr}<=ROUND(LoanGraceMonths/12,0),0,'
                            f'IF({yr}>LoanTermYears,0,MIN(MAX(0,B{row}),B{A_PRIN}/MAX(1,LoanTermYears-ROUND(LoanGraceMonths/12,0)))))')
            princ = ws.cell(row=row, column=5, value=principal_f)
            princ.number_format = EUR0; princ.alignment = Aln(h="right"); princ.font = Fnt(size=9, bold=True, color=RED_FG); princ.fill = F(WHITE)
            total_pay = ws.cell(row=row, column=6, value=f"=D{row}+E{row}")
            total_pay.number_format = EUR0; total_pay.alignment = Aln(h="right"); total_pay.font = Fnt(size=9, bold=True, color=DARK_BLUE); total_pay.fill = F(WHITE)
            # ROUND to the cent + MAX(0,...) — kills any residual float
            # dust outright instead of letting it compound year over year.
            closing = ws.cell(row=row, column=7, value=f"=ROUND(MAX(0,B{row}+C{row}-E{row}),2)")
            closing.number_format = EUR0; closing.alignment = Aln(h="right"); closing.font = Fnt(size=9); closing.fill = F(WHITE)
        YEAR_LAST = YEAR_FIRST + LOAN_YEARS - 1
        for r in range(YEAR_FIRST + 8, YEAR_LAST + 1):
            ws.row_dimensions[r].outline_level = 1
            ws.row_dimensions[r].hidden = True
        loan_ds_rows.append((YEAR_FIRST, YEAR_LAST))

        # Real Year-1 draw detail — up to 3 real tranches, pulled live from
        # Κινήσεις via AGGREGATE(15,6,...) (array-native "kth smallest
        # ignoring errors", no Ctrl+Shift+Enter needed — same idiom family
        # as the INDEX(...,0) trick used elsewhere in this file). The
        # amortization table above stays ANNUAL (all 3 real tranches land
        # in the same calendar year — see the tip below), but this makes
        # the actual draw DATES visible instead of only the annual total.
        DRAW_HDR = YEAR_LAST + 1
        ws.row_dimensions[DRAW_HDR].height = 16
        dh2 = ws.cell(row=DRAW_HDR, column=1, value=t("Πραγματικές Τράγχες (Έτος 1)", "Real Draws (Year 1)"))
        dh2.font = Fnt(size=9, bold=True, color="FF6B7280"); dh2.fill = F(WHITE)
        for ci, h in ((2, t("Ημερομηνία", "Date")), (3, t("Ποσό", "Amount"))):
            hc = ws.cell(row=DRAW_HDR, column=ci, value=h)
            hc.font = Fnt(size=8, italic=True, color="FF6B7280"); hc.fill = F(WHITE); hc.alignment = Aln(h="right")
        DRAW_FIRST = DRAW_HDR + 1
        # plain sheet ranges, NOT Table_Kin[...] structured references —
        # confirmed via COM that Excel silently rewrites a bare structured
        # reference used inside ROW()/AGGREGATE() OUTSIDE the table's own
        # rows into an "@"-qualified (implicit-intersection) reference the
        # moment the file is opened, which collapses the whole-column array
        # this formula needs down to a single (wrong) cell — every row then
        # silently fell through to the IFERROR "—" fallback despite real
        # data existing. A plain range address is never subject to that
        # rewrite, so this sidesteps it entirely rather than fighting it.
        _kin_date_rng = f"'2. Κινήσεις'!${get_column_letter(1)}${FIRST_DATA_ROW}:${get_column_letter(1)}${LAST_ROW}"
        _kin_proj_rng = f"'2. Κινήσεις'!${get_column_letter(4)}${FIRST_DATA_ROW}:${get_column_letter(4)}${LAST_ROW}"
        _kin_amt_rng = f"'2. Κινήσεις'!${get_column_letter(7)}${FIRST_DATA_ROW}:${get_column_letter(7)}${LAST_ROW}"
        _kin_notes_rng = f"'2. Κινήσεις'!${get_column_letter(16)}${FIRST_DATA_ROW}:${get_column_letter(16)}${LAST_ROW}"
        _kin_cat_rng = f"'2. Κινήσεις'!${get_column_letter(32)}${FIRST_DATA_ROW}:${get_column_letter(32)}${LAST_ROW}"
        for k in range(1, 4):
            row = DRAW_FIRST + k - 1
            ws.row_dimensions[row].height = 14
            idx_f = (f'AGGREGATE(15,6,(ROW({_kin_date_rng})-{FIRST_DATA_ROW}+1)/'
                     f'(({_kin_proj_rng}="{PROJ_LAZ}")*({_kin_cat_rng}="{CAT_LOAN}")*'
                     f'ISNUMBER(SEARCH("{match_text}",{_kin_notes_rng}))),{k})')
            dc = ws.cell(row=row, column=2, value=f'=IFERROR(INDEX({_kin_date_rng},{idx_f}),"—")')
            dc.number_format = "DD/MM/YYYY"; dc.font = Fnt(size=8, color="FF6B7280"); dc.fill = F(WHITE); dc.alignment = Aln(h="right")
            ac = ws.cell(row=row, column=3, value=f'=IFERROR(INDEX({_kin_amt_rng},{idx_f}),"")')
            ac.number_format = EUR0; ac.font = Fnt(size=8, color="FF6B7280"); ac.fill = F(WHITE); ac.alignment = Aln(h="right")
            ws.row_dimensions[row].outline_level = 1
        DRAW_LAST = DRAW_FIRST + 2
        _loan_next = DRAW_LAST + 2

    # ── combined DSCR — Q003's annual NOI (Μισθώματα & Αποδόσεις) over BOTH
    # loans' combined annual debt service. Reads Rent Roll's Year 1..20
    # rows directly by position (both sheets share the same fixed 20/25-
    # year layout starting at "year 1 of operation"), which is an
    # approximation — the loans start amortizing from the 2027 draw while
    # rent roll year 1 is the lease's own start year; close enough for a
    # DSCR sanity check, not a substitute for a real integrated model. ──
    DSCR_HDR = _loan_next
    ws.row_dimensions[DSCR_HDR].height = 24
    ws.merge_cells(start_row=DSCR_HDR, start_column=1, end_row=DSCR_HDR, end_column=7)
    dh = ws.cell(row=DSCR_HDR, column=1, value="  " + t("DSCR  —  ΣΥΝΔΥΑΣΜΕΝΟ (Δάνειο Α + Β έναντι NOI Q003)", "DSCR  —  COMBINED (Loan A + B vs Q003 NOI)"))
    dh.fill = F("FFFEF0D8"); dh.font = Fnt(size=10, bold=True, color="FF965800"); dh.alignment = Aln(h="left", v="center")
    dscr_headers = [t("Έτος", "Year"), t("NOI (Q003)", "NOI (Q003)"), t("Δόση Α", "Loan A Payment"),
                    t("Δόση Β", "Loan B Payment"), t("Σύνολο Δόσης", "Total Debt Service"), "DSCR",
                    t("Ημερολ. Έτος", "Cal. Year")]
    DSCR_COLHDR = DSCR_HDR + 1
    for ci, h in enumerate(dscr_headers, 1):
        col_hdr(ws, DSCR_COLHDR, ci, h)
    (A_FIRST, A_LAST), (B_FIRST, B_LAST) = loan_ds_rows
    # the real first draw date across all 6 tranches — not a hardcoded
    # "2027" baked into every year's calendar-year formula below. If the
    # project timeline ever shifts, this (and everything keyed off it)
    # moves with it instead of silently staying anchored to today's dates.
    fdc = ws.cell(row=DSCR_HDR, column=9,
        value=(f'=YEAR(_xlfn.MINIFS(Table_Kin[{H_DATE}],Table_Kin[{H_PROJECT}],"{PROJ_LAZ}",'
               f'Table_Kin[{H_CATEGORY}],"{CAT_LOAN}"))'))
    fdc.font = Fnt(size=1, color=WHITE)
    DSCR_FIRST = DSCR_COLHDR + 1
    for yi in range(LOAN_YEARS):
        row = DSCR_FIRST + yi
        yr = yi + 1
        ws.row_dimensions[row].height = 16
        yc = ws.cell(row=row, column=1, value=yr); yc.alignment = Aln(h="center"); yc.font = Fnt(size=9); yc.fill = F(WHITE)
        # direct row reference into Μισθώματα & Αποδόσεις' Q003 block (built
        # just before this sheet, same fixed year-1..20 layout) — not an
        # INDEX/MATCH over a whole column, which would risk matching Q004's
        # identically-numbered year rows further down the same sheet.
        noi_ref = ws.cell(row=row, column=2,
            value=f"='13. Μισθώματα & Αποδόσεις'!{RENT_Q003_NOI_COL}{RENT_Q003_YEAR_FIRST + yi}")
        noi_ref.number_format = EUR0; noi_ref.alignment = Aln(h="right"); noi_ref.font = Fnt(size=9, color=GREEN_FG); noi_ref.fill = F(WHITE)
        dsA = ws.cell(row=row, column=3, value=f"=F{A_FIRST + yi}")
        dsA.number_format = EUR0; dsA.alignment = Aln(h="right"); dsA.font = Fnt(size=9); dsA.fill = F(WHITE)
        dsB = ws.cell(row=row, column=4, value=f"=F{B_FIRST + yi}")
        dsB.number_format = EUR0; dsB.alignment = Aln(h="right"); dsB.font = Fnt(size=9); dsB.fill = F(WHITE)
        dsTotal = ws.cell(row=row, column=5, value=f"=C{row}+D{row}")
        dsTotal.number_format = EUR0; dsTotal.alignment = Aln(h="right"); dsTotal.font = Fnt(size=9, bold=True, color=RED_FG); dsTotal.fill = F(WHITE)
        # E{row}<1 (not just <>0) — a fully-repaid loan's Closing Balance
        # lands near-but-not-exactly 0 (float rounding, e.g. 1e-13), which
        # made the total-payment denominator a near-zero number instead of
        # a true zero and blew DSCR up to the trillions instead of hitting
        # IFERROR's divide-by-zero catch.
        dscr = ws.cell(row=row, column=6, value=f'=IF(E{row}<1,"—",ROUND(B{row}/E{row},2))')
        dscr.number_format = "0,00"; dscr.alignment = Aln(h="right"); dscr.font = Fnt(size=9, bold=True); dscr.fill = F(WHITE)
        # loan Year 1 = the real 2027 draw — lets Ταμείο match this table's
        # debt service to an actual calendar year instead of a blind index.
        calyr = ws.cell(row=row, column=7, value=f"=$I${DSCR_HDR}+A{row}-1")
        calyr.alignment = Aln(h="center"); calyr.font = Fnt(size=9, color="FF6B7280"); calyr.fill = F(WHITE)
        ws.conditional_formatting.add(f"F{row}",
            CellIsRule(operator="lessThan", formula=["1.2"],
                       fill=PatternFill(start_color=RED_BG, end_color=RED_BG, fill_type="solid"),
                       font=Font(name="Calibri", size=9, bold=True, color=RED_FG)))
        ws.conditional_formatting.add(f"F{row}",
            CellIsRule(operator="greaterThanOrEqual", formula=["1.2"],
                       fill=PatternFill(start_color=GREEN_BG, end_color=GREEN_BG, fill_type="solid"),
                       font=Font(name="Calibri", size=9, bold=True, color="0B6640")))
    DSCR_LAST = DSCR_FIRST + LOAN_YEARS - 1
    for r in range(DSCR_FIRST + 8, DSCR_LAST + 1):
        ws.row_dimensions[r].outline_level = 1
        ws.row_dimensions[r].hidden = True
    wb.defined_names["LoanDebtServiceYears"] = DefinedName(
        "LoanDebtServiceYears", attr_text=f"'14. Δάνεια'!$G${DSCR_FIRST}:$G${DSCR_LAST}")
    wb.defined_names["LoanDebtServiceAmounts"] = DefinedName(
        "LoanDebtServiceAmounts", attr_text=f"'14. Δάνεια'!$E${DSCR_FIRST}:$E${DSCR_LAST}")
    wb.defined_names["Q003DSCRYear1"] = DefinedName("Q003DSCRYear1", attr_text=f"'14. Δάνεια'!$F${DSCR_FIRST}")

    LOAN_TIP = DSCR_LAST + 2
    ws.merge_cells(start_row=LOAN_TIP, start_column=1, end_row=LOAN_TIP, end_column=7)
    ltip = ws.cell(row=LOAN_TIP, column=1,
        value="  " + t("Ετήσια (όχι μηνιαία) απόσβεση — και οι 3 πραγματικές τραγχές πέφτουν στο ίδιο ημερολογιακό έτος (2027), οπότε ένα μηνιαίο πλάνο δεν πρόσθετε πραγματική ακρίβεια· δείτε όμως τις «Πραγματικές Τράγχες (Έτος 1)» κάτω από κάθε πίνακα για τις πραγματικές ημερομηνίες εκταμίευσης. Περίοδος Χάριτος και Διάρκεια Αποπληρωμής από το Ρυθμίσεις (Ισόποσο χρεολύσιο μετά τη χάρη). DSCR ≥ 1,20 = πράσινο (τυπικό τραπεζικό όριο), κάτω από αυτό = κόκκινο. Το NOI εδώ ΔΕΝ αφαιρεί τη δόση δανείου.",
                      "Annual (not monthly) amortization — all 3 real tranches land in the same calendar year (2027), so a monthly plan wouldn't add real precision; see “Real Draws (Year 1)” below each table for the actual disbursement dates. Grace Period and Repayment Term come from Ρυθμίσεις (straight-line principal after grace). DSCR ≥ 1.20 = green (typical bank threshold), below = red. NOI here does NOT subtract the loan payment."))
    ltip.font = Fnt(size=9, italic=True, color="FF6B7280")
    ltip.fill = F("FFF6F8FA"); ltip.alignment = Aln(h="left", wrap=True)
    ws.row_dimensions[LOAN_TIP].height = 40

    # ── ΣΥΝΟΨΗ ΔΑΝΕΙΑΚΗΣ ΘΕΣΗΣ — Κέντρο Ελέγχου's new Section 7 wants an
    # Εγκεκριμένα/Εκταμιευθέντα/Σε αίτηση rollup. This sheet only ever
    # modeled ONE already-contracted loan (Δάνειο Α+Β, Q003) — there is no
    # loan "in application" anywhere in Table_Kin or on this sheet, so
    # "Σε αίτηση" (in application) has no real data to report; the honest
    # 3rd figure this data actually supports is what's approved-but-not-
    # yet-drawn, labeled accordingly. Judgment call — flagged in the
    # session report. ──
    SUMMARY_HDR = LOAN_TIP + 2
    ws.row_dimensions[SUMMARY_HDR].height = 24
    ws.merge_cells(start_row=SUMMARY_HDR, start_column=1, end_row=SUMMARY_HDR, end_column=7)
    smh = ws.cell(row=SUMMARY_HDR, column=1, value="  " + t("ΣΥΝΟΨΗ ΔΑΝΕΙΑΚΗΣ ΘΕΣΗΣ", "LOAN POSITION SUMMARY"))
    smh.fill = F("FFFEF0D8"); smh.font = Fnt(size=10, bold=True, color="FF965800"); smh.alignment = Aln(h="left", v="center")
    LOAN_APPROVED_ROW = SUMMARY_HDR + 1
    LOAN_DISBURSED_ROW = SUMMARY_HDR + 2
    LOAN_PENDING_ROW = SUMMARY_HDR + 3
    ws.row_dimensions[LOAN_APPROVED_ROW].height = 18
    lbl(ws, LOAN_APPROVED_ROW, 1, t("Εγκεκριμένα (σύνολο κεφαλαίου Α+Β)", "Approved (Loan A+B principal)"), bg=WHITE)
    apc = ws.cell(row=LOAN_APPROVED_ROW, column=2, value=f"=B{loan_prin_rows[0]}+B{loan_prin_rows[1]}")
    apc.number_format = EUR0; apc.fill = F(WHITE); apc.font = Fnt(size=10, bold=True, color=DARK_BLUE); apc.alignment = Aln(h="right")
    ws.row_dimensions[LOAN_DISBURSED_ROW].height = 18
    lbl(ws, LOAN_DISBURSED_ROW, 1, t("Εκταμιευθέντα (πραγματικές τράγχες, πληρωμένες)", "Disbursed (real tranches, paid)"), bg=WHITE)
    disc = ws.cell(row=LOAN_DISBURSED_ROW, column=2,
        value=(f'=SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_PROJECT}],"{PROJ_LAZ}",'
               f'Table_Kin[{H_CATEGORY}],"{CAT_LOAN}",Table_Kin[{H_STATUS}],"{S_PAID}")'))
    disc.number_format = EUR0; disc.fill = F(WHITE); disc.font = Fnt(size=10, bold=True, color=GREEN_FG); disc.alignment = Aln(h="right")
    ws.row_dimensions[LOAN_PENDING_ROW].height = 18
    lbl(ws, LOAN_PENDING_ROW, 1, t("Εκκρεμεί προς Εκταμίευση (εγκεκριμένο μείον εκταμιευθέν)", "Pending Disbursement (approved minus disbursed)"), bg=WHITE)
    penc = ws.cell(row=LOAN_PENDING_ROW, column=2, value=f"=MAX(0,B{LOAN_APPROVED_ROW}-B{LOAN_DISBURSED_ROW})")
    penc.number_format = EUR0; penc.fill = F(WHITE); penc.font = Fnt(size=10, bold=True, color="FF965800"); penc.alignment = Aln(h="right")
    wb.defined_names["LoanApprovedTotal"] = DefinedName("LoanApprovedTotal", attr_text=f"'14. Δάνεια'!$B${LOAN_APPROVED_ROW}")
    wb.defined_names["LoanDisbursedTotal"] = DefinedName("LoanDisbursedTotal", attr_text=f"'14. Δάνεια'!$B${LOAN_DISBURSED_ROW}")
    wb.defined_names["LoanPendingDisbursement"] = DefinedName("LoanPendingDisbursement", attr_text=f"'14. Δάνεια'!$B${LOAN_PENDING_ROW}")

    # ══════════════════════════════════════════════════════════════════════════
    # TAB: ΠΡΟΟΔΟΣ ΕΡΓΟΥ  (cost-to-complete + S-curve — Q003 only: it's the
    # one project on Προϋπολογισμοί with BOTH an Έναρξη εργασιών and a Λήξη
    # κατασκευής date on the ΧΡΟΝΟΔΙΑΓΡΑΜΜΑ; Q004 only has a completion
    # date, no start, so a curve for it would need a fabricated start.) ──
    # ══════════════════════════════════════════════════════════════════════════
    ws = ws_scurve
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 12
    for letter in "BCDEFGH":
        ws.column_dimensions[letter].width = 17
    ws.freeze_panes = "A3"

    ws.row_dimensions[1].height = 34
    ws.merge_cells("A1:H1")
    c = ws.cell(row=1, column=1, value="  " + t("ΠΡΟΟΔΟΣ ΕΡΓΟΥ  —  COST-TO-COMPLETE & S-CURVE (Q003)", "PROJECT PROGRESS  —  COST-TO-COMPLETE & S-CURVE (Q003)"))
    c.fill = F(DARK_BLUE); c.font = Fnt(size=14, bold=True, color=WHITE)
    c.alignment = Aln(h="left", v="center")
    sheet_intro(ws, 2,
        t("Πόσο έχει προχωρήσει η κατασκευή του Q003 σε σχέση με το πόσο έχει ξοδευτεί — το κόστος-για-"
          "ολοκλήρωση δείχνει τι απομένει, η S-curve αν είστε μπροστά ή πίσω από το πλάνο.",
          "How far Q003's construction has progressed against how much has been spent — cost-to-complete "
          "shows what's left, the S-curve whether you're ahead of or behind plan."),
        end_col="H")

    SC_START, SC_END, SC_BUD = 3, 4, 5
    ws.row_dimensions[SC_START].height = 18
    lbl(ws, SC_START, 1, t("Έναρξη Εργασιών", "Works Start"), bg=WHITE)
    sc_sd = ws.cell(row=SC_START, column=2, value=f"='4. Προϋπολογισμοί'!D{TL_HDR + 1}")
    sc_sd.number_format = "DD/MM/YYYY"; sc_sd.fill = F(WHITE); sc_sd.font = Fnt(size=10, bold=True, color=DARK_BLUE); sc_sd.alignment = Aln(h="right")
    ws.row_dimensions[SC_END].height = 18
    lbl(ws, SC_END, 1, t("Λήξη Κατασκευής", "Construction End"), bg=WHITE)
    sc_ed = ws.cell(row=SC_END, column=2, value=f"='4. Προϋπολογισμοί'!D{TL_HDR + 2}")
    sc_ed.number_format = "DD/MM/YYYY"; sc_ed.fill = F(WHITE); sc_ed.font = Fnt(size=10, bold=True, color=DARK_BLUE); sc_ed.alignment = Aln(h="right")
    ws.row_dimensions[SC_BUD].height = 18
    lbl(ws, SC_BUD, 1, t("Σεναριακός Προϋπολογισμός", "Scenario Budget"), bg=WHITE)
    sc_bud = ws.cell(row=SC_BUD, column=2, value=f"='4. Προϋπολογισμοί'!D{SCENARIO_BUDGET_ROW}")
    sc_bud.number_format = EUR0; sc_bud.fill = F(WHITE); sc_bud.font = Fnt(size=10, bold=True, color=DARK_BLUE); sc_bud.alignment = Aln(h="right")
    TOTAL_MONTHS_CELL = ws.cell(row=SC_BUD, column=4, value=f"=MAX(1,DATEDIF(B{SC_START},B{SC_END},\"m\")+1)")
    TOTAL_MONTHS_CELL.number_format = "0"; TOTAL_MONTHS_CELL.fill = F(WHITE); TOTAL_MONTHS_CELL.font = Fnt(size=9, italic=True, color="FF6B7280")
    lblc = ws.cell(row=SC_BUD, column=3, value=t("Διάρκεια (μήνες):", "Duration (months):"))
    lblc.font = Fnt(size=9, italic=True, color="FF6B7280"); lblc.fill = F(WHITE); lblc.alignment = Aln(h="right")

    SC_TBL_HDR = SC_BUD + 2
    sc_headers = [t("Μήνας", "Month"), t("Ημερομηνία", "Date"), t("Προγρ. % Ολοκλήρωσης", "Planned % Complete"),
                  t("Προγρ. Σωρευτικό Κόστος", "Planned Cumulative Cost"), t("Πραγμ. Σωρευτικό Κόστος", "Actual Cumulative Cost"),
                  t("Απόκλιση", "Variance"), t("Πραγμ. % Ολοκλήρωσης", "Actual % Complete"),
                  t("Προγρ. Εκροή Μήνα (μη καταχωρ.)", "Planned Outflow This Month (unbooked)")]
    for ci, h in enumerate(sc_headers, 1):
        col_hdr(ws, SC_TBL_HDR, ci, h)
    SC_MONTHS = 36
    SC_FIRST = SC_TBL_HDR + 1
    for mi in range(SC_MONTHS):
        row = SC_FIRST + mi
        ws.row_dimensions[row].height = 16
        mnum = ws.cell(row=row, column=1, value=mi + 1); mnum.alignment = Aln(h="center"); mnum.font = Fnt(size=9); mnum.fill = F(WHITE)
        mdate = ws.cell(row=row, column=2, value=f"=EDATE($B${SC_START},{mi})")
        mdate.number_format = "MMM YYYY"; mdate.alignment = Aln(h="center"); mdate.font = Fnt(size=9, color="FF6B7280"); mdate.fill = F(WHITE)
        # smoothstep S-curve (3t²-2t³, t=fraction of the planned duration
        # elapsed) — the standard shape for planned construction spend:
        # slow start, fast middle, slow finish. Clipped to 100% once past
        # the planned end date.
        t_frac = f"MIN(1,{mi+1}/$D${SC_BUD})"
        pct_f = ws.cell(row=row, column=3, value=f"=3*({t_frac})^2-2*({t_frac})^3")
        pct_f.number_format = "0%"; pct_f.alignment = Aln(h="right"); pct_f.font = Fnt(size=9); pct_f.fill = F(WHITE)
        planned_cum = ws.cell(row=row, column=4, value=f"=C{row}*$B${SC_BUD}")
        planned_cum.number_format = EUR0; planned_cum.alignment = Aln(h="right"); planned_cum.font = Fnt(size=9, color="FF6B7280"); planned_cum.fill = F(WHITE)
        actual_cum = ws.cell(row=row, column=5,
            value=(f'=SUMIFS(Table_Kin[{H_PAIDTOTAL}],Table_Kin[{H_PROJECT}],"{PROJ_LAZ}",Table_Kin[{H_TYPE}],"{TYPE_EXP}",'
                   f'Table_Kin[{H_DATE}],"<="&B{row})'))
        actual_cum.number_format = EUR0; actual_cum.alignment = Aln(h="right"); actual_cum.font = Fnt(size=9, bold=True, color=DARK_BLUE); actual_cum.fill = F(WHITE)
        var_f = ws.cell(row=row, column=6, value=f"=E{row}-D{row}")
        var_f.number_format = EUR0_NEG; var_f.alignment = Aln(h="right"); var_f.font = Fnt(size=9); var_f.fill = F(WHITE)
        pct_actual = ws.cell(row=row, column=7, value=f'=IFERROR(E{row}/$B${SC_BUD},0)')
        pct_actual.number_format = "0%"; pct_actual.alignment = Aln(h="right"); pct_actual.font = Fnt(size=9, bold=True, color=DARK_BLUE); pct_actual.fill = F(WHITE)
        # this month's planned spend that ISN'T covered by an actual
        # Κινήσεις entry yet — the exact figure Ταμείο is missing today.
        # €0 the moment real invoices catch up to the plan for that month;
        # never negative (MAX(0,...)) — running ahead of plan isn't a
        # "negative" future outflow.
        prev_planned = "0" if mi == 0 else f"D{row-1}"
        prev_actual = "0" if mi == 0 else f"E{row-1}"
        unbooked = ws.cell(row=row, column=8, value=f"=MAX(0,(D{row}-{prev_planned})-(E{row}-{prev_actual}))")
        unbooked.number_format = EUR0; unbooked.alignment = Aln(h="right"); unbooked.font = Fnt(size=9, bold=True, color="FF965800"); unbooked.fill = F(WHITE)
    SC_LAST = SC_FIRST + SC_MONTHS - 1
    wb.defined_names["Q003PlannedOutflowDates"] = DefinedName(
        "Q003PlannedOutflowDates", attr_text=f"'15. Πρόοδος Έργου'!$B${SC_FIRST}:$B${SC_LAST}")
    wb.defined_names["Q003PlannedOutflowAmounts"] = DefinedName(
        "Q003PlannedOutflowAmounts", attr_text=f"'15. Πρόοδος Έργου'!$H${SC_FIRST}:$H${SC_LAST}")
    for r in range(SC_FIRST + 15, SC_LAST + 1):
        ws.row_dimensions[r].outline_level = 1
        ws.row_dimensions[r].hidden = True
    ws.conditional_formatting.add(f"F{SC_FIRST}:F{SC_LAST}",
        CellIsRule(operator="greaterThan", formula=["0"],
                   fill=PatternFill(start_color=RED_BG, end_color=RED_BG, fill_type="solid"),
                   font=Font(name="Calibri", size=9, bold=True, color=RED_FG)))

    # ── metrics: cost-to-complete + estimated completion from current burn
    # rate (average monthly ACTUAL spend over the months elapsed so far,
    # projected forward against the remaining budget). ──
    MET_HDR = SC_LAST + 2
    ws.row_dimensions[MET_HDR].height = 22
    ws.merge_cells(start_row=MET_HDR, start_column=1, end_row=MET_HDR, end_column=8)
    mh2 = ws.cell(row=MET_HDR, column=1, value="  " + t("ΔΕΙΚΤΕΣ", "METRICS"))
    mh2.fill = F("FFFEF0D8"); mh2.font = Fnt(size=10, bold=True, color="FF965800"); mh2.alignment = Aln(h="left", v="center")
    # YEAR/MONTH arithmetic, not DATEDIF — DATEDIF raises #NUM! whenever its
    # end date is earlier than its start date, which happens here any time
    # today is still before Έναρξη Εργασιών (a project that hasn't started
    # yet). MAX(1,...) then floors the result at month 1 either way.
    months_elapsed_f = 'MAX(1,MIN((YEAR(TODAY())-YEAR($B$3))*12+(MONTH(TODAY())-MONTH($B$3))+1,36))'
    mrow(ws, MET_HDR + 1, t("Μήνες από Έναρξη", "Months Since Start"), f"={months_elapsed_f}", "",
         value_bold=True, value_color="FF965800", col0=1)
    actual_to_date_f = f'INDEX($E${SC_FIRST}:$E${SC_LAST},{months_elapsed_f})'
    mrow(ws, MET_HDR + 2, t("Πραγματικό Κόστος Μέχρι Σήμερα", "Actual Cost to Date"), f"={actual_to_date_f}", "",
         value_fmt=EUR0, value_bold=True, value_color=DARK_BLUE, col0=1)
    mrow(ws, MET_HDR + 3, t("Κόστος για Ολοκλήρωση", "Cost to Complete"),
         f"=MAX(0,$B${SC_BUD}-({actual_to_date_f}))", "",
         value_fmt=EUR0, value_bold=True, value_color=RED_FG, col0=1)
    burn_rate_f = f'({actual_to_date_f})/({months_elapsed_f})'
    est_months_f = f'IFERROR(MAX(0,$B${SC_BUD}-({actual_to_date_f}))/({burn_rate_f}),"—")'
    mrow(ws, MET_HDR + 4, t("Εκτ. Μήνες μέχρι Ολοκλήρωση (με τον τρέχοντα ρυθμό)", "Est. Months to Completion (at current burn rate)"),
         f"={est_months_f}", "", value_bold=True, value_color="FF965800", col0=1)
    for ci in range(5, 8):
        for r in range(MET_HDR + 1, MET_HDR + 5):
            ws.cell(row=r, column=ci).fill = F(WHITE)

    SC_TIP = MET_HDR + 6
    ws.merge_cells(start_row=SC_TIP, start_column=1, end_row=SC_TIP, end_column=8)
    sctip = ws.cell(row=SC_TIP, column=1,
        value="  " + t("Προγρ. καμπύλη: σχήμα smoothstep (αργή αρχή/τέλος, γρήγορη μέση) πάνω στη Διάρκεια σε μήνες. Πραγματικό κόστος: σωρευτικά Πληρωμένα από τις Κινήσεις μέχρι κάθε ημερομηνία. Ο ρυθμός καύσης για την εκτίμηση ολοκλήρωσης είναι απλός μέσος όρος (Πραγματικό/Μήνες), όχι πρόβλεψη με στάθμιση πρόσφατων μηνών. Γραμμές μηνών 16-36 συμπτυγμένες από προεπιλογή.",
                      "Planned curve: smoothstep shape (slow start/end, fast middle) over Duration in months. Actual cost: cumulative Paid from Κινήσεις up to each date. The burn rate for the completion estimate is a simple average (Actual/Months), not a recent-months-weighted forecast. Month 16-36 rows are collapsed by default."))
    sctip.font = Fnt(size=9, italic=True, color="FF6B7280")
    sctip.fill = F("FFF6F8FA"); sctip.alignment = Aln(h="left", wrap=True)
    ws.row_dimensions[SC_TIP].height = 44

    # ══════════════════════════════════════════════════════════════════════════
    # TAB: ΣΥΜΦΩΝΙΑ ΤΡΑΠΕΖΩΝ  (paste a bank statement extrait, auto-match
    # against Κινήσεις — the direct antidote to the "30 unallocated
    # transactions" problem the Πηγή data-quality check flags.) ──
    # ══════════════════════════════════════════════════════════════════════════
    ws = ws_bankrec
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 13
    ws.column_dimensions["B"].width = 34
    ws.column_dimensions["C"].width = 13
    ws.column_dimensions["D"].width = 10
    ws.column_dimensions["E"].width = 34
    ws.column_dimensions["F"].width = 13
    ws.column_dimensions["G"].width = 16
    ws.column_dimensions["H"].width = 8
    ws.freeze_panes = "A6"

    ws.row_dimensions[1].height = 34
    ws.merge_cells("A1:G1")
    c = ws.cell(row=1, column=1, value="  " + t("ΣΥΜΦΩΝΙΑ ΤΡΑΠΕΖΩΝ", "BANK RECONCILIATION"))
    c.fill = F(DARK_BLUE); c.font = Fnt(size=14, bold=True, color=WHITE)
    c.alignment = Aln(h="left", v="center")
    sheet_intro(ws, 2,
        t("Αντιστοιχίστε το extrait της τράπεζας με τις Κινήσεις για να πιάσετε ό,τι λείπει ή δεν ταιριάζει "
          "— δεν αλλάζει τίποτα αλλού, είναι καθαρά έλεγχος.",
          "Match the bank statement against Κινήσεις to catch anything missing or mismatched — it changes "
          "nothing elsewhere, it's purely a check."),
        end_col="G")

    ws.row_dimensions[3].height = 20
    lbl(ws, 3, 1, t("Λογαριασμός", "Account"), bg=LIGHT_GREY)
    brc = ws.cell(row=3, column=2, value=SRC_OPT_CORP)
    brc.fill = F(YELLOW); brc.alignment = Aln(h="left")
    dv_br = DataValidation(type="list", formula1="LIST_SOURCE", allow_blank=True, showDropDown=False)
    ws.add_data_validation(dv_br); dv_br.sqref = "B3"
    ws.merge_cells("C3:G3")
    brtip = ws.cell(row=3, column=3,
        value="  " + t("Επιλέξτε τον λογαριασμό που αντιστοιχεί στο extrait που θα επικολλήσετε παρακάτω.", "Pick the account matching the extrait you're about to paste below."))
    brtip.font = Fnt(size=9, italic=True, color="FF6B7280"); brtip.fill = F(WHITE); brtip.alignment = Aln(h="left")

    BR_SUMMARY = 4
    ws.row_dimensions[BR_SUMMARY].height = 24

    BR_HDR = 6
    bank_headers = [t("Ημερομηνία", "Date"), t("Περιγραφή (extrait)", "Description (extrait)"), t("Ποσό", "Amount"),
                    t("Αντιστοίχιση", "Match"), t("Προτεινόμενη Κίνηση", "Suggested Κινήσεις Row"),
                    t("Απόκλιση Ημερών", "Days Off"), t("Ενέργεια", "Action")]
    for ci, h in enumerate(bank_headers, 1):
        col_hdr(ws, BR_HDR, ci, h)

    BR_FIRST = BR_HDR + 1
    BR_ROWS = 200
    for i in range(BR_ROWS):
        row = BR_FIRST + i
        ws.row_dimensions[row].height = 16
        dc = ws.cell(row=row, column=1); dc.fill = F(YELLOW); dc.alignment = Aln(h="center"); dc.protection = UNLOCKED
        dc.number_format = "DD/MM/YYYY"
        desc = ws.cell(row=row, column=2); desc.fill = F(YELLOW); desc.alignment = Aln(h="left"); desc.protection = UNLOCKED
        amt = ws.cell(row=row, column=3); amt.fill = F(YELLOW); amt.alignment = Aln(h="right"); amt.protection = UNLOCKED
        amt.number_format = EUR
        # candidate: a Table_Kin row of the SAME sign (income if amount>0,
        # expense if <0), within €0.01 of this pasted amount, Πληρωμένο,
        # dated within 10 days of the extrait line, belonging to EITHER the
        # account picked in $B$3 OR still unattributed (Πηγή=TBD/blank —
        # the actual point of reconciling), AND not already claimed by an
        # EARLIER extrait row this pass (via the hidden $H column storing
        # each row's own matched Μοναδικό ID, checked with COUNTIF against
        # every row above this one) — two extrait lines of the same amount
        # used to both silently point at the one Κινήσεις row. Matches on
        # the row's real ID first, then derives description/date from that
        # SAME id, instead of re-running the whole search twice and risking
        # the two independent matches disagreeing. INDEX(...,0) around the
        # boolean-product expression forces it to evaluate as an array
        # without Ctrl+Shift+Enter — the same technique used for the
        # cash-runway MATCH on Κέντρο Ελέγχου; a bare MATCH(1,expr,0) over a
        # whole-column comparison does NOT implicitly array-evaluate here.
        # Πηγή must equal the account actually selected in $B$3 — matching
        # TBD/blank-Πηγή rows here too (the old behaviour) meant a
        # transaction not yet assigned to ANY account would show as a
        # "found" match no matter which account you were reconciling, even
        # when it really belongs to a different one entirely. TBD rows are
        # already surfaced separately by the "Κινήσεις Χωρίς Πηγή" Quality
        # Check — Bank Reconciliation's job is to confirm what's already
        # been assigned, not to guess an assignment for what hasn't.
        already_used = "0" if i == 0 else f'COUNTIF($H${BR_FIRST}:H{row-1},Table_Kin[{H_TXID}])'
        _match_cond = (f'INDEX((Table_Kin[{H_STATUS}]="{S_PAID}")*'
                       f'(ROUND(ABS(Table_Kin[{H_AMOUNT}]),2)=ROUND(ABS($C{row}),2))*'
                       f'((Table_Kin[{H_TYPE}]="{TYPE_INC}")=($C{row}>0))*'
                       f'(Table_Kin[{H_SOURCE}]=$B$3)*'
                       f'(ABS(Table_Kin[{H_DATE}]-$A{row})<=10)*'
                       f'({already_used}=0),0)')
        match_id = f'IFERROR(INDEX(Table_Kin[{H_TXID}],MATCH(1,{_match_cond},0)),"")'
        hid = ws.cell(row=row, column=8, value=f'=IF($C{row}="","",{match_id})')
        hid.fill = F(LIGHT_GREY); hid.font = Fnt(size=1, color=WHITE)
        match_key = f'IFERROR(INDEX(Table_Kin[{H_DESC}],MATCH($H{row},Table_Kin[{H_TXID}],0)),"")'
        sugg = ws.cell(row=row, column=5, value=f'=IF($H{row}="","",{match_key})')
        sugg.fill = F(LIGHT_GREY); sugg.alignment = Aln(h="left"); sugg.font = Fnt(size=9)
        match_date = f'IFERROR(INDEX(Table_Kin[{H_DATE}],MATCH($H{row},Table_Kin[{H_TXID}],0)),"")'
        daysoff = ws.cell(row=row, column=6, value=f'=IF(OR($A{row}="",$H{row}=""),"",ABS($A{row}-({match_date})))')
        daysoff.fill = F(LIGHT_GREY); daysoff.alignment = Aln(h="center"); daysoff.font = Fnt(size=9)
        status = ws.cell(row=row, column=4,
            value=f'=IF($C{row}="","",IF($E{row}<>"","{t("✓ Βρέθηκε","✓ Found")}","{t("Χωρίς αντιστοίχιση","No match")}"))')
        status.fill = F(WHITE); status.alignment = Aln(h="center"); status.font = Fnt(size=9, bold=True)
        action = ws.cell(row=row, column=7,
            value=f'=IF(AND($C{row}<>"",$E{row}=""),"{t("Καταχωρήστε χειροκίνητα στις Κινήσεις","Enter manually in Κινήσεις")}","")')
        action.fill = F(WHITE); action.alignment = Aln(h="left", wrap=True); action.font = Fnt(size=8, italic=True, color="FF6B7280")
        ws.conditional_formatting.add(f"D{row}",
            FormulaRule(formula=[f'$D{row}="{t("Χωρίς αντιστοίχιση","No match")}"'],
                        fill=PatternFill(start_color=RED_BG, end_color=RED_BG, fill_type="solid"),
                        font=Font(name="Calibri", size=9, bold=True, color=RED_FG)))
        ws.conditional_formatting.add(f"D{row}",
            FormulaRule(formula=[f'$D{row}="{t("✓ Βρέθηκε","✓ Found")}"'],
                        fill=PatternFill(start_color=GREEN_BG, end_color=GREEN_BG, fill_type="solid"),
                        font=Font(name="Calibri", size=9, bold=True, color="0B6640")))
    BR_LAST = BR_FIRST + BR_ROWS - 1
    for r in range(BR_FIRST + 30, BR_LAST + 1):
        ws.row_dimensions[r].outline_level = 1
        ws.row_dimensions[r].hidden = True

    # summary — pasted-lines matched/unmatched, same-sheet cells only (a
    # conditional-formatting formula referencing Table_Kin from another
    # sheet was proven to silently corrupt the file on open — see Έλεγχοι
    # Ποιότητας — so this is a plain cell formula, no CF involved here).
    lbl(ws, BR_SUMMARY, 1, t("Γραμμές Extrait", "Extrait Rows"), bg=LIGHT_BLUE)
    pasted_n = ws.cell(row=BR_SUMMARY, column=2, value=f'=COUNTIF(C{BR_FIRST}:C{BR_LAST},"<>")')
    pasted_n.fill = F(LIGHT_BLUE); pasted_n.font = Fnt(size=11, bold=True, color=DARK_BLUE); pasted_n.alignment = Aln(h="right")
    lbl(ws, BR_SUMMARY, 3, t("Βρέθηκαν", "Found"), bg=LIGHT_BLUE)
    # "?*" (at least one character), not "<>" — E holds a FORMULA that
    # returns "" when there's no match; COUNTIF's "<>" criteria counts
    # those empty-STRING results too (a formula cell isn't a blank cell,
    # even when it displays nothing), so this showed "Found 200" with zero
    # real matches on an entirely empty sheet.
    found_n = ws.cell(row=BR_SUMMARY, column=4, value=f'=COUNTIF(E{BR_FIRST}:E{BR_LAST},"?*")')
    found_n.fill = F(LIGHT_BLUE); found_n.font = Fnt(size=11, bold=True, color=GREEN_FG); found_n.alignment = Aln(h="right")
    lbl(ws, BR_SUMMARY, 5, t("Χωρίς Αντιστοίχιση", "Unmatched"), bg=LIGHT_BLUE)
    unmatched_n = ws.cell(row=BR_SUMMARY, column=6,
        value=f'=COUNTIFS(C{BR_FIRST}:C{BR_LAST},"<>",E{BR_FIRST}:E{BR_LAST},"")')
    unmatched_n.fill = F(LIGHT_BLUE); unmatched_n.font = Fnt(size=11, bold=True, color=RED_FG); unmatched_n.alignment = Aln(h="right")
    ws.cell(row=BR_SUMMARY, column=7).fill = F(LIGHT_BLUE)

    BR_TIP = BR_LAST + 2
    ws.merge_cells(start_row=BR_TIP, start_column=1, end_row=BR_TIP, end_column=7)
    brtip2 = ws.cell(row=BR_TIP, column=1,
        value="  " + t("Επικολλήστε Ημερομηνία/Περιγραφή/Ποσό από το extrait της τράπεζας (θετικό = κατάθεση, αρνητικό = ανάληψη). Η «Προτεινόμενη Κίνηση» ψάχνει στις Κινήσεις για μια πληρωμένη γραμμή ίδιου ποσού χωρίς πραγματική Πηγή — αν βρεθεί, πηγαίνετε στις Κινήσεις και βάλτε την πραγματική Πηγή σε εκείνη τη γραμμή· αν όχι, η κίνηση πιθανόν λείπει εντελώς και πρέπει να καταχωρηθεί. 200 γραμμές, οι πρώτες 30 ορατές.",
                      "Paste Date/Description/Amount from the bank extrait (positive = deposit, negative = withdrawal). “Suggested Κινήσεις Row” searches Κινήσεις for a paid row of the same amount with no real Source — if found, go set the real Source on that Κινήσεις row; if not, the transaction is probably missing entirely and needs entering. 200 rows, first 30 visible."))
    brtip2.font = Fnt(size=9, italic=True, color="FF6B7280")
    brtip2.fill = F("FFF6F8FA"); brtip2.alignment = Aln(h="left", wrap=True)
    ws.row_dimensions[BR_TIP].height = 44

    # ══════════════════════════════════════════════════════════════════════════
    # TAB: ΣΥΝΟΨΗ  —  one-page print handout (A4 landscape, fit to one page):
    # position, per-project budget vs actual, funding gap. Nothing computed
    # here — every figure is a live reference to a sheet that already
    # calculates it, so this is purely a print-friendly arrangement of
    # numbers that exist elsewhere (same single-source-of-truth rule as the
    # rest of the workbook). Built for handing to someone outside the file
    # (a bank, e.g. for the Q003 loan application) who needs one clean page,
    # not the working sheets underneath.
    # ══════════════════════════════════════════════════════════════════════════
    ws = ws_sum
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 32
    for letter in "BCDE":
        ws.column_dimensions[letter].width = 18
    ws.column_dimensions["F"].width = 30

    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_area = "A1:F44"

    ws.row_dimensions[1].height = 36
    ws.merge_cells("A1:E1")
    c = ws.cell(row=1, column=1, value="  " + t("ΠΡΟΫΠΟΛΟΓΙΣΜΟΣ LA  —  ΣΥΝΟΨΗ", "LA BUDGETING  —  SUMMARY"))
    c.fill = F(DARK_BLUE); c.font = Fnt(size=15, bold=True, color=WHITE)
    c.alignment = Aln(h="left", v="center")
    # TEXT()'s format-string argument uses the SYSTEM LOCALE's own date-code
    # letters, not the literal "DD/MM/YYYY" — confirmed via COM: on a Greek-
    # locale Excel that literal returns #VALUE!, it has to be "ΗΗ/ΜΜ/ΕΕΕΕ"
    # (same class of bug as the comma/period TEXT() issue elsewhere in this
    # file). Built with DAY()/MONTH()/YEAR() instead, which are locale-
    # neutral functions, so this works regardless of the machine's locale.
    dc = ws.cell(row=1, column=6, value='="' + t("Ημ/νία εκτύπωσης: ", "Printed: ") +
                 '"&TEXT(DAY(TODAY()),"00")&"/"&TEXT(MONTH(TODAY()),"00")&"/"&YEAR(TODAY())')
    dc.fill = F(DARK_BLUE); dc.font = Fnt(size=10, color=WHITE); dc.alignment = Aln(h="right", v="center")
    sheet_intro(ws, 2,
        t("Το έντυπο μίας σελίδας που δίνετε σε τρίτους — τράπεζα, λογιστή, συνέταιρο. Ρευστότητα, μίνι "
          "ισολογισμός, αποτελέσματα 12μήνου και ανά έργο, όλα σε μία ματιά.",
          "The one-page handout for outsiders — a bank, an accountant, a partner. Liquidity, a mini balance "
          "sheet, 12-month results, and per-project figures, all in one glance."),
        end_col="F")

    sec_hdr(ws, 3, t("ΘΕΣΗ ΡΕΥΣΤΟΤΗΤΑΣ", "LIQUIDITY POSITION"), number="1", end_col="F")
    spacer(ws, 4, 5, LIGHT_GREY)
    mrow(ws, 5, t('="Σύνολο Διαθέσιμων Κεφαλαίων — "&ViewMode', '="Total Confirmed Funds — "&ViewMode'),
         f"={FUNDS_F}", "", value_fmt=EUR0, value_bold=True, value_size=14, value_color=DARK_BLUE,
         label_bg=LIGHT_BLUE, value_bg=LIGHT_BLUE, note_bg=LIGHT_BLUE, label_bold=True, height=26, col0=1)
    mrow(ws, 6, t("Σύνολο Οφειλών", "Total Liabilities"), "=TotalLiabilities", "",
         value_fmt=EUR0, value_color=RED_FG, col0=1)
    mrow(ws, 7, t("Καθαρή Θέση Μετά Οφειλών", "Net Position After Liabilities"),
         f"={FREE_CASH_F}-TotalLiabilities", "",
         value_fmt=EUR0_NEG, value_bold=True, value_color="FF965800",
         label_bg="FFFEF0D8", value_bg="FFFEF0D8", note_bg="FFFEF0D8", label_bold=True, col0=1)
    mrow(ws, 8, t("Αναμενόμενα Εισερχόμενα", "Expected Incoming"),
         "=ExpectedFromAntonis+ExpectedFromAlbert", "",
         value_fmt=EUR0, value_color="FF965800", col0=1)
    mrow(ws, 9, t("Χρηματοδοτικό Κενό (όλα τα έργα)", "Financing Gap (all projects)"),
         f"=\'4. Προϋπολογισμοί\'!{get_column_letter(BUD_LAST_COL)}{GAP_ROW}", "",
         value_fmt=EUR0, value_bold=True, value_color=RED_FG,
         label_bg=RED_BG, value_bg=RED_BG, note_bg=RED_BG, col0=1)
    spacer(ws, 10, 6)

    # ── ΜΙΝΙ ΙΣΟΛΟΓΙΣΜΟΣ — Καθαρή Θέση Μετά Οφειλών above (row 7) nets
    # liquid cash against debt alone, which is the right number for "can we
    # cover what we owe with cash today" but reads as insolvency to someone
    # outside the file who doesn't see the projects being built with that
    # cash. This adds the two asset classes a real balance sheet would
    # carry — capital already invested in projects (WIP) and property
    # value — against the same liabilities, always at the "Όλα" (all-owner)
    # view since a balance sheet handed to a bank isn't scoped by an
    # internal Corporate/Personal toggle. ──
    sec_hdr(ws, 11, t("ΜΙΝΙ ΙΣΟΛΟΓΙΣΜΟΣ", "MINI BALANCE SHEET"), number="2", end_col="F")
    spacer(ws, 12, 5, LIGHT_GREY)
    ws.row_dimensions[13].height = 20
    ah = ws.cell(row=13, column=1, value=t("ΕΝΕΡΓΗΤΙΚΟ", "ASSETS"))
    ah.fill = F(LIGHT_BLUE); ah.font = Fnt(size=10, bold=True, color=DARK_BLUE); ah.alignment = Aln(h="left", v="center")
    for ci in range(2, 7): ws.cell(row=13, column=ci).fill = F(LIGHT_BLUE)
    mrow(ws, 14, t("Ρευστά Διαθέσιμα (Όλα)", "Liquid Funds (All)"), "=AllFunds", "",
         value_fmt=EUR0, col0=1)
    mrow(ws, 15, t("Αποθέματα (Χρυσός+Κρυπτό)", "Reserves (Gold+Crypto)"), "=ReserveFunds", "",
         value_fmt=EUR0, col0=1)
    mrow(ws, 16, t("Κεφάλαιο Επενδυμένο σε Έργα (Πληρωμένα)", "Capital Invested in Projects (Paid)"),
         "=SUM(\'3. Έργα\'!B3:B14)",
         t("WIP — άθροισμα Πληρωμένων σε όλα τα έργα, βλ. Έργα", "WIP — sum of Paid across all projects, see Έργα"),
         value_fmt=EUR0, col0=1)
    ws.row_dimensions[17].height = 22
    lbl(ws, 17, 1, t("Εκτιμώμενη Αξία Ακινήτων (χειροκίνητο)", "Estimated Property Value (manual)"), bg=YELLOW)
    pvc = ws.cell(row=17, column=3)
    pvc.fill = F(YELLOW); pvc.number_format = EUR0; pvc.alignment = Aln(h="right", v="center"); pvc.protection = UNLOCKED
    lbl(ws, 17, 4, t("Συμπληρώστε πραγματική εκτίμηση/αποτίμηση όταν υπάρχει", "Fill in a real appraisal/valuation once one exists"), bg=YELLOW)
    ASSET_VAL_ROW = 17
    mrow(ws, 18, t("ΣΥΝΟΛΟ ΕΝΕΡΓΗΤΙΚΟΥ", "TOTAL ASSETS"),
         f"=C14+C15+C16+C{ASSET_VAL_ROW}", "",
         value_fmt=EUR0, value_bold=True, value_size=13, value_color=DARK_BLUE,
         label_bg=LIGHT_BLUE, value_bg=LIGHT_BLUE, note_bg=LIGHT_BLUE, label_bold=True, col0=1)
    ASSETS_TOTAL_ROW = 18
    spacer(ws, 19, 6)
    ws.row_dimensions[20].height = 20
    ph = ws.cell(row=20, column=1, value=t("ΠΑΘΗΤΙΚΟ", "LIABILITIES"))
    ph.fill = F("FFFEF0D8"); ph.font = Fnt(size=10, bold=True, color="FF965800"); ph.alignment = Aln(h="left", v="center")
    for ci in range(2, 7): ws.cell(row=20, column=ci).fill = F("FFFEF0D8")
    mrow(ws, 21, t("Οφειλές", "Liabilities"), "=TotalLiabilities", "", value_fmt=EUR0, value_color=RED_FG, col0=1)
    mrow(ws, 22, t("Δεσμεύσεις Κινήσεων (Σύνολο Υποχρεώσεων)", "Κινήσεις Commitments (Total Committed)"),
         f"=({KIN_UPCOMING_F})", "", value_fmt=EUR0, value_color=RED_FG, col0=1)
    mrow(ws, 23, t("ΣΥΝΟΛΟ ΠΑΘΗΤΙΚΟΥ", "TOTAL LIABILITIES"), "=C21+C22", "",
         value_fmt=EUR0, value_bold=True, value_size=13, value_color="FF965800",
         label_bg="FFFEF0D8", value_bg="FFFEF0D8", note_bg="FFFEF0D8", label_bold=True, col0=1)
    LIAB_TOTAL_ROW = 23
    spacer(ws, 24, 6)
    mrow(ws, 25, t("ΚΑΘΑΡΗ ΘΕΣΗ (μίνι ισολογισμός)", "NET WORTH (mini balance sheet)"),
         f"=C{ASSETS_TOTAL_ROW}-C{LIAB_TOTAL_ROW}",
         t("Ενεργητικό μείον Παθητικό — περιλαμβάνει το κεφάλαιο ήδη επενδυμένο στα έργα, όχι μόνο ρευστό",
           "Assets minus Liabilities — includes capital already invested in the projects, not just cash"),
         value_fmt=EUR0_NEG, value_bold=True, value_size=16, value_color=GREEN_FG,
         label_bg=GREEN_BG, value_bg=GREEN_BG, note_bg=GREEN_BG, label_bold=True, height=30, col0=1)
    spacer(ws, 26, 6)

    sec_hdr(ws, 27, t("ΑΝΑ ΕΡΓΟ — ΠΡΟΫΠΟΛΟΓΙΣΜΟΣ ΕΝΑΝΤΙ ΠΡΑΓΜΑΤΙΚΟΥ", "BY PROJECT — BUDGET VS. ACTUAL"), number="3", end_col="F")
    ws.row_dimensions[28].height = 20
    sum_proj_headers = [t("Έργο", "Project"), t("Πληρωμένα", "Paid"), t("Εκκρεμή", "Due"),
                        t("Ληξιπρόθεσμο", "Overdue"), t("Σύνολο", "Total")]
    for ci, h in enumerate(sum_proj_headers, 1):
        col_hdr(ws, 28, ci, h)
    _white_fill_sum = PatternFill(start_color=WHITE, end_color=WHITE, fill_type="solid")
    _white_font_sum = Font(name="Calibri", color="FFFFFFFF")
    for i in range(12):
        r = 29 + i
        src = 3 + i   # matching '3. Έργα' row
        ws.row_dimensions[r].height = 18
        nmc = ws.cell(row=r, column=1, value=f"=IF(\'3. Έργα\'!$A${src}=\"\",\"\",\'3. Έργα\'!$L${src})")
        nmc.fill = F(WHITE); nmc.font = Fnt(size=10, bold=True, color=DARK_BLUE); nmc.alignment = Aln(h="left", v="center")
        for ci, col_l in ((2, "B"), (3, "C"), (4, "D"), (5, "E")):
            vc = ws.cell(row=r, column=ci, value=f"=IF(\'3. Έργα\'!$A${src}=\"\",\"\",\'3. Έργα\'!${col_l}${src})")
            vc.fill = F(WHITE); vc.font = Fnt(size=10, color="FF374151"); vc.alignment = Aln(h="right", v="center")
            vc.number_format = EUR0
        ws.conditional_formatting.add(f"A{r}:E{r}",
            FormulaRule(formula=[f"\'3. Έργα\'!$A${src}=\"\""], fill=_white_fill_sum, font=_white_font_sum))
    SUM_PROJ_TOTAL_ROW = 41
    tl = ws.cell(row=SUM_PROJ_TOTAL_ROW, column=1, value=t("ΣΥΝΟΛΟ", "TOTAL"))
    tl.fill = F(LIGHT_BLUE); tl.font = Fnt(size=10, bold=True, color=DARK_BLUE); tl.alignment = Aln(h="left")
    for ci, col_l in ((2, "B"), (3, "C"), (4, "D"), (5, "E")):
        tv = ws.cell(row=SUM_PROJ_TOTAL_ROW, column=ci, value=f"=SUM({col_l}29:{col_l}40)")
        tv.fill = F(LIGHT_BLUE); tv.font = Fnt(size=10, bold=True, color=DARK_BLUE); tv.alignment = Aln(h="right")
        tv.number_format = EUR0
    spacer(ws, 42, 6)

    spacer(ws, 42, 6)

    # ── bank-presentable P&L — trailing 12 months, CASH BASIS (paid
    # transactions only, matching the rest of this workbook's cash-focused
    # design — not an accrual P&L, and explicitly labeled as such). Loan
    # principal (Κατηγορία=Δάνειο) is excluded from Expenses since a draw
    # or repayment is a financing/balance-sheet item, not an operating
    # cost — including it would understate Net Result on years with real
    # tranches and misrepresent the business's actual operating margin. ──
    sec_hdr(ws, 43, t("ΛΟΓΑΡΙΑΣΜΟΣ ΑΠΟΤΕΛΕΣΜΑΤΩΝ (12μηνο, ταμειακή βάση)", "PROFIT & LOSS (trailing 12 months, cash basis)"), number="4", end_col="F")
    spacer(ws, 44, 5, LIGHT_GREY)
    _pnl_rev_f = (f'SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_TYPE}],"{TYPE_INC}",Table_Kin[{H_SCOPE}],"{SCOPE_BIZ}",'
                  f'Table_Kin[{H_STATUS}],"{S_PAID}",Table_Kin[{H_DATE}],">="&EDATE(TODAY(),-12))')
    _pnl_exp_f = (f'SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_TYPE}],"{TYPE_EXP}",Table_Kin[{H_SCOPE}],"{SCOPE_BIZ}",'
                  f'Table_Kin[{H_STATUS}],"{S_PAID}",Table_Kin[{H_DATE}],">="&EDATE(TODAY(),-12),Table_Kin[{H_CATEGORY}],"<>{CAT_LOAN}")')
    mrow(ws, 45, t("Έσοδα (12μηνο)", "Revenue (12mo)"), f"=({_pnl_rev_f})", "",
         value_fmt=EUR0, value_bold=True, value_color=GREEN_FG, col0=1)
    mrow(ws, 46, t("Λειτουργικά Έξοδα (12μηνο, εκτός δανειακού κεφαλαίου)", "Operating Expenses (12mo, excl. loan principal)"),
         f"=({_pnl_exp_f})", "", value_fmt=EUR0, value_color=RED_FG, col0=1)
    mrow(ws, 47, t("ΚΑΘΑΡΟ ΑΠΟΤΕΛΕΣΜΑ", "NET RESULT"), "=C45-C46", "",
         value_fmt=EUR0_NEG, value_bold=True, value_size=14, value_color=DARK_BLUE,
         label_bg=LIGHT_BLUE, value_bg=LIGHT_BLUE, note_bg=LIGHT_BLUE, label_bold=True, col0=1)
    mrow(ws, 48, t("Περιθώριο Καθαρού Αποτελέσματος", "Net Margin"), '=IFERROR(C47/C45,"—")', "",
         value_fmt="0,0%", col0=1)
    spacer(ws, 49, 6)
    wb.defined_names["PnLNetResult"] = DefinedName("PnLNetResult", attr_text="'17. Σύνοψη'!$C$47")

    ws.merge_cells("A50:F50")
    fc = ws.cell(row=50, column=1,
        value="  " + t("Όλα τα ποσά ζωντανά από το αρχείο εργασίας — δείτε Κέντρο Ελέγχου, Έργα, Προϋπολογισμοί για πλήρη ανάλυση. Ο Λογαριασμός Αποτελεσμάτων είναι ταμειακής βάσης (μόνο Πληρωμένες κινήσεις), όχι λογιστικής βάσης δεδουλευμένων.",
                        "All figures live from the working file — see Κέντρο Ελέγχου, Έργα, Προϋπολογισμοί for full detail. The Profit & Loss is cash-basis (Paid transactions only), not accrual accounting."))
    fc.font = Fnt(size=9, italic=True, color="FF6B7280")
    fc.fill = F("FFF6F8FA"); fc.alignment = Aln(h="left", wrap=True)
    ws.row_dimensions[50].height = 28
    ws.print_area = "A1:F50"

    # ══════════════════════════════════════════════════════════════════════════
    # TAB: ΑΠΟΔΟΣΗ ΕΤΑΙΡΩΝ  (2-partner equity waterfall over Q003's full
    # levered cash-flow life — no partner-equity data exists anywhere else
    # in this workbook (no % split, no hurdle rate, no promote), so this is
    # a TEMPLATE with editable yellow assumptions defaulting to a plain
    # 50/50 split, 8% simple (non-compounding) preferred return, and a 20%
    # promote to Partner B above the hurdle — standard back-of-envelope
    # waterfall shape, not a specific deal's real terms. A full year-by-year
    # IRR-tracking waterfall (unreturned-capital balance compounding
    # forward each year) would need ~26 rows of running-balance formulas
    # per partner; this is a LIFETIME summary over the whole horizon
    # instead — simpler, but the tiers (capital / preferred / promote) are
    # real and adjustable, not fabricated numbers. ──
    # ══════════════════════════════════════════════════════════════════════════
    ws = ws_wf
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 40
    for letter in "BCD":
        ws.column_dimensions[letter].width = 20
    for letter in "EFGHIJK":
        ws.column_dimensions[letter].width = 14
    ws.freeze_panes = "A3"

    ws.row_dimensions[1].height = 34
    ws.merge_cells("A1:D1")
    c = ws.cell(row=1, column=1, value="  " + t("ΑΠΟΔΟΣΗ ΕΤΑΙΡΩΝ  —  WATERFALL (Q003)", "PARTNER RETURNS  —  WATERFALL (Q003)"))
    c.fill = F(DARK_BLUE); c.font = Fnt(size=14, bold=True, color=WHITE)
    c.alignment = Aln(h="left", v="center")
    sheet_intro(ws, 2,
        t("Πρότυπο waterfall διανομών του Q003 — πρώτα επιστρέφεται το κεφάλαιο, μετά η προνομιακή απόδοση, "
          "μετά μοιράζεται το πλεόνασμα. Συμπληρώστε τα πραγματικά ποσοστά στις παραδοχές για να δείτε τι "
          "παίρνει ο καθένας.",
          "Q003's template distribution waterfall — capital comes back first, then the preferred return, "
          "then the surplus is split. Fill in the real splits in the assumptions to see what each partner gets."),
        end_col="D")

    sec_hdr(ws, 3, t("ΠΑΡΑΔΟΧΕΣ (πρότυπο — συμπληρώστε τα πραγματικά ποσοστά)", "ASSUMPTIONS (template — fill in the real splits)"), number="1", end_col="D")
    spacer(ws, 4, 4, LIGHT_GREY)
    ws.row_dimensions[5].height = 20
    lbl(ws, 5, 1, t("Ποσοστό Συμμετοχής — Εταίρος Α", "Equity Share — Partner A"), bg=WHITE)
    pa_pct = ws.cell(row=5, column=2, value=0.5)
    pa_pct.number_format = "0%"; pa_pct.fill = F(YELLOW); pa_pct.font = Fnt(size=10, bold=True, color=DARK_BLUE)
    pa_pct.alignment = Aln(h="right", v="center"); pa_pct.protection = UNLOCKED
    PA_PCT_ROW = 5
    ws.row_dimensions[6].height = 20
    lbl(ws, 6, 1, t("Ποσοστό Συμμετοχής — Εταίρος Β (Sponsor)", "Equity Share — Partner B (Sponsor)"), bg=WHITE)
    pb_pct = ws.cell(row=6, column=2, value=f"=1-B{PA_PCT_ROW}")
    pb_pct.number_format = "0%"; pb_pct.fill = F(WHITE); pb_pct.font = Fnt(size=10, bold=True, color=DARK_BLUE)
    pb_pct.alignment = Aln(h="right", v="center")
    PB_PCT_ROW = 6
    ws.row_dimensions[7].height = 20
    lbl(ws, 7, 1, t("Προνομιακή Απόδοση (ετήσια, με ανατοκισμό απλήρωτου υπολοίπου)", "Preferred Return (annual, compounding on unpaid balance)"), bg=WHITE)
    hurdle_c = ws.cell(row=7, column=2, value=0.08)
    hurdle_c.number_format = "0%"; hurdle_c.fill = F(YELLOW); hurdle_c.font = Fnt(size=10, bold=True, color=DARK_BLUE)
    hurdle_c.alignment = Aln(h="right", v="center"); hurdle_c.protection = UNLOCKED
    HURDLE_ROW = 7
    ws.row_dimensions[8].height = 20
    lbl(ws, 8, 1, t("Promote στον Sponsor (πάνω από το Hurdle)", "Promote to Sponsor (above Hurdle)"), bg=WHITE)
    promote_c = ws.cell(row=8, column=2, value=0.2)
    promote_c.number_format = "0%"; promote_c.fill = F(YELLOW); promote_c.font = Fnt(size=10, bold=True, color=DARK_BLUE)
    promote_c.alignment = Aln(h="right", v="center"); promote_c.protection = UNLOCKED
    PROMOTE_ROW = 8
    spacer(ws, 9, 4)

    sec_hdr(ws, 10, t("ΔΙΑΝΕΜΗΤΕΑ ΤΑΜΕΙΑΚΗ ΡΟΗ — ΖΩΗ ΕΡΓΟΥ (Levered, Q003)", "DISTRIBUTABLE CASH FLOW — PROJECT LIFE (Levered, Q003)"), number="2", end_col="D")
    spacer(ws, 11, 4, LIGHT_GREY)
    mrow(ws, 12, t("Επενδυμένο Κεφάλαιο Εταίρων (Έτος 0, Equity)", "Partners' Invested Equity (Year 0)"),
         "=-Q003LeveredCF0", "", value_fmt=EUR0, value_bold=True, value_color=RED_FG, col0=1)
    EQUITY_ROW = 12
    mrow(ws, 13, t("Σύνολο Ταμειακής Ροής Εταίρων (Έτη 1+, Levered)", "Total Partner Cash Flow (Years 1+, Levered)"),
         "=SUM(Q003LeveredCFRange)",
         t("Άθροισμα της στήλης «Ταμειακή Ροή (Levered)» στο Μισθώματα & Αποδόσεις", "Sum of the “Cash Flow (Levered)” column on Μισθώματα & Αποδόσεις"),
         value_fmt=EUR0, value_bold=True, value_color=GREEN_FG, col0=1)
    TOTAL_CF_ROW = 13
    spacer(ws, 14, 4)

    # ── ΕΤΗΣΙΟ WATERFALL — a real year-by-year priority-of-payments model:
    # each year's available cash first pays down any OUTSTANDING capital +
    # preferred balance (which compounds forward — unpaid preferred in a
    # weak year accrues into next year's balance, a real hurdle mechanic,
    # not the flat "rate × years" approximation the old lifetime-summary
    # version used). Any year where available cash is negative (NOI doesn't
    # cover debt service) is treated as an ADDITIONAL capital call, added
    # to the balance owed back — this happens for real in Q003's early
    # years per the Levered cash-flow column on Μισθώματα & Αποδόσεις. ──
    sec_hdr(ws, 15, t("ΕΤΗΣΙΟ WATERFALL (με ανατοκισμό υπολοίπου)", "ANNUAL WATERFALL (with compounding balance)"), number="3", end_col="K")
    ws.row_dimensions[16].height = 30
    wf_headers = [t("Έτος", "Year"), t("Ημερ. Έτος", "Cal. Year"), t("Διαθέσιμη Ροή", "Available CF"),
                  t("Υπόλοιπο Έναρξης", "Opening Balance"), t("Ανατοκισμός Pref.", "Pref. Accrual"),
                  t("Διανομή (Κεφ.+Pref.)", "Distribution (Cap.+Pref.)"), t("Πλεόνασμα (Promote)", "Excess (Promote)"),
                  t("Πρόσθετη Κλήση Κεφαλαίου", "Additional Capital Call"), t("Υπόλοιπο Λήξης", "Closing Balance"),
                  t("Εταίρος Α", "Partner A"), t("Εταίρος Β (Sponsor)", "Partner B (Sponsor)")]
    for ci, h in enumerate(wf_headers, 1):
        col_hdr(ws, 16, ci, h)
    WF_FIRST = 17
    for yi in range(RENT_YEARS + 1):   # Year 0 (capital call) + Years 1..RENT_YEARS
        row = WF_FIRST + yi
        ws.row_dimensions[row].height = 15
        yc = ws.cell(row=row, column=1, value=yi); yc.alignment = Aln(h="center"); yc.font = Fnt(size=9); yc.fill = F(WHITE)
        if yi == 0:
            calyr = ws.cell(row=row, column=2, value="—")
            avail = ws.cell(row=row, column=3, value="=Q003LeveredCF0")
            opening = ws.cell(row=row, column=4, value=0)
            accrual = ws.cell(row=row, column=5, value=0)
            distrib = ws.cell(row=row, column=6, value=0)
            excess = ws.cell(row=row, column=7, value=0)
            call_f = ws.cell(row=row, column=8, value=f"=MAX(0,-C{row})")
            closing = ws.cell(row=row, column=9, value=f"=D{row}+E{row}-F{row}+H{row}")
        else:
            calyr = ws.cell(row=row, column=2, value=f"=INDEX(Q003RentCalYears,{yi})")
            avail = ws.cell(row=row, column=3, value=f"=INDEX(Q003LeveredCFRange,{yi})")
            opening = ws.cell(row=row, column=4, value=f"=I{row-1}")
            accrual = ws.cell(row=row, column=5, value=f"=D{row}*B{HURDLE_ROW}")
            distrib = ws.cell(row=row, column=6, value=f"=MIN(MAX(0,C{row}),D{row}+E{row})")
            excess = ws.cell(row=row, column=7, value=f"=MAX(0,C{row}-F{row})")
            call_f = ws.cell(row=row, column=8, value=f"=MAX(0,-C{row})")
            closing = ws.cell(row=row, column=9, value=f"=D{row}+E{row}-F{row}+H{row}")
        calyr.alignment = Aln(h="center"); calyr.font = Fnt(size=9, color="FF6B7280"); calyr.fill = F(WHITE)
        for cc in (avail, opening, accrual, distrib, excess, call_f, closing):
            cc.number_format = EUR0; cc.alignment = Aln(h="right"); cc.font = Fnt(size=9); cc.fill = F(WHITE)
        closing.font = Fnt(size=9, bold=True, color=DARK_BLUE)
        # per-year partner split: Distribution (capital+pref) pro-rata by
        # equity share; Excess (promote pool) — Promote% to the Sponsor,
        # the rest pro-rata by equity share.
        pa = ws.cell(row=row, column=10,
            value=f"=F{row}*B{PA_PCT_ROW}+G{row}*(1-B{PROMOTE_ROW})*B{PA_PCT_ROW}")
        pb = ws.cell(row=row, column=11,
            value=f"=F{row}*B{PB_PCT_ROW}+G{row}*(B{PROMOTE_ROW}+(1-B{PROMOTE_ROW})*B{PB_PCT_ROW})")
        for cc in (pa, pb):
            cc.number_format = EUR0; cc.alignment = Aln(h="right"); cc.font = Fnt(size=9, bold=True, color=GREEN_FG); cc.fill = F(WHITE)
    WF_LAST = WF_FIRST + RENT_YEARS
    for r in range(WF_FIRST + 9, WF_LAST + 1):
        ws.row_dimensions[r].outline_level = 1
        ws.row_dimensions[r].hidden = True

    SUM_HDR = WF_LAST + 2
    sec_hdr(ws, SUM_HDR, t("ΣΥΝΟΨΗ", "SUMMARY"), number="4", end_col="D")
    spacer(ws, SUM_HDR + 1, 4, LIGHT_GREY)
    TOTAL_DIST_ROW = SUM_HDR + 2
    tot_lbl = ws.cell(row=TOTAL_DIST_ROW, column=1, value=t("ΣΥΝΟΛΟ ΔΙΑΝΟΜΩΝ (ζωή έργου)", "TOTAL DISTRIBUTIONS (project life)"))
    tot_lbl.font = Fnt(size=11, bold=True, color=DARK_BLUE); tot_lbl.fill = F(LIGHT_BLUE); tot_lbl.alignment = Aln(h="left", v="center")
    for ci, col_l in ((2, "J"), (3, "K")):
        tv = ws.cell(row=TOTAL_DIST_ROW, column=ci, value=f"=SUM({col_l}{WF_FIRST}:{col_l}{WF_LAST})")
        tv.number_format = EUR0; tv.font = Fnt(size=11, bold=True, color=DARK_BLUE); tv.fill = F(LIGHT_BLUE)
        tv.alignment = Aln(h="right", v="center")
    ws.cell(row=TOTAL_DIST_ROW, column=4).fill = F(LIGHT_BLUE)
    tv_all = ws.cell(row=TOTAL_DIST_ROW, column=3 + 12, value=f"=B{TOTAL_DIST_ROW}+C{TOTAL_DIST_ROW}")
    tv_all.number_format = EUR0; tv_all.font = Fnt(size=1, color=WHITE)
    EQUITY_ROW2 = TOTAL_DIST_ROW + 1
    eq_lbl = ws.cell(row=EQUITY_ROW2, column=1, value=t("Επενδυμένο Κεφάλαιο Εταίρων (Έτος 0 + πρόσθετες κλήσεις)", "Partners' Invested Capital (Year 0 + additional calls)"))
    eq_lbl.font = Fnt(size=9, italic=True, color="FF6B7280"); eq_lbl.fill = F(WHITE); eq_lbl.alignment = Aln(h="left", v="center")
    # MOIC must divide by EVERYTHING the partners actually put in, not just
    # the Year-0 contribution — years with negative Available CF (real for
    # this project: −€4.100 to −€75.444 in years 1-15) show up as
    # "Πρόσθετη Κλήση Κεφαλαίου" (column H) precisely because the
    # partners had to fund that shortfall too, and ignoring those calls in
    # the denominator inflated MOIC to 3.07x on total contributions that
    # were actually closer to Year0 + €663k more — the real multiple is
    # ~1.4x. SUM(H{WF_FIRST}:H{WF_LAST}) alone is the correct total: Year
    # 0's own call_f is computed by the SAME MAX(0,-Available) formula as
    # every later year, so it already equals the Year-0 equity figure —
    # adding -Q003LeveredCF0 on top of it would double-count that first
    # contribution rather than add to it.
    for ci, col_l, pct_row in ((2, "J", PA_PCT_ROW), (3, "K", PB_PCT_ROW)):
        ev = ws.cell(row=EQUITY_ROW2, column=ci,
            value=f"=SUM(H{WF_FIRST}:H{WF_LAST})*B{pct_row}")
        ev.number_format = EUR0; ev.font = Fnt(size=9, italic=True, color="FF6B7280"); ev.fill = F(WHITE)
        ev.alignment = Aln(h="right", v="center")
    MOIC_ROW = EQUITY_ROW2 + 1
    moic_lbl = ws.cell(row=MOIC_ROW, column=1, value=t("Πολλαπλάσιο επί Κεφαλαίου (MOIC)", "Multiple on Invested Capital (MOIC)"))
    moic_lbl.font = Fnt(size=9, italic=True, color="FF6B7280"); moic_lbl.fill = F(WHITE); moic_lbl.alignment = Aln(h="left", v="center")
    for ci, col_l in ((2, "B"), (3, "C")):
        mv = ws.cell(row=MOIC_ROW, column=ci, value=f'=IFERROR({col_l}{TOTAL_DIST_ROW}/{col_l}{EQUITY_ROW2},"—")')
        mv.number_format = "0,00\"x\""; mv.font = Fnt(size=9, italic=True, color="FF6B7280"); mv.fill = F(WHITE)
        mv.alignment = Aln(h="right", v="center")
    wb.defined_names["WaterfallMOIC_A"] = DefinedName("WaterfallMOIC_A", attr_text=f"'18. Απόδοση Εταίρων'!$B${MOIC_ROW}")
    wb.defined_names["WaterfallTotalDist"] = DefinedName("WaterfallTotalDist", attr_text=f"'18. Απόδοση Εταίρων'!$O${TOTAL_DIST_ROW}")
    spacer(ws, MOIC_ROW + 1, 4)

    TIP_ROW = MOIC_ROW + 2
    ws.merge_cells(start_row=TIP_ROW, start_column=1, end_row=TIP_ROW, end_column=11)
    wftip = ws.cell(row=TIP_ROW, column=1,
        value="  " + t("Πρότυπο υπόδειγμα — ΔΕΝ υπάρχουν πραγματικά στοιχεία εταίρων (ποσοστά, hurdle, promote) αλλού στο αρχείο. Έτος-προς-έτος waterfall: το απλήρωτο υπόλοιπο (κεφάλαιο + δεδουλευμένο Pref.) ανατοκίζεται στα επόμενα έτη· αρνητική Διαθέσιμη Ροή αντιμετωπίζεται ως πρόσθετη κλήση κεφαλαίου. Έτη 10-25 συμπτυγμένα από προεπιλογή. Αλλάξτε τα κίτρινα κελιά με τους πραγματικούς όρους της συμφωνίας.",
                      "Template only — NO real partner data (splits, hurdle, promote) exists elsewhere in this file. Year-by-year waterfall: any unpaid balance (capital + accrued Pref.) compounds forward into later years; a negative Available CF year is treated as an additional capital call. Years 10-25 collapsed by default. Edit the yellow cells with the real deal terms."))
    wftip.font = Fnt(size=9, italic=True, color="FF6B7280")
    wftip.fill = F("FFF6F8FA"); wftip.alignment = Aln(h="left", wrap=True)
    ws.row_dimensions[TIP_ROW].height = 44
    protect_sheet(ws)

    # ══════════════════════════════════════════════════════════════════════════
    # TAB: INFO
    # ══════════════════════════════════════════════════════════════════════════
    info_title = t("\u03a0\u03a9\u03a3 \u039d\u0391 \u03a7\u03a1\u0397\u03a3\u0399\u039c\u039f\u03a0\u039f\u0399\u0397\u03a3\u0395\u03a4\u0395 \u0391\u03a5\u03a4\u039f \u03a4\u039f \u0391\u03a1\u03a7\u0395\u0399\u039f", "HOW TO USE THIS WORKBOOK")

    _info_tab(wb, info_title, "Οδηγίες", [

        (t("\u039f\u0394\u0397\u0393\u039f\u03a3 \u03a7\u03a1\u03a9\u039c\u0391\u03a4\u03a9\u039d", "COLOUR GUIDE"), "FF1868A8", [
            ("clr", ("FFE8F8F1", "FF0B6640"), t("\u03a0\u03c1\u03ac\u03c3\u03b9\u03bd\u03bf = \u03a0\u03bb\u03b7\u03c1\u03c9\u03bc\u03ad\u03bd\u03bf / \u0398\u03b5\u03c4\u03b9\u03ba\u03cc \u03bc\u03ad\u03b3\u03b5\u03b8\u03bf\u03c2", "Green background = Paid / positive / confirmed")),
            ("clr", ("FFFDF8ED", "FF7A3800"), t("\u039a\u03af\u03c4\u03c1\u03b9\u03bd\u03bf / \u03b5\u03bb\u03b5\u03cd\u03b8\u03b5\u03c1\u03bf\u03c5 \u03c7\u03c1\u03ce\u03bc\u03b1 = \u03b5\u03c0\u03b5\u03be\u03b5\u03c1\u03b3\u03ac\u03c3\u03b9\u03bc\u03bf \u03ba\u03b5\u03bb\u03af \u2014 \u03bc\u03c0\u03bf\u03c1\u03b5\u03af\u03c4\u03b5 \u03bd\u03b1 \u03b3\u03c1\u03ac\u03c8\u03b5\u03c4\u03b5 \u03b5\u03b4\u03ce (\u03c3\u03c4\u03b9\u03c2 \u03c0\u03b5\u03c1\u03b9\u03c3\u03c3\u03cc\u03c4\u03b5\u03c1\u03b5\u03c2 \u03ba\u03b1\u03c1\u03c4\u03ad\u03bb\u03b5\u03c2)", "Yellow / ivory = editable cell \u2014 you can type here (in most tabs)")),
            ("clr", ("FFF6F8FA", "FF6B7280"), t("\u0393\u03ba\u03c1\u03b9 = \u03c5\u03c0\u03bf\u03bb\u03bf\u03b3\u03b9\u03c3\u03bc\u03ad\u03bd\u03bf \u03ba\u03b5\u03bb\u03af (\u03c4\u03cd\u03c0\u03bf\u03c2) \u2014 \u03bc\u03b7\u03bd \u03b1\u03bb\u03bb\u03ac\u03b6\u03b5\u03c4\u03b5. \u03a3\u03c4\u03b9\u03c2 \u039a\u03b9\u03bd\u03ae\u03c3\u03b5\u03b9\u03c2, \u03c4\u03b1 \u03c0\u03b5\u03c1\u03b9\u03c3\u03c3\u03cc\u03c4\u03b5\u03c1\u03b1 \u03b5\u03c0\u03b5\u03be\u03b5\u03c1\u03b3\u03ac\u03c3\u03b9\u03bc\u03b1 \u03ba\u03b5\u03bb\u03b9\u03ac \u03b5\u03af\u03bd\u03b1\u03b9 \u039b\u0395\u03a5\u039a\u0391 (\u03cc\u03c7\u03b9 \u03ba\u03af\u03c4\u03c1\u03b9\u03bd\u03b1) \u2014 \u03bc\u03cc\u03bd\u03bf \u03c4\u03b1 \u03b3\u03ba\u03c1\u03b9 \u03b5\u03ba\u03b5\u03af \u03b5\u03af\u03bd\u03b1\u03b9 \u03c4\u03cd\u03c0\u03bf\u03b9.", "Grey = calculated cell (formula) \u2014 do not edit. In K\u03b9\u03bd\u03ae\u03c3\u03b5\u03b9\u03c2 specifically, most editable cells are WHITE, not yellow \u2014 only grey cells there are formulas.")),
            ("clr", ("FFE3EFF8", "FF1A2F4A"), t("\u039c\u03c0\u03bb\u03b5 \u03c6\u03cc\u03bd\u03c4\u03bf = \u03c4\u03bf\u03bd\u03b9\u03c3\u03bc\u03ad\u03bd\u03bf \u03c3\u03cd\u03bd\u03bf\u03bb\u03bf/\u03b5\u03c0\u03b9\u03ba\u03b5\u03c6\u03b1\u03bb\u03ae\u03c2 \u03b1\u03c1\u03b9\u03b8\u03bc\u03cc\u03c2 (\u03b5\u03c0\u03af\u03c3\u03b7\u03c2 \u03c4\u03cd\u03c0\u03bf\u03c2) \u2014 \u03bc\u03b7\u03bd \u03b1\u03bb\u03bb\u03ac\u03b6\u03b5\u03c4\u03b5", "Blue background = highlighted total/summary figure (also a formula) \u2014 do not edit")),
            ("clr", ("FFFCEFEF", "FF991B1B"), t("\u039a\u03cc\u03ba\u03ba\u03b9\u03bd\u03bf = \u03c0\u03c1\u03bf\u03b5\u03b9\u03b4\u03bf\u03c0\u03bf\u03af\u03b7\u03c3\u03b7 \u03ae \u03ad\u03bb\u03bb\u03b5\u03b9\u03bc\u03bc\u03b1", "Red background = alert or shortfall")),
            ("clr", ("FFFFCC80", "FF7A3800"), t("\u03a0\u03bf\u03c1\u03c4\u03bf\u03ba\u03b1\u03bb\u03af = \u03c7\u03c1\u03b5\u03b9\u03ac\u03b6\u03b5\u03c4\u03b1\u03b9 \u03b5\u03bd\u03b7\u03bc\u03ad\u03c1\u03c9\u03c3\u03b7 \u039a\u0391\u0398\u0395 \u039c\u0397\u039d\u0391 (\u03bc\u03cc\u03bd\u03bf \u03b7 \u03c3\u03c4\u03ae\u03bb\u03b7 \u00ab\u0397\u03bc/\u03bd\u03af\u03b1 \u03a4\u03b5\u03bb. \u03a0\u03bb\u03b7\u03c1\u03c9\u03bc\u03ad\u03bd\u03b7\u03c2 \u0394\u03cc\u03c3\u03b7\u03c2\u00bb \u03c3\u03c4\u03b9\u03c2 \u039a\u03b9\u03bd\u03ae\u03c3\u03b5\u03b9\u03c2) \u2014 \u03b4\u03b9\u03b1\u03c6\u03bf\u03c1\u03b5\u03c4\u03b9\u03ba\u03cc \u03b1\u03c0\u03cc \u03c4\u03bf \u03ba\u03af\u03c4\u03c1\u03b9\u03bd\u03bf, \u03c0\u03bf\u03c5 \u03c3\u03c5\u03bc\u03c0\u03bb\u03b7\u03c1\u03ce\u03bd\u03b5\u03c4\u03b1\u03b9 \u03bc\u03af\u03b1 \u03c6\u03bf\u03c1\u03ac",
                    "Orange = needs updating EVERY MONTH (only the \u201cLast Paid Installment Date\u201d column on \u039a\u03b9\u03bd\u03ae\u03c3\u03b5\u03b9\u03c2) \u2014 different from yellow, which is filled in once")),
        ]),


        (t("ΕΠΙΣΚΟΠΗΣΗ ΚΑΡΤΕΛΩΝ", "TAB OVERVIEW"), "FF1868A8", [
            ("h", t("Τι κάνει η κάθε καρτέλα:", "What each tab does:"), ""),
            ("b", t("Κέντρο Ελέγχου  —  Η κεντρική οθόνη: διαθέσιμα κεφάλαια, ΦΠΑ, ανά έργο, «Πότε θα τρέξουμε χαμηλά σε ρευστό» (πρόβλεψη ταμείου + γράφημα), ΠΡΟΣΩΠΙΚΑ ΕΞΟΔΑ ανά κατηγορία, ΑΝΑΜΕΝΟΜΕΝΑ ΕΙΣΕΡΧΟΜΕΝΑ ΜΕ ΒΕΒΑΙΟΤΗΤΑ (κάθε αναμενόμενο ποσό, πόσο σίγουρο είναι, και πόσους μήνες αντέχει το ρευστό), και ΔΑΝΕΙΑΚΗ ΘΕΣΗ (εγκεκριμένα/εκταμιευθέντα δάνεια συν την απόδοση IRR/Payback του Q004). Μόνο ανάγνωση — μην γράφετε εδώ (το φύλλο είναι προστατευμένο).",
                    "Κέντρο Ελέγχου  —  Your main dashboard: available funds, VAT, per-project, 'When Do We Run Low On Cash' (cash forecast + chart), PERSONAL SPENDING by category, EXPECTED INCOMING WITH CERTAINTY (every expected amount, how sure it is, and how many months of cash it buys), and LOAN POSITION (approved/disbursed loans plus Q004's IRR/Payback). Read-only — do not type here (the sheet is protected)."), ""),
            ("b", t("Κινήσεις  —  Η ΜΟΝΑΔΙΚΗ βάση δεδομένων: κάθε έσοδο, έξοδο, τιμολόγιο, κάθε επαναλαμβανόμενο/πάγιο έξοδο ή ρύθμιση, ΚΑΙ κάθε προσωπικό έξοδο/έσοδο καταχωρείται εδώ, μία φορά (στήλη «Πεδίο» = Επιχειρηματικό ή Προσωπικό). Όλες οι άλλες καρτέλες απλώς διαβάζουν από εδώ.",
                    "Κινήσεις  —  The ONE database: every income, expense, invoice, every recurring/installment expense, AND every personal expense/income is entered here, once (the “Πεδίο” column = Business or Personal). Every other tab just reads from here."), ""),
            ("b", t("Έργα  —  Η λίστα των έργων σας και τα σύνολά τους (πληρωμένα / εκκρεμή / πρόβλεψη +1, +6, +12 μηνών / έσοδα) — συμπεριλαμβανομένων των επαναλαμβανόμενων εξόδων.",
                    "Έργα  —  Your projects and their running totals (paid / upcoming / +1, +6, +12 month forecast / income) — recurring expenses included."), ""),
            ("b", t("Προϋπολογισμοί  —  Προϋπολογισμός, χρονοδιάγραμμα, μίσθωση και ταμειακή ανάγκη ανά έργο, συν μια μηνιαία ανάλυση κινήσεων για όποιο έργο επιλέξετε.",
                    "Προϋπολογισμοί  —  Budget, timeline, lease, and cash need per project, plus a monthly transaction breakdown for whichever project you pick."), ""),
            ("b", t("Ανάλυση  —  KPIs με φίλτρο μήνα, ανάλυση ΑΝΑ ΕΡΓΟ, και σύγκριση με προηγούμενο μήνα.",
                    "Ανάλυση  —  KPIs with a month filter, a per-project (ΑΝΑ ΕΡΓΟ) breakdown, and comparison to the previous month."), ""),
            ("b", t("Ελεύθερη Ανάλυση  —  Ένα πραγματικό, διαδραστικό PivotTable με φίλτρα (slicers) για ελεύθερη διερεύνηση των Κινήσεων, ακόμα και ανά ημέρα.",
                    "Ελεύθερη Ανάλυση  —  A real, interactive PivotTable with slicers for free-form exploration of Κινήσεις, down to individual days."), ""),
            ("b", t("Επαφές  —  Λίστα όλων των αντισυμβαλλόμενων με σύνολα εσόδων/εξόδων ανά επαφή.",
                    "Επαφές  —  List of every counterparty with income/expense totals per contact."), ""),
            ("b", t("Λογαριασμοί  —  Τρέχοντα υπόλοιπα: τράπεζες, μετρητά, χρυσός, κρυπτό, οφειλές και εισερχόμενα (ιδιωτικά δάνεια κ.λπ.).",
                    "Λογαριασμοί  —  Your current balances: banks, cash, gold, crypto, liabilities, and incoming funds (private loans, etc.)."), ""),
            ("b", t("Ταμείο  —  Κυλιόμενη πρόβλεψη ταμείου 66 μηνών (5,5 έτη), με αλυσιδωτό υπόλοιπο έναρξης/λήξης μήνα προς μήνα, το χρέος/εισερχόμενο του Αντώνη ενσωματωμένα στις σωστές ημερομηνίες, στήλη Ορίου Ασφαλείας, και το γράφημα στο Κέντρο Ελέγχου.",
                    "Ταμείο  —  A rolling 66-month (5.5-year) cash flow forecast, chaining each month's opening/closing balance to the next, with the Antonis debt/incoming built in on their real dates, a Safety Buffer column, and the chart on Κέντρο Ελέγχου."), ""),
            ("b", t("ΦΠΑ  —  Μηνιαία θέση ΦΠΑ (εσόδων/εξόδων) με προθεσμίες και κατάσταση υποβολής.",
                    "ΦΠΑ  —  Monthly VAT position (income/expenses) with filing deadlines and status."), ""),
            ("b", t("Παρακράτηση  —  Παρακρατούμενος φόρος ανά τιμολόγιο, με κατάσταση απόδοσης.",
                    "Παρακράτηση  —  Withheld tax per invoice, with remittance status."), ""),
            ("b", t("Έλεγχοι Ποιότητας  —  Αυτόματοι έλεγχοι πάνω στα δεδομένα (διπλά παραστατικά, κενή Πηγή, λάθος ΦΠΑ, κ.λπ.) — ο μετρητής εμφανίζεται και στο Κέντρο Ελέγχου.",
                    "Έλεγχοι Ποιότητας  —  Automatic data-quality checks (duplicate invoices, blank Source, bad VAT, etc.) — the counter also shows on Κέντρο Ελέγχου."), ""),
            ("b", t("Μισθώματα & Αποδόσεις  —  IRR/NPV/Yield ανά έργο μίσθωσης (unlevered + levered), συν πίνακες ανάλυσης ευαισθησίας.",
                    "Μισθώματα & Αποδόσεις  —  IRR/NPV/Yield per leased project (unlevered + levered), plus sensitivity-analysis grids."), ""),
            ("b", t("Δάνεια  —  Χρεολύσιο και DSCR για τα δάνεια Α+Β του Q003, με τις πραγματικές ημερομηνίες εκταμίευσης Έτους 1.",
                    "Δάνεια  —  Amortization and DSCR for Q003's Loan A+B, with the real Year-1 disbursement dates."), ""),
            ("b", t("Πρόοδος Έργου  —  Κόστος-για-ολοκλήρωση και S-curve για την κατασκευή του Q003.",
                    "Πρόοδος Έργου  —  Cost-to-complete and S-curve for Q003's construction."), ""),
            ("b", t("Συμφωνία Τραπεζών  —  Αντιστοίχιση extrait τράπεζας με τις Κινήσεις.",
                    "Συμφωνία Τραπεζών  —  Matching a bank extrait against Κινήσεις."), ""),
            ("b", t("Σύνοψη  —  Έντυπο μίας σελίδας για τρίτους (τράπεζα κ.λπ.): ρευστότητα, μίνι ισολογισμός, P&L 12μήνου, ανά έργο.",
                    "Σύνοψη  —  A one-page handout for outsiders (a bank, etc.): liquidity, mini balance sheet, 12-month P&L, per project."), ""),
            ("b", t("Απόδοση Εταίρων  —  Πρότυπο waterfall διανομών Q003 (κεφάλαιο → προνομιακή απόδοση → promote), έτος-προς-έτος με ανατοκισμό.",
                    "Απόδοση Εταίρων  —  Template Q003 distribution waterfall (capital → preferred return → promote), year-by-year with compounding."), ""),
            ("b", t("Ρυθμίσεις  —  Οι λίστες που τροφοδοτούν όλα τα dropdown του αρχείου, συν μερικές παραδοχές αναφοράς.",
                    "Ρυθμίσεις  —  The lists behind every dropdown in the workbook, plus a few reference assumptions."), ""),
            ("b", t("Καθημερινά  —  Μηνιαία σύνοψη των προσωπικών εξόδων σας, ομαδοποιημένη σε 6 ομάδες (Άνθρωποι, Φαγητό, Σπίτι κ.λπ.) — ζωντανό σύνολο από τις Κινήσεις, δεν καταχωρείτε τίποτα εδώ.",
                    "Καθημερινά  —  A monthly rollup of your personal spending, grouped into 6 groups (People, Food, Home, etc.) — a live total from Κινήσεις, nothing is entered here."), ""),
            ("b", t("Μηνιάτικα  —  Ο προσωπικός προϋπολογισμός σας ανά κατηγορία, μήνα προς μήνα — επιλέγετε μήνα και βλέπετε Προϋπολογισμό έναντι Πληρωμένων (από Καθημερινά) και τη διαφορά.",
                    "Μηνιάτικα  —  Your personal budget by category, month by month — pick a month and see Budget vs. Paid (from Καθημερινά) and the variance."), ""),
            ("b", t("Φορολογικό Ημερολόγιο  —  Η επόμενη εκκρεμότητα ΦΠΑ και Παρακράτησης, ζωντανά, συν ένα πρότυπο για τις περιοδικές/ετήσιες υποχρεώσεις (ΕΝΦΙΑ, ΕΦΚΑ, ΓΕΜΗ, ασφαλιστήρια, άδειες) — συμπληρώστε τις με τον λογιστή σας μία φορά.",
                    "Φορολογικό Ημερολόγιο  —  The next open VAT and Withholding item, live, plus a template for periodic/annual obligations (property tax, social security, registry fee, insurance, licenses) — fill them in with your accountant once."), ""),
            ("b", t("Ρευστότητα 13 Εβδομάδων  —  Το ίδιο υπόλοιπο με το Ταμείο, αλλά ανά εβδομάδα — δείχνει αν μια συγκεκριμένη εβδομάδα τρέχει χαμηλά σε ρευστό ακόμα κι αν ο μήνας βγαίνει θετικός. Πλήρως ζωντανό, τίποτα δεν συμπληρώνεται.",
                    "Ρευστότητα 13 Εβδομάδων  —  The same balance as Ταμείο, but week by week — shows a specific week running low on cash even when the month nets positive. Fully live, nothing to fill in."), ""),
            ("b", t("Πληρότητα & Απόδοση Ξενοδοχείου  —  Πληρότητα, ADR, RevPAR και Κάλυψη Μισθώματος για τα δύο έργα Ξενοδοχείο/Μίσθωση (Q003, Q004) — δείχνει αν ο ενοικιαστής γεμίζει αρκετά δωμάτια ώστε να πληρώνει άνετα το σταθερό μίσθωμα. Συμπληρώστε 3 κίτρινα κελιά τον μήνα ανά έργο.",
                    "Πληρότητα & Απόδοση Ξενοδοχείου  —  Occupancy, ADR, RevPAR and Rent Coverage for the two Hotel/Lease projects (Q003, Q004) — shows if the tenant is filling enough rooms to comfortably pay the fixed rent. Fill in 3 yellow cells per month per project."), ""),
            ("b", t("Έλεγχος Νέου Έργου  —  Τι γίνεται αυτόματα, τι θέλει ένα μονό input και τι θέλει καινούριο block κώδικα όταν προσθέτετε ένα 7ο+ έργο στην Έργα.",
                    "Έλεγχος Νέου Έργου  —  What happens automatically, what needs a one-time input, and what needs a brand-new code block when you add a 7th+ project to Έργα."), ""),
            ("b", t("Πολυετές KPI Scorecard  —  Το ίδιο Λογαριασμό Αποτελεσμάτων με τη Σύνοψη, αλλά ανά ημερολογιακό έτος (κυλιόμενο παράθυρο 5 ετών) αντί για κυλιόμενο 12μηνο — δείχνει την πορεία, όχι μόνο μια στιγμή.",
                    "Πολυετές KPI Scorecard  —  The same P&L as Σύνοψη, but by calendar year (a sliding 5-year window) instead of a rolling 12 months — shows the trajectory, not just one snapshot."), ""),
            ("b", t("Οδηγίες  —  Αυτός ο οδηγός χρήσης στα Ελληνικά.",
                    "Info  —  This guide, in English."), ""),
            ("sp", "6", ""),
            ("tip", t("Το Κέντρο Ελέγχου ενημερώνεται αυτόματα όταν αλλάζετε κάτι στις Κινήσεις, στα Έργα ή στους Λογαριασμούς.",
                       "The Κέντρο Ελέγχου updates automatically whenever you change anything in Κινήσεις, Έργα, or Λογαριασμοί."), ""),
        ]),

        (t("ΠΩΣ ΝΑ ΠΡΟΣΘΕΣΕΤΕ ΜΙΑ ΚΙΝΗΣΗ", "HOW TO ADD A TRANSACTION"), "FF1868A8", [
            ("s", t("1.  Πηγαίνετε στην καρτέλα «Κινήσεις».", "1.  Go to the “Κινήσεις” tab."), ""),
            ("s", t("2.  Γράψτε στην επόμενη κενή γραμμή του Πίνακα — υπάρχουν ήδη ~1000 έτοιμες γραμμές, δεν χρειάζεται Tab ή προσθήκη νέας γραμμής.",
                    "2.  Type into the next empty row of the Table — there are already ~1000 rows ready, no need to Tab or add a new row."), ""),
            ("s", t("3.  Αν η επαφή δεν υπάρχει ακόμα, προσθέστε τη πρώτα στην καρτέλα «Επαφές» — μετά θα εμφανιστεί στη λίστα επιλογών.",
                    "3.  If the contact doesn't exist yet, add it first in the “Επαφές” tab — then it will appear in the dropdown."), ""),
            ("s", t("4.  Κλικάρετε το κίτρινο κελί στη στήλη «Έργο» και επιλέξτε από τη λίστα (η λίστα έρχεται από την καρτέλα «Έργα»).",
                    "4.  Click the yellow cell in the “Project” column and pick from the dropdown (the list comes from the “Έργα” tab)."), ""),
            ("s", t("5.  Γράψτε περιγραφή, ποσό, ΦΠΑ και παρακράτηση (αν υπάρχουν).",
                    "5.  Type description, amount, VAT, and withheld tax (if any)."), ""),
            ("s", t("6.  Κλικάρετε τα κελιά «Τύπος», «Πηγή» και «Κατάσταση» και επιλέξτε από τις λίστες.",
                    "6.  Click the “Type”, “Source”, and “Status” cells and pick from the dropdowns."), ""),
            ("s", t("7.  Στη στήλη «Πεδίο», επιλέξτε «Επιχειρηματικό» ή «Προσωπικό». Για προσωπικά, διαλέξτε και «Κατηγορία» (Σπίτι, Διατροφή, κ.λπ.).",
                    "7.  In the “Πεδίο” (Scope) column, pick “Επιχειρηματικό” (Business) or “Προσωπικό” (Personal). For personal, also pick a “Κατηγορία” (Housing, Groceries, etc.)."),
             t("Δείτε την ενότητα «Προσωπικά Έξοδα» πιο κάτω", "See the “Personal Expenses” section below")),
            ("sp", "4", ""),
            ("tip", t("Η στήλη «ΑΦΜ» και η στήλη «Μήνας» συμπληρώνονται αυτόματα με τύπο — μην τις αλλάζετε με το χέρι. Το φύλλο είναι προστατευμένο και αυτές οι στήλες είναι κλειδωμένες, οπότε ένα τυχαίο γράψιμο πάνω τους δεν θα σβήσει τον τύπο.",
                       "The “ΑΦΜ” column and the “Μήνας” column fill in automatically via formula — do not overwrite them by hand. The sheet is protected and these columns are locked, so an accidental overwrite won't lose the formula."), ""),
            ("b", t("Οι 4 τιμές της στήλης «Κατάσταση» είναι: Πληρωμένο, Εκκρεμεί, Σε αναμονή, και Προγραμματισμένο. Το «Προγραμματισμένο» είναι για μία πρόβλεψη που δεν είναι ακόμα δέσμευση (π.χ. εκτιμώμενο κόστος κατασκευής, προσωρινή αμοιβή δικηγόρου) — μετράει κανονικά στα Έργα, στην Ανάλυση και στο ΦΠΑ, αλλά ΔΕΝ μπαίνει στην πρόβλεψη ρευστού του Ταμείου, ώστε το «Πότε θα τρέξουμε χαμηλά σε ρευστό» να μην τρομάζει με ποσά που ίσως αλλάξουν.",
                    "The “Κατάσταση” (Status) column has 4 values: Paid, Upcoming, On Hold, and Scheduled. “Scheduled” is for a forecast line that isn't a firm commitment yet (e.g. an estimated construction cost, a provisional legal fee) — it counts normally on Έργα, Ανάλυση, and ΦΠΑ, but it does NOT feed into Ταμείο's cash forecast, so “When Do We Run Low On Cash” isn't spooked by amounts that might still change."), ""),
        ]),

        (t("ΠΩΣ ΝΑ ΚΑΤΑΧΩΡΗΣΕΤΕ ΠΡΟΣΩΠΙΚΟ ΕΞΟΔΟ/ΕΣΟΔΟ", "HOW TO ENTER A PERSONAL EXPENSE/INCOME"), "FF1868A8", [
            ("b", t("Τα προσωπικά έξοδα καταχωρούνται ΣΤΗΝ ΙΔΙΑ καρτέλα «Κινήσεις» με τα επιχειρηματικά — δεν υπάρχει ξεχωριστό φύλλο.",
                    "Personal expenses go in the SAME “Κινήσεις” tab as business ones — there is no separate sheet."), ""),
            ("s", t("1.  Συμπληρώστε Ημερομηνία, Περιγραφή, Τύπος (Έσοδο/Έξοδο), Ποσό, Κατάσταση κανονικά.",
                    "1.  Fill in Date, Description, Type (Income/Expense), Amount, Status as normal."), ""),
            ("s", t("2.  Στη στήλη «Πεδίο», επιλέξτε «Προσωπικό».", "2.  In the “Πεδίο” column, pick “Προσωπικό” (Personal)."), ""),
            ("s", t("3.  Στη στήλη «Κατηγορία», επιλέξτε μία από τη λίστα (Σπίτι/Ενοίκιο, Λογαριασμοί, Διατροφή, Μετακίνηση, Υγεία, Ασφάλειες, Εκπαίδευση, Διασκέδαση, Ρούχα, Λοιπά).",
                    "3.  In the “Κατηγορία” column, pick one from the list (Housing/Rent, Utilities, Groceries, Transport, Health, Insurance, Education, Entertainment, Clothing, Other)."), ""),
            ("s", t("4.  Το «Έργο» μένει κενό — τα προσωπικά δεν ανήκουν σε κανένα έργο.",
                    "4.  Leave “Έργο” (Project) blank — personal transactions don't belong to any project."), ""),
            ("sp", "4", ""),
            ("tip", t("Τα προσωπικά έξοδα ΜΠΑΙΝΟΥΝ στο Ταμείο και στην πρόβλεψη «Πότε θα τρέξουμε χαμηλά» (ίδιο πορτοφόλι με τα επιχειρηματικά), αλλά ΔΕΝ μπαίνουν στο ΦΠΑ ή στα σύνολα ΑΝΑ ΕΡΓΟ. Δείτε το σύνολό τους ανά κατηγορία στο Κέντρο Ελέγχου, ενότητα «ΠΡΟΣΩΠΙΚΑ ΕΞΟΔΑ».",
                       "Personal expenses DO count toward Ταμείο and the “When Do We Run Low On Cash” forecast (same pocket as business), but do NOT count toward VAT or per-project totals. See their category breakdown on Κέντρο Ελέγχου, “PERSONAL SPENDING” section."), ""),
        ]),

        (t("ΠΩΣ ΝΑ ΠΡΟΣΘΕΣΕΤΕ ΝΕΟ ΕΡΓΟ", "HOW TO ADD A NEW PROJECT"), "FF1868A8", [
            ("s", t("1.  Πηγαίνετε στην καρτέλα «Έργα».", "1.  Go to the “Έργα” tab."), ""),
            ("s", t("2.  Γράψτε το όνομα του νέου έργου σε μια κενή γραμμή της στήλης «Έργο» (υπάρχουν 12 θέσεις).",
                    "2.  Type the new project's name into an empty row of the “Έργο” column (there are 12 slots)."), ""),
            ("s", t("3.  Το έργο εμφανίζεται αμέσως στη λίστα επιλογών «Έργο» στις Κινήσεις. Επιλέξτε το εκεί για κάθε κίνηση που του ανήκει.",
                    "3.  The project immediately appears in the “Project” dropdown in Κινήσεις. Pick it there for every transaction that belongs to it."), t("Η ορθογραφία έχει σημασία!", "Spelling must match!")),
            ("s", t("4.  Τα σύνολα στην «Έργα» και στο Κέντρο Ελέγχου ενημερώνονται αυτόματα.",
                    "4.  The totals on “Έργα” and the Κέντρο Ελέγχου update automatically."), ""),
            ("sp", "4", ""),
            ("tip", t("Αν χρειαστείτε περισσότερα από 12 έργα, πείτε το — χρειάζεται λίγη δουλειά στις φόρμουλες του Κέντρου Ελέγχου.",
                       "If you ever need more than 12 projects, just ask — it takes a bit of formula surgery in the Κέντρο Ελέγχου."), ""),
        ]),

        (t("ΠΩΣ ΝΑ ΠΡΟΣΘΕΣΕΤΕ / ΕΝΗΜΕΡΩΣΕΤΕ ΛΟΓΑΡΙΑΣΜΟ", "HOW TO ADD / UPDATE AN ACCOUNT"), "FF1868A8", [
            ("s", t("1.  Πηγαίνετε στην καρτέλα «Λογαριασμοί».", "1.  Go to the “Λογαριασμοί” tab."), ""),
            ("s", t("2.  Για τους 8 βασικούς λογαριασμούς (τράπεζες, μετρητά, χρυσός, κρυπτό): κλικάρετε το κίτρινο κελί δίπλα στον λογαριασμό και γράψτε το νέο υπόλοιπο.",
                    "2.  For the 8 main accounts (banks, cash, gold, crypto): click the yellow cell next to the account and type the new balance."), ""),
            ("s", t("3.  Για νέο λογαριασμό: χρησιμοποιήστε μια κενή γραμμή στην ενότητα «ΕΞΤΡΑ ΛΟΓΑΡΙΑΣΜΟΙ» (10 θέσεις) ή «ΕΞΤΡΑ ΕΙΣΕΡΧΟΜΕΝΑ» (5 θέσεις) πιο κάτω στην ίδια καρτέλα.",
                    "3.  For a brand-new account: use an empty row in the “EXTRA ACCOUNTS” section (10 slots) or “EXTRA INCOMING” (5 slots) further down the same tab."), ""),
            ("s", t("4.  Γράψτε όνομα και υπόλοιπο — μπαίνει αυτόματα στα σύνολα.",
                    "4.  Type a name and balance — it's automatically included in the totals."), ""),
            ("s", t("5.  Για τα «Εισερχόμενα Κεφάλαια» (ιδιωτικά δάνεια): αλλάξτε και την κατάσταση.",
                    "5.  For “Incoming Funds” (private loans): also update the Status column."), f"{A_PEND} → {A_RECV}"),
            ("sp", "4", ""),
            ("tip", t("Ενημερώνετε τακτικά τα υπόλοιπα — το «Ελεύθερο Μετρητό» στο Κέντρο Ελέγχου εξαρτάται από ακριβή υπόλοιπα.",
                       "Update balances regularly — the Κέντρο Ελέγχου “Free Cash” figure depends on accurate balances."), ""),
        ]),

        (t("ΠΩΣ ΝΑ ΠΡΟΣΘΕΣΕΤΕ ΜΙΑ ΡΥΘΜΙΣΗ / ΠΑΓΙΟ / ΕΠΑΝΑΛΑΜΒΑΝΟΜΕΝΟ ΕΞΟΔΟ", "HOW TO ADD A RECURRING / INSTALLMENT EXPENSE"), "FF1868A8", [
            ("b", t("Για δόσεις, ρυθμίσεις εφορίας, ενοίκια, καθαρισμούς, μισθοδοσίες ή οτιδήποτε επαναλαμβάνεται με σταθερό ποσό — ΟΛΑ γίνονται εδώ, στις Κινήσεις, μία γραμμή, όχι μία γραμμή ανά επανάληψη.",
                    "For installments, tax settlements, rent, cleaning, payroll, or anything that repeats at a fixed amount — ALL of it happens here, in Κινήσεις, one row, not one row per occurrence."), ""),
            ("s", t("1.  Στις «Κινήσεις», πηγαίνετε σε μια κενή γραμμή και συμπληρώστε τα συνηθισμένα: Ημερομηνία (της 1ης επανάληψης), Επαφή, Έργο, Περιγραφή, Τύπος, Ποσό (ανά επανάληψη), Πηγή.",
                    "1.  In “Κινήσεις”, go to an empty row and fill in the usual fields: Date (of the 1st occurrence), Contact, Project, Description, Type, Amount (per occurrence), Source."), ""),
            ("s", t("2.  Βάλτε «Ναι» στη στήλη «Επαναλαμβανόμενο».", "2.  Set “Επαναλαμβανόμενο” (Recurring) to “Ναι” (Yes)."), ""),
            ("s", t("3.  Αν η ρύθμιση έχει συγκεκριμένο αριθμό δόσεων: γράψτε τον στη στήλη «Αριθμός Επαναλήψεων». Αν είναι αόριστη (π.χ. ενοίκιο, καθαρισμός — συνεχίζεται μέχρι νεότερης ειδοποίησης): αφήστε το κενό.",
                    "3.  If the plan has a fixed number of installments: type it in “Αριθμός Επαναλήψεων”. If it's indefinite (e.g. rent, cleaning — continues until cancelled): leave it blank."), ""),
            ("s", t("4.  Αν υπάρχει προκαταβολή ή άλλο εφάπαξ ποσό: καταχωρήστε το ΣΕ ΔΙΚΗ ΤΟΥ ξεχωριστή γραμμή, κανονική (όχι επαναλαμβανόμενη) — είναι απλώς μία ακόμα κίνηση με τη δική της ημερομηνία.",
                    "4.  If there's an upfront deposit or other one-off amount: enter it on its OWN separate row, as a normal (non-recurring) transaction — it's just another transaction with its own date."), ""),
            ("s", t("5.  Η στήλη «Επόμενη Δόση» δείχνει πάντα πότε πέφτει η επόμενη πληρωμή — υπολογίζεται από την 1η ημερομηνία + τις δόσεις που έχετε ήδη καταχωρήσει ως πληρωμένες.",
                    "5.  The “Επόμενη Δόση” (Next Installment) column always shows when the next payment falls — calculated from the 1st date plus however many installments you've already logged as paid."), ""),
            ("s", t("6.  Κάθε φορά που πληρώνετε μια δόση: γράψτε τη ΝΕΑ ημερομηνία στη στήλη «Ημ/νία Τελ. Πληρωμένης Δόσης». Αυτό είναι το ΜΟΝΟ πεδίο που ενημερώνετε χειροκίνητα σε μια επαναλαμβανόμενη γραμμή — ο αριθμός δόσεων υπολογίζεται μόνος του από την ημερομηνία, και η «Επόμενη Δόση» προχωράει αυτόματα έναν μήνα μπροστά μόλις το κάνετε.",
                    "6.  Every time you pay an installment: enter the NEW date in “Ημ/νία Τελ. Πληρωμένης Δόσης” (Date of Last Paid Installment). This is the ONLY field you update by hand on a recurring row — the installment count is derived from that date automatically, and “Επόμενη Δόση” automatically jumps one month forward the moment you do."), ""),
            ("s", t("7.  Αν ξεχάσετε να το ενημερώσετε και περάσει η ημερομηνία της δόσης, η γραμμή κοκκινίζει αυτόματα στις στήλες «Ληξιπρόθεσμες Δόσεις» / «Ληξιπρόθεσμο Ποσό» — και εμφανίζεται στο «Κέντρο Ελέγχου» (System Status γίνεται «ΑΠΑΙΤΕΙΤΑΙ ΕΝΕΡΓΕΙΑ») και στο «Ανάλυση» (ΑΝΑ ΕΡΓΟ) και στην «Έργα» (στήλη Ληξιπρόθεσμο).",
                    "7.  If you forget to update it and the installment's date passes, the row automatically turns red in “Ληξιπρόθεσμες Δόσεις” / “Ληξιπρόθεσμο Ποσό” — and it surfaces on the Κέντρο Ελέγχου (System Status flips to “ACTION REQUIRED”), on Ανάλυση (ΑΝΑ ΕΡΓΟ), and on Έργα (Ληξιπρόθεσμο column)."), ""),
            ("s", t("8.  Όλα τα υπόλοιπα — «Αναμενόμενες Δόσεις Μέχρι Σήμερα», «Πληρωμένο Μέχρι Σήμερα», «Υπόλοιπο Δέσμευσης» και «Ποσό Επόμ. 30/180/365 Ημ.» — υπολογίζονται μόνα τους βάσει της σημερινής ημερομηνίας και του βήματος 6.",
                    "8.  Everything else — “Expected Installments To Date”, “Paid To Date”, “Remaining Commitment”, and “Amount Due Next 30/180/365 Days” — calculates itself based on today's date and step 6."), ""),
            ("sp", "4", ""),
            ("tip", t("Χρησιμοποιήστε τη στήλη «Ημ/νία Λήξης Επανάληψης» για να ακυρώσετε μια αόριστη ρύθμιση όταν σταματήσει. Το «Υπόλοιπο Δέσμευσης», το «Ληξιπρόθεσμο Ποσό» και η πρόβλεψη 30/180/365 ημερών μπαίνουν αυτόματα στο Σύνολο Υποχρεώσεων του Κέντρου Ελέγχου και στα σύνολα του σχετικού Έργου.",
                       "Use the “Ημ/νία Λήξης Επανάληψης” column to cancel an indefinite plan when it stops. “Remaining Commitment”, “Overdue Amount”, and the 30/180/365-day forecast automatically feed into the Κέντρο Ελέγχου's Total Committed and into the relevant project's totals."), ""),
        ]),


        (t("\u0393\u03a1\u0397\u0393\u039f\u03a1\u0395\u03a3 \u03a3\u03a5\u039c\u0392\u039f\u03a5\u039b\u0395\u03a3", "QUICK TIPS"), "FF1868A8", [
            ("b", t("\u039a\u03af\u03c4\u03c1\u03b9\u03bd\u03b1/\u03ac\u03c3\u03c0\u03c1\u03b1 \u03ba\u03b5\u03bb\u03b9\u03ac \u2192 \u03b5\u03c0\u03b5\u03be\u03b5\u03c1\u03b3\u03ac\u03c3\u03b9\u03bc\u03b1.  \u0393\u03ba\u03c1\u03b9/\u03bc\u03c0\u03bb\u03b5 \u03ba\u03b5\u03bb\u03b9\u03ac \u2192 \u03c4\u03cd\u03c0\u03bf\u03b9, \u03ba\u03bb\u03b5\u03b9\u03b4\u03c9\u03bc\u03ad\u03bd\u03b1 \u2014 \u03b1\u03bd \u03c0\u03c1\u03bf\u03c3\u03c0\u03b1\u03b8\u03ae\u03c3\u03b5\u03c4\u03b5 \u03bd\u03b1 \u03b3\u03c1\u03ac\u03c8\u03b5\u03c4\u03b5 \u03b5\u03ba\u03b5\u03af, \u03c4\u03bf Excel \u03b8\u03b1 \u03c3\u03b1\u03c2 \u03b5\u03bc\u03c0\u03bf\u03b4\u03af\u03c3\u03b5\u03b9 (\u03c6\u03cd\u03bb\u03bb\u03bf \u03c0\u03c1\u03bf\u03c3\u03c4\u03b1\u03c4\u03b5\u03c5\u03bc\u03ad\u03bd\u03bf).",
                    "Yellow/white cells \u2192 editable.  Grey/blue cells \u2192 formulas, locked \u2014 if you try to type there, Excel will warn you (sheet is protected)."), ""),
            ("b", t("\u0391\u03c0\u03bf\u03b8\u03b7\u03ba\u03b5\u03cd\u03b5\u03c4\u03b5 \u03c0\u03ac\u03bd\u03c4\u03b1 \u03bc\u03b5\u03c4\u03ac \u03b1\u03c0\u03cc \u03b1\u03bb\u03bb\u03b1\u03b3\u03ad\u03c2 (Ctrl + S).",
                    "Always save the file after making changes (Ctrl + S)."), ""),
            ("b", t("\u039c\u03b7\u03bd \u03c0\u03c1\u03bf\u03c3\u03b8\u03ad\u03c4\u03b5\u03c4\u03b5 \u03ae \u03b4\u03b9\u03b1\u03b3\u03c1\u03ac\u03c8\u03b5\u03c4\u03b5 \u03c3\u03c4\u03ae\u03bb\u03b5\u03c2 \u2014 \u03bf\u03b9 \u03c4\u03cd\u03c0\u03bf\u03b9 \u03b5\u03be\u03b1\u03c1\u03c4\u03ce\u03bd\u03c4\u03b1\u03b9 \u03b1\u03c0\u03cc \u03c4\u03b9\u03c2 \u03b8\u03ad\u03c3\u03b5\u03b9\u03c2 \u03c4\u03c9\u03bd \u03c3\u03c4\u03b7\u03bb\u03ce\u03bd.",
                    "Do not add or delete columns \u2014 the formulas depend on the column positions."), ""),
            ("b", t("\u0391\u03bd \u03ba\u03ac\u03c0\u03bf\u03b9\u03bf \u03c3\u03cd\u03bd\u03bf\u03bb\u03bf \u03c6\u03b1\u03af\u03bd\u03b5\u03c4\u03b1\u03b9 \u03bb\u03ac\u03b8\u03bf\u03c2, \u03b5\u03bb\u03ad\u03b3\u03be\u03c4\u03b5 \u03c4\u03b7\u03bd \u03bf\u03c1\u03b8\u03bf\u03b3\u03c1\u03b1\u03c6\u03af\u03b1 \u03c4\u03bf\u03c5 \u03bf\u03bd\u03cc\u03bc\u03b1\u03c4\u03bf\u03c2 \u03ad\u03c1\u03b3\u03bf\u03c5.",
                    "If a total looks wrong, check that the Project name spelling matches exactly."), ""),
            ("b", t("\u03a3\u03c4\u03b9\u03c2 \u039a\u03b9\u03bd\u03ae\u03c3\u03b5\u03b9\u03c2, \u03bf\u03b9 \u03c3\u03c4\u03ae\u03bb\u03b5\u03c2 \u03bc\u03b5 \u03c4\u03cd\u03c0\u03bf\u03c5\u03c2 (\u03b3\u03ba\u03c1\u03b9) \u03b4\u03b5\u03bd \u03b5\u03af\u03bd\u03b1\u03b9 \u03ba\u03bb\u03b5\u03b9\u03b4\u03c9\u03bc\u03ad\u03bd\u03b5\u03c2 \u03c0\u03bb\u03ad\u03bf\u03bd \u2014 \u03c4\u03bf \u03c6\u03cd\u03bb\u03bb\u03bf \u03b4\u03b5\u03bd \u03b5\u03af\u03bd\u03b1\u03b9 \u03c0\u03c1\u03bf\u03c3\u03c4\u03b1\u03c4\u03b5\u03c5\u03bc\u03ad\u03bd\u03bf, \u03ce\u03c3\u03c4\u03b5 \u03c4\u03bf Tab \u03bd\u03b1 \u03bb\u03b5\u03b9\u03c4\u03bf\u03c5\u03c1\u03b3\u03b5\u03af \u03ba\u03b1\u03bd\u03bf\u03bd\u03b9\u03ba\u03ac. \u03a0\u03c1\u03bf\u03c3\u03ad\u03be\u03c4\u03b5 \u03bd\u03b1 \u03bc\u03b7\u03bd \u03b3\u03c1\u03ac\u03c8\u03b5\u03c4\u03b5 \u03c0\u03ac\u03bd\u03c9 \u03c4\u03bf\u03c5\u03c2.",
                    "On \u039a\u03b9\u03bd\u03ae\u03c3\u03b5\u03b9\u03c2, formula columns (grey) are no longer locked \u2014 the sheet isn't protected, so Tab works normally. Take care not to type over them."), ""),
            ("b", t("\u0391\u03bd\u03c4\u03af\u03b3\u03c1\u03b1\u03c6\u03b5 \u03c4\u03bf \u03b1\u03c1\u03c7\u03b5\u03af\u03bf \u03c4\u03b1\u03ba\u03c4\u03b9\u03ba\u03ac (USB \u03ae cloud).",
                    "Back up the file regularly (copy to a USB stick or cloud folder)."), ""),
        ]),

        (t("\u039c\u0397\u039d\u0399\u0391\u0399\u039f \u039a\u039b\u0395\u0399\u03a3\u0399\u039c\u039f", "MONTHLY CLOSING"), "FF1868A8", [
            ("b", t("\u0388\u03bd\u03b1\u03c2 \u03bc\u03b9\u03ba\u03c1\u03cc\u03c2 \u03ad\u03bb\u03b5\u03b3\u03c7\u03bf\u03c2 \u03c3\u03c4\u03bf \u03c4\u03ad\u03bb\u03bf\u03c2 \u03ba\u03ac\u03b8\u03b5 \u03bc\u03ae\u03bd\u03b1 \u2014 \u03bc\u03b5\u03c4\u03b1\u03c4\u03c1\u03ad\u03c0\u03b5\u03b9 \u03c4\u03bf \u03b1\u03c1\u03c7\u03b5\u03af\u03bf \u03b1\u03c0\u03cc \u03b1\u03c0\u03bb\u03ae \u03b1\u03c0\u03bf\u03b8\u03ae\u03ba\u03b7 \u03b4\u03b5\u03b4\u03bf\u03bc\u03ad\u03bd\u03c9\u03bd \u03c3\u03b5 \u03bc\u03b9\u03b1 \u03b4\u03b9\u03b1\u03b4\u03b9\u03ba\u03b1\u03c3\u03af\u03b1 \u03c0\u03bf\u03c5 \u03ba\u03c1\u03b1\u03c4\u03ac\u03b5\u03b9 \u03c4\u03b1 \u03bd\u03bf\u03cd\u03bc\u03b5\u03c1\u03b1 \u03b1\u03be\u03b9\u03cc\u03c0\u03b9\u03c3\u03c4\u03b1.",
                    "A short end-of-month routine \u2014 turns the file from a data store into a process that keeps the numbers trustworthy."), ""),
            ("s", t("1.  \u0395\u03bd\u03b7\u03bc\u03b5\u03c1\u03ce\u03c3\u03c4\u03b5 \u03c4\u03b1 \u03c5\u03c0\u03cc\u03bb\u03bf\u03b9\u03c0\u03b1 \u03c3\u03c4\u03bf \u00ab\u039b\u03bf\u03b3\u03b1\u03c1\u03b9\u03b1\u03c3\u03bc\u03bf\u03af\u00bb (\u03c4\u03c1\u03ac\u03c0\u03b5\u03b6\u03b5\u03c2, \u03bc\u03b5\u03c4\u03c1\u03b7\u03c4\u03ac, \u03c7\u03c1\u03c5\u03c3\u03cc\u03c2/\u03ba\u03c1\u03c5\u03c0\u03c4\u03cc) \u03bc\u03b5 \u03c4\u03b1 \u03c0\u03c1\u03b1\u03b3\u03bc\u03b1\u03c4\u03b9\u03ba\u03ac \u03c4\u03c1\u03ad\u03c7\u03bf\u03bd\u03c4\u03b1 \u03c0\u03bf\u03c3\u03ac.",
                    "1.  Update the balances on \u201c\u039b\u03bf\u03b3\u03b1\u03c1\u03b9\u03b1\u03c3\u03bc\u03bf\u03af\u201d (banks, cash, gold/crypto) with the real current amounts."), ""),
            ("s", t("2.  \u03a3\u03c4\u03b9\u03c2 \u00ab\u039a\u03b9\u03bd\u03ae\u03c3\u03b5\u03b9\u03c2\u00bb, \u03b5\u03bb\u03ad\u03b3\u03be\u03c4\u03b5 \u03ba\u03ac\u03b8\u03b5 \u03b5\u03c0\u03b1\u03bd\u03b1\u03bb\u03b1\u03bc\u03b2\u03b1\u03bd\u03cc\u03bc\u03b5\u03bd\u03b7 \u03b3\u03c1\u03b1\u03bc\u03bc\u03ae (\u00ab\u0395\u03c0\u03b1\u03bd\u03b1\u03bb\u03b1\u03bc\u03b2\u03b1\u03bd\u03cc\u03bc\u03b5\u03bd\u03bf\u00bb = \u039d\u03b1\u03b9) \u03ba\u03b1\u03b9 \u03b5\u03bd\u03b7\u03bc\u03b5\u03c1\u03ce\u03c3\u03c4\u03b5 \u00ab\u03a0\u03c1\u03b1\u03b3\u03bc\u03b1\u03c4\u03b9\u03ba\u03ad\u03c2 \u0394\u03cc\u03c3\u03b5\u03b9\u03c2 \u03a0\u03bb\u03b7\u03c1\u03c9\u03bc\u03ad\u03bd\u03b5\u03c2\u00bb \u03b3\u03b9\u03b1 \u03cc,\u03c4\u03b9 \u03c0\u03bb\u03b7\u03c1\u03ce\u03b8\u03b7\u03ba\u03b5 \u03c4\u03bf\u03bd \u03bc\u03ae\u03bd\u03b1.",
                    "2.  On \u201c\u039a\u03b9\u03bd\u03ae\u03c3\u03b5\u03b9\u03c2\u201d, go through every recurring row (\u201c\u0395\u03c0\u03b1\u03bd\u03b1\u03bb\u03b1\u03bc\u03b2\u03b1\u03bd\u03cc\u03bc\u03b5\u03bd\u03bf\u201d = Yes) and update \u201c\u03a0\u03c1\u03b1\u03b3\u03bc\u03b1\u03c4\u03b9\u03ba\u03ad\u03c2 \u0394\u03cc\u03c3\u03b5\u03b9\u03c2 \u03a0\u03bb\u03b7\u03c1\u03c9\u03bc\u03ad\u03bd\u03b5\u03c2\u201d for whatever was paid this month."), ""),
            ("s", t("3.  \u0395\u03bb\u03ad\u03b3\u03be\u03c4\u03b5 \u03c4\u03bf \u00ab\u039a\u03ad\u03bd\u03c4\u03c1\u03bf \u0395\u03bb\u03ad\u03b3\u03c7\u03bf\u03c5\u00bb \u03b3\u03b9\u03b1 \u03ba\u03cc\u03ba\u03ba\u03b9\u03bd\u03b5\u03c2/\u03c0\u03bf\u03c1\u03c4\u03bf\u03ba\u03b1\u03bb\u03af \u03b5\u03b9\u03b4\u03bf\u03c0\u03bf\u03b9\u03ae\u03c3\u03b5\u03b9\u03c2 (\u03bb\u03b7\u03be\u03b9\u03c0\u03c1\u03cc\u03b8\u03b5\u03c3\u03bc\u03b5\u03c2 \u03b4\u03cc\u03c3\u03b5\u03b9\u03c2, \u03c7\u03b1\u03bc\u03b7\u03bb\u03cc \u03c4\u03b1\u03bc\u03b5\u03af\u03bf) \u03ba\u03b1\u03b9 \u03b4\u03b9\u03bf\u03c1\u03b8\u03ce\u03c3\u03c4\u03b5 \u03cc,\u03c4\u03b9 \u03c7\u03c1\u03b5\u03b9\u03ac\u03b6\u03b5\u03c4\u03b1\u03b9.",
                    "3.  Check \u201c\u039a\u03ad\u03bd\u03c4\u03c1\u03bf \u0395\u03bb\u03ad\u03b3\u03c7\u03bf\u03c5\u201d for red/amber alerts (overdue installments, low cash) and address whatever needs it."), ""),
            ("s", t("4.  \u03a3\u03c4\u03bf \u00ab\u03a6\u03a0\u0391\u00bb, \u03c5\u03c0\u03bf\u03b2\u03ac\u03bb\u03b5\u03c4\u03b5 \u03c4\u03b7 \u03b4\u03ae\u03bb\u03c9\u03c3\u03b7 \u03c4\u03b7\u03c2 \u03c0\u03c1\u03bf\u03b8\u03b5\u03c3\u03bc\u03af\u03b1\u03c2 \u03c0\u03bf\u03c5 \u03ad\u03ba\u03bb\u03b5\u03b9\u03c3\u03b5 \u03ba\u03b1\u03b9 \u03b1\u03bb\u03bb\u03ac\u03be\u03c4\u03b5 \u00ab\u039a\u03b1\u03c4\u03ac\u03c3\u03c4\u03b1\u03c3\u03b7 \u03a5\u03c0\u03bf\u03b2\u03bf\u03bb\u03ae\u03c2\u00bb \u03c3\u03b5 \u00ab\u03a5\u03c0\u03bf\u03b2\u03bb\u03ae\u03b8\u03b7\u03ba\u03b5\u00bb.",
                    "4.  On \u201c\u03a6\u03a0\u0391\u201d, file the return for whichever deadline just closed and flip \u201cFiling Status\u201d to \u201cFiled\u201d."), ""),
            ("s", t("5.  \u0391\u03bd\u03c4\u03b9\u03b3\u03c1\u03ac\u03c8\u03c4\u03b5 \u03c4\u03bf \u03b1\u03c1\u03c7\u03b5\u03af\u03bf (USB \u03ae cloud) \u03bc\u03b5 \u03b7\u03bc\u03b5\u03c1\u03bf\u03bc\u03b7\u03bd\u03af\u03b1 \u03c3\u03c4\u03bf \u03cc\u03bd\u03bf\u03bc\u03b1 \u2014 \u03c0.\u03c7. LA_Budgeting_2026-08.xlsx.",
                    "5.  Back up the file (USB or cloud) with the date in the filename \u2014 e.g. LA_Budgeting_2026-08.xlsx."), ""),
            ("sp", "4", ""),
            ("tip", t("\u0391\u03c5\u03c4\u03cc\u03c2 \u03bf \u03ad\u03bb\u03b5\u03b3\u03c7\u03bf\u03c2 \u03c0\u03b1\u03af\u03c1\u03bd\u03b5\u03b9 10-15 \u03bb\u03b5\u03c0\u03c4\u03ac \u03ba\u03b1\u03b9 \u03b5\u03af\u03bd\u03b1\u03b9 \u03bf \u03bb\u03cc\u03b3\u03bf\u03c2 \u03c0\u03bf\u03c5 \u03cc\u03bb\u03b1 \u03c4\u03b1 \u03ac\u03bb\u03bb\u03b1 \u03bd\u03bf\u03cd\u03bc\u03b5\u03c1\u03b1 \u03c3\u03c4\u03bf \u03b1\u03c1\u03c7\u03b5\u03af\u03bf \u03c0\u03b1\u03c1\u03b1\u03bc\u03ad\u03bd\u03bf\u03c5\u03bd \u03b1\u03be\u03b9\u03cc\u03c0\u03b9\u03c3\u03c4\u03b1 \u03bc\u03ae\u03bd\u03b1 \u03bc\u03b5 \u03c4\u03bf\u03bd \u03bc\u03ae\u03bd\u03b1.",
                       "This routine takes 10-15 minutes and is the reason every other number in the file stays trustworthy month after month."), ""),
        ]),
    ])

    # ══════════════════════════════════════════════════════════════════════════
    # TAB: ΚΑΘΗΜΕΡΙΝΑ  (monthly personal-spending rollup, grouped into the 6
    # groups ported from Επιχειρησιακό_Αρχείο_107.xlsx's own Καθημερινά
    # sheet — a LIVE rollup over Table_Kin, same single-ledger design as
    # every other monthly table in this workbook (9. Ταμείο, ΦΠΑ), NOT a
    # second manually-entered ledger. Personal expenses still get entered
    # in 2. Κινήσεις with Πεδίο=Προσωπικό, exactly as today. ──
    # ══════════════════════════════════════════════════════════════════════════
    ws = ws_daily
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 16
    for letter in "BCDEFG":
        ws.column_dimensions[letter].width = 16
    ws.column_dimensions["H"].width = 16
    ws.freeze_panes = "A5"

    ws.row_dimensions[1].height = 34
    ws.merge_cells("A1:H1")
    c = ws.cell(row=1, column=1, value="  " + t("ΚΑΘΗΜΕΡΙΝΑ  —  ΠΡΟΣΩΠΙΚΑ ΕΞΟΔΑ (ΜΗΝΙΑΙΑ ΣΥΝΟΨΗ)", "DAILY  —  PERSONAL SPENDING (MONTHLY SUMMARY)"))
    c.fill = F(DARK_BLUE); c.font = Fnt(size=14, bold=True, color=WHITE)
    c.alignment = Aln(h="left", v="center")
    ws.row_dimensions[2].height = 30
    ws.merge_cells("A2:H2")
    c2 = ws.cell(row=2, column=1,
        value="  " + t("Τελευταίοι 12 μήνες, ζωντανά από τις Κινήσεις (Πεδίο=Προσωπικό). Επιχειρησιακά (προς έλεγχο) και Χρυσός & Επενδύσεις ΔΕΝ προσμετρώνται εδώ — δεν είναι προσωπικά έξοδα (βλ. Μηνιάτικα για τις λεπτομέρειες κάθε κατηγορίας).",
                        "Trailing 12 months, live from Κινήσεις (Scope=Personal). Business-to-review and Gold & Investments are NOT counted here — they aren't personal spending (see Μηνιάτικα for per-category detail)."))
    c2.font = Fnt(size=9, italic=True, color="FF6B7280")
    c2.fill = F("FFF6F8FA"); c2.alignment = Aln(h="left", wrap=True)

    daily_headers = [t("Μήνας", "Month")] + PERSONAL_GROUPS + [t("ΣΥΝΟΛΟ ΜΗΝΑ", "MONTH TOTAL")]
    for ci, h in enumerate(daily_headers, 1):
        col_hdr(ws, 4, ci, h)

    DAILY_FIRST = 5
    DAILY_MONTHS = 12
    # reverse of PERSONAL_CATEGORY_GROUP — which categories roll into each
    # of the 6 groups, computed once here rather than hand-listed, so it
    # can never drift out of sync with the map defined near the top of
    # build_workbook().
    _group_cats = {g: [c for c, gg in PERSONAL_CATEGORY_GROUP.items() if gg == g] for g in PERSONAL_GROUPS}
    for mi in range(DAILY_MONTHS):
        row = DAILY_FIRST + mi
        off = mi - (DAILY_MONTHS - 1)   # oldest month first, current month last
        ws.row_dimensions[row].height = 18
        mc = ws.cell(row=row, column=1, value=f"=EDATE(TODAY(),{off})")
        mc.number_format = "mmm yyyy"; mc.fill = F(WHITE); mc.font = Fnt(size=10, color=DARK_GREY)
        mc.alignment = Aln(h="center")
        mref = f'YEAR(EDATE(TODAY(),{off}))&"-"&TEXT(MONTH(EDATE(TODAY(),{off})),"00")'
        for gi, grp in enumerate(PERSONAL_GROUPS):
            cats = _group_cats[grp]
            grp_formula = "+".join(
                f'({_recur_monthly(H_AMOUNT, TYPE_EXP, mref, scope=SCOPE_PERS, category_ref=chr(34)+cat+chr(34))})'
                for cat in cats) if cats else "0"
            gc = ws.cell(row=row, column=2 + gi, value=f"={grp_formula}")
            gc.number_format = EUR0; gc.fill = F(WHITE); gc.font = Fnt(size=10, color="FF374151")
            gc.alignment = Aln(h="right")
        last_col = 2 + len(PERSONAL_GROUPS)
        tot = ws.cell(row=row, column=last_col,
            value=f"=SUM({get_column_letter(2)}{row}:{get_column_letter(last_col-1)}{row})")
        tot.number_format = EUR0; tot.fill = F(LIGHT_GREY); tot.font = Fnt(size=10, bold=True, color=DARK_BLUE)
        tot.alignment = Aln(h="right")
    DAILY_LAST = DAILY_FIRST + DAILY_MONTHS - 1

    DAILY_TOTAL_ROW = DAILY_LAST + 2
    ws.row_dimensions[DAILY_TOTAL_ROW].height = 22
    lbl(ws, DAILY_TOTAL_ROW, 1, t("ΣΥΝΟΛΟ 12ΜΗΝΟΥ", "12-MONTH TOTAL"), bold=True, bg=LIGHT_BLUE)
    for gi in range(len(PERSONAL_GROUPS) + 1):
        col = 2 + gi
        letter = get_column_letter(col)
        sc = ws.cell(row=DAILY_TOTAL_ROW, column=col, value=f"=SUM({letter}{DAILY_FIRST}:{letter}{DAILY_LAST})")
        sc.number_format = EUR0; sc.fill = F(LIGHT_BLUE); sc.font = Fnt(size=10, bold=True, color=DARK_BLUE)
        sc.alignment = Aln(h="right")

    TIP_DAILY = DAILY_TOTAL_ROW + 2
    ws.merge_cells(start_row=TIP_DAILY, start_column=1, end_row=TIP_DAILY, end_column=8)
    tdc = ws.cell(row=TIP_DAILY, column=1,
        value="  " + t("Δεν καταχωρείτε τίποτα εδώ — αυτό είναι ένα ζωντανό σύνολο. Καταχωρήστε προσωπικά έξοδα στις Κινήσεις (Πεδίο=Προσωπικό, Κατηγορία=μία από τις 15 λεπτομερείς). Το Μηνιάτικα δείχνει τον προϋπολογισμό ανά ομάδα.",
                        "Nothing is entered here — this is a live rollup. Enter personal expenses on Κινήσεις (Scope=Personal, Category=one of the 15 detailed values). Μηνιάτικα shows the budget per group."))
    tdc.font = Fnt(size=9, italic=True, color="FF6B7280")
    tdc.fill = F("FFF6F8FA"); tdc.alignment = Aln(h="left", wrap=True)
    ws.row_dimensions[TIP_DAILY].height = 32
    protect_sheet(ws)

    # ══════════════════════════════════════════════════════════════════════════
    # TAB: ΜΗΝΙΑΤΙΚΑ  (budget-vs-actual per personal budget line, ported from
    # Επιχειρησιακό_Αρχείο_107.xlsx's own Μηνιάτικα sheet — its real line
    # items/amounts, read directly off that sheet. Structured like
    # 11. Παρακράτηση's flat table rather than 4. Προϋπολογισμοί's per-
    # project _bud_sec grid — this is a single flat list of personal budget
    # lines, not a per-project comparison. JUDGMENT CALL (flagged in the
    # session report): individual line items (e.g. "Μαμά" vs "Τάκης", both
    # under Άνθρωποι) don't map 1:1 to a Table_Kin Κατηγορία — the ledger
    # only tracks the 15 categories, not a sub-item description — so the
    # live "Πληρωμένα" figure is computed at the GROUP level (shared by
    # every line in that group) and cross-checked in the top summary
    # table, not faked as a fake per-line actual.) ──
    # ══════════════════════════════════════════════════════════════════════════
    ws = ws_monthly
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 22
    ws.column_dimensions["B"].width = 26
    for letter in "CDEF":
        ws.column_dimensions[letter].width = 16
    ws.freeze_panes = "A6"

    ws.row_dimensions[1].height = 34
    ws.merge_cells("A1:F1")
    c = ws.cell(row=1, column=1, value="  " + t("ΜΗΝΙΑΤΙΚΑ  —  Ο ΜΗΝΑΣ ΜΕ ΜΙΑ ΜΑΤΙΑ", "MONTHLY  —  THE MONTH AT A GLANCE"))
    c.fill = F(DARK_BLUE); c.font = Fnt(size=14, bold=True, color=WHITE)
    c.alignment = Aln(h="left", v="center")
    sheet_intro(ws, 2,
        t("Επιλέξτε μήνα πάνω και δείτε αμέσως πώς πάει ο προϋπολογισμός σας ανά κατηγορία — τα «Πληρωμένα» "
          "έρχονται ζωντανά από το φύλλο Καθημερινά, ομαδοποιημένα στις ίδιες κατηγορίες.",
          "Pick a month above to see your budget by category at a glance — the “Paid” figures come live "
          "from Καθημερινά, grouped into the same categories."),
        end_col="F")

    ws.row_dimensions[3].height = 18
    lbl(ws, 3, 1, t("Μήνας (ΕΕΕΕ-ΜΜ)", "Month (YYYY-MM)"), bg=LIGHT_GREY)
    MONTH_SEL_ROW = 3
    msc = ws.cell(row=MONTH_SEL_ROW, column=2, value="2026-09")
    msc.fill = F(YELLOW); msc.font = Fnt(size=10, bold=True, color=DARK_BLUE); msc.alignment = Aln(h="left")
    MONTH_SEL_REF = f"$B${MONTH_SEL_ROW}"

    sum_headers = [t("Ομάδα", "Group"), t("Προϋπολογισμός", "Budget"), t("Πληρωμένα", "Paid"),
                   t("Διαφορά", "Variance"), t("Πρόοδος", "Progress"), t("Σημείωση", "Note")]
    SUM_HDR = MONTH_SEL_ROW + 1
    for ci, h in enumerate(sum_headers, 1):
        col_hdr(ws, SUM_HDR, ci, h)
    SUM_FIRST = SUM_HDR + 1

    # the 17 real budget lines from Επιχειρησιακό_Αρχείο_107.xlsx's own
    # Μηνιάτικα sheet (rows 18-39 there), grouped exactly as that sheet
    # groups them. (line label, €/month, Πηγή, Σταθερό/Μεταβλητό, note)
    CASH_SRC, CARD_SRC = t("Μετρητά", "Cash"), t("Κάρτα", "Card")
    FIXED, VARIABLE = t("Σταθερό", "Fixed"), t("Μεταβλητό", "Variable")
    budget_lines_by_group = {
        PGRP_PEOPLE: [
            (t("Μαμά", "Mom"), 1500, CASH_SRC, VARIABLE, t("Μηνιαία υποστήριξη.", "Monthly support.")),
            (t("Τάκης", "Takis"), 500, CASH_SRC, FIXED, None),
        ],
        PGRP_EAT: [
            (t("Φαγητό & σούπερ μάρκετ (μετρητά)", "Food & supermarket (cash)"), 1200, CASH_SRC, VARIABLE, None),
            (t("Φαγητό & σούπερ μάρκετ (κάρτα)", "Food & supermarket (card)"), 800, CARD_SRC, VARIABLE, None),
            (t("Βενζίνη & μεταφορές", "Fuel & transport"), 300, CARD_SRC, VARIABLE, None),
        ],
        PGRP_HOME: [
            (t("Ασφάλειες", "Insurance"), 550, CASH_SRC, FIXED, None),
            (t("Λογαριασμοί & κοινόχρηστα", "Bills & common charges"), 450, CARD_SRC, FIXED,
             t("Δεν περιλαμβάνει ενοίκια — αυτά τρέχουν από τις Κινήσεις.", "Excludes rent — that runs from Κινήσεις.")),
            (t("Συνδρομές & ψηφιακά", "Subscriptions & digital"), 205, CARD_SRC, FIXED, None),
            (t("Tarif", "Tarif"), 50, CASH_SRC, FIXED, None),
        ],
        PGRP_SELF: [
            (t("Ειρήνη — sessions", "Eirini — sessions"), 300, CASH_SRC, FIXED, None),
            (t("Ψυχαγωγία & έξοδοι", "Entertainment & outings"), 400, CARD_SRC, VARIABLE, None),
            (t("Υγεία & φαρμακείο", "Health & pharmacy"), 100, CARD_SRC, VARIABLE, None),
            (t("Κουρείο", "Barber"), 50, CASH_SRC, FIXED, None),
            (t("Gym", "Gym"), 0, CASH_SRC, FIXED, t("Προπληρωμένο για έναν χρόνο.", "Prepaid for a year.")),
        ],
        PGRP_MISC: [
            (t("Απρόβλεπτα", "Unforeseen"), 895, CASH_SRC, VARIABLE, t("Μαξιλάρι για μέσο όρο ομάδας.", "Buffer for the group average.")),
        ],
        PGRP_PETSHOME: [
            (t("Household & κατοικίδια", "Household & pets"), 200, CASH_SRC, VARIABLE, None),
        ],
    }

    dv_pmonth_src = DataValidation(type="list", formula1=f'"{CASH_SRC},{CARD_SRC}"', allow_blank=True, showDropDown=False)
    ws.add_data_validation(dv_pmonth_src)
    dv_pmonth_fix = DataValidation(type="list", formula1=f'"{FIXED},{VARIABLE}"', allow_blank=True, showDropDown=False)
    ws.add_data_validation(dv_pmonth_fix)

    group_budget_rows = {}   # group -> (first, last) line-item row, for the summary SUM below
    summary_rows = {}
    for gi, grp in enumerate(PERSONAL_GROUPS):
        srow = SUM_FIRST + gi
        summary_rows[grp] = srow
        ws.row_dimensions[srow].height = 18
        lbl(ws, srow, 1, grp, bold=True, bg=LIGHT_BLUE)
    SUM_LAST = SUM_FIRST + len(PERSONAL_GROUPS) - 1
    SUM_TOTAL_ROW = SUM_LAST + 1
    ws.row_dimensions[SUM_TOTAL_ROW].height = 20
    lbl(ws, SUM_TOTAL_ROW, 1, t("ΣΥΝΟΛΟ ΜΗΝΑ", "MONTH TOTAL"), bold=True, bg=LIGHT_BLUE)
    for ci in (2, 3, 4):
        letter = get_column_letter(ci)
        sc = ws.cell(row=SUM_TOTAL_ROW, column=ci, value=f"=SUM({letter}{SUM_FIRST}:{letter}{SUM_LAST})")
        sc.number_format = EUR0; sc.fill = F(LIGHT_BLUE); sc.font = Fnt(size=10, bold=True, color=DARK_BLUE)
        sc.alignment = Aln(h="right")

    LINES_HDR = SUM_TOTAL_ROW + 3
    ws.row_dimensions[LINES_HDR - 1].height = 22
    ws.merge_cells(start_row=LINES_HDR - 1, start_column=1, end_row=LINES_HDR - 1, end_column=6)
    lh = ws.cell(row=LINES_HDR - 1, column=1, value="  " + t("ΑΝΑΛΥΣΗ ΠΡΟΫΠΟΛΟΓΙΣΜΟΥ", "BUDGET BREAKDOWN"))
    lh.fill = F(LIGHT_GREY); lh.font = Fnt(size=10, bold=True, color=DARK_BLUE); lh.alignment = Aln(h="left", v="center")
    line_headers = [t("Ομάδα", "Group"), t("Γραμμή", "Line"), t("€ / μήνα", "€ / month"),
                    t("Πηγή", "Source"), t("Σταθερό/Μεταβλητό", "Fixed/Variable"), t("Σημειώσεις", "Notes")]
    for ci, h in enumerate(line_headers, 1):
        col_hdr(ws, LINES_HDR, ci, h)
    row = LINES_HDR + 1
    for grp in PERSONAL_GROUPS:
        lines = budget_lines_by_group.get(grp, [])
        gfirst = row
        for label, amt, src, fixvar, note in lines:
            ws.row_dimensions[row].height = 16 if not note else 15 * wrap_lines(note, 20) + 6
            gc = ws.cell(row=row, column=1, value=grp)
            gc.fill = F(LIGHT_GREY); gc.font = Fnt(size=9, italic=True, color="FF6B7280"); gc.alignment = Aln(h="left", v="center")
            lc = ws.cell(row=row, column=2, value=label)
            lc.fill = F(WHITE); lc.font = Fnt(size=10); lc.alignment = Aln(h="left", v="center")
            ac = inp(ws, row, 3, amt, EUR0)
            sc2 = inp(ws, row, 4, src, align_h="left")
            fc = inp(ws, row, 5, fixvar, align_h="left")
            nc = ws.cell(row=row, column=6, value=note)
            nc.fill = F(WHITE); nc.font = Fnt(size=9, italic=True, color="FF6B7280"); nc.alignment = Aln(h="left", v="center", wrap=True)
            row += 1
        glast = row - 1
        group_budget_rows[grp] = (gfirst, glast)
        row += 0
    LINES_LAST = row - 1
    dv_pmonth_src.sqref = f"D{LINES_HDR+1}:D{LINES_LAST}"
    dv_pmonth_fix.sqref = f"E{LINES_HDR+1}:E{LINES_LAST}"

    # now fill in the summary table's live formulas — needs the line-item
    # ranges above to exist first.
    _group_cats2 = {g: [c for c, gg in PERSONAL_CATEGORY_GROUP.items() if gg == g] for g in PERSONAL_GROUPS}
    for grp in PERSONAL_GROUPS:
        srow = summary_rows[grp]
        gfirst, glast = group_budget_rows[grp]
        bud = ws.cell(row=srow, column=2, value=f"=SUM(C{gfirst}:C{glast})")
        bud.number_format = EUR0; bud.fill = F(WHITE); bud.font = Fnt(size=10, color="FF374151"); bud.alignment = Aln(h="right")
        cats = _group_cats2[grp]
        paid_formula = "+".join(
            f'({_recur_monthly(H_AMOUNT, TYPE_EXP, MONTH_SEL_REF, scope=SCOPE_PERS, category_ref=chr(34)+cat+chr(34))})'
            for cat in cats) if cats else "0"
        paid = ws.cell(row=srow, column=3, value=f"={paid_formula}")
        paid.number_format = EUR0; paid.fill = F(WHITE); paid.font = Fnt(size=10, color=GREEN_FG); paid.alignment = Aln(h="right")
        diff = ws.cell(row=srow, column=4, value=f"=B{srow}-C{srow}")
        diff.number_format = EUR0_NEG; diff.fill = F(WHITE); diff.font = Fnt(size=10, color="FF965800"); diff.alignment = Aln(h="right")
        prog = ws.cell(row=srow, column=5, value=f'=IF(B{srow}=0,"—",C{srow}/B{srow})')
        prog.number_format = "0%"; prog.fill = F(WHITE); prog.font = Fnt(size=10); prog.alignment = Aln(h="right")
        note_c = ws.cell(row=srow, column=6,
            value=f'="{t("Πληρωμένα του ομάδας, όχι της γραμμής","Group-level paid, not per line")}"')
        note_c.font = Fnt(size=8, italic=True, color="FF6B7280"); note_c.fill = F(WHITE); note_c.alignment = Aln(h="left")

    ws.conditional_formatting.add(f"D{SUM_FIRST}:D{SUM_LAST}",
        CellIsRule(operator="lessThan", formula=["0"],
                   fill=PatternFill(start_color=RED_BG, end_color=RED_BG, fill_type="solid"),
                   font=Font(name="Calibri", size=10, bold=True, color=RED_FG)))

    TIP_MONTHLY = LINES_LAST + 2
    ws.merge_cells(start_row=TIP_MONTHLY, start_column=1, end_row=TIP_MONTHLY, end_column=6)
    tmc = ws.cell(row=TIP_MONTHLY, column=1,
        value="  " + t("Τα «€ / μήνα» παρακάτω είναι κίτρινα — αλλάξτε τα ελεύθερα. Το «Πληρωμένα» στον πίνακα σύνοψης είναι ζωντανό από τις Κινήσεις, στο επίπεδο ΟΜΑΔΑΣ (όχι ανά γραμμή — η κατηγοριοποίηση Κινήσεων δεν φτάνει σε επίπεδο ατόμου/γραμμής). Αλλάξτε τον μήνα στο πάνω κελί για να δείτε άλλον μήνα.",
                        "The “€ / month” cells below are yellow — edit freely. “Paid” in the summary table is live from Κινήσεις, at GROUP level (not per line — Κινήσεις categorization doesn't go down to the person/line level). Change the month in the cell above to view a different month."))
    tmc.font = Fnt(size=9, italic=True, color="FF6B7280")
    tmc.fill = F("FFF6F8FA"); tmc.alignment = Aln(h="left", wrap=True)
    ws.row_dimensions[TIP_MONTHLY].height = 40
    protect_sheet(ws)

    # ══════════════════════════════════════════════════════════════════════════
    # TAB: ΦΟΡΟΛΟΓΙΚΟ & ΔΙΟΙΚΗΤΙΚΟ ΗΜΕΡΟΛΟΓΙΟ  —  one place that answers "what
    # deadline is coming up next", pulling the two already-tracked monthly
    # obligations (ΦΠΑ, Παρακράτηση) live off their own sheets, plus the
    # periodic/annual obligations (ΕΝΦΙΑ, ΕΦΚΑ, ΓΕΜΗ, insurance/license
    # renewals) that today live nowhere in the workbook — filled in as a
    # template the user completes once with real dates, same "πρότυπο"
    # pattern as 18. Απόδοση Εταίρων's waterfall assumptions, since exact
    # Greek deadlines shift year to year and shouldn't be guessed here. ──
    # ══════════════════════════════════════════════════════════════════════════
    ws = ws_taxcal
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 32
    ws.column_dimensions["B"].width = 14
    ws.column_dimensions["C"].width = 18
    ws.column_dimensions["D"].width = 16
    ws.column_dimensions["E"].width = 16
    ws.column_dimensions["F"].width = 18
    ws.column_dimensions["G"].width = 36
    ws.freeze_panes = "A4"

    ws.row_dimensions[1].height = 34
    ws.merge_cells("A1:G1")
    c = ws.cell(row=1, column=1, value="  " + t("ΦΟΡΟΛΟΓΙΚΟ & ΔΙΟΙΚΗΤΙΚΟ ΗΜΕΡΟΛΟΓΙΟ", "TAX & ADMIN CALENDAR"))
    c.fill = F(DARK_BLUE); c.font = Fnt(size=14, bold=True, color=WHITE)
    c.alignment = Aln(h="left", v="center")
    sheet_intro(ws, 2,
        t("Οι δύο πρώτες γραμμές έρχονται ζωντανά από τα φύλλα ΦΠΑ και Παρακράτηση — δείχνουν την πιο επείγουσα "
          "εκκρεμότητα σε καθένα. Από κάτω, οι περιοδικές/ετήσιες υποχρεώσεις (ΕΝΦΙΑ, ΕΦΚΑ, ΓΕΜΗ, ασφαλιστήρια, "
          "άδειες) είναι πρότυπο — συμπληρώστε τις πραγματικές προθεσμίες με τον λογιστή σας μία φορά, και η "
          "γραμμή θα κοκκινίζει μόνη της όταν περάσει η προθεσμία της χωρίς να έχει σημειωθεί «Ολοκληρώθηκε».",
          "The first two rows come live from the ΦΠΑ and Παρακράτηση sheets — each shows its most urgent open "
          "item. Below that, the periodic/annual obligations (property tax, social security, registry fee, "
          "insurance, licenses) are a template — fill in the real deadlines with your accountant once, and each "
          "row turns red on its own once its deadline passes without being marked “Completed”."),
        end_col="G")

    tc_headers = [t("Υποχρέωση", "Obligation"), t("Συχνότητα", "Frequency"), t("Επόμενη Προθεσμία", "Next Deadline"),
                  t("Εκτιμώμενο Ποσό", "Estimated Amount"), t("Κατάσταση", "Status"),
                  t("Ημ/νία Ολοκλήρωσης", "Completion Date"), t("Σημειώσεις", "Notes")]
    for ci, h in enumerate(tc_headers, 1):
        col_hdr(ws, 3, ci, h)

    OBL_DONE = t("Ολοκληρώθηκε", "Completed")

    # ── live rows — the OLDEST not-yet-filed deadline in each sheet's
    # 24-month range (MINIFS over dates whose status isn't the "filed"
    # value), not a fixed "this month" lookup — so a deadline that got
    # skipped a few months back still surfaces here instead of being
    # silently buried under newer rows. ──
    row = 4
    ws.row_dimensions[row].height = 18
    lc = ws.cell(row=row, column=1, value=t("Επόμενη Δήλωση ΦΠΑ", "Next VAT Return"))
    lc.fill = F(LIGHT_BLUE); lc.font = Fnt(size=10, bold=True, color=DARK_BLUE); lc.alignment = Aln(h="left", v="center")
    fq = ws.cell(row=row, column=2, value=t("Μηνιαία", "Monthly"))
    fq.fill = F(LIGHT_BLUE); fq.alignment = Aln(h="center"); fq.font = Fnt(size=10, color=DARK_BLUE)
    vat_deadline_rng = f"'10. ΦΠΑ'!$E${VAT_FIRST}:$E${VAT_LAST}"
    vat_status_rng = f"'10. ΦΠΑ'!$F${VAT_FIRST}:$F${VAT_LAST}"
    vat_pay_rng = f"'10. ΦΠΑ'!$J${VAT_FIRST}:$J${VAT_LAST}"
    dl = ws.cell(row=row, column=3, value=f'=IFERROR(MINIFS({vat_deadline_rng},{vat_status_rng},"<>{VAT_FILED}"),"—")')
    dl.number_format = "DD/MM/YYYY"; dl.alignment = Aln(h="center"); dl.fill = F(LIGHT_BLUE); dl.font = Fnt(size=10, bold=True, color=DARK_BLUE)
    amt = ws.cell(row=row, column=4, value=f'=IFERROR(INDEX({vat_pay_rng},MATCH(C{row},{vat_deadline_rng},0)),"—")')
    amt.number_format = EUR0; amt.alignment = Aln(h="right"); amt.fill = F(LIGHT_BLUE); amt.font = Fnt(size=10, color=DARK_BLUE)
    st = ws.cell(row=row, column=5, value=f'=IFERROR(INDEX({vat_status_rng},MATCH(C{row},{vat_deadline_rng},0)),"—")')
    st.alignment = Aln(h="center"); st.fill = F(LIGHT_BLUE); st.font = Fnt(size=10, color=DARK_BLUE)
    ws.cell(row=row, column=6).fill = F(LIGHT_BLUE)
    nt = ws.cell(row=row, column=7, value=t("Ζωντανό από το φύλλο ΦΠΑ — ενημερώστε την Κατάσταση εκεί.",
                                             "Live from the ΦΠΑ sheet — update Status there."))
    nt.font = Fnt(size=9, italic=True, color="FF6B7280"); nt.fill = F(LIGHT_BLUE); nt.alignment = Aln(h="left", v="center", wrap=True)
    VAT_LIVE_ROW = row

    row = 5
    ws.row_dimensions[row].height = 18
    lc = ws.cell(row=row, column=1, value=t("Επόμενη Απόδοση Παρακράτησης", "Next Withholding Remittance"))
    lc.fill = F(LIGHT_BLUE); lc.font = Fnt(size=10, bold=True, color=DARK_BLUE); lc.alignment = Aln(h="left", v="center")
    fq = ws.cell(row=row, column=2, value=t("Μηνιαία", "Monthly"))
    fq.fill = F(LIGHT_BLUE); fq.alignment = Aln(h="center"); fq.font = Fnt(size=10, color=DARK_BLUE)
    wh_deadline_rng = f"'11. Παρακράτηση'!$C${WH_FIRST}:$C${WH_LAST}"
    wh_status_rng = f"'11. Παρακράτηση'!$D${WH_FIRST}:$D${WH_LAST}"
    wh_pay_rng = f"'11. Παρακράτηση'!$E${WH_FIRST}:$E${WH_LAST}"
    dl = ws.cell(row=row, column=3, value=f'=IFERROR(MINIFS({wh_deadline_rng},{wh_status_rng},"<>{VAT_FILED}"),"—")')
    dl.number_format = "DD/MM/YYYY"; dl.alignment = Aln(h="center"); dl.fill = F(LIGHT_BLUE); dl.font = Fnt(size=10, bold=True, color=DARK_BLUE)
    amt = ws.cell(row=row, column=4, value=f'=IFERROR(INDEX({wh_pay_rng},MATCH(C{row},{wh_deadline_rng},0)),"—")')
    amt.number_format = EUR0; amt.alignment = Aln(h="right"); amt.fill = F(LIGHT_BLUE); amt.font = Fnt(size=10, color=DARK_BLUE)
    st = ws.cell(row=row, column=5, value=f'=IFERROR(INDEX({wh_status_rng},MATCH(C{row},{wh_deadline_rng},0)),"—")')
    st.alignment = Aln(h="center"); st.fill = F(LIGHT_BLUE); st.font = Fnt(size=10, color=DARK_BLUE)
    ws.cell(row=row, column=6).fill = F(LIGHT_BLUE)
    nt = ws.cell(row=row, column=7, value=t("Ζωντανό από το φύλλο Παρακράτηση — ενημερώστε την Κατάσταση εκεί.",
                                             "Live from the Παρακράτηση sheet — update Status there."))
    nt.font = Fnt(size=9, italic=True, color="FF6B7280"); nt.fill = F(LIGHT_BLUE); nt.alignment = Aln(h="left", v="center", wrap=True)
    WH_LIVE_ROW = row

    ws.conditional_formatting.add(f"A{VAT_LIVE_ROW}:G{WH_LIVE_ROW}",
        FormulaRule(formula=[f'AND(ISNUMBER($C{VAT_LIVE_ROW}),$C{VAT_LIVE_ROW}<TODAY())'],
                    fill=PatternFill(start_color=RED_BG, end_color=RED_BG, fill_type="solid"),
                    font=Font(name="Calibri", size=10, bold=True, color=RED_FG)))

    # ── periodic / annual obligations — template rows; the user fills in
    # Επόμενη Προθεσμία / Εκτιμώμενο Ποσό once with their accountant. Exact
    # Greek tax deadlines shift year to year by ministerial decision, so
    # these are deliberately left blank rather than guessed. ──
    PER_HDR = WH_LIVE_ROW + 2
    ws.row_dimensions[PER_HDR - 1].height = 22
    ws.merge_cells(start_row=PER_HDR - 1, start_column=1, end_row=PER_HDR - 1, end_column=7)
    ph = ws.cell(row=PER_HDR - 1, column=1,
                 value="  " + t("ΠΕΡΙΟΔΙΚΕΣ & ΕΤΗΣΙΕΣ ΥΠΟΧΡΕΩΣΕΙΣ  —  ΠΡΟΤΥΠΟ", "PERIODIC & ANNUAL OBLIGATIONS  —  TEMPLATE"))
    ph.fill = F(LIGHT_GREY); ph.font = Fnt(size=10, bold=True, color=DARK_BLUE); ph.alignment = Aln(h="left", v="center")
    for ci, h in enumerate(tc_headers, 1):
        col_hdr(ws, PER_HDR, ci, h)

    periodic_items = [
        (t("ΕΝΦΙΑ", "Property Tax (ENFIA)"), t("Ετήσια (σε δόσεις)", "Annual (installments)"),
         t("Πληρώνεται σε έως 10 δόσεις — βάλτε την επόμενη δόση.", "Paid in up to 10 installments — enter the next one.")),
        (t("Ασφαλιστικές Εισφορές ΕΦΚΑ", "Social Security (EFKA)"), t("Μηνιαία", "Monthly"),
         t("Εισφορές εταίρων/διαχειριστών.", "Partner/manager contributions.")),
        (t("Ετήσιο Τέλος ΓΕΜΗ", "Annual Registry Fee (GEMI)"), t("Ετήσια", "Annual"), ""),
        (t("Δήλωση Φόρου Εισοδήματος Ν.Π.", "Corporate Income Tax Return"), t("Ετήσια", "Annual"),
         t("Η προθεσμία υποβολής μετατίθεται κάθε χρόνο — επιβεβαιώστε με τον λογιστή.",
           "Filing deadline shifts every year — confirm with the accountant.")),
        (t("Προκαταβολή Φόρου Εισοδήματος", "Income Tax Advance Payment"), t("Ετήσια", "Annual"), ""),
        (t("Δημοσίευση Ισολογισμού", "Financial Statements Publication"), t("Ετήσια", "Annual"), ""),
        (t("Ανανέωση Ασφαλιστηρίων Ακινήτων", "Property Insurance Renewal"), t("Ετήσια, ανά συμβόλαιο", "Annual, per policy"),
         t("Ένα ασφαλιστήριο ανά ακίνητο/έργο.", "One policy per property/project.")),
        (t("Ανανέωση Άδειας Λειτουργίας / Πυρασφάλειας", "Operating License / Fire Safety Renewal"), t("Πολυετής", "Multi-year"), ""),
        (t("Καταχώρηση Μισθωτηρίου (myPROPERTY)", "Lease Registration (myPROPERTY)"), t("Ανά ανανέωση σύμβασης", "Per lease renewal"), ""),
        (t("Δημοτικά Τέλη / ΤΑΠ", "Municipal Fees / TAP"), t("Ανά λογαριασμό ΔΕΗ", "Per utility bill"),
         t("Συνήθως ενσωματωμένα στον λογαριασμό ρεύματος.", "Usually bundled into the electricity bill.")),
    ]
    PER_FIRST = PER_HDR + 1
    for i, (label, freq, note) in enumerate(periodic_items):
        r = PER_FIRST + i
        ws.row_dimensions[r].height = 16 if not note else 15 * wrap_lines(note, 26) + 6
        lc = ws.cell(row=r, column=1, value=label)
        lc.fill = F(WHITE); lc.font = Fnt(size=10); lc.alignment = Aln(h="left", v="center", wrap=True)
        fcell = ws.cell(row=r, column=2, value=freq)
        fcell.fill = F(LIGHT_GREY); fcell.font = Fnt(size=9, italic=True, color="FF6B7280"); fcell.alignment = Aln(h="center", v="center", wrap=True)
        inp(ws, r, 3, None, "DD/MM/YYYY", align_h="center")
        inp(ws, r, 4, None, EUR0)
        st_cell = ws.cell(row=r, column=5)
        st_cell.fill = F(YELLOW); st_cell.alignment = Aln(h="center"); st_cell.protection = UNLOCKED
        inp(ws, r, 6, None, "DD/MM/YYYY", align_h="center")
        nc = ws.cell(row=r, column=7, value=note)
        nc.fill = F(WHITE); nc.font = Fnt(size=9, italic=True, color="FF6B7280"); nc.alignment = Aln(h="left", v="center", wrap=True)
    PER_LAST = PER_FIRST + len(periodic_items) - 1

    dv_obl_status = DataValidation(type="list", formula1=f'"{VAT_PENDING},{OBL_DONE}"', allow_blank=True, showDropDown=False)
    ws.add_data_validation(dv_obl_status); dv_obl_status.sqref = f"E{PER_FIRST}:E{PER_LAST}"

    ws.conditional_formatting.add(f"A{PER_FIRST}:G{PER_LAST}",
        FormulaRule(formula=[f'AND($C{PER_FIRST}<>"",$C{PER_FIRST}<TODAY(),$E{PER_FIRST}<>"{OBL_DONE}")'],
                    fill=PatternFill(start_color=RED_BG, end_color=RED_BG, fill_type="solid"),
                    font=Font(name="Calibri", size=10, bold=True, color=RED_FG)))

    TIP_TAXCAL = PER_LAST + 2
    ws.merge_cells(start_row=TIP_TAXCAL, start_column=1, end_row=TIP_TAXCAL, end_column=7)
    c = ws.cell(row=TIP_TAXCAL, column=1,
                value="  " + t("Συμπληρώστε «Επόμενη Προθεσμία» με τον λογιστή σας μία φορά ανά υποχρέωση — μια "
                                "γραμμή κοκκινίζει μόνη της αν περάσει η προθεσμία της χωρίς να έχει μπει "
                                "«Ολοκληρώθηκε». Οι δύο πάνω γραμμές (ΦΠΑ, Παρακράτηση) δεν χρειάζονται συμπλήρωση "
                                "εδώ — ενημερώνονται μόνες τους από τα δικά τους φύλλα.",
                          "Fill in “Next Deadline” with your accountant once per obligation — a row turns red on "
                          "its own if its deadline passes without “Completed” being set. The two rows above (VAT, "
                          "Withholding) need no input here — they update themselves from their own sheets."))
    c.font = Fnt(size=10, italic=True, color="FF6B7280")
    c.fill = F("FFF6F8FA"); c.alignment = Aln(h="left", wrap=True)
    ws.row_dimensions[TIP_TAXCAL].height = 32
    protect_sheet(ws, max_row=PER_LAST)

    # ══════════════════════════════════════════════════════════════════════════
    # TAB: ΡΕΥΣΤΟΤΗΤΑ 13 ΕΒΔΟΜΑΔΩΝ  —  a short-range, weekly companion to
    # 9. Ταμείο's 66-month forecast. Ταμείο buckets everything by calendar
    # MONTH, which can hide a specific week running dry even inside a month
    # that nets positive overall (rent due the 1st, a big invoice not
    # landing until the 25th). Fully live off Table_Kin — nothing to fill
    # in here. One known, deliberate limitation: a RECURRING row (rent, an
    # installment plan) only ever contributes its single NEXT due
    # instalment (Table_Kin[Επόμενη Δόση]) — a later instalment 2-3 months
    # out doesn't show yet. That's fine for a sheet meant to be reviewed and
    # rolled forward weekly: by the time a later instalment matters, it
    # WILL be "next" and will show up on its own. ──
    # ══════════════════════════════════════════════════════════════════════════
    ws = ws_liquidity
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 20
    for letter in "BC":
        ws.column_dimensions[letter].width = 13
    for letter in "DEFGH":
        ws.column_dimensions[letter].width = 16
    ws.freeze_panes = "A4"

    ws.row_dimensions[1].height = 34
    ws.merge_cells("A1:H1")
    c = ws.cell(row=1, column=1, value="  " + t("ΡΕΥΣΤΟΤΗΤΑ 13 ΕΒΔΟΜΑΔΩΝ", "13-WEEK LIQUIDITY"))
    c.fill = F(DARK_BLUE); c.font = Fnt(size=14, bold=True, color=WHITE)
    c.alignment = Aln(h="left", v="center")
    sheet_intro(ws, 2,
        t("Το ίδιο υπόλοιπο με το Ταμείο, αλλά ανά εβδομάδα αντί για μήνα — δείχνει αν μια συγκεκριμένη "
          "εβδομάδα θα τρέξει χαμηλά σε ρευστό, ακόμα κι αν ο συνολικός μήνας βγαίνει θετικός. Πλήρως ζωντανό "
          "από τις Κινήσεις, τίποτα δεν συμπληρώνεται εδώ. Μια επαναλαμβανόμενη δόση εμφανίζεται μόνο όταν "
          "γίνει η ΕΠΟΜΕΝΗ της — αν έχετε πάνω από μία δόση της ίδιας κίνησης μέσα στις 13 εβδομάδες, η δεύτερη "
          "θα εμφανιστεί μόλις γίνει αυτή η επόμενη.",
          "The same balance as Ταμείο, but week by week instead of month by month — shows if one specific "
          "week runs low on cash even when the month overall nets positive. Fully live from Κινήσεις, nothing "
          "to fill in here. A recurring instalment only shows once it becomes the NEXT one due — if the same "
          "recurring line has more than one instalment inside these 13 weeks, the second only appears once it "
          "becomes next."),
        end_col="H")

    liq_headers = [t("Εβδομάδα", "Week"), t("Από", "From"), t("Έως", "To"),
                   t("Υπόλοιπο Έναρξης", "Opening Balance"), t("Αναμενόμενα Έσοδα", "Expected Income"),
                   t("Αναμενόμενα Έξοδα", "Expected Expenses"), t("Καθαρή Μεταβολή", "Net Change"),
                   t("Υπόλοιπο Λήξης", "Closing Balance")]
    for ci, h in enumerate(liq_headers, 1):
        col_hdr(ws, 3, ci, h)

    def _week_flow(type_filter, start_ref, end_ref):
        paid = (f'SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_TYPE}],"{type_filter}",'
                f'Table_Kin[{H_STATUS}],"{S_PAID}",'
                f'Table_Kin[{H_DATE}],">="&{start_ref},Table_Kin[{H_DATE}],"<"&{end_ref})')
        oneoff = (f'SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_TYPE}],"{type_filter}",'
                  f'Table_Kin[{H_STATUS}],"<>{S_PAID}",Table_Kin[{H_STATUS}],"<>{S_SCHED}",'
                  f'Table_Kin[{H_REC}],"<>{REC_YES}",'
                  f'Table_Kin[{H_DUE}],">="&{start_ref},Table_Kin[{H_DUE}],"<"&{end_ref})')
        recur = (f'SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_TYPE}],"{type_filter}",'
                 f'Table_Kin[{H_STATUS}],"<>{S_SCHED}",Table_Kin[{H_REC}],"{REC_YES}",'
                 f'Table_Kin[{H_NEXTDUE}],">="&{start_ref},Table_Kin[{H_NEXTDUE}],"<"&{end_ref})')
        return f'({paid})+({oneoff})+({recur})'

    LIQ_FIRST = 4
    LIQ_WEEKS = 13
    for i in range(LIQ_WEEKS):
        row = LIQ_FIRST + i
        ws.row_dimensions[row].height = 18
        start_ref, end_ref = f"$B{row}", f"$C{row}"
        bcell = ws.cell(row=row, column=2, value="=TODAY()" if i == 0 else f"=C{row - 1}")
        ccell = ws.cell(row=row, column=3, value=f"=B{row}+7")
        lbl_cell = ws.cell(row=row, column=1, value=f'=TEXT(B{row},"DD/MM")&" – "&TEXT(C{row}-1,"DD/MM")')
        lbl_cell.fill = F(LIGHT_GREY); lbl_cell.font = Fnt(size=10, bold=True, color=DARK_BLUE)
        lbl_cell.alignment = Aln(h="left", v="center")
        for cc in (bcell, ccell):
            cc.number_format = "DD/MM/YYYY"; cc.alignment = Aln(h="center")
            cc.fill = F(LIGHT_GREY); cc.font = Fnt(size=9, color="FF6B7280")
        opening = ws.cell(row=row, column=4,
            value=(f'={FUNDS_F}' if i == 0 else f'=H{row - 1}'))
        inc = ws.cell(row=row, column=5, value=f'=ROUND({_week_flow(TYPE_INC, start_ref, end_ref)},2)')
        exp = ws.cell(row=row, column=6, value=f'=ROUND({_week_flow(TYPE_EXP, start_ref, end_ref)},2)')
        net = ws.cell(row=row, column=7, value=f'=E{row}-F{row}')
        closing = ws.cell(row=row, column=8, value=f'=D{row}+G{row}')
        for cc in (opening, inc, exp):
            cc.number_format = EUR0; cc.alignment = Aln(h="right"); cc.fill = F(WHITE); cc.font = Fnt(size=10)
        net.number_format = EUR0_NEG; net.alignment = Aln(h="right"); net.fill = F(WHITE); net.font = Fnt(size=10)
        closing.number_format = EUR0; closing.alignment = Aln(h="right"); closing.fill = F(LIGHT_BLUE)
        closing.font = Fnt(size=10, bold=True, color=DARK_BLUE)
    LIQ_LAST = LIQ_FIRST + LIQ_WEEKS - 1

    ws.conditional_formatting.add(f"H{LIQ_FIRST}:H{LIQ_LAST}",
        CellIsRule(operator="lessThan", formula=["0"],
                   fill=PatternFill(start_color=RED_BG, end_color=RED_BG, fill_type="solid"),
                   font=Font(name="Calibri", size=10, bold=True, color=RED_FG)))
    ws.conditional_formatting.add(f"H{LIQ_FIRST}:H{LIQ_LAST}",
        CellIsRule(operator="between", formula=["0", "MinCashBuffer"],
                   fill=PatternFill(start_color="FFFEF0D8", end_color="FFFEF0D8", fill_type="solid"),
                   font=Font(name="Calibri", size=10, bold=True, color="FF965800")))

    TIP_LIQ = LIQ_LAST + 2
    ws.merge_cells(start_row=TIP_LIQ, start_column=1, end_row=TIP_LIQ, end_column=8)
    c = ws.cell(row=TIP_LIQ, column=1,
                value="  " + t("«Υπόλοιπο Έναρξης» της πρώτης εβδομάδας = τα σημερινά διαθέσιμα κεφάλαια "
                                "(ίδιο με του Ταμείου, ίδιο ΤύποςΠροβολής). Κάθε επόμενη εβδομάδα παίρνει το "
                                "«Υπόλοιπο Λήξης» της προηγούμενης. Κόκκινο = αρνητικό υπόλοιπο· πορτοκαλί = "
                                "θετικό αλλά κάτω από το Ελάχιστο Απόθεμα Ασφαλείας (ίδιο όριο με το Ταμείο).",
                          "“Opening Balance” for the first week = today's available funds (same figure, same "
                          "view toggle, as Ταμείο). Each later week carries forward the previous week's "
                          "“Closing Balance”. Red = negative balance; amber = positive but under the Minimum "
                          "Safety Buffer (same threshold as Ταμείο)."))
    c.font = Fnt(size=10, italic=True, color="FF6B7280")
    c.fill = F("FFF6F8FA"); c.alignment = Aln(h="left", wrap=True)
    ws.row_dimensions[TIP_LIQ].height = 40

    # ══════════════════════════════════════════════════════════════════════════
    # TAB: ΠΛΗΡΟΤΗΤΑ & ΑΠΟΔΟΣΗ ΞΕΝΟΔΟΧΕΙΟΥ  —  occupancy/ADR/RevPAR for the
    # two "Ξενοδοχείο / Μίσθωση" projects (Q003, Q004). Both leases are FIXED
    # rent with escalation (see 13. Μισθώματα & Αποδόσεις's own assumptions —
    # no revenue-share clause exists), so this sheet is deliberately NOT a
    # variable-rent calculator. It's a tenant-health monitor: is the hotel
    # operator actually filling rooms well enough to keep paying a fixed
    # rent that runs whether the property fills up or not. Only 3 manual
    # inputs per month per project (rooms available, rooms sold, room
    # revenue) — everything else (occupancy, ADR, RevPAR, rent coverage)
    # is derived. ──
    # ══════════════════════════════════════════════════════════════════════════
    ws = ws_occ
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 14
    ws.column_dimensions["B"].width = 16
    ws.column_dimensions["C"].width = 16
    ws.column_dimensions["D"].width = 12
    ws.column_dimensions["E"].width = 14
    ws.column_dimensions["F"].width = 15
    ws.column_dimensions["G"].width = 13
    ws.column_dimensions["H"].width = 15
    ws.column_dimensions["I"].width = 17

    ws.row_dimensions[1].height = 34
    ws.merge_cells("A1:I1")
    c = ws.cell(row=1, column=1, value="  " + t("ΠΛΗΡΟΤΗΤΑ & ΑΠΟΔΟΣΗ ΞΕΝΟΔΟΧΕΙΟΥ", "HOTEL OCCUPANCY & PERFORMANCE"))
    c.fill = F(DARK_BLUE); c.font = Fnt(size=14, bold=True, color=WHITE)
    c.alignment = Aln(h="left", v="center")
    sheet_intro(ws, 2,
        t("Και τα δύο μισθώματα (Q003, Q004) είναι ΣΤΑΘΕΡΑ με αναπροσαρμογή — δεν υπάρχει ρήτρα ποσοστού επί "
          "τζίρου. Αυτό το φύλλο δεν υπολογίζει μίσθωμα· παρακολουθεί αν ο ξενοδοχειακός φορέας γεμίζει "
          "αρκετά δωμάτια ώστε να συνεχίσει να πληρώνει άνετα ένα μίσθωμα που τρέχει είτε γεμίσει το ακίνητο "
          "είτε όχι — η «Κάλυψη Μισθώματος» παρακάτω είναι ο δείκτης ασφαλείας, ανάλογος του DSCR στα δάνεια. "
          "Συμπληρώνετε μόνο 3 κίτρινα κελιά τον μήνα ανά έργο (Διαθέσιμα Δωμάτια-Νύχτες, Πληρωμένα, Έσοδα "
          "Δωματίων) — Πληρότητα, ADR, RevPAR και Κάλυψη υπολογίζονται μόνα τους.",
          "Both leases (Q003, Q004) are FIXED rent with escalation — there's no revenue-share clause. This "
          "sheet doesn't calculate rent; it monitors whether the hotel operator is filling enough rooms to "
          "keep comfortably paying a rent that runs whether the property fills up or not — “Rent Coverage” "
          "below is the safety indicator, similar in spirit to a loan's DSCR. Fill in only 3 yellow cells per "
          "month per project (Available Room-Nights, Sold, Room Revenue) — Occupancy, ADR, RevPAR and "
          "Coverage all derive on their own."),
        end_col="I")

    occ_headers = [t("Μήνας", "Month"), t("Διαθέσιμα Δωμάτια-Νύχτες", "Available Room-Nights"),
                   t("Πληρωμένα Δωμάτια-Νύχτες", "Sold Room-Nights"), t("Πληρότητα", "Occupancy"),
                   t("ADR (Μέση Τιμή)", "ADR"), t("Έσοδα Δωματίων", "Room Revenue"), t("RevPAR", "RevPAR"),
                   t("Κάλυψη Μισθώματος", "Rent Coverage"), t("Πραγμ. Έσοδο Έργου (Κινήσεις)", "Actual Project Income (live)")]

    occ_projects = [(PROJ_LAZ, "D", t("Λαζαράκη 32, Γλυφάδα", "Lazaraki 32, Glyfada")),
                    (PROJ_AGK, "E", t("Αγ. Κωνσταντίνου 20, Γλυφάδα", "Ag. Konstantinou 20, Glyfada"))]
    OCC_MONTHS_BACK, OCC_MONTHS_FWD = 6, 6

    def _build_occ_block(start_row, proj_code, bud_col, proj_name):
        hdr_row = start_row
        ws.row_dimensions[hdr_row].height = 24
        ws.merge_cells(start_row=hdr_row, start_column=1, end_row=hdr_row, end_column=9)
        ph = ws.cell(row=hdr_row, column=1, value="  " + t("ΈΡΓΟ: ", "PROJECT: ") + proj_name)
        ph.fill = F(LIGHT_BLUE); ph.font = Fnt(size=11, bold=True, color=DARK_BLUE); ph.alignment = Aln(h="left", v="center")

        rent_row = hdr_row + 1
        lc = ws.cell(row=rent_row, column=1, value=t("Μηνιαίο Μίσθωμα (Έτος 1)", "Monthly Rent (Year 1)"))
        lc.fill = F(LIGHT_GREY); lc.font = Fnt(size=9, italic=True, color="FF6B7280"); lc.alignment = Aln(h="left", v="center")
        rent_cell = ws.cell(row=rent_row, column=2, value=f"='4. Προϋπολογισμοί'!{bud_col}{LEASE_HDR + 1}")
        rent_cell.number_format = EUR0; rent_cell.alignment = Aln(h="right"); rent_cell.fill = F(LIGHT_GREY)
        rent_cell.font = Fnt(size=9, italic=True, color="FF6B7280")
        for ci in range(3, 10): ws.cell(row=rent_row, column=ci).fill = F(LIGHT_GREY)
        RENT_REF = f"$B${rent_row}"

        hdr2 = rent_row + 1
        for ci, h in enumerate(occ_headers, 1):
            col_hdr(ws, hdr2, ci, h)
        first = hdr2 + 1
        for i in range(OCC_MONTHS_BACK + OCC_MONTHS_FWD):
            row = first + i
            offset = i - OCC_MONTHS_BACK
            ws.row_dimensions[row].height = 16
            edate = f"EDATE(TODAY(),{offset})"
            mc = ws.cell(row=row, column=1, value=f'=YEAR({edate})&"-"&TEXT(MONTH({edate}),"00")')
            mc.fill = F(LIGHT_GREY); mc.alignment = Aln(h="center", v="center"); mc.font = Fnt(size=10, bold=True, color=DARK_BLUE)
            avail = inp(ws, row, 2, None, "#,##0", align_h="right")
            sold = inp(ws, row, 3, None, "#,##0", align_h="right")
            revenue = inp(ws, row, 6, None, EUR0, align_h="right")
            occ = ws.cell(row=row, column=4, value=f'=IF(B{row}=0,"—",C{row}/B{row})')
            adr = ws.cell(row=row, column=5, value=f'=IF(C{row}=0,"—",F{row}/C{row})')
            revpar = ws.cell(row=row, column=7, value=f'=IF(B{row}=0,"—",F{row}/B{row})')
            coverage = ws.cell(row=row, column=8, value=f'=IF({RENT_REF}=0,"—",F{row}/{RENT_REF})')
            for cc, fmt in ((occ, "0%"), (adr, EUR0), (revpar, EUR0), (coverage, '0.0"x"')):
                cc.number_format = fmt; cc.alignment = Aln(h="right"); cc.fill = F(WHITE); cc.font = Fnt(size=10)
            mref = f"$A{row}"
            actual = ws.cell(row=row, column=9,
                value=f'=ROUND({_recur_monthly(H_AMOUNT, TYPE_INC, mref, project_ref=chr(34)+proj_code+chr(34), mode="paid")},2)')
            actual.number_format = EUR0; actual.alignment = Aln(h="right"); actual.fill = F(LIGHT_GREY)
            actual.font = Fnt(size=9, color="FF6B7280")
        last = first + OCC_MONTHS_BACK + OCC_MONTHS_FWD - 1

        ws.conditional_formatting.add(f"H{first}:H{last}",
            CellIsRule(operator="lessThan", formula=["1"],
                       fill=PatternFill(start_color=RED_BG, end_color=RED_BG, fill_type="solid"),
                       font=Font(name="Calibri", size=10, bold=True, color=RED_FG)))

        avg_row = last + 1
        ws.row_dimensions[avg_row].height = 20
        lbl(ws, avg_row, 1, t("ΜΕΣΟΣ ΟΡΟΣ 12 ΜΗΝΩΝ", "12-MONTH AVERAGE"), bold=True, bg=LIGHT_BLUE)
        ws.cell(row=avg_row, column=2).fill = F(LIGHT_BLUE)
        ws.cell(row=avg_row, column=3).fill = F(LIGHT_BLUE)
        for ci, fmt in ((4, "0%"), (5, EUR0), (7, EUR0), (8, '0.0"x"')):
            letter = get_column_letter(ci)
            avgc = ws.cell(row=avg_row, column=ci, value=f'=IFERROR(AVERAGE({letter}{first}:{letter}{last}),"—")')
            avgc.number_format = fmt; avgc.fill = F(LIGHT_BLUE); avgc.font = Fnt(size=10, bold=True, color=DARK_BLUE)
            avgc.alignment = Aln(h="right")
        tot_rev = ws.cell(row=avg_row, column=6, value=f"=SUM(F{first}:F{last})")
        tot_rev.number_format = EUR0; tot_rev.fill = F(LIGHT_BLUE); tot_rev.font = Fnt(size=10, bold=True, color=DARK_BLUE)
        tot_rev.alignment = Aln(h="right")
        tot_act = ws.cell(row=avg_row, column=9, value=f"=SUM(I{first}:I{last})")
        tot_act.number_format = EUR0; tot_act.fill = F(LIGHT_BLUE); tot_act.font = Fnt(size=10, bold=True, color=DARK_BLUE)
        tot_act.alignment = Aln(h="right")
        return avg_row

    row_ptr = 4
    for proj_code, bud_col, proj_name in occ_projects:
        last_used = _build_occ_block(row_ptr, proj_code, bud_col, proj_name)
        row_ptr = last_used + 3
    OCC_END = row_ptr - 2

    ws.merge_cells(start_row=OCC_END, start_column=1, end_row=OCC_END, end_column=9)
    c = ws.cell(row=OCC_END, column=1,
                value="  " + t("«Κάλυψη Μισθώματος» < 1,0x σημαίνει ότι τα έσοδα δωματίων εκείνου του μήνα δεν "
                                "έφτασαν το μίσθωμα — δεν σημαίνει απαραίτητα ότι ο ενοικιαστής δεν πλήρωσε "
                                "(μπορεί να κάλυψε τη διαφορά από αλλού), αλλά αξίζει προσοχή αν επαναλαμβάνεται.",
                          "“Rent Coverage” under 1.0x means that month's room revenue didn't reach the rent — "
                          "it doesn't necessarily mean the tenant missed payment (they may have covered the gap "
                          "from elsewhere), but it's worth watching if it repeats."))
    c.font = Fnt(size=10, italic=True, color="FF6B7280")
    c.fill = F("FFF6F8FA"); c.alignment = Aln(h="left", wrap=True)
    ws.row_dimensions[OCC_END].height = 32
    protect_sheet(ws)

    # ══════════════════════════════════════════════════════════════════════════
    # TAB: ΠΟΛΥΕΤΕΣ KPI SCORECARD  —  17. Σύνοψη's own P&L definitions
    # (Πληρωμένο, Πεδίο=Επιχειρηματικό, εκτός Κατηγορία=Δάνειο), broken out
    # by CALENDAR YEAR instead of only the trailing 12 months, so the
    # company's trajectory shows rather than a single snapshot. A sliding
    # 5-year window (2 back, today, 2 forward) — column headers are
    # formulas off TODAY(), so the window itself moves forward on its own
    # as time passes, never needing to be re-typed. Fully live, nothing to
    # fill in. ──
    # ══════════════════════════════════════════════════════════════════════════
    ws = ws_scorecard
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 38
    for letter in "BCDEF":
        ws.column_dimensions[letter].width = 15
    ws.freeze_panes = "B4"

    ws.row_dimensions[1].height = 34
    ws.merge_cells("A1:F1")
    c = ws.cell(row=1, column=1, value="  " + t("ΠΟΛΥΕΤΕΣ KPI SCORECARD", "MULTI-YEAR KPI SCORECARD"))
    c.fill = F(DARK_BLUE); c.font = Fnt(size=14, bold=True, color=WHITE)
    c.alignment = Aln(h="left", v="center")
    sheet_intro(ws, 2,
        t("Οι ίδιοι ορισμοί με το «17. Σύνοψη» (Πληρωμένο, Επιχειρηματικό, εκτός δανειακού κεφαλαίου), αλλά ανά "
          "ημερολογιακό έτος αντί για κυλιόμενο 12μηνο — δείχνει την πορεία της εταιρείας, όχι μόνο μια στιγμή. "
          "Το παράθυρο των 5 ετών μετακινείται μόνο του με τον χρόνο.",
          "Same definitions as “17. Σύνοψη” (Paid, Business, excluding loan principal), but by calendar year "
          "instead of a rolling 12 months — shows the company's trajectory, not just one snapshot. The 5-year "
          "window slides forward on its own as time passes."),
        end_col="F")

    YR_ROW = 3
    lbl_c = ws.cell(row=YR_ROW, column=1, value=t("ΔΕΙΚΤΗΣ", "METRIC"))
    lbl_c.fill = F(DARK_BLUE); lbl_c.font = Fnt(size=10, bold=True, color=WHITE); lbl_c.alignment = Aln(h="left", v="center")
    YR_COLS = list(range(2, 7))   # B..F — 2 back, today, 2 forward
    for j, col in enumerate(YR_COLS):
        offset = j - 2
        yc = ws.cell(row=YR_ROW, column=col, value=f"=YEAR(TODAY()){'+' if offset >= 0 else ''}{offset}")
        yc.number_format = "0"; yc.fill = F(DARK_BLUE); yc.font = Fnt(size=11, bold=True, color=WHITE)
        yc.alignment = Aln(h="center", v="center")

    def _yr_bounds(col_letter):
        return f"DATE({col_letter}{YR_ROW},1,1)", f"DATE({col_letter}{YR_ROW}+1,1,1)"

    def _yr_income(col_letter):
        lo, hi = _yr_bounds(col_letter)
        return (f'SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_TYPE}],"{TYPE_INC}",Table_Kin[{H_SCOPE}],"{SCOPE_BIZ}",'
                f'Table_Kin[{H_STATUS}],"{S_PAID}",Table_Kin[{H_DATE}],">="&{lo},Table_Kin[{H_DATE}],"<"&{hi})')

    def _yr_expense(col_letter):
        lo, hi = _yr_bounds(col_letter)
        return (f'SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_TYPE}],"{TYPE_EXP}",Table_Kin[{H_SCOPE}],"{SCOPE_BIZ}",'
                f'Table_Kin[{H_STATUS}],"{S_PAID}",Table_Kin[{H_DATE}],">="&{lo},Table_Kin[{H_DATE}],"<"&{hi},'
                f'Table_Kin[{H_CATEGORY}],"<>{CAT_LOAN}")')

    def _yr_cum_capital(col_letter):
        _, hi = _yr_bounds(col_letter)
        return (f'SUMIFS(Table_Kin[{H_AMOUNT}],Table_Kin[{H_TYPE}],"{TYPE_EXP}",Table_Kin[{H_STATUS}],"{S_PAID}",'
                f'Table_Kin[{H_PROJECT}],"<>",Table_Kin[{H_DATE}],"<"&{hi})')

    ROW_INC, ROW_EXP, ROW_NET, ROW_MARGIN, ROW_CAP = 4, 5, 6, 7, 8
    lbl(ws, ROW_INC, 1, t("Έσοδα (Πληρωμένα, Επιχειρηματικά)", "Income (Paid, Business)"))
    lbl(ws, ROW_EXP, 1, t("Λειτουργικά Έξοδα (Πληρωμένα, εκτός Δανείου)", "Operating Expenses (Paid, excl. Loans)"))
    lbl(ws, ROW_NET, 1, t("ΚΑΘΑΡΟ ΑΠΟΤΕΛΕΣΜΑ", "NET RESULT"), bold=True, bg=LIGHT_BLUE)
    lbl(ws, ROW_MARGIN, 1, t("Περιθώριο Καθαρού Αποτελέσματος", "Net Margin"))
    lbl(ws, ROW_CAP, 1, t("Σωρευτικό Κεφάλαιο σε Έργα (μέχρι τέλος έτους)", "Cumulative Capital Deployed (by year-end)"))

    for j, col in enumerate(YR_COLS):
        letter = get_column_letter(col)
        inc = ws.cell(row=ROW_INC, column=col, value=f'=ROUND({_yr_income(letter)},2)')
        exp = ws.cell(row=ROW_EXP, column=col, value=f'=ROUND({_yr_expense(letter)},2)')
        net = ws.cell(row=ROW_NET, column=col, value=f'={letter}{ROW_INC}-{letter}{ROW_EXP}')
        margin = ws.cell(row=ROW_MARGIN, column=col, value=f'=IFERROR({letter}{ROW_NET}/{letter}{ROW_INC},"—")')
        cap = ws.cell(row=ROW_CAP, column=col, value=f'=ROUND({_yr_cum_capital(letter)},2)')
        for cc in (inc, exp, cap):
            cc.number_format = EUR0; cc.alignment = Aln(h="right"); cc.fill = F(WHITE); cc.font = Fnt(size=10)
        net.number_format = EUR0_NEG; net.alignment = Aln(h="right"); net.fill = F(LIGHT_BLUE)
        net.font = Fnt(size=10, bold=True, color=DARK_BLUE)
        margin.number_format = "0%"; margin.alignment = Aln(h="right"); margin.fill = F(WHITE); margin.font = Fnt(size=10)

    ws.conditional_formatting.add(f"B{ROW_NET}:F{ROW_NET}",
        CellIsRule(operator="lessThan", formula=["0"],
                   fill=PatternFill(start_color=RED_BG, end_color=RED_BG, fill_type="solid"),
                   font=Font(name="Calibri", size=10, bold=True, color=RED_FG)))

    TIP_SCORE = ROW_CAP + 2
    ws.merge_cells(start_row=TIP_SCORE, start_column=1, end_row=TIP_SCORE, end_column=6)
    c = ws.cell(row=TIP_SCORE, column=1,
                value="  " + t("Οι στήλες είναι ημερολογιακά έτη, όχι κυλιόμενα 12μηνα — ένα «έτος» που μόλις "
                                "ξεκίνησε ή δεν έχει τελειώσει ακόμα θα δείχνει τα ως τώρα, όχι προβλεπόμενο "
                                "σύνολο. Το «Σωρευτικό Κεφάλαιο σε Έργα» είναι αθροιστικό από την αρχή, όχι μόνο "
                                "του έτους.",
                          "Columns are calendar years, not rolling 12-month windows — a year that just started "
                          "or hasn't ended yet will show what's happened so far, not a projected full-year "
                          "total. “Cumulative Capital Deployed” is running from the start, not just that year."))
    c.font = Fnt(size=10, italic=True, color="FF6B7280")
    c.fill = F("FFF6F8FA"); c.alignment = Aln(h="left", wrap=True)
    ws.row_dimensions[TIP_SCORE].height = 40

    # protect every sheet that mixes manual input with formulas so a stray
    # keystroke can't silently overwrite a formula cell (Table_Kin's own
    # protection was already applied above, right after its data
    # validations, since it needs an explicit row limit). Ελεύθερη Ανάλυση is
    # deliberately left unprotected — it holds nothing but the native
    # PivotTable + slicers build_pivots.ps1 adds afterwards via COM, and
    # protecting it here risks interfering with that follow-on step.
    for sheet in (ws_cc, ws_proj, ws_bud, ws_an, ws_con, ws_acc, ws_cash, ws_vat, ws_wh, ws_qc, ws_rent, ws_loans, ws_scurve, ws_bankrec, ws_sum, ws_liquidity, ws_scorecard, ws_setup, ws_set, ws_calc):
        protect_sheet(sheet)

    # colour-coded sheet tabs — a cheap, native-Excel way to make the bottom
    # tab strip scannable at a glance, grouped by what each tab is for
    # rather than one flat colour for everything.
    tab_colors = {
        ws_cc:   "1A2F4A",   # dashboard — navy
        ws_kin:  "0B6640",   # the one place you type transactions — green
        ws_proj: "1868A8",   # analysis/reporting — ocean blue
        ws_bud:  "1868A8",
        ws_an:   "1868A8",
        ws_piv:  "1868A8",
        ws_con:  "6B7280",   # reference/registry data — neutral grey
        ws_acc:  "6B7280",
        ws_set:  "6B7280",
        ws_cash: "965800",   # forward-looking forecasts — amber
        ws_vat:  "965800",
        ws_wh:   "965800",
        ws_qc:   "991B1B",   # data-quality checks — red, distinct from everything else
        ws_rent: "965800",
        ws_loans: "965800",
        ws_scurve: "1868A8",
        ws_bankrec: "991B1B",
        ws_sum:  "1A2F4A",   # one-page print handout — navy, matches the dashboard
        ws_setup: "6B7280",
        ws_daily:   "5B3A9E",   # personal-spending rollups — purple, matches the
        ws_monthly: "5B3A9E",   # Personal Spending tile's accent colour on Κέντρο Ελέγχου
        ws_taxcal:  "965800",   # deadline tracker — amber, matches ΦΠΑ/Παρακράτηση
        ws_liquidity: "965800", # forward-looking cash forecast — amber, matches Ταμείο
        ws_occ:  "965800",      # investment/operating performance — amber, matches Μισθώματα & Αποδόσεις
        ws_checklist: "9CA3AF", # plain reference tab — neutral grey, matches Οδηγίες
        ws_scorecard: "1A2F4A", # one-page-style summary — navy, matches Σύνοψη/dashboard
    }
    for sheet, color in tab_colors.items():
        sheet.sheet_properties.tabColor = color
    if "Οδηγίες" in wb.sheetnames:
        wb["Οδηγίες"].sheet_properties.tabColor = "9CA3AF"

    # navigation — click any sheet's title banner to jump back to Κέντρο
    # Ελέγχου. Attached as a hyperlink on the EXISTING title cell (A1)
    # rather than adding a new cell/row, so it costs zero layout risk; the
    # font is explicitly re-applied afterward since Excel likes to paint
    # hyperlinked cells its own default blue-underline otherwise.
    for sheet in wb.worksheets:
        if sheet is ws_cc:
            continue
        title_cell = sheet.cell(row=1, column=1)
        existing_font = copy.copy(title_cell.font)
        title_cell.hyperlink = "#\'1. Κέντρο Ελέγχου\'!A1"
        title_cell.font = existing_font

    # every sheet opens at 100% zoom with the cursor on A1 — a small thing,
    # but it means the file always looks the same the moment it's opened,
    # instead of resuming wherever the last save happened to leave it.
    for sheet in wb.worksheets:
        sheet.sheet_view.zoomScale = 100
        sheet.sheet_view.selection[0].activeCell = "A1"
        sheet.sheet_view.selection[0].sqref = "A1"

    return wb


# ─── SAVE — Greek workbook only ──────────────────────────────────────────────
if __name__ == "__main__":
    _base_dir = os.path.dirname(os.path.abspath(__file__))
    _wb = build_workbook()
    _path = os.path.join(_base_dir, "back_office_operations.xlsx")
    _wb.save(_path)
    print(f"Saved: {_path}")
