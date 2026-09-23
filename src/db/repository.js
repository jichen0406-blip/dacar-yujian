const { getDb, saveDb } = require("./connection");

/**
 * 插入文章，返回新行 id；重复（命中 article_url UNIQUE）时返回 0。
 * 注意：saveDb() 内部的 export() 会关闭并重开数据库句柄，使
 * getRowsModified() / last_insert_rowid() 归零，故二者必须在 saveDb() 之前读取。
 * 又因 INSERT OR IGNORE 被忽略时 last_insert_rowid() 会残留上一次的值，
 * 必须先用 getRowsModified() 判断本次是否真的写入。
 */
function insertArticle({ title, summary, keywords, pub_date, article_url, source_name, content, content_html }) {
  const db = getDb();
  try {
    db.run(
      `INSERT OR IGNORE INTO articles (title, summary, keywords, pub_date, article_url, source_name, content, content_html)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, summary || "", keywords || "", pub_date, article_url, source_name, content || "", content_html || ""]
    );
    const changed = db.getRowsModified();
    const idRes = db.exec("SELECT last_insert_rowid() AS id");
    const newId = changed > 0 && idRes[0] ? idRes[0].values[0][0] : 0;
    saveDb();
    return newId;
  } catch (err) {
    console.error("[repo] insertArticle:", err.message);
    return 0;
  }
}

function getLastInsertId() {
  const res = getDb().exec("SELECT last_insert_rowid() AS id");
  return res[0] ? res[0].values[0][0] : null;
}

function getArticleById(id) {
  const db = getDb();
  try {
    const res = db.exec(
      `SELECT id, title, summary, keywords, pub_date, article_url, source_name,
              content, content_html, created_at, updated_at
         FROM articles WHERE id = ?`,
      [id]
    );
    if (!res[0]) return null;
    const cols = res[0].columns;
    return Object.fromEntries(cols.map((c, i) => [c, res[0].values[0][i] || ""]));
  } catch (e) {
    console.error("[repo] getArticleById:", e.message);
    return null;
  }
}

// 仅允许更新本地文章（article_url 以 local:// 开头），三方抓取的文章不可覆盖
function updateArticle(id, { title, content_html, content, summary, keywords, pub_date }) {
  const db = getDb();
  db.run(
    `UPDATE articles
        SET title = ?, content_html = ?, content = ?, summary = ?, keywords = ?,
            pub_date = ?, updated_at = datetime('now')
      WHERE id = ? AND article_url LIKE 'local://%'`,
    [title, content_html || "", content || "", summary || "", keywords || "", pub_date, id]
  );
  const changed = db.getRowsModified() > 0;   // 必须在 saveDb 之前读
  saveDb();
  return changed;
}

function searchArticles(query, page = 1, limit = 20, source = "") {
  const db = getDb();
  const offset = (page - 1) * limit;

  // Build WHERE with plain ? placeholders (not numbered)
  const clauses = [];
  const params = [];

  if (query && query.trim()) {
    const pattern = "%" + query.trim() + "%";
    clauses.push("(title LIKE ? OR summary LIKE ? OR keywords LIKE ? OR content LIKE ? OR source_name LIKE ?)");
    params.push(pattern, pattern, pattern, pattern, pattern);
  }

  if (source) {
    clauses.push("source_name = ?");
    params.push(source);
  }

  const where = clauses.length > 0 ? "WHERE " + clauses.join(" AND ") : "";

  // Count
  let total = 0;
  try {
    const countSql = `SELECT COUNT(*) as cnt FROM articles ${where}`;
    const countRes = db.exec(countSql, params);
    total = countRes[0]?.values[0]?.[0] || 0;
  } catch (e) {
    console.error("[repo] count error:", e.message);
  }

  // Search
  let rows = [];
  try {
    const searchSql = `SELECT id, title, summary, keywords, pub_date, article_url, source_name, content
                       FROM articles ${where}
                       ORDER BY pub_date DESC LIMIT ? OFFSET ?`;
    const allParams = [...params, limit, offset];
    const result = db.exec(searchSql, allParams);

    if (result[0]) {
      const cols = result[0].columns;
      rows = result[0].values.map(v => Object.fromEntries(cols.map((c, i) => [c, v[i]])));
    }
  } catch (e) {
    console.error("[repo] search error:", e.message);
  }

  return { rows, total, page, limit };
}

function getStats() {
  const db = getDb();
  const total = db.exec("SELECT COUNT(*) as cnt FROM articles")[0]?.values[0]?.[0] || 0;
  const res = db.exec("SELECT source_name, COUNT(*) as cnt FROM articles GROUP BY source_name ORDER BY cnt DESC");
  const bySource = res[0] ? res[0].values.map(v => ({ name: v[0], count: v[1] })) : [];
  return { total_articles: total, by_source: bySource };
}

function getSources() {
  const db = getDb();
  const res = db.exec("SELECT DISTINCT source_name FROM articles ORDER BY source_name");
  return res[0] ? res[0].values.map(v => v[0]) : [];
}

function deleteArticle(id) {
  const db = getDb();
  db.run("DELETE FROM articles WHERE id = ?", [id]);
  const changed = db.getRowsModified() > 0;   // 必须在 saveDb 之前读
  saveDb();
  return changed;
}

module.exports = {
  insertArticle,
  getArticleById,
  updateArticle,
  searchArticles,
  getStats,
  getSources,
  deleteArticle,
};
