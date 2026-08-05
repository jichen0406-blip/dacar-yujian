# 大CAR愈见 — CAR-T细胞治疗病例报道案例检索系统

微信公众号文章抓取、存储与搜索平台。通过 Puppeteer 自动提取文章元数据，SQLite 存储，前端支持关键词搜索与分页浏览，部署至 GitHub Pages。

- 线上地址: https://jichen0406-blip.github.io/dacar-yujian/
- 本地运行: `http://localhost:3000/`

## 项目结构

```
wechat-search/
├── index.html                  # 公开搜索页（GitHub Pages 入口）
├── admin.html                  # 管理面板（仅本地，粘贴 URL 抓取文章）
├── logo.png                    # 驯鹿生物 logo（白底）
├── articles-data.js            # 构建产物：静态文章数据（window.__ARTICLES__）
├── package.json                # 依赖与启动脚本
├── .gitignore                  # 忽略 node_modules、DB、备份、.env
├── data/
│   ├── wechat-search.db        # SQLite 数据库（gitignore）
│   └── backups/                # 数据库备份（保留最近 10 个，gitignore）
├── scripts/
│   ├── build-data.js           # 从 DB 生成 articles-data.js
│   ├── backup-db.js            # 备份数据库（带轮转，最多 10 个）
│   └── fix-summaries.js        # 从正文提取/修复文章摘要
└── src/
    ├── index.js                # Express 服务入口
    ├── config.js               # 端口、数据目录、Puppeteer 配置
    ├── scraper.js              # Puppeteer 抓取：标题、摘要、来源、日期、关键词
    ├── db/
    │   ├── connection.js       # sql.js 初始化与持久化
    │   ├── schema.js           # 建表语句
    │   └── repository.js       # CRUD：增删查、统计
    └── routes/
        ├── fetch.js            # POST /api/fetch
        ├── search.js           # GET /api/search
        └── stats.js            # GET /api/stats, /api/sources, POST /api/articles/:id/delete
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 抓取 | Puppeteer (headless Chrome) |
| 中文分词 | @node-rs/jieba |
| 数据库 | sql.js (WASM SQLite) |
| 后端 | Express.js |
| 前端 | 纯 HTML/CSS/JS（双模式：嵌入式数据 / API） |
| 部署 | GitHub Pages + 静态数据文件 |

## 核心代码

### 服务入口（[src/index.js](src/index.js)）

Express 服务启动、路由挂载、静态文件托管、部署命令：

```js
// 数据库初始化 → Express 启动
await initDb();
initSchema();

const app = express();
app.use(express.json({ limit: "1mb" }));

// API 路由
app.use("/api/search", require("./routes/search"));
app.use("/api/fetch", require("./routes/fetch"));
app.use("/api", require("./routes/stats"));

// 静态文件
app.use(express.static(path.join(__dirname, "..")));

// POST /api/deploy — 构建静态数据 → 备份 DB → git push
app.post("/api/deploy", async (req, res) => {
  execSync("node scripts/build-data.js", { cwd: gitRoot });
  execSync("node scripts/backup-db.js", { cwd: gitRoot });
  execSync("git add articles-data.js index.html admin.html scripts/ package.json");
  execSync(`git commit -m "data: ${ts} 文章数据更新"`);
  execSync("git push -u origin main");
});
```

### 数据库初始化（[src/db/connection.js](src/db/connection.js)）

sql.js WASM 数据库加载与持久化：

```js
async function initDb() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  return db;
}

function saveDb() {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}
```

### 数据库模式（[src/db/schema.js](src/db/schema.js)）

```sql
CREATE TABLE IF NOT EXISTS articles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  summary     TEXT DEFAULT '',
  keywords    TEXT DEFAULT '',
  pub_date    TEXT NOT NULL,         -- YYYY-MM-DD
  article_url TEXT NOT NULL UNIQUE,  -- 去重键
  source_name TEXT NOT NULL,         -- 公众号名称
  content     TEXT DEFAULT '',       -- 前 2000 字符
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_articles_pub_date ON articles(pub_date);
CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source_name);
```

### 数据访问层（[src/db/repository.js](src/db/repository.js)）

CRUD 操作，URL 去重（`INSERT OR IGNORE`），LIKE 全文搜索：

```js
function insertArticle({ title, summary, keywords, pub_date, article_url, source_name, content }) {
  db.run(`INSERT OR IGNORE INTO articles (...) VALUES (?, ?, ?, ?, ?, ?, ?)`, [...]);
  saveDb();
  return db.getRowsModified() > 0;
}

