import { describe, expect, it } from "vitest";
import { normalizeSwiftUrl } from "../../../src/ecosystems/swift/url.js";

describe("normalizeSwiftUrl", () => {
  it.each([
    ["https://github.com/apple/swift-nio.git", "github.com/apple/swift-nio"],
    ["git@github.com:apple/swift-nio.git", "github.com/apple/swift-nio"],
    ["https://GitHub.com/Apple/swift-nio/", "github.com/Apple/swift-nio"],
    ["https://user:token@github.com/apple/swift-nio.git/", "github.com/apple/swift-nio"],
    ["ssh://git@github.com:22/apple/swift-nio.git", "github.com/apple/swift-nio"],
    ["http://gitlab.example.com/g/sub/repo", "gitlab.example.com/g/sub/repo"],
    ["github.com/apple/swift-nio", "github.com/apple/swift-nio"],
  ])("normalize %s", (u, n) => expect(normalizeSwiftUrl(u)).toBe(n));

  it.each(["", "swift-nio", "../local", "/abs/path", "file:///tmp/x", "https://github.com", "not a url"])("rejects %j", (u) =>
    expect(normalizeSwiftUrl(u)).toBeUndefined(),
  );
});
