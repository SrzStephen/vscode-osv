import { describe, expect, it } from "vitest";
import { classifyFile } from "../../../src/ecosystems/index.js";
import { npmModule } from "../../../src/ecosystems/npm/index.js";
import { applyEdits } from "../../helpers/applyEdits.js";

describe("npmModule", () => {
  it("lock commands by lockfile", () =>
    expect(
      ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", undefined].map((l) =>
        npmModule.lockCommand({ manifestPath: "/p/package.json", lockfilePath: l && `/p/${l}`, name: "x", target: "1.0.0" }),
      ),
    ).toEqual(["npm install", "yarn install", "pnpm install", "bun install", "npm install"]));

  it("pnpm override edit", () => {
    const plan = npmModule.transitiveFix({
      name: "qs",
      current: "6.0.0",
      target: "6.10.3",
      lockfilePath: "/p/pnpm-lock.yaml",
      manifestUri: "file:///p/package.json",
      manifestText: "{}",
    })!;
    expect(JSON.parse(applyEdits("{}", plan.edit))).toEqual({ pnpm: { overrides: { qs: "6.10.3" } } });
    expect(plan).toMatchObject({ kind: "override", lockCommand: { cwd: "/p", command: "pnpm install" } });
  });

  it("registered", () => expect(classifyFile("app/package.json")?.module.id).toBe("npm"));
});
