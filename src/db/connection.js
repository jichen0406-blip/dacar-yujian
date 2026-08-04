const initSqlJs = require("sql.js");
const path = require("path");
const fs = require("fs");
const config = require("../config");

const DB_PATH = path.join(config.dataDir, "wechat-search.db");

let db = null;

async function initDb() {
  const SQL = await initSqlJs();
  fs.mkdirSync(config.dataDir, { recursive: true });

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
    console.log(`[DB] Loaded: ${DB_PATH}`);
  } else {
    db = new SQL.Database();
    console.log("[DB] Created new database");
  }
  return db;
}

function saveDb() {
  if (!db) throw new Error("DB not initialized");
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function getDb() {
  if (!db) throw new Error("DB not initialized. Call initDb() first.");
  return db;
}

module.exports = { initDb, saveDb, getDb };
