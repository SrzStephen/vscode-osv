import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DiskCache, isFresh, type PackageEntry } from "../../src/core/cache.js";
import { defaultCacheDir } from "../../src/core/cacheDir.js";
import type { OsvRecord, PackageQuery } from "../../src/core/types.js";

const tmp = () => mkdtempSync(join(tmpdir(), "osv-cache-"));
const q: PackageQuery = { ecosystem: "npm", name: "lodash", version: "4.17.0" };
const entry = (fetchedAt: string): PackageEntry => ({ fetchedAt, vulnIds: [{ id: "GHSA-a", modified: "2024-01-01T00:00:00Z" }] });
const pkgPath = (dir: string, p: PackageQuery) => join(dir, "pkg", `${createHash("sha256").update(`${p.ecosystem}|${p.name}|${p.version}`).digest("hex")}.json`);

describe("defaultCacheDir", () => {
  it("linux cache dir honours XDG", () => expect(defaultCacheDir("linux", { XDG_CACHE_HOME: "/c" }, "/h")).toBe("/c/osv-language-server"));
  it("linux falls back to ~/.cache", () => expect(defaultCacheDir("linux", {}, "/h")).toBe("/h/.cache/osv-language-server"));
  it("macOS uses Library/Caches", () => expect(defaultCacheDir("darwin", {}, "/h")).toBe("/h/Library/Caches/osv-language-server"));
  it("windows uses LOCALAPPDATA", () => expect(defaultCacheDir("win32", { LOCALAPPDATA: "C:\\L" }, "C:\\h")).toMatch(/osv-language-server.Cache$/));
  it("OSV_CACHE_DIR overrides", () => expect(defaultCacheDir("linux", { OSV_CACHE_DIR: "/x", XDG_CACHE_HOME: "/c" }, "/h")).toBe("/x"));
});

describe("DiskCache", () => {
  it("round-trips and expires", async () => {
    const c = new DiskCache(tmp());
    await c.putPackage(q, entry("2026-10-16T00:00:00Z"));
    expect(isFresh((await c.getPackage(q))!, 48, new Date("2026-10-17T23:00:00Z"))).toBe(true);
    expect(isFresh((await c.getPackage(q))!, 48, new Date("2026-10-18T01:00:00Z"))).toBe(false);
  });

  it("round-trips vuln records across instances", async () => {
    const dir = tmp();
    const r: OsvRecord = { id: "GHSA-a", modified: "2024-01-01T00:00:00Z", summary: "s" };
    await new DiskCache(dir).putVuln(r);
    expect(await new DiskCache(dir).getVuln("GHSA-a")).toEqual(r);
    expect(await new DiskCache(dir).getVuln("GHSA-none")).toBeUndefined();
  });

  it("treats corrupt files as a miss", async () => {
    const dir = tmp();
    mkdirSync(join(dir, "pkg"), { recursive: true });
    writeFileSync(pkgPath(dir, q), "{not json");
    expect(await new DiskCache(dir).getPackage(q)).toBeUndefined();
  });

  it("housekeep removes entries older than 7x TTL", async () => {
    const dir = tmp();
    const c = new DiskCache(dir);
    const recent = { ...q, version: "4.17.1" };
    await c.putPackage(q, entry("2026-10-03T00:00:00Z"));
    await c.putPackage(recent, entry("2026-10-17T00:00:00Z"));
    expect(await c.housekeep(48, new Date("2026-10-18T00:00:00Z"))).toBe(1);
    expect(await new DiskCache(dir).getPackage(q)).toBeUndefined();
    expect(await new DiskCache(dir).getPackage(recent)).toBeDefined();
  });

  it("clear empties the cache", async () => {
    const dir = tmp();
    const c = new DiskCache(dir);
    await c.putPackage(q, entry("2026-10-16T00:00:00Z"));
    await c.clear();
    expect(await c.getPackage(q)).toBeUndefined();
    expect(await new DiskCache(dir).getPackage(q)).toBeUndefined();
  });

  it("survives concurrent writers", async () => {
    const dir = tmp();
    const script = join(__dirname, "cacheWriter.ts");
    const run = (tag: string) =>
      new Promise<number | null>((resolve, reject) => {
        const p = spawn(process.execPath, ["--import", "tsx", script, dir, tag], { stdio: "inherit" });
        p.on("error", reject);
        p.on("exit", resolve);
      });
    expect(await Promise.all([run("a"), run("b")])).toEqual([0, 0]);
    const files = readdirSync(join(dir, "pkg"));
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(files).toHaveLength(1);
    const parsed = JSON.parse(readFileSync(join(dir, "pkg", files[0]!), "utf8")) as PackageEntry;
    expect(parsed.vulnIds[0]?.id).toMatch(/^[ab]-\d+$/);
  });
});
