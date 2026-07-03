import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { AuthForm } from "../AuthForm";
import { signUp } from "../actions";

export default function SignupPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base text-foreground">
          Δημιουργία λογαριασμού
        </CardTitle>
      </CardHeader>
      <CardContent>
        <AuthForm action={signUp} mode="signup" />
      </CardContent>
    </Card>
  );
}
