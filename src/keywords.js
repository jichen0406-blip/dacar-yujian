/**
 * Keyword extraction focused on doctor names (CN + EN) and hospital names.
 * Extracts proper nouns that matter for a medical case-search site:
 * "who is sharing, from which hospital" — instead of generic segmented words.
 */

// ── Text normalization ──
function collapseWS(text) {
  return (text || "").replace(/\s+/g, "");
}

// ── CN doctor name extraction ──

// CN doctor: up to 3 han chars followed by a title/rank word.
// The name is trimmed afterwards — leading junk (dept/frame chars glued by
// greedy matching) is dropped from the front of the bare name.
const CN_DOCTOR = /[一-鿿]{1,3}(?:教授|主任医师|副主任医师|主治医师|住院医师|主任|医师|博士|院长|研究员|导师)/g;

// Leading chars that are never part of a person's name; stripped from the
// front of a candidate when greedy matching glued preceding context onto it.
// 于/向 excluded — they are real surnames in this corpus (于滕滕、向茜茜)。
// 丨 是标题分隔符（「大CAR愈见丨安刚教授」），必须剥离，否则会与「安刚」共存并被去重误删。
const CN_NAME_LEAD_JUNK = /^[院科室医附血液辞词到邀请特与及和并或让在把者将等这那该各其会届位名患被的了经新由助临内病骨髓肿瘤免疫治疗研究护理主外骨神精心脏肝肾皮妇产儿眼检影放麻急康复药化国丨·、，。]+/;

const CN_NAME_TRAIL_JUNK = /[的了等和与及并其之该各位名中上内处人员数]+$/;

// Whole tokens that are clearly not doctor names (department + title noise).
const CN_TOKEN_BLACKLIST = new Set([
  "科室主任", "主任医师", "副主任医师", "主治医师", "住院医师", "检验技师",
  "医院院长", "该院医师", "本院医师", "大会主席", "院长", "导师",
]);

// Bare names that aren't real people (role/term + title false positives).
const CN_BARE_REJECT = new Set([
  "临床", "患者", "医师", "药师", "护师", "主任", "护士", "护士长",
  "专家", "主治", "大夫", "医生", "细胞", "肿瘤", "血液", "骨髓",
  "免疫", "治疗", "研究", "教授", "随访", "病例", "医学", "医院",
  "科室", "内科", "外科", "儿科", "妇科", "产科", "药学", "检验",
  "影像", "麻醉", "急诊", "康复", "中医", "中药", "助理", "研究员",
  "住院", "护理", "学员", "主任医",
  "北京", "上海", "广州", "深圳", "中国", "天津", "重庆", "杭州", "南京",
  "武汉", "成都", "西安", "长沙", "郑州", "沈阳", "大连", "青岛", "济南",
  "福州", "厦门", "苏州", "温州", "宁波", "佛山",
]);

const CN_TITLE_SUFFIX = /(教授|主任医师|副主任医师|主治医师|住院医师|主任|医师|博士|院长|研究员|导师)$/;

// 数量词误匹配：真实姓名不含「多位/各位/数名」这类量词
const CN_QUANTIFIER = /(?:^|[多各数几])[位名]$/;

function extractCnDoctors(text) {
  const out = [];
  if (!text) return out;
  const s = collapseWS(text);

  for (const m of s.matchAll(CN_DOCTOR)) {
    const token = m[0];
    if (CN_TOKEN_BLACKLIST.has(token)) continue;

    const raw = token.replace(CN_TITLE_SUFFIX, "");
    if (CN_QUANTIFIER.test(raw)) continue;   // 「华西多位教授」「各位教授」

    let name = raw.replace(CN_NAME_LEAD_JUNK, "").replace(CN_NAME_TRAIL_JUNK, "");

    if (name.length < 2 || name.length > 4) continue;
    if (CN_BARE_REJECT.has(name)) continue;
    if (out.indexOf(name) !== -1) continue;
    out.push(name);
  }
  return out;
}

