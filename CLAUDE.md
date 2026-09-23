# 大CAR愈见 — CAR-T细胞治疗病例报道案例检索系统

微信公众号文章抓取、存储与搜索平台。通过 Puppeteer 自动提取文章元数据，SQLite 存储，前端支持关键词搜索与分页浏览，部署至 GitHub Pages。

- 线上地址: https://jichen0406-blip.github.io/dacar-yujian/
- 本地运行: `http://localhost:3000/`

## 项目结构

```
wechat-search/
├── index.html                  # 公开搜索页（GitHub Pages 入口）
├── article.html                # 文章详情页（本地文章富文本 / 三方文章纯文本）
├── admin.html                  # 管理面板（仅本地：抓取三方文章 + 撰写本地文章）
├── logo.png                    # 驯鹿生物 logo（白底）
├── articles-data.js            # 构建产物：静态文章数据（window.__ARTICLES__）
├── package.json                # 依赖与启动脚本
├── .gitignore                  # 忽略 node_modules、DB、备份、.env
├── images/                     # 本地文章图片（.gitkeep 占位；内容随仓库发布）
├── vendor/wangeditor/          # 富文本编辑器本地副本（避免 CDN 不可达）
├── data/
│   ├── wechat-search.db        # SQLite 数据库（gitignore）
│   └── backups/                # 数据库备份（保留最近 10 个，gitignore）
├── scripts/
│   ├── build-data.js           # 从 DB 生成 articles-data.js
│   ├── backup-db.js            # 备份数据库（带轮转，最多 10 个）
│   ├── fix-summaries.js        # 从正文提取/修复文章摘要
│   └── fix-keywords.js         # 重跑医生名+医院名关键词
└── src/
    ├── index.js                # Express 服务入口
    ├── config.js               # 端口、数据目录、Puppeteer 配置
    ├── scraper.js              # Puppeteer 抓取：标题、摘要、来源、日期
    ├── keywords.js             # 关键词提取：医生名（中/英）+ 医院名
    ├── text-process.js         # 文本处理：清洗、HTML→文本、摘要、XSS 净化
    ├── db/
    │   ├── connection.js       # sql.js 初始化与持久化
    │   ├── schema.js           # 建表语句 + 幂等迁移
    │   └── repository.js       # CRUD：增删查改、统计
    └── routes/
        ├── fetch.js            # POST /api/fetch
        ├── articles.js         # GET /api/articles/:id, POST /api/local, POST /api/articles/:id/update
        ├── upload.js           # POST /api/upload（图片压缩入库）
        ├── search.js           # GET /api/search
        └── stats.js            # GET /api/stats, /api/sources, POST /api/articles/:id/delete
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 抓取 | Puppeteer (headless Chrome) |
| 关键词提取 | 正则匹配医生名（中/英）+ 医院名；@node-rs/jieba 仅作兜底 |
| 富文本编辑 | wangEditor v5（本地 `vendor/` 副本，非 CDN） |
| 图片处理 | sharp（转 WebP、限宽 1600px） |
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
4. 摘要提取：只要正文非空，始终从正文开头提取引言（清洗微信格式杂质、移除视频播放器残留文本后截取前 500 字符），meta description 仅在正文为空时兜底
5. 关键词提取（[src/keywords.js](src/keywords.js)）：以「医生姓名 + 医院名称」为主
   - 中文医生名：2-3 字姓名紧贴头衔词（教授/主任医师/博士/医师等）作锚点，再剥除被贪心匹配带上的部门/连接字
   - 英文医生名：首字母大写的姓名序列（Kenneth C. Anderson、Wee Joo Chng、Dr.Chutima Kunacheewa），过滤普通英文词
   - 医院名：以医院/医学院/研究所等后缀锚定，在连续汉字串内向右回退到分隔字之后取整名
   - 标题中的讲者优先 → 标题医院 → 正文医生 → 正文医院，去重后上限 10 个；完全无专家名时才用 jieba 兜底
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

**[scripts/fix-keywords.js](scripts/fix-keywords.js)** — 重跑已有文章的关键词：
```js
const { extractKeywords } = require("../src/keywords");
// 对每篇文章：UPDATE articles SET keywords = extractKeywords(title, content).join(",")
```

### 关键词提取（[src/keywords.js](src/keywords.js)）

以「医生姓名 + 医院名称」为关键词主体，聚焦"谁在分享、来自哪家医院"：

```js
// 中文医生名：头衔词作锚点（贪婪会带上前面字，需剥前缀）
const CN_DOCTOR = /[一-鿿]{1,3}(?:教授|主任医师|主治医师|医师|博士|院长|研究员|导师)/g;
// name = token 去头衔后，剥除部门/连接前缀（院/科/邀/由…），黑名单过滤伪名

// 英文医生名：首字母大写姓名序列，支持 Dr./Prof. 前缀、全大写姓（CHNG）
const EN_NAME_TOKEN =
  /(?:[A-Z][a-z]+(?:\s+(?:[A-Z]\.|[A-Z][a-z]+|[A-Z]{2,}))+|...)/g;

