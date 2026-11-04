import test from "node:test";
import assert from "node:assert/strict";
import { patchOfficialCliCmdText, sealedSwapKind } from "../lib/desktop.js";

const STOCK = [
  "@echo off",
  "setlocal DisableDelayedExpansion",
  'set "ELECTRON_RUN_AS_NODE=1"',
  '"%~dp0..\\..\\..\\..\\DeepSeek Harness.exe" --expose-internals "%~dp0..\\..\\..\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js" %*',
  "exit /b %errorlevel%",
].join("\r\n");

test("stock dsh.cmd gets the three-step entry fallback", () => {
  const result = patchOfficialCliCmdText(STOCK);
  assert.equal(result.changed, true);
  assert.match(result.text, /REM dsh-purge cli entry begin/);
  assert.match(result.text, /if not exist "%entry%" set "entry=.*app\.asar\.unpacked\\dsh\\/);
  assert.match(result.text, /if not exist "%entry%" set "entry=.*app\\dsh\\/);
  assert.match(result.text, /"%entry%" %\*/);
  // 原始裸路径必须被替换掉，否则挪走 asar 后会 Cannot find module。
  const outside = result.text.replace(/set\s+"entry=[^"]*"/gi, "");
  assert.equal(/app\.asar\\dsh\\node_modules/i.test(outside), false);
});

test("already patched dsh.cmd is left alone", () => {
  const once = patchOfficialCliCmdText(STOCK);
  const twice = patchOfficialCliCmdText(once.text);
  assert.equal(twice.changed, false);
  assert.equal(twice.text, once.text);
});

test("sealed asar swaps go through the logged Node helper on every platform", () => {
  assert.equal(sealedSwapKind("win32"), "helper");
  assert.equal(sealedSwapKind("darwin"), "helper");
  assert.equal(sealedSwapKind("linux"), "helper");
});
