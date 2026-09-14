import { el } from "@/lib/i18n/el";
import { ChatPanel } from "./ChatPanel";

export default function AssistantPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{el.nav.assistant}</h1>
      <ChatPanel />
    </div>
  );
}
