import { describe, expect, it } from "vitest";
import { parsePnpmLock } from "../../../src/ecosystems/npm/pnpmLock.js";
import { ParseError } from "../../../src/ecosystems/types.js";
import { read } from "../../helpers/npmFixture.js";
import { textAt } from "../../helpers/textAt.js";

describe.each([["pnpm-v9.yaml"], ["pnpm-v6.yaml"]])("parsePnpmLock (%s)", (file) => {
  it("finds direct and transitive entries with via", () => {
    const text = read(file);
    const deps = parsePnpmLock(text);
    const lodash = deps.find((d) => d.name === "lodash")!;
    expect(lodash).toMatchObject({ version: "4.17.15", direct: true });
    expect(deps.find((d) => d.name === "body-parser")).toMatchObject({ direct: false, via: ["express"] });
    expect(textAt(text, lodash.range)).toBe("4.17.15");
  });

  it("takes direct and requestedSpecs from the importer", () => {
    const deps = parsePnpmLock(read(file));
    const express = deps.find((d) => d.name === "express")!;
    expect(express).toMatchObject({ version: "4.17.1", direct: true });
    expect(express.requestedSpecs).toEqual([file === "pnpm-v9.yaml" ? "4.17.1" : "^4.17.1"]);
    if (file === "pnpm-v6.yaml") expect(deps.filter((d) => d.direct).map((d) => d.name)).toContain("@types/node");
  });

  it("throws ParseError on truncated input", () => {
    const text = read(file);
    expect(() => parsePnpmLock(text.slice(0, text.indexOf("packages:") + 40) + "\n  x: [")).toThrow(ParseError);
  });
});

describe("parsePnpmLock", () => {
  it("keeps peer-suffixed snapshots under one version entry with their edges", () => {
    const text = [
      "lockfileVersion: '9.0'",
      "importers:",
      "  .:",
      "    dependencies:",
      "      a:",
      "        specifier: ^1.0.0",
      "        version: 1.0.0(b@2.0.0)",
      "packages:",
      "  a@1.0.0:",
      "    resolution: {integrity: x}",
      "  b@2.0.0:",
      "    resolution: {integrity: y}",
      "snapshots:",
      "  a@1.0.0(b@2.0.0):",
      "    dependencies:",
      "      b: 2.0.0",
      "  b@2.0.0: {}",
      "",
    ].join("\n");
    const deps = parsePnpmLock(text);
    expect(deps.map((d) => [d.name, d.version, d.direct, d.via])).toEqual([
      ["a", "1.0.0", true, undefined],
      ["b", "2.0.0", false, ["a"]],
    ]);
  });

  it("parses a 5,000-entry lockfile in < 250 ms", () => {
    let text = "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      p0:\n        specifier: 1.0.0\n        version: 1.0.0\npackages:\n";
    for (let i = 0; i < 5000; i++) text += `  p${i}@1.0.0:\n    resolution: {integrity: sha512-AAAA}\n    engines: {node: '>= 0.8'}\n\n`;
    const snapshotDeps = (i: number) => {
      const kids = [2 * i + 1, 2 * i + 2].filter((k) => k < 5000);
      return kids.length ? `\n    dependencies:${kids.map((k) => `\n      p${k}: 1.0.0`).join("")}` : " {}";
    };
    text += "snapshots:\n";
    for (let i = 0; i < 5000; i++) {
      text += `  p${i}@1.0.0:${snapshotDeps(i)}\n\n`;
    }
    const t0 = performance.now();
    const deps = parsePnpmLock(text);
    expect(performance.now() - t0).toBeLessThan(250);
    expect(deps).toHaveLength(5000);
  });
});
