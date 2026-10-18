import { describe, expect, it } from "vitest";
import { mavenLowerBound, rewriteMavenSpec } from "../../../src/ecosystems/maven/range.js";

describe("mavenLowerBound", () => {
  it.each([
    ["[1.2,2.0)", "1.2"],
    ["(1.2,2.0)", undefined],
    ["[1.0,]", "1.0"],
    ["(,2.0]", undefined],
    ["[1.0]", "1.0"],
    ["[1,2),[3,4)", "1"],
    ["1.2.3", "1.2.3"],
    ["LATEST", undefined],
    ["", undefined],
  ])("lower bound %s", (s, lb) => expect(mavenLowerBound(s)).toBe(lb));
});

describe("rewriteMavenSpec", () => {
  it.each([
    ["2.14.1", "2.17.1", "2.17.1", false],
    ["[2.0,2.16)", "2.17.1", "[2.17.1,)", true],
    ["[2.0,3.0)", "2.17.1", "[2.17.1,3.0)", false],
    ["[2.0,]", "2.17.1", "[2.17.1,]", false],
    ["(2.0,3.0]", "2.17.1", "[2.17.1,3.0]", false],
    ["[2.0]", "2.17.1", "[2.17.1]", false],
    ["[1,2),[3,4)", "3.5", "[3.5,)", true],
  ])("rewrite %s", (r, t, spec, w) => expect(rewriteMavenSpec(r, t)).toEqual({ spec, widened: w }));
});
