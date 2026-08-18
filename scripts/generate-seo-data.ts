import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const SEO_SOURCE_DIR = path.join(ROOT_DIR, 'data', 'seo-source');
const SEO_DATA_DIR = path.join(ROOT_DIR, 'data', 'seo');

if (!fs.existsSync(SEO_DATA_DIR)) {
  fs.mkdirSync(SEO_DATA_DIR, { recursive: true });
}

interface KeywordEntry {
  keyword: string;
  source: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
  intent: 'commercial' | 'informational' | 'navigational' | 'transactional' | 'troubleshooting' | 'tutorial';
  parentTopic: string;
  targetUrl: string;
  pageType: 'home' | 'ranking' | 'pillar' | 'scenario' | 'pricing' | 'knowledge' | 'troubleshooting' | 'risk' | 'tutorial' | 'brand' | 'tool' | 'hub';
  primaryKeyword: string;
  secondaryKeywords: string[];
  status: 'published' | 'planned' | 'merged' | 'existing' | 'review' | 'deferred';
  commercialValue: 'high' | 'medium' | 'low' | 'tofu';
  nextStep: string;
  relatedPages: string[];
  assignedAs: 'independent_page' | 'merged' | 'faq' | 'h2_h3' | 'related_question' | 'content_roadmap';
}

console.log('Generating structured SEO data from 4 sources...');

// 1. Parse Priority Keywords
const priorityFile = path.join(SEO_SOURCE_DIR, '关键字优先级.txt');
const priorityContent = fs.readFileSync(priorityFile, 'utf-8');
const priorityLines = priorityContent.split('\n');

const masterKeywords: KeywordEntry[] = [];

let currentSection = '';
for (const rawLine of priorityLines) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;
  if (line.startsWith('[') && line.endsWith(']')) {
    currentSection = line.slice(1, -1);
    continue;
  }

  const [kwPart, metaPart] = line.split(':');
  if (!kwPart || !metaPart) continue;

  const keyword = kwPart.trim();
  const meta: Record<string, string> = {};
  metaPart.split(',').forEach((p) => {
    const [k, v] = p.split('=').map((s) => s.trim());
    if (k && v) meta[k] = v;
  });

  masterKeywords.push({
    keyword,
    source: meta.source || 'priority_file',
    priority: (meta.priority as any) || 'P1',
    intent: (meta.intent as any) || 'commercial',
    parentTopic: meta.parentTopic || 'general',
    targetUrl: meta.targetUrl || '/',
    pageType: (meta.pageType as any) || 'pillar',
    primaryKeyword: keyword,
    secondaryKeywords: [],
    status: 'published',
    commercialValue: meta.priority === 'P0' ? 'high' : 'medium',
    nextStep: '查看推荐与评测对比',
    relatedPages: ['/airport-ranking/', '/stable-airport/', '/cheap-airport/'],
    assignedAs: 'independent_page',
  });
}

// 2. Parse Super Traffic Mother Words
const motherFile = path.join(SEO_SOURCE_DIR, '大流量母词.txt');
const motherContent = fs.readFileSync(motherFile, 'utf-8');
let currentCat = '';
for (const rawLine of motherContent.split('\n')) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) {
    if (line.startsWith('##')) currentCat = line.replace('##', '').trim();
    continue;
  }
  const kw = line;
  const slug = kw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const targetUrl = `/${slug || 'topic'}/`;

  masterKeywords.push({
    keyword: kw,
    source: 'super_mother_words',
    priority: 'P1',
    intent: 'informational',
    parentTopic: `pillar-${currentCat}`,
    targetUrl,
    pageType: 'hub',
    primaryKeyword: `${kw}使用与代理网络指南`,
    secondaryKeywords: [`${kw}打不开`, `${kw}节点选择`, `${kw}网络配置`],
    status: 'published',
    commercialValue: 'tofu',
    nextStep: `了解 ${kw} 专用网络与节点选型`,
    relatedPages: ['/chatgpt-airport/', '/streaming-airport/', '/dedicated-line-airport/'],
    assignedAs: 'independent_page',
  });
}

// 3. Parse Long Tail Question Library (52 categories)
const longTailFile = path.join(SEO_SOURCE_DIR, '机场长尾问题库.txt');
const longTailContent = fs.readFileSync(longTailFile, 'utf-8');
let currentQuestionCat = '';
for (const rawLine of longTailContent.split('\n')) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) {
    if (line.startsWith('##')) currentQuestionCat = line.replace('##', '').trim();
    continue;
  }
  if (line.startsWith('-')) {
    const question = line.replace(/^[-\s*]+/, '').trim();
    masterKeywords.push({
      keyword: question,
      source: 'long_tail_52',
      priority: 'P2',
      intent: question.includes('怎么') || question.includes('如何') ? 'tutorial' : 'informational',
      parentTopic: currentQuestionCat,
      targetUrl: '/knowledge/',
      pageType: 'knowledge',
      primaryKeyword: question,
      secondaryKeywords: [],
      status: 'published',
      commercialValue: 'tofu',
      nextStep: '阅读完整技术原理解析与实操步骤',
      relatedPages: ['/troubleshooting/', '/risk-warning/', '/methodology/'],
      assignedAs: 'faq',
    });
  }
}

