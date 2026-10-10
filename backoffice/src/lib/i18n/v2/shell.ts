// Texts of the shared ui/ pieces (src/components/ui) and the (app) error
// page. Other texts of the restyled pieces go in src/lib/i18n/v2/<area>.ts.
export const shell = {
  ui: {
    more: "Περισσότερα",
    close: "Κλείσιμο",
    actions: "Ενέργειες",
    total: "Σύνολο",
    empty: "Δεν υπάρχουν εγγραφές",
    glance: "Με μια ματιά",
    severity: { urgent: "Επείγον", attention: "Προσοχή", info: "Ενημέρωση" },
  },
  error: {
    title: "Κάτι πήγε στραβά",
    body: "Παρουσιάστηκε ένα απρόσμενο σφάλμα. Δοκιμάστε ξανά, ή επιστρέψτε αργότερα.",
    code: "Κωδικός",
    retry: "Δοκιμάστε ξανά",
  },
} as const;
