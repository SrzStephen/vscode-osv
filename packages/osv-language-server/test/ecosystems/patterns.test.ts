import { describe, expect, it } from "vitest";
import { allFileGlobs, preCommitFilesRegex } from "../../src/ecosystems/index.js";
import { npmModule } from "../../src/ecosystems/npm/index.js";
import { pypiModule } from "../../src/ecosystems/pypi/index.js";

describe("preCommitFilesRegex", () => {
  const re = new RegExp(preCommitFilesRegex([npmModule, pypiModule]));
  it.each(["a/package.json", "package.json", "requirements-dev.txt", "requirements/base.txt", "pylock.dev.toml", "x/uv.lock"])("matches %s", (p) =>
    expect(re.test(p)).toBe(true),
  );
  it.each(["package.json.bak", "notpackage.json", "requirements.txt.orig"])("does not match %s", (p) => expect(re.test(p)).toBe(false));
});

describe("allFileGlobs", () => {
  it("deduplicates manifests, lockfiles and related files", () => {
    const m = { ...npmModule, relatedFiles: ["package.json", "extra.cfg"] };
    const globs = allFileGlobs([m]);
    expect(globs.filter((g) => g === "package.json")).toHaveLength(1);
    expect(globs).toContain("extra.cfg");
    expect(globs).toContain("yarn.lock");
  });
});
