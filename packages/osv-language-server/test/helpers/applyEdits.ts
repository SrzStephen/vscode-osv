import { LineIndex } from "../../src/core/lineIndex.js";
import type { TextEditSpec } from "../../src/core/types.js";

/** Applies edits (all expressed against the original text) back to front. */
export function applyEdits(text: string, edits: TextEditSpec[]): string {
  const ix = new LineIndex(text);
  const spans = edits
    .map((e) => ({ start: ix.offset(e.range.start), end: ix.offset(e.range.end), newText: e.newText }))
    .sort((a, b) => b.start - a.start);
  let out = text;
  for (const s of spans) out = out.slice(0, s.start) + s.newText + out.slice(s.end);
  return out;
}
