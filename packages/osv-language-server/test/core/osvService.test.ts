import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "undici";
import { afterEach, describe, expect, it } from "vitest";
import { DiskCache } from "../../src/core/cache.js";
import { OsvClient } from "../../src/core/osvClient.js";
import { OsvService, queryKey } from "../../src/core/osvService.js";
import type { OsvRecord, PackageQuery } from "../../src/core/types.js";
import { startFakeOsv } from "../helpers/fakeOsv.js";

type Fake = Awaited<ReturnType<typeof startFakeOsv>>;
let fake: Fake | undefined;
const agent = new Agent();
afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

const q: PackageQuery = { ecosystem: "npm", name: "lodash", version: "4.17.0" };
const rec = (id: string, modified = "2024-01-01T00:00:00Z", extra: Partial<OsvRecord> = {}): OsvRecord => ({ id, modified, ...extra });
const setup = (url: string, ttl = 24) => {
  const cache = new DiskCache(mkdtempSync(join(tmpdir(), "osv-svc-")));
  const client = new OsvClient({ baseUrl: url, userAgent: "t", dispatcher: agent, sleep: async () => {} });
  return new OsvService(client, cache, () => ttl);
};
const count = (f: Fake, prefix: string) => f.requests.filter((r) => r.path.startsWith(prefix)).length;

describe("queryKey", () => {
  it("joins ecosystem, name and version", () => expect(queryKey(q)).toBe("npm|lodash|4.17.0"));
});

describe("OsvService.lookup", () => {
  it("fetches, caches, and dedupes queries", async () => {
    fake = await startFakeOsv({ packages: { [queryKey(q)]: ["V-1"] }, records: { "V-1": rec("V-1") } });
    const r = await setup(fake.url).lookup([q, { ...q }]);
    expect(r.offline).toBe(false);
    expect(r.results.size).toBe(1);
    expect(r.results.get(queryKey(q))).toEqual({ records: [rec("V-1")], cached: false });
    const body = fake.requests.find((x) => x.path === "/v1/querybatch")!.body as { queries: unknown[] };
    expect(body.queries).toHaveLength(1);
  });

  it("serves fresh cache without network", async () => {
    fake = await startFakeOsv({ packages: { [queryKey(q)]: ["V-1"] }, records: { "V-1": rec("V-1") } });
    const svc = setup(fake.url);
    await svc.lookup([q]);
    const before = fake.requests.length;
    const r = await svc.lookup([q]);
    expect(fake.requests.length).toBe(before);
    expect(r.results.get(queryKey(q))).toEqual({ records: [rec("V-1")], cached: false });
    expect(r.offline).toBe(false);
  });

  it("refetches a vuln only when modified changes", async () => {
    const data = { packages: { [queryKey(q)]: ["V-1"] }, records: { "V-1": rec("V-1") } };
    fake = await startFakeOsv(data);
    const svc = setup(fake.url, 0);
    await svc.lookup([q]);
    expect(count(fake, "/v1/vulns/")).toBe(1);
    await svc.lookup([q]);
    expect(count(fake, "/v1/vulns/")).toBe(1);
    data.records["V-1"] = rec("V-1", "2025-01-01T00:00:00Z", { summary: "new" });
    const r = await svc.lookup([q]);
    expect(count(fake, "/v1/vulns/")).toBe(2);
    expect(r.results.get(queryKey(q))!.records[0]!.summary).toBe("new");
  });

  it("drops withdrawn records", async () => {
    fake = await startFakeOsv({
      packages: { [queryKey(q)]: ["V-1", "V-2"] },
      records: { "V-1": rec("V-1", "2024-01-01T00:00:00Z", { withdrawn: "2024-01-01T00:00:00Z" }), "V-2": rec("V-2") },
    });
    const r = await setup(fake.url).lookup([q]);
    expect(r.results.get(queryKey(q))!.records.map((x) => x.id)).toEqual(["V-2"]);
  });

  it("offline: stale cache served with cached=true", async () => {
    fake = await startFakeOsv({ packages: { [queryKey(q)]: ["V-1"] }, records: { "V-1": rec("V-1") } });
    const svc = setup(fake.url, 0);
    await svc.lookup([q]);
    fake.failNext(503, 100);
    const r = await svc.lookup([q]);
    expect(r.offline).toBe(true);
    expect(r.results.get(queryKey(q))).toEqual({ records: [rec("V-1")], cached: true });
  });

  it("offline: queries with no cache are absent", async () => {
    fake = await startFakeOsv({ packages: {}, records: {} });
    fake.failNext(503, 100);
    const r = await setup(fake.url).lookup([q]);
    expect(r.offline).toBe(true);
    expect(r.results.has(queryKey(q))).toBe(false);
  });
});
