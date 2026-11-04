import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import * as core from "./core.js";
import * as hostctl from "./host.js";
import * as rules from "./rules.js";
import * as updater from "./update.js";
import { clearDrillGrant } from "./drill-grant.js";

// 二开包名优先；旧 dsh-purge 保留识别，便于清理上游同款安装。
const PACKAGE_NAMES = ["dsh-purge-x", "dsh-purge"];

function isPackageName(value) {
  return PACKAGE_NAMES.includes(String(value || ""));
}

function isPackageSpec(value) {
  const s = String(value || "");
  return PACKAGE_NAMES.some((name) => s === name || s.startsWith(`${name}@`));
}

function isPluginItem(item) {
  if (typeof item === "string") return isPackageSpec(item);
  return isPackageName(item?.id) || isPackageName(item?.name);
}

function packageDep(pkg) {
  for (const key of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const name of PACKAGE_NAMES) {
      if (pkg?.[key]?.[name]) return { key, name, spec: String(pkg[key][name]) };
    }
  }
  return null;
}

export function wasApplied(state) {
  if (!state) return false;
  if (state.has_backup) return true;
  if (Number(state.patches_applied) > 0) return true;
  return [state.shim_cmd, state.shim_ps1, state.shim_bin].includes("patched");
}

export function shouldDeletePluginTree(dir, dshHome = core.findDshHome()) {
  if (!dir) return false;
  let real;
  try {
    real = fs.realpathSync(dir);
  } catch {
    real = path.resolve(dir);
  }
  const n = real.replace(/[/\\]+/g, "/").toLowerCase();
  if (PACKAGE_NAMES.some((name) => n.includes(`/node_modules/${name}`))) return true;
  let home;
  try {
    home = fs.realpathSync(dshHome);
  } catch {
    home = path.resolve(dshHome);
  }
  const homeN = home.replace(/[/\\]+/g, "/").toLowerCase();
  return n.startsWith(`${homeN}/profiles/`);
}

export function stripPluginFromPackage(pkg) {
  if (!pkg || typeof pkg !== "object") return false;
  let changed = false;
  for (const key of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    if (!pkg[key]) continue;
    for (const name of PACKAGE_NAMES) {
      if (Object.prototype.hasOwnProperty.call(pkg[key], name)) {
        delete pkg[key][name];
        changed = true;
      }
    }
  }
  for (const key of ["bundles", "plugins"]) {
    if (!Array.isArray(pkg[key])) continue;
    const next = pkg[key].filter((item) => !isPluginItem(item));
    if (next.length !== pkg[key].length) {
      pkg[key] = next;
      changed = true;
    }
  }
  // profile 真正的 bundle 列表在 dsh.profile.bundles。只删依赖不删这里，
  // 卸载后宿主启动时会报 cannot resolve profile bundle 并退出。
  const profileBundles = pkg.dsh?.profile?.bundles;
  if (Array.isArray(profileBundles)) {
    const next = profileBundles.filter((item) => !isPluginItem(item));
    if (next.length !== profileBundles.length) {
      pkg.dsh.profile.bundles = next;
      changed = true;
    }
  }
  return changed;
}

