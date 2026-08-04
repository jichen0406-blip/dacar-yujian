#!/usr/bin/env node
/**
 * DB backup script — keeps last 10 backups, auto-rotates.
 * Run after each article update to create incremental backups.
 *
 * Usage: node backup-db.js
 */

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const dataDir = process.env.DATA_DIR || path.join(PROJECT_ROOT, "data");
const DB_PATH = path.join(dataDir, "wechat-search.db");
const BACKUP_DIR = path.join(dataDir, "backups");

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error("No database found at", DB_PATH);
    process.exit(1);
  }

  // Create backup dir
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  // Generate backup filename with timestamp
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupName = `wechat-search-${ts}.db`;
  const backupPath = path.join(BACKUP_DIR, backupName);

  // Copy DB
  fs.copyFileSync(DB_PATH, backupPath);
  console.log(`[backup] Saved: ${backupName}`);

  // Rotate: keep only last 10
  const backups = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith(".db"))
    .sort(); // alphabetical = chronological (ISO timestamps)

  if (backups.length > 10) {
    const toDelete = backups.slice(0, backups.length - 10);
    for (const f of toDelete) {
      fs.unlinkSync(path.join(BACKUP_DIR, f));
      console.log(`[backup] Deleted old: ${f}`);
    }
  }
}

main();
