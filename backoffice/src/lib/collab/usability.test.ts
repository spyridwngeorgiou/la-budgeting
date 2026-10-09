import { describe, expect, it } from "vitest";
import { fillText, foldGreek, formatBytes, stripExtension } from "./text";
import { activeMention, assistantQuestion, insertMention, matchPeople, mentionSegments } from "./mentions";
import { layoutRow, placedSize, planPdfPages, renderScale } from "./pdfPages";
import { canDeleteFile, canTrashBoard, trashDaysLeft } from "./trash";
import { BOARD_TEMPLATES, isBoardTemplate, templateSkeletons } from "./templates";
import { boundsOf, describeElements, duplicateElements, expandSelection, type LooseElement } from "./elements";
import { countUnread, projectTopic, upsertMessage } from "./chat";

describe("text", () => {
  it("fills placeholders and keeps unknown ones", () => {
    expect(fillText("Ανέβασμα {done}/{total}", { done: 2, total: 5 })).toBe("Ανέβασμα 2/5");
    expect(fillText("{a} {b}", { a: "x" })).toBe("x {b}");
  });
  it("folds Greek accents, case and final sigma", () => {
    expect(foldGreek("Βοηθός")).toBe("βοηθοσ");
    expect(foldGreek("ΒΟΗΘΟΣ")).toBe("βοηθοσ");
  });
  it("strips extensions and formats sizes", () => {
    expect(stripExtension("Κάτοψη v3.pdf")).toBe("Κάτοψη v3");
    expect(stripExtension(".hidden")).toBe(".hidden");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3.5 * 1024 * 1024)).toBe("3.5 MB");
  });
});

describe("assistantQuestion", () => {
  it.each([
    ["@βοηθός τι λείπει;", "τι λείπει;"],
    ["  @Βοηθος, σύνοψη", "σύνοψη"],
    ["@ΒΟΗΘΟΣ: πότε;", "πότε;"],
    ["@ai summary please", "summary please"],
  ])("hands %s to the assistant", (text, q) => expect(assistantQuestion(text)).toBe(q));
  it.each(["ρώτησα τον @βοηθός", "@Μαρία δες το", "@βοηθός", "καλημέρα"])("keeps %s in the team chat", (t) =>
    expect(assistantQuestion(t)).toBeNull(),
  );
});

describe("mentions", () => {
  const people = [
    { userId: "1", name: "Μαρία Παπαδοπούλου" },
    { userId: "2", name: "Νίκος Αλεξίου" },
    { userId: "3", name: "Μάριος Κ." },
    { userId: "1", name: "Μαρία Παπαδοπούλου" },
  ];
  it("finds the @word at the caret, not inside emails", () => {
    expect(activeMention("Γεια @Μαρ", 9)).toEqual({ start: 5, query: "Μαρ" });
    expect(activeMention("@", 1)).toEqual({ start: 0, query: "" });
    expect(activeMention("mail me at a@b.gr", 17)).toBeNull();
    expect(activeMention("τέλος @Μαρ ία", 13)).toBeNull();
  });
  it("matches any word, accent-blind, deduplicated", () => {
    expect(matchPeople(people, "μαρ").map((p) => p.userId)).toEqual(["1", "3"]);
    expect(matchPeople(people, "αλε").map((p) => p.userId)).toEqual(["2"]);
    expect(matchPeople(people, "").length).toBe(3);
  });
  it("inserts a mention and moves the caret", () => {
    expect(insertMention("Γεια @Μαρ!", 5, 9, "Μαρία Π.")).toEqual({ text: "Γεια @Μαρία Π. !", caret: 15 });
  });
  it("splits mentions, longest name first", () => {
    expect(mentionSegments("Δες @Μαρία Παπαδοπούλου και @νίκος αλεξίου.", ["Μαρία", "Μαρία Παπαδοπούλου", "Νίκος Αλεξίου"])).toEqual([
      { text: "Δες ", mention: false },
      { text: "@Μαρία Παπαδοπούλου", mention: true },
      { text: " και ", mention: false },
      { text: "@νίκος αλεξίου", mention: true },
      { text: ".", mention: false },
    ]);
    expect(mentionSegments("a@b.gr", ["b"])).toEqual([{ text: "a@b.gr", mention: false }]);
  });
});

describe("pdf page planning", () => {
  it("plans first, all and rest, capped at 10", () => {
    expect(planPdfPages(7, "first")).toEqual([1]);
    expect(planPdfPages(3, "all")).toEqual([1, 2, 3]);
    expect(planPdfPages(25, "all")).toHaveLength(10);
    expect(planPdfPages(25, "rest")).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(planPdfPages(1, "rest")).toEqual([]);
    expect(planPdfPages(0, "first")).toEqual([]);
  });
  it("scales to the bitmap limit without huge upscales", () => {
    expect(renderScale(595, 842, 2000)).toBeCloseTo(2000 / 842);
    expect(renderScale(100, 50, 2000)).toBe(3);
    expect(renderScale(0, 0)).toBe(1);
  });
  it("fits placed pages and lays them out in rows", () => {
    expect(placedSize(1000, 2000, 500)).toEqual({ width: 250, height: 500 });
    expect(placedSize(100, 50, 500)).toEqual({ width: 100, height: 50 });
    const pos = layoutRow(
      [
        { width: 100, height: 50 },
        { width: 100, height: 80 },
        { width: 100, height: 10 },
      ],
      { x: 0, y: 0 },
      10,
      2,
    );
    expect(pos).toEqual([
      { x: 0, y: 0 },
      { x: 110, y: 0 },
      { x: 0, y: 90 },
    ]);
  });
});

