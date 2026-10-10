import { notFound, redirect } from "next/navigation";
import { getUiVersion } from "@/lib/ui/version";
import { legacyHref, parseMoneyTab } from "@/features/money/tabs";
import { TransactionsTab } from "@/features/money/TransactionsTab";
import { FlowTab } from "@/features/money/FlowTab";
import { AccountsTab } from "@/features/money/AccountsTab";
import { ContactsTab } from "@/features/money/ContactsTab";
import { ReportsTab } from "@/features/money/ReportsTab";

// The five «Χρήματα» tabs in one optional catch-all segment, so the (app)
// page count stays within budget: /money (= /money/transactions),
// /money/flow, /money/accounts, /money/contacts, /money/reports.
export default async function MoneyPage({
  params,
  searchParams,
}: {
  params: Promise<{ tab?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ tab: slug }, sp, version] = await Promise.all([params, searchParams, getUiVersion("app")]);
  const tab = parseMoneyTab(slug);
  if (!tab) notFound();
  if (version === "v1") redirect(legacyHref(tab, sp));

  switch (tab) {
    case "transactions":
      return <TransactionsTab sp={sp} />;
    case "flow":
      return <FlowTab sp={sp} />;
    case "accounts":
      return <AccountsTab sp={sp} />;
    case "contacts":
      return <ContactsTab sp={sp} />;
    case "reports":
      return <ReportsTab sp={sp} />;
  }
}
