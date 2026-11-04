/**
 * profile bundle 自愈。
 *
 * dsh 启动时会逐个解析 `dsh.profile.bundles`；解析不到就跳过整层补丁，
 * 宿主随后退出（Electron 的 main.js 把它当成 "host stopped" 弹崩溃框）。
 * 实测场景：插件已经写进 profile 的 dependencies / bundles，但
 * node_modules/<name> 这一层 link 不见了（pnpm link: 被清理、目录被挪、
 * 或安装中途重启），下一次重启就报：
 *
 *   dsh: cannot resolve profile bundle "dsh-purge-x" from the dsh installation
 *   or C:\Users\...\.dsh\profiles\desktop
 *
 * 这里在重启前做一次只读探测：缺哪一层就按 profile 里已有的依赖声明
 * （link: / file:）把软链补回去，补不回来就明确报错、不重启。
 */
import fs from "node:fs";
import path from "node:path";
import { atomicWriteSync } from "./core.js";

const PACKAGE_NAMES = ["dsh-purge-x", "dsh-purge"];

function readJson(fp) {
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(fp, value) {
  atomicWriteSync(fp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function depSpec(pkg, name) {
  for (const key of ["dependencies", "devDependencies", "optionalDependencies"]) {
    if (pkg?.[key]?.[name]) return { key, spec: String(pkg[key][name]) };
  }
  return null;
}

function hasManifest(dir) {
  try {
    return Boolean(dir) && fs.existsSync(path.join(dir, "package.json"));
  } catch {
    return false;
  }
}

function localSpecTarget(profileDir, spec) {
  const raw = String(spec || "").replace(/^(link|file):/i, "");
  if (!raw || raw === spec && /^(git|https?|npm):/i.test(spec)) return "";
  return path.resolve(profileDir, raw);
}

function removeBrokenEntry(fp) {
  let st;
  try {
    st = fs.lstatSync(fp);
  } catch {
    return;
  }
  if (st.isSymbolicLink() || st.isFile()) {
    fs.unlinkSync(fp);
    return;
  }
  // 目录入口（junction 以外的手工拷贝）只删空目录，不动用户数据。
  try {
    fs.rmdirSync(fp);
  } catch {
    // 非空目录保留，交给调用方报错
  }
}

function linkDir(target, linkPath) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  removeBrokenEntry(linkPath);
  if (fs.existsSync(linkPath)) {
    throw new Error(`${linkPath} 已存在且无法替换`);
  }
  fs.symlinkSync(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}

function namesInBundles(pkg) {
  const bundles = pkg?.dsh?.profile?.bundles;
  if (!Array.isArray(bundles)) return [];
  return PACKAGE_NAMES.filter((name) => bundles.includes(name));
}

function profileDirs(dshHome) {
  const root = path.join(dshHome, "profiles");
  let names = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  return names
    .map((name) => path.join(root, name))
    .filter((dir) => hasManifest(dir));
}

/**
 * 保证每个把本插件列进 `dsh.profile.bundles` 的 profile 都能解析到包目录。
 * @param {object} opts
 * @param {string} opts.dshHome
 * @param {string} [opts.pluginRoot] 本插件源码目录（dependencies 缺失时兜底写入）
 * @returns {{ok: boolean, repaired: Array<object>, errors: string[]}}
 */
export function ensureProfileBundles({ dshHome, pluginRoot = "" } = {}) {
  const repaired = [];
  const errors = [];
  if (!dshHome) return { ok: true, repaired, errors };
  for (const dir of profileDirs(dshHome)) {
    const pkgPath = path.join(dir, "package.json");
    const pkg = readJson(pkgPath);
    if (!pkg) continue;
    const listed = namesInBundles(pkg);
    if (listed.length === 0) continue;
    for (const name of listed) {
      const linkPath = path.join(dir, "node_modules", name);
      if (hasManifest(linkPath)) continue;
      const dep = depSpec(pkg, name);
      let target = dep ? localSpecTarget(dir, dep.spec) : "";
      if (!hasManifest(target)) target = "";
      if (!target && name === "dsh-purge-x" && hasManifest(pluginRoot)) target = pluginRoot;
      if (!target) {
        errors.push(
          `${path.basename(dir)}: profile 里列了 bundle "${name}"，但 node_modules 下没有它，也找不到可用的 link 目标；`
          + `请在 ${dir} 里执行 pnpm install（或 dsh plugin --profile ${path.basename(dir)} install）`,
        );
        continue;
      }
      try {
        linkDir(target, linkPath);
        // 顺手把依赖声明补全，避免下次 pnpm install 把 link 当成多余条目清掉。
        if (!dep || localSpecTarget(dir, dep.spec) !== target) {
          pkg.dependencies = pkg.dependencies || {};
          pkg.dependencies[name] = `link:${target.replace(/\\/g, "/")}`;
        }
        if (!Array.isArray(pkg.dsh.profile.bundles)) {
          pkg.dsh = pkg.dsh || {};
          pkg.dsh.profile = pkg.dsh.profile || {};
          pkg.dsh.profile.bundles = [name];
        }
        writeJson(pkgPath, pkg);
        repaired.push({ profile: path.basename(dir), name, target });
      } catch (e) {
        errors.push(`${path.basename(dir)}: 无法补回 node_modules/${name}: ${e && e.message ? e.message : e}`);
      }
    }
  }
  return { ok: errors.length === 0, repaired, errors };
}

/** 自愈失败时给用户看的整段提示。 */
export function formatGuardFailure(result) {
  return [
    "已取消重启：profile 里的插件包无法解析，重启会让宿主启动失败并弹崩溃框。",
    ...(result.errors || []).map((line) => `  · ${line}`),
    "",
    "处理完再点「应用」：在对应 profile 目录执行 pnpm install。",
  ].join("\n");
}
