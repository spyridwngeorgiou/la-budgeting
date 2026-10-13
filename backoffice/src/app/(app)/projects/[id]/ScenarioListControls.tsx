"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button, Field, FormDrawer, Input, Menu, MenuItem, Notice, Select } from "@/components/ui";
import { errorOf } from "@/lib/actions";
import { fillText } from "@/lib/collab/text";
import { el } from "@/lib/i18n/el";
import { createScenario, deleteScenario, duplicateScenario, renameScenario, setBaseScenario } from "./scenario-actions";

// The client parts of the «Σενάρια» list (ScenarioSections.tsx): the
// «+ Νέο σενάριο» drawer and each row's «Ορισμός ως βάση» / «⋯». Ids come
// in as plain props and go to the server actions as plain arguments (no
// per-row .bind -- see CLAUDE.md, Workers CPU).

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
      <Menu label={t.actions}>
        <MenuItem onClick={() => setRenaming(true)}>{t.rename}</MenuItem>
        {!isBase && (
          <MenuItem
            tone="danger"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(fillText(t.confirmDelete, { name }))) return;
              run(
                () => deleteScenario(projectId, scenarioId),
                // The page was showing it: back to the base.
                isSelected ? () => router.replace(pathname, { scroll: false }) : undefined,
              );
            }}
          >
            {t.delete}
          </MenuItem>
        )}
      </Menu>
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
          <Field label={t.name} htmlFor={`rename-${scenarioId}`}>
            <Input id={`rename-${scenarioId}`} name="name" defaultValue={name} maxLength={120} required />
          </Field>
        </FormDrawer>
      )}
    </>
  );
}
