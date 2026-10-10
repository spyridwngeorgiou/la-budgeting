import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/Toast";
import type { ShellRole } from "@/lib/navigation";
import { BottomBar } from "./BottomBar";
import { Rail } from "./Rail";
import { TopBar } from "./TopBar";

// The v2 shell («Νέα εμφάνιση»): rail on the left from md up, top bar,
// bottom bar on phones, the page on the canvas. Rendered by the (app)
// layout when getUiVersion() says v2; the classic Nav otherwise.
//
// --sticky-top tells DataTable heads to stick under the top bar.
export function AppShell({
  children,
  role,
  orgs,
  currentOrgId,
  email,
  pendingCount,
}: {
  children: ReactNode;
  role: ShellRole;
  orgs: { id: string; name: string }[];
  currentOrgId: string | null;
  email: string | null;
  pendingCount: number;
}) {
  const orgName = orgs.find((o) => o.id === currentOrgId)?.name ?? null;
  return (
    <ToastProvider>
      <div className="flex min-h-dvh bg-canvas text-text">
        <Rail role={role} pendingCount={pendingCount} orgs={orgs} currentOrgId={currentOrgId} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar role={role} orgName={orgName} email={email} pendingCount={pendingCount} />
          <main
            id="main"
            className="flex-1 px-4 pt-6 pb-[calc(var(--spacing-bottombar)+2rem)] [--sticky-top:var(--spacing-topbar)] md:px-8 md:pt-8 md:pb-12"
          >
            <div className="mx-auto w-full max-w-7xl">{children}</div>
          </main>
        </div>
        <BottomBar role={role} />
      </div>
    </ToastProvider>
  );
}
