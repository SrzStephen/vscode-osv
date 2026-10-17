import { describe, expect, it } from "vitest";
import { parsePackageLock } from "../../../src/ecosystems/npm/packageLock.js";
import { ParseError } from "../../../src/ecosystems/types.js";
import { read } from "../../helpers/npmFixture.js";
import { textAt } from "../../helpers/textAt.js";

// Children of a node in a binary tree of n nodes, keeping dependency chains realistically shallow.
const kids = (i: number, n: number) => [2 * i + 1, 2 * i + 2].filter((k) => k < n);

describe("parsePackageLock", () => {
  it("finds direct and transitive entries with via", () => {
    const text = read("package-lock.json");
    const deps = parsePackageLock(text);
    expect(deps.find((d) => d.name === "lodash")).toMatchObject({ version: "4.17.15", direct: true });
    expect(deps.find((d) => d.name === "body-parser")).toMatchObject({ direct: false, via: ["express"] });
    expect(textAt(text, deps.find((d) => d.name === "lodash")!.range)).toBe("4.17.15");
  });

  it("keeps nested duplicate versions as separate entries", () => {
    const text = JSON.stringify(
      {
        lockfileVersion: 3,
        packages: {
          "": { dependencies: { a: "1.0.0", b: "1.0.0" } },
          "node_modules/a": { version: "1.0.0" },
          "node_modules/b": { version: "1.0.0", dependencies: { a: "2.0.0", "@s/c": "1.0.0" } },
          "node_modules/b/node_modules/a": { version: "2.0.0" },
          "node_modules/@s/c": { version: "1.0.0", dependencies: { a: "1.0.0" } },
          "node_modules/ws": { link: true, resolved: "packages/ws" },
          "packages/ws": { version: "0.0.1" },
        },
      },
      null,
      2,
    );
    const deps = parsePackageLock(text);
    expect(deps.map((d) => [d.name, d.version, d.direct, d.via])).toEqual([
      ["a", "1.0.0", true, undefined],
      ["b", "1.0.0", true, undefined],
      ["a", "2.0.0", false, ["b"]],
      ["@s/c", "1.0.0", false, ["b"]],
    ]);
    const [a1, , a2] = deps;
    expect(a1!.range).not.toEqual(a2!.range);
    expect(textAt(text, a2!.range)).toBe("2.0.0");
  });

  it("reads the lockfileVersion 1 dependency tree", () => {
    const text = JSON.stringify(
      {
        lockfileVersion: 1,
        dependencies: {
          a: { version: "1.0.0", requires: { b: "^2.0.0" } },
          b: { version: "2.0.0" },
          c: { version: "1.0.0", requires: { b: "^1.0.0" }, dependencies: { b: { version: "1.0.0" } } },
        },
      },
      null,
      2,
    );
    const deps = parsePackageLock(text);
    expect(deps.map((d) => [d.name, d.version, d.direct, d.via])).toEqual([
      ["a", "1.0.0", true, undefined],
      ["b", "2.0.0", false, ["a"]],
      ["c", "1.0.0", true, undefined],
      ["b", "1.0.0", false, ["c"]],
    ]);
    expect(textAt(text, deps[3]!.range)).toBe("1.0.0");
  });

  it("parses a 5,000-entry lockfile in < 250 ms", () => {
    const packages: Record<string, unknown> = { "": { dependencies: { p0: "1.0.0" } } };
    for (let i = 0; i < 5000; i++) {
      packages[`node_modules/p${i}`] = {
        version: "1.0.0",
        resolved: `https://registry.npmjs.org/p${i}/-/p${i}-1.0.0.tgz`,
        dependencies: Object.fromEntries(kids(i, 5000).map((k) => [`p${k}`, "1.0.0"])),
      };
    }
    const text = JSON.stringify({ lockfileVersion: 3, packages }, null, 2);
    const t0 = performance.now();
    const deps = parsePackageLock(text);
    expect(performance.now() - t0).toBeLessThan(250);
    expect(deps).toHaveLength(5000);
  });

  it("throws ParseError on truncated input", () => {
    const text = read("package-lock.json");
    expect(() => parsePackageLock(text.slice(0, text.length >> 1))).toThrow(ParseError);
    expect(() => parsePackageLock("[]")).toThrow(ParseError);
  });
});
