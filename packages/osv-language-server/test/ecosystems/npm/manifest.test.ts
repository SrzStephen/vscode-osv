import { describe, expect, it } from "vitest";
import { parseNpmManifest } from "../../../src/ecosystems/npm/manifest.js";
import { ParseError } from "../../../src/ecosystems/types.js";

const kinds = (deps: Record<string, string>) =>
  parseNpmManifest(JSON.stringify({ dependencies: deps })).map((d) => [d.name, d.kind]);

describe("parseNpmManifest", () => {
  it("parses all groups with exact ranges, CRLF + BOM safe", () => {
    const text =
      '﻿{\r\n  "dependencies": { "lodash": "^4.17.15" },\r\n  "devDependencies": { "lodash": "4.17.10" }\r\n}';
    const deps = parseNpmManifest(text);
    expect(deps.map((d) => [d.name, d.group, d.lowerBound])).toEqual([
      ["lodash", "dependencies", "4.17.15"],
      ["lodash", "devDependencies", "4.17.10"],
    ]);
    expect(deps[0]!.specRange).toEqual({
      start: { line: 1, character: 31 },
      end: { line: 1, character: 39 },
    });
  });

  it("classifies kinds", () =>
    expect(
      kinds({
        a: "file:../a",
        b: "github:u/r",
        c: "https://x/t.tgz",
        d: "*",
        e: "npm:lodash@^4.17.0",
      }),
    ).toEqual([
      ["a", "path"],
      ["b", "git"],
      ["c", "url"],
      ["d", "unresolved"],
      ["lodash", "registry"],
    ]));

  it("treats <2.0.0 as unresolved", () => expect(kinds({ a: "<2.0.0" })).toEqual([["a", "unresolved"]]));

  it("throws ParseError on invalid JSON", () =>
    expect(() => parseNpmManifest('{"dependencies": {')).toThrow(ParseError));

  it("throws ParseError when the root is not an object", () =>
    expect(() => parseNpmManifest("[]")).toThrow(ParseError));
});
