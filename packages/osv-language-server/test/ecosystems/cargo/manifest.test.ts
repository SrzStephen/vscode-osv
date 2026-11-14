import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DeclaredDep } from "../../../src/core/types.js";
import type { FileSource } from "../../../src/core/fileSource.js";
import { parseCargoManifest, resolveCargoWorkspace } from "../../../src/ecosystems/cargo/manifest.js";
import { ParseError } from "../../../src/ecosystems/types.js";
import { textAt } from "../../helpers/textAt.js";
import { memFs, toPosix } from "../../helpers/memFs.js";

const read = (f: string) => readFileSync(join(__dirname, "..", "..", "fixtures", "cargo", f), "utf8");
const rows = (deps: DeclaredDep[]) => deps.map((d) => [d.name, d.group?.replace(/:workspace$/, ""), d.lowerBound, d.kind]);

const memFiles = (files: Record<string, string>): FileSource => memFs(files);

describe("parseCargoManifest", () => {
  it("parses tables, renames, git, workspace", () =>
    expect(rows(parseCargoManifest(read("Cargo.toml")))).toEqual([
      ["serde", "dependencies", "1.0.0", "registry"],
      ["real-name", "dependencies", "1.0.0", "registry"],
      ["mygit", "dependencies", undefined, "git"],
      ["smallvec", "target.cfg(unix).dependencies", "0.6.9", "registry"],
      ["tokio", "dev-dependencies", undefined, "unresolved"],
    ]));
  it("flags workspace deps by group suffix", () => {
    const t = parseCargoManifest(read("Cargo.toml")).at(-1)!;
    expect(t.group).toBe("dev-dependencies:workspace");
  });
  it("ranges", () => {
    const t = read("Cargo.toml");
    const [serde, alias] = parseCargoManifest(t);
    expect(textAt(t, serde!.nameRange)).toBe("serde");
    expect(textAt(t, serde!.specRange!)).toBe("1.0");
    expect(textAt(t, alias!.specRange!)).toBe("1.0.0");
  });
  it("dotted sub-tables and workspace.dependencies and build-dependencies", () => {
    const t = '[dependencies.foo]\nversion = "2.1"\n[workspace.dependencies]\ntokio = "1.0"\n[build-dependencies]\ncc = "1"\n';
    expect(rows(parseCargoManifest(t))).toEqual([
      ["foo", "dependencies", "2.1.0", "registry"],
      ["tokio", "workspace.dependencies", "1.0.0", "registry"],
      ["cc", "build-dependencies", "1.0.0", "registry"],
    ]);
  });
  it("path deps and missing versions", () =>
    expect(rows(parseCargoManifest('[dependencies]\na = { path = "../a" }\nb = { version = "*" }\n'))).toEqual([
      ["a", "dependencies", undefined, "path"],
      ["b", "dependencies", undefined, "unresolved"],
    ]));
  it("throws ParseError on invalid TOML", () => expect(() => parseCargoManifest("[dependencies\n")).toThrow(ParseError));
});

describe("resolveCargoWorkspace", () => {
  const member = '[package]\nname = "m"\n[dependencies]\ntokio = { workspace = true }\nserde = "1"\n';
  const root = '[workspace]\nmembers = ["m"]\n[workspace.dependencies]\ntokio = "1.0"\n';
  it("resolves workspace = true from the workspace root", async () => {
    const files = memFiles({ "/r/Cargo.toml": root, "/r/m/Cargo.toml": member });
    const deps = await resolveCargoWorkspace(parseCargoManifest(member), { manifestPath: "/r/m/Cargo.toml", rootDir: "/r", files });
    const tokio = deps.find((d) => d.name === "tokio")!;
    expect(tokio.rawSpec).toBe("1.0");
    expect(tokio.lowerBound).toBe("1.0.0");
    expect(tokio.kind).toBe("registry");
    expect(toPosix(tokio.specLocation!.path)).toBe("/r/Cargo.toml");
    expect(tokio.specLocation!.rawSpec).toBe("1.0");
    expect(textAt(root, tokio.specLocation!.range)).toBe("1.0");
    expect(deps.find((d) => d.name === "serde")!.lowerBound).toBe("1.0.0");
  });
  it("leaves it unresolved when no workspace is found", async () => {
    const files = memFiles({ "/r/m/Cargo.toml": member });
    const deps = await resolveCargoWorkspace(parseCargoManifest(member), { manifestPath: "/r/m/Cargo.toml", rootDir: "/r", files });
    expect(deps.find((d) => d.name === "tokio")).toMatchObject({ kind: "unresolved", rawSpec: undefined });
  });
  const renamedRoot = '[workspace]\n[workspace.dependencies]\nfoo = { package = "real", version = "1" }\n';
  it("inherits by table key and adopts the renamed crate name", async () => {
    const m = '[dependencies]\nfoo = { workspace = true }\n';
    const files = memFiles({ "/r/Cargo.toml": renamedRoot, "/r/m/Cargo.toml": m });
    const [dep] = await resolveCargoWorkspace(parseCargoManifest(m), { manifestPath: "/r/m/Cargo.toml", rootDir: "/r", files });
    expect(dep).toMatchObject({ name: "real", rawSpec: "1", lowerBound: "1.0.0", kind: "registry", group: "dependencies" });
  });
  it("does not bind a member key to a workspace entry renamed to it", async () => {
    const m = '[dependencies]\nreal = { workspace = true }\n';
    const files = memFiles({ "/r/Cargo.toml": renamedRoot, "/r/m/Cargo.toml": m });
    const [dep] = await resolveCargoWorkspace(parseCargoManifest(m), { manifestPath: "/r/m/Cargo.toml", rootDir: "/r", files });
    expect(dep).toMatchObject({ name: "real", kind: "unresolved", rawSpec: undefined });
  });
  it("skips a nearer Cargo.toml without [workspace]", async () => {
    const files = memFiles({ "/r/Cargo.toml": root, "/r/a/Cargo.toml": "[package]\nname='a'\n", "/r/a/m/Cargo.toml": member });
    const deps = await resolveCargoWorkspace(parseCargoManifest(member), { manifestPath: "/r/a/m/Cargo.toml", rootDir: "/r", files });
    expect(toPosix(deps.find((d) => d.name === "tokio")!.specLocation!.path)).toBe("/r/Cargo.toml");
  });
});
