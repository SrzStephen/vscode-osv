import { LineIndex } from "../../core/lineIndex.js";
import type { ResolvedDep } from "../../core/types.js";

const ENTRY = /^([^:\s=]+):([^:\s=]+):([^:\s=]+)=/;

/** Entries of a gradle.lockfile (`group:artifact:version=conf1,conf2`). Direct-ness is left for the scanner. */
export function parseGradleLockfile(text: string): ResolvedDep[] {
  const ix = new LineIndex(text);
  const deps: ResolvedDep[] = [];
  let at = 0;
  for (const line of text.split("\n")) {
    const m = ENTRY.exec(line.trimStart());
    if (m && !line.trimStart().startsWith("#")) {
      const start = at + (line.length - line.trimStart().length) + m[1]!.length + m[2]!.length + 2;
      deps.push({ name: `${m[1]}:${m[2]}`, version: m[3]!, range: ix.range(start, start + m[3]!.length), direct: false });
    }
    at += line.length + 1;
  }
  return deps;
}
