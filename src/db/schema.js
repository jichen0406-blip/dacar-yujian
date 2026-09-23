const { getDb, saveDb } = require("./connection");

// PRAGMA table_info 是代码内常量表名，无注入面
function hasColumn(db, table, column) {
  const res = db.exec(`PRAGMA table_info(${table})`);
  if (!res[0]) return false;
  const nameIdx = res[0].columns.indexOf("name");
  return res[0].values.some(v => v[nameIdx] === column);
}

// 新增列不能带 UNIQUE / PRIMARY KEY；带 NOT NULL 必须有非 NULL 默认值
const MIGRATIONS = [
  {
    table: "articles",
    column: "content_html",
    ddl: "ALTER TABLE articles ADD COLUMN content_html TEXT DEFAULT ''",
  },
  {
    table: "articles",
    column: "updated_at",
    ddl: "ALTER TABLE articles ADD COLUMN updated_at TEXT DEFAULT ''",
  },
];

// 存量库补列（新库由 CREATE TABLE 直接带上，此处全部跳过）
function migrate(db) {
  for (const m of MIGRATIONS) {
    if (hasColumn(db, m.table, m.column)) continue;
    try {
      db.run(m.ddl);
      console.log(`[DB] Migration: ${m.table}.${m.column} added`);
    } catch (err) {
      // 重复执行的兜底
      if (!/duplicate column/i.test(err.message)) throw err;
    }
  }
}

function initSchema() {
  const db = getDb();

  db.run(`
    CREATE TABLE IF NOT EXISTS articles (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      title        TEXT NOT NULL,
      summary      TEXT DEFAULT '',
      keywords     TEXT DEFAULT '',
      pub_date     TEXT NOT NULL,
      article_url  TEXT NOT NULL UNIQUE,
      source_name  TEXT NOT NULL,
      content      TEXT DEFAULT '',
      content_html TEXT DEFAULT '',
      created_at   TEXT DEFAULT (datetime('now')),
      updated_at   TEXT DEFAULT ''
    )
  `);

  migrate(db);

  db.run(`CREATE INDEX IF NOT EXISTS idx_articles_pub_date ON articles(pub_date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source_name)`);

  saveDb();
  console.log("[DB] Schema ready");
}

module.exports = { initSchema };
