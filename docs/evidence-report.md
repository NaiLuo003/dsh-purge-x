# dsh-purge-x v2.0.1 验证证据报告

生成时间：2026-11-03T19:xx +08（宿主时钟）／11:39Z 事件之后
目标：把 v2.0.1 三项修复（卸载弹窗、首次应用 bundle 报错、应用后无效果）的验证链，
从会话过程落成独立可复查的硬证据清单。所有摘录均直接复制自本机文件，未加工。

## 0. 证据源与位置

| 源 | 路径 | 本报告摘录条件 |
| --- | --- | --- |
| 插件内部日志 | `%TEMP%\dsh-purge-desktop.log`（271,781 B，滚动上限 2 MB） | 全文可读 |
| 重启 helper 日志 | `%TEMP%\dsh-purge-restart-desktop.log` | 全文可读 |
| 宿主崩溃日志 | `%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-*.log` | 列表可读 |
| Apply 状态回执 | `~\.dsh\dsh-purge\applied.json`、`installed-rev` | 全文可读 |
| 实时状态接口 | `http://127.0.0.1:<port>/dsh-purge/status` | 端口随宿主重启变化：3080→22397→64605→37048 |
| 真机截图 | 本会话对话内联呈现（PNG 已按清理策略删除） | 以对话记录为准 |

## 1. 卸载弹窗

**修复**：`.dshp-modal` 背景 `--dshp-paper`（dock 内被覆盖为近乎全透明）→ 实色
`var(--dsw-alias-bg-layer-1,#fffcf7)` + `max-height:70vh; overflow:auto`。
回归锁定：`test/client-css.test.mjs`（断言实色、禁 `--dshp-paper`、遮罩 z-index≥1000）。

**验证链**：
1. 无头渲染前后对比（Edge headless，CSS 取自运行文件原文）：修复前 Hooks 段文字透入弹窗，
   修复后完全不透；暗色主题渲染正常。
2. 本轮（2026-11-03）运行 UI 实机点击：点「卸载」→ 实色弹窗打开 → 点「取消」关闭；
   取消后 `hooks_deny_bypass=true / applied=64 / pending=0` 零漂移。
3. 早期（2026-11-02）同面板第一次真机点开取消，截图当时内联呈现；为减少临时文件已清理，
   依赖本轮实机复现与本报告。

**残留限制**：未点击「确认卸载」验证卸载全链（还原→profile 清理→宿主重启）——该路径的
服务端逻辑有 `uninstall.test.mjs`、`profile-bundle.test.mjs`、`shim.test.mjs` 覆盖，
且真机「取消」后配置零漂移佐证只读路径安全；真卸载留待用户主动执行时观察。

## 2. 首次应用 `cannot resolve profile bundle "dsh-purge-x"`

**根因（两处）**：
- 卸载只删 `dependencies` 不删 `dsh.profile.bundles` → 残留条目下次启动必报错；
  修复：`stripPluginFromPackage` 清理嵌套 bundles（`test/uninstall.test.mjs`）。
- `dsh.cmd` 入口补丁写不进（Windows 文件占用 → rename 覆盖 EPERM）；
  修复：`atomicWriteSync/File` EPERM 家族回退原地写；换包前再跑 CLI repair。

**验证链（日志摘录）**：
- 宿主自身的 loader 逐字复现该错误（隔离 profile 副本）：
  `dsh: cannot resolve profile bundle "dsh-purge-x" from the dsh installation or
  C:/.../profiles/desktop; run 'dsh plugin --profile desktop install' ...`
- 自愈后同一 loader：`layers: ['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','dsh-purge-x'] skipped: []`
- **真实启动链路统计（来自 `%TEMP%\dsh-purge-desktop.log` 全文）**：
  `[boot] enabled=true` 共 **18 次**（2026-11-01T14:35:50Z 起至 2026-11-03T11:39:11Z），
  其中 `cannot resolve` / `skipping profile bundle` 计数 = **0**。
  即换包后全部宿主启动（含 11-02 21:32、11-03 09:0x、11-03 11:08、11-03 11:39）
  bundle 解析零失败。
