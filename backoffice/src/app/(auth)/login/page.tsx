import { el } from "@/lib/i18n/el";
import { SubmitButton } from "@/components/SubmitButton";
import { Input, LogoMark, Notice, Wordmark } from "@/components/ui";
import { signIn, sendMagicLink } from "./actions";

// Sign-in, nothing else: the brand mark, two fields, one button. The same
// two ways in as before -- password, or a link sent by email (the small
// link under the form) -- and the same messages. Labels are for screen
// readers; the fields carry placeholders.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; link?: string }>;
}) {
  const { error, link } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6">
      {/* The page's only heading, for screen readers. */}
      <span className="sr-only" role="heading" aria-level={1}>
        {el.auth.signIn}
      </span>
      <div className="flex w-full max-w-xs flex-col items-center gap-6">
        <span className="flex flex-col items-center gap-4 text-navy">
          <LogoMark size={56} />
          <Wordmark className="text-ink" />
        </span>

        <div className="flex w-full flex-col gap-4">
          {error && (
            <Notice tone="negative" role="alert">
              {error}
            </Notice>
          )}
          {link === "sent" && <Notice tone="positive">{el.magicLink.sent}</Notice>}
          {link === "invalid" && <Notice tone="warning">{el.magicLink.invalid}</Notice>}

          <form action={signIn} className="flex flex-col gap-3">
            <label htmlFor="login-email" className="sr-only">
              {el.auth.email}
            </label>
            <Input id="login-email" name="email" type="email" autoComplete="email" placeholder={el.auth.email} required className="min-h-11" />
            <label htmlFor="login-password" className="sr-only">
              {el.auth.password}
            </label>
            <Input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder={el.auth.password}
              required
              className="min-h-11"
            />
            <SubmitButton className="mt-2 min-h-11 w-full">{el.auth.signIn}</SubmitButton>
          </form>

          {/* Native <details>: no client JS; stays open after a "sent" round trip. */}
          <details className="flex flex-col" open={link === "sent" || link === "invalid"}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center text-small text-muted hover:text-ink">
              {el.magicLink.toggle}
            </summary>
            <form action={sendMagicLink} className="mt-2 flex flex-col gap-3">
              <label htmlFor="magic-email" className="sr-only">
                {el.auth.email}
              </label>
              <Input id="magic-email" name="email" type="email" autoComplete="email" placeholder={el.auth.email} required className="min-h-11" />
              <SubmitButton variant="secondary" className="min-h-11 w-full">
                {el.magicLink.send}
              </SubmitButton>
            </form>
          </details>
        </div>
      </div>
    </main>
  );
}
