#!/usr/bin/env node
/**
 * Update keywords for all articles in the database.
 * Reads articles from SQLite, re-extracts keywords using jieba,
 * writes updated keywords back. Does NOT change any other fields.
 *
 * Usage:
 *   node update-keywords.js
 */

const path = require("path");
const config = require("./src/config");

// ── Database loading ──
const initSqlJs = require("sql.js");
const fs = require("fs");

const DB_PATH = path.join(config.dataDir, "wechat-search.db");

async function loadDb() {
  const SQL = await initSqlJs();
  if (!fs.existsSync(DB_PATH)) {
    console.error("Database not found at", DB_PATH);
    process.exit(1);
  }
  const buffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buffer);
  return db;
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

// ── Keyword extraction (same algorithm as scraper.js) ──
const { Jieba } = require("@node-rs/jieba");

let _jieba = null;
function getJieba() {
  if (_jieba) return _jieba;
  const j = new Jieba();
  const dictPath = path.join(
    path.dirname(require.resolve("@node-rs/jieba/package.json")),
    "dict.txt"
  );
  j.loadDict(new Uint8Array(fs.readFileSync(dictPath)));
  _jieba = j;
  return j;
}

function extractKeywords(title, body) {
  const j = getJieba();

  const stopwords = new Set([
    "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
    "个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有",
    "看", "好", "自己", "这", "他", "她", "它", "们", "那", "些", "所", "为",
    "因为", "所以", "但是", "然而", "而且", "可以", "这个", "那个", "什么",
    "怎么", "如何", "哪", "吗", "呢", "啊", "吧", "哦", "嗯", "与", "及", "或",
    "对", "从", "被", "把", "向", "将", "以", "让", "给", "于", "则", "其",
    "中", "等", "更", "已", "还", "又", "再", "能", "该", "应", "可", "后",
    "前", "里", "外", "上", "下", "大", "小", "多", "少", "来", "去", "出",
    "进", "过", "回", "开", "关", "用", "做", "种", "次", "月", "日", "年",
    "时", "分", "期", "至", "并", "而", "且", "但", "或", "虽", "若", "如",
    "当", "因", "故", "此", "之", "其", "者", "仅", "仍", "常", "需", "无",
    "相对", "通过", "进行", "出现", "发生", "包括", "相关", "目前",
    "本文", "来源", "编辑", "排版", "审核", "声明",
    "仅供", "参考", "内容", "成为", "第一", "部分", "医药", "平台", "媒体",
    "文章", "研究", "结果", "方法", "讨论", "结论", "背景",
    "特邀", "专家", "教授", "分享", "邀请", "本期", "病例",
    "医院", "大学", "附属", "科室", "血液", "主任", "医师", "副主任",
    "报告", "主要", "方案", "分别为", "分为", "显示", "提示", "表明", "未见",
    "其中", "同时", "此外", "最后", "如有", "谢谢",
    "患者", "治疗", "细胞", "蛋白",
    "患者的", "治疗的", "医院的", "教授的",
    "医科大学", "附属", "协和", "中国医学", "医科大学附", "大学附属", "附属第一", "属第一医", "第一医院",
  ]);

  const freq = {};

  // Jieba: body (1x) + title (3x)
  for (const w of j.cut(title || "")) {
    if (w.length < 2) continue;
    if (stopwords.has(w)) continue;
    if (!/[一-鿿]/.test(w)) continue;
    freq[w] = (freq[w] || 0) + 3;
  }
  for (const w of j.cut((body || "").slice(0, 2000))) {
    if (w.length < 2) continue;
    if (stopwords.has(w)) continue;
    if (!/[一-鿿]/.test(w)) continue;
    freq[w] = (freq[w] || 0) + 1;
  }

  // N-gram mining from body: 3-4 char n-grams appearing 2+ times
  const bodyCN = (body || "").slice(0, 2000).replace(/[^一-鿿]/g, "");
  const bodyNGrams = {};
  for (let i = 0; i < bodyCN.length; i++) {
    for (let len = 3; len <= 4 && i + len <= bodyCN.length; len++) {
      const ng = bodyCN.slice(i, i + len);
      if (!stopwords.has(ng)) {
        bodyNGrams[ng] = (bodyNGrams[ng] || 0) + 1;
      }
    }
  }
  for (const [ng, count] of Object.entries(bodyNGrams)) {
    if (count >= 2) {
      freq[ng] = (freq[ng] || 0) + count * ng.length;
    }
  }

  // Substring dedup
  const candidates = Object.entries(freq)
    .filter(([k]) => k.length >= 2 && !stopwords.has(k))
    .sort((a, b) => b[1] - a[1]);
  const result = [];
  for (const [word] of candidates) {
    if (!result.some(r => r !== word && r.includes(word))) {
      result.push(word);
    }
    if (result.length >= 10) break;
  }
  return result;
}

// ── Main ──
async function main() {
  const db = await loadDb();

  // Get all articles
  const r2 = db.exec("SELECT id, title, content FROM articles");
  let rows;
  if (r2[0]) {
    const cols = r2[0].columns;
    rows = r2[0].values.map(v => Object.fromEntries(cols.map((c, i) => [c, v[i]])));
  } else {
    rows = [];
  }

  if (rows.length === 0) {
    console.log("No articles found.");
    return;
  }

  console.log(`Updating keywords for ${rows.length} articles...`);
  let updated = 0;
  for (const row of rows) {
    const keywords = extractKeywords(row.title || "", row.content || "");
    const kwStr = keywords.join(",");
    db.run("UPDATE articles SET keywords = ? WHERE id = ?", [kwStr, row.id]);
    updated++;
    if (updated % 10 === 0) {
      process.stdout.write(`\r  ${updated}/${rows.length}...`);
    }
  }
  console.log(`\r  ${updated}/${rows.length} — done.`);

  saveDb(db);
  console.log("Database saved.");
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
