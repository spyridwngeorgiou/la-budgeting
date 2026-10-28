import Image from "next/image";
import { el } from "@/lib/i18n/el";
import { SubmitButton } from "@/components/SubmitButton";
import { signIn } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
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
      {error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          Η είσοδος δεν έγινε. Έλεγξε email και κωδικό.
        </p>
      )}
      <form action={signIn} className="flex flex-col gap-3">
        <input
          name="email"
          type="email"
          placeholder={el.auth.email}
          required
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="rounded border border-line-strong px-3 py-2"
        />
        <input
          name="password"
          type="password"
          placeholder={el.auth.password}
          required
          autoComplete="current-password"
          className="rounded border border-line-strong px-3 py-2"
        />
        <SubmitButton className="w-full">{el.auth.signIn}</SubmitButton>
      </form>
    </main>
  );
}
