const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const repo = require("../db/repository");
const { deriveLocalArticleFields, toIsoDate } = require("../text-process");

const LOCAL_SOURCE = "本地上传";

function isLocalArticle(article) {
  return String(article.article_url || "").startsWith("local://");
}

// 校验并派生字段；返回 { error } 或 { cleanTitle, fields }
function buildFields(body) {
  const { title, content_html, summary, keywords } = body || {};
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) return { error: "标题不能为空" };
  if (!content_html || !String(content_html).trim()) return { error: "正文不能为空" };

  const fields = deriveLocalArticleFields({
    title: cleanTitle,
    contentHtml: content_html,
    summary,
    keywords,
  });
  if (!fields.content) return { error: "正文内容为空（可能只插入了图片）" };

  return { cleanTitle, fields };
}

// GET /api/articles/:id — 单篇详情（含富文本），供详情页与编辑回填
router.get("/articles/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

  const article = repo.getArticleById(id);
  if (!article) return res.status(404).json({ error: "Not found" });

  res.json(article);
});

// POST /api/local — 新建本地文章
router.post("/local", (req, res) => {
  try {
    const built = buildFields(req.body);
    if (built.error) return res.status(400).json({ error: built.error });
    const { cleanTitle, fields } = built;

    const articleUrl = `local://${crypto.randomUUID()}`;
    const newId = repo.insertArticle({
      title: cleanTitle,
      summary: fields.summary,
      keywords: fields.keywords,
      pub_date: toIsoDate((req.body || {}).pub_date),
      article_url: articleUrl,
      source_name: LOCAL_SOURCE,
      content: fields.content,
      content_html: fields.content_html,
    });
    if (!newId) return res.status(500).json({ error: "写入失败（请重试）" });

    res.json({
      success: true,
      id: newId,
      article_url: articleUrl,
      summary: fields.summary,
      keywords: fields.keywords,
      content_length: fields.content.length,
    });
  } catch (err) {
    console.error("[local] create error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/articles/:id/update — 编辑本地文章（三方抓取的文章不可覆盖）
router.post("/articles/:id/update", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ updated: false, error: "Invalid ID" });

    const existing = repo.getArticleById(id);
    if (!existing) return res.status(404).json({ updated: false, error: "文章不存在" });
    if (!isLocalArticle(existing)) {
      return res.status(403).json({ updated: false, error: "只能编辑「本地上传」的文章" });
    }

    const built = buildFields(req.body);
    if (built.error) return res.status(400).json({ updated: false, error: built.error });
    const { cleanTitle, fields } = built;

    const ok = repo.updateArticle(id, {
      title: cleanTitle,
      content_html: fields.content_html,
      content: fields.content,
      summary: fields.summary,
      keywords: fields.keywords,
      pub_date: toIsoDate((req.body || {}).pub_date, existing.pub_date),
    });
    if (!ok) return res.status(500).json({ updated: false, error: "更新失败（请重试）" });

    res.json({ updated: true, id, summary: fields.summary, keywords: fields.keywords });
  } catch (err) {
    console.error("[local] update error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
