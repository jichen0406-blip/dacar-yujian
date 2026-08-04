/**
 * Puppeteer-based WeChat article metadata scraper.
 * Launches headless Chrome, navigates to each article URL,
 * extracts title / summary / source / pub_date / content / keywords.
 */
const config = require("./config");

let browser = null;

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  const puppeteer = require("puppeteer");
  browser = await puppeteer.launch({
    headless: config.puppeteer.headless,
    executablePath: process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--lang=zh-CN",
    ],
  });
  console.log("[scraper] Browser launched");
  return browser;
}

/**
 * Fetch metadata from a single WeChat article URL.
 * @param {string} url - WeChat article URL (mp.weixin.qq.com)
 * @returns {Promise<Object|null>} Article metadata or null on failure
 */
async function fetchArticle(url) {
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    // Block unnecessary resources to speed up loading
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (type === "image" || type === "font" || type === "media") {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Set a realistic user agent
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    );

    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: config.puppeteer.timeout,
    });

    // Wait for key elements to appear
    await page.waitForSelector("#js_content, .rich_media_content, .weui-msg__title", {
      timeout: 10000,
    }).catch(() => {
      // Content might not exist (error page, deleted article, etc.)
    });

    // Extract metadata from the rendered page
    const metadata = await page.evaluate(() => {
      // Title
      let title =
        document.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
        document.querySelector('meta[name="twitter:title"]')?.getAttribute("content") ||
        "";
      if (!title || title === "微信公众平台") {
        title = document.title.replace(/\s*微信公众平台\s*/g, "").trim();
      }

      // Summary / description — prefer meta, fall back to intro paragraph from body
      let summary =
        document.querySelector('meta[name="description"]')?.getAttribute("content") ||
        document.querySelector('meta[property="og:description"]')?.getAttribute("content") ||
        "";

      // Article body
      const body =
        document.querySelector("#js_content")?.innerText?.trim() ||
        document.querySelector(".rich_media_content")?.innerText?.trim() ||
        "";

      // If meta description is empty or too short, extract intro from body
      if (!summary || summary.length < 50) {
        // Clean WeChat formatting artifacts (scattered characters from rich text)
        const cleaned = body
          .replace(/([一-鿿])\s*\n\s*\n\s*\n\s*\n\s*\n\s*\n\s*\n\s*([一-鿿])/g, '$1$2')
          .replace(/([一-鿿])\s*\n\s*\n\s*([一-鿿])/g, '$1$2')
          .replace(/([一-鿿])\s*\n\s*([一-鿿])/g, '$1$2')
          .replace(/\n{3,}/g, '\n\n')
          .replace(/\n/g, '')
          .trim();

        // Split into sentences and collect the full intro section
        const sentences = cleaned.split(/(?<=[。！？；])/);
        const SECTION_BOUNDARY = /(^(引言?|前言|导读|导语|编者按|编者)$|[.，。！？\n])[ ]*(病例资料|一般情况|病例简介|病例介绍|辅助检查|现病史|既往史|诊疗经过|入院|查体|体格检查|诊断|治疗方案|开场致辞|病例分享|讨论|总结|展望|结语|参考文献|声明|来源|编辑|排版|审核|作者|通讯|基金|版权)/;

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

        let introParts = [];
        for (let i2 = startIdx; i2 < sentences.length; i2++) {
          const s = sentences[i2].trim();
          if (!s) continue;
          if (SECTION_BOUNDARY.test(s) && introParts.length > 0) break;
          if (s.length < 15 && /^[^。！？]{2,10}$/.test(s) && introParts.length > 1) break;
          introParts.push(s);
          if (introParts.join('').length >= 450) break;
        }

        if (introParts.length > 0) {
          summary = introParts.join('').trim().slice(0, 500);
        }
      }

      // Source (公众号 name)
      let source =
        document.querySelector("#js_name")?.textContent?.trim() ||
        document.querySelector(".rich_media_meta_nickname")?.textContent?.trim() ||
        document.querySelector("#js_wx_follow_nickname")?.textContent?.trim() ||
        document.querySelector('meta[property="og:article:author"]')?.getAttribute("content") ||
        "";

      if (!source) {
        const profileNick = document.querySelector(".profile_nickname");
        if (profileNick) source = profileNick.textContent.trim();
      }

      // Publish date
      let pubDate =
        document.querySelector("#publish_time")?.textContent?.trim() ||
        document.querySelector(".rich_media_meta_text")?.textContent?.trim() ||
        document.querySelector('meta[property="og:article:publish_time"]')?.getAttribute("content") ||
        "";

      if (!pubDate) {
        const metaList = document.querySelectorAll(".rich_media_meta_list span, .rich_media_meta_text");
        for (const el of metaList) {
          const t = el.textContent.trim();
          if (/\d{4}[年-]\d{1,2}[月-]\d{1,2}/.test(t)) {
            pubDate = t;
            break;
          }
        }
      }

      return { title, summary, source, pubDate, body };
    });

    // Parse and normalize date
    const pubDate = parseChineseDate(metadata.pubDate);

    // Generate keywords from title + body
    const keywords = extractKeywords(metadata.title, metadata.body);

    // Clean and normalize URL
    const normalizedUrl = normalizeUrl(url);

    const article = {
      title: (metadata.title || "无标题").slice(0, 200),
      summary: (metadata.summary || "").slice(0, 500),
      keywords: keywords.join(","),
      pub_date: pubDate,
      article_url: normalizedUrl,
      source_name: metadata.source || "未知来源",
      content: (metadata.body || "").slice(0, 500),
    };

    return article;
  } catch (err) {
    console.error(`[scraper] Error fetching ${url}:`, err.message);
    return null;
  } finally {
    await page.close();
  }
}

