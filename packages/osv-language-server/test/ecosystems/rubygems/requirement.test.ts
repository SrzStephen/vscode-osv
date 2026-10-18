import { describe, it, expect } from "vitest";
import { gemLowerBound, rewriteGemRequirements } from "../../../src/ecosystems/rubygems/requirement.js";

describe("gemLowerBound", () => {
  it.each<[string[], string | undefined]>([
    [["~> 1.2", ">= 1.2.3"], "1.2.3"],
    [["1.4.0"], "1.4.0"],
    [["= 1.4.0"], "1.4.0"],
    [[">= 1.0", "< 2"], "1.0"],
    [["< 2"], undefined],
    [["<= 2", "!= 1.5", "> 1.0"], undefined],
    [[], undefined],
  ])("%j -> %s", (reqs, expected) => {
    expect(gemLowerBound(reqs)).toBe(expected);
  });
});

describe("rewriteGemRequirements", () => {
  it.each<[string[], string, string[], boolean]>([
    [["1.4.0"], "1.6.0", ["1.6.0"], false],
    [["= 1.4.0"], "1.6.0", ["= 1.6.0"], false],
    [[">= 1.4"], "1.6.3", [">= 1.6.3"], false],
    [["~> 1.4"], "1.6.0", ["~> 1.6"], false],
    [["~> 1.4"], "1.6.3", ["~> 1.6", ">= 1.6.3"], false],
    [["~> 1.4.2"], "1.6.0", ["~> 1.6.0"], true],
    [["~> 2.2", ">= 2.2.3"], "2.2.20", ["~> 2.2", ">= 2.2.20"], false],
    [["~> 1.4"], "2.0.0", ["~> 2.0"], true],
    [[">= 1.0", "< 2"], "3.0.0", [">= 3.0.0"], true],
    [[">= 1.0", "< 2"], "1.5.0", [">= 1.5.0", "< 2"], false],
    [["> 1.0", "< 3"], "2.0", [">= 2.0", "< 3"], false],
    [["< 2"], "3", [">= 3"], true],
    [["!= 1.5"], "1.5", [">= 1.5"], true],
    [["> 5"], "3", [">= 3"], true],
    [["~> 1.4"], "1.6.0.1", ["~> 1.6", ">= 1.6.0.1"], false],
    [["~> 7.1.0.beta1"], "7.1.3", ["~> 7.1.3"], false],
    [["~> 1.0.0-rc.1"], "1.0.5", ["~> 1.0.5"], false],
    [["~> 1.4.2"], "1.17.0.rc1", ["~> 1.17.0.rc1"], true],
    [["~> 1.4"], "1.17.0.rc1", ["~> 1.17.0.rc1"], false],
  ])("%j + %s", (reqs, target, expected, widened) => {
    expect(rewriteGemRequirements(reqs, target)).toEqual({ reqs: expected, widened });
  });
});
