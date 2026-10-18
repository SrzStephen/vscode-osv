import { describe, expect, it } from "vitest";
import { isOsvFile, statusBarText } from "../../src/statusBar.js";

describe("statusBarText", () => {
  it("is hidden for non-matching files", () => {
    expect(statusBarText({ matching: false, vulnerable: 3, offline: false })).toBeUndefined();
    expect(statusBarText({ matching: false, vulnerable: 0, offline: true })).toBeUndefined();
  });
  it("counts vulnerable entries", () => {
    expect(statusBarText({ matching: true, vulnerable: 2, offline: false })).toBe("$(shield) OSV: 2 vulnerable");
  });
  it("shows a tick when clean", () => {
    expect(statusBarText({ matching: true, vulnerable: 0, offline: false })).toBe("$(shield) OSV: ✓");
  });
  it("shows offline when the last status was offline", () => {
    expect(statusBarText({ matching: true, vulnerable: 0, offline: true })).toBe("$(shield) OSV: offline");
    expect(statusBarText({ matching: true, vulnerable: 4, offline: true })).toBe("$(shield) OSV: offline");
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
