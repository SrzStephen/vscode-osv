import type { FileSource } from "../../src/core/fileSource.js";

/**
 * The in-memory trees in the tests are keyed by POSIX paths such as `/ws/package.json`. On Windows the code
 * under test builds `\ws\package.json` or `C:\ws\package.json` (node:path joins and resolves natively) and
 * `file:///C:/ws/package.json` URIs, so lookups and assertions go through these to compare like with like.
 */
export const toPosix = (p: string): string => p.replace(/^[A-Za-z]:/, "").replace(/\\/g, "/");

/** `file:///C:/ws/a` becomes `file:///ws/a`; anything else is returned unchanged. */
export const toPosixUri = (u: string): string => u.replace(/^file:\/\/\/[A-Za-z]:/, "file://");

/** A FileSource over a POSIX-keyed record. `list` returns the names of direct children of a directory. */
export function memFs(files: Record<string, string>): FileSource {
  return {
    read: async (p) => files[toPosix(p)],
    list: async (d) => {
      const dir = toPosix(d).replace(/\/$/, "");
      return Object.keys(files)
        .filter((f) => f.startsWith(`${dir}/`) && !f.slice(dir.length + 1).includes("/"))
        .map((f) => f.slice(dir.length + 1));
    },
  };
}

const NATIVE_PATH = /^(?:[A-Za-z]:\\|\\[^\\])/;

/** Deeply rewrites Windows-native paths and file URIs inside a result to their POSIX form (no-op elsewhere). */
export function deepPosix<T>(value: T): T {
  if (typeof value === "string") {
    if (value.startsWith("file:///")) return toPosixUri(value) as T;
    return (NATIVE_PATH.test(value) ? toPosix(value) : value) as T;
  }
  if (Array.isArray(value)) return value.map((v) => deepPosix(v)) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepPosix(v)])) as T;
  }
  return value;
}

/** Wraps an async function so its result is passed through {@link deepPosix}. */
export function posixResult<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return async (...args) => deepPosix(await fn(...args));
}