// ── EN doctor name extraction ──
// 支持连字符姓氏（Al-Shemmari）、缩写（H. / C.）、全大写姓（CHNG）
const EN_NAME_TOKEN =
  /(?:[A-Z][a-z]+(?:-[A-Z][a-z]+)?(?:\.[A-Z][a-z]+)?(?:\s+(?:[A-Z]\.|[A-Z][a-z]+(?:-[A-Z][a-z]+)?|[A-Z]{2,}))+|[A-Z][a-z]+\.[A-Z][a-z]+)/g;

const EN_STOP = new Set([
  "The", "This", "These", "Those", "And", "Or", "But", "For", "With", "From",
  "International", "Annual", "Meeting", "Congress", "Session", "Report",
  "University", "Hospital", "Center", "Institute", "Society", "CAR", "Cell",
  "Multiple", "Myeloma", "Clinical", "Study", "Research", "Data",
  "Part", "Review", "Discussion", "EHA", "IMS", "ASH", "EBMT", "April",
  "China", "New", "First", "Latest", "Update", "Updates",
  "Chimeric", "Antigen", "Receptor", "Immunotherapy", "Year", "Follow",
  "Month", "Week", "Overall", "Survival", "Progression", "Free", "Pivotal",
  "Trial", "Phase", "Results", "Treatment", "Response", "Remission",
  "Efficacy", "Safety", "Analysis", "Median", "Updated", "Real", "World",
  "Poster", "Oral", "Plenary", "Session", "Abstract", "Leukemia", "Lymphoma",
  "Cell", "Therapy", "Therapeutic", "Potential", "Outcomes", "Among",
  "Functional", "High", "Risk", "Low", "Newly", "Diagnosed", "Relapsed",
  "Refractory", "Marrow", "Plasma", "Diseases", "Disease", "Grade", "Frontier",
  "Frontiers", "Future", "Vision", "Journal", "Nature", "Medicine", "Lancet",
  "Hematology", "Advances", "Advance", "Patient", "Patients", "Cases", "Series",
]);

function extractEnDoctors(text) {
  const out = [];
  if (!text) return out;
  // normalize non-breaking spaces & "Dr.X" → "Dr. X" so sequences match
  const norm = text.replace(/ /g, " ").replace(/\.([A-Z][a-z])/g, ". $1");

  for (const m of norm.matchAll(EN_NAME_TOKEN)) {
    let name = m[0];
    // drop Dr./Prof. prefix and any trailing degree
    name = name
      .replace(/^(?:Dr|Prof|Professor)\.\s*/i, "")
      .replace(/\s*(?:教授|MD|PhD|DO|MPH|D\.Phil)$/i, "");

    const words = name.split(/\s+/);
    const first = words[0] || "";
    if (EN_STOP.has(first)) continue;
    // require at least 2 real tokens (first + something after it)
    const body = words.slice(1);
    if (body.length === 0) continue;
    if (body.some(w => EN_STOP.has(w.replace(/\.$/, "")))) continue;
    if (out.indexOf(name) !== -1) continue;
    out.push(name);
  }
  return out;
}

// ── Hospital / institution name extraction ──
const HOSP_SUFFIX = /(?:医院|医学院|医学中心|医疗中心|防治中心|研究所|研究院|医学部|医院集团)$/;
const HOSP_SUFFIX_SCAN = /医院|医学院|医学中心|医疗中心|防治中心|研究所|研究院|医学部|医院集团/g;

// A hospital's true start normally follows a clause/frame tail such as
// 于/在/由/特邀/， or the run's start. Inside a continuous han run, we pick
// the start as right after the RIGHTMOST frame char before the suffix.
// NOTE: chars that legitimately START hospital names (中 for 中国/中山, 华 for
// 华中) must NOT be treated as frames.
const HOSP_FRAME = new Set([
  "于", "在", "到", "至", "赴", "往", "请", "邀", "特", "由", "自",
  "收", "治", "前", "后", "位", "进", "入", "就", "来", "向", "从",
  "被", "将", "把", "与", "及", "和", "并", "或", "即", "也", "还",
  "又", "更", "等", "但", "是", "仅", "仍", "需", "时", "经", "过",
  "让", "这", "那", "该", "个", "做", "用", "当", "随",
]);

