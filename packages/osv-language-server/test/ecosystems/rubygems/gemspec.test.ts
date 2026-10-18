import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGemspec } from "../../../src/ecosystems/rubygems/gemspec.js";

const text = readFileSync(join(__dirname, "..", "..", "fixtures", "rubygems", "app.gemspec"), "utf8");

describe("parseGemspec", () => {
  it("reads dependency declarations", () =>
    expect(parseGemspec(text).map((d) => [d.name, d.group, d.rawSpec, d.lowerBound, d.kind])).toEqual([
      ["rack", "runtime", '"~> 2.2"', "2.2", "registry"],
      ["nokogiri", "runtime", "'>= 1.13', '< 2'", "1.13", "registry"],
      ["rspec", "development", '"3.0"', "3.0", "registry"],
      ["racc", "runtime", undefined, undefined, "unresolved"],
    ]));

  it("locates the requirement literals", () => {
    const rack = parseGemspec(text).find((d) => d.name === "rack")!;
    const line = text.split("\n")[rack.specRange!.start.line]!;
    expect(line.slice(rack.specRange!.start.character, rack.specRange!.end.character)).toBe('"~> 2.2"');
  });
});
