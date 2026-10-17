import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { getStaticTOMLValue, parseTOML } from "toml-eslint-parser";
import type { FileSource } from "./fileSource.js";
import type { Vuln } from "./types.js";

export interface IgnoreEntry {
  id: string;
  ignoreUntil?: Date;
  reason?: string;
}

export class IgnoreMatcher {
  private readonly ids = new Set<string>();

  /** Settings ids always apply; toml entries apply until their ignoreUntil date (an invalid date counts as expired). */
  constructor(ids: string[], tomlEntries: IgnoreEntry[], now: Date) {
    for (const id of ids) this.ids.add(id);
    for (const e of tomlEntries) {
      if (e.ignoreUntil === undefined || e.ignoreUntil.getTime() > now.getTime()) this.ids.add(e.id);
    }
  }

  isIgnored(vuln: Vuln): boolean {
    return this.ids.has(vuln.id) || vuln.aliases.some((a) => this.ids.has(a));
  }
}

/** TOML dates parse to Date; strings are tried too. Anything else becomes an Invalid Date, which the matcher treats as expired (fail closed). */
function toDate(v: unknown): Date {
  return v instanceof Date ? v : typeof v === "string" ? new Date(v) : new Date(NaN);
}

/** Reads `[[IgnoredVulns]]` entries; invalid TOML yields no entries. */
export function parseOsvScannerToml(text: string): IgnoreEntry[] {
  let doc: unknown;
  try {
    doc = getStaticTOMLValue(parseTOML(text));
  } catch {
    return [];
  }
  const list = (doc as { IgnoredVulns?: unknown } | null)?.IgnoredVulns;
  if (!Array.isArray(list)) return [];
  const out: IgnoreEntry[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const { id, ignoreUntil, reason } = item as Record<string, unknown>;
    if (typeof id !== "string" || id === "") continue;
    const entry: IgnoreEntry = { id };
    if (ignoreUntil !== undefined) entry.ignoreUntil = toDate(ignoreUntil);
    if (typeof reason === "string") entry.reason = reason;
    out.push(entry);
  }
  return out;
}

/** Nearest osv-scanner.toml from the file's directory up to rootDir inclusive. */
export async function findOsvScannerToml(filePath: string, rootDir: string, files: FileSource): Promise<string | undefined> {
  const inside = (p: string) => {
    const rel = relative(rootDir, p);
    return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  };
  let dir = dirname(filePath);
  if (!inside(dir)) return undefined;
  for (;;) {
    const candidate = join(dir, "osv-scanner.toml");
    if ((await files.read(candidate)) !== undefined) return candidate;
    if (relative(rootDir, dir) === "") return undefined;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
