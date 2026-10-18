import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMixExs } from "../../../src/ecosystems/hex/mixExs.js";

const text = readFileSync(join(__dirname, "..", "..", "fixtures", "hex", "mix.exs"), "utf8");
const deps = parseMixExs(text);
const get = (name: string) => deps.find((d) => d.name === name)!;
const slice = (r: { start: { line: number; character: number }; end: { line: number; character: number } }): string =>
  text.split("\n")[r.start.line]!.slice(r.start.character, r.end.character);

describe("parseMixExs", () => {
  it("reads tuples from the deps function only, ignoring comments", () => {
    expect(deps.map((d) => d.name)).toEqual(["plug", "jason", "ecto", "my_git", "my_gh", "my_path", "no_version", "telemetry"]);
  });

  it("string requirement", () => {
    expect(get("plug")).toMatchObject({ kind: "registry", rawSpec: "~> 1.3.0", lowerBound: "1.3.0", group: "deps" });
    expect(slice(get("plug").specRange!)).toBe("~> 1.3.0");
    expect(slice(get("plug").nameRange)).toBe("plug");
  });

  it("string plus options, with only: as the group", () => {
    expect(get("jason")).toMatchObject({ kind: "registry", rawSpec: "~> 1.4", group: "test" });
    expect(get("ecto")).toMatchObject({ rawSpec: ">= 3.0.0 and < 4.0.0", lowerBound: "3.0.0", group: "dev,test" });
  });

  it("git, github and path options", () => {
    expect(get("my_git")).toMatchObject({ kind: "git", group: "deps" });
    expect(get("my_git").rawSpec).toBeUndefined();
    expect(get("my_gh").kind).toBe("git");
    expect(get("my_path").kind).toBe("path");
  });

  it("options without a requirement is unresolved", () => {
    expect(get("no_version")).toMatchObject({ kind: "unresolved", group: "dev" });
  });

  it("or requirements use the lowest bound", () => {
    expect(get("telemetry").lowerBound).toBe("1.0.0");
  });

  it("handles def deps with do: and a one-line list", () => {
    const d = parseMixExs('defmodule M do\n  def deps, do: [{:a, "~> 1.0"}, {:b, "2.0.0", only: :test}]\nend\n');
    expect(d.map((x) => [x.name, x.rawSpec, x.group])).toEqual([["a", "~> 1.0", "deps"], ["b", "2.0.0", "test"]]);
  });

  it("returns nothing without a deps function", () => {
    expect(parseMixExs("defmodule M do\nend\n")).toEqual([]);
    expect(parseMixExs("")).toEqual([]);
  });

  it("handles CRLF", () => {
    expect(parseMixExs(text.replace(/\n/g, "\r\n")).find((d) => d.name === "plug")?.rawSpec).toBe("~> 1.3.0");
  });
});
