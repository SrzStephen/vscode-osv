import { describe, expect, it } from "vitest";
import { parsePoetryLock } from "../../../src/ecosystems/pypi/poetryLock.js";
import { ParseError } from "../../../src/ecosystems/types.js";
import { read } from "../../helpers/pypiFixture.js";
import { textAt } from "../../helpers/textAt.js";

describe("parsePoetryLock", () => {
  const text = read("poetry.lock");
  const deps = parsePoetryLock(text);

  it("finds requests with the version text as range", () => {
    const requests = deps.find((d) => d.name === "requests")!;
    expect(requests).toMatchObject({ version: "2.25.0", direct: false });
    expect(textAt(text, requests.range)).toBe("2.25.0");
  });

  it("includes transitive packages", () => {
    expect(deps.find((d) => d.name === "urllib3")).toMatchObject({ direct: false });
  });

  it("keeps every version of a repeated name", () => {
    const t = '[[package]]\nname = "a"\nversion = "1"\n\n[[package]]\nname = "a"\nversion = "2"\n';
    expect(parsePoetryLock(t).map((d) => d.version)).toEqual(["1", "2"]);
  });

  it("normalizes names", () => {
    const t = '[[package]]\nname = "Typing_Extensions"\nversion = "4.0.0"\n';
    expect(parsePoetryLock(t)[0]!.name).toBe("typing-extensions");
  });

  it("throws ParseError on truncated input", () => {
    expect(() => parsePoetryLock(text.slice(0, text.indexOf('name = "requests"') + 40))).toThrow(ParseError);
  });

  it("throws ParseError on a package without a version", () => {
    expect(() => parsePoetryLock('[[package]]\nname = "a"\n')).toThrow(ParseError);
  });
});
