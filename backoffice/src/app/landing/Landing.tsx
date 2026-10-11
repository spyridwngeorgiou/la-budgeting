import Link from "next/link";
import { LogoMark, Wordmark, buttonClass } from "@/components/ui";

// The public page at "/" for visitors who are not signed in: who Kansha is,
// what it does, and the way in. Static copy only -- nothing from the
// database -- drawn from the company profile in la_proposals
// (template/brand/kansha.yaml), in the P15 «Light Blue» look: a navy
// bookend, then the canvas with numbered services and hairlines.

const SERVICES = [
  { title: "Ανάπτυξη ακινήτων", body: "Από την επιλογή του ακινήτου ως την παράδοση, με πλήρη εικόνα κόστους και χρόνου." },
  { title: "Φιλοξενία", body: "Σχεδιασμός και λειτουργία χώρων φιλοξενίας με χαρακτήρα και σταθερή απόδοση." },
  { title: "Ολοκληρωμένες λύσεις 360°", body: "Στρατηγική, σχεδιασμός, μελέτες, κόστος και κατασκευή σε μία ενιαία διαδικασία." },
  { title: "Δημιουργική διεύθυνση", body: "Η ταυτότητα κάθε έργου, από την ιδέα ως την τελευταία λεπτομέρεια." },
  { title: "Τέχνη και styling", body: "Επιλογές υλικών, έργων και αντικειμένων που δίνουν ψυχή στον χώρο." },
  { title: "Επενδυτικές συμβουλές", body: "Αξιολόγηση ευκαιριών, σενάρια απόδοσης και χρηματοδότησης." },
  { title: "Τεχνική υποστήριξη", body: "Μηχανικοί και σύμβουλοι δίπλα σε κάθε απόφαση, με τεκμηρίωση." },
  { title: "Διαχείριση κατασκευής", body: "Πρόγραμμα, προϋπολογισμός και ποιότητα υπό συνεχή έλεγχο στο εργοτάξιο." },
];

const PLATFORM = [
  { title: "Για την ομάδα", body: "Έργα, ταμείο, αναφορές και πλάνο σε ένα σημείο, με ακρίβεια και διαφάνεια." },
  { title: "Για συνεργάτες", body: "Ο χώρος συνεργασίας κάθε έργου: πίνακες, αρχεία και συνομιλία με την ομάδα." },
  { title: "Για επενδυτές και πελάτες", body: "Η πρόοδος και τα νούμερα που αφορούν τον ρόλο σας, πάντα ενημερωμένα." },
];

export function Landing() {
  const year = new Date().getFullYear();
  return (
    <div className="min-h-screen bg-canvas text-text">
      {/* Navy bookend: the proposals' cover */}
      <header className="bg-panel text-panel-ink">
        <div className="mx-auto flex w-full max-w-page flex-col gap-16 px-6 py-8 md:px-12 md:py-12">
          <nav className="flex items-center justify-between gap-4" aria-label="Kansha">
            <span className="inline-flex items-center gap-3 text-panel-ink">
              <LogoMark size={32} />
              <Wordmark className="text-panel-ink" />
            </span>
            <Link href="/login" className="eyebrow text-panel-ink underline-offset-4 hover:underline">
              Σύνδεση
            </Link>
          </nav>

          <div className="flex max-w-3xl flex-col gap-6 pb-8 md:pb-16">
            <span className="eyebrow text-panel-muted">Kansha · Ανάπτυξη · Φιλοξενία · Επενδύσεις</span>
            <h1 className="text-display font-normal text-panel-ink">Από το όραμα στο χτισμένο αποτέλεσμα</h1>
            <span aria-hidden="true" className="block h-px w-full bg-panel-hairline" />
            <p className="max-w-2xl text-lead text-panel-muted">
              Στην Kansha πιστεύουμε ότι υπάρχει διαφορά ανάμεσα στο να οραματίζεσαι και στο να χτίζεις. Το όραμα
              εμπνέει· εμείς το κάνουμε πραγματικότητα. Μετατρέπουμε φιλόδοξες ιδέες σε χώρους που διαρκούν,
              ξεπερνώντας κάθε εμπόδιο στη διαδρομή.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Link href="/login" className={buttonClass("secondary", "md", "border-panel-ink bg-panel-ink text-panel hover:bg-panel-muted")}>
                Σύνδεση στην πλατφόρμα →
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-page flex-col gap-20 px-6 py-16 md:px-12 md:py-24">
        {/* Approach */}
        <section className="grid gap-8 md:grid-cols-[1fr_2fr]" aria-labelledby="approach">
          <div className="flex flex-col gap-3">
            <span className="eyebrow text-muted">01 · Προσέγγιση</span>
            <h2 id="approach" className="text-title font-normal text-ink">
              Κατανόηση πριν από κάθε απόφαση
            </h2>
          </div>
          <p className="max-w-2xl border-t border-navy pt-6 text-lead text-text">
            Κάθε έργο ξεκινά με κατανόηση, όχι με υποθέσεις. Φέρνουμε μαζί στρατηγική, σχεδιασμό, μηχανική, έλεγχο
            κόστους και εκτέλεση σε μία ενιαία διαδικασία, με πλήρη εποπτεία από την πρώτη ιδέα ως την τελική παράδοση.
          </p>
        </section>

        {/* Services: numbered, like the proposals' principles */}
        <section className="flex flex-col gap-8" aria-labelledby="services">
          <div className="flex flex-col gap-3">
            <span className="eyebrow text-muted">02 · Τι κάνουμε</span>
            <h2 id="services" className="text-title font-normal text-ink">
              Ένας συνεργάτης, από την ιδέα ως το κλειδί
            </h2>
            <span aria-hidden="true" className="block h-px w-full bg-navy" />
          </div>
          <ol className="grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {SERVICES.map((s, i) => (
              <li key={s.title} className="flex flex-col gap-2 border-t border-hairline pt-5">
                <span className="num text-figure-sm font-light text-accent">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-section font-normal text-ink">{s.title}</span>
                <span className="text-small text-muted">{s.body}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* The platform */}
        <section className="grid gap-8 md:grid-cols-[1fr_2fr]" aria-labelledby="platform">
          <div className="flex flex-col gap-3">
            <span className="eyebrow text-muted">03 · Η πλατφόρμα</span>
            <h2 id="platform" className="text-title font-normal text-ink">
              Ένας κοινός χώρος για όλους όσοι χτίζουν μαζί μας
            </h2>
            <p className="text-small text-muted">Ο καθένας βλέπει όσα αφορούν τον ρόλο του.</p>
          </div>
          <ul className="flex flex-col border-t border-navy">
            {PLATFORM.map((p) => (
              <li key={p.title} className="grid gap-1 border-b border-hairline py-5 sm:grid-cols-[14rem_1fr] sm:gap-6">
                <span className="text-body font-medium text-ink">{p.title}</span>
                <span className="text-body text-text">{p.body}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col items-start gap-4 border-t border-hairline pt-10">
          <span className="text-section font-normal text-ink">Είστε μέλος της ομάδας, συνεργάτης ή επενδυτής;</span>
          <Link href="/login" className={buttonClass("primary", "md")}>
            Σύνδεση →
          </Link>
        </section>
      </main>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex w-full max-w-page flex-col gap-2 px-6 py-8 text-small text-muted md:flex-row md:justify-between md:px-12">
          <span>© {year} Kansha</span>
          <span>Οι πληροφορίες της σελίδας είναι ενημερωτικές και δεν αποτελούν προσφορά.</span>
        </div>
      </footer>
    </div>
  );
}
