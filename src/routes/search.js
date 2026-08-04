const express = require("express");
const router = express.Router();
const repo = require("../db/repository");

// GET /api/search?q=关键词&page=1&limit=20&source=公众号名
router.get("/", (req, res) => {
  try {
    const { q = "", page = "1", limit = "20", source = "" } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const result = repo.searchArticles(q, pageNum, limitNum, source);
    res.json(result);
  } catch (err) {
    console.error("[search] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
