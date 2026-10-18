import { ParseError } from "../ecosystems/types.js";

export interface XmlAttr {
  value: string;
  valueStart: number;
  valueEnd: number;
}

export interface XmlElement {
  /** Local name (namespace prefix removed). */
  name: string;
  attrs: Map<string, XmlAttr>;
  /** Offset of `<` of the start tag. */
  start: number;
  /** Offset just past the end tag (or self-closing `/>`). */
  end: number;
  /** Direct text content, decoded and trimmed. */
  text: string;
  /** Raw offsets of the trimmed text (first to last non-whitespace character of direct text). */
  textStart: number;
  textEnd: number;
  children: XmlElement[];
  parent?: XmlElement;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e.startsWith("#x")) return safeCodePoint(parseInt(e.slice(2), 16), m);
    if (e.startsWith("#")) return safeCodePoint(parseInt(e.slice(1), 10), m);
    return ENTITIES[e] ?? m;
  });
}

function safeCodePoint(n: number, fallback: string): string {
  try {
    return String.fromCodePoint(n);
  } catch {
    return fallback;
  }
}

function localName(n: string): string {
  const i = n.indexOf(":");
  return i >= 0 ? n.slice(i + 1) : n;
}

const NAME_END = /[\s/>=]/;
const WS = /\s/;

interface Building {
  el: XmlElement;
  rawName: string;
  textParts: string[];
  firstText: number;
  lastText: number;
}

/**
 * Minimal XML tokenizer producing an element tree whose offsets refer to the raw text.
 * Throws ParseError on unbalanced or unterminated markup.
 */
export function parseXml(text: string): XmlElement {
  const stack: Building[] = [];
  let root: XmlElement | undefined;
  let i = 0;
  const n = text.length;

  const fail = (msg: string, at: number): never => {
    throw new ParseError(`${msg} at offset ${at}`);
  };

  const addText = (raw: string, from: number, decoded: string): void => {
    const top = stack[stack.length - 1];
    if (!top) return;
    top.textParts.push(decoded);
    for (let k = 0; k < raw.length; k++) {
      if (!WS.test(raw[k]!)) {
        if (top.firstText < 0) top.firstText = from + k;
        break;
      }
    }
    for (let k = raw.length - 1; k >= 0; k--) {
      if (!WS.test(raw[k]!)) {
        top.lastText = Math.max(top.lastText, from + k + 1);
        break;
      }
    }
  };

  const finish = (b: Building, end: number): void => {
    b.el.end = end;
    b.el.text = b.textParts.join("").trim();
    if (b.firstText >= 0) {
      b.el.textStart = b.firstText;
      b.el.textEnd = b.lastText;
    }
  };

  const skipTo = (marker: string, from: number, what: string): number => {
    const j = text.indexOf(marker, from);
    if (j < 0) return fail(`Unterminated ${what}`, from);
    return j + marker.length;
  };

  while (i < n) {
    if (text[i] !== "<") {
      const j = text.indexOf("<", i);
      const stop = j < 0 ? n : j;
      const raw = text.slice(i, stop);
      if (stack.length === 0 && raw.trim() !== "") fail("Text outside root element", i);
      addText(raw, i, decode(raw));
      i = stop;
      continue;
    }
    if (text.startsWith("<!--", i)) {
      i = skipTo("-->", i + 4, "comment");
    } else if (text.startsWith("<![CDATA[", i)) {
      const close = text.indexOf("]]>", i + 9);
      if (close < 0) fail("Unterminated CDATA", i);
      if (stack.length === 0) fail("CDATA outside root element", i);
      const raw = text.slice(i + 9, close);
      addText(raw, i + 9, raw);
      i = close + 3;
    } else if (text.startsWith("<?", i)) {
      i = skipTo("?>", i + 2, "processing instruction");
    } else if (text.startsWith("<!", i)) {
      // DOCTYPE (possibly with an internal subset in brackets)
      let depth = 0;
      let j = i + 2;
      let quote = "";
      for (; j < n; j++) {
        const c = text[j]!;
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === ">" && depth <= 0) break;
      }
      if (j >= n) fail("Unterminated declaration", i);
      i = j + 1;
    } else if (text[i + 1] === "/") {
      const close = text.indexOf(">", i + 2);
      if (close < 0) fail("Unterminated end tag", i);
      const rawName = text.slice(i + 2, close).trim();
      const top = stack.pop();
      if (!top) return fail(`Unexpected end tag </${rawName}>`, i);
      if (top!.rawName !== rawName) fail(`Mismatched end tag </${rawName}>, expected </${top!.rawName}>`, i);
      finish(top!, close + 1);
      i = close + 1;
    } else {
      const start = i;
      let j = i + 1;
      while (j < n && !NAME_END.test(text[j]!)) j++;
      const rawName = text.slice(i + 1, j);
      if (!rawName) fail("Invalid tag", i);
      const el: XmlElement = {
        name: localName(rawName),
        attrs: new Map(),
        start,
        end: -1,
        text: "",
        textStart: -1,
        textEnd: -1,
        children: [],
      };
      let selfClosing = false;
      for (;;) {
        while (j < n && WS.test(text[j]!)) j++;
        if (j >= n) fail("Unterminated start tag", start);
        const c = text[j]!;
        if (c === ">") {
          j++;
          break;
        }
        if (c === "/") {
          if (text[j + 1] !== ">") fail("Invalid tag", j);
          selfClosing = true;
          j += 2;
          break;
        }
        const ns = j;
        while (j < n && !NAME_END.test(text[j]!)) j++;
        const attrName = text.slice(ns, j);
        if (!attrName) fail("Invalid attribute", j);
        while (j < n && WS.test(text[j]!)) j++;
        if (text[j] !== "=") fail("Attribute without value", j);
        j++;
        while (j < n && WS.test(text[j]!)) j++;
        const q = text[j];
        if (q !== '"' && q !== "'") fail("Unquoted attribute value", j);
        const vEnd = text.indexOf(q!, j + 1);
        if (vEnd < 0) fail("Unterminated attribute value", j);
        el.attrs.set(localName(attrName), {
          value: decode(text.slice(j + 1, vEnd)),
          valueStart: j + 1,
          valueEnd: vEnd,
        });
        j = vEnd + 1;
      }
      const parent = stack[stack.length - 1];
      if (parent) {
        el.parent = parent.el;
        parent.el.children.push(el);
      } else if (root) {
        fail("Multiple root elements", start);
      } else {
        root = el;
      }
      const b: Building = { el, rawName, textParts: [], firstText: -1, lastText: -1 };
      if (selfClosing) finish(b, j);
      else stack.push(b);
      i = j;
    }
  }
  if (stack.length > 0) fail(`Unclosed element <${stack[stack.length - 1]!.rawName}>`, n);
  if (!root) throw new ParseError("No root element");
  return root;
}

export function childrenNamed(el: XmlElement, name: string): XmlElement[] {
  return el.children.filter((c) => c.name === name);
}

export function childText(el: XmlElement, name: string): XmlElement | undefined {
  return el.children.find((c) => c.name === name);
}
