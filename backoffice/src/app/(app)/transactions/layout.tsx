import { SubNav } from "@/components/SubNav";
import { el } from "@/lib/i18n/el";
import { SECTION_TABS } from "@/lib/navigation";

export default function TransactionsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <SubNav tabs={SECTION_TABS.transactions} label={el.nav.transactions} />
      {children}
    </div>
  );
}
