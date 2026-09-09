#!/usr/bin/env node
/**
 * fix-keywords.js — Recompute keywords for existing articles using the
 * doctor-name + hospital extraction logic in src/keywords.js.
 *
 * Usage: node scripts/fix-keywords.js
 */
const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");
const { extractKeywords } = require("../src/keywords");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(PROJECT_ROOT, "data", "wechat-search.db");

async function main() {
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buf);

  const res = db.exec("SELECT id, title, content, keywords FROM articles");
  if (!res[0]) { console.log("No articles"); return; }

  let updated = 0;
  for (const [id, title, content, oldKw] of res[0].values) {
    const kw = extractKeywords(title || "", content || "").join(",");
    if (kw && kw !== oldKw) {
      db.run("UPDATE articles SET keywords = ? WHERE id = ?", [kw, id]);
      updated++;
    }
  }

  console.log(`[fix-keywords] Updated ${updated} of ${res[0].values.length} articles`);
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  console.log("[fix-keywords] DB saved");
}

main().catch(err => { console.error(err); process.exit(1); });
