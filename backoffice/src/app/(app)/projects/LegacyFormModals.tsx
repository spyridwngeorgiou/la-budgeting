"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import { ArgsActionForm } from "@/components/ArgsActionForm";
import { Button, FormDrawer, useConfirm, type ButtonSize, type ButtonVariant } from "@/components/ui";
import type { ActionResult } from "@/lib/actions";
import { el } from "@/lib/i18n/el";
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
// replace the nine *FormModal files. The drawer's title names the action
// («Νέο δάνειο», «Επεξεργασία δανείου»).
//
// The server page passes the plain server action and its leading
// arguments (`args`, e.g. [projectId, rowId]); on save this calls
// action(...args, formData) -- no action.bind(null, id) per row, which Next
// would encrypt on every render (see CLAUDE.md, Workers CPU).

/* eslint-disable @typescript-eslint/no-explicit-any -- a server action's leading arguments vary */
type Action = (...args: any[]) => Promise<unknown>;
type DeleteAction = (...args: any[]) => Promise<ActionResult<unknown> | void>;
/* eslint-enable @typescript-eslint/no-explicit-any */
type Args = (string | number | boolean | null)[];

interface ModalProps {
  action: Action;
  args?: Args;
  // The button's label (default: the «+ Νέο …» or «Επεξεργασία» of the form).
  trigger?: string;
  // The drawer's title, when the default does not fit the button.
  title?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

function LegacyModal({
  label,
  title,
  action,
  args = [],
  variant = "secondary",
  size = "sm",
  children,
}: {
  label: string;
  title: string;
  action: Action;
  args?: Args;
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
        <FormDrawer onClose={() => setOpen(false)} title={title} action={(formData) => action(...args, formData)}>
          {children}
        </FormDrawer>
      )}
    </>
  );
}

const t = el.projectPage.forms;

export function ProjectFormModal({ initial, trigger, title, variant = "primary", size = "md", ...rest }: ModalProps & { initial?: ProjectInitial }) {
  return (
    <LegacyModal
      label={trigger ?? (initial ? t.editProject : t.newProject)}
      title={title ?? (initial ? t.editProject : t.newProjectTitle)}
      variant={variant}
      size={size}
      {...rest}
    >
      <ProjectFields initial={initial} />
    </LegacyModal>
  );
}

export function BudgetFormModal({ initial, trigger, title, size = "md", ...rest }: ModalProps & { initial?: BudgetInitial }) {
  return (
    <LegacyModal
      label={trigger ?? (initial ? t.budget : t.newBudget)}
      title={title ?? (initial ? t.editBudgetTitle : t.newBudgetTitle)}
      size={size}
      {...rest}
    >
      <BudgetFields initial={initial} />
    </LegacyModal>
  );
}

export function ProjectNoteFormModal({ initial, trigger, title, ...rest }: ModalProps & { initial?: ProjectNoteInitial }) {
  return (
    <LegacyModal
      label={trigger ?? (initial ? el.common.edit : t.newNote)}
      title={title ?? (initial ? t.editNoteTitle : t.newNoteTitle)}
      {...rest}
    >
      <NoteFields initial={initial} />
    </LegacyModal>
  );
}

export function UtilityFormModal({ initial, trigger, title, ...rest }: ModalProps & { initial?: UtilityInitial }) {
  return (
    <LegacyModal
      label={trigger ?? (initial ? el.common.edit : t.newUtility)}
      title={title ?? (initial ? t.editUtilityTitle : t.newUtilityTitle)}
      {...rest}
    >
      <UtilityFields initial={initial} />
    </LegacyModal>
  );
}

export function LoanFormModal({ initial, trigger, title, ...rest }: ModalProps & { initial?: LoanInitial }) {
  return (
    <LegacyModal
      label={trigger ?? (initial ? el.common.edit : t.newLoan)}
      title={title ?? (initial ? t.editLoanTitle : t.newLoanTitle)}
      {...rest}
    >
      <LoanFields initial={initial} />
    </LegacyModal>
  );
}

export function ScenarioFormModal({ initial, trigger, title, size = "sm", ...rest }: ModalProps & { initial?: ScenarioInitial }) {
  return (
    <LegacyModal
      label={trigger ?? (initial ? t.editAssumptions : t.newScenario)}
      title={title ?? (initial ? t.editAssumptions : t.newScenarioTitle)}
      size={size}
      {...rest}
    >
      <ScenarioFields initial={initial} />
    </LegacyModal>
  );
}

export function OpexLineFormModal({ initial, trigger, title, ...rest }: ModalProps & { initial?: OpexLineInitial }) {
  return (
    <LegacyModal
      label={trigger ?? (initial ? el.common.edit : t.newOpexLine)}
      title={title ?? (initial ? t.editOpexLineTitle : t.newOpexLineTitle)}
      {...rest}
    >
      <OpexFields initial={initial} />
    </LegacyModal>
  );
}

// A row's visible «Διαγραφή»: one click, the app's «Είστε σίγουροι;», then
// action(...args). Any error shows under the button; on success the row is
// gone (the action revalidates the page).
export function ArgsDeleteButton({ action, args, label = el.common.delete }: { action: DeleteAction; args: Args; label?: string }) {
  const { confirm, dialog } = useConfirm();
  async function confirmFirst(e: MouseEvent<HTMLButtonElement>) {
    // The form is read before the await: the event is gone after it.
    const form = e.currentTarget.form;
    e.preventDefault();
    if (form && (await confirm({ message: `${label}; ${t.cannotUndo}`, confirmLabel: label }))) form.requestSubmit();
  }
  return (
    <>
      <ArgsActionForm action={action} args={args}>
        <Button type="submit" variant="ghost" size="sm" onClick={confirmFirst} className="text-negative hover:text-negative">
          {label}
        </Button>
      </ArgsActionForm>
      {dialog}
    </>
  );
}
