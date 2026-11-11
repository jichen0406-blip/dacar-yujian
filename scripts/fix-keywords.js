#!/usr/bin/env node
/**
 * fix-keywords.js — Recompute keywords for existing articles using the
 * doctor-name + hospital extraction logic in src/keywords.js.
 *
 * ⚠️ 降级风险：本脚本只能读到入库的 content（上限 2000 字），而抓取时关键词
 * 是用「完整正文」算的。长文（如指南、综述）的关键词会因此变少——医院名等
 * 信息在 2000 字之外。默认策略：重算结果比现有更短时**跳过不覆盖**；
 * 确需强制覆盖时加 --force。
 *
 * Usage:
 *   node scripts/fix-keywords.js            # 安全模式（默认）
 *   node scripts/fix-keywords.js --force    # 强制覆盖（可能丢失全文关键词）
 */
const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");
const { extractKeywords } = require("../src/keywords");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(PROJECT_ROOT, "data", "wechat-search.db");
const FORCE = process.argv.includes("--force");

async function main() {
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buf);

  const res = db.exec("SELECT id, title, content, keywords FROM articles");
  if (!res[0]) { console.log("No articles"); return; }

  let updated = 0;
  const skipped = [];

  for (const [id, title, content, oldKw] of res[0].values) {
    const oldList = (oldKw || "").split(",").filter(Boolean);
    const newList = extractKeywords(title || "", content || "");
    const kw = newList.join(",");

    if (kw === oldKw) continue;

    // 正文被截断到 2000 字，重算可能比抓取时（完整正文）更少 → 跳过以免降级
    if (!FORCE && newList.length < oldList.length) {
      skipped.push({ id, old: oldList.length, next: newList.length });
      continue;
    }

    db.run("UPDATE articles SET keywords = ? WHERE id = ?", [kw, id]);
    updated++;
  }

  console.log(`[fix-keywords] Updated ${updated} of ${res[0].values.length} articles`);
  if (skipped.length) {
    console.log(`[fix-keywords] Skipped ${skipped.length}（重算结果更短，避免丢失全文关键词）:`);
    for (const s of skipped) console.log(`  id=${s.id} 现有 ${s.old} 个 → 重算 ${s.next} 个`);
    console.log("  如确需覆盖：node scripts/fix-keywords.js --force");
  }
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  console.log("[fix-keywords] DB saved");
}

main().catch(err => { console.error(err); process.exit(1); });
