"""
Single source of truth for Greek-literal -> enum mapping, mirrored by hand in
backoffice/src/lib/domain/enums.ts. Keep the two in lockstep.

migrate_workbook.py fails loudly on any literal not present here rather than
silently defaulting -- silent defaulting is how 102 rows become 102 wrong
rows.
"""

DIRECTION = {
    "Έσοδο": "income",
    "Έξοδο": "expense",
}

STATUS = {
    "Πληρωμένο": "paid",
    "Εκκρεμεί": "pending",
    "Προγραμματισμένο": "scheduled",
    "Σε αναμονή": "pending",
    "Ακυρώθηκε": "cancelled",
}

SCOPE = {
    "Επιχειρηματικό": "business",
    "Προσωπικό": "personal",
}

ORIGIN = {
    "AADE": "aade",
    "Χειρόγραφο": "manual",
    "Τραπεζικό αρχείο": "bank_file",
    # Entered in the app first, then copied back into the workbook -- a
    # person typed it by hand, so it's 'manual' (tx_origin has no 'app').
    "Εφαρμογή": "manual",
}

# Short property names used in Καθημερινά col M «Ακίνητο» and in the
# Ρυθμίσεις «ΠΑΡΟΧΕΣ ΑΝΑ ΑΚΙΝΗΤΟ» block -> project code. Matched on a
# normalized prefix (see property_code_for), fail-loud on anything unknown.
PROPERTY_SHORT_NAME = {
    "ΗΛΙΟΥΠΟΛΗ": "Q001_ILIOUPOLI_P15_RESIDENCES",
    "ΛΑΖΑΡΑΚΗ": "Q003_LAZARAKI32_GLYFADA",
    "ΑΓ. ΚΩΝΣΤΑΝΤΙΝΟΥ": "Q004_AGIOU_KWNSTANTINOU20_GLYFADA",
    "ΑΓΙΟΥ ΚΩΝΣΤΑΝΤΙΝΟΥ": "Q004_AGIOU_KWNSTANTINOU20_GLYFADA",
    "ΚΑΒΟΥΡΙ": "Q006_KAVOURI_AKTIS2",
    "ΚΟΛΩΝΑΚΙ": "Q007_KOLONAKI_KARNEADOU37",
}


def _strip_accents_upper(value: str) -> str:
    import unicodedata
    decomposed = unicodedata.normalize("NFD", value)
    return "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn").upper().strip()


def property_code_for(short_name: str, *, row: int | None = None) -> str:
    """'Καβούρι, Ακτής 2' / 'Ηλιούπολη' -> project code; raises if unknown."""
    key = _strip_accents_upper(short_name)
    for prefix, code in PROPERTY_SHORT_NAME.items():
        if key.startswith(prefix):
            return code
    where = f" (row {row})" if row is not None else ""
    raise UnmappedLiteralError(
        f"Unmapped property name {short_name!r}{where}. Add it to PROPERTY_SHORT_NAME in tools/mappings.py."
    )

OWNER_SCOPE = {
    "Εταιρικός": "corporate",
    "Προσωπικός": "personal",
}

ACCOUNT_KIND = {
    "Τράπεζα": "bank",
    "Μετρητά": "cash",
    "Χρυσός": "gold",
    "Κρυπτονομίσματα (Exodus)": "crypto",
}

PROJECT_TYPE = {
    "Κατασκευή": "construction",
    "Εγκατάσταση": "installation",
    "Ανακαίνιση": "renovation",
    "Φιλοξενία": "hospitality",
    "Γενικά": "general",
}

PROJECT_STATUS = {
    "Προσφορά": "offer",
    "Ενεργό": "active",
    "Σε αναμονή": "on_hold",
    "Ολοκληρωμένο": "completed",
    "Ακυρωμένο": "cancelled",
}

BUSINESS_MODEL = {
    "Ιδιόκτητη Ανάπτυξη": "own_development",
    "Έργο Πελάτη": "client_project",
    "Ξενοδοχείο / Μίσθωση": "hotel_lease",
    "Γενικά": "general",
}

CERTAINTY = {
    "Βέβαιο": "certain",
    "Πιθανό": "probable",
}

YES_NO = {
    "Ναι": True,
    "Όχι": False,
}


class UnmappedLiteralError(ValueError):
    """Raised when a Greek literal in the workbook has no enum mapping.

    Fail loudly rather than defaulting -- an unmapped literal silently
    defaulting is exactly how a migration produces confidently wrong data.
    """


def map_literal(mapping: dict, value, *, column: str, row: int | None = None):
    if value is None or (isinstance(value, str) and value.strip() == ""):
        return None
    key = value.strip() if isinstance(value, str) else value
    if key not in mapping:
        where = f" (row {row})" if row is not None else ""
        raise UnmappedLiteralError(
            f"Unmapped literal {key!r} in column {column!r}{where}. "
            f"Add it to tools/mappings.py and its mirror in "
            f"backoffice/src/lib/domain/enums.ts before re-running."
        )
    return mapping[key]
