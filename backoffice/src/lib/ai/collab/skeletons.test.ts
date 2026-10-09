import { describe, expect, it } from "vitest";
import { canvasPreview, canvasSpecToSkeletons, validateCanvasSpec } from "./skeletons";
import { plannerProposalSchema } from "./proposals";

describe("validateCanvasSpec", () => {
  it("accepts each layout", () => {
    expect(validateCanvasSpec({ layout: "sticky_notes", notes: [{ text: "Α" }, { text: "Β", color: "blue" }] }).ok).toBe(true);
    expect(validateCanvasSpec({ layout: "mind_map", center: "Έργο", branches: [{ text: "Άδειες", children: ["ΥΔΟΜ"] }] }).ok).toBe(true);
    expect(
      validateCanvasSpec({
        layout: "flowchart",
        steps: [{ id: "a", text: "Αρχή", shape: "start_end" }, { id: "b", text: "Έλεγχος;", shape: "decision" }],
        edges: [{ from: "a", to: "b", label: "ναι" }],
      }).ok,
    ).toBe(true);
  });

  it("rejects missing parts, unknown edges and extra properties", () => {
    expect(validateCanvasSpec({ layout: "sticky_notes", notes: [] }).ok).toBe(false);
    expect(validateCanvasSpec({ layout: "mind_map", branches: [{ text: "x" }] }).ok).toBe(false);
    expect(
      validateCanvasSpec({ layout: "flowchart", steps: [{ id: "a", text: "x" }], edges: [{ from: "a", to: "zzz" }] }).ok,
    ).toBe(false);
    expect(validateCanvasSpec({ layout: "flowchart", steps: [{ id: "a", text: "x" }, { id: "a", text: "y" }] }).ok).toBe(false);
    // Anything outside the schema -- links, data URLs, raw elements -- is refused, not dropped.
    expect(validateCanvasSpec({ layout: "sticky_notes", notes: [{ text: "x", link: "https://evil" }] }).ok).toBe(false);
    expect(validateCanvasSpec({ layout: "sticky_notes", notes: [{ text: "x" }], elements: [{}] }).ok).toBe(false);
    expect(validateCanvasSpec({ layout: "svg", notes: [{ text: "x" }] }).ok).toBe(false);
    expect(validateCanvasSpec(null).ok).toBe(false);
  });

  it("caps sizes", () => {
    const notes = Array.from({ length: 41 }, (_, i) => ({ text: `n${i}` }));
    expect(validateCanvasSpec({ layout: "sticky_notes", notes }).ok).toBe(false);
    expect(validateCanvasSpec({ layout: "sticky_notes", notes: [{ text: "x".repeat(301) }] }).ok).toBe(false);
    expect(validateCanvasSpec({ layout: "flowchart", steps: [{ id: "bad id!", text: "x" }] }).ok).toBe(false);
  });
});

describe("canvasSpecToSkeletons", () => {
  it("builds notes centred on the origin, with labels and no links", () => {
    const r = validateCanvasSpec({ layout: "sticky_notes", title: "Ιδέες", notes: [{ text: "Α" }, { text: "Β" }, { text: "Γ" }, { text: "Δ" }] });
    if (!r.ok) throw new Error(r.error);
    const sk = canvasSpecToSkeletons(r.spec, { x: 1000, y: 500 });
    const rects = sk.filter((s) => s.type === "rectangle");
    expect(rects).toHaveLength(4);
    expect(sk.find((s) => s.type === "text")).toMatchObject({ text: "Ιδέες" });
    const xs = rects.map((s) => s.x as number);
    expect((Math.min(...xs) + Math.max(...xs) + 200) / 2).toBe(1000);
    for (const s of sk) expect(s).not.toHaveProperty("link");
  });

  it("wires arrows to their nodes for mind maps and flowcharts", () => {
    const mm = validateCanvasSpec({ layout: "mind_map", center: "Κ", branches: [{ text: "Α", children: ["α1", "α2"] }, { text: "Β" }] });
    if (!mm.ok) throw new Error(mm.error);
    const sk = canvasSpecToSkeletons(mm.spec, { x: 0, y: 0 });
    const arrows = sk.filter((s) => s.type === "arrow") as { start?: { id?: string }; end?: { id?: string } }[];
    expect(arrows).toHaveLength(4);
    const ids = new Set(sk.map((s) => (s as { id?: string }).id).filter(Boolean));
    for (const a of arrows) {
      expect(ids.has(a.start?.id)).toBe(true);
      expect(ids.has(a.end?.id)).toBe(true);
    }

    const fc = validateCanvasSpec({
      layout: "flowchart",
      steps: [{ id: "a", text: "1" }, { id: "b", text: "2", shape: "decision" }, { id: "c", text: "3" }],
      edges: [{ from: "a", to: "b" }, { from: "b", to: "c", label: "ναι" }, { from: "c", to: "a" }],
    });
    if (!fc.ok) throw new Error(fc.error);
    const fsk = canvasSpecToSkeletons(fc.spec, { x: 0, y: 0 });
    expect(fsk.filter((s) => s.type === "diamond")).toHaveLength(1);
    expect(fsk.filter((s) => s.type === "arrow")).toHaveLength(3); // a cycle still terminates
    expect(canvasPreview(fc.spec).count).toBe(3);
  });
});

describe("plannerProposalSchema", () => {
  it("requires due dates for milestones and ordered ranges", () => {
    expect(plannerProposalSchema.safeParse({ kind: "tasks", items: [{ title: "Μέτρηση" }] }).success).toBe(true);
    expect(plannerProposalSchema.safeParse({ kind: "milestones", items: [{ title: "Άδεια" }] }).success).toBe(false);
    expect(
      plannerProposalSchema.safeParse({ kind: "tasks", items: [{ title: "x", start_date: "2026-05-02", due_date: "2026-05-01" }] }).success,
    ).toBe(false);
    expect(plannerProposalSchema.safeParse({ kind: "tasks", items: [{ title: "x", project_id: "other" }] }).success).toBe(false);
  });
});
