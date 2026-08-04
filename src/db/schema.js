const { getDb, saveDb } = require("./connection");

function initSchema() {
  const db = getDb();

  db.run(`
    CREATE TABLE IF NOT EXISTS articles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT NOT NULL,
      summary     TEXT DEFAULT '',
      keywords    TEXT DEFAULT '',
      pub_date    TEXT NOT NULL,
      article_url TEXT NOT NULL UNIQUE,
      source_name TEXT NOT NULL,
      content     TEXT DEFAULT '',
      created_at  TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_articles_pub_date ON articles(pub_date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source_name)`);

  saveDb();
  console.log("[DB] Schema ready");
}

module.exports = { initSchema };
