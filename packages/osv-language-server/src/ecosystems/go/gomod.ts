import { LineIndex } from "../../core/lineIndex.js";
import type { DeclaredDep, TextRange } from "../../core/types.js";
import { semverComparator } from "../../versioning/semver.js";
import type { Comparator } from "../../versioning/types.js";

/** Go versions are semver with a leading `v`; `+incompatible` is build metadata and pseudo-versions are prereleases. */
const normalizeGo = (v: string): string => semverComparator.normalize(v).replace(/\+incompatible$/, "");

export const goComparator: Comparator = {
  ...semverComparator,
  isValid: (v) => semverComparator.isValid(normalizeGo(v)),
  compare: (a, b) => semverComparator.compare(normalizeGo(a), normalizeGo(b)),
  normalize: normalizeGo,
  major: (v) => semverComparator.major(normalizeGo(v)),
};

interface Token {
  text: string;
  start: number;
  end: number;
}

interface Require {
  path: Token;
  version: Token;
  indirect: boolean;
}

interface Replace {
  oldPath: string;
  oldVersion: string | undefined;
  local: boolean;
  newPath: Token;
  newVersion: Token | undefined;
}

const TOKEN = /"[^"]*"|`[^`]*`|=>|[^\s]+/g;

function tokenize(line: string, base: number): Token[] {
  const tokens: Token[] = [];
  for (const m of line.matchAll(TOKEN)) {
    const raw = m[0];
    const quoted = raw.length >= 2 && (raw[0] === '"' || raw[0] === "`") && raw[raw.length - 1] === raw[0];
    const start = base + m.index! + (quoted ? 1 : 0);
    const text = quoted ? raw.slice(1, -1) : raw;
    tokens.push({ text, start, end: start + text.length });
  }
  return tokens;
}

/** Splits a line at its `//` comment, ignoring `//` inside quotes. */
function splitComment(line: string): { code: string; comment: string } {
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "`") quote = c;
    else if (c === "/" && line[i + 1] === "/") return { code: line.slice(0, i), comment: line.slice(i + 2) };
  }
  return { code: line, comment: "" };
}

const isLocalPath = (p: string): boolean => /^(\.\.?(\/|\\|$)|\/|[A-Za-z]:[\\/])/.test(p);

/** `require` and `replace` directives of a go.mod; replaced modules are reported under the replacement path and version. */
export function parseGoMod(text: string): DeclaredDep[] {
  const ix = new LineIndex(text);
  const requires: Require[] = [];
  const replaces: Replace[] = [];
  let block: string | undefined;
  let at = 0;

  const handle = (directive: string, args: Token[], comment: string): void => {
    if (directive === "require") {
      const [path, version] = args;
      if (path && version) requires.push({ path, version, indirect: /^\s*indirect\b/.test(comment) });
    } else if (directive === "replace") {
      const arrow = args.findIndex((t) => t.text === "=>");
      if (arrow < 1) return;
      const left = args.slice(0, arrow);
      const right = args.slice(arrow + 1);
      const [oldPath, oldVersion] = left;
      const [newPath, newVersion] = right;
      if (!oldPath || !newPath) return;
      replaces.push({
        oldPath: oldPath.text,
        oldVersion: oldVersion?.text,
        local: isLocalPath(newPath.text) || newVersion === undefined,
        newPath,
        newVersion,
      });
    }
  };

  for (const rawLine of text.split("\n")) {
    const lineStart = at;
    at += rawLine.length + 1;
    const { code, comment } = splitComment(rawLine);
    const tokens = tokenize(code, lineStart);
    if (tokens.length === 0) continue;
    if (block !== undefined) {
      if (tokens[0]!.text === ")") block = undefined;
      else handle(block, tokens, comment);
      continue;
    }
    const directive = tokens[0]!.text;
    if (tokens[1]?.text === "(") block = directive;
    else handle(directive, tokens.slice(1), comment);
  }

  const range = (t: Token): TextRange => ix.range(t.start, t.end);
  const deps: DeclaredDep[] = [];
  for (const req of requires) {
    const name = req.path.text;
    const version = req.version.text;
    const group = req.indirect ? "indirect" : "require";
    const rep =
      replaces.find((r) => r.oldPath === name && r.oldVersion === version) ??
      replaces.find((r) => r.oldPath === name && r.oldVersion === undefined);
    if (rep?.local) continue;
    if (rep?.newVersion) {
      const specRange = range(rep.newVersion);
      deps.push({
        name: rep.newPath.text,
        rawSpec: rep.newVersion.text,
        nameRange: range(rep.newPath),
        specRange,
        lowerBound: rep.newVersion.text,
        kind: "registry",
        group,
        specLocation: { path: "", range: specRange, rawSpec: rep.newVersion.text },
      });
      continue;
    }
    deps.push({
      name,
      rawSpec: version,
      nameRange: range(req.path),
      specRange: range(req.version),
      lowerBound: version,
      kind: "registry",
      group,
    });
  }
  return deps;
}
