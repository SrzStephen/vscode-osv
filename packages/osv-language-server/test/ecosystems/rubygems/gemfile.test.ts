import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGemfile } from "../../../src/ecosystems/rubygems/gemfile.js";

const read = (name: string): string => readFileSync(join(__dirname, "..", "..", "fixtures", "rubygems", name), "utf8");
const rows = (deps: ReturnType<typeof parseGemfile>) => deps.map((d) => [d.name, d.group ?? "default", d.lowerBound, d.kind]);

describe("parseGemfile", () => {
  it("Gemfile forms", () =>
    expect(rows(parseGemfile(read("Gemfile")))).toEqual([
      ["rack", "default", "2.2.3", "registry"],
      ["rails", "default", "7.0.0", "registry"],
      ["rspec", "test", "3.0", "registry"],
      ["mygem", "default", undefined, "git"],
    ]));

  it("spans the requirement literals", () => {
    const text = read("Gemfile");
    const rack = parseGemfile(text).find((d) => d.name === "rack")!;
    expect(rack.rawSpec).toBe("'~> 2.2', '>= 2.2.3'");
    const line = text.split("\n")[rack.specRange!.start.line]!;
    expect(line.slice(rack.specRange!.start.character, rack.specRange!.end.character)).toBe(rack.rawSpec);
    expect(line.slice(rack.nameRange.start.character, rack.nameRange.end.character)).toBe("rack");
  });

  it("accepts parens, double quotes and trailing options", () => {
    const [d] = parseGemfile(`gem("a", ">= 1.0", "< 2", require: false)\n`);
    expect(d).toMatchObject({ name: "a", rawSpec: '">= 1.0", "< 2"', lowerBound: "1.0", kind: "registry" });
  });

  it("a gem without a requirement is unresolved", () =>
    expect(parseGemfile(`gem "a"\ngem "b", require: false\n`).map((d) => d.kind)).toEqual(["unresolved", "unresolved"]));

  it("git, github and path options", () => {
    const deps = parseGemfile(
      [`gem "a", git: "https://x/a.git"`, `gem "b", github: "o/b"`, `gem "c", "1.0", :path => "../c"`, `gem "d", "~> 1", git: "u"`].join("\n"),
    );
    expect(deps.map((d) => d.kind)).toEqual(["git", "git", "path", "git"]);
  });

  it("a trailing comment does not read as a path option", () =>
    expect(parseGemfile(`gem "a", "1.0" # path: ../a\n`)[0]).toMatchObject({ name: "a", kind: "registry", rawSpec: '"1.0"' }));

  it("a trailing comment does not read as a git option", () =>
    expect(parseGemfile(`gem "b", "~> 2.0" # was github: foo/b\n`)[0]).toMatchObject({ name: "b", kind: "registry", lowerBound: "2.0" }));

  it("a trailing comment does not set the group", () => {
    const [d] = parseGemfile(`gem "c", "1.0" # groups: [:test]\n`);
    expect(d).toMatchObject({ name: "c", kind: "registry" });
    expect(d!.group).toBeUndefined();
  });

  it("options after a commented continuation line still count", () =>
    expect(parseGemfile(`gem "d", "1.0", # local copy\n  path: "../d"\n`)[0]).toMatchObject({ name: "d", kind: "path" }));

  it("group blocks and the group option", () => {
    const deps = parseGemfile(
      [
        `group :development, :test do`,
        `  gem "a", "1"`,
        `  platforms :ruby do`,
        `    gem "b", "1"`,
        `  end`,
        `end`,
        `gem "c", "1"`,
        `gem "d", "1", group: :ci`,
        `gem "e", "1", groups: [:x, :y]`,
        `if ENV["X"]`,
        `  gem "f", "1"`,
        `end`,
        `gem "g", "1"`,
      ].join("\n"),
    );
    expect(deps.map((d) => [d.name, d.group])).toEqual([
      ["a", "development"],
      ["b", "development"],
      ["c", undefined],
      ["d", "ci"],
      ["e", "x"],
      ["f", undefined],
      ["g", undefined],
    ]);
  });

  it("skips comments, source and ruby lines", () =>
    expect(parseGemfile(`# gem "a", "1"\nsource "https://rubygems.org"\nruby "3.1.0"\ngem "b", "1" # gem "c", "2"\n`).map((d) => d.name)).toEqual(["b"]));

  it("follows a declaration onto continuation lines", () => {
    const text = `gem "a",\n  "~> 1.0",\n  require: false\n`;
    const [d] = parseGemfile(text);
    expect(d).toMatchObject({ rawSpec: '"~> 1.0"', specRange: { start: { line: 1, character: 2 }, end: { line: 1, character: 10 } } });
  });

  it("handles CRLF line endings", () => {
    const [d] = parseGemfile(`gem "a", "1.0"\r\ngem "b", "2.0"\r\n`);
    expect(d?.specRange).toEqual({ start: { line: 0, character: 9 }, end: { line: 0, character: 14 } });
  });
});
