#!/usr/bin/env node
/**
 * Fix article summaries by extracting the complete introductory paragraph(s) from content.
 * Captures all sentences from the intro section until a clear section boundary.
 */
const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(PROJECT_ROOT, "data", "wechat-search.db");

// Section boundary markers — standalone short phrases that end the intro section
const SECTION_STARTS = /^(病例资料|一般情况|病例简介|病例介绍|病史简介|辅助检查|现病史|既往史|诊疗经过|入院检查|查体|体格检查|诊断与治疗|开场致辞|病例分享|讨论与|总结|展望|结语|参考文献|声明|来源|编辑|排版|审核|作者|通讯|基金|版权|PART\d+|患者基线|入院前治疗|既往治疗)/;

function cleanContent(text) {
  return text
    // Collapse WeChat's multi-newline scattered CJK formatting
    .replace(/([一-鿿])\s*\n\s*\n\s*\n\s*\n\s*\n\s*\n\s*\n\s*([一-鿿])/g, "$1$2")
    .replace(/([一-鿿])\s*\n\s*\n\s*([一-鿿])/g, "$1$2")
    .replace(/([一-鿿])\s*\n\s*([一-鿿])/g, "$1$2")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n/g, "")
    // Strip WeChat video player junk
    .replace(/视频加载失败，请刷新页面再试\s*刷新/g, "")
    .replace(/播放视频.+?(?=[一-鿿A-Za-z])/g, "")
    .trim();
}

function extractIntroFromContent(content) {
  if (!content) return "";

  const cleaned = cleanContent(content);

  // Split into sentences by Chinese/English punctuation
  const sentences = cleaned.split(/(?<=[。！？；])/);

  // Find where the real intro starts (skip chapter-style headers)
  let startIdx = 0;
  for (let i = 0; i < Math.min(sentences.length, 5); i++) {
    const s = sentences[i].trim();
    if (/^(引言?|前言|导读|导语|编者按|编者|摘要|Abstract|Introduction|Intro)$/.test(s)) {
      startIdx = i + 1;
    } else if (s.length >= 10 && !/^[A-Za-z\s]+$/.test(s)) {
      if (startIdx === 0) startIdx = i;
      break;
    }
  }

  // Collect sentences until hitting a section boundary
  let introSentences = [];
  for (let i = startIdx; i < sentences.length; i++) {
    const s = sentences[i].trim();
    if (!s) continue;

    // Check if this sentence is a standalone section header
    if (s.length < 20 && SECTION_STARTS.test(s) && introSentences.length > 0) {
      break;
    }

    // Very short standalone titles (chapter headers)
    if (s.length < 10 && /^[^。！？]{2,8}$/.test(s) && introSentences.length > 1) {
      break;
    }

    introSentences.push(s);

    if (introSentences.join("").length >= 450) break;
  }

  if (introSentences.length === 0) return cleaned.slice(0, 150);

  return introSentences.join("").trim().slice(0, 500);
}

async function main() {
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buf);

  const res = db.exec("SELECT id, title, summary, content FROM articles");
  if (!res[0]) { console.log("No articles"); return; }

  let improved = 0;
  for (const [id, title, oldSummary, content] of res[0].values) {
    const intro = extractIntroFromContent(content);
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
