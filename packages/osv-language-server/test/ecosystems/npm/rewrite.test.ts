import { describe, expect, it } from "vitest";
import { rewriteNpmSpec } from "../../../src/ecosystems/npm/rewrite.js";

describe("rewriteNpmSpec", () => {
  it.each([
    ["^1.2.3", "1.4.0", "^1.4.0", false],
    ["~1.2.3", "1.4.0", "~1.4.0", false],
    ["1.2.3", "1.4.0", "1.4.0", false],
    [">=1.2.3 <2", "1.4.0", ">=1.4.0 <2", false],
    [">=1.2.3 <2", "2.1.0", ">=2.1.0", true],
    ["1.2.x", "1.4.0", "1.4.x", false],
    ["1.2.x", "1.4.3", "~1.4.3", false],
    ["^1.0.0 || ^2.0.0", "2.3.0", "^2.3.0", true],
  ])("rewrite %s → %s", (raw, t, spec, widened) =>
    expect(rewriteNpmSpec(raw, t)).toEqual({ spec, widened }),
  );
});
