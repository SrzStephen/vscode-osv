import { describe, expect, it } from "vitest";
import { semverLooseComparator } from "../../src/versioning/semverLoose.js";

describe("semverLooseComparator", () => {
  it.each([
    ["41", "45.0.0", -1],
    ["v4.1", "4.1.0", 0],
    ["46.0.1", "46", 1],
  ])("loose compare %s %s", (a, b, r) => {
    expect(Math.sign(semverLooseComparator.compare(a, b))).toBe(r);
  });

  it("validates by coercion and reads the major from the coerced version", () => {
    expect(semverLooseComparator.isValid("41")).toBe(true);
    expect(semverLooseComparator.isValid("v4.1")).toBe(true);
    expect(semverLooseComparator.isValid("main")).toBe(false);
    expect(semverLooseComparator.major("v4.1")).toBe(4);
    expect(semverLooseComparator.major("41")).toBe(41);
  });
});
