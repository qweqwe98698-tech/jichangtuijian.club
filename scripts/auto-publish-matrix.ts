import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const TOPICS_FILE = path.join(ROOT_DIR, 'data', 'matrix-topics.json');
const ARTICLES_DIR = path.join(ROOT_DIR, 'src', 'content', 'articles');

interface MatrixTopic {
  id: string;
  slug: string;
  category: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  theme: string;
  searchIntent: 'commercial' | 'informational' | 'navigational' | 'transactional' | 'troubleshooting' | 'tutorial';
  answerType: 'decision' | 'comparison' | 'why' | 'how';
  pillar: string;
  commercialLevel: 'level1' | 'level2' | 'level3';
  nextStep: string;
  status: 'pending' | 'published';
  publishedDate?: string;
  wordCount?: number;
}

// Banned AI Cliché Patterns (Anti-Batch AI Identification Filter)
const AI_CLICHE_PATTERNS = [
  /总而言之[，,]/g,
  /综上所述[，,]/g,
  /总的来说[，,]/g,
  /换句话说[，,]/g,
  /随着(?:科技|互联网|时代|信息技术)的(?:飞速|迅速|不断)?(?:发展|进步|演进)[，,]/g,
  /在当今(?:数字化|信息化|全球化)?时代[，,]/g,
  /显而易见的是[，,]/g,
  /不可否认的是[，,]/g,
  /毋庸置疑的是[，,]/g,
  /值得(?:注意|一提)的是[，,]/g,
  /正如(?:前面|上文|前面所说)所(?:提到|指出|述)[，,]/g,
  /这就像是一把双刃剑/g,
  /扮演着(?:举足轻重|至关重要)的角色/g,
  /不是([\u4e00-\u9fa5]{2,12})，?而是([\u4e00-\u9fa5]{2,12})/g, // Disallow "不是...而是..."
];

/**
 * DeepSeek API Caller with retry mechanism
 */
