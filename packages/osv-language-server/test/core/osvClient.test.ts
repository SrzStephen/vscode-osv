import { Agent } from "undici";
import { afterEach, describe, expect, it } from "vitest";
import { OsvClient, OsvUnavailableError } from "../../src/core/osvClient.js";
import type { OsvRecord, PackageQuery } from "../../src/core/types.js";
import { startFakeOsv } from "../helpers/fakeOsv.js";

type Fake = Awaited<ReturnType<typeof startFakeOsv>>;
let fake: Fake | undefined;
const agent = new Agent();
afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

const pq = (name: string, version = "1.0.0"): PackageQuery => ({ ecosystem: "npm", name, version });
const rec = (id: string): OsvRecord => ({ id, modified: "2024-01-01T00:00:00Z" });
const mkClient = (url: string, sleeps: number[] = []) =>
  new OsvClient({
    baseUrl: url,
    userAgent: "osv-language-server/test",
    dispatcher: agent,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });

describe("OsvClient.queryBatch", () => {
  it("chunks at 1000 and maps results in order", async () => {
    const packages: Record<string, string[]> = {};
    const queries = Array.from({ length: 1500 }, (_, i) => pq(`p${i}`));
    queries.forEach((q, i) => {
      if (i % 3 === 0) packages[`npm|${q.name}|1.0.0`] = [`V-${i}`];
    });
    const records = Object.fromEntries(Object.values(packages).flat().map((id) => [id, rec(id)]));
    fake = await startFakeOsv({ packages, records });
    const out = await mkClient(fake.url).queryBatch(queries);
    const batches = fake.requests.filter((r) => r.path === "/v1/querybatch");
    expect(batches.map((b) => (b.body as { queries: unknown[] }).queries.length)).toEqual([1000, 500]);
    expect(out).toHaveLength(1500);
    expect(out[0]).toEqual([{ id: "V-0", modified: "2024-01-01T00:00:00Z" }]);
    expect(out[1]).toEqual([]);
    expect(out[1497]).toEqual([{ id: "V-1497", modified: "2024-01-01T00:00:00Z" }]);
  });

  it("sends only package name, version and ecosystem, with the user agent", async () => {
    fake = await startFakeOsv({ packages: {}, records: {} });
    await mkClient(fake.url).queryBatch([pq("lodash", "4.17.0")]);
    expect(fake.requests[0]!.body).toEqual({ queries: [{ package: { name: "lodash", ecosystem: "npm" }, version: "4.17.0" }] });
    expect(fake.requests[0]!.userAgent).toBe("osv-language-server/test");
  });

  it("follows next_page_token", async () => {
    const ids = ["V-1", "V-2", "V-3", "V-4", "V-5"];
    fake = await startFakeOsv({ packages: { "npm|a|1.0.0": ids, "npm|b|1.0.0": ["V-9"] }, records: {} }, { pageSize: 2 });
    const out = await mkClient(fake.url).queryBatch([pq("a"), pq("b")]);
    expect(out.map((r) => r.map((v) => v.id))).toEqual([ids, ["V-9"]]);
    const bodies = fake.requests.map((r) => (r.body as { queries: { package: { name: string }; page_token?: string }[] }).queries);
    expect(bodies[0]!.every((q) => q.page_token === undefined)).toBe(true);
    expect(bodies[1]).toHaveLength(1);
    expect(bodies[1]![0]!.package.name).toBe("a");
    expect(bodies[1]![0]!.page_token).toBeTruthy();
  });

  it("serialises batch calls", async () => {
    fake = await startFakeOsv({ packages: {}, records: {} }, { batchDelayMs: 30 });
    const c = mkClient(fake.url);
    await Promise.all([c.queryBatch([pq("a")]), c.queryBatch([pq("b")]), c.queryBatch([pq("c")])]);
    expect(fake.requests).toHaveLength(3);
    expect(fake.maxBatchInflight()).toBe(1);
  });

  it("retries 429 honouring Retry-After then succeeds", async () => {
    fake = await startFakeOsv({ packages: { "npm|a|1.0.0": ["V-1"] }, records: {} });
    fake.failNext(429, 2, "1");
    const sleeps: number[] = [];
    const out = await mkClient(fake.url, sleeps).queryBatch([pq("a")]);
    expect(sleeps).toEqual([1000, 1000]);
    expect(out[0]!.map((v) => v.id)).toEqual(["V-1"]);
    expect(fake.requests).toHaveLength(3);
  });

  it("honours an HTTP-date Retry-After", async () => {
    fake = await startFakeOsv({ packages: {}, records: {} });
    fake.failNext(503, 1, new Date(Date.now() + 5000).toUTCString());
    const sleeps: number[] = [];
    await mkClient(fake.url, sleeps).queryBatch([pq("a")]);
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(2000);
    expect(sleeps[0]).toBeLessThanOrEqual(5000);
  });

  it("caps Retry-After at 60 seconds (delta-seconds and HTTP date)", async () => {
    fake = await startFakeOsv({ packages: {}, records: {} });
    fake.failNext(429, 1, "86400");
    fake.failNext(503, 1, new Date(Date.now() + 3_600_000).toUTCString());
    const sleeps: number[] = [];
    await mkClient(fake.url, sleeps).queryBatch([pq("a")]);
    expect(sleeps).toEqual([60_000, 60_000]);
  });

  it("backs off exponentially with jitter without Retry-After", async () => {
    fake = await startFakeOsv({ packages: {}, records: {} });
    fake.failNext(500, 2);
    const sleeps: number[] = [];
    await mkClient(fake.url, sleeps).queryBatch([pq("a")]);
    expect(sleeps).toHaveLength(2);
    expect(sleeps[0]).toBeGreaterThanOrEqual(250);
    expect(sleeps[0]).toBeLessThanOrEqual(500);
    expect(sleeps[1]).toBeGreaterThanOrEqual(500);
    expect(sleeps[1]).toBeLessThanOrEqual(1000);
  });

  it("throws OsvUnavailableError after 3 failures", async () => {
    fake = await startFakeOsv({ packages: {}, records: {} });
    fake.failNext(503, 10);
    await expect(mkClient(fake.url).queryBatch([pq("a")])).rejects.toBeInstanceOf(OsvUnavailableError);
    expect(fake.requests).toHaveLength(3);
  });

  it("throws OsvUnavailableError on network errors", async () => {
    fake = await startFakeOsv({ packages: {}, records: {} });
    const url = fake.url;
    await fake.close();
    fake = undefined;
    await expect(mkClient(url).queryBatch([pq("a")])).rejects.toBeInstanceOf(OsvUnavailableError);
  });

  it("stops retrying and rejects with the abort reason when aborted during backoff", async () => {
    fake = await startFakeOsv({ packages: {}, records: {} });
    fake.failNext(503, 10);
    const ctl = new AbortController();
    const reason = new Error("cancelled");
    const client = new OsvClient({
      baseUrl: fake.url,
      userAgent: "t",
      dispatcher: agent,
      sleep: () => {
        queueMicrotask(() => ctl.abort(reason));
        return new Promise<void>(() => {});
      },
    });
    await expect(client.queryBatch([pq("a")], ctl.signal)).rejects.toBe(reason);
    expect(fake.requests).toHaveLength(1);
  });

  it("does not retry other 4xx errors", async () => {
    fake = await startFakeOsv({ packages: {}, records: {} });
    fake.failNext(400, 5);
    const sleeps: number[] = [];
    await expect(mkClient(fake.url, sleeps).queryBatch([pq("a")])).rejects.not.toBeInstanceOf(OsvUnavailableError);
    expect(fake.requests).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });
});

describe("OsvClient.getVuln", () => {
  it("fetches a record", async () => {
    fake = await startFakeOsv({ packages: {}, records: { "V-1": rec("V-1") } });
    expect(await mkClient(fake.url).getVuln("V-1")).toEqual(rec("V-1"));
    expect(fake.requests[0]!.path).toBe("/v1/vulns/V-1");
  });

  it("caps concurrency at 8", async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `V-${i}`);
    fake = await startFakeOsv({ packages: {}, records: Object.fromEntries(ids.map((id) => [id, rec(id)])) }, { vulnDelayMs: 20 });
    const c = mkClient(fake.url);
    const out = await Promise.all(ids.map((id) => c.getVuln(id)));
    expect(out.map((r) => r.id)).toEqual(ids);
    expect(fake.maxVulnInflight()).toBe(8);
  });
});