// 4. Parse Beginner TOFU Matrix
const beginnerFile = path.join(SEO_SOURCE_DIR, '小白关键词大纲文章.txt');
const beginnerContent = fs.readFileSync(beginnerFile, 'utf-8');
for (const rawLine of beginnerContent.split('\n')) {
  const line = rawLine.trim();
  if (line.startsWith('-')) {
    const kw = line.replace(/^[-\s*]+/, '').trim();
    masterKeywords.push({
      keyword: kw,
      source: 'beginner_tofu',
      priority: 'P2',
      intent: 'troubleshooting',
      parentTopic: 'tofu_beginner',
      targetUrl: '/troubleshooting/network/',
      pageType: 'troubleshooting',
      primaryKeyword: kw,
      secondaryKeywords: ['海外打不开', '网络错误'],
      status: 'published',
      commercialValue: 'tofu',
      nextStep: '执行 3 步网络自检与分流重置',
      relatedPages: ['/troubleshooting/', '/knowledge/what-is-airport/'],
      assignedAs: 'h2_h3',
    });
  }
}

// Deduplicate by keyword text
const uniqueKeywordsMap = new Map<string, KeywordEntry>();
masterKeywords.forEach((entry) => {
  if (!uniqueKeywordsMap.has(entry.keyword)) {
    uniqueKeywordsMap.set(entry.keyword, entry);
  }
});
const allUniqueKeywords = Array.from(uniqueKeywordsMap.values());

// Write keyword-master.json
fs.writeFileSync(
  path.join(SEO_DATA_DIR, 'keyword-master.json'),
  JSON.stringify(allUniqueKeywords, null, 2),
  'utf-8'
);

// Generate Cannibalization Map
const cannibalizationMap = {
  description: '防同室操戈（Cannibalization）合并映射规则',
  rules: [
    {
      primaryKeyword: '机场推荐',
      targetUrl: '/',
      mergedVariations: ['2026机场推荐', '机场推荐2026', '好用机场推荐', '靠谱机场推荐', '稳定机场选择'],
      distinctUrlsDoNotMerge: ['/airport-ranking/', '/stable-airport/', '/cheap-airport/', '/clash-airport/', '/chatgpt-airport/']
    },
    {
      primaryKeyword: '机场节点全部TIMEOUT',
      targetUrl: '/troubleshooting/timeout/',
      mergedVariations: ['节点全红', '节点TIMEOUT', '节点全部超时', '节点无法连接', '节点延迟-1ms'],
      distinctUrlsDoNotMerge: ['/troubleshooting/subscription-failed/', '/troubleshooting/clash/']
    },
    {
      primaryKeyword: 'ChatGPT打不开与网络报错',
      targetUrl: '/troubleshooting/chatgpt/',
      mergedVariations: ['ChatGPT 1020', 'ChatGPT Access Denied', 'ChatGPT 地区不支持', 'ChatGPT 登录报错'],
      distinctUrlsDoNotMerge: ['/chatgpt/', '/chatgpt-airport/']
    },
    {
      primaryKeyword: 'IEPL专线是什么意思',
      targetUrl: '/knowledge/iepl/',
      mergedVariations: ['IEPL原理', 'IEPL专线解析', 'IEPL和普通中转区别'],
      distinctUrlsDoNotMerge: ['/iepl-airport/']
    },
    {
      primaryKeyword: '机场跑路前兆识别',
      targetUrl: '/risk-warning/runaway-signs/',
      mergedVariations: ['机场跑路迹象', '机场跑路怎么办', '如何判断机场跑路', 'TG群禁言跑路'],
      distinctUrlsDoNotMerge: ['/risk-warning/speedtest-lies/', '/risk-warning/annual-plan-risk/']
    }
  ]
};
fs.writeFileSync(
  path.join(SEO_DATA_DIR, 'cannibalization-map.json'),
  JSON.stringify(cannibalizationMap, null, 2),
  'utf-8'
);

// Generate Keyword Clusters
const clusters: Record<string, string[]> = {};
allUniqueKeywords.forEach((k) => {
  if (!clusters[k.parentTopic]) {
    clusters[k.parentTopic] = [];
  }
  clusters[k.parentTopic].push(k.keyword);
});
fs.writeFileSync(
  path.join(SEO_DATA_DIR, 'keyword-clusters.json'),
  JSON.stringify(clusters, null, 2),
  'utf-8'
);

// Generate Search Intents Map
const searchIntents: Record<string, string[]> = {
  commercial: [],
  informational: [],
  navigational: [],
  transactional: [],
  troubleshooting: [],
  tutorial: [],
};
allUniqueKeywords.forEach((k) => {
  if (searchIntents[k.intent]) {
    searchIntents[k.intent].push(k.keyword);
  }
});
fs.writeFileSync(
  path.join(SEO_DATA_DIR, 'search-intents.json'),
  JSON.stringify(searchIntents, null, 2),
  'utf-8'
);

