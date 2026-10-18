import { describe, expect, it } from "vitest";
import { ParseError } from "../../../src/ecosystems/types.js";
import { parsePyproject } from "../../../src/ecosystems/pypi/pyproject.js";
import { rewritePoetrySpec } from "../../../src/ecosystems/pypi/rewrite.js";
import { read } from "../../helpers/pypiFixture.js";
import { textAt } from "../../helpers/textAt.js";

const names = (deps: ReturnType<typeof parsePyproject>) => deps.map((d) => [d.name, d.group, d.lowerBound]);

describe("parsePyproject", () => {
  it("PEP 621 + optional + dependency-groups + uv dev", () => expect(names(parsePyproject(read("pep621.toml")))).toEqual([["requests", "dependencies", "2.25.0"], ["pytest", "test", "7.0"], ["ruff", "dev", "0.1.0"], ["black", "uv-dev", "22.1.0"]]));
  it("Poetry string, table, group, git; skips python", () => expect(names(parsePyproject(read("poetry.toml")))).toEqual([["flask", "dependencies", "2.0.0"], ["django", "dependencies", "3.2"], ["mylib", "dependencies", undefined /* git */], ["pytest", "group.test", "6.0"]]));
  it("specRange points inside the TOML string", () => {
    const t = '[project]\ndependencies = ["requests>=2.0"]\n';
    const [d] = parsePyproject(t);
    expect(textAt(t, d!.specRange!)).toBe(">=2.0");
    expect(textAt(t, d!.nameRange)).toBe("requests");
  });
  it("Poetry ranges cover the spec string content", () => {
    const t = '[tool.poetry.dependencies]\nflask = "^2.0.0"\ndjango = { version = "~3.2" }\n';
    const deps = parsePyproject(t);
    expect(deps.map((d) => [textAt(t, d.nameRange), textAt(t, d.specRange!)])).toEqual([["flask", "^2.0.0"], ["django", "~3.2"]]);
  });
  it("marks Poetry git deps and wildcard specs", () => {
    const deps = parsePyproject('[tool.poetry.dependencies]\na = {git = "https://x/a.git"}\nb = "*"\n');
    expect(deps.map((d) => [d.name, d.kind])).toEqual([["a", "git"], ["b", "unresolved"]]);
  });
  it("throws ParseError on invalid TOML", () => expect(() => parsePyproject("[project\n")).toThrow(ParseError));
});

describe("rewritePoetrySpec", () => {
  it.each([["^2.0", "2.3.1", "^2.3.1"], ["~1.4", "1.6.0", "~1.6.0"], ["2.0", "2.3.1", "2.3.1"], [">=1.0", "2.0", ">=2.0"], ["==1.0", "1.1", "==1.1"]])("poetry rewrite %s", (raw, t, spec) => expect(rewritePoetrySpec(raw, t).spec).toBe(spec));
  it("flags a caret target outside the old cap as widened", () => {
    expect(rewritePoetrySpec("^1.2", "2.0.0").widened).toBe(true);
    expect(rewritePoetrySpec("^1.2", "1.9.0").widened).toBe(false);
  });
  it("delegates comma ranges to PEP 440 rewriting", () => expect(rewritePoetrySpec(">=1.0,<2.0", "2.5").spec).toBe(">=2.5"));
});
