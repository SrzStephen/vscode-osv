import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { calculateFix, isAffected } from "../../src/core/fixCalculator.js";
import type { FixResult, OsvEvent, OsvRecord } from "../../src/core/types.js";
import { semverComparator } from "../../src/versioning/semver.js";

const id = (n: string) => n;

function load(...ids: string[]): OsvRecord[] {
  return ids.map((i) => JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "osv", `${i}.json`), "utf8")) as OsvRecord);
}

function range(...events: OsvEvent[]): OsvRecord {
  return {
    id: "TEST-1",
    modified: "2024-01-01T00:00:00Z",
    affected: [{ package: { ecosystem: "npm", name: "pkg" }, ranges: [{ type: "SEMVER", events }] }],
  };
}

function gitRange(): OsvRecord {
  return {
    id: "TEST-GIT",
    modified: "2024-01-01T00:00:00Z",
    affected: [{ package: { ecosystem: "npm", name: "pkg" }, ranges: [{ type: "GIT", events: [{ introduced: "0" }, { fixed: "abc123" }] }] }],
  };
}

function calc(first: OsvRecord[] | OsvRecord, current: string, second?: OsvRecord[] | OsvRecord): FixResult {
  const records = [first, ...(second ? [second] : [])].flat();
  return calculateFix(records, "npm", "pkg", current, semverComparator, id);
}

describe("calculateFix", () => {
  it("lodash 4.17.15 with three real records → 4.17.21", () =>
    expect(
      calculateFix(load("GHSA-p6mc-m468-83gw", "GHSA-29mw-wpgm-hmr9", "GHSA-35jh-r3h4-6jhm"), "npm", "lodash", "4.17.15", semverComparator, id).target,
    ).toBe("4.17.21"));
  it("backport: picks the fix in the current branch", () =>
    expect(calc(range({ introduced: "0" }, { fixed: "1.2.5" }, { introduced: "2.0.0" }, { fixed: "2.1.0" }), "1.2.0").target).toBe("1.2.5"));
  it("last_affected only → no fix", () =>
    expect(calc(range({ introduced: "0" }, { last_affected: "1.9.0" }), "1.0.0")).toMatchObject({ target: undefined, reason: "no-fixed-event" }));
  it("target itself affected by another record → advances", () =>
    expect(calc(range({ introduced: "0" }, { fixed: "1.5.0" }), "1.0.0", range({ introduced: "1.5.0" }, { fixed: "1.6.0" })).target).toBe("1.6.0"));
  it("flags major upgrades", () => expect(calc(range({ introduced: "0" }, { fixed: "2.0.0" }), "1.4.0").crossesMajor).toBe(true));
  it("ignores GIT ranges and other packages", () => expect(calc(gitRange(), "1.0.0").reason).toBe("no-matching-range"));
  it("unparseable current", () => expect(calc(range({ introduced: "0" }, { fixed: "1.0.0" }), "not-a-version").reason).toBe("unparseable-version"));
  it("no records → no target, fixes all", () => expect(calc([], "1.0.0")).toEqual({ target: undefined, fixesAll: true, crossesMajor: false }));
  it("point versions without ranges have no fix", () =>
    expect(
      calc({ id: "TEST-V", modified: "2024-01-01T00:00:00Z", affected: [{ package: { ecosystem: "npm", name: "pkg" }, versions: ["1.0.0"] }] }, "1.0.0"),
    ).toMatchObject({ target: undefined, reason: "no-fixed-event" }));
  it("skips unparseable event versions", () =>
    expect(calc(range({ introduced: "0" }, { fixed: "garbage" }, { fixed: "1.1.0" }), "1.0.0").target).toBe("1.1.0"));
  it("sorts out-of-order events", () => expect(calc(range({ fixed: "1.1.0" }, { introduced: "0" }), "1.0.0").target).toBe("1.1.0"));
});

describe("isAffected", () => {
  it("is false at the fixed version", () =>
    expect(isAffected(load("GHSA-29mw-wpgm-hmr9"), "npm", "lodash", "4.17.21", semverComparator, id)).toBe(false));
  it("is true below the fixed version", () =>
    expect(isAffected(load("GHSA-29mw-wpgm-hmr9"), "npm", "lodash", "4.17.20", semverComparator, id)).toBe(true));
  it("includes the last_affected version", () =>
    expect(isAffected([range({ introduced: "0" }, { last_affected: "1.9.0" })], "npm", "pkg", "1.9.0", semverComparator, id)).toBe(true));
});