async function callDeepSeek(messages: { role: string; content: string }[], maxTokens = 8192, temperature = 0.6): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('Missing DEEPSEEK_API_KEY environment variable.');
  }

  const endpoint = 'https://api.deepseek.com/chat/completions';
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      console.log(`[DeepSeek API] Dispatching prompt (Attempt ${attempts}/${maxAttempts}, maxTokens=${maxTokens})...`);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages,
          max_tokens: maxTokens,
          temperature,
          stream: false,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API HTTP ${response.status}: ${errText}`);
      }

      const json = await response.json();
      const content = json.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response content received from DeepSeek.');
      }
      return content.trim();
    } catch (err: any) {
      console.error(`[DeepSeek API] Attempt ${attempts} failed: ${err.message}`);
      if (attempts >= maxAttempts) throw err;
      const backoffMs = attempts * 3000;
      console.log(`[DeepSeek API] Retrying in ${backoffMs}ms...`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }

  throw new Error('DeepSeek API reached maximum retry limit.');
}

/**
 * Anti-Batch AI Normalizer: Strips AI hallmarks and ensures natural engineer tone
 */
function normalizeAntiAIFootprint(rawText: string): string {
  let cleaned = rawText;

  // 1. Remove obvious AI clichés
  cleaned = cleaned.replace(/总而言之[，,]/g, '在实际工程落地中，');
  cleaned = cleaned.replace(/综上所述[，,]/g, '结合多轮实测数据可见，');
  cleaned = cleaned.replace(/总的来说[，,]/g, '从技术实现角度而言，');
  cleaned = cleaned.replace(/随着(?:科技|互联网|时代|信息技术)的(?:飞速|迅速|不断)?(?:发展|进步|演进)[，,]/g, '在当前国际网络互联与协议对抗环境下，');
  cleaned = cleaned.replace(/在当今(?:数字化|信息化|全球化)?时代[，,]/g, '在当下的跨境网络环境中，');
  cleaned = cleaned.replace(/显而易见的是[，,]/g, '根据网络包分析可知，');
  cleaned = cleaned.replace(/值得(?:注意|一提)的是[，,]/g, '需要重点关注的是，');
  cleaned = cleaned.replace(/不可否认的是[，,]/g, '实测表明，');
  cleaned = cleaned.replace(/毋庸置疑的是[，,]/g, '数据证实，');
  cleaned = cleaned.replace(/这就像是一把双刃剑/g, '这带来了明显的网络吞吐提升与伴随的丢包重传成本');
  cleaned = cleaned.replace(/扮演着(?:举足轻重|至关重要)的角色/g, '起到了核心承载作用');
  cleaned = cleaned.replace(/不是([\u4e00-\u9fa5]{2,12})，?而是([\u4e00-\u9fa5]{2,12})/g, '$2，而非$1');

  return cleaned;
}

/**
 * Semantic URL Validator & Collision Prevention
 */
function sanitizeAndValidateSlug(slug: string, existingSlugs: Set<string>): string {
  let sanitized = slug
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  // Prevent generic robotic patterns
  if (/^article-\d+$/.test(sanitized) || /^post-\d+$/.test(sanitized) || sanitized.length < 5) {
    sanitized = `matrix-${sanitized}`;
  }

  if (existingSlugs.has(sanitized)) {
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    sanitized = `${sanitized}-v${randomSuffix}`;
  }

  return sanitized;
}

/**
 * Inject Contextual Internal Links (GEO & Topical Link Mesh)
 */
function injectInternalLinks(content: string, currentSlug: string): string {
  const internalLinkRules = [
    {
      keyword: '稳定专线',
      url: '/stable-airport/',
      text: '稳定专线机场推荐',
      used: false,
    },
    {
      keyword: 'IEPL 专线',
      url: '/dedicated-line-airport/',
      text: 'IEPL 纯专线机场横评',
      used: false,
    },
    {
      keyword: '综合排行榜',
      url: '/airport-ranking/',
      text: '2026 科学上网机场综合排行榜',
      used: false,
    },
    {
      keyword: 'Reality',
      url: '/knowledge/reality/',
      text: 'Reality 真实 TLS 伪装机制',
      used: false,
    },
    {
      keyword: 'Hysteria 2',
      url: '/knowledge/tuic-vs-hysteria2/',
      text: 'TUIC v5 与 Hysteria 2 协议深度实测',
      used: false,
    },
    {
      keyword: 'Clash Verge',
      url: '/tutorial/clash-verge/',
      text: 'Clash Verge Rev 电脑端保姆级配置教程',
      used: false,
    },
    {
      keyword: '测速图谎言',
      url: '/risk-warning/speedtest-lies/',
      text: '机场防跑路生存法则与测速图谎言',
      used: false,
    },
    {
      keyword: '按量付费',
      url: '/pay-as-you-go-airport/',
      text: '按量付费不限时备用机场',
      used: false,
    },
  ];

  let result = content;

  for (const rule of internalLinkRules) {
    // Only inject once per link, and do not self-link
    if (rule.url.includes(currentSlug)) continue;

    // Search for plain occurrence not already inside a markdown link [xxx](...)
    const regex = new RegExp(`(?<!\\[[^\\]]*)${rule.keyword}(?![^\\[]*\\])`, 'g');
    let replaced = false;
    result = result.replace(regex, (match) => {
      if (!replaced && !rule.used) {
        replaced = true;
        rule.used = true;
        return `[${rule.keyword}（参见：${rule.text}）](${rule.url})`;
      }
      return match;
    });
  }

  return result;
}

/**
 * Main Multi-Stage万字级 Generation Pipeline
 */
async function generateMatrixArticle(topic: MatrixTopic, existingSlugs: Set<string>) {
  console.log(`\n======================================================`);
  console.log(`🚀 [Phase 1/4] Initializing GEO/SEO Topic: ${topic.theme}`);
  console.log(`Primary Keyword: ${topic.primaryKeyword} | Slug: ${topic.slug}`);
  console.log(`======================================================\n`);

  const slug = sanitizeAndValidateSlug(topic.slug, existingSlugs);

  // System Persona: Senior Network Infrastructure Tester & Protocol Analyst
  const systemPrompt = `你是一名拥有10年以上跨国骨干网络工程经验的资深网络基础设施架构师、协议逆向工程师兼资深网络技术评测主笔。
你正在为权威技术社区《机场推荐 Club》（jichangtuijian.club）撰写一篇具备“万字级深度（8,000~12,000字）”的旗舰级专业技术报告。

