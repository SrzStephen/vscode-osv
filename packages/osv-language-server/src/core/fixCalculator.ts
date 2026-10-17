import type { Comparator } from "../versioning/types.js";
import type { FixResult, OsvEvent, OsvRecord } from "./types.js";

interface Interval {
  start: string;
  /** Exclusive end. */
  fixed?: string;
  /** Inclusive end. */
  lastAffected?: string;
}

type NormalizeName = (n: string) => string;

function eventVersion(e: OsvEvent): string | undefined {
  if ("introduced" in e) return e.introduced;
  if ("fixed" in e) return e.fixed;
  if ("last_affected" in e) return e.last_affected;
  return undefined;
}

function recordIntervals(record: OsvRecord, ecosystem: string, name: string, cmp: Comparator, normalizeName: NormalizeName): Interval[] {
  const out: Interval[] = [];
  const target = normalizeName(name);
  for (const aff of record.affected ?? []) {
    if (aff.package?.ecosystem !== ecosystem || normalizeName(aff.package.name) !== target) continue;
    const ranges = (aff.ranges ?? []).filter((r) => r.type === "SEMVER" || r.type === "ECOSYSTEM");
    if (ranges.length === 0) {
      for (const v of aff.versions ?? []) if (cmp.isValid(v)) out.push({ start: v, lastAffected: v });
      continue;
    }
    for (const r of ranges) {
      const events = r.events
        .filter((e) => !("limit" in e))
        .map((e) => ({ e, v: eventVersion(e) }))
        .filter((x): x is { e: OsvEvent; v: string } => x.v !== undefined && (x.v === "0" || cmp.isValid(x.v)));
      events.sort((a, b) => {
        const byVersion = a.v === b.v ? 0 : a.v === "0" ? -1 : b.v === "0" ? 1 : cmp.compare(a.v, b.v);
        if (byVersion !== 0) return byVersion;
        return Number("introduced" in b.e) - Number("introduced" in a.e);
      });
      let open: string | undefined;
      for (const { e, v } of events) {
        if ("introduced" in e) open ??= v;
        else if (open !== undefined && "fixed" in e) {
          out.push({ start: open, fixed: v });
          open = undefined;
        } else if (open !== undefined && "last_affected" in e) {
          out.push({ start: open, lastAffected: v });
          open = undefined;
        }
      }
      if (open !== undefined) out.push({ start: open });
    }
  }
  return out;
}

function contains(iv: Interval, v: string, cmp: Comparator): boolean {
  if (iv.start !== "0" && cmp.compare(v, iv.start) < 0) return false;
  if (iv.fixed) return cmp.compare(v, iv.fixed) < 0;
  if (iv.lastAffected) return cmp.compare(v, iv.lastAffected) <= 0;
  return true;
}

export function isAffected(
  records: OsvRecord[],
  ecosystem: string,
  name: string,
  version: string,
  cmp: Comparator,
  normalizeName: NormalizeName,
): boolean {
  if (!cmp.isValid(version)) return false;
  return records.some((r) => recordIntervals(r, ecosystem, name, cmp, normalizeName).some((iv) => contains(iv, version, cmp)));
}

export function calculateFix(
  records: OsvRecord[],
  ecosystem: string,
  name: string,
  current: string,
  cmp: Comparator,
  normalizeName: NormalizeName,
): FixResult {
  const fail = (reason: NonNullable<FixResult["reason"]>): FixResult => ({ target: undefined, fixesAll: false, crossesMajor: false, reason });
  if (!cmp.isValid(current)) return fail("unparseable-version");

  const all = records.map((r) => recordIntervals(r, ecosystem, name, cmp, normalizeName));
  const fixPoints: string[] = [];
  for (const intervals of all) {
    const iv = intervals.find((i) => contains(i, current, cmp));
    if (iv) {
      if (!iv.fixed) return fail("no-fixed-event");
      fixPoints.push(iv.fixed);
      continue;
    }
    let lowest: string | undefined;
    for (const i of intervals) {
      if (i.fixed && cmp.compare(i.fixed, current) > 0 && (lowest === undefined || cmp.compare(i.fixed, lowest) < 0)) lowest = i.fixed;
    }
    if (lowest === undefined) return fail("no-matching-range");
    fixPoints.push(lowest);
  }
  if (fixPoints.length === 0) return { target: undefined, fixesAll: true, crossesMajor: false };

  let candidate = fixPoints.reduce((a, b) => (cmp.compare(b, a) > 0 ? b : a));
  const flat = all.flat();
  for (let hit = flat.find((i) => contains(i, candidate, cmp)); hit; hit = flat.find((i) => contains(i, candidate, cmp))) {
    if (!hit.fixed) return fail("no-fixed-event");
    candidate = hit.fixed;
  }
  return { target: candidate, fixesAll: true, crossesMajor: cmp.major(candidate) > cmp.major(current) };
}