// Generate Topic Map
const topicMap = {
  pillars: [
    { title: '商业决策中心', url: '/', subpages: ['/airport-ranking/', '/stable-airport/', '/cheap-airport/', '/dedicated-line-airport/', '/value-airport/'] },
    { title: '场景与客户中心', url: '/chatgpt-airport/', subpages: ['/clash-airport/', '/shadowrocket-airport/', '/v2rayn-airport/', '/streaming-airport/', '/netflix-airport/', '/tiktok-airport/', '/low-latency-airport/'] },
    { title: '技术百科知识库', url: '/knowledge/', subpages: ['/knowledge/what-is-airport/', '/knowledge/airport-vs-vpn/', '/knowledge/iepl/', '/knowledge/iplc/', '/knowledge/transit-vs-direct/', '/knowledge/native-ip/', '/knowledge/residential-ip/', '/knowledge/shadowsocks/', '/knowledge/hysteria2/', '/knowledge/tuic/'] },
    { title: '故障排查中心', url: '/troubleshooting/', subpages: ['/troubleshooting/timeout/', '/troubleshooting/subscription-failed/', '/troubleshooting/clash/', '/troubleshooting/shadowrocket/', '/troubleshooting/chatgpt/', '/troubleshooting/peak-congestion/'] },
    { title: '风险预警中心', url: '/risk-warning/', subpages: ['/risk-warning/runaway-signs/', '/risk-warning/speedtest-lies/', '/risk-warning/annual-plan-risk/', '/risk-warning/fake-sites/', '/risk-warning/free-proxy-risks/'] },
    { title: '客户端教程中心', url: '/tutorial/', subpages: ['/tutorial/clash-verge/', '/tutorial/shadowrocket/', '/tutorial/v2rayn/', '/tutorial/sing-box/'] },
    { title: '品牌评测数据库', url: '/brands/', subpages: ['/brands/glados/', '/brands/tag-internet/', '/brands/flyint/', '/brands/kuromis/', '/brands/amytelecom/'] },
    { title: 'E-E-A-T 信誉中心', url: '/about/', subpages: ['/methodology/', '/editorial-policy/', '/disclaimer/', '/contact/', '/update-policy/'] },
  ]
};
fs.writeFileSync(
  path.join(SEO_DATA_DIR, 'topic-map.json'),
  JSON.stringify(topicMap, null, 2),
  'utf-8'
);

// Generate Page Map
const pageMap: Record<string, string[]> = {};
allUniqueKeywords.forEach((k) => {
  if (!pageMap[k.targetUrl]) {
    pageMap[k.targetUrl] = [];
  }
  pageMap[k.targetUrl].push(k.keyword);
});
fs.writeFileSync(
  path.join(SEO_DATA_DIR, 'page-map.json'),
  JSON.stringify(pageMap, null, 2),
  'utf-8'
);

// Generate Internal Link Map
const internalLinkMap = {
  hubToPillar: [
    { from: '/knowledge/*', to: '/stable-airport/', anchor: '稳定专线机场选型' },
    { from: '/troubleshooting/*', to: '/airport-ranking/', anchor: '高SLA可靠备用机场' },
    { from: '/risk-warning/*', to: '/stable-airport/', anchor: '老牌支持月付的基石机场' },
    { from: '/chatgpt/*', to: '/chatgpt-airport/', anchor: 'ChatGPT 原生纯净 IP 机场方案' },
  ],
  standardThreeLinksRule: '每篇文章标配：1条回链Pillar + 2~3条同Cluster横向链接 + 1条下一步需求转化'
};
fs.writeFileSync(
  path.join(SEO_DATA_DIR, 'internal-link-map.json'),
  JSON.stringify(internalLinkMap, null, 2),
  'utf-8'
);

// Generate Content Roadmap
const contentRoadmap = {
  currentStage: 'Phase 1-16 Full Architecture Deployment',
  totalKeywordsAssigned: allUniqueKeywords.length,
  unassignedCount: 0,
  breakdown: {
    independent_page: allUniqueKeywords.filter((k) => k.assignedAs === 'independent_page').length,
    faq: allUniqueKeywords.filter((k) => k.assignedAs === 'faq').length,
    h2_h3: allUniqueKeywords.filter((k) => k.assignedAs === 'h2_h3').length,
    merged: allUniqueKeywords.filter((k) => k.assignedAs === 'merged').length,
  }
};
fs.writeFileSync(
  path.join(SEO_DATA_DIR, 'content-roadmap.json'),
  JSON.stringify(contentRoadmap, null, 2),
  'utf-8'
);

console.log(`Successfully generated SEO data! Total keywords: ${allUniqueKeywords.length}, Unassigned: 0`);
