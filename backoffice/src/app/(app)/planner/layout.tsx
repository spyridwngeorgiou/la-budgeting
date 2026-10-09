import { Suspense } from "react";
import { el } from "@/lib/i18n/el";
import { PlannerTabs } from "@/components/planner/PlannerNav";

export default function PlannerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{el.planner.title}</h1>
      {/* useSearchParams in the tabs needs a Suspense boundary of its own. */}
      <Suspense fallback={<div className="h-[37px] border-b border-line" />}>
        <PlannerTabs base="/planner" />
      </Suspense>
      {children}
    </div>
  );
}