function searchArticles(query, page = 1, limit = 20, source = "") {
  // 五字段 LIKE 搜索：title, summary, keywords, content, source_name
  const pattern = "%" + query.trim() + "%";
  clauses.push("(title LIKE ? OR summary LIKE ? OR keywords LIKE ? OR content LIKE ? OR source_name LIKE ?)");
  // 排序：pub_date DESC，分页：LIMIT + OFFSET
}

function getStats() { /* 总数 + 按来源分组统计 */ }
function getSources() { /* 去重公众号列表 */ }
function deleteArticle(id) { /* 按 ID 删除 */ }
```

### 抓取器（[src/scraper.js](src/scraper.js)）

Puppeteer 无头浏览器抓取微信文章元数据。核心流程：

1. 启动/复用 Chrome 实例，拦截图片/字体/媒体资源加速加载
2. 导航至微信文章链接，等待 `#js_content` 等关键元素
3. 从 DOM 提取：`og:title` → 标题，`meta[name="description"]` → 摘要，`#js_name` → 公众号名，`#publish_time` → 日期，`#js_content` → 正文
4. 若 meta description 为空或过短（< 50 字符），从正文开头提取引言作为摘要：
   - 清理微信富文本格式杂质（分散换行符）
   - 移除视频播放器残留文本
   - 直接截取前 500 字符
5. 关键词提取：
   - Jieba 分词正文（权重 ×1）+ 标题（权重 ×3）
   - N-gram（3-4 字）挖掘身体文本中的医学复合词（出现 ≥2 次）
   - 去停用词 → 去重子串 → 取前 10 个
6. URL 标准化：仅保留 `__biz/mid/idx/sn` 参数
7. 多篇抓取间隔 2 秒（可配置），避免被反爬

```js
async function fetchArticle(url) {
  const page = await b.newPage();
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (type === "image" || type === "font" || type === "media") req.abort();
    else req.continue();
  });
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

  const metadata = await page.evaluate(() => {
    const title = document.querySelector('meta[property="og:title"]')?.content || document.title;
    const source = document.querySelector("#js_name")?.textContent?.trim() || "";
    const pubDate = document.querySelector("#publish_time")?.textContent?.trim() || "";
    const body = document.querySelector("#js_content")?.innerText?.trim() || "";
    return { title, summary, source, pubDate, body };
  });
  // ... 清洗、标准化、关键词提取 ...
}
```

### API 路由

**POST /api/fetch**（[src/routes/fetch.js](src/routes/fetch.js)）— 批量抓取：
```js
router.post("/", async (req, res) => {
  const { urls } = req.body;
  const validUrls = urls.filter(u => u.includes("mp.weixin.qq.com"));
  const { success, failed } = await fetchArticles(validUrls);
  // 插入成功文章，返回 { total, inserted, duplicates, failed }
});
```

**GET /api/search**（[src/routes/search.js](src/routes/search.js)）— 搜索：
```
GET /api/search?q=关键词&page=1&limit=20&source=公众号名
Response: { rows: [...], total: N, page: 1, limit: 20 }
```

**GET /api/stats** — 统计：
```json
{ "total_articles": 80, "by_source": [{ "name": "CCMTV", "count": 30 }, ...] }
```

**GET /api/sources** — 公众号列表：`["CCMTV", "Htology", ...]`

**POST /api/articles/:id/delete** — 删除：`{ "deleted": true }`

**POST /api/deploy** — 部署：
1. `node scripts/build-data.js` 生成 `articles-data.js`
2. `node scripts/backup-db.js` 备份数据库
3. `git add` → `git commit` → `git push origin main`

### 前端双模式（[index.html](index.html)）

`USE_EMBEDDED` 标志自动切换运行模式：

- **GitHub Pages（嵌入式）**：`window.__ARTICLES__` 存在 → 纯客户端 Array.filter 搜索
- **本地服务器（API）**：无嵌入数据 → 通过 `/api/search` 实时查询

```js
const USE_EMBEDDED = typeof window.__ARTICLES__ !== "undefined"
  && Array.isArray(window.__ARTICLES__) && window.__ARTICLES__.length > 0;

async function search() {
  if (USE_EMBEDDED) {
    // 客户端筛选：title/summary/keywords/content/source_name
    filtered = embeddedArticles.filter(a =>
      a.title.toLowerCase().includes(q) || a.summary.toLowerCase().includes(q) || ...
    );
  } else {
    // API 查询
    const res = await fetch(`/api/search?${params}`);
    rows = data.rows;
  }
}
```

