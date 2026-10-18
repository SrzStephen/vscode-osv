import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LineIndex } from "../../../src/core/lineIndex.js";
import { parseNugetLock } from "../../../src/ecosystems/nuget/lock.js";
import { ParseError } from "../../../src/ecosystems/types.js";

const text = readFileSync(join(__dirname, "..", "..", "fixtures", "nuget", "packages.lock.json"), "utf8");
const read = () => text;

describe("parseNugetLock", () => {
  const deps = parseNugetLock(read());

  it("lock dedupes target frameworks", () => expect(parseNugetLock(read()).filter((d) => d.name === "Newtonsoft.Json")).toHaveLength(1));

  it("keeps Direct entries direct and skips Project entries", () => {
    expect(deps.map((d) => `${d.name}@${d.version}:${d.direct}`).sort()).toEqual([
      "Dapper.Extra@1.0.0:false",
      "Newtonsoft.Json@12.0.3:true",
      "Serilog@2.10.0:true",
    ]);
  });

  it("ranges cover the resolved value of the first occurrence", () => {
    const nj = deps.find((d) => d.name === "Newtonsoft.Json")!;
    const ix = new LineIndex(text);
    expect(text.slice(ix.offset(nj.range.start), ix.offset(nj.range.end))).toBe("12.0.3");
    expect(nj.range.start.line).toBe(7);
  });

  it("derives via for a transitive reached from a direct dep", () => {
    const lock = JSON.stringify({
      version: 1,
      dependencies: {
        "net8.0": {
          A: { type: "Direct", resolved: "1.0.0", dependencies: { B: "1.0.0" } },
          B: { type: "Transitive", resolved: "1.2.0" },
        },
      },
    });
    expect(parseNugetLock(lock).find((d) => d.name === "B")).toMatchObject({ direct: false, via: ["A"] });
  });

  it("keeps different versions of one package across frameworks", () => {
    const lock = JSON.stringify({
      version: 1,
      dependencies: { a: { X: { type: "Direct", resolved: "1.0.0" } }, b: { X: { type: "Direct", resolved: "2.0.0" } } },
    });
    expect(parseNugetLock(lock).map((d) => d.version)).toEqual(["1.0.0", "2.0.0"]);
  });

  it("throws ParseError on invalid JSON", () => expect(() => parseNugetLock("{")).toThrow(ParseError));
});
