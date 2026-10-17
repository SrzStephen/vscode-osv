import { describe, it, expect } from "vitest";
import { semverComparator } from "../../src/versioning/semver.js";

describe("semverComparator", () => {
  it.each<[string, string, number]>([
    ["1.2.3", "1.2.10", -1],
    ["v1.0.0", "1.0.0", 0],
    ["1.0.0-rc.1", "1.0.0", -1],
    ["2.0.0", "1.9.9", 1],
  ])("compare(%s, %s) = %i", (a, b, r) => expect(Math.sign(semverComparator.compare(a, b))).toBe(r));
  it("validates", () => {
    expect(semverComparator.isValid("1.2.3")).toBe(true);
    expect(semverComparator.isValid("latest")).toBe(false);
  });
  it("major", () => expect(semverComparator.major("v3.4.5")).toBe(3));
});
