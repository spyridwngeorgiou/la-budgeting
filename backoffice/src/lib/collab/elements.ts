// Pure helpers over Excalidraw elements as plain objects (the shape stored in
// board_elements.data), used by the selection toolbar. Kept free of the
// Excalidraw runtime so they can be unit-tested.

export interface LooseElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  groupIds?: readonly string[];
  containerId?: string | null;
  boundElements?: readonly { id: string; type: string }[] | null;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
  text?: string;
  fileId?: string | null;
  link?: string | null;
  customData?: Record<string, unknown>;
  [key: string]: unknown;
}

// The selected ids plus everything that belongs with them: a container's
// bound text (and a bound text's container), and every member of a selected
// element's outermost group -- what Excalidraw itself treats as one object.
export function expandSelection<T extends LooseElement>(elements: readonly T[], selectedIds: Iterable<string>): Set<string> {
  const live = elements.filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e]));
  const out = new Set<string>();
  for (const id of selectedIds) if (byId.has(id)) out.add(id);

  const groups = new Set<string>();
  for (const id of out) {
    const g = byId.get(id)?.groupIds;
    if (g && g.length > 0) groups.add(g[g.length - 1]);
  }
  for (const e of live) if (e.groupIds?.some((g) => groups.has(g))) out.add(e.id);

  for (const id of [...out]) {
    const e = byId.get(id);
    if (!e) continue;
    if (e.containerId && byId.has(e.containerId)) out.add(e.containerId);
    for (const b of e.boundElements ?? []) if (b.type === "text" && byId.has(b.id)) out.add(b.id);
  }
  return out;
}

// Copies of `ids`, shifted by `offset`, with fresh ids. References between
// copied elements (bound text, arrow bindings, groups) point at the copies;
// references to anything not copied are dropped, so a copied arrow doesn't
// stay glued to the original box. Version fields restart -- the caller
// passes them through Excalidraw's own updateScene, which owns versioning.
export function duplicateElements<T extends LooseElement>(
  elements: readonly T[],
  ids: Set<string>,
  offset: number,
  newId: () => string,
): T[] {
  const source = elements.filter((e) => ids.has(e.id) && !e.isDeleted);
  const idMap = new Map(source.map((e) => [e.id, newId()]));
  const groupMap = new Map<string, string>();
  const mapGroup = (g: string) => {
    let n = groupMap.get(g);
    if (!n) {
      n = newId();
      groupMap.set(g, n);
    }
    return n;
  };
  const remapBinding = (b: { elementId: string } | null | undefined) =>
    b && idMap.has(b.elementId) ? { ...b, elementId: idMap.get(b.elementId) as string } : null;

  return source.map((e) => {
    const copy: T = {
      ...e,
      id: idMap.get(e.id) as string,
      x: e.x + offset,
      y: e.y + offset,
      groupIds: (e.groupIds ?? []).map(mapGroup),
      boundElements: e.boundElements
        ? e.boundElements.filter((b) => idMap.has(b.id)).map((b) => ({ ...b, id: idMap.get(b.id) as string }))
        : e.boundElements,
      index: null,
      seed: Math.floor(Math.random() * 2 ** 31),
      version: 1,
      versionNonce: Math.floor(Math.random() * 2 ** 31),
      updated: Date.now(),
    };
    if ("containerId" in e) copy.containerId = e.containerId && idMap.has(e.containerId) ? idMap.get(e.containerId) : null;
    if ("startBinding" in e) copy.startBinding = remapBinding(e.startBinding);
    if ("endBinding" in e) copy.endBinding = remapBinding(e.endBinding);
    return copy;
  });
}

// Axis-aligned bounds of the given elements (rotation ignored -- good enough
// to float a toolbar above them).
export function boundsOf(elements: readonly LooseElement[]): { x: number; y: number; width: number; height: number } | null {
  if (elements.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const e of elements) {
    const x2 = e.x + e.width;
    const y2 = e.y + e.height;
    minX = Math.min(minX, e.x, x2);
    minY = Math.min(minY, e.y, y2);
    maxX = Math.max(maxX, e.x, x2);
    maxY = Math.max(maxY, e.y, y2);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// A short, human description of a selection for the assistant prompt: the
// text of notes and labels, and a word for everything else.
export function describeElements(
  elements: readonly LooseElement[],
  words: { image: string; pdf: string; shape: string; arrow: string; drawing: string },
  fileNames: Record<string, string> = {},
  maxItems = 12,
): string[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const lines: string[] = [];
  for (const e of elements) {
    if (lines.length >= maxItems) break;
    if (e.type === "text") {
      // Bound labels are reported with their container.
      if (e.containerId && byId.has(e.containerId)) continue;
      if (e.text?.trim()) lines.push(`«${e.text.trim().slice(0, 200)}»`);
      continue;
    }
    const label = (e.boundElements ?? [])
      .map((b) => byId.get(b.id))
      .find((b) => b?.type === "text" && b.text?.trim())?.text;
    if (e.type === "image") {
      const isPdf = typeof e.customData?.pdfFileId === "string";
      const name = (e.fileId && fileNames[e.fileId]) || (typeof e.customData?.name === "string" ? e.customData.name : "");
      lines.push(`${isPdf ? words.pdf : words.image}${name ? ` «${name}»` : ""}`);
    } else if (e.type === "arrow" || e.type === "line") {
      lines.push(label ? `${words.arrow}: «${label.trim().slice(0, 200)}»` : words.arrow);
    } else if (e.type === "freedraw") {
      lines.push(words.drawing);
    } else {
      lines.push(label ? `«${label.trim().slice(0, 200)}»` : words.shape);
    }
  }
  return lines;
}
