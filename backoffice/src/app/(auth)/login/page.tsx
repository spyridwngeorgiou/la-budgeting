import Image from "next/image";
import { el } from "@/lib/i18n/el";
import { SubmitButton } from "@/components/SubmitButton";
import { Notice, PageHeader } from "@/components/ui";
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
      <PageHeader title={el.auth.signIn} />

      {error && (
        <Notice tone="negative" role="alert">
          {error}
        </Notice>
      )}
      {link === "sent" && <Notice tone="positive">{el.magicLink.sent}</Notice>}
      {link === "invalid" && (
        <Notice tone="warning">{el.magicLink.invalid}</Notice>
      )}

      <form action={signIn} className="flex flex-col gap-3">
        <input
          name="email"
          type="email"
          placeholder={el.auth.email}
          required
          className="min-h-11 border border-field-border bg-field px-3 py-2 text-field text-ink placeholder:text-muted md:text-body focus:border-navy focus:outline-none"
        />
        <input
          name="password"
          type="password"
          placeholder={el.auth.password}
          required
          className="min-h-11 border border-field-border bg-field px-3 py-2 text-field text-ink placeholder:text-muted md:text-body focus:border-navy focus:outline-none"
        />
        <SubmitButton className="min-h-11 w-full">{el.auth.signIn}</SubmitButton>
      </form>

      {/* Native <details>: the alternative needs no client JS, and stays
          open after a "sent" round trip so the partner sees the result. */}
      <details className="group border-t border-hairline pt-4 text-body" open={link === "sent" || link === "invalid"}>
        <summary className="flex min-h-11 cursor-pointer items-center justify-center text-muted hover:text-ink">{el.magicLink.toggle}</summary>
        <form action={sendMagicLink} className="mt-3 flex flex-col gap-3">
          <input
            name="email"
            type="email"
            placeholder={el.auth.email}
            required
            className="min-h-11 border border-field-border bg-field px-3 py-2 text-field text-ink placeholder:text-muted md:text-body focus:border-navy focus:outline-none"
          />
          <SubmitButton variant="secondary" className="min-h-11 w-full">
            {el.magicLink.send}
          </SubmitButton>
        </form>
      </details>
    </main>
  );
}
