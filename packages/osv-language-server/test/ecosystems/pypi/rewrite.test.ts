import { describe, expect, it } from "vitest";
import { rewritePep440Spec } from "../../../src/ecosystems/pypi/rewrite.js";

describe("rewritePep440Spec", () => {
  it.each([
    ["==2.0", "2.5", "==2.5", false],
    [">=2.0,<3", "2.5", ">=2.5,<3", false],
    [">=2.0,<3", "3.1", ">=3.1", true],
    ["~=2.0", "2.5", "~=2.5", false],
    ["==1.2.*", "1.4.0", "==1.4.*", false],
    ["==1.2.*", "1.4.2", "~=1.4.2", false],
    [">=1.0, !=1.5", "2.0", ">=2.0, !=1.5", false],
    [">=2.0,<=2.9", "3.0", ">=3.0", true],
    ["===2.0", "2.5", "===2.5", false],
  ])("rewrite %s → %s", (raw, t, spec, widened) =>
    expect(rewritePep440Spec(raw, t)).toEqual({ spec, widened }));

  it("adds a floor when no clause sets a lower bound", () => {
    expect(rewritePep440Spec("<3", "2.5")).toEqual({ spec: ">=2.5,<3", widened: false });
  });
});
