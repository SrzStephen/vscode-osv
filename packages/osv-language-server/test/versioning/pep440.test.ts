import { describe, it, expect } from "vitest";
import { pep440Comparator } from "../../src/versioning/pep440.js";

describe("pep440Comparator", () => {
  it.each<[string, string, number]>([
    ["1.0.dev1", "1.0a1", -1],
    ["1.0a1", "1.0rc1", -1],
    ["1.0rc1", "1.0", -1],
    ["1.0", "1.0.post1", -1],
    ["1.0", "1.0.0", 0],
    ["1!0.1", "2.0", 1],
  ])("compare(%s, %s) = %i", (a, b, r) => {
    expect(Math.sign(pep440Comparator.compare(a, b))).toBe(r);
  });

  it("major", () => {
    expect(pep440Comparator.major("2.31.0")).toBe(2);
  });
});
