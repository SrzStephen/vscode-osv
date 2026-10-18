import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGemfileLock } from "../../../src/ecosystems/rubygems/gemfileLock.js";

const text = readFileSync(join(__dirname, "..", "..", "fixtures", "rubygems", "Gemfile.lock"), "utf8");

describe("parseGemfileLock", () => {
  it("platform gems collapse", () => expect(parseGemfileLock(text).filter((d) => d.name === "nokogiri")).toHaveLength(1));

  it("strips the platform from the version and ranges over the version text", () => {
    const n = parseGemfileLock(text).find((d) => d.name === "nokogiri")!;
    expect(n.version).toBe("1.13.0");
    const line = text.split("\n")[n.range.start.line]!;
    expect(line.slice(n.range.start.character, n.range.end.character)).toBe("1.13.0");
  });

  it("marks DEPENDENCIES names direct, with paths for the rest", () => {
    const deps = parseGemfileLock(text);
    expect(deps.filter((d) => d.direct).map((d) => d.name).sort()).toEqual(["rack", "rails", "rspec"]);
    expect(deps.find((d) => d.name === "racc")).toMatchObject({ direct: false, via: ["rails", "nokogiri"] });
  });

  it("skips GIT sections", () => expect(parseGemfileLock(text).some((d) => d.name === "mygem")).toBe(false));

  it("returns nothing for an empty file", () => expect(parseGemfileLock("")).toEqual([]));

  it("handles CRLF", () => expect(parseGemfileLock(text.replace(/\n/g, "\r\n")).find((d) => d.name === "rack")?.version).toBe("2.2.3"));
});
