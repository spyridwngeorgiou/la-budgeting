"use client";

import { useId, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button, Field, FormDrawer, Input, Notice, Select, useConfirm, useToast } from "@/components/ui";
import { errorOf } from "@/lib/actions";
import { fillText } from "@/lib/collab/text";
import { el } from "@/lib/i18n/el";
import {
  createScenario,
  deleteScenario,
  duplicateScenario,
  renameScenario,
  sendScenarioToCash,
  setBaseScenario,
} from "./scenario-actions";

// The client parts of the scenario blocks (ScenarioSections.tsx): the
// «+ Νέο σενάριο» drawer, the selected scenario's visible «Ορισμός ως
// βάση» / «Μετονομασία» / «Διαγραφή» (no «⋯» menu), and the «Στείλε στο
// ταμείο» drawer of ΤΑΜΕΙΑΚΗ ΡΟΗ. Ids come in as plain props and go to the
// server actions as plain arguments (no per-row .bind -- see CLAUDE.md,
// Workers CPU).

const t = el.projectScenarios;

export function NewScenarioButton({
  projectId,
  sources,
  defaultSourceId,
}: {
  projectId: string;
  sources: { id: string; name: string }[];
  defaultSourceId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {t.add}
      </Button>
      {open && (
        <FormDrawer
          onClose={() => setOpen(false)}
          title={t.addTitle}
          action={async (formData) => {
            const from = String(formData.get("from") ?? "");
            const name = String(formData.get("name") ?? "");
            if (!from && !name.trim()) return { error: t.nameRequired };
            return from ? duplicateScenario(projectId, from, name) : createScenario(projectId, formData);
          }}
          onSuccess={(result) => {
            const id = (result as { data?: { id?: string } } | undefined)?.data?.id;
            if (id) router.push(`${pathname}?s=${id}`, { scroll: false });
          }}
        >
          <Field label={t.name} htmlFor="new-scenario-name">
            <Input id="new-scenario-name" name="name" maxLength={120} placeholder="π.χ. Απαισιόδοξο" />
          </Field>
          <Field label={t.startFrom} htmlFor="new-scenario-from">
            <Select id="new-scenario-from" name="from" defaultValue={defaultSourceId ?? ""}>
              <option value="">{t.blank}</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {fillText(t.copyOf, { name: s.name })}
                </option>
              ))}
            </Select>
          </Field>
        </FormDrawer>
      )}
    </>
  );
}

export function ScenarioRowActions({
  projectId,
  scenarioId,
  name,
  isBase,
  isSelected,
}: {
  projectId: string;
  scenarioId: string;
  name: string;
  isBase: boolean;
  isSelected: boolean;
}) {
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { confirm, dialog } = useConfirm();
  const router = useRouter();
  const pathname = usePathname();

  const run = (fn: () => Promise<unknown>, after?: () => void) =>
    startTransition(async () => {
      setError(null);
      const message = errorOf(await fn());
      if (message) setError(message);
      else after?.();
    });

  return (
    <>
      {!isBase && (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => run(() => setBaseScenario(projectId, scenarioId))}>
          {t.makeBase}
        </Button>
      )}
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => setRenaming(true)}>
        {t.rename}
      </Button>
      {!isBase && (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          className="text-negative hover:text-negative"
          onClick={async () => {
            if (!(await confirm({ message: fillText(t.confirmDelete, { name }), confirmLabel: t.delete }))) return;
            run(
              () => deleteScenario(projectId, scenarioId),
              // The page was showing it: back to the base.
              isSelected ? () => router.replace(pathname, { scroll: false }) : undefined,
            );
          }}
        >
          {t.delete}
        </Button>
      )}
      {dialog}
      {error && (
        <Notice tone="negative" role="alert" className="basis-full">
          {error}
        </Notice>
      )}
      {renaming && (
        <FormDrawer
          onClose={() => setRenaming(false)}
          title={t.renameTitle}
          action={(formData) => renameScenario(projectId, scenarioId, String(formData.get("name") ?? ""))}
        >
          <Field label={t.name} htmlFor={`rename-${scenarioId}`} required>
            <Input id={`rename-${scenarioId}`} name="name" defaultValue={name} maxLength={120} required />
          </Field>
        </FormDrawer>
      )}
    </>
  );
}

// «Στείλε στο ταμείο»: the visible button of ΤΑΜΕΙΑΚΗ ΡΟΗ and its small
// form (horizon, probability) in a drawer; a toast says how many rows went
// into the cash forecast.
export function SendToCashButton({ projectId, scenarioId, sent }: { projectId: string; scenarioId: string; sent: number }) {
  const s = el.sendToCash;
  const [open, setOpen] = useState(false);
  const { show } = useToast();
  const id = useId();
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {s.title}
      </Button>
      {open && (
        <FormDrawer
          onClose={() => setOpen(false)}
          title={s.title}
          submitLabel={sent > 0 ? s.resend : s.send}
          action={(formData) => sendScenarioToCash(projectId, scenarioId, formData)}
          onSuccess={(result) => {
            const written = (result as { data?: { written?: number } } | undefined)?.data?.written;
            if (written) show(`${written} ${s.sent}`);
          }}
        >
          <p className="text-small text-muted">{s.hint}</p>
          <Field label={s.months} htmlFor={`${id}-months`}>
            <Select id={`${id}-months`} name="months" defaultValue="24">
              {[12, 24, 36].map((m) => (
                <option key={m} value={m}>
                  {m} {s.monthsUnit}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={s.probability} htmlFor={`${id}-probability`}>
            <Input
              id={`${id}-probability`}
              type="number"
              name="probability_pct"
              min="1"
              max="100"
              step="5"
              defaultValue={80}
              className="num w-24"
            />
          </Field>
        </FormDrawer>
      )}
    </>
  );
}
