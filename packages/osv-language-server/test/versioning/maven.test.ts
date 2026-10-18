import { describe, it, expect } from "vitest";
import { mavenComparator } from "../../src/versioning/maven.js";

describe("mavenComparator", () => {
  it.each<[string, string, number]>([
    ["1.0-alpha1", "1.0-beta1", -1],
    ["1.0-beta1", "1.0-m1", -1],
    ["1.0-m1", "1.0-rc1", -1],
    ["1.0-rc1", "1.0-SNAPSHOT", -1],
    ["1.0-SNAPSHOT", "1.0", -1],
    ["1.0", "1.0-sp1", -1],
    ["1.0", "1.0.0", 0],
    ["1.0.0", "1-ga", 0],
    ["1.0", "1-ga", 0],
    ["1.0.1", "1.0-sp1", 1],
    ["2.14.1", "2.15.0", -1],
    ["1.0-RC1", "1.0-cr1", 0],
    ["2.12.2", "2.14.1", -1],
    ["1.0-foo", "1.0-bar", 1],
    ["1.0-sp1", "1.0-foo", -1],
    ["1.0-alpha-1", "1.0-alpha-2", -1],
    ["1.0-a1", "1.0-alpha1", 0],
  ])("compare(%s, %s) = %i", (a, b, r) => {
    expect(Math.sign(mavenComparator.compare(a, b)) || 0).toBe(r);
    expect(Math.sign(mavenComparator.compare(b, a)) || 0).toBe(-r || 0);
  });

  it("isValid / major / normalize", () => {
    expect(mavenComparator.isValid("1.0")).toBe(true);
    expect(mavenComparator.isValid("abc")).toBe(false);
    expect(mavenComparator.major("2.14.1")).toBe(2);
    expect(mavenComparator.major("2-beta")).toBe(2);
    expect(mavenComparator.normalize(" 1.0 ")).toBe("1.0");
  });
});
