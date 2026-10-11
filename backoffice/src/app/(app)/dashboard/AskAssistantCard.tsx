import Link from "next/link";
import { AiSpark } from "@/components/ui";

const QUESTIONS = [
  "Πώς θα είναι το ταμείο τους επόμενους 6 μήνες;",
  "Ποιος μας χρωστάει και πόσα;",
  "Ποια είναι η θέση ΦΠΑ αυτόν τον μήνα;",
  "Πόσα ξοδέψαμε φέτος ανά έργο;",
];

// «Ρωτήστε τον βοηθό»: one-click questions that open /assistant and ask
// straight away (ChatPanel sends ?q= once on arrival).
export function AskAssistantCard() {
  return (
    <section className="border-l-2 border-ai-border py-1 pl-4">
      <div className="mb-2 flex items-center gap-2">
        <AiSpark className="text-ai" />
        <h2 className="eyebrow text-ai">Ρωτήστε τον βοηθό</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        {QUESTIONS.map((q) => (
          <Link
            key={q}
            href={`/assistant?q=${encodeURIComponent(q)}`}
            className="inline-flex min-h-9 items-center border border-ai-border px-3 py-1.5 text-xs text-ai hover:bg-ai-tint"
          >
            {q}
          </Link>
        ))}
        <Link href="/assistant" className="inline-flex min-h-9 items-center px-3 py-1.5 text-xs text-muted underline underline-offset-4 hover:text-ink">
          Άλλη ερώτηση →
        </Link>
      </div>
    </section>
  );
}
