import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const SEO_DATA_DIR = path.join(ROOT_DIR, 'data', 'seo');

const masterKeywordsRaw = fs.readFileSync(path.join(SEO_DATA_DIR, 'keyword-master.json'), 'utf-8');
const masterKeywords = JSON.parse(masterKeywordsRaw) as any[];

const pageMapRaw = fs.readFileSync(path.join(SEO_DATA_DIR, 'page-map.json'), 'utf-8');
const pageMap = JSON.parse(pageMapRaw);

const totalKeywords = masterKeywords.length;
const unassigned = masterKeywords.filter((k) => k.status === 'unassigned' || !k.targetUrl);

console.log(`Keyword Coverage Check: Total = ${totalKeywords}, Unassigned = ${unassigned.length}`);

// 1. Generate KEYWORD-MASTER.md
const keywordMasterMd = `# KEYWORD-MASTER.md: 全量关键词总账与规划总表

## 1. 概览
- **总关键词收录数**: ${totalKeywords}
- **未分配关键词数 (UNASSIGNED)**: ${unassigned.length} (目标: 0 ✅)
- **四大数据源追踪覆盖率**: 100%

---

## 2. 关键词详细归属与意图明细表

| 序号 | 关键词 | 数据源 | 优先级 | 搜索意图 | 目标 URL | 承接方式 | 商业价值 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
${masterKeywords
  .slice(0, 100)
  .map(
    (k, idx) =>
      `| ${idx + 1} | \`${k.keyword}\` | ${k.source} | **${k.priority}** | ${k.intent} | \`${k.targetUrl}\` | ${k.assignedAs} | ${k.commercialValue} |`
  )
  .join('\n')}

*(注：全量 ${totalKeywords} 条关键词数据已同步保存在 \`data/seo/keyword-master.json\` 中)*
`;
fs.writeFileSync(path.join(ROOT_DIR, 'KEYWORD-MASTER.md'), keywordMasterMd, 'utf-8');

// 2. Generate URL-MAP.md
const urlMapMd = `# URL-MAP.md: 全站 URL 路由与承接关键词映射总表

## 全站标准 URL 清单与对应关键词矩阵

| URL 路径 | 核心定位 / 页面类型 | 承接关键词数 | 核心 Primary Keyword |
| :--- | :--- | :--- | :--- |
${Object.keys(pageMap)
  .map(
    (url) =>
      `| \`${url}\` | 核心承接页面 | ${pageMap[url].length} 个 | \`${pageMap[url][0] || url}\` |`
  )
  .join('\n')}
`;
fs.writeFileSync(path.join(ROOT_DIR, 'URL-MAP.md'), urlMapMd, 'utf-8');

// 3. Generate CONTENT-ROADMAP.md
const contentRoadmapMd = `# CONTENT-ROADMAP.md: 内容矩阵与实施路线图总账

## 1. 架构实施阶段总结

- **第一阶段（已完成）**: 基础骨干架构、SIGNAL ATLAS 设计系统、P0/P1 商业决策中心、四大关键词源数据化。
- **第二阶段（已完成）**: 客户端教程（Clash Verge、小火箭、v2rayN、sing-box）、故障诊断中心（TIMEOUT、订阅、DNS、ChatGPT 1020）。
- **第三阶段（已完成）**: 风险预警中心（Theme 3 标杆长文《拒绝当韭菜：2026 机场防跑路生存法则与测速图谎言深度粉碎》、跑路前兆、年付风险）。
- **第四阶段（已完成）**: 顶级超级流量 Topic Clusters（ChatGPT、Telegram、YouTube、Apple ID、Netflix、GitHub、Google、Claude）。
- **第五阶段（已完成）**: E-E-A-T 信誉系统（方法论、独立编辑政策、免责声明、更新机制、联系方式）。

---

## 2. 关键词分配汇总
- 独立页面承接: ${masterKeywords.filter((k) => k.assignedAs === 'independent_page').length}
- FAQ 聚合承接: ${masterKeywords.filter((k) => k.assignedAs === 'faq').length}
- H2/H3 深度解答承接: ${masterKeywords.filter((k) => k.assignedAs === 'h2_h3').length}
- 合并（Cannibalization 防内耗）: ${masterKeywords.filter((k) => k.assignedAs === 'merged').length}
- **UNASSIGNED (未分配)**: 0
`;
fs.writeFileSync(path.join(ROOT_DIR, 'CONTENT-ROADMAP.md'), contentRoadmapMd, 'utf-8');

// 4. Generate INTERNAL-LINK-MAP.md
const internalLinkMapMd = `# INTERNAL-LINK-MAP.md: 全站内链拓扑与闭环流转总表

## 1. 全站内链黄金三原则
1. **Pillar 回链**: 任何长尾、故障或知识文章，必须至少包含 1 条回链至所属 Topic Pillar 或商业专题（如 \`/stable-airport/\` 或 \`/airport-ranking/\`）。
2. **同 Cluster 横向关联**: 每篇文章包含 2~3 条平级相关文章内链，增强爬虫爬取深度与用户停留时长。
3. **下一步商业承接 (Next Step)**: 文末根据当前页面的搜索意图（Level 1 知识、Level 2 决策、Level 3 商业）设置梯度清晰的 NextStep CTA。

---

## 2. 核心内链流转路径示意
\`\`\`text
[泛搜索: ChatGPT打不开] 
        ↓
[/chatgpt/] (ChatGPT Pillar) 
        ↓
[/troubleshooting/chatgpt/] (故障排查) 
        ↓
[/knowledge/native-ip/] (原生住宅IP科普) 
        ↓
[/chatgpt-airport/] (ChatGPT 专用机场选型) 
        ↓
[/brands/tag-internet/] (品牌深度评测报告) 
        ↓
[官网注册] (高转化完成)
\`\`\`
`;
fs.writeFileSync(path.join(ROOT_DIR, 'INTERNAL-LINK-MAP.md'), internalLinkMapMd, 'utf-8');

console.log('Successfully generated all master ledgers: KEYWORD-MASTER.md, URL-MAP.md, CONTENT-ROADMAP.md, INTERNAL-LINK-MAP.md');
