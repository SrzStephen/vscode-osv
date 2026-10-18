import type { Comparator } from "./types.js";

// Port of Maven's ComparableVersion.
type Item = number | string | Item[];

const QUALIFIERS = ["alpha", "beta", "milestone", "rc", "snapshot", "", "sp"];
const ALIASES: Record<string, string> = {
  ga: "",
  final: "",
  release: "",
  cr: "rc",
};

function qualifierKey(q: string): string {
  const i = QUALIFIERS.indexOf(q);
  return i === -1 ? `${QUALIFIERS.length}-${q}` : String(i);
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isNull(item: Item): boolean {
  if (typeof item === "number") return item === 0;
  if (typeof item === "string") return item === "";
  return item.length === 0;
}

function parseItem(isDigit: boolean, s: string): Item {
  if (isDigit) return Number(s);
  return s;
}

function stringItem(s: string, followedByDigit: boolean): string {
  if (followedByDigit && s.length === 1) {
    if (s === "a") s = "alpha";
    else if (s === "b") s = "beta";
    else if (s === "m") s = "milestone";
  }
  return ALIASES[s] ?? s;
}

function normalizeList(list: Item[]): void {
  for (let i = list.length - 1; i >= 0; i--) {
    const last = list[i];
    if (last === undefined) continue;
    if (isNull(last)) list.splice(i, 1);
    else if (!Array.isArray(last)) break;
  }
}

function parse(version: string): Item[] {
  const v = version.trim().toLowerCase();
  const root: Item[] = [];
  let list = root;
  const stack: Item[][] = [root];
  let isDigit = false;
  let start = 0;

  const add = (end: number, followedByDigit: boolean): void => {
    const s = v.slice(start, end);
    list.push(isDigit ? parseItem(true, s) : stringItem(s, followedByDigit));
  };

  for (let i = 0; i < v.length; i++) {
    const c = v[i]!;
    if (c === ".") {
      if (i === start) list.push(0);
      else add(i, false);
      start = i + 1;
    } else if (c === "-") {
      if (i === start) list.push(0);
      else add(i, false);
      start = i + 1;
      const sub: Item[] = [];
      list.push(sub);
      list = sub;
      stack.push(list);
    } else if (c >= "0" && c <= "9") {
      if (!isDigit && i > start) {
        add(i, true);
        start = i;
        const sub: Item[] = [];
        list.push(sub);
        list = sub;
        stack.push(list);
      }
      isDigit = true;
    } else {
      if (isDigit && i > start) {
        add(i, false);
        start = i;
        const sub: Item[] = [];
        list.push(sub);
        list = sub;
        stack.push(list);
      }
      isDigit = false;
    }
  }
  if (v.length > start) add(v.length, false);

  while (stack.length > 0) normalizeList(stack.pop()!);
  return root;
}

function compareItems(a: Item | null, b: Item | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return -compareItems(b, null);
  if (typeof a === "number") {
    if (b === null) return a === 0 ? 0 : 1;
    if (typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
    return 1; // number > string, number > list
  }
  if (typeof a === "string") {
    if (b === null) return cmpStr(qualifierKey(a), qualifierKey(""));
    if (typeof b === "number") return -1;
    if (typeof b === "string") return cmpStr(qualifierKey(a), qualifierKey(b));
    return -1; // string < list
  }
  // a is a list
  if (b === null) {
    if (a.length === 0) return 0;
    return compareItems(a[0]!, null);
  }
  if (typeof b === "number") return -1;
  if (typeof b === "string") return 1;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const r = compareItems(a[i] ?? null, b[i] ?? null);
    if (r !== 0) return r;
  }
  return 0;
}

export const mavenComparator: Comparator = {
  isValid: (v) => /^\d/.test(v.trim()),
  compare: (a, b) => compareItems(parse(a), parse(b)),
  normalize: (v) => v.trim(),
  major: (v) => {
    const m = /^\d+/.exec(v.trim());
    return m ? Number(m[0]) : NaN;
  },
};
