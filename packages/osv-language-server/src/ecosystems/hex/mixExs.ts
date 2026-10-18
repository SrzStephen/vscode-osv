import { LineIndex } from "../../core/lineIndex.js";
import type { DeclaredDep } from "../../core/types.js";
import { hexLowerBound } from "./requirement.js";

const DEPS_FUNCTION = /^[ \t]*defp?[ \t]+deps\b/m;
const GIT_OPTION = /(?:^|[\s,[{])(?:git|github):/;
const PATH_OPTION = /(?:^|[\s,[{])(?:path|in_umbrella):/;
const ONLY_OPTION = /(?:^|[\s,[{])only:\s*(\[[^\]]*\]|:\w+)/;
const OPEN = "([{";
const CLOSE = ")]}";

/** End offset (exclusive) of the string literal opening at `i`; text.length when it is unterminated. */
function stringEnd(text: string, i: number): number {
  const quote = text[i];
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === "\\") j++;
    else if (text[j] === quote) return j + 1;
  }
  return text.length;
}

/** Offset just past a `#` comment starting at `i`. */
function commentEnd(text: string, i: number): number {
  const eol = text.indexOf("\n", i);
  return eol < 0 ? text.length : eol;
}

/** Offset of the bracket closing the one opening at `open`, skipping strings and comments; undefined when unbalanced. */
function matchClose(text: string, open: number): number | undefined {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"' || c === "'") i = stringEnd(text, i) - 1;
    else if (c === "#") i = commentEnd(text, i) - 1;
    else if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c) && --depth === 0) return i;
  }
  return undefined;
}

/** Splits `text[from, to)` at commas outside strings, comments and brackets; offsets are absolute. */
function splitTopLevel(text: string, from: number, to: number): Array<{ start: number; end: number }> {
  const parts: Array<{ start: number; end: number }> = [];
  let start = from;
  let depth = 0;
  for (let i = from; i < to; i++) {
    const c = text[i]!;
    if (c === '"' || c === "'") i = stringEnd(text, i) - 1;
    else if (c === "#") i = commentEnd(text, i) - 1;
    else if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) depth--;
    else if (c === "," && depth === 0) {
      parts.push({ start, end: i });
      start = i + 1;
    }
  }
  parts.push({ start, end: to });
  return parts;
}

/** Trims whitespace and returns the segment's start/end offsets. */
function trimmed(text: string, p: { start: number; end: number }): { start: number; end: number } {
  let { start, end } = p;
  while (start < end && /\s/.test(text[start]!)) start++;
  while (end > start && /\s/.test(text[end - 1]!)) end--;
  return { start, end };
}

function parseTuple(text: string, ix: LineIndex, open: number, close: number): DeclaredDep | undefined {
  const segs = splitTopLevel(text, open + 1, close).map((p) => trimmed(text, p));
  const nameSeg = segs[0];
  if (!nameSeg) return undefined;
  const atom = /^:(?:(\w+)|"([^"]+)")$/.exec(text.slice(nameSeg.start, nameSeg.end));
  if (!atom) return undefined;
  const name = atom[1] ?? atom[2]!;
  const nameStart = nameSeg.end - name.length - (atom[2] === undefined ? 0 : 1);
  const dep: DeclaredDep = { name, nameRange: ix.range(nameStart, nameStart + name.length), kind: "unresolved" };

  let optsFrom = 1;
  const reqSeg = segs[1];
  const isReq = reqSeg !== undefined && text[reqSeg.start] === '"' && stringEnd(text, reqSeg.start) === reqSeg.end;
  if (isReq) optsFrom = 2;
  const first = segs[optsFrom];
  const last = segs[segs.length - 1];
  const options = first && last ? text.slice(first.start, last.end) : "";

  const only = ONLY_OPTION.exec(options)?.[1];
  dep.group = only === undefined ? "deps" : (only.match(/\w+/g) ?? []).join(",");
  if (GIT_OPTION.test(options)) dep.kind = "git";
  else if (PATH_OPTION.test(options)) dep.kind = "path";
  else if (isReq) {
    const rawSpec = text.slice(reqSeg.start + 1, reqSeg.end - 1);
    dep.kind = "registry";
    dep.rawSpec = rawSpec;
    dep.specRange = ix.range(reqSeg.start + 1, reqSeg.end - 1);
    dep.lowerBound = hexLowerBound(rawSpec);
  }
  return dep;
}

/**
 * Parses the dependency tuples of the `deps` function in mix.exs: `{:name, "req"}`, `{:name, "req", opts}`
 * and `{:name, opts}`. Never throws; tuples it does not understand are skipped.
 */
export function parseMixExs(text: string): DeclaredDep[] {
  const fn = DEPS_FUNCTION.exec(text);
  if (!fn) return [];
  let list = -1;
  for (let i = fn.index + fn[0].length; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"' || c === "'") i = stringEnd(text, i) - 1;
    else if (c === "#") i = commentEnd(text, i) - 1;
    else if (c === "[") {
      list = i;
      break;
    }
  }
  const listEnd = list < 0 ? undefined : matchClose(text, list);
  if (listEnd === undefined) return [];

  const ix = new LineIndex(text);
  const deps: DeclaredDep[] = [];
  for (const seg of splitTopLevel(text, list + 1, listEnd)) {
    const t = trimmed(text, seg);
    // Leading comment lines belong to the next tuple's segment.
    let start = t.start;
    while (text[start] === "#") start = trimmedStart(text, commentEnd(text, start), t.end);
    if (text[start] !== "{") continue;
    const close = matchClose(text, start);
    if (close === undefined || close >= t.end) continue;
    const dep = parseTuple(text, ix, start, close);
    if (dep) deps.push(dep);
  }
  return deps;
}

function trimmedStart(text: string, from: number, to: number): number {
  let i = from;
  while (i < to && /\s/.test(text[i]!)) i++;
  return i;
}
