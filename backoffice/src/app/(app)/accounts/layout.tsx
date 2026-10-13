import { Tabs } from "@/components/ui";
import { el } from "@/lib/i18n/el";
import { SECTION_TABS } from "@/lib/navigation";

// Λογαριασμοί: the accounts, then the two hand-kept lists the reports read
// (Περιουσία & υποχρεώσεις, Αναμενόμενα έσοδα). /accounts/[id] lights
// «Λογαριασμοί» (activeTab: the longest matching href); the static
// /accounts/assets and /accounts/expected win over [id] in the router.
export default function AccountsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Tabs tabs={SECTION_TABS.accounts} label={el.nav.accounts} />
      {children}
    </div>
  );
}
