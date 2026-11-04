import fs from "node:fs";
import path from "node:path";

/**
 * 宿主版本与补丁门控。
 *
 * 上游 dsh-purge 的补丁全部按字符串锚点打，宿主一升级就可能静默失配。
 * 这里只做三件事：
 *   1. 从 @deepseek-ai 包、桌面 app.asar、npm 全局目录里读出真实 dsh 版本；
 *   2. 提供不依赖 semver 包的版本比较与简单区间判断；
 *   3. 让 core 在打补丁前按 hostRange 过滤，旧补丁不会误打到新宿主。
 *
 * 刻意不引 semver：插件要在宿主 node_modules 里运行，少一个运行时依赖少一类安装事故。
 */

/** 默认只认 0.2.0 ~ 0.2.1。0.2.2 alpha / 0.3.x 未校对，先跳过，避免把旧锚点硬打到新宿主。 */
export const HOST_RANGE_DEFAULT = ">=0.2.0-0 <0.2.2-0";

/** 本版本实际对照过的宿主。 */
export const TESTED_HOSTS = Object.freeze(["0.2.0-rc.2", "0.2.1-rc.5"]);

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** 宽松解析：认 "0.2.1-rc.5"、"v0.2.1"、"0.2"（补 .0）。解析失败返回 null。 */
export function parseVersion(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const m = raw.match(VERSION_RE);
  if (m) {
    return {
      raw,
      major: Number(m[1]),
      minor: Number(m[2]),
      patch: Number(m[3]),
      prerelease: m[4] ? m[4].split(".") : [],
    };
  }
  const loose = raw.match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!loose) return null;
  return {
    raw,
    major: Number(loose[1]),
    minor: Number(loose[2] || 0),
    patch: Number(loose[3] || 0),
    prerelease: [],
  };
}

