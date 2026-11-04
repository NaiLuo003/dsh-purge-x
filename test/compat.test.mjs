import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  auditPatches,
  compactDiff,
  formatAuditReport,
  formatPlan,
  patchHostRange,
  patchSupportsHost,
} from "../lib/compat.js";

test("patchHostRange defaults to the verified 0.2 host line", () => {
  assert.equal(patchHostRange({ id: 1 }), ">=0.2.0-0 <0.2.2-0");
  assert.equal(patchHostRange({ id: 1, hostRange: ">=0.1.0" }), ">=0.1.0");
  assert.equal(patchHostRange({ id: 1, legacy: { maxHost: "0.2.0" } }), ">=0.0.0 <=0.2.0");
});

test("patchSupportsHost gates legacy patches by version", () => {
  const legacy = { id: 77, legacy: { maxHost: "0.2.0" } };
  assert.equal(patchSupportsHost(legacy, "0.2.0-rc.2"), true);
  assert.equal(patchSupportsHost(legacy, "0.2.1-rc.5"), false);
  assert.equal(patchSupportsHost({ id: 1 }, "0.2.1-rc.5"), true);
  assert.equal(patchSupportsHost({ id: 1 }, "0.3.0"), false);
  // 未识别版本时保持旧行为：全部尝试。
  assert.equal(patchSupportsHost({ id: 1 }, ""), true);
});

test("auditPatches without an aiBase reports missing files, not a crash", () => {
  const report = auditPatches("");
  assert.ok(report.rows.length > 0);
  assert.equal(report.aiBase, "");
  assert.equal(report.blocking.length, 0);
  assert.ok(report.summary.fileMissing > 0);
  const text = formatAuditReport(report);
  assert.match(text, /兼容审计/);
  assert.match(text, /没有阻断项/);
});

test("formatPlan renders a stable dry-run summary", () => {
  const text = formatPlan({
    version: "0.2.1-rc.5",
    surface: "desktop",
    rows: [
      { id: 1, name: "DEMO", bytes: 12, files: [{ key: "base", before: 10, after: 22, file: "x.yml" }] },
    ],
    totalFiles: 1,
    totalBytes: 12,
  });
  assert.match(text, /dry-run plan/);
  assert.match(text, /DEMO/);
  assert.match(text, /10 → 22/);
});

test("compactDiff reports the changed middle block", () => {
  const diff = compactDiff("a\nb\nc", "a\nB\nc");
  assert.match(diff, /^@@ -2,1 \+2,1 @@/);
  assert.match(diff, /-b/);
  assert.match(diff, /\+B/);
  assert.equal(compactDiff("same", "same"), "");
});

test("compactDiff clips very large blocks", () => {
  const before = Array.from({ length: 100 }, (_, i) => `line-${i}`).join("\n");
  const after = Array.from({ length: 100 }, (_, i) => `LINE-${i}`).join("\n");
  const diff = compactDiff(before, after, 5);
  assert.match(diff, /\.\.\. \(95 more lines\)/);
});

test("auditPatches detects a pending 0.2.1 dev-context patch on a synthetic host", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-compat-audit-"));
  const ai = path.join(dir, "node_modules", "@deepseek-ai");
  const home = path.join(dir, "dsh-home");
  const base = path.join(ai, "dsh-base");
  const web = path.join(ai, "dsh-web-app", "lib");
  fs.mkdirSync(base, { recursive: true });
  fs.mkdirSync(web, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(base, "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh-base", version: "0.2.1-rc.5" }));
  fs.writeFileSync(
    path.join(web, "index.js"),
    'const p = "You are interacting with the user through the DeepSeek Harness Web GUI at ${webUrl}.";\n',
  );

  const report = auditPatches(ai, { surface: "web", dshHome: home });
  assert.equal(report.version, "0.2.1-rc.5");
  const webSurface = report.rows.find((row) => row.id === 32);
  assert.equal(webSurface.status, "pending");
  assert.ok(webSurface.anchors.hit >= 1);
  assert.equal(report.blocking.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("0.2.1 shipped presets (#43 territory) are not claimed by patch #4", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-compat-p4-"));
  const ai = path.join(dir, "node_modules", "@deepseek-ai");
  const home = path.join(dir, "dsh-home");
  const presets = path.join(ai, "dsh-web-app", "presets");
  fs.mkdirSync(presets, { recursive: true });
  fs.mkdirSync(path.join(ai, "dsh-base"), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(ai, "dsh-base", "package.json"), `${JSON.stringify({ name: "@deepseek-ai/dsh-base", version: "0.2.1-rc.5" })}\n`);
  // #43 写入后的形态：insert 行 + prefix: ""，没有 personaPrefix 旧锚点。
  fs.writeFileSync(
    path.join(presets, "standard.patch.yml"),
    [
      "- insert:",
      "    - id: preset-standard",
      "      name: '@deepseek-ai/dsh-agent-preset'",
      "      config:",
      "        id: standard",
      "        plugins:",
      "          - id: persona",
      "            config:",
      '              prefix: ""',
      "",
    ].join("\n"),
  );
  // web-app / headless 等 #4 的其他目标也要在（applied 形态），避免 rollup 落 file-missing。
  for (const pkg of ["dsh-web-app", "dsh-headless", "dsh-acp-app", "dsh-sdk-app"]) {
    fs.mkdirSync(path.join(ai, pkg), { recursive: true });
    fs.writeFileSync(path.join(ai, pkg, "cordis.patch.yml"), 'config:\n  personaPrefix: ""\n');
  }
  const { auditPatches } = await import("../lib/compat.js");
  const audit = auditPatches(ai, { dshHome: home });
  const four = audit.rows.find((row) => row.id === 4);
  assert.equal(four.status, "applied");
});
