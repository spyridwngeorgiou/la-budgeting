import { el } from "@/lib/i18n/el";
import { SubmitButton } from "@/components/SubmitButton";
import { Field, Input, LogoMark, Notice, PageHeader, Wordmark } from "@/components/ui";
import { signIn, sendMagicLink } from "./actions";

// Sign-in, in the proposals' cover style: a navy panel with the brush mark
// and the company line on the left (a short band on a phone), the form on
// the canvas on the right. Same two ways in as before -- password, or a
// link sent by email -- and the same messages.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; link?: string }>;
}) {
  const { error, link } = await searchParams;
  const year = new Date().getFullYear();

  return (
    <main className="grid min-h-screen bg-canvas md:grid-cols-2">
      {/* Navy cover */}
      <section className="flex flex-col justify-between gap-10 bg-panel px-6 py-8 text-panel-ink md:px-12 md:py-12">
        <span className="inline-flex items-center gap-3">
          <LogoMark size={32} />
          <Wordmark className="text-panel-ink" />
        </span>
        <div className="hidden max-w-md flex-col gap-6 md:flex">
          <span className="eyebrow text-panel-muted">Back office</span>
          <p className="text-display font-light text-panel-ink">Από το όραμα στο χτισμένο αποτέλεσμα</p>
          <span aria-hidden="true" className="block h-px w-16 bg-panel-ink" />
          <p className="text-lead text-panel-muted">
            Έργα, ταμείο, αναφορές και συνεργασία σε έναν χώρο, για την ομάδα, τους συνεργάτες και τους επενδυτές.
          </p>
        </div>
        <span className="hidden flex-wrap items-center justify-between gap-4 border-t border-panel-hairline pt-5 md:flex">
          <span className="eyebrow text-panel-muted">Ανάπτυξη · Φιλοξενία · Επενδύσεις</span>
          <span className="text-small text-panel-muted">© {year} Kansha</span>
        </span>
      </section>

      {/* The form */}
      <section className="flex items-center justify-center px-6 py-10 md:px-12">
        <div className="flex w-full max-w-sm flex-col gap-8">
          <PageHeader eyebrow="Καλώς ήρθατε" title={el.auth.signIn} />

          {error && (
            <Notice tone="negative" role="alert">
              {error}
            </Notice>
          )}
          {link === "sent" && <Notice tone="positive">{el.magicLink.sent}</Notice>}
          {link === "invalid" && <Notice tone="warning">{el.magicLink.invalid}</Notice>}

          <form action={signIn} className="flex flex-col gap-5">
            <Field label={el.auth.email} htmlFor="login-email">
              <Input id="login-email" name="email" type="email" autoComplete="email" required className="min-h-11" />
            </Field>
            <Field label={el.auth.password} htmlFor="login-password">
              <Input id="login-password" name="password" type="password" autoComplete="current-password" required className="min-h-11" />
            </Field>
            <SubmitButton className="mt-1 min-h-11 w-full">{el.auth.signIn}</SubmitButton>
          </form>

          {/* Native <details>: no client JS, and it stays open after a "sent"
              round trip so the partner sees the result. */}
          <details className="group flex flex-col" open={link === "sent" || link === "invalid"}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-4 text-small text-muted hover:text-ink">
              <span aria-hidden="true" className="h-px flex-1 bg-hairline" />
              <span>ή {el.magicLink.toggle.toLocaleLowerCase("el")}</span>
              <span aria-hidden="true" className="h-px flex-1 bg-hairline" />
            </summary>
            <form action={sendMagicLink} className="mt-4 flex flex-col gap-4">
              <Field label={el.auth.email} htmlFor="magic-email" hint="Θα λάβετε έναν σύνδεσμο μίας χρήσης.">
                <Input id="magic-email" name="email" type="email" autoComplete="email" required className="min-h-11" />
              </Field>
              <SubmitButton variant="secondary" className="min-h-11 w-full">
                {el.magicLink.send}
              </SubmitButton>
            </form>
          </details>

          <p className="text-small text-muted">Πρόβλημα με τη σύνδεση; Επικοινωνήστε με τον διαχειριστή της εταιρείας σας.</p>
        </div>
      </section>
    </main>
  );
}
