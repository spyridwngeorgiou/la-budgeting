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
      <h1 className="text-xl font-semibold">{el.nav.assistant}</h1>
      <ChatPanel initialPrompt={q} />
    </div>
  );
}
