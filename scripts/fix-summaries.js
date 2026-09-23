#!/usr/bin/env node
/**
 * Fix article summaries by extracting the complete introductory paragraph(s) from content.
 * Captures all sentences from the intro section until a clear section boundary.
 */
const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");
const { extractIntro } = require("../src/text-process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(PROJECT_ROOT, "data", "wechat-search.db");

async function main() {
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buf);

  const res = db.exec("SELECT id, title, summary, content FROM articles");
  if (!res[0]) { console.log("No articles"); return; }

  let improved = 0;
  for (const [id, title, oldSummary, content] of res[0].values) {
    const intro = extractIntro(content);
    if (!intro) continue;

    if (intro.length >= 30 && intro !== oldSummary) {
      db.run("UPDATE articles SET summary = ? WHERE id = ?", [intro.slice(0, 500), id]);
      improved++;
    }
  }

  console.log(`[fix-summaries] Improved ${improved} summaries`);
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  console.log("[fix-summaries] DB saved");
}

main().catch(err => { console.error(err); process.exit(1); });
