import { describe, expect, it } from "vitest";
import { ALL_MODULES, classifyFile, registerModule } from "../../src/ecosystems/index.js";
import type { EcosystemModule } from "../../src/ecosystems/types.js";

function fake(over: Partial<EcosystemModule>): EcosystemModule {
  return {
    id: "fake",
    osvEcosystem: "Fake",
    manifests: [],
    lockfiles: [],
    lockfilesForManifest: () => [],
    manifestForLockfile: () => undefined,
    versioning: {} as EcosystemModule["versioning"],
    normalizeName: (n) => n,
    parseManifest: () => [],
    parseLockfile: () => [],
    rewriteSpec: (_raw, target) => ({ spec: target, widened: false }),
    lockCommand: () => undefined,
    transitiveFix: () => undefined,
    ...over,
  };
}

describe("classifyFile", () => {
  it("classifies by glob, manifest first", () => {
    registerModule(fake({ id: "x", manifests: ["requirements*.txt"], lockfiles: ["x.lock"] }));
    expect(classifyFile("a/b/requirements-dev.txt")?.role).toBe("manifest");
    expect(classifyFile("x.lock")?.role).toBe("lockfile");
    expect(classifyFile("README.md")).toBeUndefined();
  });

  it("prefers the manifest role when both patterns match", () => {
    const m = fake({ id: "both", manifests: ["both.txt"], lockfiles: ["both.txt"] });
    expect(classifyFile("d/both.txt", [m])?.role).toBe("manifest");
  });

  it("replaces a module registered twice under the same id", () => {
    registerModule(fake({ id: "dup" }));
    registerModule(fake({ id: "dup", manifests: ["dup.txt"] }));
    expect(ALL_MODULES.filter((m) => m.id === "dup")).toHaveLength(1);
    expect(classifyFile("dup.txt")?.module.id).toBe("dup");
  });

  it("matches dotfiles", () => {
    const m = fake({ id: "dot", manifests: [".tool/manifest.json"] });
    expect(classifyFile("a/.tool/manifest.json", [m])?.module).toBe(m);
  });
});