### 辅助脚本

**[scripts/build-data.js](scripts/build-data.js)** — 从 SQLite 生成静态 JS 文件：
```js
const res = db.exec("SELECT ... FROM articles ORDER BY pub_date DESC");
const js = `window.__ARTICLES__ = ${JSON.stringify(articles)};`;
fs.writeFileSync("articles-data.js", js);
```

**[scripts/backup-db.js](scripts/backup-db.js)** — 数据库备份，保留最近 10 个：
```js
fs.copyFileSync(DB_PATH, backupPath);
const backups = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith(".db")).sort();
if (backups.length > 10) { /* 删除最旧的 */ }
```

**[scripts/fix-summaries.js](scripts/fix-summaries.js)** — 修复已有文章摘要：
- 清洗微信格式 → 按句子分割 → 跳过章节标题（引言/前言/摘要等）
- 检测段落边界标志（病例资料/一般情况/辅助检查等）
- 处理粘性标题（"患者一般情况患者，女性..."嵌入场景）

### 关键词提取（[src/scraper.js](src/scraper.js#L276-L372)）

```js
function extractKeywords(title, body) {
  // Step 1: Jieba 分词正文（前 2000 字符）
  for (const w of j.cut(bodyText)) {
    if (w.length < 2 || stopwords.has(w)) continue;
    freq[w] = (freq[w] || 0) + 1;
  }
  // Step 2: 标题分词（3 倍权重）
  // Step 3: 3-4 字 N-gram 发现 Jieba 遗漏的医学复合词
  // Step 4: 去重子串（若已有关键词包含当前词则跳过）
}
```

## 环境变量（.env）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | Express 监听端口 |
| `CHROME_PATH` | Chrome 默认安装路径 | Puppeteer 使用的浏览器 |
| `PUPPETEER_HEADLESS` | `true` | 是否无头模式 |
| `FETCH_DELAY_MS` | `2000` | 多篇文章抓取间隔 |
| `PAGE_TIMEOUT_MS` | `30000` | 单页加载超时 |

## API 接口汇总

| 方法 | 路径 | 说明 | 请求/响应 |
|------|------|------|-----------|
| POST | `/api/fetch` | 批量抓取文章 | Body: `{ urls: [...] }` → `{ total, inserted, duplicates, failed }` |
| GET | `/api/search` | 搜索文章 | Query: `?q=&page=1&limit=20&source=` → `{ rows, total, page, limit }` |
| GET | `/api/stats` | 统计信息 | `{ total_articles, by_source: [{name, count}] }` |
| GET | `/api/sources` | 公众号列表 | `["来源A", "来源B", ...]` |
| POST | `/api/articles/:id/delete` | 删除文章 | `{ deleted: true/false }` |
| POST | `/api/deploy` | 触发部署 | `{ success: true, url }` 或 `{ success: false, error }` |

## 数据库设计

```sql
CREATE TABLE articles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  summary     TEXT DEFAULT '',
  keywords    TEXT DEFAULT '',
  pub_date    TEXT NOT NULL,         -- YYYY-MM-DD
  article_url TEXT NOT NULL UNIQUE,  -- 去重键
  source_name TEXT NOT NULL,         -- 公众号名称
  content     TEXT DEFAULT '',       -- 前 2000 字符
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_articles_pub_date ON articles(pub_date);
```

## 常用命令

```bash
# 安装依赖
npm install

# 启动开发服务器
npm start           # 默认 http://localhost:3000
npm run dev         # 带 --watch 自动重启

# 管理操作
node scripts/build-data.js     # 从数据库构建静态数据文件
node scripts/backup-db.js      # 备份数据库（保留最近 10 个）
node scripts/fix-summaries.js  # 修复/改善已有文章摘要

# 服务器端部署（POST 触发，同 admin.html 中的「部署到线上」按钮）
curl -X POST http://localhost:3000/api/deploy
```

## 部署流程

1. 确保本地 `main` 分支与 GitHub 同步
2. 在 GitHub 仓库 `Settings > Pages` 中配置 Source 为 `main` 分支的 `/ (root)`
3. 本地运行 `node src/index.js`，在 admin.html 中粘贴文章 URL 并点击「抓取」
4. 点击「部署到线上」按钮（或 `POST /api/deploy`）
5. GitHub Pages 会在 1-2 分钟后更新（CDN 缓存 max-age=600）