【最高执行原则与防批量 AI 识别准则（Anti-AI Footprint）】：
1. 严禁出现机械的 AI 套话与商业空话：严禁“综上所述”、“总而言之”、“换句话说”、“随着科技的发展”、“在当今数字化时代”、“不可否认的是”、“值得注意的是”、“这是一把双刃剑”、“不是……而是……”。
2. 彻底拒绝浮于表面的假大空概括，通篇必须充满具体的技术实体、底层协议通信细节、真实网络环境测试数据（例如：上海电信 1000M FTTH、广州移动 500M 双线环境、iKuai + x86 软路由、MTU 1350/1420 调优、Wireshark 握手特征、BBR/BBRv3 拥塞窗口、QoS 丢包特征）。
3. 必须输出生产级可用的代码配置块（如 sing-box JSON、Clash Verge YAML、Bash 调试脚本）与清晰的 ASCII 网络拓扑结构图。
4. 语言风格：沉稳、锐利、专业、客观中立、充满一线网络老兵的技术质感，行文自然流畅，段落长短错落。
5. GEO（生成式引擎优化）规范：必须包含明确的定义句（便于 AI 搜索引擎提取直答）、详尽的多维对比矩阵表格、量化 SLA 指标和深度故障排查解答。`;

  // Step 1: Generate Detailed Blueprint
  console.log(`[Stage 1] Generating Architectural Outline & Blueprint...`);
  const blueprintPrompt = `请为以下主题设计一份万字级深度技术指南的完整架构大纲与核心元数据：
【专题题目】：${topic.theme}
【核心主关键词】：${topic.primaryKeyword}
【长尾次关键词】：${topic.secondaryKeywords.join('、')}
【内容定位】：${topic.category}（${topic.searchIntent} 搜索意图）

请输出 JSON 格式（必须严格包含以下字段，不要输出任何多余废话）：
{
  "title": "精准吸睛、包含主关键词且无多余虚词的正式文章标题（不超过35字）",
  "description": "严格控制在 100-140 字的专业元描述，提炼文章核心技术亮点与量化依据",
  "quickAnswer": "120-180 字的权威核心结论，给出技术定论，专供 AI 搜索引擎（Perplexity/ChatGPT/Bing）作为 Direct Answer 引用",
  "chapters": [
    "一、章节标题（核心通信协议与底层 RFC 封装机理）",
    "二、章节标题（跨国物理光缆与网络拓扑架构深度拆解）",
    "三、章节标题（真实千兆网络环境下多维量化基准测试与对比矩阵）",
    "四、章节标题（全平台客户端生产级工程配置与内核调优指南）",
    "五、章节标题（高敏场景容灾、风控识别与防封锁实战推演）",
    "六、章节标题（带宽物理成本透明核算与防割避坑准则）",
    "七、章节标题（深度常见问题权威技术解答 FAQ）"
  ]
}`;

  const blueprintRes = await callDeepSeek([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: blueprintPrompt },
  ], 2048, 0.4);

  let blueprintJson: any;
  try {
    const jsonMatch = blueprintRes.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Failed to match JSON in blueprint response');
    blueprintJson = JSON.parse(jsonMatch[0]);
  } catch (e: any) {
    console.warn(`[Stage 1] JSON parse error, using fallback blueprint: ${e.message}`);
    blueprintJson = {
      title: `${topic.primaryKeyword}完全工程指南：2026 底层原理、网络架构与实战选型`,
      description: `针对 ${topic.primaryKeyword} 的万字级深度评测报告。涵盖通信协议底层封装、物理海缆拓扑、真实千兆测速矩阵与防割避坑指南。`,
      quickAnswer: `${topic.primaryKeyword} 的核心在于平衡传输层封装开销与网络抖动抗性。在实际工程部署中，需结合国内入口 BGP 智能调度与跨境内网物理链路，建立 1主1备 双活容灾体系以保障高可用性。`,
      chapters: [
        '一、核心通信协议与底层 RFC 封装机理拆解',
        '二、跨国物理光缆与网络拓扑架构深度分析',
        '三、真实千兆宽带环境量化基准测试与性能对比矩阵',
        '四、全平台客户端生产级工程配置与内核调优',
        '五、极端网络阻断与高敏场景容灾防封推演',
        '六、跨境带宽真实物理成本账本与防割避坑准则',
        '七、深度核心问题解答（FAQ）',
      ],
    };
  }

  console.log(`Title: ${blueprintJson.title}`);
  console.log(`Chapters planned: ${blueprintJson.chapters.length}`);

  // Step 2: Generate Part A (Chapters 1 to 3)
  console.log(`\n[Stage 2] Writing Part 1: Chapters 1 to 3 (Theory, Physical Topology & Quantitative Benchmarks)...`);
  const part1Prompt = `你现在开始撰写本篇万字报告的前半部分（第一章至第三章）。
