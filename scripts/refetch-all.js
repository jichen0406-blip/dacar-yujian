#!/usr/bin/env node
/**
 * Re-fetch all 80 articles to get full content (now up to 2000 chars) and improved summaries.
 * Uses the same Puppeteer scraper but updates existing DB records.
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

  const res = db.exec("SELECT id, article_url FROM articles ORDER BY id");
  if (!res[0]) { console.log("No articles"); return; }

  const articles = res[0].values;
  console.log(`[refetch] Re-fetching ${articles.length} articles...\n`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < articles.length; i++) {
    const [id, url] = articles[i];
    const idx = i + 1;
    process.stdout.write(`\r[${idx}/${articles.length}] ID=${id} ...`);

    try {
      const article = await fetchArticle(url);
      if (!article) {
        failed++;
        continue;
      }

      // Check if summary improved
      const oldRow = db.exec("SELECT summary, LENGTH(content) FROM articles WHERE id = ?", [id]);
      const oldSummary = oldRow[0]?.values[0]?.[0] || "";
      const oldContentLen = oldRow[0]?.values[0]?.[1] || 0;

      if (article.content.length > oldContentLen + 50 || article.summary.length > oldSummary.length + 50) {
        db.run(
          "UPDATE articles SET title = ?, summary = ?, keywords = ?, pub_date = ?, article_url = ?, source_name = ?, content = ? WHERE id = ?",
          [article.title, article.summary, article.keywords, article.pub_date, article.article_url, article.source_name, article.content, id]
        );
        updated++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error(`\n[refetch] Error ID=${id}:`, err.message);
      failed++;
    }

    // Delay between requests
    if (i < articles.length - 1) {
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
    }
  }

  console.log(`\n\n[refetch] Done! Updated: ${updated}, Skipped (no improvement): ${skipped}, Failed: ${failed}`);
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  console.log("[refetch] DB saved");
}

main().catch(err => { console.error(err); process.exit(1); });
