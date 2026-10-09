import { describe, expect, it } from "vitest";
import { boardToText, type BoardCommentLike } from "./boardText";

const comment = (over: Partial<BoardCommentLike>): BoardCommentLike => ({
  id: "c1",
  parent_id: null,
  element_id: null,
  scene_x: null,
  scene_y: null,
  body: "σχόλιο",
  author_id: "u1",
  created_at: "2026-10-01T10:00:00Z",
  resolved_at: null,
  ...over,
});

describe("boardToText", () => {
  const elements = [
    { id: "note1", type: "rectangle", x: 100, y: 50, backgroundColor: "#ffec99" },
    { id: "t1", type: "text", containerId: "note1", text: "Παράθυρο 1,20m", originalText: "Παράθυρο 1,20m" },
    { id: "box", type: "diamond", x: 400, y: 50 },
    { id: "t2", type: "text", containerId: "box", text: "Έγκριση;" },
    { id: "a1", type: "arrow", x: 0, y: 0, startBinding: { elementId: "note1" }, endBinding: { elementId: "box" } },
    { id: "free", type: "text", x: 10, y: 10, text: "Τίτλος   ενότητας" },
    { id: "gone", type: "text", x: 0, y: 0, text: "διαγραμμένο", isDeleted: true },
    { id: "empty", type: "rectangle", x: 0, y: 0 },
    { id: "f1", type: "frame", x: 0, y: 0, width: 800, height: 600, name: "Ισόγειο" },
    { id: "t3", type: "text", x: 20, y: 300, text: "μέσα", frameId: "f1" },
    "garbage",
    null,
  ];

  it("labels shapes with their bound text and detects sticky notes", () => {
    const out = boardToText(elements, [], { title: "Κάτοψη" });
    expect(out).toContain('Πίνακας: "Κάτοψη"');
    expect(out).toContain('[σημείωση] "Παράθυρο 1,20m" @100,50');
    expect(out).toContain('[ρόμβος] "Έγκριση;"');
    expect(out).toContain('[βέλος] "Παράθυρο 1,20m" → "Έγκριση;"');
    expect(out).toContain('[κείμενο] "Τίτλος ενότητας"');
    expect(out).toContain('[πλαίσιο] "Ισόγειο"');
    expect(out).toContain('στο πλαίσιο "Ισόγειο"');
  });

  it("drops deleted, empty and malformed elements and bound text duplicates", () => {
    const out = boardToText(elements, []);
    expect(out).not.toContain("διαγραμμένο");
    expect(out).not.toContain("empty");
    // The label appears on its shape and on the arrow, never as a free text line.
    expect(out).not.toContain('[κείμενο] "Παράθυρο');
  });

  it("lists open comment threads with replies and skips resolved ones", () => {
    const out = boardToText(
      elements,
      [
        comment({ id: "c1", element_id: "note1", body: "Ποιο ύψος;" }),
        comment({ id: "c2", parent_id: "c1", author_id: "u2", body: "1,20", created_at: "2026-10-02T10:00:00Z" }),
        comment({ id: "c3", body: "λύθηκε", resolved_at: "2026-10-03T00:00:00Z" }),
        comment({ id: "c4", scene_x: 5.4, scene_y: 9.6, body: "εδώ" }),
      ],
      { people: { u1: "Μαρία", u2: "Νίκος" } },
    );
    expect(out).toContain("Ανοιχτά σχόλια (2):");
    expect(out).toContain('- #1 Μαρία στο "Παράθυρο 1,20m": "Ποιο ύψος;"');
    expect(out).toContain('  ↳ Νίκος: "1,20"');
    expect(out).toContain('@5,10: "εδώ"');
    expect(out).not.toContain("λύθηκε");
  });

  it("caps the element count and total length", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: `t${i}`, type: "text", x: i, y: i, text: `κείμενο ${i}` }));
    const out = boardToText(many, [], { maxElements: 10 });
    expect(out).toContain("+40 παραλείφθηκαν");
    expect(boardToText(many, [], { maxChars: 100 }).length).toBeLessThan(130);
  });
});
