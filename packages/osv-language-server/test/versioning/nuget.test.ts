import { describe, it, expect } from "vitest";
import { nugetComparator } from "../../src/versioning/nuget.js";

describe("nugetComparator", () => {
  it.each<[string, string, number]>([
    ["1.0.0.1", "1.0.0", 1],
    ["1.0.0-Beta", "1.0.0-beta", 0],
    ["1.0", "1.0.0.0", 0],
    ["12.0.3", "13.0.1", -1],
    ["1.0.0-rc.1", "1.0.0", -1],
    ["1.0.0-alpha.2", "1.0.0-alpha.10", -1],
    ["1.0.0-alpha", "1.0.0-alpha.1", -1],
    ["1.0.0-1", "1.0.0-a", -1],
    ["1.0.0+build1", "1.0.0+build2", 0],
    ["1.0.0.0-beta", "1.0.0", -1],
  ])("compare(%s, %s) = %i", (a, b, r) => expect(Math.sign(nugetComparator.compare(a, b))).toBe(r));
  it("validates", () => {
    expect(nugetComparator.isValid("1.2.3.4")).toBe(true);
    expect(nugetComparator.isValid("1")).toBe(true);
    expect(nugetComparator.isValid("1.0.0-Beta.1+x")).toBe(true);
    expect(nugetComparator.isValid("1.2.3.4.5")).toBe(false);
    expect(nugetComparator.isValid("latest")).toBe(false);
    expect(nugetComparator.isValid("1.*")).toBe(false);
  });
  it("normalizes", () => expect(nugetComparator.normalize(" 1.0.0+abc ")).toBe("1.0.0"));
  it("major", () => expect(nugetComparator.major("12.0.3")).toBe(12));
});
