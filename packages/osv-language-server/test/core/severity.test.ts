import { describe, expect, it } from "vitest";
import { maxSeverity, severityOf, severityRank } from "../../src/core/severity.js";
import type { OsvRecord } from "../../src/core/types.js";

function rec(partial: Partial<OsvRecord>): OsvRecord {
  return { id: "GHSA-aaaa-bbbb-cccc", modified: "2024-01-01T00:00:00Z", ...partial };
}

describe("severityOf", () => {
  it("scores CVSS v3.1", () =>
    expect(severityOf(rec({ severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }] }))).toBe("critical"));
  it("scores CVSS v3.0", () =>
    expect(severityOf(rec({ severity: [{ type: "CVSS_V3", score: "CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }] }))).toBe("critical"));
  // computed overall score: 6.9 (medium band)
  it("scores CVSS v4", () =>
    expect(severityOf(rec({ severity: [{ type: "CVSS_V4", score: "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N" }] }))).toBe("medium"));
  it("takes the max over entries", () =>
    expect(
      severityOf(
        rec({
          severity: [
            { type: "CVSS_V4", score: "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N" },
            { type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" },
          ],
        }),
      ),
    ).toBe("critical"));
  it("ignores unparseable vectors and falls back", () =>
    expect(severityOf(rec({ severity: [{ type: "CVSS_V3", score: "garbage" }], database_specific: { severity: "HIGH" } }))).toBe("high"));
  it("falls back to database_specific", () => expect(severityOf(rec({ database_specific: { severity: "MODERATE" } }))).toBe("medium"));
  it("unknown otherwise", () => expect(severityOf(rec({}))).toBe("unknown"));
});

describe("severityRank / maxSeverity", () => {
  it("ranks critical highest and unknown lowest", () => {
    expect(severityRank("critical")).toBe(4);
    expect(severityRank("unknown")).toBe(0);
  });
  it("picks the max, unknown for empty", () => {
    expect(maxSeverity(["low", "high", "medium"])).toBe("high");
    expect(maxSeverity([])).toBe("unknown");
  });
});
