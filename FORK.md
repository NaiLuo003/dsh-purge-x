# dsh-purge-x · 二开说明

> 本目录是 **[YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)** 的二开版本，
> 基于镜像快照的 **v1.1.71**（`dsh-purge-master/`）修改而来。
> 原项目作者：**YuJunZhiXue**；原许可证：**MIT**（本目录 `LICENSE` 原样保留）。
> 按原 README「署名要求」，本二开版本保留原仓库链接与作者署名，不得用于卖课、卖插件、倒卖等收费行为。

---

## 1. 这个版本解决什么问题

上游 v1.1.71 声明适配 **dsh 0.2.0-rc.2**，并已暂停更新；本机官方桌面端实际是 **0.2.1-rc.5**。
宿主升级后，一部分补丁的字符串锚点会静默失配，表现为「点应用没报错，但功能没生效」。

本版本在保留上游全部能力的前提下，增加一层**宿主版本感知 + 锚点审计**，并把 0.2.1-rc.5 的实际差异补上。

## 2. 相对上游的改动

### 2.1 新增模块

| 文件 | 作用 |
| --- | --- |
| `lib/host-version.js` | 版本解析/比较/区间判断；从 `@deepseek-ai/dsh-base/package.json`、桌面端 `app.asar`（只读归档头，不解包）探测真实宿主版本 |
| `lib/compat.js` | 只读审计：按 `ALL_PATCHES` 顺序在内存中模拟 apply（后面的补丁能看到前面的改写），逐补丁检查目标文件、锚点命中数、已应用标记，输出 `pending / applied / anchor-missing / file-missing / unsupported / partial`；另有 `planApply()` dry-run 与 `compactDiff()` 精简 diff |
| `test/*.test.mjs` | 版本比较、区间、审计 rollup、dry-run 输出的单元测试 |

### 2.2 宿主版本门控

- 每条补丁默认落在 `>=0.2.0-0 <0.2.3-0`；补丁可用 `hostRange` 或 `legacy.maxHost` 单独声明。
- `applyPatches` / `patchStatus` 进入时探测宿主版本；不在区间的补丁直接跳过，不会把旧锚点硬打到新宿主。
- 0.3.x 未校对，默认跳过；需要时给补丁加 `hostRange` 再放开。
- 0.1.x 宿主不再默认启用 0.2 补丁链；需要时给补丁加 `hostRange: ">=0.1.0-0 <0.2.0"`。

### 2.3 0.2.1-rc.5 适配

| 补丁 | 变化 |
| --- | --- |
| #32 `WEB_SURFACE_IDENTITY_NEUTRAL` | 0.2.1 把 Web 身份句从 `dsh-web-app` 挪到新包 `dsh-harness-dev-context`。目标文件增加 `dev-context`，并补 3 条新锚点 |
| #53 `WEB_SURFACE_PROHIBITION` | 同上；新增 `dev-context` 的整段身份句替换（同时兼容 #32 先跑后的写法） |
| #40 `COMPLETE_PROMPT_KEEP_INJECT` | 0.2.1 的 `system-prompt` assemble 尾部新增 `requiredContexts`，旧正则失配。新增 0.2.1 专用 pattern，保留 required-context 过滤语义 |
| #101 `DEV_CONTEXT_HARNESS_IDENTITY`（新增） | 去掉 `dsh-harness-dev-context` 里 "DeepSeek Harness implementation checkout"、"Current DeepSeek Harness Web GUI URL" 等产品自称；只改措辞，不动段落结构 |

### 2.3b 0.2.2-rc.2 适配（v2.0.2）

宿主升到 **dsh 0.2.2-rc.2**（`E:\AI\dsh`，desktop-runtime.json `release.version`）后逐锚点比对，改动如下：

**发现层修复（不修这些，补丁再准也找不到宿主）**