// Leftover clause junk a hospital capture could still begin with; stripped
// off the front repeatedly. Chars that can start a real hospital name
// (中/华/上/南/北/广/深/常/军/解/人…) are intentionally NOT here.
const HOSP_LEAD_JUNK = /^[展势多许各外进近了就来前后位本这那的等所内肿瘤科室优加至之已未仅需时仍现使由特邀请与及和并在把被将向自收治作于出而到让经主研要究者关为针探揭示表明显提改善促包参]*/;

// 泛指而非具体机构（「中国医院」「当地医院」），不是机构专名
const HOSP_GENERIC = /^(?:中国|国内|全国|当地|该|本|某|我市|海外|国外|外省|境外|各大|一家)(?:医院|医学院|医学中心|研究所|研究院)$/;

// An already-kept name; drop new candidates that are substrings of it.
function dedupLongest(list) {
  const kept = [];
  for (const name of [...list].sort((a, b) => b.length - a.length)) {
    if (kept.some(k => k.includes(name))) continue;
    kept.push(name);
  }
  return kept;
}

function extractHospitals(text) {
  const found = [];
  if (!text) return found;
  const s = collapseWS(text);

  for (const m of s.matchAll(HOSP_SUFFIX_SCAN)) {
    // find the contiguous han run that contains this suffix
    let runStart = m.index;
    while (runStart > 0 && /[一-鿿]/.test(s[runStart - 1])) runStart--;

    // within [runStart, suffixStart), hospital starts right after the
    // rightmost frame char (or at run start if none). A frame char sitting
    // DIRECTLY before the suffix (协和|医院, 人民|医院…) is part of the name
    // and is skipped — separators like 和 are at least one char away.
    let start = runStart;
    for (let k = m.index - 1; k >= runStart; k--) {
      if (HOSP_FRAME.has(s[k]) && k !== m.index - 1) { start = k + 1; break; }
    }

    const name = s.slice(start, m.index + m[0].length)
      .replace(HOSP_LEAD_JUNK, "")
      .replace(/医院医院$/, "医院");
    if (name.length < 4 || name.length > 22) continue;
    if (name.includes("某") || name.includes("另一") || name.includes("国内外")) continue;
    if (HOSP_GENERIC.test(name)) continue;   // 「中国医院」这类泛指，非具体机构
    found.push(name);
  }

  return dedupLongest(found);
}

// ── Legacy jieba fallback (kept for articles with no doctor/hospital name) ──
let _jieba = null;
function getJieba() {
  if (_jieba) return _jieba;
  const { Jieba } = require("@node-rs/jieba");
  const fs = require("fs");
  const path = require("path");
  const j = new Jieba();
  const dictPath = path.join(
    path.dirname(require.resolve("@node-rs/jieba/package.json")),
    "dict.txt"
  );
  j.loadDict(new Uint8Array(fs.readFileSync(dictPath)));
  _jieba = j;
  return j;
}

const LEGACY_STOPWORDS = new Set([
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
  "个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有",
  "看", "好", "自己", "这", "他", "她", "它", "们", "那", "些", "所", "为",
  "因为", "所以", "但是", "然而", "而且", "可以", "这个", "那个", "什么",
  "怎么", "如何", "哪", "吗", "呢", "啊", "吧", "哦", "嗯", "与", "及", "或",
  "对", "从", "被", "把", "向", "将", "以", "让", "给", "于", "则", "其",
  "中", "等", "更", "已", "还", "又", "再", "能", "该", "应", "可", "后",
  "前", "里", "外", "上", "下", "大", "小", "多", "少", "来", "去", "出",
  "进", "过", "回", "开", "关", "用", "做", "种", "次", "月", "日", "年",
  "时", "分", "期", "至", "并", "而", "且", "但", "或", "虽", "若", "如",
  "当", "因", "故", "此", "之", "其", "者", "仅", "仍", "常", "需", "无",
  "相对", "通过", "进行", "出现", "发生", "包括", "相关", "目前",
  "本文", "来源", "编辑", "排版", "审核", "声明",
  "仅供", "参考", "内容", "成为", "第一", "部分", "医药", "平台", "媒体",
  "文章", "研究", "结果", "方法", "讨论", "结论", "背景",
  "特邀", "专家", "教授", "分享", "邀请", "本期", "病例",
  "医院", "大学", "附属", "科室", "血液", "主任", "医师", "副主任",
  "报告", "主要", "方案", "分别为", "分为", "显示", "提示", "表明", "未见",
  "其中", "同时", "此外", "最后", "如有", "谢谢",
  "患者", "治疗", "细胞", "蛋白",
  "患者的", "治疗的", "医院的", "教授的", "特邀",
]);

