import { describe, expect, it } from "vitest";
import { cargoLowerBound, rewriteCargoReq } from "../../../src/ecosystems/cargo/req.js";

describe("cargoLowerBound", () => {
  it.each([
    ["1.2", "1.2.0"], ["=1.2.3", "1.2.3"], ["~1.2", "1.2.0"], [">=1.0, <2", "1.0.0"], ["*", undefined], ["<2", undefined],
    ["1.*", "1.0.0"], ["^0.6.9", "0.6.9"], ["=0.0.0", "0.0.0"], ["1.2.3,<1.5", "1.2.3"], ["garbage", undefined],
  ])("lower bound %s", (r, lb) => expect(cargoLowerBound(r)).toBe(lb));
});

describe("rewriteCargoReq", () => {
  it.each([
    ["1.2", "1.4.0", "1.4"], ["1.2", "1.4.3", "1.4.3"], ["=1.2.3", "1.4.0", "=1.4.0"], ["^0.6.9", "0.6.10", "^0.6.10"],
    ["~1.2", "1.3.0", "~1.3"], [">1.0", "1.2.0", ">=1.2"], ["1", "2.0.0", "2"],
  ])("rewrite %s -> %s", (raw, t, spec) => expect(rewriteCargoReq(raw, t).spec).toBe(spec));
  it("keeps satisfied upper bounds", () => expect(rewriteCargoReq(">=1.0, <3", "2.0.0")).toEqual({ spec: ">=2.0, <3", widened: false }));
  it("drops violated upper bounds", () => expect(rewriteCargoReq(">=1.0, <2", "2.1.0")).toEqual({ spec: ">=2.1", widened: true }));
});
