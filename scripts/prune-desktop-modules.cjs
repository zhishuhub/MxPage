// K图桌面版打包后处理（electron-builder afterPack）：删掉安装包里用不到的依赖，安装时少写几万个小文件。
// 网页服务用的是 .next-desktop/standalone 自带的精简依赖；桌面程序本身只会用到 Agent 相关的三个包，
// 这里只留它们和它们（含可选、同伴）依赖的包，其余整包删掉。
// 本地查看会留下多少：node scripts/prune-desktop-modules.cjs <应用目录> --dry-run
const fs = require("node:fs");
const path = require("node:path");

const KEEP = ["@modelcontextprotocol/sdk", "@zavora-ai/computer-use-mcp", "playwright-core"];

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

/** 按 Node 的查找规则，从 fromDir 往上逐级找 name 这个包，最高找到 appDir。 */
function resolvePackage(fromDir, name, appDir) {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    if (path.basename(dir) !== "node_modules") {
      const candidate = path.join(dir, "node_modules", name);
      if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    }
    if (dir === appDir || path.dirname(dir) === dir) return null;
  }
}

/** 这几个包和它们的依赖所在的全部目录。 */
function dependencyClosure(appDir, roots) {
  const keep = new Set();
  const queue = roots.map(name => {
    const dir = resolvePackage(appDir, name, appDir);
    if (!dir) throw new Error(`安装包里找不到 ${name}`);
    return dir;
  });
  while (queue.length) {
    const dir = queue.pop();
    if (keep.has(dir)) continue;
    keep.add(dir);
    const manifest = readJson(path.join(dir, "package.json")) || {};
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies })) {
      const found = resolvePackage(dir, name, appDir);
      if (found) queue.push(found);
    }
  }
  return keep;
}

/** node_modules 下的各个包目录（@scope 下的展开一层）。 */
function packageDirs(modulesDir) {
  const dirs = [];
  for (const entry of fs.readdirSync(modulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(modulesDir, entry.name);
    if (entry.name.startsWith("@")) {
      for (const inner of fs.readdirSync(full, { withFileTypes: true })) if (inner.isDirectory()) dirs.push(path.join(full, inner.name));
    } else {
      dirs.push(full);
    }
  }
  return dirs;
}

/** 删掉不在 keep 里的包（.bin、.prisma 这类目录也删）；留下的包里嵌套的 node_modules 同样处理。返回删掉的包数。 */
function prune(modulesDir, keep, dryRun) {
  let removed = 0;
  for (const dir of packageDirs(modulesDir)) {
    if (keep.has(dir)) {
      const nested = path.join(dir, "node_modules");
      if (fs.existsSync(nested)) removed += prune(nested, keep, dryRun);
      continue;
    }
    if (!dryRun) fs.rmSync(dir, { recursive: true, force: true });
    removed++;
  }
  if (!dryRun) {
    for (const entry of fs.readdirSync(modulesDir, { withFileTypes: true })) {
      const full = path.join(modulesDir, entry.name);
      if (entry.isDirectory() && entry.name.startsWith("@") && !fs.readdirSync(full).length) fs.rmdirSync(full);
    }
  }
  return removed;
}

function countFiles(dir, skip = new Set()) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (skip.has(full)) continue;
    count += entry.isDirectory() ? countFiles(full, skip) : 1;
  }
  return count;
}

function pruneApp(appDir, { dryRun = false } = {}) {
  const modulesDir = path.join(appDir, "node_modules");
  if (!fs.existsSync(modulesDir)) return { before: 0, after: 0, removed: 0, kept: 0 };
  const before = countFiles(modulesDir);
  const keep = dependencyClosure(appDir, KEEP);
  const removed = prune(modulesDir, keep, dryRun);
  const after = dryRun ? [...keep].reduce((sum, dir) => sum + countFiles(dir, new Set([path.join(dir, "node_modules")])), 0) : countFiles(modulesDir);
  return { before, after, removed, kept: keep.size };
}

exports.pruneApp = pruneApp;
exports.dependencyClosure = dependencyClosure;
exports.KEEP = KEEP;

exports.default = async function afterPack(context) {
  const appDir = path.join(context.packager.getResourcesDir(context.appOutDir), "app");
  const result = pruneApp(appDir);
  console.log(`  • K图 精简依赖：留下 ${result.kept} 个包，删掉 ${result.removed} 个；node_modules 从 ${result.before} 个文件减到 ${result.after} 个`);
};

if (require.main === module) {
  const appDir = path.resolve(process.argv[2] || ".");
  console.log(JSON.stringify(pruneApp(appDir, { dryRun: process.argv.includes("--dry-run") })));
}