| 位置 | 问题 → 修法 |
| --- | --- |
| `lib/desktop.js` `findDesktopAppExecutable()` | 自定义安装盘（如 `E:\AI\dsh`）只登记在卸载注册表里，默认路径不查注册表 → CLI 状态/审计全报「找不到宿主」。注册表查询本来就带缓存（~0.6s），改为默认兜底走 `registryInstallDirs()` |
| `lib/core.js` `officialShellMain()` | CLI 进程自身 surface 是 `web`，桌面壳 `main.js` 被区域门控拒掉 → #45/#46/#83/#84 误报「文件缺失」。改为按 `_patchTargetAiBase` 所在安装树判定桌面面 |
| `lib/core.js` `keepSurfaceFile()` | 同类区域门控 bug：按 CLI 自己的 surface 过滤 `@earendil-works/pi-ai` 等桌面树文件 → #47/#49/#57/#60 误报。改为按 `_patchTargetAiBase` 判定 |

**版本门控**

- `HOST_RANGE_DEFAULT` 从 `<0.2.2-0` 放宽到 `<0.2.3-0`，`TESTED_HOSTS` 增加 `0.2.2-rc.2`。

**补丁锚点 0.2.2 适配（全部经真实安装树逐字比对）**

| 补丁 | 0.2.2 变化 → 处理 |
| --- | --- |
| #12 `APPROVAL_ASK_SENTENCE_BYPASS` | 句式改为 "Approval prompts are enabled in this session: …"，入口双引号 / types 单引号 → 各加一条新 pattern，旧 pattern 保留兼容 0.2.0/0.2.1 |
| #13 `ESCALATION_WIDENING_EXEMPT` | `throw new Error` → `throw new SandboxEscalationError(..., CODE)` → 新增 0.2.2 pattern |
| #14 `ESCALATION_GRANT_UNCONDITIONAL` | `displayReason` 从内联双语对象换成 `escalationDisplayReason(mode, justification)` 调用 → 新增第三 pattern |
| #35 `ESCALATION_NEVER_REJECT` | 同 #13 异常类变化，且 `cancelled` 分支多了 `approval.signal?.throwIfAborted()` → 新增 0.2.2 pattern |
| #18 `REPEAT_TOOL_REMINDER_DISABLED` | post-execute 回调去掉 `downstream.kind === "block"` 分支 → 新增 0.2.2 pattern |
| #40 `COMPLETE_PROMPT_KEEP_INJECT` | assemble 两个 return 都展开成多行并带 `tools` → 新增 `COMPLETE_PROMPT_WATERFALL_INJECT_022`（注入段保留 + `tools` 透传）与对应 regex pattern |
| #74 `ASSEMBLE_BEFORE_PRESTEP` | claim 与 assemble 之间插入 model selection / toolSet 解析 → 新增只锚 `claim` + `selection` 两行的 pattern，后续版本再插中间步骤也不会失配 |
| #67 `AGENT_LOOP_MESSAGES_GUARD` | 外层多包一层 try，缩进 4 → 5 层 tab → 新增 5-tab pattern |
| #62 `OFFICIAL_TOOL_ASK_FAILOPEN` | ask 分派从 `dsh-tools/lib/index.js` 挪进 `lib/pipeline.js`，deny 换成 `approvalDenial(..., APPROVAL_UNAVAILABLE)` → `targetFiles` 新增 `dsh-tools-pipeline` 键，补 3 条 0.2.2 pattern（含 `exec.agent === void 0` 分支） |
| #60 `OFFICIAL_RUN_CODE_APPROVAL_NEUTRAL` | run_code schema 从 `dsh-tools/lib/types/ptc.js` 挪进 `dsh-tool-executor-ptc` → `dsh-tools-ptc` 键补该路径；锚点文本本身未变，命中 |
| #54 `DELIVERABLE_DO_NOT` | "Do not call present…" 教学句挪进新包 `dsh-deliverable-file-references` → `deliverables-prompt` 键补该路径 |
| #82 `DESKTOP_SHELL_PROFILE_FALLBACK` | `main.js` 的 import 后面插了 mime region → 新增锚 import + mime region 头的 pattern |
| #50 `SESSION_REFERENCE_FRAMING_NEUTRAL` | 0.2.2 上游自己把跨会话引用改写为 untrusted 表述 → `hostRange: ">=0.2.0-0 <0.2.2-0"` 收窄，0.2.2 跳过 |
| #56 `REWIND_HIDE_CUT_ONLY` | 0.2.2 重写会话投影：`surfaceOp` replace 由 assembler 的 replacements 表折叠，客户端不再有 `rewindVisibleEntries`/`isRewindMarker` → `hostRange` 收窄到 `<0.2.2-0` |

