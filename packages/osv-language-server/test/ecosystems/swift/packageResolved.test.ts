import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePackageResolved } from "../../../src/ecosystems/swift/packageResolved.js";
import { ParseError } from "../../../src/ecosystems/types.js";

const read = (f: string): string => readFileSync(join(__dirname, "..", "..", "fixtures", "swift", f), "utf8");

describe("parsePackageResolved", () => {
  it.each(["Package.resolved.v1", "Package.resolved.v2", "Package.resolved.v3"])("%s yields swift-nio 2.29.0 only", (f) => {
    const text = read(f);
    const deps = parsePackageResolved(text);
    expect(deps.map((d) => [d.name, d.version, d.direct])).toEqual([["github.com/apple/swift-nio", "2.29.0", false]]);
    const r = deps[0]!.range;
    expect(text.split("\n")[r.start.line]!.slice(r.start.character, r.end.character)).toBe("2.29.0");
  });

  it("rejects invalid JSON", () => {
    expect(() => parsePackageResolved("{")).toThrow(ParseError);
    expect(() => parsePackageResolved("[]")).toThrow(ParseError);
  });

  it("returns nothing for an unknown shape", () => {
    expect(parsePackageResolved('{"version": 9}')).toEqual([]);
  });
});
