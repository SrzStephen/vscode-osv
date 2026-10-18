import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, isEcosystemEnabled, normalizeSettings } from "../../src/core/settings.js";

describe("settings", () => {
  it("defaults and clamps", () => {
    expect(normalizeSettings({ cacheTtlHours: 0 }).cacheTtlHours).toBe(1);
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.cacheTtlHours).toBe(48);
  });

  it("falls back to defaults for wrong types and ignores unknown keys", () => {
    const s = normalizeSettings({ enable: "yes", minimumSeverity: "bogus", ignoredVulnerabilities: [1, "CVE-1"], offerLockCommand: "never", extra: 1 });
    expect(s.enable).toBe(true);
    expect(s.minimumSeverity).toBe("low");
    expect(s.ignoredVulnerabilities).toEqual(["CVE-1"]);
    expect(s.offerLockCommand).toBe("never");
    expect(s).not.toHaveProperty("extra");
  });

  it("strips trailing slashes from apiBaseUrl", () => {
    expect(normalizeSettings({ apiBaseUrl: "https://mirror.example/" }).apiBaseUrl).toBe("https://mirror.example");
  });

  it("trims caCertificatePath and defaults it to empty", () => {
    expect(normalizeSettings({ caCertificatePath: "  /etc/ssl/corp-ca.pem " }).caCertificatePath).toBe("/etc/ssl/corp-ca.pem");
    expect(normalizeSettings({ caCertificatePath: 3 }).caCertificatePath).toBe("");
    expect(DEFAULT_SETTINGS.caCertificatePath).toBe("");
  });

  it("treats a missing ecosystem key as enabled", () => {
    const s = normalizeSettings({ ecosystems: { npm: false } });
    expect(isEcosystemEnabled(s, "npm")).toBe(false);
    expect(isEcosystemEnabled(s, "pypi")).toBe(true);
  });
});
