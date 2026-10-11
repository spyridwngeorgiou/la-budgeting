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
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 bg-canvas px-4">
      <Image
        src="/kansha-logo.png"
        alt="Kansha"
        width={220}
        height={82}
        priority
        className="mx-auto"
      />
      <h1 className="border-b border-rule pb-3 text-center text-title font-normal text-ink">{el.auth.signIn}</h1>

      {error && (
        <p role="alert" className="border-l-2 border-negative pl-3 text-sm text-negative">
          {error}
        </p>
      )}
      {link === "sent" && <p className="border-l-2 border-positive pl-3 text-sm text-positive">{el.magicLink.sent}</p>}
      {link === "invalid" && (
        <p className="border-l-2 border-warning pl-3 text-sm text-warning">{el.magicLink.invalid}</p>
      )}

      <form action={signIn} className="flex flex-col gap-3">
        <input
          name="email"
          type="email"
          placeholder={el.auth.email}
          required
          className="min-h-11 border border-field-border bg-field px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-navy focus:outline-none"
        />
        <input
          name="password"
          type="password"
          placeholder={el.auth.password}
          required
          className="min-h-11 border border-field-border bg-field px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-navy focus:outline-none"
        />
        <SubmitButton className="min-h-11 w-full">{el.auth.signIn}</SubmitButton>
      </form>

      {/* Native <details>: the alternative needs no client JS, and stays
          open after a "sent" round trip so the partner sees the result. */}
      <details className="group border-t border-hairline pt-4 text-sm" open={link === "sent" || link === "invalid"}>
        <summary className="flex min-h-11 cursor-pointer items-center justify-center text-muted hover:text-ink">{el.magicLink.toggle}</summary>
        <form action={sendMagicLink} className="mt-3 flex flex-col gap-3">
          <input
            name="email"
            type="email"
            placeholder={el.auth.email}
            required
            className="min-h-11 border border-field-border bg-field px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-navy focus:outline-none"
          />
          <SubmitButton variant="secondary" className="min-h-11 w-full">
            {el.magicLink.send}
          </SubmitButton>
        </form>
      </details>
    </main>
  );
}