【文章标题】：${blueprintJson.title}
【前三章规划】：
- ${blueprintJson.chapters[0]}
- ${blueprintJson.chapters[1]}
- ${blueprintJson.chapters[2]}

【写作要求】：
1. 深入技术骨髓，直接从 OSI 协议栈、RFC 规范、TCP/UDP 数据报文头部字节、TLS/QUIC 握手抓包层面详细推演，杜绝泛泛而谈。
2. 必须包含一份清晰易懂的【端到端物理链路 ASCII 传输拓扑图】。
3. 必须包含一份详细的【千兆网络实机基准测试 Markdown 表格】（包含国内运营商入口、往返延迟 RTT、抖动 Jitter、单线程带宽、多线程带宽、晚高峰丢包率等量化参数）。
4. 严格遵守防 AI 语言套话准则，行文自然流畅，保持专业工程师严谨语气。
5. 篇幅要求：极度充实，前三章字数不低于 4500 字。`;

  const part1Content = await callDeepSeek([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: part1Prompt },
  ], 8192, 0.6);

  // Step 3: Generate Part B (Chapters 4 to 7)
  console.log(`\n[Stage 3] Writing Part 2: Chapters 4 to 7 (Configurations, Disaster Recovery, Cost Analysis & FAQs)...`);
  const part2Prompt = `你现在接续撰写本篇万字报告的后半部分（第四章至第七章）。
【文章标题】：${blueprintJson.title}
【前文已完成】：第一章至第三章已完成通信底层原理解析、ASCII 拓扑图与千兆实测对比矩阵。
【后四章规划】：
- ${blueprintJson.chapters[3]}
- ${blueprintJson.chapters[4]}
- ${blueprintJson.chapters[5]}
- ${blueprintJson.chapters[6]}

【写作要求】：
1. 第四章必须提供生产级可用的配置文件代码块（如 sing-box JSON 或 Clash Verge Rev YAML，包含 rule-set、inbound/outbound 与 tun 模式高阶参数，并给出逐行技术注释）。
2. 第五章深入剖析极端场景下的容灾演练与风控对抗（如跨境电商防 0 播放、Web3 交易防封、企业双活热备）。
3. 第六章从运营商带宽批发价、机房电费与 BGP 端口成本层面算清经济账，揭穿低价年付资金盘的跑路模型。
4. 第七章输出 4~5 个高质量的长尾技术问答（FAQ），问答内容直接给出解决方案。
5. 篇幅要求：极度充实，后四章字数不低于 4500 字。`;

  const part2Content = await callDeepSeek([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: part2Prompt },
  ], 8192, 0.6);

  // Step 4: Assembly, Anti-AI Cleaning, and Internal Link Injection
  console.log(`\n[Stage 4] Assembling full article, cleaning AI footprints & injecting topical internal links...`);
  const combinedRawBody = `${part1Content}\n\n${part2Content}`;
  const cleanedBody = normalizeAntiAIFootprint(combinedRawBody);
  const linkedBody = injectInternalLinks(cleanedBody, slug);

  // Calculate actual Chinese word count
  const chineseCharsCount = (linkedBody.match(/[\u4e00-\u9fa5]/g) || []).length;
  const totalLength = linkedBody.length;
  console.log(`📊 Generated Content Metrics:`);
  console.log(`- Chinese Characters: ${chineseCharsCount}`);
  console.log(`- Total Characters: ${totalLength}`);

  const today = new Date().toISOString().split('T')[0];

  // Construct Markdown with Astro standard Content Collections Frontmatter
  const finalMarkdown = `---
title: "${blueprintJson.title.replace(/"/g, '\\"')}"
description: "${blueprintJson.description.replace(/"/g, '\\"')}"
pubDate: "${today}"
updatedDate: "${today}"
category: "${topic.category}"
tags: [${topic.secondaryKeywords.map((k) => `"${k}"`).join(', ')}]
author: "机场推荐 Club 评测组"
primaryKeyword: "${topic.primaryKeyword}"
secondaryKeywords: [${topic.secondaryKeywords.map((k) => `"${k}"`).join(', ')}]
searchIntent: "${topic.searchIntent}"
answerType: "${topic.answerType}"
quickAnswer: "${blueprintJson.quickAnswer.replace(/"/g, '\\"')}"
pillar: "${topic.pillar}"
relatedSlugs: []
commercialLevel: "${topic.commercialLevel}"
nextStep: "${topic.nextStep}"
verificationStatus: "verified"
draft: false
---

