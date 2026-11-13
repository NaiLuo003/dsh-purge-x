import fs from "node:fs";
import {
  ALL_PATCHES,
  applyReplacementsToText,
  asLf,
  matchesPattern,
  patchApplied,
  targetFiles,
} from "./core.js";
import {
  HOST_RANGE_DEFAULT,
  TESTED_HOSTS,
  detectHostVersion,
  satisfiesRange,
} from "./host-version.js";
import { detectSurface } from "./surface.js";

/**
 * 补丁兼容审计（只读）。
 *
 * 上游 status 只回答「现在是不是已应用/待应用」，宿主升级后分不清
 * 「锚点没了」和「本来就不需要」。这里给每个补丁补一列原因：
 *
 *   pending        锚点还在，点应用会写文件
 *   applied        标记已存在
 *   anchor-missing 宿主在支持区间内，但锚点对不上 → 需要更新补丁
 *   file-missing   目标包没装（可选插件 / 另一个宿主）
 *   unsupported    补丁声明的 hostRange 不包含当前宿主
 *   partial        多文件补丁只命中一部分
 *   na             当前宿主面不适用
 */

// 与 core.isLayoutSoftPatch 对齐：这些补丁允许某一侧锚点缺失，
// 只要没有残留 pattern 就算完成，不应算作兼容阻断。
const LAYOUT_SOFT_IDS = new Set([4, 25, 26, 5, 11, 12]);

function isSoftPatch(patch) {
  return Boolean(patch?.softSettle) || LAYOUT_SOFT_IDS.has(patch?.id);
}

export function patchHostRange(patch) {
  if (patch?.hostRange) return patch.hostRange;
  if (patch?.legacy?.maxHost) return `>=0.0.0 <=${patch.legacy.maxHost}`;
  return HOST_RANGE_DEFAULT;
}

export function patchSupportsHost(patch, version) {
  if (!version) return true;
  return satisfiesRange(version, patchHostRange(patch));
}

function patchAppliesToSurface(patch, surface) {
  const want = patch?.surfaces;
  if (!Array.isArray(want) || want.length === 0) return true;
  return want.includes(surface) || want.includes(surface === "desktop" ? "desktop" : "web");
}

function fileKeysOf(patch) {
  return Array.isArray(patch.file) ? patch.file : [patch.file];
}

function replacementList(patch) {
  if (Array.isArray(patch.replacements)) return patch.replacements;
  return (patch.patterns ?? []).map((pattern) => ({ pattern, replace: patch.replace }));
}

function countAnchors(text, patch) {
  const hay = asLf(text);
  let total = 0;
  let hit = 0;
  for (const { pattern } of replacementList(patch)) {
    if (!pattern) continue;
    total += 1;
    if (matchesPattern(hay, pattern)) hit += 1;
  }
  return { total, hit };
}

/**
 * 同一轮审计/计划里，后面的补丁要看到前面的改写结果：
 * #88 这类补丁的锚点由 #87 写入，按原始文件逐个检查会永远显示缺失。
 * 这里用内存副本按 ALL_PATCHES 顺序模拟 apply，不落盘。
 */
function createTextStore() {
  const cache = new Map();
  return {
    get(fp) {
      if (!cache.has(fp)) cache.set(fp, fs.readFileSync(fp, "utf8"));
      return cache.get(fp);
    },
    set(fp, text) {
      cache.set(fp, text);
    },
  };
}

function auditOneFile(fp, patch, store, simulate) {
  let text;
  try {
    text = store.get(fp);
  } catch (error) {
    return { file: fp, status: "read-error", error: String(error?.message || error), anchors: { total: 0, hit: 0 } };
  }
  const anchors = countAnchors(text, patch);
  if (patchApplied(text, patch)) return { file: fp, status: "applied", anchors };
  const result = applyReplacementsToText(text, patch, fp);
  if (result.changed && simulate) store.set(fp, result.text);
  return { file: fp, status: result.changed ? "pending" : "anchor-missing", anchors };
}

function rollupFileStatuses(rows, missingKeys, keyCount) {
  if (rows.length === 0) return "file-missing";
  if (rows.some((row) => row.status === "pending")) return "pending";
  if (rows.some((row) => row.status === "read-error")) return "read-error";
  // 多文件补丁允许部分目标包没装：只要已检查到的文件全部到位就算 applied。
  if (rows.every((row) => row.status === "applied")) return "applied";
  // 已应用 + 锚点缺失混在一起，才算 partial；不能把“可选预设没装”算成部分命中。
  if (rows.some((row) => row.status === "applied") && rows.some((row) => row.status === "anchor-missing")) return "partial";
  if (missingKeys === keyCount) return "file-missing";
  return "anchor-missing";
}

