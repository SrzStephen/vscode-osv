import { describe, expect, it } from "vitest";
import { trustHover } from "../../src/hoverTrust.js";

const TRUSTED = { enabledCommands: ["osv.update", "osv.ignore"] };
const call = (hover: unknown) => trustHover({} as never, {} as never, {} as never, async () => hover as never);

describe("trustHover", () => {
  it("trusts only osv.update and osv.ignore on every MarkdownString", async () => {
    const a: { value: string; isTrusted?: unknown } = { value: "a" };
    const b: { value: string; isTrusted?: unknown } = { value: "b", isTrusted: true };
    const hover = { contents: [a, b, "plain string"] };
    expect(await call(hover)).toBe(hover);
    expect(a.isTrusted).toEqual(TRUSTED);
    expect(b.isTrusted).toEqual(TRUSTED);
  });

  it("handles a single (non-array) contents value", async () => {
    const md: { value: string; isTrusted?: unknown } = { value: "x" };
    await call({ contents: md });
    expect(md.isTrusted).toEqual(TRUSTED);
  });

  it("passes through null", async () => {
    expect(await call(null)).toBeNull();
  });
});
