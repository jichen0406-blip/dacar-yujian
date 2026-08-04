const express = require("express");
const router = express.Router();
const repo = require("../db/repository");
const { fetchArticles, closeBrowser } = require("../scraper");

// POST /api/fetch — accept URLs, scrape, store
router.post("/", async (req, res) => {
  const { urls } = req.body;

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: "请提供文章链接数组 { urls: [...] }" });
  }

  // Filter valid WeChat URLs
  const validUrls = urls.filter(u =>
    typeof u === "string" && u.trim().includes("mp.weixin.qq.com")
  );

  if (validUrls.length === 0) {
    return res.status(400).json({ error: "请提供至少一个有效的微信公众号文章链接" });
  }

  console.log(`[fetch] Starting fetch for ${validUrls.length} URLs`);

  try {
    // Scrape metadata from all URLs
    const { success, failed } = await fetchArticles(validUrls);

    // Insert successful articles into DB
    let inserted = 0;
    for (const article of success) {
      const ok = repo.insertArticle(article);
      if (ok) inserted++;
    }

    console.log(`[fetch] Done: ${inserted} inserted, ${failed.length} failed, ${success.length - inserted} duplicates`);

    res.json({
      total: validUrls.length,
      inserted,
      duplicates: success.length - inserted,
      failed,
    });
  } catch (err) {
    console.error("[fetch] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
