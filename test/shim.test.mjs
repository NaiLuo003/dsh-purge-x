import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { revertShim, shimFileStatus } from "../lib/core.js";

const ORIGINAL = "@echo off\r\nrem original\r\nexit /b 0\r\n";
const PATCHED = [
  "@echo off",
  "setlocal DisableDelayedExpansion",
  'set "ELECTRON_RUN_AS_NODE=1"',
  "REM dsh-purge cli entry begin",
  'set "entry=%~dp0..\\..\\..\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js"',
  "REM dsh-purge cli entry end",
  "exit /b %errorlevel%",
].join("\r\n");

function tempShimDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-shim-"));
  fs.writeFileSync(path.join(dir, "dsh.cmd"), PATCHED);
  return dir;
}

test("text .cmd shims are not reported as binary", () => {
  const dir = tempShimDir();
  assert.equal(shimFileStatus(path.join(dir, "dsh.cmd")), "original");
});

test("revertShim restores from the .dsh-purge.bak written by the CLI repair", async () => {
  const dir = tempShimDir();
  const fp = path.join(dir, "dsh.cmd");
  fs.writeFileSync(`${fp}.dsh-purge.bak`, ORIGINAL);

  const result = await revertShim(dir, { scrubDesktop: false });
  assert.equal(result["dsh.cmd"], "reverted");
  assert.equal(fs.readFileSync(fp, "utf8"), ORIGINAL);
  assert.equal(fs.existsSync(`${fp}.dsh-purge.bak`), false);
});

test("revertShim leaves an unpatched shim alone", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-shim-"));
  fs.writeFileSync(path.join(dir, "dsh.cmd"), ORIGINAL);
  const result = await revertShim(dir, { scrubDesktop: false });
  assert.equal(result["dsh.cmd"], "no_backup");
  assert.equal(fs.readFileSync(path.join(dir, "dsh.cmd"), "utf8"), ORIGINAL);
});
