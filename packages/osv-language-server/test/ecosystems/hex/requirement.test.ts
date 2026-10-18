import { describe, expect, it } from "vitest";
import { hexLowerBound, rewriteHexRequirement } from "../../../src/ecosystems/hex/requirement.js";

describe("hexLowerBound", () => {
  it.each<[string, string | undefined]>([
    ["~> 1.3.0", "1.3.0"],
    ["~> 1.3", "1.3.0"],
    [">= 1.2", "1.2.0"],
    ["== 1.4.1", "1.4.1"],
    ["1.4.1", "1.4.1"],
    [">= 1.0.0 and < 2.0.0", "1.0.0"],
    ["~> 1.0 and >= 1.2.3", "1.2.3"],
    ["~> 1.0 or ~> 2.0", "1.0.0"],
    ["~> 2.0 or >= 1.5.0", "1.5.0"],
    ["~> 1.0 or < 3.0.0", undefined],
    ["< 2.0.0", undefined],
    ["!= 1.5.0", undefined],
    ["> 1.0.0", undefined],
    ["", undefined],
    ["~> 1", "1.0.0"],
    ["~> 1.0.0-rc.1", "1.0.0-rc.1"],
  ])("%j -> %s", (req, expected) => {
    expect(hexLowerBound(req)).toBe(expected);
  });
});

describe("rewriteHexRequirement", () => {
  it.each<[string, string, string, boolean]>([
    ["~> 1.3.0", "1.16.6", "~> 1.16.6", true],
    ["~> 1.3", "1.16.6", "~> 1.16 and >= 1.16.6", false],
    ["~> 1.3", "1.16.0", "~> 1.16", false],
    ["~> 1.3", "2.0.0", "~> 2.0", true],
    ["~> 1.3.0", "1.3.5", "~> 1.3.5", false],
    [">= 1.0.0", "1.5.2", ">= 1.5.2", false],
    ["== 1.0.0", "1.5.2", "== 1.5.2", false],
    ["1.0.0", "1.5.2", "1.5.2", false],
    [">= 1.0.0 and < 2.0.0", "1.5.2", ">= 1.5.2 and < 2.0.0", false],
    [">= 1.0.0 and < 2.0.0", "3.0.0", ">= 3.0.0", true],
    ["> 1.0.0 and < 3.0.0", "2.0.0", ">= 2.0.0 and < 3.0.0", false],
    ["> 1.0.0", "1.0.1", ">= 1.0.1", false],
    ["< 2.0.0", "1.5.0", "< 2.0.0 and >= 1.5.0", false],
    ["< 2.0.0", "2.5.0", ">= 2.5.0", true],
    ["!= 1.5.0", "1.5.0", ">= 1.5.0", true],
    ["~> 1.0 and >= 1.2.0", "1.2.9", "~> 1.2 and >= 1.2.9", false],
    ["~> 1.0 or ~> 2.0", "1.5.2", "~> 1.5 and >= 1.5.2", false],
    ["~> 1.0 or ~> 3.0", "2.0.0", "~> 2.0", true],
    ["~> 1.0.0-rc.1", "1.16.6", "~> 1.16.6", true],
    ["~> 1.0.0-rc.1", "1.0.5", "~> 1.0.5", false],
    ["~> 1.3.0", "1.17.0-rc.1", "~> 1.17.0-rc.1", true],
  ])("%j + %s -> %j (widened %s)", (raw, target, spec, widened) => {
    expect(rewriteHexRequirement(raw, target)).toEqual({ spec, widened });
  });

  it("never leaves a group without a lower bound at the target", () => {
    for (const raw of ["< 1.0.0", "!= 1.0.0", "> 0.5.0", "< 3.0.0 and != 2.0.0", "~> 1.3", "~> 1.0 or < 3.0.0", "< 5.0.0 or < 6.0.0"]) {
      const { spec } = rewriteHexRequirement(raw, "2.1.0");
      for (const group of spec.split(" or ")) expect(hexLowerBound(group), `${raw} -> ${spec}`).toBe("2.1.0");
    }
  });

  it("keeps unparseable clauses as written", () => {
    expect(rewriteHexRequirement("~> @v", "1.2.3").spec).toContain("~> @v");
  });
});