**0.2.2 实测审计结论（2026-11-13，desktop 面）**：82 条补丁 —— 待应用 66、已应用 5、锚点缺失 2（#21/#80，均为撤销型补丁，全新安装无标记属正常）、文件缺失 7（#76/#71/#28/#30/#31/#64/#65，unrestricted 预设 / 梁神 / hooks 包本机未装）、宿主不支持 2（#50/#56 收窄）、不适用 0，**阻断项 0**。dry-run：66 条补丁 / 89 个文件 / +7972 字节；全量内存模拟 apply 后 28 个 JS 文件全部通过 `node --check`。

### 2.3c 官方更新器打回密封包的自愈（v2.0.2 收尾）

2026-11-14 实机复现链：00:56 换包生效 → 01:29 electron-updater（nightly 渠道）在退出时静默执行 `%LOCALAPPDATA%\@deepseek-aidsh-desktop-updater\installer.exe` 重装官方包 → `app.asar` 被装回（mtime 随安装载荷还原）、`app.asar.bak` 被安装器删除、宿主从密封包启动。此时 `resources\app` 的 61 个补丁与 `.dshpurge.bak` 全部完好，但宿主读不到。修复三层：

| 层 | 位置 | 行为 |
| --- | --- | --- |
| 清缓存 | `desktop.clearDesktopUpdaterPending()`（新） | 换包前读 `resources/app-update.yml` 的 `updaterCacheDirName`，删 `%LOCALAPPDATA%\<cache>\installer.exe` 与 `pending/`；同版本 nightly 删掉后 updater 不会重下重装。挂在 `restartSealedDesktopIfNeeded()` / `scheduleSealedDesktopRestart()` 两条换包路径上 |
| 启动自愈 | `lib/index.js` boot settle | 「sealed 但补丁完好」时不再只保戳（旧路径 `boot:host-untouched` 永远不换包），改为清缓存 → bundle guard → 重新换包重启（`boot:resealing-swap`） |
| helper 加固 | `lib/restart-desktop.js` | killApp 入口落日志、rename 重试进度落日志、rename 失败 copy+unlink 兜底 |

验证：`npm test` 41 pass / 0 fail（新增 `test/updater-pending.test.mjs` 覆盖缓存清理与无 yml 空转）；实机 `clearDesktopUpdaterPending` 清掉了当时已存在的 `installer.exe`。



### 2.3 0.2.1-rc.5 适配

| 补丁 | 变化 |
| --- | --- |
| #32 `WEB_SURFACE_IDENTITY_NEUTRAL` | 0.2.1 把 Web 身份句从 `dsh-web-app` 挪到新包 `dsh-harness-dev-context`。目标文件增加 `dev-context`，并补 3 条新锚点 |
| #53 `WEB_SURFACE_PROHIBITION` | 同上；新增 `dev-context` 的整段身份句替换（同时兼容 #32 先跑后的写法） |
| #40 `COMPLETE_PROMPT_KEEP_INJECT` | 0.2.1 的 `system-prompt` assemble 尾部新增 `requiredContexts`，旧正则失配。新增 0.2.1 专用 pattern，保留 required-context 过滤语义 |
| #101 `DEV_CONTEXT_HARNESS_IDENTITY`（新增） | 去掉 `dsh-harness-dev-context` 里 "DeepSeek Harness implementation checkout"、"Current DeepSeek Harness Web GUI URL" 等产品自称；只改措辞，不动段落结构 |

### 2.4 新增入口

```text
/purge compat [all]   宿主版本 + 每个补丁的锚点审计（只读）
/purge plan           只算会改哪些文件、多少字节，不写盘
/purge plan diff      同上，附带精简 diff
```

```bash
dsh-purge-x --compat             # 人类可读
dsh-purge-x --compat --json      # 机器可读
dsh-purge-x --compat --all       # 连已应用/待应用一起列出
dsh-purge-x --compat --base <@deepseek-ai 目录>   # 指定宿主（多宿主/排查用）
dsh-purge-x --compat --surface desktop           # 强制按桌面面审计（CLI 不在宿主进程内时）
dsh-purge-x --plan               # dry-run
dsh-purge-x --plan --diff        # dry-run + 精简 diff（只显示公共前后缀之间的改动块）
dsh-purge-x --apply --strict     # 审计有阻断项就拒绝写入
```

