import { z } from "zod";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import { el } from "@/lib/i18n/el";

// Canvas proposals from the board assistant.
//
// The model never writes Excalidraw elements directly: it describes WHAT to
// draw (notes, a mind map, a flowchart) in this small schema, and the
// deterministic layout below turns that into skeletons. So a proposal can't
// carry links, images, data URLs, giant coordinates or any other Excalidraw
// property -- only short texts, a colour from a fixed palette, and edges
// between its own nodes. The same validation runs on the server (before a
// proposal is stored) and in the browser (before anything is placed), and
// placing still goes through the normal sync path and upsert_board_elements.

const text = (max: number) => z.string().trim().min(1).max(max);
export const NOTE_COLORS = ["yellow", "blue", "green", "pink", "violet"] as const;

export const canvasSpecSchema = z
  .object({
    layout: z.enum(["sticky_notes", "mind_map", "flowchart"]),
    title: text(120).optional(),
    notes: z
      .array(z.object({ text: text(300), color: z.enum(NOTE_COLORS).optional() }).strict())
      .max(40)
      .optional(),
    center: text(120).optional(),
    branches: z
      .array(z.object({ text: text(120), children: z.array(text(120)).max(8).optional() }).strict())
      .max(10)
      .optional(),
    steps: z
      .array(
        z
          .object({
            id: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
            text: text(160),
            shape: z.enum(["process", "decision", "start_end"]).optional(),
          })
          .strict(),
      )
      .max(30)
      .optional(),
    edges: z
      .array(
        z
          .object({
            from: z.string().max(32),
            to: z.string().max(32),
            label: text(60).optional(),
          })
          .strict(),
      )
      .max(60)
      .optional(),
  })
  .strict()
  .superRefine((spec, ctx) => {
    if (spec.layout === "sticky_notes" && !spec.notes?.length) {
      ctx.addIssue({ code: "custom", message: "sticky_notes needs at least one note" });
    }
    if (spec.layout === "mind_map" && (!spec.center || !spec.branches?.length)) {
      ctx.addIssue({ code: "custom", message: "mind_map needs a center and at least one branch" });
    }
    if (spec.layout === "flowchart") {
      if (!spec.steps?.length) {
        ctx.addIssue({ code: "custom", message: "flowchart needs at least one step" });
        return;
      }
      const ids = new Set(spec.steps.map((s) => s.id));
      if (ids.size !== spec.steps.length) ctx.addIssue({ code: "custom", message: "step ids must be unique" });
      for (const e of spec.edges ?? []) {
        if (!ids.has(e.from) || !ids.has(e.to)) {
          ctx.addIssue({ code: "custom", message: `edge ${e.from}->${e.to} names an unknown step` });
        }
      }
    }
  });

export type CanvasSpec = z.infer<typeof canvasSpecSchema>;

