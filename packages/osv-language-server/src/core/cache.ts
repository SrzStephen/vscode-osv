import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import type { OsvRecord, PackageQuery } from "./types.js";

export interface PackageEntry {
  fetchedAt: string;
  vulnIds: { id: string; modified: string }[];
}

const HOUR_MS = 3_600_000;

export function isFresh(e: PackageEntry, ttlHours: number, now: Date = new Date()): boolean {
  return now.getTime() - Date.parse(e.fetchedAt) < ttlHours * HOUR_MS;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Small insertion-ordered LRU; a Map keeps order, so re-inserting marks an entry most recent. */
class Lru<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly max: number) {}

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

/** On-disk cache shared by the server and CLI processes; each entry is its own file, replaced atomically. */
export class DiskCache {
  private readonly packages: Lru<PackageEntry>;
  private readonly vulns: Lru<OsvRecord>;

  constructor(
    private readonly dir: string,
    memoryEntries = 5000,
  ) {
    this.packages = new Lru(memoryEntries);
    this.vulns = new Lru(memoryEntries);
  }

  private pkgKey(q: PackageQuery): string {
    return sha256(`${q.ecosystem}|${q.name}|${q.version}`);
  }

  private file(kind: "pkg" | "vuln", key: string): string {
    return join(this.dir, kind, `${key}.json`);
  }

  async getPackage(q: PackageQuery): Promise<PackageEntry | undefined> {
    const key = this.pkgKey(q);
    const hit = this.packages.get(key);
    if (hit) return hit;
    const e = await this.readJson<PackageEntry>(this.file("pkg", key));
    if (e) this.packages.set(key, e);
    return e;
  }

  async putPackage(q: PackageQuery, e: PackageEntry): Promise<void> {
    const key = this.pkgKey(q);
    this.packages.set(key, e);
    await this.writeJson(this.file("pkg", key), e);
  }

  async getVuln(id: string): Promise<OsvRecord | undefined> {
    const key = sha256(id);
    const hit = this.vulns.get(key);
    if (hit) return hit;
    const r = await this.readJson<OsvRecord>(this.file("vuln", key));
    if (r) this.vulns.set(key, r);
    return r;
  }

  async putVuln(r: OsvRecord): Promise<void> {
    const key = sha256(r.id);
    this.vulns.set(key, r);
    await this.writeJson(this.file("vuln", key), r);
  }

  async clear(): Promise<void> {
    this.packages.clear();
    this.vulns.clear();
    await Promise.all(["pkg", "vuln"].map((k) => fs.rm(join(this.dir, k), { recursive: true, force: true })));
  }

  /** Deletes package entries older than 7x the TTL (and unreadable ones); returns how many were removed. */
  async housekeep(ttlHours: number, now: Date = new Date()): Promise<number> {
    const dir = join(this.dir, "pkg");
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return 0;
    }
    const cutoff = now.getTime() - 7 * ttlHours * HOUR_MS;
    let removed = 0;
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const path = join(dir, name);
      const e = await this.readJson<PackageEntry>(path);
      if (e && Date.parse(e.fetchedAt) >= cutoff) continue;
      try {
        await fs.rm(path);
        removed++;
      } catch {
        // another process removed it first
      }
    }
    this.packages.clear();
    return removed;
  }

  private async readJson<T>(path: string): Promise<T | undefined> {
    try {
      return JSON.parse(await fs.readFile(path, "utf8")) as T;
    } catch {
      // missing or corrupt: either way it is a cache miss
      return undefined;
    }
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    await fs.mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(value));
      await renameReplacing(tmp, path);
    } catch (e) {
      await fs.rm(tmp, { force: true });
      throw e;
    }
  }
}

const LOCKED = new Set(["EPERM", "EBUSY", "EACCES"]);

/**
 * Renames over `to`. On Windows this fails with EPERM/EBUSY/EACCES while another process is replacing or
 * reading the same file, as happens with two editor windows sharing one cache. Entries are last-writer-wins,
 * so retry briefly and then let the other writer's equivalent entry stand.
 */
async function renameReplacing(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === undefined || !LOCKED.has(code)) throw e;
      if (attempt >= 4) {
        await fs.rm(from, { force: true });
        return;
      }
      await new Promise((r) => setTimeout(r, 10 * (attempt + 1)));
    }
  }
}
