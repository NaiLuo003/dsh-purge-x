import test from "node:test";
import assert from "node:assert/strict";
import { stripPluginFromPackage } from "../lib/uninstall.js";

test("uninstall strips both the dependency and the nested profile bundle entry", () => {
  const pkg = {
    name: "dsh-profile-desktop",
    dependencies: { "dsh-purge-x": "link:E:/x", "@deepseek-ai/dsh-base": "0.2.1-rc.5" },
    dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-purge-x"] } },
  };
  assert.equal(stripPluginFromPackage(pkg), true);
  assert.deepEqual(pkg.dependencies, { "@deepseek-ai/dsh-base": "0.2.1-rc.5" });
  assert.deepEqual(pkg.dsh.profile.bundles, ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]);
});

test("legacy upstream name is stripped from nested bundles too", () => {
  const pkg = {
    dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "dsh-purge"] } },
  };
  assert.equal(stripPluginFromPackage(pkg), true);
  assert.deepEqual(pkg.dsh.profile.bundles, ["@deepseek-ai/dsh-base"]);
});

test("healthy profile without the plugin is untouched", () => {
  const pkg = {
    dependencies: { "@deepseek-ai/dsh-base": "0.2.1-rc.5" },
    dsh: { profile: { bundles: ["@deepseek-ai/dsh-base"] } },
  };
  assert.equal(stripPluginFromPackage(pkg), false);
  assert.deepEqual(pkg.dsh.profile.bundles, ["@deepseek-ai/dsh-base"]);
});
