"use client";

import { useState, type ReactNode } from "react";
import { Button, FormDrawer, type ButtonSize, type ButtonVariant } from "@/components/ui";
import {
  BudgetFields,
  LoanFields,
  NoteFields,
  OpexFields,
  ProjectFields,
  ScenarioFields,
  UtilityFields,
  type BudgetInitial,
  type LoanInitial,
  type OpexLineInitial,
  type ProjectInitial,
  type ProjectNoteInitial,
  type ScenarioInitial,
  type UtilityInitial,
} from "./fields";

export { UTILITY_KIND_LABELS } from "./fields";

// The project page's edit dialogs: a button and a side drawer (a full
// screen sheet on phones) around the field sets in ./fields.tsx; these
// replace the nine *FormModal files.

type Action = (formData: FormData) => Promise<unknown>;

// The drawer's title when none is given: the button's label without «+ ».
const titleOf = (label: string) => label.replace(/^\+\s*/, "");

function LegacyModal({
  label,
  title,
  action,
  variant = "secondary",
  size = "sm",
  children,
}: {
  label: string;
  title?: string;
  action: Action;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)} className="present-hide print-hide">
        {label}
      </Button>
      {open && (
        <FormDrawer onClose={() => setOpen(false)} title={title ?? titleOf(label)} action={action}>
          {children}
        </FormDrawer>
      )}
    </>
  );
}

export function ProjectFormModal({ action, initial, trigger }: { action: Action; initial?: ProjectInitial; trigger?: string }) {
  return (
    <LegacyModal label={trigger ?? "+ Νέο Έργο"} action={action} variant="primary" size="md">
      <ProjectFields initial={initial} />
    </LegacyModal>
  );
}

export function BudgetFormModal({ action, initial }: { action: Action; initial?: BudgetInitial }) {
  return (
    <LegacyModal label={initial ? "Επεξεργασία Προϋπολογισμού" : "+ Προϋπολογισμός"} action={action} size="md">
      <BudgetFields initial={initial} />
    </LegacyModal>
  );
}

export function ProjectNoteFormModal({ action, initial, trigger }: { action: Action; initial?: ProjectNoteInitial; trigger?: string }) {
  return (
    <LegacyModal label={trigger ?? "+ Σημείωση"} action={action}>
      <NoteFields initial={initial} />
    </LegacyModal>
  );
}

export function UtilityFormModal({ action, initial, trigger }: { action: Action; initial?: UtilityInitial; trigger?: string }) {
  return (
    <LegacyModal label={trigger ?? "+ Παροχή"} action={action}>
      <UtilityFields initial={initial} />
    </LegacyModal>
  );
}

export function LoanFormModal({ action, initial, trigger }: { action: Action; initial?: LoanInitial; trigger?: string }) {
  return (
    <LegacyModal label={trigger ?? "+ Δάνειο"} title={initial?.id ? "Επεξεργασία δανείου" : "Νέο δάνειο"} action={action}>
      <LoanFields initial={initial} />
    </LegacyModal>
  );
}

export function ScenarioFormModal({ action, initial, trigger }: { action: Action; initial?: ScenarioInitial; trigger?: string }) {
  return (
    <LegacyModal label={trigger ?? "Επεξεργασία Παραδοχών"} action={action} size="md">
      <ScenarioFields initial={initial} />
    </LegacyModal>
  );
}

export function OpexLineFormModal({ action, initial, trigger }: { action: Action; initial?: OpexLineInitial; trigger?: string }) {
  return (
    <LegacyModal label={trigger ?? "+ Γραμμή Opex"} action={action}>
      <OpexFields initial={initial} />
    </LegacyModal>
  );
}
