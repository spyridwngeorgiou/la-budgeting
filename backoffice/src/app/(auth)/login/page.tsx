import Image from "next/image";
import { el } from "@/lib/i18n/el";
import { SubmitButton } from "@/components/SubmitButton";
import { signIn, sendMagicLink } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; link?: string }>;
}) {
  const { error, link } = await searchParams;

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

      {error && <p className="rounded-md bg-red-bg px-3 py-2 text-sm text-red-ink">{error}</p>}
      {link === "sent" && <p className="rounded-md bg-sage px-3 py-2 text-sm text-sage-ink">{el.magicLink.sent}</p>}
      {link === "invalid" && (
        <p className="rounded-md bg-amber-bg px-3 py-2 text-sm text-amber-ink">{el.magicLink.invalid}</p>
      )}

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

      {/* Native <details>: the alternative needs no client JS, and stays
          open after a "sent" round trip so the partner sees the result. */}
      <details className="group text-sm" open={link === "sent" || link === "invalid"}>
        <summary className="cursor-pointer text-center text-ink-muted hover:text-ink">{el.magicLink.toggle}</summary>
        <form action={sendMagicLink} className="mt-3 flex flex-col gap-3">
          <input
            name="email"
            type="email"
            placeholder={el.auth.email}
            required
            className="rounded-md border border-line-strong px-3 py-2"
          />
          <SubmitButton variant="secondary" className="w-full">
            {el.magicLink.send}
          </SubmitButton>
        </form>
      </details>
    </main>
  );
}
