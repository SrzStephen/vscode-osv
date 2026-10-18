import { EnvHttpProxyAgent, fetch, type Dispatcher } from "undici";
import type { OsvRecord, PackageQuery } from "./types.js";

export class OsvUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OsvUnavailableError";
  }
}

/** A non-retryable HTTP error (e.g. 400 or 404). */
export class OsvRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "OsvRequestError";
  }
}

export interface OsvClientOptions {
  baseUrl: string;
  userAgent: string;
  dispatcher?: Dispatcher;
  sleep?: (ms: number) => Promise<void>;
}

export interface VulnRef {
  id: string;
  modified: string;
}

const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 1000;
const VULN_CONCURRENCY = 8;
const BACKOFF_BASE_MS = 500;

interface BatchQuery {
  package: { name: string; ecosystem: string };
  version: string;
  page_token?: string;
}

interface BatchResult {
  vulns?: VulnRef[];
  next_page_token?: string;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Longest wait a server's Retry-After can impose, so a hostile or broken header cannot stall a scan. */
const MAX_RETRY_AFTER_MS = 60_000;

/** Parses Retry-After (delta-seconds or HTTP date) into milliseconds, capped at MAX_RETRY_AFTER_MS. */
function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const clamp = (ms: number) => Math.min(MAX_RETRY_AFTER_MS, Math.max(0, ms));
  const secs = Number(header);
  if (Number.isFinite(secs)) return clamp(secs * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : clamp(at - Date.now());
}

export class OsvClient {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly dispatcher: Dispatcher;
  private readonly sleep: (ms: number) => Promise<void>;
  private batchChain: Promise<unknown> = Promise.resolve();
  private vulnActive = 0;
  private readonly vulnWaiters: (() => void)[] = [];

  constructor(opts: OsvClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.userAgent = opts.userAgent;
    this.dispatcher = opts.dispatcher ?? new EnvHttpProxyAgent();
    this.sleep = opts.sleep ?? defaultSleep;
  }

  /** Returns, per query and in order, the vulnerability ids (with modified times) affecting it. */
  queryBatch(queries: PackageQuery[], signal?: AbortSignal): Promise<VulnRef[][]> {
    const run = this.batchChain.then(() => this.queryAll(queries, signal));
    this.batchChain = run.catch(() => undefined);
    return run;
  }

  async getVuln(id: string, signal?: AbortSignal): Promise<OsvRecord> {
    await this.acquireVuln();
    try {
      return (await this.request("GET", `/v1/vulns/${encodeURIComponent(id)}`, undefined, signal)) as OsvRecord;
    } finally {
      this.releaseVuln();
    }
  }

  private async queryAll(queries: PackageQuery[], signal?: AbortSignal): Promise<VulnRef[][]> {
    const out: VulnRef[][] = [];
    for (let i = 0; i < queries.length; i += BATCH_SIZE) {
      out.push(...(await this.queryChunk(queries.slice(i, i + BATCH_SIZE), signal)));
    }
    return out;
  }

  private async queryChunk(chunk: PackageQuery[], signal?: AbortSignal): Promise<VulnRef[][]> {
    const results: VulnRef[][] = chunk.map(() => []);
    let pending: { index: number; query: BatchQuery }[] = chunk.map((q, index) => ({
      index,
      query: { package: { name: q.name, ecosystem: q.ecosystem }, version: q.version },
    }));
    while (pending.length > 0) {
      const body = await this.request("POST", "/v1/querybatch", { queries: pending.map((p) => p.query) }, signal);
      const page = (body as { results: BatchResult[] }).results;
      const next: typeof pending = [];
      pending.forEach((p, i) => {
        const r = page[i] ?? {};
        results[p.index]!.push(...(r.vulns ?? []));
        if (r.next_page_token) next.push({ index: p.index, query: { ...p.query, page_token: r.next_page_token } });
      });
      pending = next;
    }
    return results;
  }

  private async request(method: "GET" | "POST", path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let wait: number | undefined;
      try {
        const res = await fetch(this.baseUrl + path, {
          method,
          dispatcher: this.dispatcher,
          signal,
          headers: { "user-agent": this.userAgent, ...(body === undefined ? {} : { "content-type": "application/json" }) },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (res.ok) return await res.json();
        const retryable = res.status === 429 || res.status >= 500;
        await res.body?.cancel();
        if (!retryable) throw new OsvRequestError(res.status, `OSV ${method} ${path} failed with HTTP ${res.status}`);
        lastError = new Error(`HTTP ${res.status}`);
        wait = retryAfterMs(res.headers.get("retry-after"));
      } catch (e) {
        if (signal?.aborted) throw e;
        if (e instanceof OsvRequestError) throw e;
        lastError = e;
      }
      if (attempt < MAX_ATTEMPTS) {
        const backoff = BACKOFF_BASE_MS * 2 ** (attempt - 1);
        await this.abortableSleep(wait ?? backoff / 2 + Math.random() * (backoff / 2), signal);
      }
    }
    throw new OsvUnavailableError(`OSV API unavailable after ${MAX_ATTEMPTS} attempts`, { cause: lastError });
  }

  private async abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) return this.sleep(ms);
    signal.throwIfAborted();
    let onAbort!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      await Promise.race([this.sleep(ms), aborted]);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  private async acquireVuln(): Promise<void> {
    if (this.vulnActive < VULN_CONCURRENCY) {
      this.vulnActive++;
      return;
    }
    await new Promise<void>((resolve) => this.vulnWaiters.push(resolve));
  }

  private releaseVuln(): void {
    const next = this.vulnWaiters.shift();
    if (next) next();
    else this.vulnActive--;
  }
}
