import { LineIndex } from "../../core/lineIndex.js";
import type { DeclaredDep } from "../../core/types.js";
import { normalizePypiName } from "./names.js";
import { parseRequirement, pep440LowerBound } from "./requirement.js";

interface LogicalLine {
  text: string;
  /** Original offset of each character of `text`. */
  offsets: number[];
}

/** Splits into logical lines, joining `\` continuations while remembering original offsets. */
function logicalLines(text: string): LogicalLine[] {
  const lines: LogicalLine[] = [];
  let cur: LogicalLine = { text: "", offsets: [] };
  let pos = 0;
  while (pos <= text.length) {
    const nl = text.indexOf("\n", pos);
    const lineEnd = nl < 0 ? text.length : nl;
    let content = text.slice(pos, lineEnd);
    if (content.endsWith("\r")) content = content.slice(0, -1);
    const continued = content.endsWith("\\");
    if (continued) content = content.slice(0, -1);
    for (let i = 0; i < content.length; i++) cur.offsets.push(pos + i);
    cur.text += content;
    if (!continued || nl < 0) {
      lines.push(cur);
      cur = { text: "", offsets: [] };
    }
    if (nl < 0) break;
    pos = nl + 1;
  }
  return lines;
}

/** Parses requirement lines, skipping options, comments and `--hash=` suffixes. */
export function parseRequirementsTxt(text: string): DeclaredDep[] {
  const ix = new LineIndex(text);
  const deps: DeclaredDep[] = [];

  for (const line of logicalLines(text)) {
    let s = line.text;
    const comment = /(^|\s)#/.exec(s);
    if (comment) s = s.slice(0, comment.index);
    const option = /\s--[A-Za-z]/.exec(s);
    if (option) s = s.slice(0, option.index);
    if (/^\s*(-|$)/.test(s)) continue;

    const r = parseRequirement(s);
    if (!r) continue;

    // An end offset maps through its last character so a continuation never lands inside a range.
    const range = (start: number, end: number) =>
      ix.range(line.offsets[start]!, line.offsets[end - 1]! + 1);
    const lowerBound = r.spec === undefined ? undefined : pep440LowerBound(r.spec);
    deps.push({
      name: normalizePypiName(r.name),
      rawSpec: r.spec,
      nameRange: range(r.nameStart, r.nameEnd),
      specRange: r.specStart === undefined ? undefined : range(r.specStart, r.specEnd!),
      lowerBound,
      kind: r.kind === "registry" && lowerBound === undefined ? "unresolved" : r.kind,
    });
  }
  return deps;
}
