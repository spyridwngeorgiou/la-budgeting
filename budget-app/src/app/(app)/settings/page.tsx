import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getHouseholdId } from "@/lib/household";
import { Card, CardContent, CardHeader, CardTitle, Button } from "@/components/ui";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { InviteForm } from "./InviteForm";
import { removeCollaborator } from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const householdId = await getHouseholdId();

  // Resolve household members with emails (admin, server-only)
  let members: { user_id: string; role: string; email: string }[] = [];
  if (householdId) {
    const admin = createAdminClient();
    const { data: rows } = await admin
      .from("household_members")
      .select("user_id, role")
      .eq("household_id", householdId);
    const { data: userList } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    members = (rows ?? []).map((r) => ({
      user_id: r.user_id,
      role: r.role,
      email: userList?.users.find((u) => u.id === r.user_id)?.email ?? "—",
    }));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-primary">Ρυθμίσεις</h1>
        <p className="text-sm text-muted">Λογαριασμός, ασφάλεια & συνεργάτες</p>
      </div>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Στοιχεία λογαριασμού</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm">
            <span className="text-muted">Email: </span>
            <span className="font-medium">{user?.email}</span>
          </p>
        </CardContent>
      </Card>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Κοινό budget — Συνεργάτες</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted">
            Όσοι προστεθούν εδώ βλέπουν και επεξεργάζονται τα{" "}
            <strong>ίδια</strong> δεδομένα με εσένα.
          </p>

          <ul className="divide-y divide-border rounded-lg border border-border">
            {members.map((m) => (
              <li
                key={m.user_id}
                className="flex items-center justify-between px-3 py-2 text-sm"
              >
                <span>
                  {m.email}
                  <span className="ml-2 text-xs text-muted">
                    ({m.role === "owner" ? "ιδιοκτήτης" : m.role})
                  </span>
                </span>
                {m.user_id !== user?.id && (
                  <form action={removeCollaborator}>
                    <input type="hidden" name="user_id" value={m.user_id} />
                    <Button
                      variant="ghost"
                      type="submit"
                      className="text-negative"
                    >
                      Αφαίρεση
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>

          <InviteForm />
        </CardContent>
      </Card>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Αλλαγή κωδικού</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
