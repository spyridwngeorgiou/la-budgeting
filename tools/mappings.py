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
}

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
