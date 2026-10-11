import { AiSpark, Button, Input } from "@/components/ui";

// «Ρωτήστε τον βοηθό»: one line, a plain GET form to /assistant?q=, which
// asks straight away (ChatPanel sends ?q= once on arrival). No client JS.
export function AskAssistantCard() {
  return (
    <form action="/assistant" method="get" className="flex items-center gap-2 border-l-2 border-ai-border py-1 pl-4">
      <AiSpark className="shrink-0 text-ai" />
      <Input
        name="q"
        required
        maxLength={500}
        autoComplete="off"
        aria-label="Ρωτήστε τον βοηθό"
        placeholder="Ρωτήστε τον βοηθό — π.χ. Ποιος μας χρωστάει και πόσα;"
        className="min-w-0 flex-1"
      />
      <Button type="submit" variant="ai" className="shrink-0">
        Ρωτήστε →
      </Button>
    </form>
  );
}