function readJson(fp) {
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(fp, value) {
  fs.writeFileSync(fp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function pkgMentionsPurge(pkg) {
  if (!pkg) return false;
  if (packageDep(pkg)) return true;
  for (const key of ["bundles", "plugins"]) {
    if (!Array.isArray(pkg[key])) continue;
    if (pkg[key].some(isPluginItem)) return true;
  }
  if (Array.isArray(pkg.dsh?.profile?.bundles) && pkg.dsh.profile.bundles.some(isPluginItem)) return true;
  return false;
}

export function listInstalledProfiles(dshHome = core.findDshHome()) {
  const root = path.join(dshHome, "profiles");
  if (!fs.existsSync(root)) return [];
  let names = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const dir = path.join(root, name);
    const pkgPath = path.join(dir, "package.json");
    const pkg = readJson(pkgPath);
    const hasModule = PACKAGE_NAMES.some((pkgName) => fs.existsSync(path.join(dir, "node_modules", pkgName)));
    if (!pkgMentionsPurge(pkg) && !hasModule) continue;
    const dep = packageDep(pkg);
    out.push({ name, dir, spec: String(dep?.spec || ""), pkgPath, hasModule });
  }
  return out;
}

async function unlinkIfExists(fp) {
  try {
    await fsp.unlink(fp);
    return true;
  } catch (e) {
    if (e && e.code === "ENOENT") return false;
    throw e;
  }
}

async function rmIfExists(fp) {
  try {
    await fsp.rm(fp, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

async function removeOverride(dshHome) {
  const fp = core.findOverrideFile(dshHome);
  const ok = await unlinkIfExists(fp);
  return { path: fp, removed: ok };
}

async function resetRules(dshHome) {
  const reset = await rules.resetToOriginal(dshHome);
  const dir = rules.rulesDir(dshHome);
  const removedDir = await rmIfExists(dir);
  return { ...reset, rules_dir: dir, rules_dir_removed: removedDir };
}

function collectCleanupDirs(profiles, dshHome) {
  const seen = new Set();
  const cleanup = [];
  const remember = (dir) => {
    if (!dir) return;
    let real;
    try {
      real = fs.realpathSync(dir);
    } catch {
      real = path.resolve(dir);
    }
    const key = real.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    // 链接只删链接本身。这里若把 realpath 塞进 cleanup，helper 的递归删除会
    // 顺着 junction 清空用户自己的二开目录（link: 安装时的真实事故）。
    let link = false;
    try { link = fs.lstatSync(dir).isSymbolicLink(); } catch { link = false; }
    cleanup.push(link ? path.resolve(dir) : real);
  };

  for (const p of profiles) {
    for (const name of PACKAGE_NAMES) {
      const nm = path.join(p.dir, "node_modules", name);
      if (!fs.existsSync(nm)) continue;
      let real;
      try {
        real = fs.realpathSync(nm);
      } catch {
        real = path.resolve(nm);
      }
      if (shouldDeletePluginTree(real, dshHome)) remember(real);
      if (path.resolve(nm).toLowerCase() !== real.toLowerCase()) remember(nm);
    }
  }

  const dataDir = path.join(dshHome, "dsh-purge");
  remember(dataDir);

  const root = updater.pluginRoot();
  if (shouldDeletePluginTree(root, dshHome)) remember(root);

  return cleanup;
}

function unregisterProfiles(profiles) {
  const stripped = [];
  const errors = [];
  for (const p of profiles) {
    try {
      const pkg = readJson(p.pkgPath) || {};
      if (stripPluginFromPackage(pkg)) {
        writeJson(p.pkgPath, pkg);
        stripped.push(p.name);
      }
    } catch (e) {
      errors.push({ profile: p.name, error: String(e && e.message ? e.message : e) });
    }
  }
  return { stripped, errors };
}

export async function uninstallPurge() {
  const state = await core.gatherState();
  const applied = wasApplied(state);
  const dshHome = state.dsh_home || core.findDshHome();
  const report = {
    ok: true,
    applied,
    reverted: false,
    needRestart: true,
    patches: null,
    shim: null,
    asar: null,
    flash: null,
    override: null,
    rules: null,
    profiles: [],
    cleanup: [],
    errors: [],
  };

  try {
    if (state.ai_base) {
      report.patches = await core.revertAll(state.ai_base);
      if (applied) report.reverted = true;
    }
  } catch (e) {
    report.errors.push(`revert patches: ${e.message || e}`);
  }
  if (applied && (report.patches?.errors?.length || report.errors.some((e) => /^revert patches:/.test(e)))) {
    report.ok = false;
    report.needRestart = false;
    report.cleanup = [];
    return report;
  }

  try {
    report.shim = await core.revertAllShims();
    if (state.shim_cmd === "patched" || state.shim_ps1 === "patched" || state.shim_bin === "patched") {
      report.reverted = true;
    }
  } catch (e) {
    report.errors.push(`revert shims: ${e.message || e}`);
  }

  // 换包时挪走的 app.asar 要放回去：还原后的 dsh.cmd 是官方原文，入口写死 app.asar。
  try {
    report.asar = core.restoreSealedDesktopAsar();
    if (report.asar?.restored) report.reverted = true;
  } catch (e) {
    report.errors.push(`restore asar: ${e.message || e}`);
  }

  try {
    report.flash = core.revertCmdFlash(state.ai_base, dshHome);
  } catch (e) {
    report.errors.push(`revert flash: ${e.message || e}`);
  }

  try {
    report.override = await removeOverride(dshHome);
  } catch (e) {
    report.errors.push(`remove override: ${e.message || e}`);
  }

  try {
    report.rules = await resetRules(dshHome);
  } catch (e) {
    report.errors.push(`reset rules: ${e.message || e}`);
  }

  const profiles = listInstalledProfiles(dshHome);
  report.profiles = profiles.map((p) => p.name);
  const unreg = unregisterProfiles(profiles);
  report.stripped = unreg.stripped;
  report.errors.push(...unreg.errors.map((x) => `${x.profile}: ${x.error}`));
  if (unreg.errors.length) {
    report.ok = false;
    report.needRestart = false;
    report.cleanup = [];
    report.drillGrantCleared = false;
    return report;
  }

  try {
    report.drillGrantCleared = clearDrillGrant(dshHome);
  } catch (e) {
    report.ok = false;
    report.needRestart = false;
    report.cleanup = [];
    report.errors.push(`clear drill grant: ${e.message || e}`);
    return report;
  }

  report.cleanup = collectCleanupDirs(profiles, dshHome);
  return report;
}

export function scheduleCleanupRestart(opts = {}) {
  hostctl.scheduleCleanupRestart(opts);
}
