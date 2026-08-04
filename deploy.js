#!/usr/bin/env node
/**
 * deploy.js — 构建静态数据，备份数据库，部署到 GitHub
 *
 * 用法：node deploy.js
 *
 * 流程：
 * 1. 运行 build-data.js 从 SQLite 生成 articles-data.js（嵌入式静态数据）
 * 2. 备份数据库（data/backups/，保留最近 10 个）
 * 3. git add → commit → push 到 GitHub
 * 4. GitHub Pages 自动部署（约 1-2 分钟生效）
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname);

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function log(msg, color) { console.log((color || "") + msg + C.reset); }
function ok(msg) { log("✅ " + msg, C.green); }
function warn(msg) { log("⚠️  " + msg, C.yellow); }
function err(msg) { log("❌ " + msg, C.red); }
function info(msg) { log("ℹ️  " + msg, C.blue); }
function step(n, msg) {
  log("\n" + C.bold + C.cyan + "═══ 步骤 " + n + "：" + msg + " ═══" + C.reset);
}

function run(cmd, opts) {
  opts = opts || {};
  try {
    const out = execSync(cmd, {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: opts.silent ? "pipe" : "inherit",
      timeout: opts.timeout || 60000,
    });
    return out ? out.trim() : "";
  } catch (e) {
    if (opts.ignoreError) return "";
    throw e;
  }
}

function main() {
  log("\n" + C.bold + "╔══════════════════════════════════════════╗" + C.reset);
  log(C.bold + "║   大CAR愈见 · 静态数据构建 & 自动部署   ║" + C.reset);
  log(C.bold + "╚══════════════════════════════════════════╝" + C.reset);

  // ─── 步骤 1：检查环境 ───
  step(1, "检查环境");
  try { info("Node.js: " + run("node --version", { silent: true })); } catch (e) { err("未找到 Node.js"); process.exit(1); }
  try { info("Git: " + run("git --version", { silent: true })); } catch (e) { err("未找到 Git"); process.exit(1); }
  ok("环境检查通过");

  // ─── 步骤 2：生成静态数据 ───
  step(2, "从数据库生成静态数据 (build-data.js)");
  try {
    run("node scripts/build-data.js");
  } catch (e) {
    err("build-data.js 执行失败");
    console.error(e.message);
    process.exit(1);
  }
  ok("articles-data.js 已生成");

  // ─── 步骤 3：备份数据库 ───
  step(3, "备份数据库");
  try {
    run("node scripts/backup-db.js");
  } catch (e) {
    warn("数据库备份失败（非致命）");
    console.error(e.message);
  }

  // ─── 步骤 4：Git 提交并推送 ───
  step(4, "Git 提交 & 推送");
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 5);
  const commitMsg = "data: " + dateStr + " " + timeStr + " 文章数据更新";

  try {
    run("git add articles-data.js");
    run("git add data/backups/");
    run('git commit -m "' + commitMsg + '"');
    ok("Git 提交: " + commitMsg);
  } catch (e) {
    warn("无变更可提交或提交失败");
  }

  try {
    run("git push origin main");
    ok("已推送到 GitHub");
  } catch (e) {
    try {
      run("git push origin master");
      ok("已推送到 GitHub (master)");
    } catch (e2) {
      err("推送失败，请检查网络或 Git 配置");
      process.exit(1);
    }
  }

  // ─── 完成 ───
  step(5, "完成");
  log("\n" + C.bold + C.green + "🎉 部署完成！" + C.reset);
  log(C.gray + "────────────────────────────────────────" + C.reset);
  log("GitHub Pages: " + C.blue + "https://jichen0406-blip.github.io/dacar-yujian/" + C.reset);
  log("⏳ 约需 1-2 分钟生效，请稍后刷新");
  log("");
}

main();
