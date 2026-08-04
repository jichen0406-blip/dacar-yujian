const { getDb, saveDb } = require("./connection");

function insertArticle({ title, summary, keywords, pub_date, article_url, source_name, content }) {
  const db = getDb();
  try {
    db.run(
      `INSERT OR IGNORE INTO articles (title, summary, keywords, pub_date, article_url, source_name, content)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [title, summary || "", keywords || "", pub_date, article_url, source_name, content || ""]
    );
    saveDb();
    return db.getRowsModified() > 0;
  } catch (err) {
    console.error("[repo] insertArticle:", err.message);
    return false;
  }
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
  saveDb();
  return db.getRowsModified() > 0;
}

module.exports = { insertArticle, searchArticles, getStats, getSources, deleteArticle };