function comparePrerelease(a, b) {
  // 无预发布 > 有预发布（1.0.0 > 1.0.0-rc.1）
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (nx !== ny) {
      // 数字标识符 < 字母标识符
      return nx ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** semver 风格比较。返回 -1 / 0 / 1；任一解析失败返回 null。 */
export function compareVersions(left, right) {
  const a = typeof left === "string" ? parseVersion(left) : left;
  const b = typeof right === "string" ? parseVersion(right) : right;
  if (!a || !b) return null;
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  return comparePrerelease(a.prerelease || [], b.prerelease || []);
}

function upperForCaret(version) {
  const v = parseVersion(version);
  if (!v) return null;
  if (v.major > 0) return { major: v.major + 1, minor: 0, patch: 0, prerelease: [] };
  if (v.minor > 0) return { major: 0, minor: v.minor + 1, patch: 0, prerelease: [] };
  return { major: 0, minor: 0, patch: v.patch + 1, prerelease: [] };
}

function upperForTilde(version) {
  const v = parseVersion(version);
  if (!v) return null;
  return { major: v.major, minor: v.minor + 1, patch: 0, prerelease: [] };
}

function cmp(a, op, b) {
  const c = compareVersions(a, b);
  if (c === null) return false;
  switch (op) {
    case ">": return c > 0;
    case ">=": return c >= 0;
    case "<": return c < 0;
    case "<=": return c <= 0;
    case "=": return c === 0;
    default: return false;
  }
}

/** 只支持本仓库会用到的区间语法：空格分段的 AND、^、~、精确值、*。 */
export function satisfiesRange(version, range) {
  const ver = parseVersion(version);
  const raw = String(range || "").trim();
  if (!ver) return false;
  if (!raw || raw === "*" || raw === "x") return true;
  const tokens = raw.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (token === "*" || token === "x") continue;
    const m = token.match(/^(>=|<=|>|<|=)?\s*(.+)$/);
    if (!m) return false;
    const op = m[1] || "=";
    const value = m[2].trim();
    if (value.startsWith("^")) {
      const low = value.slice(1);
      const high = upperForCaret(low);
      if (!high) return false;
      if (!cmp(ver, ">=", low) || !cmp(ver, "<", high)) return false;
      continue;
    }
    if (value.startsWith("~")) {
      const low = value.slice(1);
      const high = upperForTilde(low);
      if (!high) return false;
      if (!cmp(ver, ">=", low) || !cmp(ver, "<", high)) return false;
      continue;
    }
    if (!cmp(ver, op, value)) return false;
  }
  return true;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function versionFromPackageJson(file) {
  const pkg = readJson(file);
  if (!pkg || typeof pkg !== "object") return null;
  const name = String(pkg.name || "");
  const version = String(pkg.version || "");
  if (!version) return null;
  return { version, name, file };
}

/**
 * 直接读 app.asar 里的单个文件，不落盘、不解包。
 * 官方桌面端在「应用」之前只有 app.asar，插件根目录还不存在；
 * 这一步只读归档头，避免为了报版本把 182MB 解开。
 */
export function readAsarFile(asarPath, innerPath) {
  let fd;
  try {
    const stat = fs.statSync(asarPath);
    if (!stat.isFile()) return null;
    fd = fs.openSync(asarPath, "r");
    const head = Buffer.alloc(16);
    if (fs.readSync(fd, head, 0, 16, 0) !== 16) return null;
    const headerSize = head.readUInt32LE(4);
    const jsonSize = head.readUInt32LE(12);
    if (!jsonSize || jsonSize > 64 * 1024 * 1024) return null;
    const headerBuf = Buffer.alloc(jsonSize);
    if (fs.readSync(fd, headerBuf, 0, jsonSize, 16) !== jsonSize) return null;
    const header = JSON.parse(headerBuf.toString("utf8"));
    const base = 8 + headerSize;
    const parts = String(innerPath || "").replace(/\\/g, "/").split("/").filter(Boolean);
    let node = header;
    for (const part of parts) {
      node = node?.files?.[part];
      if (!node) return null;
    }
    if (node.files) return null;
    if (node.unpacked) {
      const unpacked = `${asarPath}.unpacked`;
      return fs.readFileSync(path.join(unpacked, ...parts), "utf8");
    }
    const size = Number(node.size || 0);
    if (!size) return Buffer.alloc(0).toString("utf8");
    const buf = Buffer.alloc(size);
    if (fs.readSync(fd, buf, 0, size, base + Number(node.offset || 0)) !== size) return null;
    return buf.toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}

function desktopAsarCandidates(execPath = process.execPath) {
  const out = [];
  const exe = String(execPath || "");
  if (!exe) return out;
  const dir = path.dirname(exe);
  const resources = [
    path.join(dir, "resources"),
    path.join(dir, "Contents", "Resources"),
  ];
  for (const res of resources) {
    const asar = path.join(res, "app.asar");
    try {
      if (fs.statSync(asar).isFile()) out.push(asar);
    } catch { /* ignore */ }
  }
  return out;
}

/**
 * 返回 { version, name, source }。
 * candidates 顺序：aiBase 里的包 → 桌面 app.asar → 显式传入的 dshHome/profile。
 */
export function detectHostVersion(aiBase, options = {}) {
  const candidates = [];
  if (aiBase) {
    candidates.push(
      path.join(aiBase, "dsh-base", "package.json"),
      path.join(aiBase, "dsh", "package.json"),
      path.join(aiBase, "dsh-web-app", "package.json"),
      path.join(aiBase, "package.json"),
    );
  }
  for (const fp of options.packageJsonPaths || []) candidates.push(fp);
  for (const fp of candidates) {
    const hit = versionFromPackageJson(fp);
    if (hit && (hit.name.startsWith("@deepseek-ai/dsh") || /^dsh/.test(path.basename(path.dirname(fp))))) {
      return { version: hit.version, name: hit.name, source: hit.file };
    }
  }
  const asarList = options.asarPaths || desktopAsarCandidates(options.execPath);
  for (const asar of asarList) {
    for (const inner of [
      "dsh/node_modules/@deepseek-ai/dsh-base/package.json",
      "node_modules/@deepseek-ai/dsh-base/package.json",
      "dsh/package.json",
      "package.json",
    ]) {
      const text = readAsarFile(asar, inner);
      if (!text) continue;
      try {
        const pkg = JSON.parse(text);
        if (pkg?.version) return { version: String(pkg.version), name: String(pkg.name || ""), source: `${asar}!${inner}` };
      } catch { /* ignore */ }
    }
  }
  return { version: "", name: "", source: "" };
}
