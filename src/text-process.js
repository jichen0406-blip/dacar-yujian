/**
 * src/text-process.js — 文本处理唯一出口
 * 收敛原先散落在 scraper.js 与 scripts/fix-summaries.js 的重复清洗逻辑，
 * 并新增富文本（本地文章）所需的 HTML 转文本与白名单净化。
 */

const { extractKeywords } = require("./keywords");

// ── 实体解码 ──

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#x27": "'",
};

// 控制字符与代理区码点直接丢弃，避免解码出可用于绕过的隐藏字符
function safeFromCodePoint(n) {
  if (!Number.isFinite(n) || n <= 0x1f || n === 0x7f || n > 0x10ffff) return "";
  if (n >= 0xd800 && n <= 0xdfff) return "";
  try { return String.fromCodePoint(n); } catch { return ""; }
}

function decodeEntities(input) {
  return String(input == null ? "" : input)
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => safeFromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, name) => {
      const k = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, k) ? NAMED_ENTITIES[k] : m;
    });
}

// ── 1. 纯文本清洗（原 fix-summaries.js cleanContent，行为逐字节一致） ──

function cleanText(text) {
  if (!text) return "";
  return text
    .replace(/([一-鿿])\s*\n\s*\n\s*\n\s*\n\s*\n\s*\n\s*\n\s*([一-鿿])/g, "$1$2")
    .replace(/([一-鿿])\s*\n\s*\n\s*([一-鿿])/g, "$1$2")
    .replace(/([一-鿿])\s*\n\s*([一-鿿])/g, "$1$2")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n/g, "")
    .replace(/视频加载失败，请刷新页面再试\s*刷新/g, "")
    .replace(/播放视频.+?(?=[一-鿿A-Za-z])/g, "")
    .trim();
}

// ── 2. HTML → 纯文本 ──

/**
 * 与 cleanText 的关键差异：不做 CJK 跨行合并、不删换行。
 * cleanText 是为了救微信 innerText「一个汉字一行」的乱码；
 * 本地文章的 HTML 由我们自己产出，段落换行是语义，必须保留，
 * 否则第一段会和第二段粘成一个超长摘要。
 */
