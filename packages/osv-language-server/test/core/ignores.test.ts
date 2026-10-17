import { describe, expect, it } from "vitest";
import type { FileSource } from "../../src/core/fileSource.js";
import { findOsvScannerToml, IgnoreMatcher, parseOsvScannerToml } from "../../src/core/ignores.js";
import type { Vuln } from "../../src/core/types.js";

const vuln = (id: string, aliases: string[]): Vuln => ({ id, aliases, summary: "", severity: "high", modified: "2024-01-01T00:00:00Z" });

describe("ignores", () => {
  it("ignores by alias and respects ignoreUntil", () => {
    const m = new IgnoreMatcher(["CVE-1"], parseOsvScannerToml('[[IgnoredVulns]]\nid = "GHSA-x"\nignoreUntil = 2020-01-01\n'), new Date("2026-10-18"));
    expect(m.isIgnored(vuln("GHSA-a", ["CVE-1"]))).toBe(true);
    expect(m.isIgnored(vuln("GHSA-x", []))).toBe(false);
  });

  it("applies toml entries that have not expired or have no expiry", () => {
    const toml = '[[IgnoredVulns]]\nid = "GHSA-y"\nreason = "n/a"\n\n[[IgnoredVulns]]\nid = "GHSA-z"\nignoreUntil = 2030-01-01\n';
    const entries = parseOsvScannerToml(toml);
    expect(entries.map((e) => e.id)).toEqual(["GHSA-y", "GHSA-z"]);
    expect(entries[0]?.reason).toBe("n/a");
    const m = new IgnoreMatcher([], entries, new Date("2026-10-18"));
    expect(m.isIgnored(vuln("GHSA-y", []))).toBe(true);
    expect(m.isIgnored(vuln("GHSA-q", ["GHSA-z"]))).toBe(true);
    expect(m.isIgnored(vuln("GHSA-q", []))).toBe(false);
  });

  it("returns no entries for invalid TOML", () => {
    expect(parseOsvScannerToml("[[IgnoredVulns\nid =")).toEqual([]);
  });

  it("finds the nearest osv-scanner.toml up to the root", async () => {
    const present = new Set(["/root/osv-scanner.toml", "/root/a/osv-scanner.toml"]);
    const files: FileSource = { read: async (p) => (present.has(p) ? "" : undefined) };
    expect(await findOsvScannerToml("/root/a/b/package.json", "/root", files)).toBe("/root/a/osv-scanner.toml");
    expect(await findOsvScannerToml("/root/c/package.json", "/root", files)).toBe("/root/osv-scanner.toml");
    expect(await findOsvScannerToml("/root/c/package.json", "/root", { read: async () => undefined })).toBeUndefined();
    expect(await findOsvScannerToml("/other/x.json", "/root", files)).toBeUndefined();
  });
});
