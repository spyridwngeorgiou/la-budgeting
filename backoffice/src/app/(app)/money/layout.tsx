import { redirect } from "next/navigation";
import { getAccessContext } from "@/lib/supabase/access";
import { getUiVersion } from "@/lib/ui/version";
import { MoneyFrame } from "@/features/money/MoneyFrame";

// /money («Χρήματα», new look): one header and five tabs over
// ./[[...tab]]/page.tsx. Staff only -- the proxy and the (app) layout
// already send partners to /collab; this is the next line. The classic
// look has no frame: its page redirects to the legacy equivalent.
export default async function MoneyLayout({ children }: { children: React.ReactNode }) {
  const access = await getAccessContext();
  if (access.kind === "anonymous") redirect("/login");
  if (access.kind === "partner") redirect("/collab");
  if ((await getUiVersion("app")) === "v1") return children;
  return <MoneyFrame>{children}</MoneyFrame>;
}
