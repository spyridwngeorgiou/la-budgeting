// Board -> compact text for the board assistant (read_board tool).
//
// Pure (no Supabase, no SDK) so vitest covers it directly. The output is
// UNTRUSTED data written by whoever can edit the board -- callers wrap it in
// fenceUntrusted() before it reaches the model, and the system prompt says
// anything inside those fences is content to analyse, never instructions.

export interface BoardElementLike {
  id: string;
  type: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  isDeleted?: boolean;
  text?: string;
  originalText?: string;
  containerId?: string | null;
  frameId?: string | null;
  name?: string | null;
  backgroundColor?: string;
  link?: string | null;
  fileId?: string | null;
  startBinding?: { elementId?: string } | null;
  endBinding?: { elementId?: string } | null;
}

export interface BoardCommentLike {
  id: string;
  parent_id: string | null;
  element_id: string | null;
  scene_x: number | null;
  scene_y: number | null;
  body: string;
  author_id: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface BoardTextOptions {
  title?: string;
  people?: Record<string, string>;
  /** Board file names by Excalidraw fileId, for image elements. */
  fileNames?: Record<string, string>;
  maxElements?: number;
  maxChars?: number;
}

// The sticky-note fill StickyNoteButton uses; other yellows count too.
const NOTE_FILLS = new Set(["#ffec99", "#fff3bf", "#ffe066", "#fcc419"]);
const MAX_TEXT = 500;

function clean(text: string | null | undefined, max = MAX_TEXT): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function quote(text: string): string {
  return `"${text.replace(/"/g, "'")}"`;
}

function pos(e: BoardElementLike): string {
  return `@${Math.round(e.x ?? 0)},${Math.round(e.y ?? 0)}`;
}

export function boardToText(
  rawElements: readonly unknown[],
  comments: readonly BoardCommentLike[],
  opts: BoardTextOptions = {},
): string {
  const maxElements = opts.maxElements ?? 400;
  const maxChars = opts.maxChars ?? 40_000;
  const people = opts.people ?? {};

  const elements = rawElements.filter(
    (e): e is BoardElementLike =>
      !!e && typeof e === "object" && typeof (e as BoardElementLike).id === "string" &&
      typeof (e as BoardElementLike).type === "string" && !(e as BoardElementLike).isDeleted,
  );
  const byId = new Map(elements.map((e) => [e.id, e]));

  // Bound text (a label inside a shape or on an arrow) belongs to its container.
  const labels = new Map<string, string>();
  for (const e of elements) {
    if (e.type === "text" && e.containerId) {
      labels.set(e.containerId, clean(e.originalText ?? e.text));
    }
  }

  const frameName = (id: string | null | undefined) => {
    if (!id) return null;
    const f = byId.get(id);
    return f ? clean(f.name ?? labels.get(f.id) ?? "", 80) || "χωρίς όνομα" : null;
  };
  const describeRef = (id: string | undefined) => {
    if (!id) return "?";
    const target = byId.get(id);
    if (!target) return "?";
    const label = labels.get(id) ?? (target.type === "text" ? clean(target.originalText ?? target.text, 60) : "");
    return label ? quote(clean(label, 60)) : `${target.type}#${id.slice(0, 6)}`;
  };

  // Reading order: top to bottom, then left to right.
  const visible = elements
    .filter((e) => !(e.type === "text" && e.containerId && byId.has(e.containerId)))
    .sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));

  const lines: string[] = [];
  if (opts.title) lines.push(`Πίνακας: ${quote(clean(opts.title, 200))}`);

  let skipped = 0;
  const elementLines: string[] = [];
  for (const e of visible) {
    if (elementLines.length >= maxElements) {
      skipped++;
      continue;
    }
    const inFrame = frameName(e.frameId);
    const suffix = `${pos(e)}${inFrame ? ` στο πλαίσιο ${quote(inFrame)}` : ""}`;
    const label = labels.get(e.id);
    let line: string | null = null;
    switch (e.type) {
      case "frame":
      case "magicframe":
        line = `[πλαίσιο] ${quote(clean(e.name ?? label ?? "", 120) || "χωρίς όνομα")} ${pos(e)} ${Math.round(e.width ?? 0)}x${Math.round(e.height ?? 0)}`;
        break;
      case "text":
        if (clean(e.originalText ?? e.text)) line = `[κείμενο] ${quote(clean(e.originalText ?? e.text))} ${suffix}`;
        break;
      case "arrow":
      case "line": {
        const from = e.startBinding?.elementId;
        const to = e.endBinding?.elementId;
        if (from || to || label) {
          line = `[βέλος] ${describeRef(from)} → ${describeRef(to)}${label ? ` ${quote(label)}` : ""}`;
        }
        break;
      }
      case "image": {
        const name = e.fileId ? opts.fileNames?.[e.fileId] : undefined;
        line = `[εικόνα]${name ? ` ${quote(clean(name, 120))}` : ""} ${suffix}`;
        break;
      }
      case "rectangle":
      case "diamond":
      case "ellipse": {
        const isNote = e.type === "rectangle" && NOTE_FILLS.has((e.backgroundColor ?? "").toLowerCase());
        if (!label && !e.link) break; // an empty shape carries no meaning for a summary
        const kind = isNote ? "σημείωση" : e.type === "diamond" ? "ρόμβος" : e.type === "ellipse" ? "έλλειψη" : "πλαίσιο-κειμένου";
        line = `[${kind}] ${label ? quote(label) : ""}${e.link?.startsWith("/collab/") ? " (σύνδεσμος σε αρχείο)" : ""} ${suffix}`;
        break;
      }
      default:
        break; // freedraw strokes and the like: no text to report
    }
    if (line) elementLines.push(`- ${line.replace(/\s+/g, " ").trim()}`);
  }
  lines.push(`Στοιχεία (${elementLines.length}${skipped ? `, +${skipped} παραλείφθηκαν` : ""}):`);
  lines.push(...(elementLines.length ? elementLines : ["- (κανένα στοιχείο με κείμενο)"]));

  // Open threads only: resolved ones are settled decisions the summary can skip.
  const roots = comments.filter((c) => !c.parent_id && !c.resolved_at);
  const replies = new Map<string, BoardCommentLike[]>();
  for (const c of comments) {
    if (c.parent_id) replies.set(c.parent_id, [...(replies.get(c.parent_id) ?? []), c]);
  }
  const who = (id: string | null) => (id && people[id]) || "Χρήστης";
  lines.push(`Ανοιχτά σχόλια (${roots.length}):`);
  if (roots.length === 0) lines.push("- (κανένα)");
  roots.forEach((c, i) => {
    const anchor = c.element_id
      ? ` στο ${describeRef(c.element_id)}`
      : c.scene_x !== null && c.scene_y !== null
        ? ` @${Math.round(c.scene_x)},${Math.round(c.scene_y)}`
        : "";
    lines.push(`- #${i + 1} ${who(c.author_id)}${anchor}: ${quote(clean(c.body, 1000))}`);
    for (const r of (replies.get(c.id) ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      lines.push(`  ↳ ${who(r.author_id)}: ${quote(clean(r.body, 1000))}`);
    }
  });

  const out = lines.join("\n");
  return out.length > maxChars ? `${out.slice(0, maxChars)}\n…(περικόπηκε)` : out;
}
