"use client";

import { useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { ModalShell } from "@/components/Modal";
import {
  PROJECT_STATUS_LABEL,
  PROJECT_RISK_LABEL,
  type Project,
  type Contact,
} from "@/lib/types";
import { createProject, updateProject } from "./actions";

export function ProjectFormModal({
  project,
  contacts,
}: {
  project?: Project;
  contacts: Contact[];
}) {
  const [open, setOpen] = useState(false);
  const editing = Boolean(project);

  return (
    <>
      {editing ? (
        <Button variant="secondary" type="button" onClick={() => setOpen(true)}>
          <Pencil size={14} /> Επεξεργασία
        </Button>
      ) : (
        <Button type="button" onClick={() => setOpen(true)}>
          <Plus size={16} /> Νέο έργο
        </Button>
      )}

      <ModalShell
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Επεξεργασία έργου" : "Νέο έργο"}
      >
        <form
          action={editing ? updateProject : createProject}
          onSubmit={() => setOpen(false)}
          className="space-y-4"
        >
          {editing && <input type="hidden" name="id" value={project!.id} />}
          <div>
            <Label>Όνομα έργου</Label>
            <Input name="name" defaultValue={project?.name} required />
          </div>
          <div>
            <Label>Περιγραφή</Label>
            <Textarea
              name="description"
              rows={2}
              defaultValue={project?.description ?? ""}
            />
          </div>
          <div>
            <Label>Κατάσταση</Label>
            <Select name="status" defaultValue={project?.status ?? "active"}>
              {Object.entries(PROJECT_STATUS_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Προϋπολογισμός στόχος (€)</Label>
              <Input
                name="budget_target"
                type="number"
                step="0.01"
                min="0"
                defaultValue={project?.budget_target ?? ""}
              />
            </div>
            <div>
              <Label>Επίπεδο ρίσκου</Label>
              <Select name="risk_level" defaultValue={project?.risk_level ?? "medium"}>
                {Object.entries(PROJECT_RISK_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label>Υπεύθυνη επαφή</Label>
            <Select name="owner_contact_id" defaultValue={project?.owner_contact_id ?? ""}>
              <option value="">— Καμία —</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Ημ/νία έναρξης</Label>
              <Input name="start_date" type="date" defaultValue={project?.start_date ?? ""} />
            </div>
            <div>
              <Label>Ημ/νία λήξης</Label>
              <Input name="end_date" type="date" defaultValue={project?.end_date ?? ""} />
            </div>
          </div>
          <Button type="submit" className="w-full">
            {editing ? "Ενημέρωση" : "Αποθήκευση"}
          </Button>
        </form>
      </ModalShell>
    </>
  );
}