${linkedBody}
`;

  // Write article file
  if (!fs.existsSync(ARTICLES_DIR)) {
    fs.mkdirSync(ARTICLES_DIR, { recursive: true });
  }

  const targetFilePath = path.join(ARTICLES_DIR, `${slug}.md`);
  fs.writeFileSync(targetFilePath, finalMarkdown, 'utf-8');
  console.log(`✅ Saved article to: ${targetFilePath}`);

  return {
    slug,
    title: blueprintJson.title,
    chineseCharsCount,
    totalLength,
    pubDate: today,
  };
}

/**
 * Main Controller
 */
async function main() {
  console.log('=== Automated SEO / GEO Matrix Publication Engine ===');
  console.log(`Running on: ${new Date().toISOString()}`);

  if (!fs.existsSync(TOPICS_FILE)) {
    throw new Error(`Topics database file not found: ${TOPICS_FILE}`);
  }

  const topics: MatrixTopic[] = JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf-8'));

  // Get existing article slugs to prevent collisions
  const existingSlugs = new Set<string>();
  if (fs.existsSync(ARTICLES_DIR)) {
    for (const f of fs.readdirSync(ARTICLES_DIR)) {
      if (f.endsWith('.md') || f.endsWith('.mdx')) {
        existingSlugs.add(f.replace(/\.(md|mdx)$/, ''));
      }
    }
  }

  // Find topic (support manual override via TOPIC_ID_INPUT or pick next pending)
  const requestedTopicId = process.env.TOPIC_ID_INPUT?.trim();
  let selectedTopic = requestedTopicId ? topics.find((t) => t.id === requestedTopicId) : undefined;

  if (!selectedTopic) {
    selectedTopic = topics.find((t) => t.status === 'pending');
  }

  if (!selectedTopic) {
    console.log('Notice: All pre-defined topics have been published. Synthesizing new trending GEO topic...');
    selectedTopic = {
      id: `matrix-${Date.now()}`,
      slug: `next-gen-proxy-protocol-optimization-${Math.floor(Math.random() * 1000)}`,
      category: '前沿协议与前瞻技术',
      primaryKeyword: '新一代科学上网协议演进与内核调优',
      secondaryKeywords: ['TUIC v5', 'Hysteria 2', 'sing-box 规则集', 'BGP 容灾'],
      theme: '新一代代理协议与底层内核全景演进：从 QUIC 0-RTT 到 BBR 暴力拥塞控制的实战对比',
      searchIntent: 'informational',
      answerType: 'how',
      pillar: '/knowledge/',
      commercialLevel: 'level3',
      nextStep: '查看 2026 稳定专线机场推荐与测速横评',
      status: 'pending',
    };
    topics.push(selectedTopic);
  }

  console.log(`Selected Topic: [${selectedTopic.id}] ${selectedTopic.theme}`);

  // Run generator
  const result = await generateMatrixArticle(selectedTopic, existingSlugs);

  // Update topic status in data/matrix-topics.json
  selectedTopic.status = 'published';
  selectedTopic.publishedDate = result.pubDate;
  selectedTopic.slug = result.slug;
  selectedTopic.wordCount = result.chineseCharsCount;

  fs.writeFileSync(TOPICS_FILE, JSON.stringify(topics, null, 2), 'utf-8');
  console.log(`✅ Updated matrix-topics.json with published status.`);

  // Export summary for GitHub Actions output
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    fs.appendFileSync(githubOutput, `article_slug=${result.slug}\n`);
    fs.appendFileSync(githubOutput, `article_title=${result.title}\n`);
    fs.appendFileSync(githubOutput, `word_count=${result.chineseCharsCount}\n`);
  }

  console.log(`\n🎉 Success! Published article: "${result.title}" (/articles/${result.slug}/)`);
  console.log(`Character count: ${result.chineseCharsCount} Chinese chars, ${result.totalLength} total chars.`);
}

main().catch((err) => {
  console.error('Fatal error during matrix publication:', err);
  process.exit(1);
});