/**
 * @param {string} aiBase 含 dsh-base / dsh-web-app 等包的 @deepseek-ai 目录
 * @param {object} options { surface, version, dshHome, asarPaths, packageJsonPaths }
 */
export function auditPatches(aiBase, options = {}) {
  const surface = options.surface || detectSurface();
  const host = options.host || detectHostVersion(aiBase, options);
  const version = host.version || "";
  let files = {};
  let filesError = "";
  try {
    files = aiBase ? targetFiles(aiBase, options.dshHome) : {};
  } catch (error) {
    filesError = String(error?.message || error);
  }

  const rows = [];
  const store = createTextStore();
  for (const patch of ALL_PATCHES) {
    const keys = fileKeysOf(patch);
    const supported = patchSupportsHost(patch, version);
    const applies = patchAppliesToSurface(patch, surface);
    const fileRows = [];
    let missingKeys = 0;
    for (const key of keys) {
      const raw = files[key];
      const list = (Array.isArray(raw) ? raw : [raw]).filter((fp) => fp && typeof fp === "string" && fs.existsSync(fp));
      if (list.length === 0) {
        missingKeys += 1;
        fileRows.push({ key, file: "", status: "missing" });
        continue;
      }
      for (const fp of list) fileRows.push({ key, ...auditOneFile(fp, patch, store, supported && applies) });
    }
    const checked = fileRows.filter((row) => row.status !== "missing");
    const status = !applies
      ? "na"
      : !supported
        ? "unsupported"
        : rollupFileStatuses(checked, missingKeys, keys.length);
    const anchors = checked.reduce(
      (acc, row) => ({ total: acc.total + (row.anchors?.total || 0), hit: acc.hit + (row.anchors?.hit || 0) }),
      { total: 0, hit: 0 },
    );
    rows.push({
      id: patch.id,
      name: patch.name,
      layer: patch.layer || "",
      optional: Boolean(patch.optional),
      softSettle: isSoftPatch(patch),
      hostRange: patchHostRange(patch),
      supported,
      applies,
      status,
      anchors,
      files: fileRows,
    });
  }

  const count = (status) => rows.filter((row) => row.status === status).length;
  const blocking = rows.filter(
    (row) => row.supported && row.applies && !row.optional && !row.softSettle &&
      (row.status === "anchor-missing" || row.status === "read-error" || row.status === "partial"),
  );
  return {
    host,
    version,
    surface,
    aiBase: aiBase || "",
    filesError,
    rows,
    blocking,
    summary: {
      total: rows.length,
      pending: count("pending"),
      applied: count("applied"),
      anchorMissing: count("anchor-missing"),
      fileMissing: count("file-missing"),
      unsupported: count("unsupported"),
      na: count("na"),
      partial: count("partial"),
      readError: count("read-error"),
    },
  };
}

const STATUS_LABEL = {
  pending: "待应用",
  applied: "已应用",
  "anchor-missing": "锚点缺失",
  "file-missing": "文件缺失",
  unsupported: "宿主不支持",
  partial: "部分命中",
  "read-error": "读取失败",
  na: "不适用",
};

export function formatAuditReport(report, options = {}) {
  const out = [];
  const host = report.host || {};
  out.push("dsh-purge-x 兼容审计 / compatibility audit");
  out.push(`  宿主版本 / host   ${report.version || "未识别"}${host.source ? `  (${host.source})` : ""}`);
  out.push(`  宿主面 / surface  ${report.surface}`);
  out.push(`  插件根 / aiBase   ${report.aiBase || "未定位"}`);
  out.push(`  支持区间 / range  ${HOST_RANGE_DEFAULT}（已对照: ${TESTED_HOSTS.join(", ")}）`);
  out.push("");
  out.push(
    `  补丁 ${report.summary.total} 条：待应用 ${report.summary.pending}，已应用 ${report.summary.applied}，` +
    `锚点缺失 ${report.summary.anchorMissing}，文件缺失 ${report.summary.fileMissing}，` +
    `宿主不支持 ${report.summary.unsupported}，不适用 ${report.summary.na}`,
  );
  if (report.filesError) out.push(`  ⚠ 目标文件枚举失败: ${report.filesError}`);
  out.push("");

  const interesting = options.all
    ? report.rows
    : report.rows.filter((row) => row.status !== "pending" && row.status !== "applied" && row.status !== "na");
  if (interesting.length === 0) {
    out.push("  ✓ 没有需要处理的补丁。");
  } else {
    for (const row of interesting) {
      const label = STATUS_LABEL[row.status] || row.status;
      const opt = row.optional ? " (可选)" : "";
      out.push(`  [#${String(row.id).padEnd(3)}] ${label}${opt}  ${row.name}  [${row.layer}]`);
      out.push(`         区间 ${row.hostRange}，锚点 ${row.anchors.hit}/${row.anchors.total}`);
      for (const file of row.files) {
        if (file.status === "missing") {
          out.push(`         · ${file.key}: 目标包未安装`);
        } else {
          out.push(`         · ${file.key}: ${file.status} — ${file.file}`);
        }
      }
    }
  }
  out.push("");
  if (report.blocking.length > 0) {
    out.push(`  ✗ 阻断项 ${report.blocking.length} 条：宿主在支持区间内，但必需补丁的锚点对不上。`);
    out.push(`    建议先跑 --plan 核对，再更新 lib/core.js 里对应补丁的 pattern。`);
  } else {
    out.push("  ✓ 没有阻断项。");
  }
  return out.join("\n");
}

