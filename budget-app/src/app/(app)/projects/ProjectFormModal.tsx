"use client";

import { useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { ModalShell } from "@/components/Modal";
import { PROJECT_STATUS_LABEL, type Project } from "@/lib/types";
import { createProject, updateProject } from "./actions";

export function ProjectFormModal({ project }: { project?: Project }) {
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
          <Button type="submit" className="w-full">
            {editing ? "Ενημέρωση" : "Αποθήκευση"}
          </Button>
        </form>
      </ModalShell>
    </>
  );
}
