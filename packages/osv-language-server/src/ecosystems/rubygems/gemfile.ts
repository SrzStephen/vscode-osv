import { LineIndex } from "../../core/lineIndex.js";
import type { DeclaredDep } from "../../core/types.js";
import { gemLowerBound } from "./requirement.js";

/** End offset (exclusive) of the quoted literal opening at `i`, or undefined when `text[i]` is not a quote or it is unterminated. */
export function literalEnd(text: string, i: number): number | undefined {
  const quote = text[i];
  if (quote !== '"' && quote !== "'") return undefined;
  for (let j = i + 1; j < text.length; j++) {
    const c = text[j];
    if (c === "\\") j++;
    else if (c === quote) return j + 1;
    else if (c === "\n") return undefined;
  }
  return undefined;
}

/** End of the logical line starting at `from`: a line ending in a comma continues onto the next one. */
export function statementEnd(text: string, from: number): number {
  let i = from;
  let last = "";
  while (i < text.length) {
    const c = text[i]!;
    if (c === '"' || c === "'") {
      i = literalEnd(text, i) ?? i + 1;
      last = c;
    } else if (c === "#") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "\n") {
      if (last !== ",") return i;
      last = "";
      i++;
    } else {
      if (!/\s/.test(c)) last = c;
      i++;
    }
  }
  return text.length;
}

function skipSpace(text: string, i: number, end: number): number {
  while (i < end) {
    if (/\s/.test(text[i]!)) i++;
    else if (text[i] === "#") while (i < end && text[i] !== "\n") i++;
    else break;
  }
  return i;
}

/** `text[from, end)` with each `#` comment outside a quoted literal replaced by a space. */
function withoutComments(text: string, from: number, end: number): string {
  let out = "";
  let i = from;
  while (i < end) {
    const c = text[i]!;
    if (c === "#") {
      out += " ";
      i = skipSpace(text, i, end);
    } else {
      const stop = Math.min(literalEnd(text, i) ?? i + 1, end);
      out += text.slice(i, stop);
      i = stop;
    }
  }
  return out;
}

const GIT_OPTION =/(?:^|[\s,(])(?:git|github):|:(?:git|github)\s*=>/;
const PATH_OPTION = /(?:^|[\s,(])path:|:path\s*=>/;
const GROUP_OPTION = /(?:\bgroups?:|:groups?\s*=>)\s*\[?\s*:?["']?(\w+)/;

/**
 * Parses `"name"[, "req"…][, options]` after a `gem` / `add_dependency` call whose method name ends at `pos`;
 * `end` is the end of the logical line. Returns undefined when the first argument is not a string literal.
 */
export function parseDeclaration(text: string, ix: LineIndex, pos: number, end: number, defaultGroup: string | undefined): DeclaredDep | undefined {
  let i = skipSpace(text, pos, end);
  if (text[i] === "(") i = skipSpace(text, i + 1, end);
  const nameEnd = literalEnd(text, i);
  if (nameEnd === undefined || nameEnd > end) return undefined;
  const name = text.slice(i + 1, nameEnd - 1);
  const nameRange = ix.range(i + 1, nameEnd - 1);
  i = nameEnd;

  const reqs: Array<{ start: number; end: number }> = [];
  for (;;) {
    const comma = skipSpace(text, i, end);
    if (text[comma] !== ",") break;
    const start = skipSpace(text, comma + 1, end);
    const stop = literalEnd(text, start);
    if (stop === undefined || stop > end) {
      i = comma + 1;
      break;
    }
    reqs.push({ start, end: stop });
    i = stop;
  }

  const options = withoutComments(text, i, end);
  const dep: DeclaredDep = { name, nameRange, kind: "unresolved" };
  const group = GROUP_OPTION.exec(options)?.[1] ?? defaultGroup;
  if (group !== undefined) dep.group = group;
  if (GIT_OPTION.test(options) || PATH_OPTION.test(options)) {
    dep.kind = GIT_OPTION.test(options) ? "git" : "path";
    return dep;
  }
  const first = reqs[0];
  const last = reqs[reqs.length - 1];
  if (!first || !last) return dep;
  dep.kind = "registry";
  dep.rawSpec = text.slice(first.start, last.end);
  dep.specRange = ix.range(first.start, last.end);
  dep.lowerBound = gemLowerBound(reqs.map((r) => text.slice(r.start + 1, r.end - 1)));
  return dep;
}

const GEM_CALL = /^\s*gem(?=[\s(])/;
const GROUP_BLOCK = /^\s*group\s+(.*?)\s+do\b/;
const BLOCK_OPEN = /^\s*(?:if|unless|case|begin|while|until)\b|\bdo(?:\s*\|[^|]*\|)?\s*$/;
const BLOCK_CLOSE = /^\s*end\b/;

/** Parses a Gemfile (or gems.rb). Never throws: lines it does not understand are skipped. */
export function parseGemfile(text: string): DeclaredDep[] {
  const ix = new LineIndex(text);
  const out: DeclaredDep[] = [];
  // One entry per open block; a group block carries its first group name, any other block undefined.
  const blocks: Array<string | undefined> = [];
  let pos = 0;
  while (pos < text.length) {
    let eol = text.indexOf("\n", pos);
    if (eol < 0) eol = text.length;
    const line = text.slice(pos, eol).replace(/\r$/, "");
    const code = line.replace(/\s#.*$/, "");
    const gem = GEM_CALL.exec(line);
    if (gem) {
      const end = statementEnd(text, pos);
      const group = [...blocks].reverse().find((g) => g !== undefined);
      const dep = parseDeclaration(text, ix, pos + gem[0].length, end, group);
      if (dep) out.push(dep);
      pos = end + 1;
      continue;
    }
    if (BLOCK_CLOSE.test(code)) blocks.pop();
    else if (BLOCK_OPEN.test(code)) {
      const g = GROUP_BLOCK.exec(code);
      blocks.push(g ? /:(\w+)|["'](\w+)["']/.exec(g[1]!)?.slice(1).find(Boolean) : undefined);
    }
    pos = eol + 1;
  }
  return out;
}
