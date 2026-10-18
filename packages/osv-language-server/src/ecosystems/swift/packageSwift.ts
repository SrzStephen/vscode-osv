import { LineIndex } from "../../core/lineIndex.js";
import type { DeclaredDep } from "../../core/types.js";
import { normalizeSwiftUrl } from "./url.js";

const PACKAGE_CALL = /\.package\s*\(/g;
const RANGE = /^"[ ]*"\s*\.\.[.<]\s*"[ ]*"$/;
const VERSION_CALL = /^\.(?:exact|upToNextMajor|upToNextMinor)\s*\(/;
const REF_CALL = /^\.(?:branch|revision)\s*\(/;
const LABEL = /^([A-Za-z_]\w*)\s*:/;

interface Str {
  /** Offsets of the quotes. */
  open: number;
  close: number;
}

/**
 * Copy of `text` with comments and string contents blanked to spaces (quotes and newlines stay), so
 * structure can be scanned without being fooled by `//` in a URL or a paren in a comment. Offsets are unchanged.
 */
function codeOnly(text: string): string {
  const out = text.split("");
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
  };
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("//", i)) {
      const eol = text.indexOf("\n", i);
      const end = eol < 0 ? text.length : eol;
      blank(i, end);
      i = end;
    } else if (text.startsWith("/*", i)) {
      let depth = 0;
      let j = i;
      for (; j < text.length; j++) {
        if (text.startsWith("/*", j)) {
          depth++;
          j++;
        } else if (text.startsWith("*/", j) && --depth === 0) {
          j++;
          break;
        }
      }
      blank(i, Math.min(j + 1, text.length));
      i = j + 1;
    } else if (text[i] === '"' || (text[i] === "#" && /^#+"/.test(text.slice(i, i + 32)))) {
      const hashes = text[i] === "#" ? /^#+/.exec(text.slice(i))![0].length : 0;
      const open = i + hashes;
      const multi = text.startsWith('"""', open);
      const quote = multi ? '"""' : '"';
      const closer = quote + "#".repeat(hashes);
      let j = open + quote.length;
      for (; j < text.length; j++) {
        if (hashes === 0 && text[j] === "\\") j++;
        else if (text.startsWith(closer, j)) break;
      }
      blank(open + quote.length, Math.min(j, text.length));
      i = Math.min(j + closer.length, text.length);
    } else i++;
  }
  return out.join("");
}

/** Offset of the paren closing the one opening at `open` in comment- and string-free code; undefined when unbalanced. */
function matchClose(code: string, open: number): number | undefined {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if ("([{".includes(code[i]!)) depth++;
    else if (")]}".includes(code[i]!) && --depth === 0) return i;
  }
  return undefined;
}

/** Splits `code[from, to)` at top-level commas; offsets are absolute and untrimmed. */
function splitArgs(code: string, from: number, to: number): Array<[number, number]> {
  const parts: Array<[number, number]> = [];
  let start = from;
  let depth = 0;
  for (let i = from; i < to; i++) {
    const c = code[i]!;
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      parts.push([start, i]);
      start = i + 1;
    }
  }
  parts.push([start, to]);
  return parts;
}

function stringsIn(code: string, from: number, to: number): Str[] {
  const out: Str[] = [];
  for (let i = from; i < to; i++) {
    if (code[i] !== '"') continue;
    const close = code.indexOf('"', i + 1);
    if (close < 0 || close >= to) break;
    out.push({ open: i, close });
    i = close;
  }
  return out;
}

/**
 * Parses the `.package(...)` calls of Package.swift, including multi-line ones; comments are ignored. Registry
 * (`id:`) dependencies are skipped; `branch`/`revision` give kind git and `path` gives kind path. For a range
 * (`"1.0.0"..<"2.0.0"`) `rawSpec` and `specRange` span both quoted bounds; for every other form they cover the version only.
 * Never throws; calls it does not understand are skipped.
 */
export function parsePackageSwift(text: string): DeclaredDep[] {
  const code = codeOnly(text);
  const ix = new LineIndex(text);
  const deps: DeclaredDep[] = [];
  const inner = (s: Str): { start: number; end: number; value: string } => ({ start: s.open + 1, end: s.close, value: text.slice(s.open + 1, s.close) });

  for (const call of code.matchAll(PACKAGE_CALL)) {
    const open = call.index + call[0].length - 1;
    const close = matchClose(code, open);
    if (close === undefined) continue;

    let url: Str | undefined;
    let path: Str | undefined;
    let version: { start: number; end: number; lower: string } | undefined;
    let ref = false;
    let registry = false;
    for (const [from, to] of splitArgs(code, open + 1, close)) {
      const seg = code.slice(from, to);
      const lead = seg.length - seg.trimStart().length;
      const s = seg.trim();
      const strs = stringsIn(code, from + lead, from + lead + s.length);
      const first = strs[0];
      const label = LABEL.exec(s)?.[1];
      if (label === "url") url = first;
      else if (label === "path") path = first;
      else if (label === "id") registry = true;
      else if (label === "from" || label === "exact" || (label === undefined && VERSION_CALL.test(s))) {
        if (first) version = { ...inner(first), lower: inner(first).value };
      } else if (label === "branch" || label === "revision" || (label === undefined && REF_CALL.test(s))) ref = true;
      else if (label === undefined && RANGE.test(s) && strs.length === 2) {
        version = { start: strs[0]!.open, end: strs[1]!.close + 1, lower: inner(strs[0]!).value };
      }
    }
    if (registry) continue;

    if (path) {
      const p = inner(path);
      deps.push({ name: p.value, nameRange: ix.range(p.start, p.end), kind: "path" });
      continue;
    }
    if (!url) continue;
    const u = inner(url);
    const name = normalizeSwiftUrl(u.value);
    if (name === undefined) continue;
    const dep: DeclaredDep = { name, nameRange: ix.range(u.start, u.end), kind: "unresolved" };
    if (ref) dep.kind = "git";
    else if (version) {
      dep.kind = "registry";
      dep.rawSpec = text.slice(version.start, version.end);
      dep.specRange = ix.range(version.start, version.end);
      dep.lowerBound = version.lower;
    }
    deps.push(dep);
  }
  return deps;
}
