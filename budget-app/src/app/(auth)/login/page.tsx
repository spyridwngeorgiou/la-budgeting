import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { AuthForm } from "../AuthForm";
import { signIn } from "../actions";

export default function LoginPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base text-foreground">Σύνδεση</CardTitle>
      </CardHeader>
      <CardContent>
        <AuthForm action={signIn} mode="login" />
      </CardContent>
    </Card>
  );
}
