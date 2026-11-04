import test from "node:test";
import assert from "node:assert/strict";
import { escapeDshInterpolation, rewritePromptAssembly } from "../lib/identity.js";

test("0.2.1 no longer registers cwd: escaping leaves model/provider only", () => {
  assert.equal(escapeDshInterpolation("model={{model}}"), "model={{model}}");
  assert.equal(escapeDshInterpolation("provider={{provider}}"), "provider={{provider}}");
  assert.equal(escapeDshInterpolation("cwd={{cwd}}"), "cwd={ {cwd}}");
  assert.equal(escapeDshInterpolation("bad={{unknown}}"), "bad={ {unknown}}");
});

test("rewritePromptAssembly removes legacy cwd interpolation from host persona sections", () => {
  const assembled = {
    sections: [
      {
        name: "deployment:persona-prefix",
        text: "You are a coding agent powered by the {{model}} model, running on the DeepSeek Harness. Your working directory is {{cwd}}.",
      },
      { name: "deployment:persona-suffix", text: "Your working directory is {{cwd}}." },
      { name: "dsh-agent-instructions", text: "hello" },
    ],
    contexts: [],
    tools: [],
  };
  const out = rewritePromptAssembly(assembled, "inject text", { context: {} });
  for (const section of out.sections) {
    if (section.interpolate === false) continue;
    assert.equal(/\{\{cwd\}\}/.test(String(section.text || "")), false, `cwd leaked in ${section.name}`);
  }
  const suffix = out.sections.find((section) => section.name === "deployment:persona-suffix");
  assert.ok(suffix);
  assert.match(String(suffix.text), /current session working directory/i);
});

test("assembly keeps a dsh-purge section carrying the inject text", () => {
  const assembled = {
    sections: [
      { name: "deployment:persona-prefix", text: "You are an AI agent powered by DeepSeek Harness." },
      { name: "dsh-agent-instructions", text: "keep me" },
    ],
    contexts: [],
    tools: [],
  };
  const out = rewritePromptAssembly(assembled, "SENTINEL-INJECT-42", { context: {} });
  const purge = out.sections.filter((section) => String(section?.name || "").startsWith("dsh-purge"));
  assert.ok(purge.length >= 1, "expected a dsh-purge section");
  assert.ok(purge.some((section) => String(section.text || "").includes("SENTINEL-INJECT-42")));
  // 宿主复用同一个 assembled 对象时不能被污染
  assert.equal(assembled.sections.length, 2);
});

test("complete host prompt keeps the dsh-purge inject section in head order", () => {
  const assembled = {
    sections: [
      { name: "dsh-agent-instructions", text: "keep me" },
      { name: "deployment:persona-prefix", text: "persona" },
    ],
    contexts: [],
    tools: [],
  };
  const out = rewritePromptAssembly(assembled, "SENTINEL-INJECT-43", { context: {} });
  assert.equal(String(out.sections[0]?.name || "").startsWith("dsh-purge"), true);
  assert.match(String(out.sections[0]?.text || ""), /SENTINEL-INJECT-43/);
});