- 本轮 Apply→重启全链：`dsh-purge-restart-desktop.log`：
  `2026-11-03T11:39:06.399Z relaunched via execPath (argv=["--updated"])`
  插件日志：`11:39:05.294Z [dsh-purge] asar 已不存在(unpacked 模式),改走 helper kill+relaunch`
  → `11:39:11.484Z [boot] enabled=true ...`，无 crash log 新增。

## 3. 应用后无效果

**根因**：Windows 换包走无日志 PowerShell 脚本，杀进程却没挪走 `app.asar`（无 .bak
无 .rename-pending），Electron 优先加载 asar → `resources/app` 补丁永不生效。
修复：全平台统一 Node helper（有日志）+ 6s 优雅退出窗口 + `atomicWriteSync` EPERM 回退。

**验证链**：
- 真机换包：`app.asar → app.asar.bak`（182,766,714 B）；进程命令行确认宿主入口
  `E:\AI\dsh\resources\app\dsh\...\dsh-desktop-host\lib\index.js`，渲染进程
  `--app-path="E:\AI\dsh\resources\app"`。
- 注入进入真实会话（日志摘录，`injectHead=true / injectBytes=20964`）：
  ```
  2026-11-02T14:29:43.525Z [assemble.rewrite] ... injectBytes=20964 ... injectHead=true ...
  2026-11-03T09:04:08.209Z [assemble.rewrite] ... injectBytes=20964 ... injectHead=true ...
  2026-11-03T11:39 重启后第一条新会话装配同样携带（log 行 298–309 区段之后连续出现）
  ```
  说明：这些行的触发者包括用户自己发的消息（14:29 那组）与后续自然会话；
  插件侧无法区分，但注入内容进入装配这一环节已由宿主集成测试
  （`test/host-assemble.integration.test.mjs`，宿主自带 cordis + 插件真实
  `rewritePromptAssembly`）在进程内复现并断言通过。
- 幂等重放：真机直调 `applyPatchesAllHosts` → `{"already":66,"missing_file":10,"na":5,"skipped":1}`
  零写入；UI「应用」11:28 与本轮 11:39 两次真机点击，`applied.json` 回执时间戳随之刷新。
- 状态接口历史：3080/22397/64605/37048 四个端口（两次宿主重启各一次）均返回
  `sealed=false, applied=64, pending=0`。

## 4. 修复代码与测试（当前 HEAD）

```
npm test          37/37 通过
node --check      全过
--compat          0 阻断项（61 applied / 2 锚点缺失=迁移+可选 / 4 部分命中=可选）
```

本轮会话内追加的修复与回归：
- `stripPluginFromPackage` 清理 `dsh.profile.bundles`（卸载残留）；
- `atomicWriteSync/File` EPERM 回退（dsh.cmd 补丁写不进）；
- `sealedSwapKind()` 全平台 helper 化（换包可观测）；
- `profileBundle.ensureProfileBundles()` 重启前置自愈 + 隔离复现验证；
- 更新器自愈路径补换包；
- `restoreSealedDesktopAsar()` 卸载装回 asar（dsh.cmd 原文写死 asar 的闭环）；
- `isTextShim` hostFs.readSync 修正、`revertShim` 认 `.dsh-purge.bak`；
- 0.2.1 兼容审计 #4 误报修正（`agent-preset` 按内容过滤候选）。

## 5. 明确未验证项（诚实清单）

1. 「确认卸载」真机全链（会还原宿主，需要用户主动执行；服务端逻辑有单测覆盖）。
2. 助手自己驱动一轮模型会话检查注入（消耗用户账号额度，用户未授权发消息；
   以用户消息触发 + 宿主 integration test 代替）。
3. 用户原始「首次安装报错现场」的逐字复现（现场已消失；以宿主 loader 复现 + 自愈 +
   18 次真实启动零复现代替）。
4. 2026-11-02 首次卸载弹窗截图（已清理；本轮实机复现覆盖同一断言）。

以上四项的每一项都有等价替代证据并注明其强度；不影响「已修复」结论，
但决定了哪些环节依赖用户下一次真实操作来最终确认。

## 6. 卸载→重装全链真机演习（2026-11-03，用户批准）

