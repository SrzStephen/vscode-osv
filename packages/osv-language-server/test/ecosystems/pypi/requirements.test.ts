import { describe, expect, it } from "vitest";
import { parseRequirementsTxt } from "../../../src/ecosystems/pypi/requirements.js";
import { textAt } from "../../helpers/textAt.js";

describe("parseRequirementsTxt", () => {
  it("parses names, extras, markers, URLs, CRLF", () => {
    const deps = parseRequirementsTxt("Requests[security]>=2.0,<3 ; python_version>'3.8'  # c\r\n-r base.txt\r\nflask==2.0.1 \\\r\n  --hash=sha256:abc\r\npkg @ git+https://x/y.git\r\n");
    expect(deps.map(d => [d.name, d.rawSpec, d.lowerBound, d.kind])).toEqual([["requests", ">=2.0,<3", "2.0", "registry"], ["flask", "==2.0.1", "2.0.1", "registry"], ["pkg", undefined, undefined, "git"]]);
    expect(deps[1]!.specRange).toEqual({ start: { line: 2, character: 5 }, end: { line: 2, character: 12 } });
  });

  it("maps ranges across continuation lines back to the original text", () => {
    const text = "django\\\n>=3.2\n";
    const [d] = parseRequirementsTxt(text);
    expect(textAt(text, d!.nameRange)).toBe("django");
    expect(textAt(text, d!.specRange!)).toBe(">=3.2");
    expect(d!.rawSpec).toBe(">=3.2");
  });

  it("skips options, comments and blank lines but keeps '#' inside URLs", () => {
    const text = "# top\n\n-e .\n--index-url https://i/simple\n-c cons.txt\npkg @ https://x/y.whl#sha256=ab\nA_b.c ==1.0 # note\n";
    const deps = parseRequirementsTxt(text);
    expect(deps.map(d => [d.name, d.kind, d.rawSpec])).toEqual([["pkg", "url", undefined], ["a-b-c", "registry", "==1.0"]]);
  });

  it("marks specs without a lower bound as unresolved", () => {
    const [d] = parseRequirementsTxt("pkg<3\n");
    expect(d).toMatchObject({ name: "pkg", rawSpec: "<3", kind: "unresolved" });
    expect(d!.lowerBound).toBeUndefined();
  });
});
