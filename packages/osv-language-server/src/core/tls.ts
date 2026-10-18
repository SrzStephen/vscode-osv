import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import tls from "node:tls";
import { EnvHttpProxyAgent, type Dispatcher } from "undici";

/**
 * Extra CA certificates (PEM text) to trust: the file from the `osv.caCertificatePath` setting, or
 * SSL_CERT_FILE when that is empty, plus every .pem or .crt file in SSL_CERT_DIR.
 */
export function extraCaCertificates(setting: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const pems: string[] = [];
  const file = setting !== "" ? setting : (env.SSL_CERT_FILE ?? "");
  if (file !== "") pems.push(readFileSync(file, "utf8"));
  const dir = env.SSL_CERT_DIR ?? "";
  if (dir !== "") {
    for (const name of readdirSync(dir).sort()) {
      if (/\.(pem|crt)$/i.test(name)) pems.push(readFileSync(join(dir, name), "utf8"));
    }
  }
  return pems;
}

/**
 * Dispatcher for outbound requests. Without extra CAs it trusts Node's default store (which already
 * honours NODE_EXTRA_CA_CERTS and NODE_USE_SYSTEM_CA). With them, the certificates are added to those
 * roots rather than replacing them, so endpoints that need only the public roots keep working.
 */
export function createDispatcher(setting: string, env: NodeJS.ProcessEnv = process.env): Dispatcher {
  const extra = extraCaCertificates(setting, env);
  if (extra.length === 0) return new EnvHttpProxyAgent();
  const roots = typeof tls.getCACertificates === "function" ? tls.getCACertificates("default") : tls.rootCertificates;
  return new EnvHttpProxyAgent({ connect: { ca: [...roots, ...extra] } });
}
