require("dotenv").config();
const path = require("path");

module.exports = {
  port: process.env.PORT || 3000,
  dataDir: path.resolve(__dirname, "..", "data"),
  // Puppeteer config
  puppeteer: {
    headless: process.env.PUPPETEER_HEADLESS !== "false",
    // Slow down operations to avoid WeChat rate limiting
    delayBetweenUrls: parseInt(process.env.FETCH_DELAY_MS || "2000", 10),
    timeout: parseInt(process.env.PAGE_TIMEOUT_MS || "30000", 10),
  },
};
