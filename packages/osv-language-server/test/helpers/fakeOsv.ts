import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { OsvRecord } from "../../src/core/types.js";

export interface FakeOsvData {
  /** Keyed by `${ecosystem}|${name}|${version}`. */
  packages: Record<string, string[]>;
  records: Record<string, OsvRecord>;
}

export interface FakeOsvOptions {
  /** Max vuln ids per querybatch page; the rest is behind next_page_token. */
  pageSize?: number;
  vulnDelayMs?: number;
  batchDelayMs?: number;
}

export interface FakeOsvRequest {
  path: string;
  body: unknown;
  userAgent?: string;
}

interface BatchQuery {
  package: { name: string; ecosystem: string };
  /** Absent for a package-only query. */
  version?: string;
  page_token?: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Local stand-in for api.osv.dev: a Node http server on an ephemeral port. */
export async function startFakeOsv(data: FakeOsvData, opts: FakeOsvOptions = {}) {
  const requests: FakeOsvRequest[] = [];
  const failures: { status: number; retryAfter?: string }[] = [];
  let batchInflight = 0;
  let maxBatch = 0;
  let vulnInflight = 0;
  let maxVuln = 0;

  const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };

  const queryOne = (q: BatchQuery) => {
    const ids = data.packages[`${q.package.ecosystem}|${q.package.name}|${q.version ?? ""}`] ?? [];
    const start = q.page_token ? Number(q.page_token) : 0;
    const end = opts.pageSize ? start + opts.pageSize : ids.length;
    const vulns = ids.slice(start, end).map((id) => ({ id, modified: data.records[id]?.modified ?? "1970-01-01T00:00:00Z" }));
    return end < ids.length ? { vulns, next_page_token: String(end) } : vulns.length ? { vulns } : {};
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const path = req.url ?? "";
    requests.push({ path, body: raw ? JSON.parse(raw) : undefined, userAgent: req.headers["user-agent"] });

    const fail = failures.shift();
    if (fail) {
      send(res, fail.status, { message: "injected failure" }, fail.retryAfter ? { "retry-after": fail.retryAfter } : {});
      return;
    }

    if (req.method === "POST" && path === "/v1/querybatch") {
      maxBatch = Math.max(maxBatch, ++batchInflight);
      try {
        if (opts.batchDelayMs) await sleep(opts.batchDelayMs);
        const { queries } = JSON.parse(raw) as { queries: BatchQuery[] };
        send(res, 200, { results: queries.map(queryOne) });
      } finally {
        batchInflight--;
      }
      return;
    }

    const m = /^\/v1\/vulns\/(.+)$/.exec(path);
    if (req.method === "GET" && m) {
      maxVuln = Math.max(maxVuln, ++vulnInflight);
      try {
        if (opts.vulnDelayMs) await sleep(opts.vulnDelayMs);
        const record = data.records[decodeURIComponent(m[1]!)];
        if (record) send(res, 200, record);
        else send(res, 404, { message: "not found" });
      } finally {
        vulnInflight--;
      }
      return;
    }
    send(res, 404, { message: "unknown endpoint" });
  };

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      res.destroy();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    /** The next `times` requests (any endpoint) fail with `status`. */
    failNext(status: number, times: number, retryAfter?: string): void {
      for (let i = 0; i < times; i++) failures.push({ status, retryAfter });
    },
    maxBatchInflight: () => maxBatch,
    maxVulnInflight: () => maxVuln,
    close(): Promise<void> {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
