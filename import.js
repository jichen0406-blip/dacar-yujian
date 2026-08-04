#!/usr/bin/env node
/**
 * CLI tool: import articles from txt files or direct URLs.
 *
 * Usage:
 *   node import.js                     # Import links from .txt files in current dir
 *   node import.js http://mp.weixin.qq.com/s/...  # Import one URL
 *   node import.js link.txt            # Import from specific file
 *
 * Sends URLs to the running server's POST /api/fetch endpoint.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const SERVER_HOST = process.env.HOST || "localhost";
const SERVER_PORT = process.env.PORT || 3000;

function postFetch(urls) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ urls });
    const req = http.request(
      {
        hostname: SERVER_HOST,
        port: SERVER_PORT,
        path: "/api/fetch",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function extractUrlsFromTxt(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const matches = content.match(/https?:\/\/mp\.weixin\.qq\.com\/s\?[^\s#)\]]+/g) || [];
  return [...new Set(matches)]; // dedup
}

function extractTitleForUrl(url) {
  // Try to match title from the text file content if available
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  let urls = [];

  if (args.length === 0) {
    // Default: scan for .txt files in current directory
    const cwd = __dirname;
    const files = fs.readdirSync(cwd).filter((f) => f.endsWith(".txt") && f.includes("篇"));
    if (files.length === 0) {
      console.log("No .txt files found. Place .txt files in this directory, or pass URLs directly.");
      console.log("  Usage: node import.js [url1] [url2] ... or node import.js file.txt");
      process.exit(1);
    }
    console.log(`Found ${files.length} txt files. Extracting URLs...\n`);
    for (const f of files) {
      const filePath = path.join(cwd, f);
      const fromFile = extractUrlsFromTxt(filePath);
      console.log(`  ${f}: ${fromFile.length} URLs`);
      urls.push(...fromFile);
    }
    // Dedup
    urls = [...new Set(urls)];
    console.log(`\nTotal unique URLs: ${urls.length}`);
  } else {
    // Check if first arg is a file path
    const firstArg = args[0];
    if (fs.existsSync(firstArg) && firstArg.endsWith(".txt")) {
      urls = extractUrlsFromTxt(firstArg);
      console.log(`Extracted ${urls.length} URLs from ${firstArg}`);
    } else {
      // Treat all args as URLs
      urls = args.filter((u) => u.startsWith("http"));
      console.log(`Using ${urls.length} URLs from command line`);
    }
  }

  if (urls.length === 0) {
    console.log("No URLs found.");
    process.exit(1);
  }

  // Send in batches of 20 to avoid overwhelming
  const BATCH_SIZE = 20;
  let totalInserted = 0;
  let totalFailed = 0;
  let totalDuplicates = 0;

  console.log(`\nSending to server in batches of ${BATCH_SIZE}...\n`);

  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(urls.length / BATCH_SIZE);

    process.stdout.write(`  Batch ${batchNum}/${totalBatches} (${batch.length} URLs)... `);

    try {
      const result = await postFetch(batch);
      totalInserted += result.body.inserted || 0;
      totalFailed += result.body.failed?.length || 0;
      totalDuplicates += result.body.duplicates || 0;
      console.log(`OK — ${result.body.inserted} new, ${result.body.duplicates} dup, ${result.body.failed?.length || 0} fail`);
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      totalFailed += batch.length;
    }
  }

  console.log(`\n─── Done ───`);
  console.log(`  Inserted: ${totalInserted}`);
  console.log(`  Duplicates: ${totalDuplicates}`);
  console.log(`  Failed: ${totalFailed}`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
