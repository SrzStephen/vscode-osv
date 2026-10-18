import { describe, it, expect } from "vitest";
import { composerComparator } from "../../src/versioning/composer.js";

describe("composerComparator", () => {
  it.each<[string, string, number]>([
    ["7.4.5", "7.4.4", 1],
    ["1.0.0-RC1", "1.0.0", -1],
    ["v2.0", "2.0.0.0", 0],
    ["1.0.0-dev", "1.0.0-alpha1", -1],
    ["1.0.0-alpha1", "1.0.0-beta1", -1],
    ["1.0.0-a1", "1.0.0-alpha1", 0],
    ["1.0.0-beta2", "1.0.0-RC1", -1],
    ["1.0.0-RC1", "1.0.0-RC2", -1],
    ["1.0.0-p1", "1.0.0", 1],
    ["1.0.0-patch1", "1.0.0-pl1", 0],
    ["1.0.0-beta", "1.0.0-beta1", -1],
    ["1.10", "1.9", 1],
    ["1.0.0.1", "1.0.0", 1],
  ])("compare(%s, %s) = %i", (a, b, r) => {
    expect(Math.sign(composerComparator.compare(a, b)) || 0).toBe(r);
    expect(Math.sign(composerComparator.compare(b, a)) || 0).toBe(-r || 0);
  });

  it("isValid / major / normalize", () => {
    expect(composerComparator.isValid("v1.2.3")).toBe(true);
    expect(composerComparator.isValid("1.0.0-RC1")).toBe(true);
    expect(composerComparator.isValid("dev-main")).toBe(false);
    expect(composerComparator.isValid("")).toBe(false);
    expect(composerComparator.major("v7.1.3")).toBe(7);
    expect(composerComparator.normalize("v2.0")).toBe("2.0.0.0");
    expect(composerComparator.normalize("1.0.0-RC1")).toBe("1.0.0.0-RC1");
  });
});
