import { describe, expect, it } from "vitest";
import { emptyCounts, isAlarming, isOsvFile, severityOf, severitySummary, statusBarText, totalOf } from "../../src/statusBar.js";

const counts = (c: Partial<ReturnType<typeof emptyCounts>>) => ({ ...emptyCounts(), ...c });

describe("statusBarText", () => {
  it("is hidden for non-matching files", () => {
    expect(statusBarText({ matching: false, counts: counts({ high: 3 }), offline: false })).toBeUndefined();
    expect(statusBarText({ matching: false, counts: counts({}), offline: true })).toBeUndefined();
  });
  it("breaks entries down by severity, most severe first", () => {
    expect(statusBarText({ matching: true, counts: counts({ low: 1, critical: 2, high: 1 }), offline: false })).toBe(
      "$(shield) OSV: 2 critical · 1 high · 1 low",
    );
    expect(statusBarText({ matching: true, counts: counts({ medium: 2 }), offline: false })).toBe("$(shield) OSV: 2 medium");
  });
  it("shows a tick when clean", () => {
    expect(statusBarText({ matching: true, counts: counts({}), offline: false })).toBe("$(shield) OSV: ✓");
  });
  it("shows offline when the last status was offline", () => {
    expect(statusBarText({ matching: true, counts: counts({}), offline: true })).toBe("$(shield) OSV: offline");
    expect(statusBarText({ matching: true, counts: counts({ high: 4 }), offline: true })).toBe("$(shield) OSV: offline");
  });
  it("shows a spinner while scanning, even for a non-matching file", () => {
    expect(statusBarText({ matching: false, counts: counts({}), offline: false, scanning: true })).toBe("$(sync~spin) OSV: scanning");
    expect(statusBarText({ matching: true, counts: counts({ high: 1 }), offline: true, scanning: true })).toBe("$(sync~spin) OSV: scanning");
  });
});

describe("severity helpers", () => {
  it("reads severity from diagnostic data, defaulting to low", () => {
    expect(severityOf({ severity: "critical" })).toBe("critical");
    expect(severityOf({ severity: "unknown" })).toBe("low");
    expect(severityOf(undefined)).toBe("low");
  });
  it("totals and summarises", () => {
    expect(totalOf(counts({ high: 2, low: 1 }))).toBe(3);
    expect(severitySummary(counts({}))).toBe("");
  });
  it("only alarms for critical or high while idle and online", () => {
    expect(isAlarming({ counts: counts({ high: 1 }), offline: false })).toBe(true);
    expect(isAlarming({ counts: counts({ medium: 5 }), offline: false })).toBe(false);
    expect(isAlarming({ counts: counts({ critical: 1 }), offline: true })).toBe(false);
    expect(isAlarming({ counts: counts({ critical: 1 }), offline: false, scanning: true })).toBe(false);
  });
});

describe("isOsvFile", () => {
  it.each([
    "/w/package.json",
    "/w/a/package-lock.json",
    "/w/yarn.lock",
    "/w/pnpm-lock.yaml",
    "/w/bun.lock",
    "/w/requirements.txt",
    "/w/requirements-dev.txt",
    "/w/requirements/base.txt",
    "/w/pyproject.toml",
    "/w/Pipfile",
    "/w/Pipfile.lock",
    "/w/poetry.lock",
    "/w/uv.lock",
    "/w/pdm.lock",
    "/w/pylock.toml",
    "/w/pylock.dev.toml",
    "/w/Cargo.toml",
    "/w/Cargo.lock",
  ])("matches %s", (p) => expect(isOsvFile(p)).toBe(true));

  it.each(["/w/tsconfig.json", "/w/notes.txt", "/w/other/base.txt","/w/package.json.bak"])("rejects %s", (p) =>
    expect(isOsvFile(p)).toBe(false),
  );
});
