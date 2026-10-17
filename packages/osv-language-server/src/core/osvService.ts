import { isFresh, type DiskCache, type PackageEntry } from "./cache.js";
import { OsvUnavailableError, type OsvClient } from "./osvClient.js";
import type { OsvRecord, PackageQuery } from "./types.js";

export interface LookupResult {
  records: OsvRecord[];
  cached: boolean;
}

export const queryKey = (q: PackageQuery): string => `${q.ecosystem}|${q.name}|${q.version}`;

export class OsvService {
  constructor(
    private readonly client: OsvClient,
    private readonly cache: DiskCache,
    private readonly getTtlHours: () => number,
  ) {}

  async lookup(queries: PackageQuery[], signal?: AbortSignal): Promise<{ results: Map<string, LookupResult>; offline: boolean }> {
    const unique = new Map<string, PackageQuery>();
    for (const q of queries) unique.set(queryKey(q), q);

    const results = new Map<string, LookupResult>();
    const toFetch: [string, PackageQuery][] = [];
    const stale = new Map<string, PackageEntry>();
    const ttl = this.getTtlHours();

    for (const [key, q] of unique) {
      const entry = await this.cache.getPackage(q);
      if (entry && isFresh(entry, ttl)) {
        const records = await this.cachedRecords(entry);
        if (records) {
          results.set(key, { records: live(records), cached: false });
          continue;
        }
      }
      if (entry) stale.set(key, entry);
      toFetch.push([key, q]);
    }
    if (toFetch.length === 0) return { results, offline: false };

    try {
      const refs = await this.client.queryBatch(toFetch.map(([, q]) => q), signal);
      const fetching = new Map<string, Promise<OsvRecord>>();
      const ensure = (ref: { id: string; modified: string }): Promise<OsvRecord> => {
        let p = fetching.get(ref.id);
        if (!p) {
          p = this.ensureVuln(ref, signal);
          fetching.set(ref.id, p);
        }
        return p;
      };
      const fetched = await Promise.all(toFetch.map((_, i) => Promise.all(refs[i]!.map(ensure))));
      const fetchedAt = new Date().toISOString();
      for (const [i, [key, q]] of toFetch.entries()) {
        await this.cache.putPackage(q, { fetchedAt, vulnIds: refs[i]!.map(({ id, modified }) => ({ id, modified })) });
        results.set(key, { records: live(fetched[i]!), cached: false });
      }
      return { results, offline: false };
    } catch (e) {
      if (!(e instanceof OsvUnavailableError)) throw e;
      for (const [key] of toFetch) {
        const entry = stale.get(key);
        if (!entry) continue;
        const records = await this.cachedRecords(entry, true);
        results.set(key, { records: live(records!), cached: true });
      }
      return { results, offline: true };
    }
  }

  private async ensureVuln(ref: { id: string; modified: string }, signal?: AbortSignal): Promise<OsvRecord> {
    const cached = await this.cache.getVuln(ref.id);
    if (cached && cached.modified === ref.modified) return cached;
    const record = await this.client.getVuln(ref.id, signal);
    await this.cache.putVuln(record);
    return record;
  }

  /** Records for a cache entry; undefined if any is missing, unless `partial` allows skipping them. */
  private async cachedRecords(entry: PackageEntry, partial = false): Promise<OsvRecord[] | undefined> {
    const records: OsvRecord[] = [];
    for (const { id } of entry.vulnIds) {
      const r = await this.cache.getVuln(id);
      if (r) records.push(r);
      else if (!partial) return undefined;
    }
    return records;
  }
}

const live = (records: OsvRecord[]): OsvRecord[] => records.filter((r) => !r.withdrawn);
