import Image from "next/image";
import { el } from "@/lib/i18n/el";
import { SubmitButton } from "@/components/SubmitButton";
import { signIn } from "./actions";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <Image
        src="/kansha-logo.png"
        alt="Kansha"
        width={220}
        height={82}
        priority
        className="mx-auto"
      />
      <h1 className="text-center text-sm text-ink-muted">{el.auth.signIn}</h1>
      <form action={signIn} className="flex flex-col gap-3">
        <input
          name="email"
          type="email"
          placeholder={el.auth.email}
          required
          className="rounded-md border border-line-strong px-3 py-2"
        />
        <input
          name="password"
          type="password"
          placeholder={el.auth.password}
          required
          className="rounded-md border border-line-strong px-3 py-2"
        />
        <SubmitButton className="w-full">{el.auth.signIn}</SubmitButton>
      </form>
    </main>
  );
}