### 2.5 配置

新增 `compatGuard`（默认 `false`）：

- `true`：点「应用」前先审计；当前宿主在支持区间内、但**必需补丁**锚点对不上时拒绝写入并列出明细。
- `false`：保持上游行为（照常应用，失败项在报告里显示）。

可在 `cordis.patch.yml` 的 `dsh-purge-x` insert 配置里改。

### 2.6 0.2.1 提示词变量修正（`{{cwd}}`）

dsh 0.2.1 的 `system-prompt` 只注册 `provider` / `model`，**不再注册 `cwd`**。上游把 `personaSuffix` 写成
`Your working directory is {{cwd}}.`，在新宿主上会直接抛：

```text
unknown prompt variable "{{cwd}}" in section "deployment:persona-suffix"
```

本版本的处理：

- `cordis.patch.yml` 的 `personaSuffix` 改为空串，不再向宿主注册带 `cwd` 的插值段。
- `lib/identity.js` 的 `CWD_ONLY_SUFFIX` 改为静态句
  `Use the current session working directory when resolving relative paths.`；
  同时识别旧的 `Your working directory is {{cwd}}.` 段落，避免旧会话/旧配置把 `{{cwd}}` 带回来。
- `escapeDshInterpolation` 只放行 `model` / `provider`；`{{cwd}}` 会被拆成 `{ {cwd}}`，不会触发宿主异常。
- `test/identity.test.mjs` 覆盖这两个行为。

### 2.7 首次应用 / 卸载 / 生效问题修复

**密封包换包失败导致「应用了但没效果」**
Windows 上把 `app.asar` 挪走的旧实现走 `ASAR_SWAP_PS1`（PowerShell）：脚本不写日志，
失败时既没有 `.bak` 也没有 `app.asar.rename-pending`。实测它按安装根杀掉了应用进程，
却没有挪走 asar——Electron 优先加载 `app.asar`，于是 `resources/app` 里的补丁全部不生效。
现在 `sealedSwapKind()` 在所有平台统一返回 `helper`，由 `lib/restart-desktop.js`
（Node，纯 `fs`）完成 kill → `renameSync(app.asar → app.asar.bak)` → relaunch，
失败会写进 `%TEMP%\dsh-purge-restart-desktop.log`（`asar move failed after retries`）。
helper 启动失败也会接住异步 `error` 并记日志，不再把宿主崩掉。换包失败时 helper
仍会拉起原版宿主（旧行为是直接退出，用户会看到应用消失），下次「应用」重试。

**官方更新后的自愈**
官方更新器会把 `app.asar` 装回来。原来的升级自愈（标记路径与普通路径）只重写
`resources/app` 补丁、不换包，重启后宿主仍从密封 asar 启动，效果再次丢失。
现在两条自愈路径在 `desktopAsarStillSealed()` 为真时都改走密封换包重启，
并且换包前先跑 `ensureProfileBundles()`，避免重启时 bundle 解析失败。

**shim 判定与还原**
`isTextShim()` 原来用 `hostFs.readSync`，但包装层只按路径路由、没有 fd 版方法，
异常被 `catch` 吞掉后所有文本 shim 都被判成 `binary`，`shimIsPatched()` 恒假。
改为带上限的 `readFileSync`。`revertShim()` 补认 `dsh.cmd.dsh-purge.bak`
（`repairOfficialCliAfterUnpack` 写的备份名），桌面面也会显式还原密封 bin；
`reapplyInstalled()` 在还原后重新调用 `repairOfficialCliAfterUnpack()`，
避免启动自愈把 CLI 入口回退链弄丢。

**卸载回滚密封包**
卸载时 `uninstallPurge()` 调 `restoreSealedDesktopAsar()`，把换包时挪走的
`app.asar.bak` 改回 `app.asar`。还原后的 `dsh.cmd` 是官方原文、入口写死
`app.asar`；不装回去，卸载后 CLI 会 `Cannot find module`。

**注入链集成验证**
`test/host-assemble.integration.test.mjs` 用宿主自带的 cordis 实例化**解包后的**
`dsh-system-prompt`，并把插件真实的 `rewritePromptAssembly()` 作为
`system-prompt/assemble` 瀑布跑进去，断言：注入段置顶、`complete` 段仍在末尾、
`harness:identity` 文本为空。找不到已打补丁的宿主时自动跳过。
当前在 dsh 0.2.1-rc.5 上通过（36/36）。

