import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { Sidebar } from "@/components/Sidebar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isSupabaseConfigured()) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-sm">
          <h1 className="mb-2 text-lg font-bold text-primary">
            Χρειάζεται ρύθμιση Supabase
          </h1>
          <p className="text-sm text-muted">
            Συμπλήρωσε τα κλειδιά στο αρχείο{" "}
            <code className="rounded bg-slate-100 px-1">.env.local</code> και
            κάνε επανεκκίνηση του server.
          </p>
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar email={user.email ?? ""} />
      <main className="flex-1 overflow-x-hidden p-4 md:p-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
