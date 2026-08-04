#!/usr/bin/env node
/**
 * Re-fetch articles where content is short (< 1000 chars) to get richer summaries.
 * Also applies the sticky section boundary detection to fix summaries.
 */
const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");
const { fetchArticle } = require("../src/scraper");

const DB_PATH = path.join(__dirname, "..", "data", "wechat-search.db");

async function main() {
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buf);

  const res = db.exec("SELECT id, article_url, content FROM articles ORDER BY id");
  if (!res[0]) { console.log("No articles"); return; }

  const articles = res[0].values;
  const BATCH_SIZE = 5;  // small batches
  let updated = 0, failed = 0;

  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    const batch = articles.slice(i, i + BATCH_SIZE);
    const idx = i + 1;
    const end = Math.min(i + BATCH_SIZE, articles.length);

    console.log(`\n[Batch ${idx}-${end}/${articles.length}]`);
    for (const [id, url] of batch) {
      process.stdout.write(`  ID=${id} ...`);
      try {
        const article = await fetchArticle(url);
        if (!article) { console.log(" FAIL"); failed++; continue; }

        db.run(
          "UPDATE articles SET title=?, summary=?, keywords=?, pub_date=?, article_url=?, source_name=?, content=? WHERE id=?",
          [article.title, article.summary, article.keywords, article.pub_date, article.article_url, article.source_name, article.content, id]
        );
        updated++;
        console.log(` OK (${article.content.length}c)`);
      } catch (err) {
        console.log(` ERR: ${err.message}`);
        failed++;
      }
      // Delay
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
    }
  }

  console.log(`\n[refetch] Updated: ${updated}, Failed: ${failed}`);
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  console.log("[refetch] DB saved");
}

main().catch(err => { console.error(err); process.exit(1); });