function legacyExtract(title, body) {
  const j = getJieba();
  const freq = {};

  for (const w of j.cut((body || "").slice(0, 2000))) {
    if (w.length < 2 || LEGACY_STOPWORDS.has(w)) continue;
    if (!/[一-鿿]/.test(w) && !/^[A-Za-z]/.test(w)) continue;
    freq[w] = (freq[w] || 0) + 1;
  }
  for (const w of j.cut(title || "")) {
    if (w.length < 2 || LEGACY_STOPWORDS.has(w)) continue;
    if (!/[一-鿿]/.test(w)) continue;
    freq[w] = (freq[w] || 0) + 3;
  }

  const candidates = Object.entries(freq)
    .filter(([k]) => k.length >= 2 && !LEGACY_STOPWORDS.has(k))
    .sort((a, b) => b[1] - a[1]);

  const result = [];
  for (const [word] of candidates) {
    const isSubstring = result.some(r => r !== word && r.includes(word));
    if (!isSubstring) result.push(word);
    if (result.length >= 10) break;
  }
  return result;
}

// ── 国家 / 非大陆地区 ──

/**
 * [规范名, [别名...]]
 * 刻意不含「中国」：它出现在 50/95 篇文章里，作为关键词没有区分度。
 * 港澳台按「中国XX」归一，与主权国家一同作为「国家/地区」提取。
 */
const COUNTRY_ALIASES = [
  ["美国", ["美国", "美利坚"]],
  ["英国", ["英国"]],
  ["法国", ["法国"]],
  ["德国", ["德国"]],
  ["意大利", ["意大利"]],
  ["西班牙", ["西班牙"]],
  ["葡萄牙", ["葡萄牙"]],
  ["荷兰", ["荷兰"]],
  ["比利时", ["比利时"]],
  ["瑞士", ["瑞士"]],
  ["瑞典", ["瑞典"]],
  ["奥地利", ["奥地利"]],
  ["丹麦", ["丹麦"]],
  ["挪威", ["挪威"]],
  ["芬兰", ["芬兰"]],
  ["波兰", ["波兰"]],
  ["希腊", ["希腊"]],
  ["爱尔兰", ["爱尔兰"]],
  ["捷克", ["捷克"]],
  ["俄罗斯", ["俄罗斯"]],
  ["乌克兰", ["乌克兰"]],
  ["土耳其", ["土耳其"]],
  ["以色列", ["以色列"]],
  ["沙特阿拉伯", ["沙特阿拉伯", "沙特"]],
  ["阿联酋", ["阿联酋", "阿拉伯联合酋长国"]],
  ["卡塔尔", ["卡塔尔"]],
  ["科威特", ["科威特"]],
  ["阿曼", ["阿曼"]],
  ["巴林", ["巴林"]],
  ["约旦", ["约旦"]],
  ["黎巴嫩", ["黎巴嫩"]],
  ["伊朗", ["伊朗"]],
  ["伊拉克", ["伊拉克"]],
  ["埃及", ["埃及"]],
  ["南非", ["南非"]],
  ["印度", ["印度"]],
  ["印度尼西亚", ["印度尼西亚", "印尼"]],
  ["巴基斯坦", ["巴基斯坦"]],
  ["孟加拉国", ["孟加拉国", "孟加拉"]],
  ["斯里兰卡", ["斯里兰卡"]],
  ["尼泊尔", ["尼泊尔"]],
  ["泰国", ["泰国"]],
  ["越南", ["越南"]],
  ["马来西亚", ["马来西亚"]],
  ["新加坡", ["新加坡"]],
  ["菲律宾", ["菲律宾"]],
  ["缅甸", ["缅甸"]],
  ["柬埔寨", ["柬埔寨"]],
  ["老挝", ["老挝"]],
  ["文莱", ["文莱"]],
  ["蒙古", ["蒙古"]],
  ["哈萨克斯坦", ["哈萨克斯坦"]],
  ["乌兹别克斯坦", ["乌兹别克斯坦"]],
  ["日本", ["日本"]],
  ["韩国", ["韩国", "南韩"]],
  ["朝鲜", ["朝鲜"]],
  ["澳大利亚", ["澳大利亚", "澳洲"]],
  ["新西兰", ["新西兰"]],
  ["加拿大", ["加拿大"]],
  ["墨西哥", ["墨西哥"]],
  ["巴西", ["巴西"]],
  ["阿根廷", ["阿根廷"]],
  ["智利", ["智利"]],
  ["哥伦比亚", ["哥伦比亚"]],
  ["秘鲁", ["秘鲁"]],
  // 非大陆地区
  ["中国香港", ["中国香港", "香港"]],
  ["中国澳门", ["中国澳门", "澳门"]],
  ["中国台湾", ["中国台湾", "台湾"]],
];

