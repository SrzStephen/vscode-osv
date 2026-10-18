import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OsvClient, OsvUnavailableError } from "../../src/core/osvClient.js";
import { createDispatcher, extraCaCertificates } from "../../src/core/tls.js";

// A self-signed certificate for 127.0.0.1 that exists only for these tests.
const certPath = join(__dirname, "..", "fixtures", "tls", "localhost-cert.pem");
const keyPath = join(__dirname, "..", "fixtures", "tls", "localhost-key.pem");

let server: Server | undefined;
let tmp: string | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

async function startHttpsOsv(): Promise<string> {
  server = createServer({ cert: readFileSync(certPath), key: readFileSync(keyPath) }, (_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ id: "GHSA-test", modified: "2024-01-01T00:00:00Z" }));
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("extraCaCertificates", () => {
  it("prefers the setting over SSL_CERT_FILE", () => {
    const [pem] = extraCaCertificates(certPath, { SSL_CERT_FILE: join(__dirname, "missing.pem") });
    expect(pem).toBe(readFileSync(certPath, "utf8"));
  });

  it("reads .pem and .crt files from SSL_CERT_DIR and ignores other files", () => {
    tmp = mkdtempSync(join(tmpdir(), "osv-tls-"));
    copyFileSync(certPath, join(tmp, "corp.crt"));
    copyFileSync(keyPath, join(tmp, "notes.txt"));
    expect(extraCaCertificates("", { SSL_CERT_DIR: tmp })).toEqual([readFileSync(certPath, "utf8")]);
  });

  it("returns nothing when neither setting nor variables are set", () => {
    expect(extraCaCertificates("", {})).toEqual([]);
  });
});

describe("createDispatcher", () => {
  it("trusts the certificate in the configured CA file", async () => {
    const baseUrl = await startHttpsOsv();
    const client = new OsvClient({ baseUrl, userAgent: "test", dispatcher: createDispatcher(certPath, {}), sleep: async () => {} });
    await expect(client.getVuln("GHSA-test")).resolves.toMatchObject({ id: "GHSA-test" });
  });

  it("trusts the certificate named by SSL_CERT_FILE when no setting is given", async () => {
    const baseUrl = await startHttpsOsv();
    const client = new OsvClient({ baseUrl, userAgent: "test", dispatcher: createDispatcher("", { SSL_CERT_FILE: certPath }), sleep: async () => {} });
    await expect(client.getVuln("GHSA-test")).resolves.toMatchObject({ id: "GHSA-test" });
  });

  it("rejects an unknown certificate when no extra CA is configured", async () => {
    const baseUrl = await startHttpsOsv();
    const client = new OsvClient({ baseUrl, userAgent: "test", dispatcher: createDispatcher("", {}), sleep: async () => {} });
    await expect(client.getVuln("GHSA-test")).rejects.toBeInstanceOf(OsvUnavailableError);
  });
});
