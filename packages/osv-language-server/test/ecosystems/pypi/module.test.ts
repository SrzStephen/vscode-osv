import { describe, expect, it } from "vitest";
import { ALL_MODULES, classifyFile } from "../../../src/ecosystems/index.js";
import { pypiModule } from "../../../src/ecosystems/pypi/index.js";

const lock = (manifest: string, lockfile?: string) =>
  pypiModule.lockCommand({
    manifestPath: `/p/${manifest}`,
    lockfilePath: lockfile && `/p/${lockfile}`,
    name: "x",
    target: "1.0.0",
  });

describe("pypiModule", () => {
  it("lock commands by lockfile", () =>
    expect([
      lock("pyproject.toml", "uv.lock"),
      lock("pyproject.toml", "poetry.lock"),
      lock("Pipfile", "Pipfile.lock"),
      lock("pyproject.toml", "pdm.lock"),
      lock("requirements-dev.txt"),
      lock("pyproject.toml"),
      lock("Pipfile"),
    ]).toEqual([
      "uv lock",
      "poetry lock",
      "pipenv lock",
      "pdm lock",
      "pip install -r requirements-dev.txt",
      undefined,
      undefined,
    ]));

  it("transitive fixes", () => {
    const ctx = (l: string) => ({ name: "urllib3", current: "1.0.0", target: "2.0.7", lockfilePath: `/p/${l}` });
    expect(pypiModule.transitiveFix(ctx("poetry.lock"))).toEqual({
      kind: "command-only",
      edit: [],
      lockCommand: { cwd: "/p", command: "poetry update urllib3" },
    });
    expect(pypiModule.transitiveFix(ctx("uv.lock"))).toEqual({
      kind: "command-only",
      edit: [],
      lockCommand: { cwd: "/p", command: "uv lock --upgrade-package urllib3" },
    });
    expect(pypiModule.transitiveFix(ctx("Pipfile.lock"))).toBeUndefined();
    expect(pypiModule.transitiveFix(ctx("pdm.lock"))).toBeUndefined();
  });

  it("builds no lock command from a package name with shell metacharacters", () => {
    const ctx = (name: string, l: string) => ({ name, current: "1.0.0", target: "2.0.7", lockfilePath: `/p/${l}` });
    expect(pypiModule.transitiveFix(ctx("urllib3$(touch pwned)", "poetry.lock"))).toBeUndefined();
    expect(pypiModule.transitiveFix(ctx("urllib3;rm -rf ~", "uv.lock"))).toBeUndefined();
    expect(pypiModule.transitiveFix(ctx("zope.interface", "uv.lock"))?.lockCommand).toEqual({
      cwd: "/p",
      command: "uv lock --upgrade-package zope.interface",
    });
  });

  it("builds no pip command from a manifest filename with shell metacharacters", () => {
    expect(lock("requirements$(touch pwned).txt")).toBeUndefined();
    expect(lock("requirements dev.txt")).toBeUndefined();
    expect(lock("requirements_dev-1.txt")).toBe("pip install -r requirements_dev-1.txt");
  });

  it("rewriteSpec dispatches Poetry vs PEP 440 styles", () => {
    expect(pypiModule.rewriteSpec("^1.0", "2.1.0").spec).toBe("^2.1.0");
    expect(pypiModule.rewriteSpec("~1.0", "2.1.0").spec).toBe("~2.1.0");
    expect(pypiModule.rewriteSpec("1.0", "2.1.0").spec).toBe("2.1.0");
    expect(pypiModule.rewriteSpec(">=2.0", "2.1.0").spec).toBe(">=2.1.0");
    expect(pypiModule.rewriteSpec("~=1.4", "1.9.0").spec).toBe("~=1.9.0");
  });

  it("maps manifests and lockfiles", () => {
    expect(pypiModule.lockfilesForManifest("pyproject.toml")).toEqual(["uv.lock", "poetry.lock", "pdm.lock", "pylock.toml"]);
    expect(pypiModule.lockfilesForManifest("Pipfile")).toEqual(["Pipfile.lock"]);
    expect(pypiModule.lockfilesForManifest("requirements.txt")).toEqual([]);
    expect(pypiModule.manifestForLockfile("Pipfile.lock")).toBe("Pipfile");
    expect(pypiModule.manifestForLockfile("uv.lock")).toBe("pyproject.toml");
    expect(pypiModule.manifestForLockfile("pylock.dev.toml")).toBe("pyproject.toml");
  });

  it("dispatches parsing by basename", () => {
    expect(pypiModule.parseManifest("requests==2.0.0\n", "requirements.txt")[0]?.name).toBe("requests");
    expect(() => pypiModule.parseLockfile("", "weird.lock")).toThrow();
  });

  it("registered once", () => {
    expect(classifyFile("svc/requirements-dev.txt")?.module.id).toBe("pypi");
    expect(classifyFile("svc/pylock.dev.toml")).toMatchObject({ role: "lockfile" });
    expect(ALL_MODULES.filter((m) => m.id === "pypi")).toHaveLength(1);
  });
});