/**
 * 只做“公共前缀/后缀 + 中间块”的轻量 diff。
 * 补丁改写通常集中在一两处，这个 ABI 足够看清改了什么，又不用引第三方 diff 库。
 */
export function compactDiff(before, after, maxLines = 40) {
  const a = String(before || "").split("\n");
  const b = String(after || "").split("\n");
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) suffix += 1;
  const removed = a.slice(prefix, a.length - suffix);
  const added = b.slice(prefix, b.length - suffix);
  if (removed.length === 0 && added.length === 0) return "";
  const clip = (lines) => {
    if (lines.length <= maxLines) return lines;
    return [...lines.slice(0, maxLines), `... (${lines.length - maxLines} more lines)`];
  };
  const out = [`@@ -${prefix + 1},${removed.length} +${prefix + 1},${added.length} @@`];
  for (const line of clip(removed)) out.push(`-${line}`);
  for (const line of clip(added)) out.push(`+${line}`);
  return out.join("\n");
}

/**
 * dry-run：只算“会改哪些文件、改多少字节”，不写盘。
 * 给 --plan 和 /purge plan 共用。
 */
export function planApply(aiBase, options = {}) {
  const host = options.host || detectHostVersion(aiBase, options);
  const version = host.version || "";
  const surface = options.surface || detectSurface();
  const files = aiBase ? targetFiles(aiBase, options.dshHome) : {};
  const rows = [];
  const store = createTextStore();
  for (const patch of ALL_PATCHES) {
    if (!patchSupportsHost(patch, version) || !patchAppliesToSurface(patch, surface)) continue;
    const keys = fileKeysOf(patch);
    const changes = [];
    let missingKeys = 0;
    for (const key of keys) {
      const raw = files[key];
      const list = (Array.isArray(raw) ? raw : [raw]).filter((fp) => fp && typeof fp === "string" && fs.existsSync(fp));
      if (list.length === 0) {
        missingKeys += 1;
        continue;
      }
      for (const fp of list) {
        let text;
        try {
          text = store.get(fp);
        } catch {
          continue;
        }
        const result = applyReplacementsToText(text, patch, fp);
        if (!result.changed) continue;
        store.set(fp, result.text);
        changes.push({
          key,
          file: fp,
          before: Buffer.byteLength(text, "utf8"),
          after: Buffer.byteLength(result.text, "utf8"),
          diff: options.diff ? compactDiff(text, result.text) : "",
        });
      }
    }
    if (changes.length === 0) continue;
    rows.push({
      id: patch.id,
      name: patch.name,
      files: changes,
      bytes: changes.reduce((sum, change) => sum + (change.after - change.before), 0),
    });
  }
  return {
    host,
    version,
    surface,
    rows,
    totalFiles: rows.reduce((sum, row) => sum + row.files.length, 0),
    totalBytes: rows.reduce((sum, row) => sum + row.bytes, 0),
  };
}

export function formatPlan(plan, options = {}) {
  const out = [];
  out.push("dsh-purge-x 应用计划 / dry-run plan");
  out.push(`  宿主版本 ${plan.version || "未识别"}，补丁 ${plan.rows.length} 条，文件 ${plan.totalFiles} 个，字节 ${plan.totalBytes >= 0 ? "+" : ""}${plan.totalBytes}`);
  out.push("");
  if (plan.rows.length === 0) {
    out.push("  ✓ 没有需要写入的内容。");
    return out.join("\n");
  }
  for (const row of plan.rows) {
    out.push(`  [#${String(row.id).padEnd(3)}] ${row.name}  (${row.bytes >= 0 ? "+" : ""}${row.bytes} bytes)`);
    for (const change of row.files) {
      out.push(`         ${change.key}: ${change.before} → ${change.after}  ${change.file}`);
      if (options.diff && change.diff) {
        for (const line of String(change.diff).split("\n")) out.push(`           ${line}`);
      }
    }
  }
  return out.join("\n");
}
