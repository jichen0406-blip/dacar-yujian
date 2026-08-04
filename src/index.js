require("dotenv").config();
const express = require("express");
const path = require("path");
const config = require("./config");
const { initDb } = require("./db/connection");
const { initSchema } = require("./db/schema");
const { closeBrowser } = require("./scraper");

async function main() {
  // Init database
  await initDb();
  initSchema();

  const app = express();

  // Middleware
  app.use(express.json({ limit: "1mb" }));

  // API routes (before static!)
  app.use("/api/search", require("./routes/search"));
  app.use("/api/fetch", require("./routes/fetch"));
  app.use("/api", require("./routes/stats")); // /api/stats, /api/sources, /api/articles/:id/delete

  // Static files
  app.use(express.static(path.join(__dirname, "..")));

  // Pages
  app.get("/", (req, res) => res.sendFile(path.join(__dirname, "..", "index.html")));
  app.get("/admin.html", (req, res) => res.sendFile(path.join(__dirname, "..", "admin.html")));

  // POST /api/deploy — trigger static build + git push
  app.post("/api/deploy", async (req, res) => {
    const { execSync } = require("child_process");
    try {
      const gitRoot = path.resolve(__dirname, "..");
      // Step 1: build static data
      execSync("node scripts/build-data.js", { cwd: gitRoot, encoding: "utf-8", timeout: 15000 });
      console.log("[deploy] Build done");
      // Step 2: backup DB
      execSync("node scripts/backup-db.js", { cwd: gitRoot, encoding: "utf-8", timeout: 10000 });
      console.log("[deploy] Backup done");
      // Step 3: git add + commit + push
      execSync("git add articles-data.js index.html admin.html scripts/ package.json", { cwd: gitRoot, timeout: 5000 });
      execSync("git add -A", { cwd: gitRoot, timeout: 5000 });
      const now = new Date();
      const ts = now.toISOString().slice(0, 19).replace("T", " ");
      execSync(`git commit -m "data: ${ts} 文章数据更新"`, { cwd: gitRoot, timeout: 5000 });
      execSync("git push origin main", { cwd: gitRoot, timeout: 30000 });
      console.log("[deploy] Pushed to GitHub");
      res.json({ success: true, url: "https://jichen0406-blip.github.io/dacar-yujian/" });
    } catch (err) {
      console.error("[deploy] Error:", err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\n[server] Shutting down...");
    await closeBrowser();
    process.exit(0);
  });

  const PORT = config.port;
  app.listen(PORT, () => {
    console.log(`[server] Running at http://localhost:${PORT}`);
    console.log(`[server] Data dir: ${config.dataDir}`);
  });
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
