import { dirname, isAbsolute, join, relative } from "node:path";
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

  /** Settings ids always apply; toml entries apply until their ignoreUntil date. */
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

function toDate(v: unknown): Date | undefined {
  // TOML dates parse to Date; datetimes may be written as strings by lenient authors.
  const d = v instanceof Date ? v : typeof v === "string" ? new Date(v) : undefined;
  return d !== undefined && !Number.isNaN(d.getTime()) ? d : undefined;
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
    const until = toDate(ignoreUntil);
    if (until) entry.ignoreUntil = until;
    if (typeof reason === "string") entry.reason = reason;
    out.push(entry);
  }
  return out;
}

/** Nearest osv-scanner.toml from the file's directory up to rootDir inclusive. */
export async function findOsvScannerToml(filePath: string, rootDir: string, files: FileSource): Promise<string | undefined> {
  const inside = (p: string) => {
    const rel = relative(rootDir, p);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
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
