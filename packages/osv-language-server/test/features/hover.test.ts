import { describe, expect, it } from "vitest";
import { hoverAt, renderHover } from "../../src/features/hover.js";
import { finding, vuln } from "../helpers/finding.js";

describe("renderHover", () => {
  it("renders header, vuln rows, suggestion and links", () => {
    const md = renderHover(finding());
    const args = encodeURIComponent(JSON.stringify([{ uri: "file:///w/package.json", findingKey: "npm:qs@1.0.0" }]));
    const ignoreArgs = encodeURIComponent(JSON.stringify([{ id: "GHSA-aaaa-bbbb-cccc" }]));
    expect(md).toContain("**qs 1.0.0** — 1 known vulnerability");
    expect(md).toContain("- 🟠 [GHSA-aaaa-bbbb-cccc](https://osv.dev/vulnerability/GHSA-aaaa-bbbb-cccc) High — Prototype pollution");
    expect(md).toContain("Suggested: **2.0.0** (fixes all 1)");
    expect(md).toContain(`[Update to 2.0.0](command:osv.update?${args})`);
    expect(md).toContain("[View on osv.dev](https://osv.dev/vulnerability/GHSA-aaaa-bbbb-cccc)");
    expect(md).toContain(`[Ignore GHSA-aaaa-bbbb-cccc](command:osv.ignore?${ignoreArgs})`);
  });

  it("uses plural header and per-severity icons; fixes all n counts vulns", () => {
    const vulns = [vuln("A-1", "critical"), vuln("B-2", "high"), vuln("C-3", "medium"), vuln("D-4", "low"), vuln("E-5", "unknown")];
    const md = renderHover(finding({ vulns }));
    expect(md).toContain("— 5 known vulnerabilities");
    expect(md).toContain("- 🔴 [A-1](https://osv.dev/vulnerability/A-1) Critical — summary A\\-1");
    expect(md).toContain("- 🟠 [B-2](https://osv.dev/vulnerability/B-2) High — summary B\\-2");
    expect(md).toContain("- 🟡 [C-3](https://osv.dev/vulnerability/C-3) Medium — summary C\\-3");
    expect(md).toContain("- 🔵 [D-4](https://osv.dev/vulnerability/D-4) Low — summary D\\-4");
    expect(md).toContain("- ⚪ [E-5](https://osv.dev/vulnerability/E-5) Unknown — summary E\\-5");
    expect(md).toContain("(fixes all 5)");
  });

  it("escapes summaries and encodes command args", () => {
    const md = renderHover(finding({ vulns: [{ ...vuln("GHSA-aaaa-bbbb-cccc"), summary: "a *b* [c](javascript:x)" }] }));
    expect(md).toContain("a \\*b\\* \\[c\\]\\(javascript:x\\)");
    expect(md).toMatch(/command:osv\.update\?%5B%7B/);
  });

  it("no update link without a plan", () => {
    const md = renderHover(finding({ update: undefined, fix: { target: undefined, crossesMajor: false, fixesAll: false } }));
    expect(md).not.toContain("command:osv.update");
    expect(md).toContain("⚠ No fixed version available");
    expect(md).not.toContain("Suggested:");
    expect(md).toContain("[View on osv.dev]");
    expect(md).toContain("command:osv.ignore");
  });

  it("titles override plans Override", () => {
    const md = renderHover(finding({ direct: false, update: { ...finding().update!, kind: "override" } }));
    expect(md).toContain("[Override to 2.0.0](command:osv.update?");
  });

  it("emits warning and info lines", () => {
    const md = renderHover(
      finding({ checkedLowerBound: true, cached: true, fix: { target: "2.0.0", crossesMajor: true, fixesAll: true }, update: { ...finding().update!, widened: true } }),
    );
    expect(md).toContain("⚠ Major version upgrade");
    expect(md).toContain("⚠ Upper bound widened");
    expect(md).toContain("ℹ Checked lower bound — no lockfile found");
    expect(md).toContain("ℹ Cached result (osv.dev unreachable)");
  });

  it("omits warning lines when not applicable", () => {
    const md = renderHover(finding());
    expect(md).not.toMatch(/Major version|Upper bound|Checked lower|Cached result/);
  });
});

describe("hoverAt", () => {
  const f = finding();
  it("returns markdown hover for the first finding containing the position", () => {
    const other = finding({ name: "other", range: { start: { line: 5, character: 0 }, end: { line: 5, character: 4 } } });
    const h = hoverAt([other, f], { line: 2, character: 12 });
    expect(h?.range).toEqual(f.range);
    expect(h?.contents).toEqual({ kind: "markdown", value: renderHover(f) });
  });

  it("returns undefined outside every range", () => {
    expect(hoverAt([f], { line: 2, character: 17 })).toBeUndefined();
    expect(hoverAt([f], { line: 3, character: 12 })).toBeUndefined();
    expect(hoverAt([], { line: 2, character: 12 })).toBeUndefined();
  });
});
