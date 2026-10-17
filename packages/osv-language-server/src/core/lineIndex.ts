import type { Position, TextRange } from "./types.js";

/** Maps between UTF-16 string offsets and line/character positions. */
export class LineIndex {
  private readonly lineStarts: number[] = [0];

  constructor(text: string) {
    for (let i = 0; i < text.length; i++) {
      // A "\r\n" terminator is covered too: "\r" stays at the end of its line.
      if (text.charCodeAt(i) === 10) this.lineStarts.push(i + 1);
    }
  }

  position(offset: number): Position {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo, character: offset - this.lineStarts[lo]! };
  }

  range(start: number, end: number): TextRange {
    return { start: this.position(start), end: this.position(end) };
  }

  offset(pos: Position): number {
    return (this.lineStarts[pos.line] ?? 0) + pos.character;
  }
}
