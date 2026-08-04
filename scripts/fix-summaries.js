#!/usr/bin/env node
/**
 * Fix article summaries by extracting the introductory paragraph from stored content.
 * This improves upon the previous simple truncation approach.
 */
const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(PROJECT_ROOT, "data", "wechat-search.db");

function extractIntroFromContent(content) {
  if (!content) return "";

  // Clean WeChat formatting artifacts
  const cleaned = content
    .replace(/([一-鿿])\s*\n\s*\n\s*\n\s*\n\s*\n\s*\n\s*\n\s*([一-鿿])/g, "$1$2")
    .replace(/([一-鿿])\s*\n\s*\n\s*([一-鿿])/g, "$1$2")
    .replace(/([一-鿿])\s*\n\s*([一-鿿])/g, "$1$2")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n/g, "")
    .trim();

  // Find first meaningful paragraph (skip section headers)
  const paragraphs = cleaned.split(/[。！？]/);
  let intro = "";
  let headerText = "";
  for (const p of paragraphs) {
    const t = p.trim();
    if (!t) continue;
    // Skip standalone section headers and section markers
    if (/^(引言?|前言|导读|导语|编者按|编者|病例资料|一般情况|病例简介|病例介绍|患者|摘要|Abstract|Introduction|Intro)$/.test(t)) {
      headerText = t;
      continue;
    }
    if (t.length < 15) continue;
    intro = t;
    break;
  }

  if (!intro) return cleaned.slice(0, 150);

  // Include a bit of context before the intro
  const idx = cleaned.indexOf(intro);
  if (idx === -1) return intro;

  const start = Math.max(0, idx - 20);
  const end = Math.min(cleaned.length, idx + intro.length + 50);
  let summary = cleaned.slice(start, end).trim();

  return summary;
}

async function main() {
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buf);

  const res = db.exec("SELECT id, title FROM articles");
  if (!res[0]) { console.log("No articles"); return; }

  let improved = 0;
  for (const [id] of res[0].values) {
    const row = db.exec("SELECT summary, content FROM articles WHERE id = ?", [id]);
    if (!row[0]) continue;
    const [oldSummary, content] = row[0].values[0];

    // Skip if summary is already a good meta description (different from content-derived)
    const intro = extractIntroFromContent(content);
    if (!intro) continue;

    // Only replace if new intro is better (longer or old was from simple truncation)
    if (intro.length >= 30 && (oldSummary.length < 50 || intro.length > oldSummary.length + 30)) {
      db.run("UPDATE articles SET summary = ? WHERE id = ?", [intro.slice(0, 500), id]);
      improved++;
    }
  }

  console.log(`[fix-summaries] Improved ${improved} summaries`);
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  console.log("[fix-summaries] DB saved");
}

main().catch(err => { console.error(err); process.exit(1); });
