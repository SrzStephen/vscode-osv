import { DiagnosticSeverity } from "vscode-languageserver";
import { describe, expect, it } from "vitest";
import { toDiagnostic } from "../../src/features/diagnostics.js";
import { finding, vuln } from "../helpers/finding.js";

describe("toDiagnostic", () => {
  it("diagnostic message for a transitive major upgrade", () =>
    expect(toDiagnostic(finding({ via: ["express", "body-parser"], direct: false, fix: { target: "2.0.0", crossesMajor: true, fixesAll: true } })).message).toBe(
      "qs 1.0.0 has 1 known vulnerability (GHSA-aaaa-bbbb-cccc); upgrade to 2.0.0 (fixes all) (transitive, via express → body-parser) (major version upgrade)",
    ));

  it("severity mapping and source", () => {
    const d = toDiagnostic(finding({ severity: "medium" }));
    expect(d.severity).toBe(DiagnosticSeverity.Warning);
    expect(d.source).toBe("osv");
    expect(d.codeDescription?.href).toBe("https://osv.dev/vulnerability/GHSA-aaaa-bbbb-cccc");
    expect(d.code).toBe("GHSA-aaaa-bbbb-cccc");
    expect(d.range).toEqual(finding().range);
  });

  it("maps critical/high to Error and low/unknown to Information", () => {
    expect(toDiagnostic(finding({ severity: "critical" })).severity).toBe(DiagnosticSeverity.Error);
    expect(toDiagnostic(finding({ severity: "high" })).severity).toBe(DiagnosticSeverity.Error);
    expect(toDiagnostic(finding({ severity: "low" })).severity).toBe(DiagnosticSeverity.Information);
    expect(toDiagnostic(finding({ severity: "unknown" })).severity).toBe(DiagnosticSeverity.Information);
  });

  it("truncates ids to 3 + more", () => {
    const vulns = ["A-1", "B-2", "C-3", "D-4", "E-5"].map((id) => vuln(id));
    expect(toDiagnostic(finding({ vulns })).message).toBe("qs 1.0.0 has 5 known vulnerabilities (A-1, B-2, C-3, +2 more); upgrade to 2.0.0 (fixes all)");
  });

  it("states when no fix is available", () => {
    const d = toDiagnostic(finding({ fix: { target: undefined, crossesMajor: false, fixesAll: false }, update: undefined }));
    expect(d.message).toBe("qs 1.0.0 has 1 known vulnerability (GHSA-aaaa-bbbb-cccc); no fixed version available");
  });

  it("appends suffixes in order, with bare transitive when no path is known", () => {
    const d = toDiagnostic(finding({ direct: false, checkedLowerBound: true, cached: true, fix: { target: "2.0.0", crossesMajor: true, fixesAll: true } }));
    expect(d.message).toBe(
      "qs 1.0.0 has 1 known vulnerability (GHSA-aaaa-bbbb-cccc); upgrade to 2.0.0 (fixes all) (transitive) (major version upgrade) (checked lower bound — no lockfile found) (cached)",
    );
  });

  it("carries structured data", () => {
    expect(toDiagnostic(finding()).data).toEqual({
      key: "npm:qs@1.0.0",
      ecosystem: "npm",
      name: "qs",
      current: "1.0.0",
      target: "2.0.0",
      vulnIds: ["GHSA-aaaa-bbbb-cccc"],
      direct: true,
      lockCommand: { cwd: "/w", command: "npm install" },
    });
  });
});
