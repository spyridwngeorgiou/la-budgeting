import { redirect } from "next/navigation";

// «Αναφορές» opens on its first tab.
export default function ReportsPage() {
  redirect("/reports/cash");
}
