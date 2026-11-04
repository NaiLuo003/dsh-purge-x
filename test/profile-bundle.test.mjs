import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureProfileBundles } from "../lib/profile-bundle.js";

function tempDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dsh-purge-${tag}-`));
}

function makePlugin(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "dsh-purge-x", version: "2.0.0" }));
  return dir;
}

function makeProfile(home, name, pkg) {
  const dir = path.join(home, "profiles", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2));
  return dir;
}

test("relinks a profile bundle whose node_modules entry is missing", () => {
  const home = tempDir("home");
  const plugin = makePlugin(tempDir("plugin"));
  const dir = makeProfile(home, "desktop", {
    name: "dsh-profile-desktop",
    dependencies: { "dsh-purge-x": `link:${plugin.replace(/\\/g, "/")}` },
    dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "dsh-purge-x"] } },
  });
  const link = path.join(dir, "node_modules", "dsh-purge-x");
  assert.equal(fs.existsSync(link), false);

  const result = ensureProfileBundles({ dshHome: home, pluginRoot: plugin });
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(result.repaired.length, 1);
  assert.equal(fs.existsSync(path.join(link, "package.json")), true);
});

test("adds the dependency when only the bundle entry exists", () => {
  const home = tempDir("home");
  const plugin = makePlugin(tempDir("plugin"));
  const dir = makeProfile(home, "web", {
    dependencies: {},
    dsh: { profile: { bundles: ["dsh-purge-x"] } },
  });

  const result = ensureProfileBundles({ dshHome: home, pluginRoot: plugin });
  assert.equal(result.ok, true);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  assert.equal(pkg.dependencies["dsh-purge-x"], `link:${plugin.replace(/\\/g, "/")}`);
  assert.equal(fs.existsSync(path.join(dir, "node_modules", "dsh-purge-x", "package.json")), true);
});

test("reports an error instead of guessing when no target exists", () => {
  const home = tempDir("home");
  const dir = makeProfile(home, "desktop", {
    dependencies: { "dsh-purge-x": "link:E:/does/not/exist" },
    dsh: { profile: { bundles: ["dsh-purge-x"] } },
  });

  const result = ensureProfileBundles({ dshHome: home, pluginRoot: "" });
  assert.equal(result.ok, false);
  assert.equal(result.repaired.length, 0);
  assert.match(result.errors[0], /cannot|没有它|pnpm install/);
  assert.equal(fs.existsSync(path.join(dir, "node_modules", "dsh-purge-x")), false);
});

test("leaves healthy profiles untouched", () => {
  const home = tempDir("home");
  const plugin = makePlugin(tempDir("plugin"));
  const dir = makeProfile(home, "desktop", {
    dependencies: { "dsh-purge-x": `link:${plugin.replace(/\\/g, "/")}` },
    dsh: { profile: { bundles: ["dsh-purge-x"] } },
  });
  fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true });
  fs.symlinkSync(plugin, path.join(dir, "node_modules", "dsh-purge-x"), process.platform === "win32" ? "junction" : "dir");
  const before = fs.readFileSync(path.join(dir, "package.json"), "utf8");

  const result = ensureProfileBundles({ dshHome: home, pluginRoot: plugin });
  assert.equal(result.ok, true);
  assert.equal(result.repaired.length, 0);
  assert.equal(fs.readFileSync(path.join(dir, "package.json"), "utf8"), before);
});
