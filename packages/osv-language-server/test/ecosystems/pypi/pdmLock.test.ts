import { describe, expect, it } from "vitest";
import { parsePdmLock } from "../../../src/ecosystems/pypi/pdmLock.js";
import { ParseError } from "../../../src/ecosystems/types.js";
import { read } from "../../helpers/pypiFixture.js";
import { textAt } from "../../helpers/textAt.js";

describe("parsePdmLock", () => {
  const text = read("pdm.lock");
  const deps = parsePdmLock(text);

  it("finds requests with the version text as range", () => {
    const requests = deps.find((d) => d.name === "requests")!;
    expect(requests).toMatchObject({ version: "2.25.0", direct: false });
    expect(textAt(text, requests.range)).toBe("2.25.0");
  });

  it("includes transitive packages", () => {
    expect(deps.find((d) => d.name === "urllib3")).toMatchObject({ direct: false });
  });

  it("throws ParseError on truncated input", () => {
    expect(() => parsePdmLock(text.slice(0, text.indexOf('name = "requests"') + 40))).toThrow(ParseError);
  });

  it("throws ParseError on a package without a version", () => {
    expect(() => parsePdmLock('[[package]]\nname = "a"\n')).toThrow(ParseError);
  });
});
