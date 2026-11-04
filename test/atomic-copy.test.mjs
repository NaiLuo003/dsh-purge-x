import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { atomicCopyFile } from "../lib/core.js";

test("atomicCopyFile falls back to an in-place write when rename is denied", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-acopy-"));
  const src = path.join(dir, "src.txt");
  const dst = path.join(dir, "dst.txt");
  fs.writeFileSync(src, "payload");
  fs.writeFileSync(dst, "old");

  const realRenameP = fs.promises.rename;
  fs.promises.rename = async () => {
    const err = new Error("EPERM: operation not permitted, rename");
    err.code = "EPERM";
    throw err;
  };
  try {
    await atomicCopyFile(src, dst);
  } finally {
    fs.promises.rename = realRenameP;
  }
  assert.equal(fs.readFileSync(dst, "utf8"), "payload");
  const leftovers = fs.readdirSync(dir).filter((n) => n.includes("copytmp"));
  assert.deepEqual(leftovers, []);
});

test("atomicCopyFile succeeds normally without fallback", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-acopy-"));
  const src = path.join(dir, "a.txt");
  const dst = path.join(dir, "b.txt");
  fs.writeFileSync(src, "normal");
  await atomicCopyFile(src, dst);
  assert.equal(fs.readFileSync(dst, "utf8"), "normal");
});
