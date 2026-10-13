// Texts of the report building blocks (components/ui/ReportSection,
// BandChart).
export const report = {
  chart: {
    lowest: "χαμηλότερο",
    belowThreshold: "Μήνες κάτω από το όριο",
  },
  history: "Ιστορικό ανά μήνα",
  footer: {
    updated: "ενημερώθηκε",
    dataUntil: "Δεδομένα έως",
    issues: (n: number) => `${n} ${n === 1 ? "θέμα" : "θέματα"} ποιότητας →`,
  },
} as const;
