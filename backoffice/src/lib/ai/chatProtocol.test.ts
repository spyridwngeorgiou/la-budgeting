import { describe, expect, it } from "vitest";
import { conversationTitle, createNdjsonParser, readMeta, toModelHistory, type ChatEvent } from "./chatProtocol";

describe("createNdjsonParser", () => {
  it("reassembles events split across chunks and skips bad lines", () => {
    const events: ChatEvent[] = [];
    const p = createNdjsonParser((e) => events.push(e));
    p.push('{"type":"text","te');
    p.push('xt":"Γεια"}\nnot json\n{"type":"done",');
    p.push('"messageId":null}');
    p.end();
    expect(events).toEqual([
      { type: "text", text: "Γεια" },
      { type: "done", messageId: null },
    ]);
  });
});

describe("toModelHistory", () => {
  it("starts with a user turn and alternates", () => {
    expect(
      toModelHistory([
        { role: "assistant", content: "orphan" },
        { role: "user", content: "α" },
        { role: "user", content: "β" },
        { role: "assistant", content: "γ" },
        { role: "assistant", content: "  " },
      ]),
    ).toEqual([
      { role: "user", content: "α\n\nβ" },
      { role: "assistant", content: "γ" },
    ]);
  });
});

describe("readMeta", () => {
  it("keeps only same-app links and id-shaped change ids", () => {
    const out = readMeta({
      sources: [
        { label: "ΦΠΑ", href: "/reports/vat" },
        { label: "evil", href: "https://evil.example" },
        { label: 1, href: "/x" },
      ],
      change_ids: ["11111111-1111-4111-8111-111111111111", "x"],
    });
    expect(out.sources).toEqual([{ label: "ΦΠΑ", href: "/reports/vat" }]);
    expect(out.changeIds).toEqual(["11111111-1111-4111-8111-111111111111"]);
    expect(readMeta(null)).toEqual({ sources: [], changeIds: [] });
  });
});

describe("conversationTitle", () => {
  it("collapses whitespace and caps the length", () => {
    expect(conversationTitle("  Πόσα\n\nξοδέψαμε;  ")).toBe("Πόσα ξοδέψαμε;");
    expect(conversationTitle("α".repeat(300))).toHaveLength(120);
  });
});
