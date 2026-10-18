import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePackageSwift } from "../../../src/ecosystems/swift/packageSwift.js";
import type { TextRange } from "../../../src/core/types.js";

const read = (f: string): string => readFileSync(join(__dirname, "..", "..", "fixtures", "swift", f), "utf8");
const slice = (text: string, r: TextRange): string => text.split("\n")[r.start.line]!.slice(r.start.character, r.end.character);

describe("parsePackageSwift", () => {
  it("Package.swift forms", () => {
    const rows = parsePackageSwift(read("Package.swift")).map((d) => [d.name, d.lowerBound, d.kind]);
    expect(rows).toEqual([
      ["github.com/apple/swift-nio", "2.29.0", "registry"],
      ["github.com/vapor/vapor", "4.0.0", "registry"],
      ["github.com/a/b", undefined, "git"],
    ]);
  });

  it("locates the name and the version", () => {
    const text = read("Package.swift");
    const deps = parsePackageSwift(text);
    expect(deps[0]!.rawSpec).toBe("2.29.0");
    expect(slice(text, deps[0]!.specRange!)).toBe("2.29.0");
    expect(slice(text, deps[0]!.nameRange)).toBe("https://github.com/apple/swift-nio.git");
    expect(slice(text, deps[1]!.specRange!)).toBe("4.0.0");
  });

  it("covers every requirement form", () => {
    const text = read("Package.forms.swift");
    const deps = parsePackageSwift(text);
    expect(deps.map((d) => [d.name, d.kind, d.rawSpec, d.lowerBound])).toEqual([
      ["github.com/x/exact", "registry", "1.2.3", "1.2.3"],
      ["github.com/x/exactfn", "registry", "1.2.4", "1.2.4"],
      ["github.com/x/minor", "registry", "1.3.0", "1.3.0"],
      ["github.com/x/half", "registry", '"1.0.0"..<"2.0.0"', "1.0.0"],
      ["github.com/x/closed", "registry", '"1.0.0"..."2.0.0"', "1.0.0"],
      ["github.com/x/rev", "git", undefined, undefined],
      ["github.com/x/branchfn", "git", undefined, undefined],
      ["../local", "path", undefined, undefined],
      ["github.com/x/bare", "unresolved", undefined, undefined],
    ]);
    expect(slice(text, deps[3]!.specRange!)).toBe('"1.0.0"..<"2.0.0"');
    expect(slice(text, deps[4]!.specRange!)).toBe('"1.0.0"..."2.0.0"');
    expect(slice(text, deps[1]!.specRange!)).toBe("1.2.4");
  });

  it("ignores .package inside strings and tolerates garbage", () => {
    expect(parsePackageSwift('let s = ".package(url: \\"https://github.com/a/b\\", from: \\"1.0.0\\")"')).toEqual([]);
    expect(parsePackageSwift('.package(url: "https://github.com/a/b", from: "1.0.0"')).toEqual([]);
    expect(parsePackageSwift("")).toEqual([]);
  });
});