/**
 * Fetch metadata from multiple URLs with delay between each.
 * @param {string[]} urls
 * @returns {Promise<{success: Object[], failed: {url: string, error: string}[]}>}
 */
async function fetchArticles(urls) {
  const success = [];
  const failed = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i].trim();
    if (!url) continue;

    console.log(`[scraper] [${i + 1}/${urls.length}] Fetching: ${url.slice(0, 60)}...`);

    const article = await fetchArticle(url);
    if (article) {
      success.push(article);
    } else {
      failed.push({ url, error: "抓取失败，可能是链接无效或文章已删除" });
    }

    // Delay between requests
    if (i < urls.length - 1) {
      await sleep(config.puppeteer.delayBetweenUrls);
    }
  }

  return { success, failed };
}

/**
 * Close the browser instance.
 */
async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    console.log("[scraper] Browser closed");
  }
}

// ── Helpers ──

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Normalize WeChat article URL — strip tracking params, keep canonical.
 */
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("mp.weixin.qq.com")) return url;
    // Keep only canonical params
    const keep = ["__biz", "mid", "idx", "sn"];
    const params = [];
    for (const [k, v] of u.searchParams) {
      if (keep.includes(k)) params.push(`${k}=${v}`);
    }
    u.search = params.length ? "?" + params.join("&") : "";
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Parse Chinese date formats to ISO 8601 (YYYY-MM-DD).
 */
function parseChineseDate(text) {
  if (!text) return new Date().toISOString().slice(0, 10);

  // ISO: 2024-08-04
  const iso = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;

  // Chinese: 2024年8月4日
  const cn = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (cn) return `${cn[1]}-${cn[2].padStart(2, "0")}-${cn[3].padStart(2, "0")}`;

  // Slash: 2024/8/4
  const slash = text.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (slash) return `${slash[1]}-${slash[2].padStart(2, "0")}-${slash[3].padStart(2, "0")}`;

  // Relative
  const now = new Date();
  if (text.includes("昨天")) { now.setDate(now.getDate() - 1); return now.toISOString().slice(0, 10); }
  if (text.includes("前天")) { now.setDate(now.getDate() - 2); return now.toISOString().slice(0, 10); }
  if (text.includes("今天")) return now.toISOString().slice(0, 10);

  // Try parsing as date
  const d = new Date(text);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);

  return now.toISOString().slice(0, 10);
}

/**
 * Extract Chinese keywords from title and body text.
 * Jieba segments body for common terms; n-grams from title capture proper nouns
 * (drug names etc.) that jieba's dictionary lacks; then dedup + filter.
 */
let _jieba = null;

function getJieba() {
  if (_jieba) return _jieba;
  const { Jieba } = require("@node-rs/jieba");
  const fs = require("fs");
  const path = require("path");
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
    "患者的", "治疗的", "医院的", "教授的", "特邀",
  ]);

  const freq = {};

  // ── Step 1: Jieba segment body text ──
  const bodyText = (body || "").slice(0, 2000);
  for (const w of j.cut(bodyText)) {
    if (w.length < 2) continue;
    if (stopwords.has(w)) continue;
    if (!/[一-鿿]/.test(w) && !/^[A-Za-z]/.test(w)) continue;
    freq[w] = (freq[w] || 0) + 1;
  }

  // ── Step 2: Title — jieba cut (higher weight) ──
  for (const w of j.cut(title || "")) {
    if (w.length < 2) continue;
    if (stopwords.has(w)) continue;
    if (!/[一-鿿]/.test(w)) continue;
    freq[w] = (freq[w] || 0) + 3;
  }

  // ── Step 3: N-gram mining from body to capture medical compounds ──
  // 3-4 char n-grams appearing 2+ times (drug names/proper nouns jieba misses)
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

  // ── Step 4: Dedup substrings ──
  const candidates = Object.entries(freq)
    .filter(([k]) => k.length >= 2 && !stopwords.has(k))
    .sort((a, b) => b[1] - a[1]);

  const result = [];
  for (const [word, score] of candidates) {
    // Skip if this word is a substring of an already-selected higher-ranked keyword
    const isSubstring = result.some(r => r !== word && r.includes(word));
    if (!isSubstring) {
      result.push(word);
    }
    if (result.length >= 10) break;
  }

  return result;
}

module.exports = { fetchArticles, closeBrowser };
