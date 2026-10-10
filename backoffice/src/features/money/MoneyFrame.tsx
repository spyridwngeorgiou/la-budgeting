import type { ReactNode } from "react";
import { PageHeader, Tabs } from "@/components/ui";
import { money } from "@/lib/i18n/v2/money";
import { moneyTabs } from "./tabs";

// The shared top of /money: the title, its one navy rule and the five tabs.
// Each tab brings its own toolbar (filters left, actions right).
export function MoneyFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={money.title}>
        <Tabs tabs={moneyTabs()} label={money.tabs.label} />
      </PageHeader>
      {children}
    </div>
  );
}
