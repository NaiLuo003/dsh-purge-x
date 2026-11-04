import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  HOST_RANGE_DEFAULT,
  compareVersions,
  detectHostVersion,
  parseVersion,
  satisfiesRange,
} from "../lib/host-version.js";

test("parseVersion accepts dsh prerelease versions", () => {
  assert.deepEqual(parseVersion("0.2.1-rc.5"), {
    raw: "0.2.1-rc.5",
    major: 0,
    minor: 2,
    patch: 1,
    prerelease: ["rc", "5"],
  });
  assert.equal(parseVersion("v0.2.0")?.patch, 0);
  assert.equal(parseVersion("0.2")?.minor, 2);
  assert.equal(parseVersion("not-a-version"), null);
});

test("compareVersions follows semver prerelease ordering", () => {
  assert.equal(compareVersions("0.2.0-rc.2", "0.2.0"), -1);
  assert.equal(compareVersions("0.2.1-rc.5", "0.2.0"), 1);
  assert.equal(compareVersions("0.2.1-rc.5", "0.2.1-rc.5"), 0);
  assert.equal(compareVersions("0.2.1-rc.10", "0.2.1-rc.9"), 1);
  assert.equal(compareVersions("0.2.2-alpha.2", "0.2.1"), 1);
});

test("default host range covers 0.2.0 prereleases and 0.2.1", () => {
  assert.ok(satisfiesRange("0.2.0-rc.2", HOST_RANGE_DEFAULT));
  assert.ok(satisfiesRange("0.2.1-rc.5", HOST_RANGE_DEFAULT));
  // 0.2.2 alpha 尚未校对：默认跳过，避免旧锚点误打。
  assert.equal(satisfiesRange("0.2.2-alpha.2", HOST_RANGE_DEFAULT), false);
  assert.equal(satisfiesRange("0.1.7", HOST_RANGE_DEFAULT), false);
  assert.equal(satisfiesRange("0.3.0", HOST_RANGE_DEFAULT), false);
});

test("caret and tilde ranges do not leak across minor versions for 0.x", () => {
  assert.ok(satisfiesRange("0.2.9", "^0.2.1"));
  assert.equal(satisfiesRange("0.3.0", "^0.2.1"), false);
  assert.ok(satisfiesRange("0.2.9", "~0.2.1"));
  assert.equal(satisfiesRange("0.3.0", "~0.2.1"), false);
});

test("compare operators combine with AND", () => {
  assert.ok(satisfiesRange("0.2.1-rc.5", ">=0.2.1-0 <0.2.2"));
  assert.equal(satisfiesRange("0.2.2", ">=0.2.1-0 <0.2.2"), false);
});

test("detectHostVersion reads dsh-base/package.json from an aiBase", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-host-version-"));
  const base = path.join(dir, "node_modules", "@deepseek-ai", "dsh-base");
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(path.join(base, "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh-base", version: "0.2.1-rc.5" }));
  const hit = detectHostVersion(path.join(dir, "node_modules", "@deepseek-ai"));
  assert.equal(hit.version, "0.2.1-rc.5");
  assert.match(hit.source, /dsh-base/);
  fs.rmSync(dir, { recursive: true, force: true });
});
