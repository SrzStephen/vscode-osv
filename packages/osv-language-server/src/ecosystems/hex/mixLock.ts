import { LineIndex } from "../../core/lineIndex.js";
import type { ResolvedDep } from "../../core/types.js";
import { resolveEntries, type LockEntry } from "../npm/lockCommon.js";

const HEX_ENTRY = /^\s*"([^"]+)":\s*\{:hex,\s*:(\w+|"[^"]+"),\s*"([^"]*)"/;

/** [start, end) of the first top-level `[...]` at or after `from`, or undefined. */
function nextList(line: string, from: number): [number, number] | undefined {
  const start = line.indexOf("[", from);
  if (start < 0) return undefined;
  let depth = 0;
  for (let i = start; i < line.length; i++) {
    if (line[i] === "[") depth++;
    else if (line[i] === "]" && --depth === 0) return [start, i + 1];
  }
  return undefined;
}

/**
 * Parses mix.lock. Only `:hex` entries are reported (`:git` and `:path` are not registry versions); the
 * name is the Hex package, which can differ from the entry's key (the app name). mix.lock does not record
 * which dependencies are direct, so `direct` is false throughout and `via` chains start at entries nothing else depends on.
 */
export function parseMixLock(text: string): ResolvedDep[] {
  const ix = new LineIndex(text);
  const entries: LockEntry[] = [];
  const edgeNames = new Map<LockEntry, string[]>();
  let offset = 0;
  for (const raw of text.split("\n")) {
    const lineStart = offset;
    offset += raw.length + 1;
    const line = raw.replace(/\r$/, "");
    const m = HEX_ENTRY.exec(line);
    if (!m) continue;
    const key = m[1]!;
    const pkg = m[2]!.replace(/^"|"$/g, "");
    const version = m[3]!;
    const versionEnd = m[0].length - 1;
    const start = lineStart + versionEnd - version.length;
    const entry: LockEntry = { id: key, name: pkg, version, range: ix.range(start, start + version.length), edges: [] };
    entries.push(entry);

    // After the version: "outer hash", [build tools], [dependencies], "repo", "hash".
    const tools = nextList(line, versionEnd);
    const deps = tools && nextList(line, tools[1]);
    if (deps) edgeNames.set(entry, [...line.slice(deps[0], deps[1]).matchAll(/\{:(\w+),/g)].map((d) => d[1]!));
  }
  for (const [entry, names] of edgeNames) entry.edges = names;
  return resolveEntries(entries).map((d) => ({ ...d, direct: false }));
}
