import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { restoreAsarFromBackup } from "../lib/extract-asar.js";

test("restores app.asar from app.asar.bak", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-asar-"));
  const asar = path.join(dir, "app.asar");
  fs.writeFileSync(`${asar}.bak`, "archive");
  assert.equal(fs.existsSync(asar), false);

  const result = restoreAsarFromBackup(asar);
  assert.equal(result.restored, true);
  assert.equal(fs.readFileSync(asar, "utf8"), "archive");
  assert.equal(fs.existsSync(`${asar}.bak`), false);
});

test("is idempotent when the archive is already in place", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-asar-"));
  const asar = path.join(dir, "app.asar");
  fs.writeFileSync(asar, "archive");
  const result = restoreAsarFromBackup(asar);
  assert.equal(result.restored, false);
  assert.equal(result.already, true);
});

test("reports no_backup without inventing a file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-asar-"));
  const asar = path.join(dir, "app.asar");
  const result = restoreAsarFromBackup(asar);
  assert.equal(result.restored, false);
  assert.equal(result.reason, "no_backup");
  assert.equal(fs.existsSync(asar), false);
});