function htmlToText(html) {
  if (!html) return "";
  let s = String(html);

  // 危险块连内容一起删（必须早于块级→换行，否则内部文本会漏进正文）
  s = s.replace(/<(script|style|noscript|iframe|svg|template|video|audio|source|track)\b[\s\S]*?<\/\1\s*>/gi, " ");
  s = s.replace(/<\/?(script|style|noscript|iframe|svg|template|video|audio|source|track)\b[^>]*>/gi, " ");
  // 图片丢弃，绝不把 src 混进正文文本
  s = s.replace(/<img\b[^>]*>/gi, " ");
  // 块级边界 → 换行，避免段落首尾粘连成假句子
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|section|article|h[1-6]|li|blockquote|pre|figcaption|tr|td|th|dt|dd)\s*>/gi, "\n");
  s = s.replace(/<(hr|table|thead|tbody|tfoot|figure|ul|ol)\b[^>]*>/gi, "\n");
  // 去掉剩余标签
  s = s.replace(/<[^>]*>/g, "");
  // 实体解码放最后：解出的 "<" 只是纯文本
  s = decodeEntities(s);

  return s
    .replace(/[ \t\u00a0\u3000]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// ── 3. 引言摘要提取（原 fix-summaries.js extractIntroFromContent） ──

// 段落边界标志 — 独立短句出现即视为引言结束
const SECTION_STARTS = /^(病例资料|一般情况|患者一般情况|病例简介|病例介绍|病史简介|辅助检查|现病史|既往史|诊疗经过|入院检查|查体|体格检查|诊断与治疗|开场致辞|病例分享|讨论与|总结|展望|结语|参考文献|声明|来源|编辑|排版|审核|作者|通讯|基金|版权|PART\d+|患者基线|入院前治疗|既往治疗|基线检查)/;

// 粘性标题：章节名与后续正文无分隔符粘连
const STICKY_SECTION = /^(病例资料|一般情况|患者一般情况|病例简介|病例介绍|病史简介|辅助检查|现病史|既往史|诊疗经过|患者基线|基线检查)(患者|[男女，。，、]|该患者|\d)/;

/**
 * @param {string} text
 * @param {{maxLen?: number, mergeCjkLines?: boolean}} [options]
 *   mergeCjkLines=true （默认）先 cleanText，供三方文章与 fix-summaries 使用
 *   mergeCjkLines=false 直接对已有结构文本分句，供本地文章使用
 */
function extractIntro(text, options) {
  const opts = options || {};
  const maxLen = opts.maxLen || 500;
  const mergeCjkLines = opts.mergeCjkLines !== false;

  const cleaned = mergeCjkLines ? cleanText(text) : String(text || "").trim();
  if (!cleaned) return "";

  const sentences = cleaned.split(/(?<=[。！？；])/);

  // 找到真正的引言起点（跳过「引言/前言/摘要」等引导词）
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

  const introSentences = [];
  for (let i = startIdx; i < sentences.length; i++) {
    const s = sentences[i].trim();
    if (!s) continue;

    // 粘性标题：取标题之前的部分后终止
    const stickyMatch = s.match(STICKY_SECTION);
    if (stickyMatch && introSentences.length > 1) {
      const headerIdx = s.indexOf(stickyMatch[1]);
      if (headerIdx > 0) {
        const beforeHeader = s.slice(0, headerIdx).trim();
        if (beforeHeader) introSentences.push(beforeHeader);
      }
      break;
    }

    // 独立短章节标题
    if (s.length < 20 && SECTION_STARTS.test(s) && introSentences.length > 0) break;

    // 极短独立标题（章节名）
    if (s.length < 10 && /^[^。！？]{2,8}$/.test(s) && introSentences.length > 1) break;

    introSentences.push(s);
    if (introSentences.join("").length >= Math.max(maxLen - 50, 100)) break;
  }

  if (introSentences.length === 0) return cleaned.slice(0, Math.min(150, maxLen));
  // 换行折成空格：mergeCjkLines=true 时 cleanText 已无换行，此步为无操作
  return introSentences.join("").trim().replace(/\n+/g, " ").slice(0, maxLen);
}

// ── 4. HTML 白名单净化（服务端） ──

const ALLOWED_TAGS = new Set([
  "p", "br", "div", "span", "strong", "b", "em", "i", "u", "s", "del", "ins", "sub", "sup",
  "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "code",
  "a", "img", "hr", "figure", "figcaption",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
]);

// 危险标签：连同内部内容一起删除（含视频相关，落实「只做图文」）
const DROP_TAGS = "script|style|noscript|iframe|object|embed|applet|form|input|button|select|textarea|link|meta|base|svg|math|template|frame|frameset|video|audio|source|track";
const DROP_WITH_CONTENT_RE = new RegExp(`<(${DROP_TAGS})\\b[\\s\\S]*?<\\/\\1\\s*>`, "gi");
const DROP_SELF_RE = new RegExp(`<\\/?(${DROP_TAGS})\\b[^>]*>`, "gi");

// 刻意不给 style：剥离粘贴带入的内联样式，前端排版统一由 CSS 决定
const ATTR_ALLOW = {
  a: ["href", "title", "target", "rel"],
  img: ["src", "alt", "title", "width", "height"],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan"],
  ol: ["start"],
};

// 正向白名单：只放行 http(s)/mailto/tel 与不含冒号的相对路径
function safeUrl(value) {
  const s = String(value).trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^mailto:/i.test(s)) return s;
  if (/^tel:/i.test(s)) return s;
  if (/^[^:?#<>"'\\]*$/.test(s)) return s;
  return null;
}

function sanitizeHtml(html) {
  if (!html) return "";
  let s = String(html);

  s = s.replace(/<!--[\s\S]*?-->/g, "");
  for (let i = 0; i < 3; i++) {
    s = s.replace(DROP_WITH_CONTENT_RE, "").replace(DROP_SELF_RE, "");
  }
  // 冗余保险（属性白名单本身也会拦掉）
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  return s.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g,
    (match, slash, rawTag, rawAttrs) => {
      const tag = rawTag.toLowerCase();
      if (slash) return ALLOWED_TAGS.has(tag) ? `</${tag}>` : "";
      if (!ALLOWED_TAGS.has(tag)) return ""; // 非白名单：丢标签、留内部文本

      const allow = ATTR_ALLOW[tag] || [];
      const kept = [];
      const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g;
      let a;
      while ((a = attrRe.exec(rawAttrs))) {
        const name = a[1].toLowerCase();
        if (!allow.includes(name)) continue;
        // 先解码再判定，否则拦不住 &#106;avascript:
        let value = decodeEntities(a[2].replace(/^['"]|['"]$/g, ""));
        if (name === "href" || name === "src") {
          const u = safeUrl(value);
          if (u === null) continue;
          value = u;
        }
        kept.push(`${name}="${value.replace(/"/g, "&quot;")}"`);
      }

      if (tag === "img" && !kept.some(k => k.startsWith("src="))) return "";
      if (tag === "a") kept.push('target="_blank"', 'rel="noopener noreferrer"');
      return `<${tag}${kept.length ? " " + kept.join(" ") : ""}>`;
    });
}

// ── 5. 日期归一 ──

function toIsoDate(input, fallback) {
  const fb = fallback || new Date().toISOString().slice(0, 10);
  if (!input) return fb;
  const s = String(input).trim();

  // 覆盖 2026-09-23 / 2026/9/23 / 2026年9月23日
  const m = s.match(/(\d{4})[-\/年](\d{1,2})[-\/月](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;

  return fb;
}

// ── 6. 本地文章字段派生 ──

/**
 * 一次派生本地文章的全部存储字段。
 * content（纯文本）必须写：searchArticles 的 content LIKE、前端嵌入式筛选、
 * build-data 内嵌检索都依赖它，只存 content_html 会导致本地文章搜不到。
 */
function deriveLocalArticleFields({ title, contentHtml, summary, keywords }) {
  const safeHtml = sanitizeHtml(contentHtml);
  const text = htmlToText(safeHtml);

  const manualSummary = summary && String(summary).trim();
  const manualKeywords = keywords && String(keywords).trim();

  const finalSummary = manualSummary
    || extractIntro(text, { mergeCjkLines: false })
    || text.slice(0, 150);

  const finalKeywords = manualKeywords || extractKeywords(title || "", text).join(",");

  return {
    content_html: safeHtml,
    content: text.slice(0, 2000),
    summary: String(finalSummary).slice(0, 500),
    keywords: finalKeywords,
  };
}

module.exports = {
  cleanText,
  htmlToText,
  extractIntro,
  sanitizeHtml,
  decodeEntities,
  safeUrl,
  toIsoDate,
  deriveLocalArticleFields,
};
