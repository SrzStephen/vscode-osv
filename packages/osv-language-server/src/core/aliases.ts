import { maxSeverity, severityOf, severityRank } from "./severity.js";
import type { OsvRecord, Severity, Vuln } from "./types.js";

/** GHSA > ecosystem-native (PYSEC-, RUSTSEC-, GO-, ...) > CVE > others. */
function idPriority(id: string): number {
  if (id.startsWith("GHSA-")) return 0;
  if (id.startsWith("CVE-")) return 2;
  if (/^[A-Z]+(-[A-Z]+)*-\d/.test(id)) return 1;
  return 3;
}

function compareIds(a: string, b: string): number {
  return idPriority(a) - idPriority(b) || (a < b ? -1 : a > b ? 1 : 0);
}

export function mergeAliases(records: OsvRecord[]): Vuln[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(x, root);
    return root;
  };
  const add = (x: string): void => {
    if (!parent.has(x)) parent.set(x, x);
  };
  for (const r of records) {
    add(r.id);
    for (const a of r.aliases ?? []) {
      add(a);
      parent.set(find(a), find(r.id));
    }
  }

  const groups = new Map<string, OsvRecord[]>();
  for (const r of records) {
    const root = find(r.id);
    const list = groups.get(root);
    if (list) list.push(r);
    else groups.set(root, [r]);
  }

  const vulns: Vuln[] = [];
  for (const group of groups.values()) {
    const ids = new Set<string>();
    for (const r of group) {
      ids.add(r.id);
      for (const a of r.aliases ?? []) ids.add(a);
    }
    const preferred = group.map((r) => r.id).sort(compareIds)[0]!;
    const preferredRecord = group.find((r) => r.id === preferred)!;
    const severities: Severity[] = group.map(severityOf);
    vulns.push({
      id: preferred,
      aliases: [...ids].filter((i) => i !== preferred).sort(),
      summary: preferredRecord.summary || group.find((r) => r.summary)?.summary || "",
      severity: maxSeverity(severities),
      modified: group.map((r) => r.modified).reduce((a, b) => (b > a ? b : a)),
    });
  }
  return vulns.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
