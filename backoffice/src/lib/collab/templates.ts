import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import { el } from "@/lib/i18n/el";

// Board templates for «Νέος πίνακας». The project page only records the
// choice (boards.template, 0060); the creator's browser builds these
// skeletons into Excalidraw elements the first time the empty board opens,
// then clears the column. Coordinates are relative to the template's centre
// so they land in the middle of whatever the user is looking at.

export const BOARD_TEMPLATES = ["blank", "brainstorm", "moodboard", "review", "todo"] as const;
export type BoardTemplate = (typeof BOARD_TEMPLATES)[number];
// The values boards.template accepts ("blank" is stored as null).
export type StoredTemplate = Exclude<BoardTemplate, "blank">;

export function isBoardTemplate(v: unknown): v is BoardTemplate {
  return typeof v === "string" && (BOARD_TEMPLATES as readonly string[]).includes(v);
}

// Sticky-note colours for the quick-add bar and templates (Excalidraw's own
// palette, so they match its colour picker): fill, then outline.
export const NOTE_COLOURS = [
  { bg: "#ffec99", stroke: "#f08c00" },
  { bg: "#ffc9c9", stroke: "#e03131" },
  { bg: "#b2f2bb", stroke: "#2f9e44" },
  { bg: "#a5d8ff", stroke: "#1971c2" },
  { bg: "#d0bfff", stroke: "#7048e8" },
] as const;

export const NOTE_SIZE = 200;

export function stickyNote(
  x: number,
  y: number,
  text: string,
  colour: (typeof NOTE_COLOURS)[number] = NOTE_COLOURS[0],
  size = NOTE_SIZE,
): ExcalidrawElementSkeleton {
  return {
    type: "rectangle",
    x,
    y,
    width: size,
    height: size,
    backgroundColor: colour.bg,
    fillStyle: "solid",
    strokeColor: colour.stroke,
    strokeWidth: 1,
    roughness: 0,
    label: { text, fontSize: 20, textAlign: "left", verticalAlign: "top" },
  };
}

function title(x: number, y: number, text: string): ExcalidrawElementSkeleton {
  return { type: "text", x, y, text, fontSize: 36, strokeColor: "#1e1e1e" };
}

function area(x: number, y: number, w: number, h: number, text: string): ExcalidrawElementSkeleton {
  return {
    type: "rectangle",
    x,
    y,
    width: w,
    height: h,
    strokeColor: "#868e96",
    backgroundColor: "#f8f9fa",
    fillStyle: "solid",
    strokeStyle: "dashed",
    strokeWidth: 1,
    roughness: 0,
    label: { text, fontSize: 20, textAlign: "center", verticalAlign: "top" },
  };
}

function header(x: number, y: number, w: number, text: string, colour: string): ExcalidrawElementSkeleton {
  return {
    type: "rectangle",
    x,
    y,
    width: w,
    height: 64,
    backgroundColor: colour,
    fillStyle: "solid",
    strokeColor: "#495057",
    strokeWidth: 1,
    roughness: 0,
    label: { text, fontSize: 24 },
  };
}

function columns(names: readonly string[], heading: string, note: string): ExcalidrawElementSkeleton[] {
  const w = 300;
  const gap = 40;
  const total = names.length * w + (names.length - 1) * gap;
  const left = -total / 2;
  const fills = ["#fff3bf", "#d0ebff", "#d3f9d8"];
  const out: ExcalidrawElementSkeleton[] = [title(left, -380, heading)];
  names.forEach((name, i) => {
    const x = left + i * (w + gap);
    out.push(header(x, -300, w, name, fills[i % fills.length]));
    out.push(area(x, -220, w, 560, ""));
    if (i === 0) out.push(stickyNote(x + 50, -190, note, NOTE_COLOURS[0]));
  });
  return out;
}

// The skeletons for a template, centred on (0, 0). "blank" has none.
export function templateSkeletons(template: BoardTemplate): ExcalidrawElementSkeleton[] {
  const t = el.collab.templates.content;
  switch (template) {
    case "blank":
      return [];
    case "brainstorm": {
      const out: ExcalidrawElementSkeleton[] = [
        {
          type: "ellipse",
          x: -150,
          y: -80,
          width: 300,
          height: 160,
          backgroundColor: "#e7f5ff",
          fillStyle: "solid",
          strokeColor: "#1971c2",
          strokeWidth: 2,
          roughness: 0,
          label: { text: t.topic, fontSize: 28 },
        },
      ];
      // Six notes on a ring around the topic.
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI * 2 * i) / 6 - Math.PI / 2;
        const cx = Math.cos(a) * 420;
        const cy = Math.sin(a) * 300;
        out.push(stickyNote(cx - 90, cy - 90, t.idea, NOTE_COLOURS[i % NOTE_COLOURS.length], 180));
      }
      return out;
    }
    case "moodboard": {
      const w = 320;
      const h = 240;
      const gap = 30;
      const out: ExcalidrawElementSkeleton[] = [title(-(3 * w + 2 * gap) / 2, -h - gap - 80, t.moodTitle)];
      t.moodAreas.forEach((name, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        out.push(area(-(3 * w + 2 * gap) / 2 + col * (w + gap), -h - gap / 2 + row * (h + gap), w, h, `${name}\n\n${t.dropHint}`));
      });
      return out;
    }
    case "review":
      return columns(t.reviewColumns, t.reviewTitle, t.reviewNote);
    case "todo":
      return columns(t.todoColumns, t.todoTitle, t.todoNote);
  }
}
