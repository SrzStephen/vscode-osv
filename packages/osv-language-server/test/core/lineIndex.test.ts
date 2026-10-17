import { describe, expect, it } from "vitest";
import { LineIndex } from "../../src/core/lineIndex.js";

describe("LineIndex", () => {
  it("maps offsets on LF text", () => {
    const ix = new LineIndex("ab\ncd");
    expect(ix.position(0)).toEqual({ line: 0, character: 0 });
    expect(ix.position(3)).toEqual({ line: 1, character: 0 });
    expect(ix.position(4)).toEqual({ line: 1, character: 1 });
  });

  it("handles CRLF", () => {
    const ix = new LineIndex("a\r\nbc\r\nd");
    expect(ix.position(3)).toEqual({ line: 1, character: 0 });
    expect(ix.position(5)).toEqual({ line: 1, character: 2 });
    expect(ix.offset({ line: 2, character: 0 })).toBe(7);
  });

  it("handles a BOM as character 0 of line 0", () => {
    expect(new LineIndex("﻿{}").position(1)).toEqual({ line: 0, character: 1 });
  });

  it("builds ranges and round-trips offsets", () => {
    const ix = new LineIndex("ab\ncd");
    expect(ix.range(1, 4)).toEqual({
      start: { line: 0, character: 1 },
      end: { line: 1, character: 1 },
    });
    expect(ix.offset({ line: 1, character: 1 })).toBe(4);
  });

  it("handles an empty string and a trailing newline", () => {
    expect(new LineIndex("").position(0)).toEqual({ line: 0, character: 0 });
    expect(new LineIndex("a\n").position(2)).toEqual({ line: 1, character: 0 });
  });
});
