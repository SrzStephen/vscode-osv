import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LineIndex } from "../../../src/core/lineIndex.js";
import type { TextRange } from "../../../src/core/types.js";
import { parsePackagesProps, parseProjectFile, resolveCentralVersions } from "../../../src/ecosystems/nuget/project.js";
import { ParseError } from "../../../src/ecosystems/types.js";
import { memFs } from "../../helpers/memFs.js";

const read = (...p: string[]): string => readFileSync(join(__dirname, "..", "..", "fixtures", "nuget", ...p), "utf8");
const slice = (text: string, r: TextRange): string => {
  const ix = new LineIndex(text);
  return text.slice(ix.offset(r.start), ix.offset(r.end));
};

describe("parseProjectFile", () => {
  const text = read("app.csproj");
  const deps = parseProjectFile(text);
  const byName = (n: string) => deps.find((d) => d.name === n)!;

  it("reads attribute, child element, property and central forms", () => {
    expect(byName("newtonsoft.json")).toMatchObject({ rawSpec: "12.0.3", lowerBound: "12.0.3", kind: "registry" });
    expect(slice(text, byName("newtonsoft.json").specRange!)).toBe("12.0.3");
    expect(slice(text, byName("newtonsoft.json").nameRange)).toBe("newtonsoft.json");
    expect(byName("Dapper")).toMatchObject({ rawSpec: "2.0.123", kind: "registry" });
    expect(slice(text, byName("Dapper").specRange!)).toBe("2.0.123");
    expect(byName("Polly")).toMatchObject({ kind: "unresolved", group: "cpm" });
    expect(byName("Polly").rawSpec).toBeUndefined();
  });

  it("resolves $(Prop) from the same file with specLocation on the property", () => {
    const s = byName("Serilog");
    expect(s).toMatchObject({ rawSpec: "2.10.0", lowerBound: "2.10.0", kind: "registry" });
    expect(slice(text, s.specRange!)).toBe("$(SerilogVersion)");
    expect(s.specLocation!.path).toBe("");
    expect(s.specLocation!.rawSpec).toBe("2.10.0");
    expect(slice(text, s.specLocation!.range)).toBe("2.10.0");
  });

  it("leaves an unknown property unresolved", () => expect(byName("Missing.Prop")).toMatchObject({ kind: "unresolved" }));

  it("supports Update and VersionOverride", () => {
    const d = parseProjectFile(
      '<Project><ItemGroup><PackageReference Update="A" Version="1.0"/><PackageReference Include="B" VersionOverride="2.0" Version="1.0"/></ItemGroup></Project>',
    );
    expect(d.map((x) => [x.name, x.rawSpec])).toEqual([["A", "1.0"], ["B", "2.0"]]);
  });

  it("handles version ranges and invalid XML", () => {
    expect(parseProjectFile('<Project><ItemGroup><PackageReference Include="A" Version="[1.0,2.0)"/></ItemGroup></Project>')[0]).toMatchObject({
      lowerBound: "1.0",
      kind: "registry",
    });
    expect(() => parseProjectFile("<Project>")).toThrow(ParseError);
  });
});

describe("parsePackagesProps", () => {
  it("reads PackageVersion and GlobalPackageReference", () => {
    const text = read("cpm", "Directory.Packages.props");
    const deps = parsePackagesProps(text);
    expect(deps.map((d) => [d.name, d.rawSpec])).toEqual([
      ["Newtonsoft.Json", "12.0.3"],
      ["Polly", "7.2.3"],
      ["StyleCop.Analyzers", "1.1.118"],
    ]);
    expect(deps[0]!.specLocation!.path).toBe("");
    expect(slice(text, deps[0]!.specLocation!.range)).toBe("12.0.3");
  });
});

describe("resolveCentralVersions", () => {
  const files: Record<string, string> = {
    "/ws/Directory.Packages.props": '<Project><ItemGroup><PackageVersion Include="Outer" Version="9.9.9"/></ItemGroup></Project>',
    "/ws/cpm/Directory.Packages.props": read("cpm", "Directory.Packages.props"),
    "/ws/cpm/src/app/app.csproj": read("cpm", "src", "app", "app.csproj"),
  };
  const fs = memFs(files);
  const ctx = { manifestPath: "/ws/cpm/src/app/app.csproj", rootDir: "/ws", files: fs };

  it("fills versions from the nearest Directory.Packages.props, case-insensitively", async () => {
    const deps = await resolveCentralVersions(parseProjectFile(files[ctx.manifestPath]!), ctx);
    const nj = deps.find((d) => d.name === "newtonsoft.json")!;
    expect(nj).toMatchObject({ rawSpec: "12.0.3", lowerBound: "12.0.3", kind: "registry" });
    expect(nj.specLocation!.path).toBe("/ws/cpm/Directory.Packages.props");
    expect(slice(files["/ws/cpm/Directory.Packages.props"]!, nj.specLocation!.range)).toBe("12.0.3");
    expect(deps.find((d) => d.name === "POLLY")).toMatchObject({ rawSpec: "8.0.0", kind: "registry" });
    expect(deps.find((d) => d.name === "Unmanaged")).toMatchObject({ kind: "unresolved" });
  });

  it("points specLocation at the props file for a plain central version", async () => {
    const deps = await resolveCentralVersions(
      parseProjectFile('<Project><ItemGroup><PackageReference Include="polly"/></ItemGroup></Project>'),
      ctx,
    );
    const p = deps[0]!;
    expect(p.specLocation!.path).toBe("/ws/cpm/Directory.Packages.props");
    expect(slice(files["/ws/cpm/Directory.Packages.props"]!, p.specLocation!.range)).toBe("7.2.3");
  });

  it("does not read above rootDir", async () => {
    const deps = await resolveCentralVersions(
      parseProjectFile('<Project><ItemGroup><PackageReference Include="Outer"/></ItemGroup></Project>'),
      { ...ctx, rootDir: "/ws/cpm/src" },
    );
    expect(deps[0]!.kind).toBe("unresolved");
  });
});
