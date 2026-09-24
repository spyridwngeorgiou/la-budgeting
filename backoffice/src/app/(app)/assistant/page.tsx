import { el } from "@/lib/i18n/el";
import { ChatPanel } from "./ChatPanel";

export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{el.nav.assistant}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Ρωτήστε ελεύθερα για τα οικονομικά της επιχείρησης -- κάθε απάντηση βασίζεται σε
          πραγματικά δεδομένα, ποτέ σε εικασία, και συνδέεται με τις κινήσεις πίσω από κάθε αριθμό.
        </p>
      </div>
      <ChatPanel initialPrompt={q} />
    </div>
  );
}
