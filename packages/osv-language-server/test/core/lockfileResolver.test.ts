import { describe, expect, it } from "vitest";
import { overlayFileSource, type FileSource } from "../../src/core/fileSource.js";
import { findLockfile, findManifestForLockfile, resolveVersion } from "../../src/core/lockfileResolver.js";
import type { DeclaredDep, ResolvedDep } from "../../src/core/types.js";
import { npmModule } from "../../src/ecosystems/npm/index.js";

const memFiles = (m: Record<string, string>): FileSource => ({ read: async (p) => m[p] });
const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
const dep = (over: Partial<DeclaredDep> = {}): DeclaredDep => ({ name: "lodash", rawSpec: "^4.17.0", lowerBound: "4.17.0", nameRange: range, kind: "registry", ...over });
const locked = (version: string, over: Partial<ResolvedDep> = {}): ResolvedDep => ({ name: "lodash", version, range, direct: false, ...over });

describe("lockfileResolver", () => {
  it("walks up to the root but not beyond", async () => {
    const files = memFiles({ "/ws/package-lock.json": "{}", "/package-lock.json": "{}" });
    expect((await findLockfile("/ws/pkgs/a/package.json", npmModule, "/ws", files))?.path).toBe("/ws/package-lock.json");
    expect(await findLockfile("/ws2/package.json", npmModule, "/ws2", files)).toBeUndefined();
  });

  it("finds the manifest beside a lockfile only", async () => {
    const files = memFiles({ "/ws/package.json": "{}", "/package.json": "{}" });
    expect((await findManifestForLockfile("/ws/package-lock.json", npmModule, files))?.path).toBe("/ws/package.json");
    expect(await findManifestForLockfile("/ws/sub/package-lock.json", npmModule, files)).toBeUndefined();
  });

  it("prefers direct, then requestedSpecs, then single entry, then lower bound", () => {
    const d = dep();
    expect(resolveVersion(d, [locked("4.17.1"), locked("4.17.21", { direct: true })], npmModule)).toEqual({ version: "4.17.21", fromLockfile: true });
    expect(resolveVersion(d, [locked("3.0.0", { requestedSpecs: ["^3.0.0"] }), locked("4.17.5", { requestedSpecs: ["^4.17.0"] })], npmModule)).toEqual({ version: "4.17.5", fromLockfile: true });
    expect(resolveVersion(d, [locked("4.17.9")], npmModule)).toEqual({ version: "4.17.9", fromLockfile: true });
    expect(resolveVersion(d, [locked("3.0.0"), locked("4.0.0")], npmModule)).toEqual({ version: "4.17.0", fromLockfile: false });
    expect(resolveVersion(d, undefined, npmModule)).toEqual({ version: "4.17.0", fromLockfile: false });
    expect(resolveVersion(dep({ kind: "git" }), [locked("1.0.0")], npmModule)).toBeUndefined();
  });

  it("open document text overrides disk", async () => {
    const base = memFiles({ "/a": "disk", "/b": "disk-b" });
    const files = overlayFileSource((p) => (p === "/a" ? "open" : undefined), base);
    expect(await files.read("/a")).toBe("open");
    expect(await files.read("/b")).toBe("disk-b");
  });
});
