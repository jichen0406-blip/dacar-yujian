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

module.exports = router;
