import { describe, expect, it } from "vitest";
import { parseBunLock } from "../../../src/ecosystems/npm/bunLock.js";
import { ParseError } from "../../../src/ecosystems/types.js";
import { read } from "../../helpers/npmFixture.js";
import { textAt } from "../../helpers/textAt.js";

// Children of a node in a binary tree of n nodes, keeping dependency chains realistically shallow.
const kids = (i: number, n: number) => [2 * i + 1, 2 * i + 2].filter((k) => k < n);

describe("parseBunLock", () => {
  it("finds direct and transitive entries with via", () => {
    const text = read("bun.lock");
    const deps = parseBunLock(text);
    const lodash = deps.find((d) => d.name === "lodash")!;
    expect(lodash).toMatchObject({ version: "4.17.15", direct: true });
    expect(deps.find((d) => d.name === "body-parser")).toMatchObject({ direct: false, via: ["express"] });
    expect(textAt(text, lodash.range)).toBe("4.17.15");
  });

  it("keeps nested duplicate versions as separate entries", () => {
    const text = [
      "{",
      '  "lockfileVersion": 1,',
      '  "workspaces": { "": { "dependencies": { "a": "1.0.0", "b": "1.0.0", }, }, },',
      '  "packages": {',
      '    "a": ["a@1.0.0", "", {}, "sha512-x"],',
      '    "b": ["b@1.0.0", "", { "dependencies": { "a": "2.0.0", "@s/c": "1.0.0" } }, "sha512-y"],',
      '    "b/a": ["a@2.0.0", "", {}, "sha512-z"],',
      '    "@s/c": ["@s/c@1.0.0", "", { "dependencies": { "a": "1.0.0" } }, "sha512-w"],',
      "  },",
      "}",
    ].join("\n");
    const deps = parseBunLock(text);
    expect(deps.map((d) => [d.name, d.version, d.direct, d.via])).toEqual([
      ["a", "1.0.0", true, undefined],
      ["b", "1.0.0", true, undefined],
      ["a", "2.0.0", false, ["b"]],
      ["@s/c", "1.0.0", false, ["b"]],
    ]);
    expect(deps[0]!.range).not.toEqual(deps[2]!.range);
    expect(textAt(text, deps[3]!.range)).toBe("1.0.0");
  });

  it("parses a 5,000-entry lockfile in < 250 ms", () => {
    let text = '{\n  "lockfileVersion": 1,\n  "workspaces": { "": { "dependencies": { "p0": "1.0.0", }, }, },\n  "packages": {\n';
    for (let i = 0; i < 5000; i++) {
      const children = kids(i, 5000).map((k) => `"p${k}": "1.0.0"`).join(", ");
      const deps = `{ "dependencies": { ${children} } }`;
      text += `    "p${i}": ["p${i}@1.0.0", "", ${deps}, "sha512-AAAA"],\n\n`;
    }
    text += "  },\n}\n";
    const t0 = performance.now();
    const deps = parseBunLock(text);
    expect(performance.now() - t0).toBeLessThan(250);
    expect(deps).toHaveLength(5000);
  });

  it("throws ParseError on truncated input", () => {
    const text = read("bun.lock");
    expect(() => parseBunLock(text.slice(0, text.length >> 1))).toThrow(ParseError);
  });
});
