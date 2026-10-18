import { describe, expect, it } from "vitest";
import { childrenNamed, childText, parseXml } from "../../src/core/xml.js";
import { ParseError } from "../../src/ecosystems/types.js";

describe("parseXml", () => {
  it("gives attribute value offsets into raw text", () => {
    const t = `<Project><PackageReference Include="A" Version='1.2.3'/></Project>`;
    const root = parseXml(t);
    const pr = root.children[0]!;
    expect(pr.name).toBe("PackageReference");
    const v = pr.attrs.get("Version")!;
    expect(v.value).toBe("1.2.3");
    expect(t.slice(v.valueStart, v.valueEnd)).toBe("1.2.3");
    const i = pr.attrs.get("Include")!;
    expect(t.slice(i.valueStart, i.valueEnd)).toBe("A");
    expect(t.slice(pr.start, pr.end)).toBe(`<PackageReference Include="A" Version='1.2.3'/>`);
  });

  it("trims text and keeps offsets of the trimmed text", () => {
    const t = `<a>\n  <version>  1.0  </version>\n</a>`;
    const v = childText(parseXml(t), "version")!;
    expect(v.text).toBe("1.0");
    expect(t.slice(v.textStart, v.textEnd)).toBe("1.0");
  });

  it("ignores tags inside comments, handles CDATA, PI and DOCTYPE", () => {
    const t = `<?xml version="1.0"?><!DOCTYPE x [<!ELEMENT x ANY>]><!-- <fake> --><x><!-- <y/> --><![CDATA[<z>]]></x>`;
    const root = parseXml(t);
    expect(root.name).toBe("x");
    expect(root.children).toHaveLength(0);
    expect(root.text).toBe("<z>");
  });

  it("strips namespace prefix and decodes entities with raw offsets", () => {
    const t = `<m:a m:k="x&amp;y"><m:b/></m:a>`;
    const root = parseXml(t);
    expect(root.name).toBe("a");
    const k = root.attrs.get("k")!;
    expect(k.value).toBe("x&y");
    expect(t.slice(k.valueStart, k.valueEnd)).toBe("x&amp;y");
    expect(root.children[0]!.parent).toBe(root);
  });

  it("handles CRLF", () => {
    const t = `<a>\r\n<b>\r\n x \r\n</b>\r\n<b>y</b></a>`;
    const root = parseXml(t);
    expect(childrenNamed(root, "b").map((b) => b.text)).toEqual(["x", "y"]);
    const b = root.children[0]!;
    expect(t.slice(b.textStart, b.textEnd)).toBe("x");
  });

  it("handles '>' inside attribute values", () => {
    const root = parseXml(`<a k="1>2"><b/></a>`);
    expect(root.attrs.get("k")!.value).toBe("1>2");
    expect(root.children).toHaveLength(1);
  });

  it("throws ParseError on malformed input", () => {
    for (const bad of ["<a><b></a>", "<a>", "<a></b>", "<a><!-- x </a>", "", '<a k="v></a>', "</a>"]) {
      expect(() => parseXml(bad), bad).toThrow(ParseError);
    }
  });
});
