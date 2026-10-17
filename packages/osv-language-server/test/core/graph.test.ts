import { describe, expect, it } from "vitest";
import { computeVia } from "../../src/core/graph.js";

describe("computeVia", () => {
  it("computes shortest via paths", () => {
    const via = computeVia(
      ["express"],
      new Map([
        ["express", ["body-parser", "qs"]],
        ["body-parser", ["qs", "raw-body"]],
      ]),
    );
    expect(via.get("qs")).toEqual(["express"]);
    expect(via.get("raw-body")).toEqual(["express", "body-parser"]);
    expect(via.has("express")).toBe(false);
  });

  it("excludes other direct nodes and terminates on cycles", () => {
    const via = computeVia(
      ["a", "b"],
      new Map([
        ["a", ["b", "c"]],
        ["c", ["a", "d"]],
      ]),
    );
    expect(via.has("b")).toBe(false);
    expect(via.get("c")).toEqual(["a"]);
    expect(via.get("d")).toEqual(["a", "c"]);
  });
});
