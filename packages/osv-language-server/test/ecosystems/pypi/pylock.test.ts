import { describe, expect, it } from "vitest";
import { parsePylock } from "../../../src/ecosystems/pypi/pylock.js";
import { ParseError } from "../../../src/ecosystems/types.js";
import { read } from "../../helpers/pypiFixture.js";
import { textAt } from "../../helpers/textAt.js";

describe("parsePylock", () => {
  it("parses a uv export, where every package is direct as no edges are recorded", () => {
    const text = read("pylock.toml");
    const deps = parsePylock(text);
    const requests = deps.find((d) => d.name === "requests")!;
    expect(requests).toMatchObject({ version: "2.25.0", direct: true });
    expect(textAt(text, requests.range)).toBe("2.25.0");
    expect(deps.find((d) => d.name === "urllib3")).toBeDefined();
  });

  it("takes direct deps from the editable package and derives via", () => {
    const text = read("pylock-edges.toml");
    const deps = parsePylock(text);
    expect(deps.map((d) => [d.name, d.version, d.direct, d.via])).toEqual([
      ["requests", "2.25.0", true, undefined],
      ["urllib3", "1.26.20", false, ["requests"]],
      ["idna", "2.10", false, ["requests"]],
    ]);
    expect(textAt(text, deps[0]!.range)).toBe("2.25.0");
  });

  it("throws ParseError on truncated input", () => {
    const text = read("pylock.toml");
    expect(() => parsePylock(text.slice(0, text.indexOf('name = "requests"') + 40))).toThrow(ParseError);
  });

  it("skips packages without a version, such as VCS sources", () => {
    const t = '[[packages]]\nname = "a"\nvcs = { type = "git", url = "https://x/a.git" }\n\n[[packages]]\nname = "b"\nversion = "1"\n';
    expect(parsePylock(t).map((d) => d.name)).toEqual(["b"]);
  });
});
