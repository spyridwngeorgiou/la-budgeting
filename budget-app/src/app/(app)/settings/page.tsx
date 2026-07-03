import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { ChangePasswordForm } from "./ChangePasswordForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-primary">Ρυθμίσεις</h1>
        <p className="text-sm text-muted">Λογαριασμός & ασφάλεια</p>
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
          <CardTitle>Αλλαγή κωδικού</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
