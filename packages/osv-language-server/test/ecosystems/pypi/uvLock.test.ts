import { describe, expect, it } from "vitest";
import { parseUvLock } from "../../../src/ecosystems/pypi/uvLock.js";
import { ParseError } from "../../../src/ecosystems/types.js";
import { read } from "../../helpers/pypiFixture.js";
import { textAt } from "../../helpers/textAt.js";

describe("parseUvLock", () => {
  const text = read("uv.lock");
  const deps = parseUvLock(text);

  it("finds requests as a direct dep with the version text as range", () => {
    const requests = deps.find((d) => d.name === "requests")!;
    expect(requests).toMatchObject({ version: "2.25.0", direct: true });
    expect(requests.via).toBeUndefined();
    expect(textAt(text, requests.range)).toBe("2.25.0");
  });

  it("derives via for transitive packages", () => {
    expect(deps.find((d) => d.name === "urllib3")).toMatchObject({ direct: false, via: ["requests"] });
  });

  it("omits the project's own package", () => {
    expect(deps.find((d) => d.name === "demo")).toBeUndefined();
  });

  it("follows a version-qualified edge to the matching entry only", () => {
    const t = [
      '[[package]]\nname = "root"\nversion = "0"\nsource = { virtual = "." }\ndependencies = [{ name = "a" }]\n',
      '[[package]]\nname = "a"\nversion = "1"\ndependencies = [{ name = "b", version = "2" }]\n',
      '[[package]]\nname = "b"\nversion = "1"\n',
      '[[package]]\nname = "b"\nversion = "2"\n',
    ].join("\n");
    expect(parseUvLock(t).map((d) => [d.name, d.version, d.via])).toEqual([
      ["a", "1", undefined],
      ["b", "1", undefined],
      ["b", "2", ["a"]],
    ]);
  });

  it("counts the root's dev-dependencies and optional-dependencies as direct", () => {
    const t = [
      '[[package]]\nname = "root"\nversion = "0"\nsource = { editable = "." }\ndependencies = [{ name = "a" }]\n',
      '[package.optional-dependencies]\nextra = [{ name = "b" }]\n',
      '[package.dev-dependencies]\ndev = [{ name = "c" }]\n',
      '[[package]]\nname = "a"\nversion = "1"\n',
      '[[package]]\nname = "b"\nversion = "1"\n',
      '[[package]]\nname = "c"\nversion = "1"\n',
    ].join("\n");
    expect(parseUvLock(t).map((d) => [d.name, d.direct])).toEqual([["a", true], ["b", true], ["c", true]]);
  });

  it("throws ParseError on truncated input", () => {
    expect(() => parseUvLock(text.slice(0, text.indexOf('name = "requests"') + 40))).toThrow(ParseError);
  });
});