// 医院名：后缀锚定后，在连续汉字串里向右回退到分隔字（于/在/由/…）之后
// 注意：紧贴后缀的字（协和|医院 的"和"）属于医院名，不可当分隔符
const HOSP_SUFFIX = /(?:医院|医学院|医学中心|研究所|研究院|...)$/;

// 排序：标题讲者 → 标题医院 → 正文医生 → 正文医院；上限 10；全空才 jieba 兜底
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
| GET | `/api/articles/:id` | 单篇详情（含富文本） | → 全字段含 `content_html`/`created_at`/`updated_at`；400 非法 id，404 不存在 |
| POST | `/api/local` | 新建本地文章 | Body: `{ title, content_html, pub_date?, summary?, keywords? }` → `{ success, id, article_url, summary, keywords }` |
| POST | `/api/articles/:id/update` | 编辑本地文章 | Body 同上 → `{ updated: true, id, summary, keywords }`；**403 若为三方文章** |
| POST | `/api/upload` | 上传图片 | Body = 图片裸字节 → `{ success, url, width, height, bytes }`；413 超 15MB，415 非图片 |
| GET | `/api/stats` | 统计信息 | `{ total_articles, by_source: [{name, count}] }` |
| GET | `/api/sources` | 公众号列表 | `["来源A", "来源B", ...]` |
| POST | `/api/articles/:id/delete` | 删除文章 | `{ deleted: true/false }` |
| POST | `/api/deploy` | 触发部署 | `{ success: true, url }` 或 `{ success: false, error }` |

## 数据库设计

```sql
CREATE TABLE articles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  summary      TEXT DEFAULT '',
  keywords     TEXT DEFAULT '',
  pub_date     TEXT NOT NULL,         -- YYYY-MM-DD
  article_url  TEXT NOT NULL UNIQUE,  -- 去重键；本地文章为 local://<uuid>
  source_name  TEXT NOT NULL,         -- 公众号名称 / 「本地上传」
  content      TEXT DEFAULT '',       -- 纯文本前 2000 字符（供 LIKE 检索）
  content_html TEXT DEFAULT '',       -- 富文本原文（仅本地文章非空）
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT ''        -- 最后一次编辑时间
);
CREATE INDEX idx_articles_pub_date ON articles(pub_date);
CREATE INDEX idx_articles_source ON articles(source_name);
```

**迁移**：`src/db/schema.js` 的 `migrate()` 用 `PRAGMA table_info` 探测缺失列再做 `ALTER TABLE ADD COLUMN`，存量库不重建；建表语句本身也带新列，新库一步到位。

## 本地文章（后台撰写）

**数据源标记**：`source_name = "本地上传"`，`article_url = "local://<uuid>"`。
`local://` 前缀兼任**类型判别器**（比可改的 source_name 可靠），前端卡片分流、后端编辑守卫都用它：

```js
// index.html — 本地文章进详情页，三方文章跳原文
li.addEventListener("click", () => {
  if (isLocalArticle(article)) window.location.href = "article.html?id=" + article.id;
  else window.open(article.article_url, "_blank");
});
```

**新建/编辑流程**（`src/routes/articles.js`）：
1. 校验标题、正文非空
2. `deriveLocalArticleFields()`（`src/text-process.js`）一次派生四个字段：
   - `content_html` = `sanitizeHtml(输入 HTML)`（服务端白名单净化）
   - `content` = `htmlToText(safeHtml).slice(0,2000)` — **必须写**，否则 LIKE 检索与前端筛选对本地文章失效
   - `summary` = `extractIntro(text, { mergeCjkLines: false })`
   - `keywords` = `extractKeywords(title, text)`
3. 编辑时先查存在性 → 再校验 `article_url` 以 `local://` 开头（**三方文章返回 403，绝不允许覆盖**）

**图片流程**（`src/routes/upload.js`）：
- 前端把 `File` 作为请求体裸传（`express.raw`），**不需要 multer**
- 服务端先验**魔数**（不信任 Content-Type），再用 sharp 按 EXIF 摆正 → 最长边压到 1600px → 转 WebP q82
- 文件名完全由服务端生成，不含用户输入 → 免疫路径穿越
- 返回**相对路径** `images/xxx.webp`

**详情页**（`article.html`）：`content_html` 非空走富文本，否则把 `content` 按段落渲染；三方文章额外显示「阅读原文」。

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
node scripts/fix-keywords.js   # 重跑医生名+医院名关键词

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
- **静态数据文件**：90 篇文章约 257KB，每次部署需重新构建。只有本地文章的 `content_html` 会内嵌（三方文章该字段被 `build-data.js` 删掉），避免无谓膨胀。

### 关键词提取：医生名 + 医院名

