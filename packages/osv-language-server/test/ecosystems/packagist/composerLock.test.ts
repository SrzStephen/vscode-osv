import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseComposerLock } from "../../../src/ecosystems/packagist/composerLock.js";
import { ParseError } from "../../../src/ecosystems/types.js";

const text = readFileSync(join(__dirname, "..", "..", "fixtures", "packagist", "composer.lock"), "utf8");

describe("parseComposerLock", () => {
  const deps = parseComposerLock(text);

  it("reads packages and packages-dev, skipping dev-* versions", () => {
    expect(deps.map((d) => d.name)).toEqual([
      "guzzlehttp/guzzle",
      "guzzlehttp/promises",
      "guzzlehttp/psr7",
      "psr/http-client",
      "psr/http-factory",
      "psr/http-message",
      "ralouphie/getallheaders",
      "phpunit/phpunit",
    ]);
  });

  it("locks guzzle at 7.4.4 and keeps a v prefix", () => {
    expect(deps.find((d) => d.name === "guzzlehttp/guzzle")?.version).toBe("7.4.4");
    expect(deps.find((d) => d.name === "phpunit/phpunit")?.version).toBe("v9.5.21");
  });

  it("ranges over the version text", () => {
    const d = deps.find((x) => x.name === "phpunit/phpunit")!;
    const line = text.split("\n")[d.range.start.line]!;
    expect(line.slice(d.range.start.character, d.range.end.character)).toBe("v9.5.21");
  });

  it("reports nothing direct and derives via from edges", () => {
    expect(deps.every((d) => !d.direct)).toBe(true);
    expect(deps.find((d) => d.name === "psr/http-message")?.via).toEqual(["guzzlehttp/guzzle", "guzzlehttp/psr7"]);
  });

  it("returns nothing for a lock without packages", () => expect(parseComposerLock("{}")).toEqual([]));

  it("throws ParseError on invalid JSON", () => expect(() => parseComposerLock("{")).toThrow(ParseError));
});
