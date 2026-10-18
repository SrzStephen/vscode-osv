import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LineIndex } from "../../../src/core/lineIndex.js";
import { parsePackagesConfig } from "../../../src/ecosystems/nuget/packagesConfig.js";
import { ParseError } from "../../../src/ecosystems/types.js";

const text = readFileSync(join(__dirname, "..", "..", "fixtures", "nuget", "packages.config"), "utf8");

describe("parsePackagesConfig", () => {
  it("packages.config", () => {
    const deps = parsePackagesConfig(text);
    expect(deps.map((d) => [d.name, d.rawSpec, d.lowerBound, d.kind])).toEqual([
      ["Newtonsoft.Json", "12.0.3", "12.0.3", "registry"],
      ["log4net", "2.0.8", "2.0.8", "registry"],
    ]);
    const ix = new LineIndex(text);
    const r = deps[0]!.specRange!;
    expect(text.slice(ix.offset(r.start), ix.offset(r.end))).toBe("12.0.3");
    expect(r.start.line).toBe(2);
  });
  it("throws ParseError on invalid XML", () => expect(() => parsePackagesConfig("<packages>")).toThrow(ParseError));
});
