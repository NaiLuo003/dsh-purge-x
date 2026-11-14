import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearDesktopUpdaterPending } from "../lib/desktop.js";

const APP_UPDATE_YML = [
  "provider: generic",
  "url: https://download.deepseek.com/dsh-desk/feeds/win-x64/",
  "channel: nightly",
  "updaterCacheDirName: 'test-dsh-updater-cache'",
  "publisherName:",
  "  - CN=Test",
].join("\n");

function fakeInstall({ localRoot, withYml = true, withInstaller = true, withPending = false }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-updater-"));
  const installDir = path.join(root, "install");
  const resources = path.join(installDir, "resources");
  const appDir = path.join(resources, "app");
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(installDir, "DeepSeek Harness.exe"), "exe");
  if (withYml) fs.writeFileSync(path.join(resources, "app-update.yml"), APP_UPDATE_YML);
  const cache = path.join(localRoot, "test-dsh-updater-cache");
  fs.mkdirSync(cache, { recursive: true });
  if (withInstaller) fs.writeFileSync(path.join(cache, "installer.exe"), "payload");
  if (withPending) {
    fs.mkdirSync(path.join(cache, "pending"), { recursive: true });
    fs.writeFileSync(path.join(cache, "pending", "update-info.json"), "{}");
  }
  return { root, installDir, resources, cache };
}

test("clearDesktopUpdaterPending removes the cached installer and pending payloads", (t) => {
  // LOCALAPPDATA 决定缓存根；用沙箱临时目录隔离真实缓存。
  const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-local-"));
  t._origLocal = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = localRoot;
  const inst = fakeInstall({ localRoot, withInstaller: true, withPending: true });
  try {
    const result = clearDesktopUpdaterPending(path.join(inst.installDir, "DeepSeek Harness.exe"));
    assert.equal(result.cache, path.join(localRoot, "test-dsh-updater-cache"));
    assert.ok(result.cleared.includes("installer.exe"));
    assert.ok(result.cleared.some((name) => String(name).includes("update-info.json")));
    assert.equal(fs.existsSync(path.join(inst.cache, "installer.exe")), false);
    assert.equal(fs.existsSync(path.join(inst.cache, "pending")), false);
  } finally {
    if (t._origLocal === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = t._origLocal;
    fs.rmSync(inst.root, { recursive: true, force: true });
    fs.rmSync(localRoot, { recursive: true, force: true });
  }
});

test("clearDesktopUpdaterPending without app-update.yml or a cache is a no-op", (t) => {
  const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-local-"));
  t._origLocal = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = localRoot;
  const inst = fakeInstall({ localRoot, withYml: false, withInstaller: false });
  try {
    const result = clearDesktopUpdaterPending(path.join(inst.installDir, "DeepSeek Harness.exe"));
    assert.equal(result.cache, "");
    assert.deepEqual(result.cleared, []);
  } finally {
    if (t._origLocal === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = t._origLocal;
    fs.rmSync(inst.root, { recursive: true, force: true });
    fs.rmSync(localRoot, { recursive: true, force: true });
  }
});
