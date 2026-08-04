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

// GET /api/sources
router.get("/sources", (req, res) => {
  try {
    res.json(repo.getSources());
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

module.exports = router;
