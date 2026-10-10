import { SubNav } from "@/components/SubNav";
import { el } from "@/lib/i18n/el";
import { SECTION_TABS } from "@/lib/navigation";
import { getUiVersion } from "@/lib/ui/version";

// Classic look: the Έργα · Ακίνητα · Μεσιτεία strip. The new look has no
// section tabs here -- a project's own tabs live in /projects/[id], and
// the portfolio links Ακίνητα / Μεσιτεία from its «⋯» until Phase 7.
export default async function ProjectsLayout({ children }: { children: React.ReactNode }) {
  if ((await getUiVersion("app")) === "v2") return children;
  return (
    <div className="flex flex-col gap-4">
      <SubNav tabs={SECTION_TABS.projects} label={el.nav.projects} />
      {children}
    </div>
  );
}