export function validateCanvasSpec(input: unknown): { ok: true; spec: CanvasSpec } | { ok: false; error: string } {
  const parsed = canvasSpecSchema.safeParse(input);
  if (parsed.success) return { ok: true, spec: parsed.data };
  return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".") || "spec"}: ${i.message}`).join("; ") };
}

const FILLS: Record<(typeof NOTE_COLORS)[number], { bg: string; stroke: string }> = {
  yellow: { bg: "#ffec99", stroke: "#f08c00" },
  blue: { bg: "#d0ebff", stroke: "#1971c2" },
  green: { bg: "#d3f9d8", stroke: "#2f9e44" },
  pink: { bg: "#ffdeeb", stroke: "#c2255c" },
  violet: { bg: "#e5dbff", stroke: "#6741d9" },
};

type Node = {
  id: string;
  type: "rectangle" | "ellipse" | "diamond";
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: (typeof NOTE_COLORS)[number];
  fontSize: number;
};
type Edge = { from: string; to: string; label?: string };
export interface CanvasLayout {
  title?: string;
  nodes: Node[];
  edges: Edge[];
}

// Coordinates are relative to the layout's own centre (0,0); the caller
// shifts them to wherever the user is looking.
export function layoutCanvasSpec(spec: CanvasSpec): CanvasLayout {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  if (spec.layout === "sticky_notes") {
    const notes = spec.notes ?? [];
    const cols = Math.ceil(Math.sqrt(notes.length));
    const size = 200;
    const gap = 30;
    const rows = Math.ceil(notes.length / cols);
    const w = cols * size + (cols - 1) * gap;
    const h = rows * size + (rows - 1) * gap;
    notes.forEach((n, i) => {
      nodes.push({
        id: `n${i}`,
        type: "rectangle",
        x: -w / 2 + (i % cols) * (size + gap),
        y: -h / 2 + Math.floor(i / cols) * (size + gap),
        width: size,
        height: size,
        text: n.text,
        color: n.color ?? "yellow",
        fontSize: 18,
      });
    });
  } else if (spec.layout === "mind_map") {
    nodes.push({ id: "c", type: "ellipse", x: -140, y: -60, width: 280, height: 120, text: spec.center ?? "", color: "violet", fontSize: 22 });
    const branches = spec.branches ?? [];
    branches.forEach((b, i) => {
      const angle = (2 * Math.PI * i) / branches.length - Math.PI / 2;
      const bx = Math.cos(angle) * 420;
      const by = Math.sin(angle) * 300;
      const id = `b${i}`;
      nodes.push({ id, type: "rectangle", x: bx - 110, y: by - 40, width: 220, height: 80, text: b.text, color: "blue", fontSize: 18 });
      edges.push({ from: "c", to: id });
      const kids = b.children ?? [];
      kids.forEach((k, j) => {
        const spread = kids.length > 1 ? (j / (kids.length - 1) - 0.5) * 0.9 : 0;
        const ka = angle + spread;
        const kx = Math.cos(ka) * 760;
        const ky = Math.sin(ka) * 560;
        const kid = `b${i}k${j}`;
        nodes.push({ id: kid, type: "rectangle", x: kx - 100, y: ky - 32, width: 200, height: 64, text: k, color: "green", fontSize: 16 });
        edges.push({ from: id, to: kid });
      });
    });
  } else {
    const steps = spec.steps ?? [];
    const flowEdges = spec.edges ?? [];
    // Layer = longest path from a source; capped so a cycle can't loop.
    const layer = new Map<string, number>(steps.map((s) => [s.id, 0]));
    for (let pass = 0; pass < steps.length; pass++) {
      let changed = false;
      for (const e of flowEdges) {
        const next = (layer.get(e.from) ?? 0) + 1;
        if (e.from !== e.to && next > (layer.get(e.to) ?? 0) && next < steps.length) {
          layer.set(e.to, next);
          changed = true;
        }
      }
      if (!changed) break;
    }
    const byLayer = new Map<number, string[]>();
    for (const s of steps) {
      const l = layer.get(s.id) ?? 0;
      byLayer.set(l, [...(byLayer.get(l) ?? []), s.id]);
    }
    const layers = [...byLayer.keys()].sort((a, b) => a - b);
    const rowH = 180;
    const colW = 280;
    const totalH = (layers.length - 1) * rowH;
    for (const l of layers) {
      const ids = byLayer.get(l) ?? [];
      ids.forEach((id, i) => {
        const s = steps.find((x) => x.id === id)!;
        const shape = s.shape ?? "process";
        const width = 220;
        const height = shape === "decision" ? 120 : 90;
        nodes.push({
          id: `s_${id}`,
          type: shape === "decision" ? "diamond" : shape === "start_end" ? "ellipse" : "rectangle",
          x: (i - (ids.length - 1) / 2) * colW - width / 2,
          y: layers.indexOf(l) * rowH - totalH / 2 - height / 2,
          width,
          height,
          text: s.text,
          color: shape === "decision" ? "pink" : shape === "start_end" ? "green" : "blue",
          fontSize: 16,
        });
      });
    }
    for (const e of flowEdges) {
      if (e.from !== e.to) edges.push({ from: `s_${e.from}`, to: `s_${e.to}`, label: e.label });
    }
  }
  return { title: spec.title, nodes, edges };
}

function bounds(layout: CanvasLayout) {
  if (layout.nodes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return {
    minX: Math.min(...layout.nodes.map((n) => n.x)),
    minY: Math.min(...layout.nodes.map((n) => n.y)),
    maxX: Math.max(...layout.nodes.map((n) => n.x + n.width)),
    maxY: Math.max(...layout.nodes.map((n) => n.y + n.height)),
  };
}

const center = (n: Node) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });

// Excalidraw skeletons, shifted so the layout is centred on `origin`. Node
// ids are local ("n0", "s_review"...) and only wire arrows to their nodes;
// insertSkeletons() regenerates every id on insert.
export function canvasSpecToSkeletons(spec: CanvasSpec, origin: { x: number; y: number }): ExcalidrawElementSkeleton[] {
  const layout = layoutCanvasSpec(spec);
  const ox = origin.x;
  const oy = origin.y;
  const out: ExcalidrawElementSkeleton[] = [];
  const b = bounds(layout);

  if (layout.title) {
    out.push({ type: "text", x: ox + b.minX, y: oy + b.minY - 60, text: layout.title, fontSize: 28 });
  }
  for (const n of layout.nodes) {
    const fill = FILLS[n.color];
    out.push({
      type: n.type,
      id: n.id,
      x: ox + n.x,
      y: oy + n.y,
      width: n.width,
      height: n.height,
      backgroundColor: fill.bg,
      strokeColor: fill.stroke,
      fillStyle: "solid",
      strokeWidth: 1,
      roughness: 0,
      label: {
        text: n.text,
        fontSize: n.fontSize,
        ...(spec.layout === "sticky_notes" ? { textAlign: "left" as const, verticalAlign: "top" as const } : {}),
      },
    });
  }
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  for (const e of layout.edges) {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from || !to) continue;
    const a = center(from);
    const c = center(to);
    out.push({
      type: "arrow",
      x: ox + a.x,
      y: oy + a.y,
      width: c.x - a.x,
      height: c.y - a.y,
      points: [
        [0, 0],
        [c.x - a.x, c.y - a.y],
      ],
      strokeColor: "#495057",
      roughness: 0,
      start: { id: from.id },
      end: { id: to.id },
      ...(e.label ? { label: { text: e.label, fontSize: 14 } } : {}),
    } as ExcalidrawElementSkeleton);
  }
  return out;
}

// Shape list for the small SVG preview on a proposal card: the very same
// layout that will be placed, in its own coordinate box.
export function canvasPreview(spec: CanvasSpec) {
  const layout = layoutCanvasSpec(spec);
  const b = bounds(layout);
  const pad = 20;
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  return {
    viewBox: `${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`,
    nodes: layout.nodes.map((n) => ({ ...n, fill: FILLS[n.color].bg, stroke: FILLS[n.color].stroke })),
    lines: layout.edges.flatMap((e) => {
      const f = byId.get(e.from);
      const t = byId.get(e.to);
      return f && t ? [{ a: center(f), b: center(t) }] : [];
    }),
    count: layout.nodes.length,
  };
}

export function canvasSpecSummary(spec: CanvasSpec): string {
  const t = el.collabAi.proposal;
  switch (spec.layout) {
    case "sticky_notes":
      return `${spec.notes?.length ?? 0} ${t.notes}`;
    case "mind_map":
      return `${t.mindMap} · ${spec.branches?.length ?? 0} ${t.branches}`;
    default:
      return `${t.flowchart} · ${spec.steps?.length ?? 0} ${t.steps}`;
  }
}
