const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
// scp-like `[user@]host:owner/repo`; a numeric first path segment would be a port, so it is excluded.
const SCP = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\d+(?:\/|$))(.+)$/;
const HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

/**
 * Normalizes a Swift package repository URL to the SwiftURL package name OSV uses: `host/owner/repo`, with no
 * scheme, credentials, port, trailing `/` or `.git`, and a lowercase host. Returns undefined for anything that
 * is not a remote repository URL (a local path, a bare name).
 */
export function normalizeSwiftUrl(url: string): string | undefined {
  let rest = url.trim();
  if (rest === "" || /\s/.test(rest)) return undefined;
  if (SCHEME.test(rest)) {
    rest = rest.replace(SCHEME, "").replace(/^[^/@]*@/, "");
  } else {
    const scp = SCP.exec(rest);
    if (scp) rest = `${scp[1]}/${scp[2]}`;
    else rest = rest.replace(/^[^/@]*@/, "");
  }
  rest = rest.replace(/\/+$/, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return undefined;
  const host = rest.slice(0, slash).replace(/:\d+$/, "").toLowerCase();
  if (!HOST.test(host)) return undefined;
  return `${host}${rest.slice(slash)}`;
}
