import { describe, expect, it } from "vitest";
import { setJsonProperty } from "../../src/ecosystems/jsonEdit.js";
import { applyEdits } from "../helpers/applyEdits.js";

describe("setJsonProperty", () => {
  it("adds a nested property preserving 4-space indent", () => {
    const text = '{\n    "name": "a"\n}\n';
    expect(applyEdits(text, setJsonProperty(text, ["overrides", "qs"], "6.10.3", "u"))).toBe(
      '{\n    "name": "a",\n    "overrides": {\n        "qs": "6.10.3"\n    }\n}\n',
    );
  });

  it("replaces an existing value in place with 2-space default and CRLF", () => {
    const text = '{\r\n  "dependencies": {\r\n    "qs": "1.0.0"\r\n  }\r\n}\r\n';
    expect(applyEdits(text, setJsonProperty(text, ["dependencies", "qs"], "2.0.0", "u"))).toBe(
      '{\r\n  "dependencies": {\r\n    "qs": "2.0.0"\r\n  }\r\n}\r\n',
    );
  });

  it("stamps the uri on every edit", () => {
    const edits = setJsonProperty("{}", ["a"], 1, "file:///p.json");
    expect(edits.length).toBeGreaterThan(0);
    expect(edits.every((e) => e.uri === "file:///p.json")).toBe(true);
  });
});
