import { LineIndex } from "../../core/lineIndex.js";
import type { ResolvedDep } from "../../core/types.js";
import { resolveEntries, type LockEntry } from "../npm/lockCommon.js";

const SPEC_LINE = /^ {4}(\S+) \(([^)\s]+)\)\s*$/;
const EDGE_LINE = /^ {6}(\S+)/;
const DIRECT_LINE = /^ {2}([^\s(!]+)/;

/**
 * Parses Gemfile.lock / gems.locked. Only the GEM section's specs are reported (GIT and PATH gems are not
 * registry versions); a platform suffix is dropped, so `nokogiri (1.13.0-x86_64-linux)` and `nokogiri (1.13.0)` are one entry.
 */
export function parseGemfileLock(text: string): ResolvedDep[] {
  const ix = new LineIndex(text);
  const entries = new Map<string, LockEntry>();
  const byName = new Map<string, LockEntry>();
  const edgeNames = new Map<LockEntry, Set<string>>();
  const directNames: string[] = [];
  let hasDependencies = false;

  let section = "";
  let inSpecs = false;
  let current: LockEntry | undefined;
  let offset = 0;
  for (const raw of text.split("\n")) {
    const lineStart = offset;
    offset += raw.length + 1;
    const line = raw.replace(/\r$/, "");
    if (line.length > 0 && !line.startsWith(" ")) {
      section = line.trim();
      inSpecs = false;
      current = undefined;
      if (section === "DEPENDENCIES") hasDependencies = true;
      continue;
    }
    if (section === "GEM") {
      if (line.trim() === "specs:") {
        inSpecs = true;
        continue;
      }
      if (!inSpecs) continue;
      const spec = SPEC_LINE.exec(line);
      if (spec) {
        const name = spec[1]!;
        const full = spec[2]!;
        const version = full.split("-")[0]!;
        const id = `${name}@${version}`;
        const existing = entries.get(id);
        if (existing) {
          current = existing;
        } else {
          const start = lineStart + line.indexOf("(") + 1;
          current = { id, name, version, range: ix.range(start, start + version.length), edges: [] };
          entries.set(id, current);
          byName.set(name, current);
          edgeNames.set(current, new Set());
        }
        continue;
      }
      const edge = EDGE_LINE.exec(line);
      if (edge && current) edgeNames.get(current)!.add(edge[1]!);
    } else if (section === "DEPENDENCIES") {
      const direct = DIRECT_LINE.exec(line);
      if (direct) directNames.push(direct[1]!);
    }
  }

  for (const [entry, names] of edgeNames) entry.edges = [...names].flatMap((n) => (byName.has(n) ? [byName.get(n)!.id] : []));
  const direct = hasDependencies ? directNames.flatMap((n) => (byName.has(n) ? [byName.get(n)!.id] : [])) : undefined;
  return resolveEntries([...entries.values()], direct);
}
