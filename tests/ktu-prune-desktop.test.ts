import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { pruneApp } = require("../scripts/prune-desktop-modules.cjs") as { pruneApp: (appDir: string, options?: { dryRun?: boolean }) => { before: number; after: number; removed: number; kept: number } };

function pkg(root: string, name: string, deps: Record<string, string> = {}, extra: Record<string, unknown> = {}) {
  mkdirSync(path.join(root, name), { recursive: true });
  writeFileSync(path.join(root, name, "package.json"), JSON.stringify({ name, version: "1.0.0", dependencies: deps, ...extra }));
  writeFileSync(path.join(root, name, "index.js"), "module.exports = 1;\n");
}

test("desktop packaging keeps only the agent packages and their dependency closure", () => {
  const app = mkdtempSync(path.join(tmpdir(), "ktu-prune-"));
  try {
    const modules = path.join(app, "node_modules");
    pkg(modules, "@modelcontextprotocol/sdk", { zod: "*", express: "*" }, { peerDependencies: { "@cfworker/json-schema": "*" } });
    pkg(modules, "@zavora-ai/computer-use-mcp", { "@modelcontextprotocol/server": "*" }, { optionalDependencies: { playwright: "*" } });
    pkg(modules, "@modelcontextprotocol/server", { zod: "*" });
    pkg(modules, "playwright-core");
    pkg(modules, "zod");
    pkg(modules, "express", { "body-parser": "*" });
    // express 自己嵌套一份不同版本的 body-parser，嵌套目录里还有一个没人用的包
    pkg(path.join(modules, "express", "node_modules"), "body-parser");
    pkg(path.join(modules, "express", "node_modules"), "orphan");
    pkg(modules, "body-parser");
    pkg(modules, "next", { react: "*" });
    pkg(modules, "react");
    pkg(modules, "@langchain/core");
    mkdirSync(path.join(modules, ".bin"), { recursive: true });
    writeFileSync(path.join(modules, ".bin", "next"), "");

    const dry = pruneApp(app, { dryRun: true });
    assert.equal(existsSync(path.join(modules, "next")), true, "dry run deletes nothing");
    const result = pruneApp(app);
    assert.equal(result.kept, dry.kept);
    for (const kept of ["@modelcontextprotocol/sdk", "@zavora-ai/computer-use-mcp", "@modelcontextprotocol/server", "playwright-core", "zod", "express", "express/node_modules/body-parser"]) {
      assert.equal(existsSync(path.join(modules, kept, "package.json")), true, `${kept} kept`);
    }
    for (const removed of ["next", "react", "@langchain/core", "@langchain", ".bin", "body-parser", "express/node_modules/orphan"]) {
      assert.equal(existsSync(path.join(modules, removed)), false, `${removed} removed`);
    }
    assert.ok(result.after < result.before);
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});

test("desktop packaging fails loudly when an agent package is missing", () => {
  const app = mkdtempSync(path.join(tmpdir(), "ktu-prune-"));
  try {
    pkg(path.join(app, "node_modules"), "next");
    assert.throws(() => pruneApp(app), /找不到/);
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});
