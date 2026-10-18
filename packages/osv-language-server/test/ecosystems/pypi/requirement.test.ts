import { describe, expect, it } from "vitest";
import { parseRequirement, pep440LowerBound } from "../../../src/ecosystems/pypi/requirement.js";

describe("pep440LowerBound", () => {
  it.each([
    [">=2.0", "2.0"],
    ["~=2.2", "2.2"],
    ["==1.2.*", "1.2"],
    ["<3", undefined],
    [">=1.0,!=1.5", "1.0"],
    ["==1.0,>=0.5", "1.0"],
    [">=1.0,~=1.5", "1.5"],
    ["===1.0", "1.0"],
    [">1.0,<=2", undefined],
  ])("lower bound %s", (s, lb) => expect(pep440LowerBound(s)).toBe(lb));
});

describe("parseRequirement", () => {
  it("reports name and spec offsets, skipping extras and markers", () => {
    const s = "Requests[security] >= 2.0, <3 ; python_version>'3.8'";
    const r = parseRequirement(s)!;
    expect(s.slice(r.nameStart, r.nameEnd)).toBe("Requests");
    expect(s.slice(r.specStart, r.specEnd)).toBe(">= 2.0, <3");
    expect(r.kind).toBe("registry");
  });

  it("accepts a parenthesized specifier", () => {
    const s = "pkg (>=1.0)";
    const r = parseRequirement(s)!;
    expect(s.slice(r.specStart, r.specEnd)).toBe(">=1.0");
  });

  it.each([
    ["pkg @ git+https://x/y.git", "git"],
    ["pkg @ file:///tmp/pkg", "path"],
    ["pkg @ https://x/pkg.whl", "url"],
  ])("classifies direct reference %s", (s, kind) => {
    const r = parseRequirement(s)!;
    expect(r.kind).toBe(kind);
    expect(r.spec).toBeUndefined();
  });

  it("returns a bare name without a spec", () => {
    expect(parseRequirement("flask")).toMatchObject({ nameStart: 0, nameEnd: 5, kind: "registry" });
    expect(parseRequirement("flask")?.spec).toBeUndefined();
  });

  it("rejects non-requirements", () => {
    expect(parseRequirement("")).toBeUndefined();
    expect(parseRequirement("==1.0")).toBeUndefined();
  });
});
