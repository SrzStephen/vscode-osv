import { describe, expect, it } from "vitest";
import { mergeAliases } from "../../src/core/aliases.js";
import type { OsvRecord } from "../../src/core/types.js";

function rec(partial: Partial<OsvRecord>): OsvRecord {
  return { id: "GHSA-aaaa-bbbb-cccc", modified: "2024-01-01T00:00:00Z", ...partial };
}

describe("mergeAliases", () => {
  it("merges GHSA/PYSEC/CVE into one, preferring GHSA", () => {
    const v = mergeAliases([
      rec({ id: "PYSEC-2023-74", aliases: ["CVE-2023-32681", "GHSA-j8r2-6x86-q33q"] }),
      rec({ id: "GHSA-j8r2-6x86-q33q", aliases: ["CVE-2023-32681"] }),
    ]);
    expect(v).toHaveLength(1);
    expect(v[0]!.id).toBe("GHSA-j8r2-6x86-q33q");
    expect(v[0]!.aliases).toEqual(["CVE-2023-32681", "PYSEC-2023-74"]);
  });

  it("prefers ecosystem-native over CVE", () => {
    const v = mergeAliases([rec({ id: "CVE-2023-1", aliases: ["RUSTSEC-2023-0001"] }), rec({ id: "RUSTSEC-2023-0001", aliases: ["CVE-2023-1"] })]);
    expect(v[0]!.id).toBe("RUSTSEC-2023-0001");
  });

  it("keeps unrelated groups apart, sorted by severity then id", () => {
    const v = mergeAliases([
      rec({ id: "GHSA-2", summary: "low one", database_specific: { severity: "LOW" } }),
      rec({ id: "GHSA-3", summary: "crit", database_specific: { severity: "CRITICAL" } }),
      rec({ id: "GHSA-1", summary: "low zero", database_specific: { severity: "LOW" } }),
    ]);
    expect(v.map((x) => x.id)).toEqual(["GHSA-3", "GHSA-1", "GHSA-2"]);
  });

  it("takes summary from preferred record with fallback, max severity and latest modified", () => {
    const v = mergeAliases([
      rec({ id: "PYSEC-1", aliases: ["GHSA-x"], summary: "pysec summary", modified: "2024-05-01T00:00:00Z", database_specific: { severity: "HIGH" } }),
      rec({ id: "GHSA-x", aliases: ["PYSEC-1"], modified: "2024-02-01T00:00:00Z" }),
    ]);
    expect(v[0]!.summary).toBe("pysec summary");
    expect(v[0]!.severity).toBe("high");
    expect(v[0]!.modified).toBe("2024-05-01T00:00:00Z");
  });
});
