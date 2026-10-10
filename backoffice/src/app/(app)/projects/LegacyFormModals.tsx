"use client";

import { useState, type ReactNode } from "react";
import { Button, FormModal, type ButtonSize, type ButtonVariant } from "@/components/ui";
import {
  BudgetFields,
  CapitalFields,
  LoanFields,
  NoteFields,
  OpexFields,
  ProjectFields,
  ScenarioFields,
  UtilityFields,
  type BudgetInitial,
  type CapitalSourceInitial,
  type LoanInitial,
  type OpexLineInitial,
  type ProjectInitial,
  type ProjectNoteInitial,
  type ScenarioInitial,
  type UtilityInitial,
} from "./fields";

export { UTILITY_KIND_LABELS } from "./fields";

// The project page's edit dialogs: a button and a centred modal around the
// field sets in ./fields.tsx; these replace the nine *FormModal files.

type Action = (formData: FormData) => Promise<unknown>;

const PANEL = "max-h-[90vh] w-[calc(100%-2rem)] max-w-md overflow-y-auto border border-hairline bg-raised p-5";

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
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && (
        <FormModal onClose={() => setOpen(false)} title={title} action={action} className={PANEL}>
          {children}
        </FormModal>
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

export function CapitalSourceFormModal({ action, initial, trigger }: { action: Action; initial?: CapitalSourceInitial; trigger?: string }) {
  return (
    <LegacyModal label={trigger ?? "+ Κεφάλαιο"} action={action}>
      <CapitalFields initial={initial} />
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
