import { describe, it, expect } from "vitest";
import { normalizePypiName } from "../../../src/ecosystems/pypi/names.js";

describe("normalizePypiName", () => {
  it("normalizes names", () => {
    expect(normalizePypiName("Zope.Interface__x")).toBe("zope-interface-x");
  });
});
