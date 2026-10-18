import { describe, expect, it } from "vitest";
import pkg from "../../package.json";
import { USER_AGENT } from "../../src/core/userAgent.js";

describe("USER_AGENT", () => {
  it("is osv-language-server/<version> from package.json", () => {
    expect(USER_AGENT).toMatch(/^osv-language-server\/\d+\.\d+\.\d+/);
    expect(USER_AGENT).toBe(`osv-language-server/${pkg.version}`);
  });
});
