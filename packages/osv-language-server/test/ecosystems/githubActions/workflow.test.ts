import { describe, expect, it } from "vitest";
import { parseWorkflow } from "../../../src/ecosystems/githubActions/workflow.js";
import { ParseError } from "../../../src/ecosystems/types.js";
import { textAt } from "../../helpers/textAt.js";

describe("parseWorkflow", () => {
  it("collects uses with ref ranges; skips SHAs, local, docker, branches", () => {
    const text = "jobs:\n  b:\n    steps:\n      - uses: actions/checkout@v4\n      - uses: tj-actions/changed-files@v45\n      - uses: actions/setup-node@8f4b7f84864484a7bf31766abe9204da3cbe65b3 # v4.1.1\n      - uses: ./local\n      - uses: docker://alpine:3\n      - uses: org/repo/sub/path@main\n  r:\n    uses: org/shared/.github/workflows/ci.yml@v1.2\n";
    expect(parseWorkflow(text).map((d) => [d.name, d.rawSpec, d.group])).toEqual([["actions/checkout", "v4", "b"], ["tj-actions/changed-files", "v45", "b"], ["org/shared", "v1.2", "r"]]);
    expect(textAt(text, parseWorkflow(text)[1]!.specRange!)).toBe("v45");
  });

  it("fills kind, lowerBound and name range", () => {
    const text = "jobs:\n  b:\n    steps:\n      - uses: actions/checkout@v4.1\n";
    const [d] = parseWorkflow(text);
    expect(d).toMatchObject({ kind: "registry", lowerBound: "4.1", rawSpec: "v4.1" });
    expect(textAt(text, d!.nameRange)).toBe("actions/checkout");
    expect(textAt(text, d!.specRange!)).toBe("v4.1");
  });

  it("skips a 40-hex SHA with a trailing version comment, and branch refs", () => {
    const sha = "0e58ed8671d6b60d0890c21b07f8835ace038e67";
    const text = `jobs:\n  b:\n    steps:\n      - uses: tj-actions/changed-files@${sha} # v4.1.1\n      - uses: a/b@main\n      - uses: a/c@abc1234\n      - uses: a/d@v4-beta\n      - uses: a/e@release/v1\n`;
    expect(parseWorkflow(text)).toEqual([]);
  });

  it("locates refs in quoted values", () => {
    const text = 'jobs:\n  b:\n    steps:\n      - uses: "actions/cache@v3"\n';
    const [d] = parseWorkflow(text);
    expect(textAt(text, d!.specRange!)).toBe("v3");
    expect(textAt(text, d!.nameRange)).toBe("actions/cache");
  });

  it("reads composite action steps", () => {
    const text = "name: x\nruns:\n  using: composite\n  steps:\n    - uses: actions/checkout@v3\n    - run: echo hi\n";
    expect(parseWorkflow(text).map((d) => [d.name, d.rawSpec, d.group])).toEqual([["actions/checkout", "v3", "composite"]]);
  });

  it("returns nothing for documents without uses", () => {
    expect(parseWorkflow("")).toEqual([]);
    expect(parseWorkflow("on: push\njobs:\n  b:\n    steps:\n      - run: ls\n")).toEqual([]);
  });

  it("throws ParseError on YAML syntax errors", () => {
    expect(() => parseWorkflow("jobs:\n  b: [\n")).toThrow(ParseError);
  });
});
