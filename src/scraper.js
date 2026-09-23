/**
 * Puppeteer-based WeChat article metadata scraper.
 * Launches headless Chrome, navigates to each article URL,
 * extracts title / summary / source / pub_date / content / keywords.
 */
const config = require("./config");
const { extractKeywords } = require("./keywords");
const { cleanText } = require("./text-process");

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

      // 摘要的正文清洗放在 Node 侧做（page.evaluate 内无法 require 共享模块）


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

    // 正文优先作摘要（比 meta description 完整）；清洗在 Node 侧完成
    if (metadata.body) {
      metadata.summary = cleanText(metadata.body).slice(0, 500);
    }

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
      content: (metadata.body || "").slice(0, 2000),
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

module.exports = { fetchArticle, fetchArticles, closeBrowser };