// 按别名长度降序：保证「印度尼西亚」先于「印度」、「中国香港」先于「香港」
const COUNTRY_LOOKUP = COUNTRY_ALIASES
  .flatMap(([canon, aliases]) => aliases.map(a => [a, canon]))
  .sort((a, b) => b[0].length - a[0].length);

function extractCountries(text) {
  const out = [];
  if (!text) return out;
  let s = collapseWS(text);
  const hits = [];

  for (const [alias, canon] of COUNTRY_LOOKUP) {
    const idx = s.indexOf(alias);
    if (idx === -1) continue;
    hits.push({ canon, pos: idx });
    // 抠掉已匹配片段（等长填充，位置不变），避免「印度尼西亚」里再匹配出「印度」
    s = s.split(alias).join("\u0000".repeat(alias.length));
  }

  hits.sort((a, b) => a.pos - b.pos);   // 按原文出现顺序
  for (const h of hits) if (out.indexOf(h.canon) === -1) out.push(h.canon);
  return out;
}

/**
 * Extract keywords — doctor names, then countries/regions, then hospitals
 * (title first); falls back to legacy jieba segmentation only when nothing matched.
 * @returns {string[]} up to 10 keywords
 */
function extractKeywords(title, body) {
  const t = title || "";
  const b = body || "";

  const seen = new Set();
  const push = arr => {
    for (const k of arr) {
      if (!seen.has(k)) {
        seen.add(k);
        if (seen.size >= 10) return;
      }
    }
  };

  // 标题优先（核心汇报人 / 主办地），再正文；每层内：医生名 → 国家/地区 → 医院
  const countryHits = new Set();
  const pushCountries = arr => { for (const c of arr) countryHits.add(c); push(arr); };

  push(extractCnDoctors(t));
  push(extractEnDoctors(t));
  pushCountries(extractCountries(t));
  push(extractHospitals(t));
  push(extractCnDoctors(b));
  push(extractEnDoctors(b));
  pushCountries(extractCountries(b));
  push(extractHospitals(b));

  const all = [...seen];
  // 子串去重：「华西」⊂「华西医院」时只留长者。
  // 国家/地区豁免，否则「美国」会被「美国哈佛医学院」吞掉。
  const keywords = all.filter(
    k => countryHits.has(k) || !all.some(o => o !== k && o.includes(k))
  );
  if (keywords.length >= 1) return keywords.slice(0, 10);

  // 无结构化匹配时用 jieba 兜底。但正文过短（只填了标题、正文是「文章详情」
  // 这类占位符的空壳文章）切出来全是「倾听/临床/声音」泛词，不如不产出，
  // 留空反而能暴露数据问题。
  if (String(b).length < 50) return [];

  return legacyExtract(t, b);
}

module.exports = {
  extractKeywords,
  extractCnDoctors,
  extractEnDoctors,
  extractCountries,
  extractHospitals,
};
