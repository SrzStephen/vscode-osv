import { describe, it, expect } from "vitest";
import { rubygemsComparator } from "../../src/versioning/rubygems.js";

describe("rubygemsComparator", () => {
  it.each<[string, string, number]>([
    ["2.2.8.1", "2.2.8", 1],
    ["1.0.a", "1.0", -1],
    ["1.0", "1.0.0", 0],
    ["1.0", "1", 0],
    ["2.2.20", "2.2.18", 1],
    ["1.0.a", "1.0.b", -1],
    ["1.0.a", "1.0.1", -1],
    ["1.0.rc1", "1.0.rc2", -1],
    ["1.0-beta", "1.0.pre.beta", 0],
    ["1.0-beta", "1.0", -1],
    ["1.10", "1.9", 1],
  ])("compare(%s, %s) = %i", (a, b, r) => {
    expect(Math.sign(rubygemsComparator.compare(a, b)) || 0).toBe(r);
    expect(Math.sign(rubygemsComparator.compare(b, a)) || 0).toBe(-r || 0);
  });

  it("isValid / major / normalize", () => {
    expect(rubygemsComparator.isValid("1.0.a")).toBe(true);
    expect(rubygemsComparator.isValid("abc")).toBe(false);
    expect(rubygemsComparator.isValid("")).toBe(false);
    expect(rubygemsComparator.major("7.1.3")).toBe(7);
    expect(rubygemsComparator.normalize(" 1.2 ")).toBe("1.2");
  });
});
