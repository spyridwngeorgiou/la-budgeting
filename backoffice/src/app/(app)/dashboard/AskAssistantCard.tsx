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
    <section className="rounded-lg border border-ai-border bg-ai-bg/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        <AiSpark className="text-ai-ink" />
        <h2 className="text-sm font-medium text-ai-ink">Ρωτήστε τον βοηθό</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        {QUESTIONS.map((q) => (
          <Link
            key={q}
            href={`/assistant?q=${encodeURIComponent(q)}`}
            className="rounded-full border border-ai-border bg-surface px-3 py-1.5 text-xs text-ai-ink hover:bg-ai-bg"
          >
            {q}
          </Link>
        ))}
        <Link href="/assistant" className="rounded-full px-3 py-1.5 text-xs text-ink-muted underline hover:text-ink">
          Άλλη ερώτηση →
        </Link>
      </div>
    </section>
  );
}
