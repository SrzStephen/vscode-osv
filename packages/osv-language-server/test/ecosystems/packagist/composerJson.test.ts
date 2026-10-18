import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseComposerJson } from "../../../src/ecosystems/packagist/composerJson.js";
import { ParseError } from "../../../src/ecosystems/types.js";

const text = readFileSync(join(__dirname, "..", "..", "fixtures", "packagist", "composer.json"), "utf8");

describe("parseComposerJson", () => {
  const deps = parseComposerJson(text);

  it("skips platform packages", () => {
    for (const n of ["php", "ext-json", "composer-runtime-api"]) expect(deps.map((d) => d.name)).not.toContain(n);
  });

  it("reads require and require-dev with lowercased names", () => {
    expect(deps.map((d) => d.name)).toEqual(["guzzlehttp/guzzle", "acme/edge", "acme/snapshot", "phpunit/phpunit"]);
    expect(deps.find((d) => d.name === "phpunit/phpunit")).toMatchObject({ group: "require-dev", kind: "registry", lowerBound: "9.5" });
    expect(deps[0]).toMatchObject({ group: "require", rawSpec: "^7.4", lowerBound: "7.4", kind: "registry" });
  });

  it("classifies dev versions as git", () => {
    expect(deps.find((d) => d.name === "acme/edge")?.kind).toBe("git");
    expect(deps.find((d) => d.name === "acme/snapshot")?.kind).toBe("git");
  });

  it("ranges cover the string content", () => {
    const lines = text.split("\n");
    const d = deps[0]!;
    expect(lines[d.specRange!.start.line]!.slice(d.specRange!.start.character, d.specRange!.end.character)).toBe("^7.4");
    expect(lines[d.nameRange.start.line]!.slice(d.nameRange.start.character, d.nameRange.end.character)).toBe("Guzzlehttp/Guzzle");
  });

  it("skips every platform name form", () => {
    const names = ["php", "php-64bit", "hhvm", "ext-mbstring", "lib-curl", "composer", "composer-plugin-api", "composer-runtime-api"];
    const json = JSON.stringify({ require: Object.fromEntries([...names, "a/b"].map((n) => [n, "*"])) });
    expect(parseComposerJson(json).map((d) => d.name)).toEqual(["a/b"]);
  });

  it("marks unconstrained specs unresolved", () => expect(parseComposerJson('{"require":{"a/b":"*"}}')[0]?.kind).toBe("unresolved"));

  it("throws ParseError on invalid JSON", () => expect(() => parseComposerJson("{")).toThrow(ParseError));

  it("returns nothing without dependency groups", () => expect(parseComposerJson("{}")).toEqual([]));
});
