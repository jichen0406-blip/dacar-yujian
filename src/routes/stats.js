const express = require("express");
const router = express.Router();
const repo = require("../db/repository");

// GET /api/stats
router.get("/stats", (req, res) => {
  try {
    res.json(repo.getStats());
  } catch (err) {
    console.error("[stats] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sources?include_hidden=1
router.get("/sources", (req, res) => {
  try {
    res.json(repo.getSources(req.query.include_hidden === "1"));
  } catch (err) {
    console.error("[sources] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/articles/:id/delete
router.post("/articles/:id/delete", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    const ok = repo.deleteArticle(id);
    res.json({ deleted: ok });
  } catch (err) {
    console.error("[delete] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/articles/:id/hide — 软隐藏（数据保留，前端不展示）
router.post("/articles/:id/hide", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

    const article = repo.getArticleById(id);
    if (!article) return res.status(404).json({ error: "Not found" });

    const hidden = !!(req.body && req.body.hidden);
    const ok = repo.setArticleHidden(id, hidden);
    if (!ok) return res.status(500).json({ error: "更新失败（请重试）" });

    res.json({ hidden, id });
  } catch (err) {
    console.error("[hide] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/deploy-status — 比对数据库可见文章与已构建的静态数据
// 用于提示「有改动尚未部署」，可发现功能上线前就存在的差异
router.get("/deploy-status", (req, res) => {
  try {
    const fs = require("fs");
    const path = require("path");

    const dbIds = repo.getVisibleIds().map(Number);
    const builtPath = path.resolve(__dirname, "..", "..", "articles-data.js");

    let builtIds = [];
    let builtAt = null;
    try {
      const txt = fs.readFileSync(builtPath, "utf8");

      // 用 indexOf 而非正则解析，避免转义问题
      const atIdx = txt.indexOf("Generated at:");
      if (atIdx > -1) {
        const lineEnd = txt.indexOf("\n", atIdx);
        builtAt = txt.slice(atIdx + "Generated at:".length, lineEnd > -1 ? lineEnd : undefined).trim();
      }

      const marker = "window.__ARTICLES__ =";
      const start = txt.indexOf(marker);
      if (start === -1) throw new Error("找不到 window.__ARTICLES__");
      let body = txt.slice(start + marker.length).trim();
      if (body.endsWith(";")) body = body.slice(0, -1);
      builtIds = JSON.parse(body).map(a => Number(a.id));
    } catch (e) {
      return res.json({ in_sync: false, error: "读取 articles-data.js 失败：" + e.message,
                        db_count: dbIds.length, built_count: 0, built_at: null });
    }

    const same = dbIds.length === builtIds.length &&
                 dbIds.every((id, i) => id === builtIds[i]);

    res.json({
      in_sync: same,
      db_count: dbIds.length,
      built_count: builtIds.length,
      built_at: builtAt,
      diff: same ? 0 : dbIds.length - builtIds.length,
    });
  } catch (err) {
    console.error("[deploy-status] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