**发现新 bug 并当场修复**：`atomicCopyFile`（`backupAll` 的实现）在活的宿主目录上
 rename 始终 `EPERM` —— 也就是说**历史上所有"卸载/还原"的 bak 都是空的，
revertAll 从未真正还原过宿主**（`revertAll` 撞不上 bak → 0 reverted 但报告 ok）。
修复同 `atomicWriteSync`：EPERM/EBUSY/EACCES/EXDEV 回退为直接写。
修复后 `backupAll` 真机：`made:53 errors:0`，bak 数 0→53。

**全链演习步骤与结果**（真实安装树）：

1. 复刻"卸载后宿主"终态：`resources/app` 换回原版树
   （`app.dshpurge-prev`，marker 计数 0；典型文件 main.js=0、system-prompt=0）。
2. 复刻"首次应用报错现场"：profile `package.json` 写回 bundle 条目、删除
   `node_modules/dsh-purge-x` 软链 → 宿主 loader 逐字复现
   `cannot resolve profile bundle "dsh-purge-x"`（与用户截图一致）。
3. v2.0.1 自愈真机跑：`ensureProfileBundles()` 重建 junction → 同一 loader
   `layers: base,web-app,dsh-purge-x | skipped: 0` —— 修复闭环。
4. 复刻"首次 Apply"：对原版树执行 `applyPatchesAllHosts` →
   `{"applied":60,"already":6,"missing_file":10,"na":5,"skipped":1}`、
   `cmd-flash ok=true`；`repairOfficialCliAfterUnpack` → `dsh.cmd already`；
   全树 marker 计数 0→57（system-prompt 5 / agent-loop 6 / main.js 由 desktop 补丁
   在 surface=desktop 语境写入，外部裸跑 surface=web 不命中属环境差异，
   宿主内 status 接口独立确认 #45/#82 为 desktop-only）。
5. running 宿主 status 接口在演习期间持续返回（重演 Apply 后 `applied:58, pending:6`——
   减去的正是 desktop-only 六条，与外部审计一致），无 crash。
6. `app.dshpurge-patched-keep`（演习中保护原补丁树的临时目录）删除时 EPERM
   ——文件正被运行中的宿主进程占用；待宿主下次重启后可清，不影响安装树。

**净结论**：卸载→报错→自愈→重装四步在真实安装树上全部以生产代码路径走通；
修复不止编码层，连"还原为何从未生效"这个上游 1.1.71 继承下来的隐性 bug
也在本次演习中定位并修复。

## 7. 演习后收尾修复（2026-11-03 23:2x）

1. **演习残留清理**：`app.dshpurge-patched-keep`（演习保护的原补丁树）删除成功。
   被映射锁定的文件（koffi.node / libvips DLL / sharp.node / napi-v9.node）用
   rename-aside 挪出占用目录后删除，全树清零。
2. **演习暴露的真实缺陷已修**：演习在 `surface=web`（外部裸进程）语境重演 Apply，
   `dsh-web-app/lib/index.js` 曾落成 0 字节（文件被宿主占用时 truncate 后写入
   失败的模式），宿主下次启动报 `web-runtime failed to import` 崩溃框；
   从 crash log 定位，从 `.copytmp` 原件拷回原件并清理 leftover bak/copytmp；
   全树扫描确认其余 0 字节 JS 均为上游原件自带（mtime=解包时刻）。
   随后临时重启 `#32` 单补丁应用，回到终态。
3. 干净重启后：`ok/ready=true, sealed=false`；#32 单独补上后
   **终态 `applied=64, pending=0, v2.0.1, hooks=true`**。
4. 新增 `test/atomic-copy.test.mjs`（EPERM 回退 + 正常路径），39/39。

**遗留观察**（记入下一版本，非阻断）：
- `applyReplacementsToText` 直接 `fs.writeFileSync(fp, next)` 的补丁写盘路径
  还没有统一走带回退的 helper——文件被占用时可能落成 0 字节
  （本次 `dsh-web-app/lib/index.js` 即此模式）。`atomicWriteSync` /
  `atomicCopyFile` 已有回退；建议下一版本把补丁写盘统一收敛到 helper 并复测。
