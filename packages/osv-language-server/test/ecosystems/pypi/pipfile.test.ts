import { describe, expect, it } from "vitest";
import { ParseError } from "../../../src/ecosystems/types.js";
import { parsePipfile } from "../../../src/ecosystems/pypi/pipfile.js";
import { textAt } from "../../helpers/textAt.js";

describe("parsePipfile", () => {
  it("Pipfile", () => expect(parsePipfile('[packages]\nrequests = "==2.25.0"\nflask = "*"\n[dev-packages]\npytest = {version = ">=6.0"}\n').map((d) => [d.name, d.group, d.lowerBound])).toEqual([["requests", "packages", "2.25.0"], ["flask", "packages", undefined], ["pytest", "dev-packages", "6.0"]]));
  it("marks '*' unresolved and git/path tables by kind", () => {
    const deps = parsePipfile('[packages]\na = "*"\nb = {git = "https://x/b.git"}\nc = {path = "."}\n');
    expect(deps.map((d) => [d.name, d.kind])).toEqual([["a", "unresolved"], ["b", "git"], ["c", "path"]]);
  });
  it("ranges cover the key and the spec string content", () => {
    const t = '[packages]\nRequests = "==2.25.0"\n';
    const [d] = parsePipfile(t);
    expect(d!.name).toBe("requests");
    expect(textAt(t, d!.nameRange)).toBe("Requests");
    expect(textAt(t, d!.specRange!)).toBe("==2.25.0");
  });
  it("throws ParseError on invalid TOML", () => expect(() => parsePipfile("[packages\n")).toThrow(ParseError));
});
