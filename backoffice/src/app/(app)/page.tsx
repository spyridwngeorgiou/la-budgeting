import { redirect } from "next/navigation";
import { getUiVersion } from "@/lib/ui/version";
import { HomeView } from "@/features/home/HomeView";

// "/": «Σήμερα» in the new look; the classic look keeps its dashboard.
// (Was src/app/page.tsx, a bare redirect; it moved into (app) for the
// shell, the error boundary and the access checks of the layout.)
export default async function RootPage() {
  if ((await getUiVersion("app")) !== "v2") redirect("/dashboard");
  return <HomeView />;
}