- **需求驱动**：早期用 jieba 分词 + n-gram，产出大量碎片（"多发性骨""爱斌教授""江大学医"），无法点击检索到"谁在分享、来自哪家医院"。改版后关键词以医生全名 + 医院全名为准。
- **中文医生名**：以头衔词（教授/主任医师/博士…）作锚点反推姓名，天然避开分词难题。但贪婪匹配会把前面的部门字带上（"医院血液科冯茹教授" → 抓到"科冯茹"），需要剥除前缀垃圾字（院/科/邀/由…）。**黑名单排除伪名**：科室主任、临床医师、城市名（北京/上海…）等。
- **英文医生名**：标题大写的姓名序列，需兼容 `Dr.X`（无空格）、全大写姓（`Wee Joo CHNG`）、教授/学位尾缀；用常见学术词停用表（Antigen、Year、Session…）过滤非人名短语。
- **医院名**：以医院/医学院/研究所后缀锚定。关键坑——医院名内部可能含连词字："协和医院"的"和"、以及"中"（中国医学科学院）等，不能一律当分隔符；正确做法是取连续汉字串里**分隔字之后、且紧贴后缀的分隔字跳过**的整段。
- **排序**：标题里的讲者权重最高（核心汇报人），正文里遇到的医生/医院按出现先后入列，去重去包含子串后截 10 个。
- **兜底**：正文确无专家名的会议新闻稿才回退 jieba，避免关键词为空。
- **历史数据**：`node scripts/fix-keywords.js` 用正文 content 重跑全部文章（90 篇一次通过），无需重新抓取。

### sql.js 的两个隐蔽陷阱

- **`saveDb()` 会重置连接状态**：`saveDb()` 内部的 `db.export()` 会关闭并重开数据库句柄，导致 `getRowsModified()` 与 `last_insert_rowid()` **归零**。原先 `insertArticle`/`updateArticle`/`deleteArticle` 都是在 `saveDb()` **之后**读这两个值，于是插入恒返回 false、删除恒报告失败（数据其实写进去了）。**修法：两个值都必须在 `saveDb()` 之前读**。
- **`INSERT OR IGNORE` 被忽略时 `last_insert_rowid()` 会残留旧值**：不能用它单独判断"是否真的插入"。必须先用 `getRowsModified()` 判断本次是否写入，再取 id，否则重复 URL 会返回上一行的 id。现 `insertArticle` 返回新行 id（重复时返回 0），`fetch.js` 靠真值判断兼容。

### 富文本编辑器（wangEditor v5）

- **`setHtml()` 无法回填含图片的内容**：对相对路径 `<img>` 会抛 `Cannot read properties of null (reading 'length')`，且内容会被部分写入、结构错乱（图片被吸进 `<p>`）。**纯文字内容 `setHtml` 正常，只有含图才炸**。
- **可行方案：销毁重建**。编辑回填走 `mountEditor(html)` → `editor.destroy()` + `toolbar.destroy()` + 清空容器 + `createEditor({ html })`，结构完整保留、编辑器后续可正常使用。`dangerouslyInsertHtml` 也能用但会改变图片的层级结构，不用。
- **不要依赖 CDN**：本机环境 unpkg 与 npm registry 均不可达（jsdelivr 可达）。编辑器已落盘到 `vendor/wangeditor/`（1.33MB JS + 15KB CSS），`admin.html` 引本地路径，彻底摆脱网络依赖。

### 本地服务器也会读到嵌入式快照

- `articles-data.js` 提交在仓库根目录，`express.static(项目根)` 会把它一并发出，于是**本地下 `window.__ARTICLES__` 也存在**。若只判断该变量是否存在来切模式，本地就会一直读 deploy 快照、拿不到实时 DB，"保存后立刻预览"完全失效。
- 修法：加 `IS_LOCAL_SERVER` 判断，本地强制走 API：
  ```js
  const IS_LOCAL_SERVER = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(location.hostname);
  const USE_EMBEDDED = !IS_LOCAL_SERVER && HAS_EMBEDDED;
  ```

### GitHub Pages 图片路径

- 站点根是 `/dacar-yujian/` 而非 `/`，图片 URL **必须用相对路径** `images/xxx.webp`。写成 `/images/xxx.webp` 在本地正常、上线 404。
- **git 历史里的图片永久占体积**（删文件也不减历史），所以"入库即压缩"是控制仓库体积的唯一有效手段（sharp 转 WebP + 限宽 1600px）。
- `images/` 必须有 `.gitkeep` 并提交，否则 `/api/deploy` 里 `git add images/` 会 pathspec 不匹配 → `execSync` 抛错 → 整条部署链失败。

## 注意事项

- 微信文章页面可能因反爬机制返回空白，Puppeteer 使用真实 Chrome 可解决
- `articles-data.js` 约 257KB（90 篇文章），每次部署需重新构建；本地文章的 `content_html` 会内嵌，注意体积增长（超 2MB 应考虑拆成按需拉取的独立文件）
- 数据库备份保留最近 10 个，自动轮转删除旧文件
- 搜索少于 2 个字时显示全部文章
- `admin.html` 需要本地 Express 服务（`/api/*`），在 GitHub Pages 上不可用
- 本地文章上限 10 个关键词标签、正文纯文本入库 2000 字符；单张图片上限 15MB（压缩后通常 100-350KB）
