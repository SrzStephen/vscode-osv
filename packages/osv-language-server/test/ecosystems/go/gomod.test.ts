import { describe, expect, it } from "vitest";
import { LineIndex } from "../../../src/core/lineIndex.js";
import { goComparator, parseGoMod } from "../../../src/ecosystems/go/gomod.js";

const slice = (text: string, r: { start: { line: number; character: number }; end: { line: number; character: number } }): string => {
  const ix = new LineIndex(text);
  return text.slice(ix.offset(r.start), ix.offset(r.end));
};

describe("parseGoMod", () => {
  const text = [
    "module example.com/app",
    "",
    "go 1.21",
    "toolchain go1.21.3",
    "",
    "require github.com/pkg/errors v0.9.1",
    "",
    "require (",
    "\tgolang.org/x/text v0.3.5",
    "\tgolang.org/x/sys v0.1.0 // indirect",
    ")",
    "",
    "exclude golang.org/x/text v0.3.4",
    "",
  ].join("\n");

  it("parses single and block requires with groups", () => {
    const deps = parseGoMod(text);
    expect(deps.map((d) => [d.name, d.rawSpec, d.lowerBound, d.group, d.kind])).toEqual([
      ["github.com/pkg/errors", "v0.9.1", "v0.9.1", "require", "registry"],
      ["golang.org/x/text", "v0.3.5", "v0.3.5", "require", "registry"],
      ["golang.org/x/sys", "v0.1.0", "v0.1.0", "indirect", "registry"],
    ]);
    expect(slice(text, deps[1]!.nameRange)).toBe("golang.org/x/text");
    expect(slice(text, deps[1]!.specRange!)).toBe("v0.3.5");
    expect(slice(text, deps[2]!.specRange!)).toBe("v0.1.0");
  });

  it("applies replace to a new module path and version, with specLocation at the replace version", () => {
    const t = ["module m", "require golang.org/x/text v0.3.5", "replace golang.org/x/text => github.com/fork/text v0.3.8", ""].join("\n");
    const deps = parseGoMod(t);
    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({ name: "github.com/fork/text", rawSpec: "v0.3.8", lowerBound: "v0.3.8" });
    expect(slice(t, deps[0]!.specLocation!.range)).toBe("v0.3.8");
    expect(deps[0]!.specLocation).toMatchObject({ path: "", rawSpec: "v0.3.8" });
    expect(slice(t, deps[0]!.specRange!)).toBe("v0.3.8");
  });

  it("replace with a versioned old side only applies to that version; blocks work", () => {
    const t = ["require (", "\ta.io/x v1.0.0", "\tb.io/y v2.0.0", ")", "replace (", "\ta.io/x v1.0.0 => c.io/x v1.5.0", "\tb.io/y v9.9.9 => d.io/y v1.0.0", ")"].join("\n");
    expect(parseGoMod(t).map((d) => `${d.name}@${d.rawSpec}`)).toEqual(["c.io/x@v1.5.0", "b.io/y@v2.0.0"]);
  });

  it("skips local-path replacements entirely", () => {
    const t = ["require golang.org/x/text v0.3.5", "require a.io/b v1.0.0", "replace golang.org/x/text => ./third_party/text", "replace a.io/b v1.0.0 => ../b", ""].join("\n");
    expect(parseGoMod(t)).toEqual([]);
  });

  it("handles CRLF and quoted paths", () => {
    const t = 'module m\r\nrequire (\r\n\t"golang.org/x/text" v0.3.5\r\n\tgolang.org/x/sys v0.1.0 // indirect\r\n)\r\n';
    const deps = parseGoMod(t);
    expect(deps.map((d) => [d.name, d.rawSpec, d.group])).toEqual([
      ["golang.org/x/text", "v0.3.5", "require"],
      ["golang.org/x/sys", "v0.1.0", "indirect"],
    ]);
    expect(slice(t, deps[0]!.specRange!)).toBe("v0.3.5");
    expect(slice(t, deps[0]!.nameRange)).toBe("golang.org/x/text");
  });
});

describe("goComparator", () => {
  it("normalizes v and +incompatible", () => {
    expect(goComparator.normalize("v1.2.3")).toBe("1.2.3");
    expect(goComparator.normalize("v2.0.0+incompatible")).toBe("2.0.0");
    expect(goComparator.isValid("v2.0.0+incompatible")).toBe(true);
  });
  it("orders versions and pseudo-versions", () => {
    const c = (a: string, b: string) => goComparator.compare(goComparator.normalize(a), goComparator.normalize(b));
    expect(c("v0.3.8", "v0.3.5")).toBeGreaterThan(0);
    expect(c("v0.0.0-20210101000000-abcdef123456", "v0.0.0-20200101000000-abcdef123456")).toBeGreaterThan(0);
    expect(c("v1.2.4-0.20210101000000-abcdef123456", "v1.2.3")).toBeGreaterThan(0);
    expect(c("v1.2.3", "v1.2.4-0.20210101000000-abcdef123456")).toBeLessThan(0);
    expect(goComparator.major("v2.1.0")).toBe(2);
  });
});
