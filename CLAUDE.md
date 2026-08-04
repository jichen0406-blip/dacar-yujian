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

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/fetch` | 批量抓取文章。Body: `{ urls: [...] }` |
| GET | `/api/search?q=&page=1&limit=20&source=` | 搜索文章（按 pub_date 降序） |
| GET | `/api/stats` | 统计：总数 + 按来源分组 |
| GET | `/api/sources` | 所有公众号名称列表 |
| POST | `/api/articles/:id/delete` | 删除一篇文章 |
| POST | `/api/deploy` | 触发部署：构建数据 → 备份 DB → git push |

## 双模式前端

`index.html` 同时支持两种运行模式，通过 `USE_EMBEDDED` 自动切换：

- **GitHub Pages（嵌入式）**：加载 `articles-data.js` 中的 `window.__ARTICLES__`，纯客户端搜索
- **本地服务器（API）**：通过 `/api/search` 实时查询数据库

## 抓取逻辑

`src/scraper.js` 中的 `fetchArticle(url)` 流程：

1. Puppeteer 打开微信文章链接（拦截图片/字体加速加载）
2. 从页面 DOM 提取：`og:title` → 标题，`meta[name="description"]` → 摘要，`#js_name` → 公众号名，`#publish_time` → 发布日期，`#js_content` → 正文
3. 若 meta description 为空或过短，从正文开头提取引言作为摘要（跳过章节标题，上限 500 字符）
4. 用 jieba 分词 + n-gram 提取中文关键词（去停用词、去重子串，最多 10 个）
5. 标准化 URL（仅保留 `__biz/mid/idx/sn` 参数）

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

## 环境变量（.env）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | Express 监听端口 |
| `CHROME_PATH` | Chrome 默认安装路径 | Puppeteer 使用的浏览器 |
| `PUPPETEER_HEADLESS` | `true` | 是否无头模式 |
| `FETCH_DELAY_MS` | `2000` | 多篇文章抓取间隔 |
| `PAGE_TIMEOUT_MS` | `30000` | 单页加载超时 |

## 部署流程

1. 确保本地 `main` 分支与 GitHub 同步
2. 在 GitHub 仓库 `Settings > Pages` 中配置 Source 为 `main` 分支的 `/ (root)`
3. 本地运行 `node src/index.js`，在 admin.html 中粘贴文章 URL 并点击「抓取」
4. 点击「部署到线上」按钮（或 `POST /api/deploy`）
5. GitHub Pages 会在 1-2 分钟后更新（CDN 缓存 max-age=600）

## 注意事项

- 微信文章页面可能因反爬机制返回空白，Puppeteer 使用真实 Chrome 可解决
- `articles-data.js` 约 145KB（80 篇文章），每次部署需重新构建
- 数据库备份保留最近 10 个，自动轮转删除旧文件
- 搜索少于 2 个字时显示全部文章
