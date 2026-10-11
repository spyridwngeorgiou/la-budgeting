import { Button, Field, Input } from "@/components/ui";
import { currentYear } from "@/lib/dates";
import { createRevenuePlan } from "./actions";

// «ή ξεκίνα μια κενή ανάλυση χειροκίνητα»: the same form on the revenue
// plans page and on a project's page (there with its project_id). A server
// component; the fields are createRevenuePlan's contract.
export function ManualPlanForm({ projectId }: { projectId?: string }) {
  const id = (name: string) => `manual-plan-${name}`;
  return (
    <details className="border-y border-hairline">
      <summary className="flex min-h-11 cursor-pointer items-center text-sm text-ink hover:underline">
        ή ξεκίνα μια κενή ανάλυση χειροκίνητα
      </summary>
      <form action={createRevenuePlan} className="flex flex-wrap items-end gap-3 pb-4">
        {projectId && <input type="hidden" name="project_id" value={projectId} />}
        <Field label="Όνομα" htmlFor={id("name")} className="min-w-48 flex-1">
          <Input id={id("name")} name="name" required />
        </Field>
        <Field label="Έτος Έναρξης" htmlFor={id("start")}>
          <Input id={id("start")} name="start_year" type="number" defaultValue={currentYear()} required className="num w-28" />
        </Field>
        <Field label="Έτη" htmlFor={id("years")}>
          <Input id={id("years")} name="years" type="number" min={1} max={10} defaultValue={3} required className="num w-20" />
        </Field>
        <Button type="submit" variant="secondary" className="max-md:min-h-11">
          Δημιουργία
        </Button>
      </form>
    </details>
  );
}
