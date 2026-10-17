import { describe, expect, it } from "vitest";
import { parseYarnLock } from "../../../src/ecosystems/npm/yarnLock.js";
import { ParseError } from "../../../src/ecosystems/types.js";
import { read } from "../../helpers/npmFixture.js";
import { textAt } from "../../helpers/textAt.js";

// Children of a node in a binary tree of n nodes, keeping dependency chains realistically shallow.
const depBlock = (i: number, n: number, line: (k: number) => string) => {
  const kids = [2 * i + 1, 2 * i + 2].filter((k) => k < n);
  return kids.length ? `  dependencies:\n${kids.map((k) => `    ${line(k)}\n`).join("")}` : "";
};

const v1Chain = (n: number) => {
  let text = "# yarn lockfile v1\n\n";
  for (let i = 0; i < n; i++) {
    text += `p${i}@1.0.0:\n  version "1.0.0"\n  resolved "https://registry.yarnpkg.com/p${i}/-/p${i}-1.0.0.tgz#abc"\n`;
    text += `  integrity sha512-AAAA\n${depBlock(i, n, (k) => `p${k} "1.0.0"`)}\n`;
  }
  return text;
};

const berryChain = (n: number) => {
  let text = '__metadata:\n  version: 8\n  cacheKey: 10c0\n\n"root@workspace:.":\n  version: 0.0.0-use.local\n';
  text += '  resolution: "root@workspace:."\n  dependencies:\n    p0: "npm:1.0.0"\n  languageName: unknown\n  linkType: soft\n\n';
  for (let i = 0; i < n; i++) {
    text += `"p${i}@npm:1.0.0":\n  version: 1.0.0\n  resolution: "p${i}@npm:1.0.0"\n`;
    text += `${depBlock(i, n, (k) => `p${k}: "npm:1.0.0"`)}  checksum: 10c0/abc\n  languageName: node\n  linkType: hard\n\n`;
  }
  return text;
};

describe.each([["yarn-v1.lock"], ["yarn-berry.lock"]])("parseYarnLock (%s)", (file) => {
  it("finds direct and transitive entries with via", () => {
    const text = read(file);
    const deps = parseYarnLock(text);
    const lodash = deps.find((d) => d.name === "lodash")!;
    expect(lodash).toMatchObject({ version: "4.17.15", direct: true, requestedSpecs: ["4.17.15"] });
    expect(deps.find((d) => d.name === "body-parser")).toMatchObject({ direct: false, via: ["express"] });
    expect(textAt(text, lodash.range)).toBe("4.17.15");
    expect(deps.some((d) => d.name === "fx")).toBe(false);
  });

  it("throws ParseError on truncated input", () => {
    const text = read(file);
    const cut = file === "yarn-v1.lock" ? text.indexOf('version "1.3.8') + 12 : text.indexOf('"accepts@npm') + 8;
    expect(() => parseYarnLock(text.slice(0, cut))).toThrow(ParseError);
  });
});

describe("parseYarnLock", () => {
  it("v1: keeps every spec of a merged key as requestedSpecs", () => {
    const text = [
      "# yarn lockfile v1",
      "",
      '"@s/x@^1.0.0", "@s/x@^1.1.0":',
      '  version "1.2.0"',
      "",
      'lodash@^4.17.0, lodash@^4.17.15:',
      '  version "4.17.21"',
      "",
    ].join("\n");
    const deps = parseYarnLock(text);
    expect(deps.map((d) => [d.name, d.version, d.requestedSpecs])).toEqual([
      ["@s/x", "1.2.0", ["^1.0.0", "^1.1.0"]],
      ["lodash", "4.17.21", ["^4.17.0", "^4.17.15"]],
    ]);
  });

  it("berry: strips npm: prefixes and reads direct deps from the workspace entry", () => {
    const text = [
      "__metadata:",
      "  version: 8",
      "",
      '"lodash@npm:^4.17.0, lodash@npm:^4.17.15":',
      "  version: 4.17.21",
      '  resolution: "lodash@npm:4.17.21"',
      "",
      '"a@npm:1.0.0":',
      "  version: 1.0.0",
      "  dependencies:",
      '    lodash: "npm:^4.17.0"',
      "",
      '"root@workspace:.":',
      "  version: 0.0.0-use.local",
      "  dependencies:",
      '    a: "npm:1.0.0"',
      "",
    ].join("\n");
    const deps = parseYarnLock(text);
    expect(deps.map((d) => [d.name, d.direct, d.via, d.requestedSpecs])).toEqual([
      ["lodash", false, ["a"], ["^4.17.0", "^4.17.15"]],
      ["a", true, undefined, ["1.0.0"]],
    ]);
  });

  it.each([
    ["v1", v1Chain],
    ["berry", berryChain],
  ])("%s: parses a 5,000-entry lockfile in < 250 ms", (_, build) => {
    const text = build(5000);
    const t0 = performance.now();
    const deps = parseYarnLock(text);
    expect(performance.now() - t0).toBeLessThan(250);
    expect(deps).toHaveLength(5000);
    expect(deps[4999]!.via).toHaveLength(12);
  });
});
