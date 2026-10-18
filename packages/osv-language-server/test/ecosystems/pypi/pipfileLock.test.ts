import { describe, expect, it } from "vitest";
import { parsePipfileLock } from "../../../src/ecosystems/pypi/pipfileLock.js";
import { ParseError } from "../../../src/ecosystems/types.js";
import { read } from "../../helpers/pypiFixture.js";
import { textAt } from "../../helpers/textAt.js";

describe("parsePipfileLock", () => {
  const text = read("Pipfile.lock");
  const deps = parsePipfileLock(text);

  it("finds requests with the text after == as range", () => {
    const requests = deps.find((d) => d.name === "requests")!;
    expect(requests).toMatchObject({ version: "2.25.0", direct: false });
    expect(textAt(text, requests.range)).toBe("2.25.0");
  });

  it("includes transitive packages", () => {
    expect(deps.find((d) => d.name === "urllib3")).toBeDefined();
  });

  it("reads develop and skips entries without a pinned version", () => {
    const t = '{"default": {"A_b": {"version": "==1.0"}, "vcs": {"git": "https://x/y.git"}}, "develop": {"pytest": {"version": "==8.0.0"}}}';
    expect(parsePipfileLock(t).map((d) => [d.name, d.version])).toEqual([["a-b", "1.0"], ["pytest", "8.0.0"]]);
  });

  it("throws ParseError on truncated input", () => {
    expect(() => parsePipfileLock(text.slice(0, text.indexOf('"requests"') + 40))).toThrow(ParseError);
  });

  it("throws ParseError when neither section exists", () => {
    expect(() => parsePipfileLock("{}")).toThrow(ParseError);
  });
});
