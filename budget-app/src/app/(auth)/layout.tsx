import { Wallet } from "lucide-react";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-fg">
            <Wallet size={24} />
          </div>
          <h1 className="text-xl font-bold text-primary">LA Budgeting</h1>
          <p className="text-sm text-muted">Διαχείριση προϋπολογισμού έργων</p>
        </div>
        {children}
      </div>
    </div>
  );
}
