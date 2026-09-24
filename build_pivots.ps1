# build_pivots.ps1
#
# Adds a real, native Excel PivotTable (+ slicers) to the "6. Ελεύθερη
# Ανάλυση" tab of LA_Budgeting_GR_v2.xlsx, sourced from the Table_Kin Excel
# Table on the "2. Κινήσεις" sheet.
#
# openpyxl (used by generate_workbook_v2.py to build the rest of the
# workbook) cannot reliably *write* a working PivotTable — only read one —
# so this is a separate pass that drives the real Excel application via COM
# automation to build a genuine PivotCache/PivotTable/Slicers, which the
# user can then freely re-pivot, filter, and slice themselves in Excel.
#
# Run this ONCE, right after generate_workbook_v2.py, with Excel closed:
#   py generate_workbook_v2.py
#   powershell -File build_pivots.ps1

param([string]$TargetFile = "back_office_operations.xlsx")
$ErrorActionPreference = "Stop"
$path = Join-Path $PSScriptRoot $TargetFile

$xlDatabase   = 1
$xlRowField   = 1
$xlColumnField = 2
$xlPageField  = 3
$xlDataField  = 4
$xlSum        = -4157
$xlCompactRow = 0
$xlTabularRow = 1
$xlRepeatLabels = 2

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
    $wb = $excel.Workbooks.Open($path)
    $an = $wb.Sheets.Item("6. Ελεύθερη Ανάλυση")

    # anchor: read from the "PivotAnchor" defined name generate_workbook_v2.py
    # writes into the workbook itself — no hardcoded cell to keep in sync by
    # hand. If the sheet layout above the pivot changes, this just works.
    $destCell = $wb.Names.Item("PivotAnchor").RefersToRange

    $pc = $wb.PivotCaches().Create($xlDatabase, "Table_Kin")
    $pt = $pc.CreatePivotTable($destCell, "PivotAnalysis")

    # Rows: Έργο. Columns: Έτος -> Τρίμηνο -> Μήνας (Ανάλυση) -> Ημέρα,
    # coarsest to finest — explicitly requested layout (dates as columns,
    # broken down by project on rows, lowest granularity available).
    #
    # This does NOT use Excel's automatic date GROUPING (PivotField.Group()
    # on the real Ημερομηνία field). Confirmed by extensive, direct testing
    # against this exact file: a Group()-created date hierarchy's 4 fields
    # (Years/Quarters/Months/Days) always render in a FIXED finest-to-
    # coarsest order the moment they're placed on the COLUMN axis, and
    # nothing reorders them — not PivotField.Position (either numbering
    # direction), not ColumnFields(i).Position, not RefreshTable(), not
    # building the correct order on ROWS first (where Position genuinely
    # does work) and then moving the already-ordered fields to columns.
    #
    # It also does NOT reuse the real "Μήνας" / "Ημερομηνία" Table_Kin
    # columns directly, even as plain (non-grouped) fields — a second
    # confirmed fact: on save+reload, Excel silently re-sorts multiple
    # column fields to match their SOURCE TABLE COLUMN ORDER, ignoring
    # insertion order. Ημερομηνία is fixed at column A (hundreds of
    # formulas depend on it) and Μήνας at column Q, so both would always
    # end up rendering as the OUTERMOST columns (lowest column index) —
    # backwards from coarse-outer/fine-inner. generate_workbook_v2.py
    # instead adds 4 entirely new TRAILING helper columns — Έτος, Τρίμηνο,
    # "Μήνας (Ανάλυση)" (a mirror of Μήνας), and "Ημέρα" (a mirror of
    # Ημερομηνία) — in exactly coarse-to-fine table-column order, so their
    # position already matches what's wanted post-reload; no reordering
    # step needed here at all.
    $pt.PivotFields("Έργο").Orientation = $xlRowField
    $pt.PivotFields("Έτος").Orientation = $xlColumnField
    $pt.PivotFields("Τρίμηνο").Orientation = $xlColumnField
    $pt.PivotFields("Μήνας (Ανάλυση)").Orientation = $xlColumnField
    $pt.PivotFields("Ημέρα").Orientation = $xlColumnField

    # Every pre-provisioned blank Κινήσεις row carries blanks in all 4 of
    # these helper columns, which would otherwise show as a stray
    # "(blank)" column spanning the whole grid — hide it on each field
    # (those template rows carry no amounts either, so excluding them is
    # correct, not a workaround-induced data loss).
    foreach ($fname in @("Έτος", "Τρίμηνο", "Μήνας (Ανάλυση)", "Ημέρα")) {
        try { $pt.PivotFields($fname).PivotItems("(blank)").Visible = $false } catch {}
    }

    # a data field can't be captioned EXACTLY the same as its source field —
    # Excel raises a hard COM error, it does not silently disambiguate — so
    # a single leading space is used, which is invisible in the UI and is
    # exactly the workaround Excel's own "Rename Field" dialog suggests.
    # NOTE: "#,##0" (comma grouping) is correct in a cell's number_format
    # written directly into the XLSX XML (as generate_workbook_v2.py does
    # throughout), but a format string assigned live via COM automation
    # (.NumberFormat = "...") is parsed against the CURRENT REGIONAL
    # SETTINGS' literal separator characters instead — same root cause as
    # the TEXT()-format-string bug fixed in generate_workbook_v2.py. Under
    # this machine's locale that means "." for grouping, not ",".
    $df = $pt.PivotFields("Ποσό")
    $pt.AddDataField($df, " Ποσό", $xlSum) | Out-Null
    $pt.PivotFields(" Ποσό").NumberFormat = [char]0x20AC + "#.##0"

    $dfVat = $pt.PivotFields("ΦΠΑ")
    $pt.AddDataField($dfVat, " ΦΠΑ", $xlSum) | Out-Null
    $pt.PivotFields(" ΦΠΑ").NumberFormat = [char]0x20AC + "#.##0"

    # ── visual polish — Compact form (Excel's default outline/indent look,
    # not the old flat Tabular layout) with labels NOT repeated down every
    # row — a business user scanning the pivot reads "Q004 project, then
    # its months indented underneath" rather than the project name printed
    # again on every single month line. Blue table style matching the rest
    # of the workbook's palette, with banded rows. ──
    $pt.RowAxisLayout($xlCompactRow)
    try { $pt.PivotFields("Έργο").RepeatLabels = $false } catch {}
    $pt.TableStyle2 = "PivotStyleMedium9"
    $pt.ShowTableStyleRowStripes = $true
    $pt.ShowTableStyleColumnStripes = $false
    $pt.HasAutoFormat = $false
    $pt.TableRange2.EntireColumn.AutoFit() | Out-Null

    # slicers live in their own reserved zone ABOVE the pivot anchor (rows
    # 6-20 on this sheet) — laid out as a clean 3-column x 2-row grid, fully
    # distinct from the pivot table itself. Since the pivot only ever grows
    # down/right from its anchor (below this zone), it can never overrun the
    # slicers regardless of how wide or tall it gets.
    # NOTE: passing Name/Caption/Top/Left/Width/Height positionally into
    # Slicers.Add() fails under PowerShell's COM late-binding ("Value does
    # not fall within the expected range") even though the same call works
    # fine from VBA — a known overload-resolution quirk. Calling Add() with
    # just the destination worksheet, then setting Top/Left/Width/Height as
    # plain property assignments afterward, is reliable.
    $gridOrigin = $an.Range("B6")
    $slicerTop0 = $gridOrigin.Top
    $slicerLeft0 = $gridOrigin.Left
    $slicerW = 220
    $slicerH = 150
    $fields = @("Μήνας", "Έργο", "Τύπος", "Πηγή", "Κατάσταση", "Επαναλαμβανόμενο")
    $i = 0
    foreach ($f in $fields) {
        $row = [int]([math]::Floor($i / 3))
        $col = [int]($i % 3)
        $cache = $wb.SlicerCaches.Add2($pt, $f)
        $slicer = $cache.Slicers.Add($an)
        $slicer.Top = $slicerTop0 + $row * $slicerH
        $slicer.Left = $slicerLeft0 + $col * ($slicerW + 15)
        $slicer.Width = $slicerW
        $slicer.Height = $slicerH
        $i += 1
    }

    # Touch-up: openpyxl-written AGGREGATE(15,6,(ROW(range)-N+1)/(...),k)
    # formulas (the "Real Draws" lookups on 14. Δάνεια) evaluate to the
    # IFERROR fallback on first load even though the formula text itself
    # is correct — confirmed via direct testing that re-assigning a cell's
    # OWN formula text via COM (Range.Formula = Range.Formula) makes Excel
    # actually re-evaluate it correctly, where CalculateFullRebuild() alone
    # does not. Re-entering every AGGREGATE-based formula on this sheet
    # through COM once, here, fixes it permanently in the saved file.
    $loansSheet = $wb.Sheets.Item("14. Δάνεια")
    $wasProtected = $loansSheet.ProtectContents
    if ($wasProtected) { $loansSheet.Unprotect() }
    foreach ($cell in $loansSheet.UsedRange.Cells) {
        $cf = $cell.Formula
        if ($cf -is [string] -and $cf.Contains("AGGREGATE(15,6,(ROW(")) {
            $cell.Formula = $cf
        }
    }
    if ($wasProtected) {
        $loansSheet.Protect($null, $true, $true, $true, $true, $true, $true, $true, $true, $true, $true, $false, $true, $true, $true, $true)
    }
    $excel.CalculateFullRebuild()

    # Touch-up 2: comma-decimal number formats (0,00 / 0,0% / 0,00"x" /
    # +0,0%;-0,0%), needed on this Greek-locale machine for a cell's
    # number to actually display right (a PERIOD decimal in a stored
    # .number_format shows garbled — "002" instead of "1,66" — confirmed
    # via direct COM testing), get silently REWRITTEN by Excel itself the
    # first time it loads and re-saves an openpyxl-authored file: "0,00"
    # comes back out as "#.000", "0,0%" as "#.#00%", "0,00\"x\"" as
    # "#.000\"x\"" — all of which display wrong (DSCR "001", IRR "02%",
    # MOIC "003x" — exactly the symptom that got reported). Setting the
    # format directly via COM (not through openpyxl) does NOT get
    # rewritten, so re-applying the correct format to every affected cell
    # here, right before the final save, fixes it permanently — same
    # pattern as the AGGREGATE touch-up above.
    $fmtFix = @{
        '#.000'          = '0,00'
        '#.000%'         = '0,00%'
        '#.#00%'         = '0,0%'
        '+#.#00%;-#.#00%' = '+0,0%;-0,0%'
    }
    $fmtFixCount = 0
    foreach ($sh in $wb.Sheets) {
        $shProtected = $false
        try { $shProtected = $sh.ProtectContents } catch {}
        if ($shProtected) { $sh.Unprotect() }
        foreach ($cell in $sh.UsedRange.Cells) {
            $nf = $cell.NumberFormat
            if ($fmtFix.ContainsKey($nf)) {
                $cell.NumberFormat = $fmtFix[$nf]
                $fmtFixCount++
            } elseif ($nf -eq '#.000"x"') {
                $cell.NumberFormat = '0,00"x"'
                $fmtFixCount++
            }
        }
        if ($shProtected) {
            $sh.Protect($null, $true, $true, $true, $true, $true, $true, $true, $true, $true, $true, $false, $true, $true, $true, $true)
        }
    }
    Write-Output "Fixed $fmtFixCount mangled number formats."
    $excel.CalculateFullRebuild()

    $wb.Save()
    Write-Output "Pivot table + slicers added: $path"
}
finally {
    if ($wb) { $wb.Close($true) }
    $excel.Quit()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
}
