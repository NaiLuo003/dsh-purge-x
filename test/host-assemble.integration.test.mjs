/**
 * 集成测试：调用**打过补丁的宿主** dsh-system-prompt，验证注入段不被吞。
 * 只在本机存在官方桌面宿主时运行；找不到就跳过，不影响其他环境。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { rewritePromptAssembly } from "../lib/identity.js";

const CANDIDATES = [
  process.env.DSH_PURGE_HOST_AI_BASE || "",
  "E:/AI/dsh/resources/app/dsh/node_modules/@deepseek-ai",
  path.join(process.env.LOCALAPPDATA || "", "DeepSeek Harness/resources/app/dsh/node_modules/@deepseek-ai"),
].filter(Boolean);

function findHost() {
  for (const dir of CANDIDATES) {
    const spDir = path.join(dir, "dsh-system-prompt");
    const cordisDir = path.join(dir, "cordis");
    if (!fs.existsSync(path.join(spDir, "lib", "index.js"))) continue;
    if (!fs.existsSync(path.join(cordisDir, "lib", "index.js"))) continue;
    const source = fs.readFileSync(path.join(spDir, "lib", "index.js"), "utf8");
    if (!source.includes("[dsh-purge] complete prompt keeps inject")) continue;
    return { sp: path.join(spDir, "lib", "index.js"), cordis: path.join(cordisDir, "lib", "index.js") };
  }
  return null;
}

const host = findHost();

test("patched host keeps the dsh-purge inject section and its order", { skip: host ? false : "未找到已打补丁的官方桌面宿主" }, async () => {
  const { Context } = await import(pathToFileURL(host.cordis).href);
  const sp = await import(pathToFileURL(host.sp).href);
  const ctx = new Context();
  const service = new sp.SystemPrompt(ctx, {
    includeHarnessIdentity: true,
    personaPrefix: "PERSONA",
    personaSuffix: "",
    toolOrder: undefined,
  });
  service.section({ name: "dsh-agent-instructions", order: 100, text: "AGENT-INST" });
  service.section({ name: "dsh-final", order: 900, text: "FINAL-BODY", complete: true });
  // 模拟插件的 system-prompt/assemble 瀑布：直接走插件自己的 rewritePromptAssembly，
  // 也就是运行时不打任何折扣的那段代码。
  ctx.waterfall = async (target, event, assembly) => (
    event === "system-prompt/assemble"
      ? rewritePromptAssembly(assembly, "SENTINEL-PLUGIN-INJECT", { context: {} })
      : assembly
  );

  const out = await service.assemble({});
  const names = out.sections.map((section) => section.name);
  assert.ok(names.includes("dsh-purge"), `缺 dsh-purge 段: ${names.join(" | ")}`);
  assert.ok(out.sections.some((section) => String(section.text || "").includes("SENTINEL-PLUGIN-INJECT")));
  // 注入段置顶，complete 段保持在最后（补丁 #40 的语义）。
  assert.equal(names[0], "dsh-purge");
  assert.equal(names[names.length - 1], "dsh-final");
  // 身份段被清空（补丁 #1/#32 的语义）。
  const identity = out.sections.find((section) => section.name === "harness:identity");
  if (identity) assert.equal(String(identity.text || ""), "");
});