**诊断与回归**
启动时若宿主仍从 `app.asar` 启动，日志会写 `[boot.sealed] hint=...click_apply_to_swap`；
`test/client-css.test.mjs` 锁住卸载弹窗的实色背景与遮罩层级。

**0.2.1-rc.5 实机闭环（2026-11-02）**
换包后（`app.asar → app.asar.bak`，宿主从 `resources/app` 启动）：
面板显示 `v2.0.1 / 64 of 66 / sealed=false`；卸载确认框实色渲染；
新会话装配日志 `[assemble.rewrite] injectBytes=20964 injectHead=true cap=true strip=true`，
即注入内容已进入真实会话的系统提示词头部。

**0.2.1-rc.5 幂等重放与宿主自启（2026-11-03）**
- 夜间宿主两次自启（08:xx 与 11:08）均正常：无 crash log、`assemble` 日志连续、live 状态保持 `sealed=false / applied=64 / pending=0`。
- 在真实 aiBase 上直接调用 `applyPatchesAllHosts`（UI「应用」背后的同一函数）：66 条补丁全部 `already`，`cmd-flash ok=true`，`hostWritten=true`——幂等重放零写入。
- DSL 端口会随宿主重启变化（3080 → 22397 → 64605）；面板数据源自当前端口，跨重启不要记死端口。
- 已知噪音（非阻断）：面板滚动位置偶发弹回顶部，需手动再滚到 Hooks/按钮区；模拟外部位图点击在 Win11 125% DPI 下必须叠加窗口原点偏移（`GetWindowRect` 的 Left/Top），否则系统性偏移约 65px——人工操作无此问题。
- 卸载确认框已在本机 UI 二次走通：点「卸载」→ 实色弹窗渲染正常 → 点「取消」关闭；取消后 live 状态保持 `applied=64 / pending=0 / hooks=true`，配置零漂移。
- **Apply→重启全链实机走通（2026-11-03 11:39Z）**：点「应用」→「现在重启」→ helper `kill+relaunch`（`relaunched via execPath (argv=["--updated"])`）→ 宿主新进程加载 `resources/app/dsh`（进程命令行可查）→ 新端口 37048 状态接 `ok/ready=true, sealed=false, applied=64, pending=0, v2.0.1`。重启期间无 crash log、无弹窗。
- 全部验证证据链（日志摘录、真机操作记录、明确未验证项清单）落盘独立复查文档：`docs/evidence-report.md`。关键统计：`[boot] enabled=true` 共 18 次、`cannot resolve / skipping profile bundle` = 0 次（`%TEMP%\dsh-purge-desktop.log` 全文检索）。

同时把 host 自退出窗口从 1.5s 放宽到 6s：未打补丁的 `main.js` 把**任何** host 关闭
（包括 `exit 0`）都报成 `dsh desktop host stopped` 并弹崩溃框，必须让 helper 先杀掉
Electron。旧 main.js 里这段逻辑可从 `app.asar/lib/main.js` 直接读到。

**CLI 入口补丁写不进去（EPERM）**
`runtime/cli/bin/dsh.cmd` 在 Windows 上被占用时，`atomicWriteSync` 的
`rename(tmp → dsh.cmd)` 返回 `EPERM`，补丁被静默跳过；一旦 `app.asar` 被挪走，
启动脚本仍写死 `app.asar\...\cli.js`，宿主直接 `Cannot find module`。
现在 `atomicWriteSync` / `atomicWriteFile` 在 `EPERM/EBUSY/EACCES/EXDEV` 时回退为原地写；
`restartSealedDesktopIfNeeded` 在换包前再跑一次 `repairOfficialCliAfterUnpack`，
保证入口回退链（`app.asar → app.asar.unpacked → app`）已就位。

**首次应用报 `cannot resolve profile bundle "dsh-purge-x"`**
宿主的解析链是「安装目录 → profile 的 `node_modules`」，两者都找不到就跳过整个 bundle，
宿主随后退出，Electron 弹崩溃框。新增 `lib/profile-bundle.js`：

- `/dsh-purge/restart`（UI 的「应用后重启」）与 `scheduleApplyRestart` 在重启前调用
  `ensureProfileBundles()`；