describe("trash", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  it("counts whole days left", () => {
    expect(trashDaysLeft("2026-10-09T12:00:00Z", now)).toBe(30);
    expect(trashDaysLeft("2026-09-09T13:00:00Z", now)).toBe(0);
    expect(trashDaysLeft("2026-08-01T00:00:00Z", now)).toBe(0);
    expect(trashDaysLeft("garbage", now)).toBe(0);
  });
  it("mirrors who may trash a board or delete a file", () => {
    expect(canTrashBoard({ created_by: "u1" }, { userId: "u1", canManage: false })).toBe(true);
    expect(canTrashBoard({ created_by: "u2" }, { userId: "u1", canManage: false })).toBe(false);
    expect(canTrashBoard({ created_by: null }, { userId: "u1", canManage: true })).toBe(true);
    expect(canDeleteFile({ created_by: "u1" }, { userId: "u1", canManage: false, canEdit: true })).toBe(true);
    expect(canDeleteFile({ created_by: "u1" }, { userId: "u1", canManage: false, canEdit: false })).toBe(false);
    expect(canDeleteFile({ created_by: "u2" }, { userId: "u1", canManage: true, canEdit: true })).toBe(true);
  });
});

describe("templates", () => {
  it("knows its templates", () => {
    expect(isBoardTemplate("todo")).toBe(true);
    expect(isBoardTemplate("nope")).toBe(false);
    expect(templateSkeletons("blank")).toEqual([]);
  });
  it.each(BOARD_TEMPLATES.filter((t) => t !== "blank"))("%s builds a non-empty, finite layout", (t) => {
    const s = templateSkeletons(t);
    expect(s.length).toBeGreaterThan(3);
    for (const e of s) {
      expect(Number.isFinite(e.x)).toBe(true);
      expect(Number.isFinite(e.y)).toBe(true);
    }
  });
});

describe("elements", () => {
  const els: LooseElement[] = [
    { id: "box", type: "rectangle", x: 0, y: 0, width: 100, height: 100, boundElements: [{ id: "lbl", type: "text" }, { id: "arr", type: "arrow" }] },
    { id: "lbl", type: "text", x: 10, y: 10, width: 80, height: 20, containerId: "box", text: "Σημείωση" },
    { id: "arr", type: "arrow", x: 100, y: 50, width: 100, height: 0, startBinding: { elementId: "box" }, endBinding: { elementId: "other" } },
    { id: "other", type: "ellipse", x: 200, y: 0, width: 50, height: 50 },
    { id: "g1", type: "rectangle", x: 0, y: 300, width: 10, height: 10, groupIds: ["G"] },
    { id: "g2", type: "rectangle", x: 20, y: 300, width: 10, height: 10, groupIds: ["G"] },
    { id: "gone", type: "rectangle", x: 0, y: 0, width: 1, height: 1, isDeleted: true },
  ];
  it("expands to bound text and whole groups", () => {
    expect([...expandSelection(els, ["box"])].sort()).toEqual(["box", "lbl"]);
    expect([...expandSelection(els, ["lbl"])].sort()).toEqual(["box", "lbl"]);
    expect([...expandSelection(els, ["g1", "gone"])].sort()).toEqual(["g1", "g2"]);
  });
  it("duplicates with remapped references", () => {
    let n = 0;
    const copies = duplicateElements(els, new Set(["box", "lbl", "arr"]), 20, () => `n${++n}`);
    const [box, lbl, arr] = copies;
    expect(box.x).toBe(20);
    expect(lbl.containerId).toBe(box.id);
    expect(box.boundElements).toEqual([
      { id: lbl.id, type: "text" },
      { id: arr.id, type: "arrow" },
    ]);
    expect(arr.startBinding).toEqual({ elementId: box.id });
    expect(arr.endBinding).toBeNull();
    const groups = duplicateElements(els, new Set(["g1", "g2"]), 0, () => `m${++n}`);
    expect(groups[0].groupIds).toEqual(groups[1].groupIds);
    expect(groups[0].groupIds).not.toEqual(["G"]);
  });
  it("computes bounds and describes a selection", () => {
    expect(boundsOf(els.slice(0, 4))).toEqual({ x: 0, y: 0, width: 250, height: 100 });
    expect(boundsOf([])).toBeNull();
    const words = { image: "εικόνα", pdf: "PDF", shape: "σχήμα", arrow: "βέλος", drawing: "σχέδιο" };
    expect(describeElements(els.slice(0, 4), words)).toEqual(["«Σημείωση»", "βέλος", "σχήμα"]);
    expect(
      describeElements([{ id: "i", type: "image", x: 0, y: 0, width: 1, height: 1, fileId: "f", customData: { pdfFileId: "x" } }], words, {
        f: "Κάτοψη.pdf",
      }),
    ).toEqual(["PDF «Κάτοψη.pdf»"]);
  });
});

describe("chat", () => {
  const msgs = [
    { id: "a", author_id: "me", created_at: "2026-10-09T10:00:00Z" },
    { id: "b", author_id: "x", created_at: "2026-10-09T10:01:00Z" },
    { id: "c", author_id: "y", created_at: "2026-10-09T10:02:00Z" },
  ];
  it("counts unread from others only", () => {
    expect(countUnread(msgs, null, "me")).toBe(2);
    expect(countUnread(msgs, "2026-10-09T10:01:00Z", "me")).toBe(1);
  });
  it("upserts in order with a cap", () => {
    const next = upsertMessage(msgs, { id: "z", author_id: "x", created_at: "2026-10-09T09:00:00Z" }, 3);
    expect(next.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(upsertMessage(msgs, { ...msgs[0], author_id: "edited" }).find((m) => m.id === "a")?.author_id).toBe("edited");
  });
  it("matches the realtime topic format", () => {
    expect(projectTopic("00000000-0000-0000-0000-000000000001")).toBe("project:00000000-0000-0000-0000-000000000001");
  });
});
