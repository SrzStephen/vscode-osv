import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMixLock } from "../../../src/ecosystems/hex/mixLock.js";

const text = readFileSync(join(__dirname, "..", "..", "fixtures", "hex", "mix.lock"), "utf8");
const deps = parseMixLock(text);

describe("parseMixLock", () => {
  it("reads hex entries and skips git and path", () => {
    expect(deps.map((d) => `${d.name}@${d.version}`)).toEqual(["cowboy@1.1.2", "cowlib@1.0.2", "mime@1.6.0", "plug@1.3.0", "ranch@1.3.2", "real_name@2.0.0"]);
  });

  it("uses the package atom as the name, not the key", () => {
    expect(deps.some((d) => d.name === "forked")).toBe(false);
  });

  it("ranges over the version text and marks nothing direct", () => {
    const plug = deps.find((d) => d.name === "plug")!;
    const line = text.split("\n")[plug.range.start.line]!;
    expect(line.slice(plug.range.start.character, plug.range.end.character)).toBe("1.3.0");
    expect(deps.every((d) => !d.direct)).toBe(true);
  });

  it("derives via chains from the dependency lists", () => {
    expect(deps.find((d) => d.name === "mime")?.via).toEqual(["plug"]);
    expect(deps.find((d) => d.name === "ranch")?.via).toEqual(["plug", "cowboy"]);
  });

  it("returns nothing for an empty file or empty map", () => {
    expect(parseMixLock("")).toEqual([]);
    expect(parseMixLock("%{\n}\n")).toEqual([]);
  });

  it("handles CRLF", () => {
    expect(parseMixLock(text.replace(/\n/g, "\r\n")).find((d) => d.name === "mime")?.version).toBe("1.6.0");
  });
});