- 只要某个 profile 的 `dsh.profile.bundles` 列了本插件但 `node_modules/<name>/package.json`
  不存在，就按 profile 里既有的 `link:` / `file:` 目标补回 junction；依赖声明缺失时用当前
  插件目录兜底并写回 `dependencies`；
- 补不回来（目标目录也不存在）就不重启，在面板里给出可执行的 `pnpm install` 提示。

`test/profile-bundle.test.mjs` 覆盖重连、补依赖、无目标报错、健康 profile 不动四种情况。

**卸载确认框透明**
`.dshp-modal` 原来用 `--dshp-paper`，它在 dock 里被覆盖成 `ink 7%`（几乎全透明），
弹窗文字直接叠在下面的说明上。改为和重启卡片一致的实色
`--dsw-alias-bg-layer-1` + `--dsw-alias-label-primary`，两套主题都不再透底；
另补 `max-height:70vh` 与滚动。

**卸载后 bundle 残留**
`stripPluginFromPackage()` 原先只删 `dependencies` 和顶层的 `bundles` / `plugins`，
而 profile 真正读取的是 `dsh.profile.bundles`。卸载后依赖没了、bundle 名还在，
下一次启动宿主就报 `cannot resolve profile bundle "dsh-purge-x"` 并退出。
现在依赖、顶层列表与 `dsh.profile.bundles` 一并清理，`pkgMentionsPurge()` 也认得
只剩 bundle 条目的 profile，`test/uninstall.test.mjs` 覆盖这三种情况。

**`compactDiff` 单测**
无差异时正确的 unified diff 是空串，测试原先写的是 `@@ -1,0 +1,0 @@`，已修正断言。

## 3. 兼容矩阵与验证

| 宿主 | 状态 | 验证方式 |
| --- | --- | --- |
| dsh **0.2.2-rc.2**（官方桌面，`E:\AI\dsh`） | ✅ 已适配（v2.0.2） | 逐补丁对真实安装树比对锚点；审计阻断项 0；dry-run 66 补丁 / 89 文件 / +7972 字节；全量内存模拟 apply 后 28 个 JS 全过 `node --check` |
| dsh **0.2.1-rc.5**（官方桌面） | ✅ 已适配 | 从本机 `E:\AI\dsh\resources\app.asar` 解析真实宿主版本；对解包后的 `@deepseek-ai` 副本执行全量应用，49 个文件被改写，全部 JS 通过 `node --check`；审计阻断项 0 |
| dsh **0.2.0-rc.2** | ✅ 保持兼容 | 从 npm 拉取 38 个 `@deepseek-ai/*@0.2.0-rc.2` 包做对照；审计阻断项 0，dry-run 59 条补丁 |
| dsh 0.3.x / 未识别 | ⚠️ 保守跳过 | 超出默认 `hostRange` 的补丁状态为 `unsupported`，不写入；需要重新校对锚点后再放开 |
| dsh 0.1.x | ❌ 不支持 | 使用上游 1.1.39 及更早版本 |

审计输出示例（0.2.2-rc.2，desktop 面）：

```text
宿主版本 0.2.2-rc.2
补丁 82 条：待应用 66，已应用 5，锚点缺失 2，文件缺失 7，宿主不支持 2，不适用 0
✓ 没有阻断项。
```

> 说明：`锚点缺失 2` 是 #21（迁移专用，只有宿主带着上游标记时才需要）和 #80（可选清理补丁，撤销旧写入）；`文件缺失 7` 是本机未装的可选包（unrestricted 预设 / 梁神 / hooks-claude-code / hooks-codex）；`宿主不支持 2` 是 #50/#56（0.2.2 上游自己实现了对应语义，按版本收窄）。这些都不阻断应用。
> 0.2.1 下 #4 不再解析已成 presets/*.patch.yml 新形态的内置预设（那是 #43 的目标范围），避免把 #43 写好的形态误报成 anchor-missing。

## 4. 安装

本目录的包名是 **`dsh-purge-x`**（当前版本 2.0.2），不是上游的 `dsh-purge`。
装进 profile 后，宿主里显示的插件名、CLI 主命令、UI 卡片都是 `dsh-purge-x`；
`dsh-purge` 只作为兼容别名保留（`bin` 里两个名字指向同一个入口）。

