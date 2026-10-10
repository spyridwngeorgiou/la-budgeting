"use client";

import { useState } from "react";
import {
  Button,
  Drawer,
  Field,
  FormDrawer,
  FormModal,
  Input,
  Menu,
  MenuItem,
  MenuLink,
  MenuSeparator,
  Modal,
  MoneyInput,
  Select,
  TrendChart,
  useToast,
} from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { DEMO_CASH } from "./fixtures";

// The interactive half of /design: dialogs, menu, toast and the chart
// (all client components). Nothing here writes anything.

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function OverlayDemos() {
  const [open, setOpen] = useState<null | "drawer" | "formDrawer" | "modal" | "formModal">(null);
  const { show } = useToast();
  const close = () => setOpen(null);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" onClick={() => setOpen("drawer")}>
        Drawer
      </Button>
      <Button variant="secondary" onClick={() => setOpen("formDrawer")}>
        FormDrawer
      </Button>
      <Button variant="secondary" onClick={() => setOpen("modal")}>
        Modal
      </Button>
      <Button variant="secondary" onClick={() => setOpen("formModal")}>
        FormModal (σφάλμα)
      </Button>
      <Menu>
        <MenuItem onClick={() => show("Αντιγράφηκε ο σύνδεσμος")}>Αντιγραφή συνδέσμου</MenuItem>
        <MenuLink href="/design">Άνοιγμα</MenuLink>
        <MenuSeparator />
        <MenuItem tone="danger" onClick={() => show("Διαγράφηκε (όχι στ’ αλήθεια)", { action: { label: "Αναίρεση", onClick: () => show("Αναιρέθηκε") } })}>
          Διαγραφή
        </MenuItem>
      </Menu>
      <Button onClick={() => show("Αποθηκεύτηκε")}>Toast</Button>
      <Button variant="danger" onClick={() => show("Η σύνδεση με την τράπεζα απέτυχε", { tone: "negative" })}>
        Toast σφάλματος
      </Button>

      {open === "drawer" && (
        <Drawer
          onClose={close}
          eyebrow="Κίνηση · 05/10/2026"
          title="Τιμολόγιο αρχιτέκτονα"
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={close}>
                Κλείσιμο
              </Button>
              <Button onClick={() => setOpen("formDrawer")}>Επεξεργασία</Button>
            </div>
          }
        >
          <p className="text-sm text-text">
            Διάβασε πρώτα, επεξεργάσου σε συρτάρι. Στο κινητό το συρτάρι γεμίζει την οθόνη· στον υπολογιστή ανοίγει
            από δεξιά και η σελίδα πίσω μένει ανενεργή.
          </p>
        </Drawer>
      )}
      {open === "formDrawer" && (
        <FormDrawer
          onClose={close}
          eyebrow="Νέα κίνηση"
          title="Χειροκίνητη καταχώριση"
          action={async () => {
            await wait(600);
            show("Αποθηκεύτηκε");
          }}
        >
          <Field label="Περιγραφή" htmlFor="d-desc">
            <Input id="d-desc" name="description" defaultValue="ΔΕΗ λογαριασμός ρεύματος" />
          </Field>
          <Field label="Ποσό" htmlFor="d-amount" hint="Αρνητικό για έξοδο">
            <MoneyInput id="d-amount" name="amount" defaultValue="−184,60" />
          </Field>
          <Field label="Έργο" htmlFor="d-project">
            <Select id="d-project" name="project" defaultValue="q004">
              <option value="q004">Q004 Ηλιούπολη</option>
              <option value="p15">P15 Residences</option>
            </Select>
          </Field>
        </FormDrawer>
      )}
      {open === "modal" && (
        <Modal onClose={close} title="Αναίρεση εισαγωγής;">
          <p className="text-sm text-text">Οι 48 κινήσεις του αρχείου θα αφαιρεθούν. Μπορείτε να το ανεβάσετε ξανά.</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>
              Άκυρο
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                close();
                show("Αναιρέθηκε");
              }}
            >
              Αναίρεση
            </Button>
          </div>
        </Modal>
      )}
      {open === "formModal" && (
        <FormModal
          onClose={close}
          title="Μετονομασία"
          action={async () => {
            await wait(400);
            return { error: "Υπάρχει ήδη λογαριασμός με αυτό το όνομα." };
          }}
        >
          <Field label="Όνομα" htmlFor="m-name">
            <Input id="m-name" name="name" defaultValue="Eurobank όψεως" />
          </Field>
        </FormModal>
      )}
    </div>
  );
}

export function ChartDemo() {
  return (
    <TrendChart
      data={DEMO_CASH}
      xKey="month"
      series={[
        { key: "cash", name: "Ταμείο" },
        { key: "plan", name: "Πλάνο" },
      ]}
      format={formatMoney}
      threshold={{ value: 50000, label: "Όριο ταμείου" }}
      todayX="Οκτ"
      label="Ταμείο και πλάνο, τελευταίοι 12 μήνες"
    />
  );
}
