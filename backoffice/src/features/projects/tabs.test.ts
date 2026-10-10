import { describe, expect, it } from "vitest";
import { activeTab } from "@/lib/navigation";
import { fallbackTab, isTabSegment, projectTabs, tabAllowed } from "./tabs";

describe("project tabs", () => {
  it("staff see the five tabs, in order", () => {
    expect(projectTabs("p1", "viewer").map((t) => t.href)).toEqual([
      "/projects/p1",
      "/projects/p1/finance",
      "/projects/p1/scenarios",
      "/projects/p1/plan",
      "/projects/p1/collab",
    ]);
  });

  it("partners never see finance or scenarios", () => {
    expect(projectTabs("p1", "partner").map((t) => t.href)).toEqual(["/projects/p1/plan", "/projects/p1/collab"]);
    for (const tab of ["overview", "finance", "scenarios"] as const) expect(tabAllowed(tab, "partner")).toBe(false);
    expect(fallbackTab("p1", "partner")).toBe("/projects/p1/plan");
  });

  it("nobody signed in sees nothing", () => {
    expect(projectTabs("p1", null)).toEqual([]);
  });

  it("the active tab is the longest owning href", () => {
    const tabs = projectTabs("p1", "owner");
    expect(activeTab(tabs, "/projects/p1")).toBe("/projects/p1");
    expect(activeTab(tabs, "/projects/p1/finance")).toBe("/projects/p1/finance");
  });

  it("only the four segments are tabs (compare is not)", () => {
    expect(["finance", "scenarios", "plan", "collab"].every(isTabSegment)).toBe(true);
    expect(isTabSegment("compare")).toBe(false);
  });
});
