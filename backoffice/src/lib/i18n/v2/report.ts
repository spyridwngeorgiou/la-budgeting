// Texts of the report building blocks (components/ui/ReportSection,
// BandChart), presentation mode and print (components/PresentMode).
export const report = {
  chart: {
    lowest: "χαμηλότερο",
    belowThreshold: "Μήνες κάτω από το όριο",
  },
  method: "Πώς υπολογίζεται",
  detail: "Αναλυτικά",
  footer: {
    source: "Πηγή: Kansha",
    updated: "ενημερώθηκε",
    dataUntil: "δεδομένα έως",
  },
  present: {
    start: "Παρουσίαση",
    exit: "Έξοδος παρουσίασης",
    prev: "Προηγούμενη",
    next: "Επόμενη",
    nav: "Πλοήγηση παρουσίασης",
    of: "από",
  },
  print: {
    button: "Εκτύπωση / PDF",
    confidential: "Εμπιστευτικό",
  },
} as const;
