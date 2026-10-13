import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getMyProfile } from "@/lib/supabase/org";
import { getAccessContext } from "@/lib/supabase/access";
import { HOME_TILES_PATH, resolveHomePath } from "@/lib/homePath";
import { el } from "@/lib/i18n/el";
import { longDateLabel, todayAthens } from "@/lib/dates";

// "/" after sign-in: plain tiles, one per area, to choose where to go.
// A user who picked another start page in Settings → Προσωπικά is sent
// there instead. Static apart from that one profile read -- no figures.
const TILES: { href: string; label: string; description: string; minRole?: "editor" }[] = [
  { href: "/dashboard", label: el.nav.dashboard, description: "Ταμείο, πρόβλεψη και ό,τι χρειάζεται προσοχή." },
  { href: "/inbox", label: el.nav.inbox, description: "Νέες καταχωρίσεις και προτάσεις προς έγκριση.", minRole: "editor" },
  { href: "/assistant", label: el.nav.assistant, description: "Ρωτήστε οτιδήποτε για τα οικονομικά σας." },
  { href: "/transactions", label: el.nav.transactions, description: "Έσοδα, έξοδα, απαιτήσεις και υποχρεώσεις." },
  { href: "/accounts", label: el.nav.accounts, description: "Υπόλοιπα τραπεζών, ταμείων και καρτών." },
  { href: "/reports", label: el.nav.reports, description: "Ταμείο, αποτελέσματα, ΦΠΑ, χαρτοφυλάκιο." },
  { href: "/projects", label: el.nav.projects, description: "Προϋπολογισμός, δαπάνες και ορόσημα ανά έργο." },
  { href: "/planner", label: el.nav.planner, description: "Οι εργασίες όλων των έργων σε πίνακα." },
  { href: "/calendar", label: el.nav.calendar, description: "Πληρωμές, προθεσμίες και ορόσημα ανά ημέρα." },
  { href: "/contacts", label: el.nav.contacts, description: "Πελάτες, προμηθευτές και συνεργάτες." },
  { href: "/settings", label: el.nav.settings, description: "Οργανισμός, ομάδα και προσωπικές ρυθμίσεις." },
];

export default async function HomeTiles() {
  const supabase = await createClient();
  const [profile, access] = await Promise.all([getMyProfile(supabase), getAccessContext()]);
  // The (app) layout already sends anyone else away; this narrows the type.
  if (access.kind !== "internal") redirect("/login");
  const home = resolveHomePath(profile?.home_path);
  if (home !== HOME_TILES_PATH) redirect(home);

  // Same rule as the menu: viewers have no Εισερχόμενα.
  const tiles = TILES.filter((t) => !t.minRole || access.membership.role !== "viewer");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={longDateLabel(todayAthens())} title="Kansha" />
      <ul className="grid grid-cols-1 border-t border-l border-hairline sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => (
          <li key={t.href} className="border-r border-b border-hairline">
            <Link
              href={t.href}
              className="flex h-full min-h-32 flex-col gap-2 p-6 transition-colors hover:bg-hover focus-visible:bg-hover"
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-section font-normal text-ink">{t.label}</span>
                <span aria-hidden="true" className="text-muted">
                  →
                </span>
              </span>
              <span className="text-small text-muted">{t.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
