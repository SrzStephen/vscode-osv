import type { Finding, Vuln } from "../../src/core/types.js";

/** A one-vuln npm finding with an update plan; override any field per test. */
export function finding(over: Partial<Finding> = {}): Finding {
  return {
    key: "npm:qs@1.0.0",
    uri: "file:///w/package.json",
    range: { start: { line: 2, character: 10 }, end: { line: 2, character: 17 } },
    ecosystem: "npm",
    name: "qs",
    current: "1.0.0",
    checkedLowerBound: false,
    source: "manifest",
    direct: true,
    vulns: [{ id: "GHSA-aaaa-bbbb-cccc", aliases: [], summary: "Prototype pollution", severity: "high", modified: "2026-01-01T00:00:00Z" }],
    severity: "high",
    fix: { target: "2.0.0", crossesMajor: false, fixesAll: true },
    update: {
      edit: [{ uri: "file:///w/package.json", range: { start: { line: 2, character: 10 }, end: { line: 2, character: 17 } }, newText: "^2.0.0" }],
      lockCommand: { cwd: "/w", command: "npm install" },
      kind: "direct",
    },
    cached: false,
    ...over,
  };
}

export function vuln(id: string, severity: Vuln["severity"] = "high"): Vuln {
  return { id, aliases: [], summary: `summary ${id}`, severity, modified: "2026-01-01T00:00:00Z" };
}