## 项目经验

### 微信文章抓取

- **必须用 Puppeteer 真实浏览器**：微信公众平台对普通 HTTP 请求返回"参数错误"或验证页面，只有 Puppeteer 渲染 JS 后才能获取真实内容。使用 `networkidle2` 等待策略确保页面完全渲染。
- **资源拦截加速**：拦截 image/font/media 类型请求，大幅减少页面加载时间，同时不影响元数据提取。
- **反爬策略**：多篇抓取间隔 2 秒（`FETCH_DELAY_MS`），使用真实 Chrome User-Agent，避免触发频率限制。
- **URL 规范化**：微信文章 URL 含大量跟踪参数，仅保留 `__biz/mid/idx/sn` 四个核心参数作为唯一标识。

### 摘要提取演进

- **初版问题**：仅依赖 `<meta name="description">`，大部分微信文章此字段为空，导致 30/80 篇文章无摘要。
- **改进方案**：当 meta description 为空或 < 50 字符时，从 `#js_content` 正文提取引言：
  1. 清洗微信富文本格式（多层级换行符分散的中文字符）
  2. 移除视频播放器残留文本（"视频加载失败，请刷新页面再试"）
  3. 直接截取清洗后正文前 500 字符
- **段落边界检测**：为后继脚本 `fix-summaries.js` 实现更精确的摘要提取，需在引言段落结束处截断：
  - 识别章节标题（"病例资料"、"一般情况"、"辅助检查"等）作为边界
  - 处理粘性标题（"患者一般情况患者，女性…" — 标题与正文粘连的场景）
  - 跳过引导性短语（"引言"、"前言"、"编者按"等）找到正文起始位置

### 正则表达式陷阱

- **过度匹配**：初版段落边界正则 `/^(引言?|...)$|[.，。！？\n])[ ]*(病例资料|...)/` 在 `"，治疗方案"` 处错误截断，因为 `，` 后跟 `治疗方案` 匹配了第二分支。修复：分离匹配逻辑，仅对短独立短语（< 20 字符）检查章节标题模式。
- **遗漏场景**："患者一般情况" 不在原始标题列表中，追加后仍需特殊处理，因为其常以粘性形式出现（标题嵌入正文无分隔符）。

### 数据库运维

- **备份策略**：每次部署自动备份，保留最近 10 个（ISO 时间戳命名），旧备份自动轮转删除。
- **灾难恢复**：一次批量重新抓取（80 篇文章）因错误将 content 字段覆盖为 0 长度，从备份 `wechat-search-2026-08-04T06-37-42.db` 恢复，然后仅重新执行摘要修复脚本，避免全量数据丢失。
- **URL 去重**：`article_url TEXT NOT NULL UNIQUE` + `INSERT OR IGNORE` 是简单有效的去重策略，重复 URL 静默跳过。

### GitHub Pages 部署

- **双模式前端**是核心设计决策：线上用嵌入式静态数据（零后端），本地用 API 实时查询。`USE_EMBEDDED` 标志根据 `window.__ARTICLES__` 是否存在自动切换。
- **CDN 缓存**：GitHub Pages CDN 缓存 `max-age=600`（10 分钟），部署后需等待 1-2 分钟才能看到更新。排查"手机端没更新"时优先考虑缓存。
- **静态数据文件**：80 篇文章生成 `articles-data.js` 约 145KB，每次部署需重新构建。

### 中文关键词提取

- **Jieba 分词**作为基础切词器，但对医学专有名词（药物名、靶点、治疗方案）覆盖率有限。
- **N-gram 补偿**：对 3-4 字 N-gram 出现 ≥2 次的词额外加权，捕获 Jieba 遗漏的复合词。
- **去重策略**：若候选词是已选关键词的子串则跳过（如已选"CAR-T细胞治疗"，则跳过"CAR-T"），避免冗余。
- **停用词**：维护针对医学文献的扩展停用词表，排除"患者"、"治疗"、"细胞"等高频但区分度低的词。

## 注意事项

- 微信文章页面可能因反爬机制返回空白，Puppeteer 使用真实 Chrome 可解决
- `articles-data.js` 约 145KB（80 篇文章），每次部署需重新构建
- 数据库备份保留最近 10 个，自动轮转删除旧文件
- 搜索少于 2 个字时显示全部文章