虽然包名不同，**本版本仍然改写同一批宿主文件**：同一个 profile 不要同时保留上游
`dsh-purge` 与本版本，两个都装会互相覆盖补丁。先卸载上游，再装本版本。
如果之前装过旧包名（`dsh-purge`）下的本二开版，先跑旧包的 `dsh-purge --uninstall`
还原补丁并从 profile 移除，再按下面的新包名安装。

**桌面端**

```bash
dsh plugin --profile desktop add "file:E:/0x00wzzbl-project/dsh/dsh-purge-x"
```

**Web**

```bash
dsh plugin --profile web add "file:E:/0x00wzzbl-project/dsh/dsh-purge-x"
```

装完后按上游流程：重启对应宿主 → 会话标题旁 **dsh-purge-x** → **清洗** → **应用**。
应用前建议先：

```bash
dsh-purge-x --compat    # 确认宿主版本与阻断项
dsh-purge-x --plan      # 确认会改哪些文件
```

如果插件管理器不认 `file:`，在 `~/.dsh/profiles/<profile>/package.json` 的 `dependencies` 里写：

```json
"dsh-purge-x": "file:E:/0x00wzzbl-project/dsh/dsh-purge-x"
```

再在 `~/.dsh/profiles/<profile>` 目录执行 `pnpm install`，然后重启宿主。

## 5. 回滚与卸载

与原版一致：

```bash
dsh-purge-x --revert      # 还原补丁，保留 prompt-inject.md
dsh-purge-x --uninstall   # 先还原，再从 profile 移除插件
```

补丁写入前的 `.dshpurge.bak` 备份机制未改动。

## 6. 已知边界

- **不改上游红队流程**：`lib/redteam/`、`presets/redteam/`、`skills/redteam/` 原样保留；本版本只动宿主适配与补丁引擎。
- **#77 `REWIND_DROP_SENT_ON_APPEND`（已退役）**：0.2.x 的 `dsh-client-ui-conversation` 已没有补丁依赖的 `isRewindMarker`，旧锚点虽在，注入后每次 `append()` 都会 `ReferenceError`。本版本把它标记为 `retired`，不再进入 apply / status / audit。
- **#21 `BASH_TIMEOUT_RESTORE`**：仅用于撤销上游旧版本写下的 `600000 # [dsh-purge] bash timeout raised` 标记；全新安装没有该标记，显示锚点缺失属正常。
- **桌面壳补丁（#45/#46/#83/#84）**：需要官方桌面端解包出 `resources/app` 后才能定位；在密封 `app.asar` 状态下审计显示「文件缺失」属正常，点应用后会自动解包并重试。
- **包名与引擎标识分开**：对外包名、插件名、CLI 主命令、UI 卡片是 `dsh-purge-x`；但提示词 section 名（`dsh-purge`、`dsh-purge:rules`、`dsh-purge:post`）、HTTP 路由 `/dsh-purge/*`、设置命名空间 `settings.dsh-purge`、数据目录 `$DSH_HOME/dsh-purge`、补丁锚点标记与日志前缀仍是 `dsh-purge`。宿主补丁按这些字符串做过滤与锚点，跟着包名改会让补丁失配、旧状态失联。
- **自更新仍指向上游**：UI 里的更新按钮走 `YuJunZhiXue/dsh-purge` 仓库；二开目录里不要点，会把上游 1.1.71 覆盖进来。
- **未发布到 npm**：`private: true`，只通过本地路径安装，包名 `dsh-purge-x`。

## 7. 署名

- 原项目：**dsh-purge — DeepSeek Harness 破甲**，作者 **YuJunZhiXue**
- 原仓库：<https://github.com/YuJunZhiXue/dsh-purge>
- 镜像来源：`dsh/dsh-purge-master/`（包含 `MIRROR-NOTICE.md` 的完整镜像快照）
- 本二开目录：`dsh/dsh-purge-x/`，包名 **`dsh-purge-x`**，版本 **2.0.2**，基线 **1.1.71**
- 许可证：MIT，`LICENSE` 未改动

借用本项目的名称、思路、代码或提示词，必须保留以上署名与原仓库链接。
原项目的非盈利条款继续适用：不得用于卖课、卖插件、卖 token、倒卖等收费行为。
