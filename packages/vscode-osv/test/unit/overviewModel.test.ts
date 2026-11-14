import { describe, expect, it } from "vitest";
import { buildTree, describeEntry, summaryOf, toEntry, type OverviewEntry } from "../../src/overviewModel.js";

const entry = (over: Partial<OverviewEntry> = {}): OverviewEntry => ({
  uri: "file:///w/package.json",
  path: "package.json",
  line: 3,
  character: 4,
  endLine: 3,
  endCharacter: 12,
  severity: "high",
  name: "lodash",
  current: "4.17.20",
  target: "4.17.21",
  key: "npm:lodash@4.17.20",
  vulnIds: ["GHSA-1"],
  message: "msg",
  ...over,
});

describe("toEntry", () => {
  const range = { line: 1, character: 2, endLine: 1, endCharacter: 9 };
  it("reads the server's structured data", () => {
    const e = toEntry({
      uri: "file:///w/a.json",
      path: "a.json",
      range,
      message: "qs 1.0.0 has 1 known vulnerability",
      data: { key: "k", name: "qs", current: "1.0.0", target: "2.0.0", vulnIds: ["A", 7, "B"], severity: "critical" },
    });
    expect(e).toMatchObject({ name: "qs", current: "1.0.0", target: "2.0.0", key: "k", vulnIds: ["A", "B"], severity: "critical", line: 1, endCharacter: 9 });
  });
  it("tolerates missing data", () => {
    const e = toEntry({ uri: "u", path: "p", range, message: "lodash 4.17.20 has 1 known vulnerability", data: undefined });
    expect(e).toMatchObject({ name: "lodash", current: "", severity: "low", vulnIds: [] });
    expect(e.target).toBeUndefined();
    expect(e.key).toBeUndefined();
  });
});

describe("buildTree by file", () => {
  const entries = [
    entry({ path: "b/package.json", severity: "low", line: 1 }),
    entry({ path: "a/package.json", severity: "medium", line: 2 }),
    entry({ path: "b/package.json", severity: "critical", line: 9 }),
  ];
  it("orders files by worst severity, then path, and entries by severity then position", () => {
    const tree = buildTree(entries, "file");
    expect(tree.map((g) => g.label)).toEqual(["b/package.json", "a/package.json"]);
    expect(tree[0]!.severity).toBe("critical");
    expect(tree[0]!.description).toBe("1 critical · 1 low");
    expect(tree[0]!.children.map((c) => c.entry.severity)).toEqual(["critical", "low"]);
  });
  it("is empty for no entries", () => {
    expect(buildTree([], "file")).toEqual([]);
    expect(buildTree([], "severity")).toEqual([]);
  });
});

describe("buildTree by severity", () => {
  it("lists only non-empty severities, most severe first, with counts", () => {
    const tree = buildTree([entry({ severity: "low" }), entry({ severity: "critical" }), entry({ severity: "low", line: 8 })], "severity");
    expect(tree.map((g) => [g.label, g.description])).toEqual([
      ["Critical", "1"],
      ["Low", "2"],
    ]);
  });
  it("gives entries distinct ids", () => {
    const tree = buildTree([entry({ line: 1 }), entry({ line: 2 })], "severity");
    expect(new Set(tree[0]!.children.map((c) => c.id)).size).toBe(2);
  });
});

describe("describeEntry", () => {
  it("shows the fix and the first id", () => {
    expect(describeEntry(entry())).toEqual({ label: "lodash 4.17.20", description: "fix: 4.17.21 · GHSA-1" });
  });
  it("summarises extra ids and a missing fix", () => {
    expect(describeEntry(entry({ target: undefined, vulnIds: ["A", "B", "C"] }))).toEqual({ label: "lodash 4.17.20", description: "no fix yet · A +2" });
    expect(describeEntry(entry({ current: "", vulnIds: [] }))).toEqual({ label: "lodash", description: "fix: 4.17.21" });
  });
});

describe("summaryOf", () => {
  it("totals and breaks down", () => {
    expect(summaryOf([entry(), entry({ severity: "low" })])).toEqual({ total: 2, text: "1 high · 1 low" });
    expect(summaryOf([])).toEqual({ total: 0, text: "" });
  });
});
