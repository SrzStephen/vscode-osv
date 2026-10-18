import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePubspecLock } from "../../../src/ecosystems/pub/pubspecLock.js";
import { ParseError } from "../../../src/ecosystems/types.js";

const text = readFileSync(join(__dirname, "..", "..", "fixtures", "pub", "pubspec.lock"), "utf8");

describe("parsePubspecLock", () => {
  const deps = parsePubspecLock(text);
  const dep = (name: string) => deps.find((d) => d.name === name)!;

  it("skips sdk and path sources", () => {
    expect(deps.map((d) => d.name)).toEqual(["collection", "http", "http_parser", "path", "test"]);
  });

  it("marks direct and transitive", () => {
    expect(dep("http").direct).toBe(true);
    expect(dep("path").direct).toBe(true);
    expect(dep("test").direct).toBe(true);
    expect(dep("collection").direct).toBe(false);
    expect(dep("http_parser").direct).toBe(false);
  });

  it("ranges over the version without quotes", () => {
    expect(dep("http").version).toBe("0.12.0");
    for (const name of ["http", "test"]) {
      const r = dep(name).range;
      expect(text.split("\n")[r.start.line]!.slice(r.start.character, r.end.character)).toBe(dep(name).version);
    }
  });

  it("throws ParseError on invalid YAML", () => {
    expect(() => parsePubspecLock("a: [")).toThrow(ParseError);
  });
});
