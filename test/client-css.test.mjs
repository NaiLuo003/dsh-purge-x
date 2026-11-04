import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(root, "client.js"), "utf8");

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\{([^}]*)\\}`));
  assert.ok(match, `missing CSS rule ${selector}`);
  return match[1];
}

test("uninstall modal uses an opaque theme background, not the translucent dock paper", () => {
  const modal = rule(".dshp-modal");
  assert.match(modal, /background:var\(--dsw-alias-bg-layer-1/);
  assert.equal(modal.includes("--dshp-paper"), false);
  assert.match(modal, /max-height:/);
  assert.match(modal, /overflow:auto/);
});

test("uninstall modal overlay sits above panel content", () => {
  const overlay = rule(".dshp-modal-bg");
  const z = Number((overlay.match(/z-index:(\d+)/) || [])[1]);
  assert.ok(z >= 1000, `z-index ${z} too low`);
});
