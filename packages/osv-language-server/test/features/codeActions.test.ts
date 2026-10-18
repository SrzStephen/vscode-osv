import { describe, expect, it } from "vitest";
import { codeActionsFor, toWorkspaceEdit } from "../../src/features/codeActions.js";
import { FindingStore } from "../../src/features/store.js";
import { finding } from "../helpers/finding.js";

const at = (line: number, character: number) => ({ start: { line, character }, end: { line, character } });

describe("codeActionsFor", () => {
  it("titles a direct update and attaches the edit and afterUpdate command", () => {
    const f = finding();
    const [a, ...rest] = codeActionsFor(f.uri, [f], at(2, 12));
    expect(rest).toEqual([]);
    expect(a?.title).toBe("Update qs to 2.0.0");
    expect(a?.kind).toBe("quickfix");
    expect(a?.isPreferred).toBe(true);
    expect(a?.diagnostics?.[0]?.data).toMatchObject({ key: f.key });
    expect(a?.edit?.changes).toEqual({ "file:///w/package.json": [{ range: f.update!.edit[0]!.range, newText: "^2.0.0" }] });
    expect(a?.command).toEqual({ title: "Update qs to 2.0.0", command: "osv.afterUpdate", arguments: [{ uri: f.uri, key: f.key }] });
  });

  it("titles an override plan", () => {
    const f = finding({ update: { ...finding().update!, kind: "override" } });
    expect(codeActionsFor(f.uri, [f], at(2, 12))[0]?.title).toBe("Override qs to 2.0.0");
  });

  it("offers command-only plans without an edit", () => {
    const f = finding({ update: { edit: [], kind: "command-only", lockCommand: { cwd: "/w", command: "npm update qs" } } });
    const [a] = codeActionsFor(f.uri, [f], at(2, 12));
    expect(a?.title).toBe('Run "npm update qs"');
    expect(a?.edit).toBeUndefined();
    expect(a?.command?.command).toBe("osv.afterUpdate");
  });

  it("targets the manifest URI for a lockfile direct finding", () => {
    const f = finding({ uri: "file:///w/package-lock.json", source: "lockfile" });
    const [a] = codeActionsFor(f.uri, [f], at(2, 12));
    expect(Object.keys(a!.edit!.changes!)).toEqual(["file:///w/package.json"]);
    expect(a?.command?.arguments).toEqual([{ uri: "file:///w/package-lock.json", key: f.key }]);
  });

  it("excludes findings outside the range and without a plan", () => {
    expect(codeActionsFor("file:///w/package.json", [finding()], at(5, 0))).toEqual([]);
    expect(codeActionsFor("file:///w/package.json", [finding({ update: undefined })], at(2, 12))).toEqual([]);
  });
});

describe("toWorkspaceEdit", () => {
  it("groups edits by uri", () => {
    const r = at(0, 0);
    const e = toWorkspaceEdit({ kind: "direct", edit: [{ uri: "a", range: r, newText: "1" }, { uri: "b", range: r, newText: "2" }, { uri: "a", range: r, newText: "3" }] });
    expect(e.changes).toEqual({ a: [{ range: r, newText: "1" }, { range: r, newText: "3" }], b: [{ range: r, newText: "2" }] });
  });
});

describe("FindingStore", () => {
  it("stores, looks up, lists and deletes by uri", () => {
    const s = new FindingStore();
    const a = finding({ key: "a" });
    const b = finding({ key: "b" });
    s.set("u1", [a]);
    s.set("u2", [b]);
    expect(s.get("u1")).toEqual([a]);
    expect(s.get("nope")).toEqual([]);
    expect(s.byKey("u2", "b")).toBe(b);
    expect(s.byKey("u2", "a")).toBeUndefined();
    expect(s.all()).toEqual([a, b]);
    s.delete("u1");
    expect(s.all()).toEqual([b]);
  });
});
