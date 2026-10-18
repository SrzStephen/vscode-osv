import { describe, expect, it } from "vitest";
import { nugetLowerBound, rewriteNugetSpec } from "../../../src/ecosystems/nuget/range.js";

describe("nugetLowerBound", () => {
  it.each([
    ["1.0", "1.0"],
    ["[1.0]", "1.0"],
    ["[1.0,2.0)", "1.0"],
    ["(1.0,)", undefined],
    ["(,2.0]", undefined],
    ["1.*", "1.0"],
    ["1.2.*", "1.2.0"],
    ["*", undefined],
    ["", undefined],
    ["junk", undefined],
  ])("lower bound %s", (s, lb) => expect(nugetLowerBound(s)).toBe(lb));
});

describe("rewriteNugetSpec", () => {
  it.each([
    ["1.0", "2.5.1", "2.5.1", false],
    ["[1.0]", "2.5.1", "[2.5.1]", false],
    ["[1.0,2.0)", "1.5", "[1.5,2.0)", false],
    ["[1.0,2.0)", "2.5.1", "[2.5.1,)", true],
    ["[1.0,2.0]", "2.0", "[2.0,2.0]", false],
    ["(1.0,2.0)", "1.5", "[1.5,2.0)", false],
    ["[1.0,)", "2.5.1", "[2.5.1,)", false],
    ["(1.0,)", "2.5.1", "[2.5.1,)", false],
    ["1.*", "2.5.1", "2.5.1", false],
  ])("rewrite %s", (r, t, spec, w) => expect(rewriteNugetSpec(r, t)).toEqual({ spec, widened: w }));
});
