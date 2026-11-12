import fs from 'node:fs';
import path from 'node:path';

export interface ProviderPlan {
  name: string;
  price: string;
  traffic: string;
  speed: string;
}

export interface MeasuredEvidence {
  file: string;
  testedAt: string;
  protocolDisplayed: string;
  toolFamily: string;
  dateConfidence: string;
  reviewNote?: string;
}

export interface UnlockEvidence {
  file: string;
  testedAt: string;
  title: string;
  platforms?: string[];
  description?: string;
}

export interface Provider {
  id?: string;
  name: string;
  slug: string;
  tagline: string;
  establishedYear: number;
  officialUrl: string;
  couponCode?: string;
  discount?: string;
  pricing: {
    monthlyStarting: number;
    currency?: string;
    billingCycle?: string;
    annualStarting?: number;
    payAsYouGo?: boolean;
    freeTrial?: boolean;
  };
  paymentMethods?: string[];
  plans: ProviderPlan[];
  protocols: string[];
  routes: string[];
  clients: string[];
  regions?: string[];
  streamingSupport: {
    netflix: string;
    disney?: string;
    disneyPlus?: string;
    youtube4k: string;
  };
  aiSupport: {
    chatgpt: string;
    claude: string;
    gemini?: string;
    cursor?: string;
  };
  testData: {
    peakSpeed: string;
    averageLatency: string;
    packetLoss: string;
    sla: string;
  };
  measuredEvidence?: MeasuredEvidence;
  unlockEvidence?: UnlockEvidence[];
  vendorNotes?: string;
  pros: string[];
  cons: string[];
  bestFor: string[];
  notFor?: string[];
  runawayRisk?: string;
  risks?: {
    runawayRisk: string;
    loggingPolicy: string;
  };
  verificationStatus: 'verified' | 'partially-verified' | 'reference' | 'vendor' | 'measured';
  verificationNotes?: string;
  lastVerified: string;
}

const PROVIDERS_DIR = path.join(process.cwd(), 'data', 'providers');

// 核心主推优先级定义：
// 前十名（第一主推光速云）：暮光加速、飞猫云、微风网络、大佬云、星岛梦、二猫云、无忧链接、唯兔云、Firefly
// 中间 18 家：宇宙云、U1S1、灵猫网络、极连云、光年梯、一翻云、SOGO云、可信云、速界、闪跃、全球云、闪电鼠、云界线、榴莲云、神行加速、环球梯、隐形人、梯子云
// 后置 14 家：WgetCloud、白月光、FlyingBird、CyberGuard、龙猫云、FATCAT、TNTCloud、青云梯、山水云、灵动云、浪网、EdgeNova、萤火虫、sslar
const PRIORITY_ORDER = [
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Top 10 (Strictly positioned)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━
  'guangsu',     // 1. 光速云 (综合第一主推 · 老牌 IEPL + 内网专线 · 晚高峰稳定首选)
  'muguang',     // 2. 暮光加速 (2023年黑马 · BGP 智能调度 + 专线级出口)
  'feimao',      // 3. 飞猫云 (平价超高性价比 · 7元档 + 8折券)
  'weifeng',     // 4. 微风网络 (7元平价专线 + 9折特惠)
  'dalaoyun',    // 5. 大佬云 (5.6元/月 60GB 极限亲民)
  'xingdaomeng', // 6. 星岛梦 (2020年老牌 · 不限时永久套餐 + IPLC 纯专线)
  'ermao',       // 7. 二猫云 (20元130GB 黄金性价比)
  'wuyou',       // 8. 无忧链接 (原生免转换订阅 · 6元轻量 · 拥有测速+解锁双实测图)
  'weitu',       // 9. 唯兔云 (60+ 全球多节点 · 三网优化 + 智能负载均衡)
  'firefly',     // 10. Firefly (纯正 IPLC 专线 · 6档灵活套餐 · 官网国内直连)

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Middle 18 (11 to 28)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━
  'yuzhou',      // 11. 宇宙云 (IEPL+VLESS · 15元档)
  'u1s1',        // 12. U1S1 (纯专线低延迟稳定性标杆)
  'lingmao',     // 13. 灵猫网络 (19元150GB + 不限时)
  'jilian',      // 14. 极连云 (18元100GB · AI 重点覆盖)
  'guangnian',   // 15. 光年梯 (18元110GB 平价专线)
  'yifan',       // 16. 一翻云 (20元150GB 丰沛配额)
  'sogo',        // 17. SOGO 云 (2026 新晋高带宽专线)
  'kexin',       // 18. 可信云 (透明诚信运营)
  'sujie',       // 19. 速界 (AI 工具与跨境专属)
  'shanyue',     // 20. 闪跃 (24元150GB 大带宽)
  'quanqiu',     // 21. 全球云 (2026 全新上线 · 全球节点广域覆盖)
  'shandianshu', // 22. 闪电鼠 (5.6元/月 60GB 实用轻量)
  'yunjiexian',  // 23. 云界线 (5.6元/月 亲民高性价比)
  'liulianyun',  // 24. 榴莲云 (5.6元/月 轻松破墙备选)
  'shenxing',    // 25. 神行加速 (14元120GB 实用平衡)
  'huanqiuti',   // 26. 环球梯 (5.6元超低入门)
  'yinxingren',  // 27. 隐形人 (60+ 节点清单 · 官方自研客户端)
  'tiziyun',     // 28. 梯子云 (自研全平台客户端 + 通用订阅)

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Trailing 14 (Ranked at back)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━
  'wgetcloud',   // 29. WgetCloud (高端企业级专线 · 历史多节点全覆盖)
  'baiyueguang', // 30. 白月光 (季付66元 · 108个多国节点)
  'flyingbird',  // 31. FlyingBird (飞鸟加速 · 历史专线记录)
  'cyberguard',  // 32. CyberGuard (隐私安全加密隧道)
  'longmaoyun',  // 33. 龙猫云 (实用中转备选)
  'fatcat',      // 34. FATCAT (大猫加速 · 实用海外中转)
  'tntcloud',    // 35. TNTCloud (大带宽吞吐 · 历史测速)
  'qingyunti',   // 36. 青云梯 (平价多节点备选)
  'shanshuiyun', // 37. 山水云 (国内多线中转)
  'lingdongyun', // 38. 灵动云 (历史多区域节点记录)
  'langwang',    // 39. 浪网 (老牌历史中转)
  'edgenova',    // 40. EdgeNova (边缘节点 Anycast 加速)
  'yinghuochong',// 41. 萤火虫 (轻量平价中转)
  'sslar',       // 42. sslar (现代加密隧道技术备选)

  // Fallbacks for SEO & existing traffic protection
  'shunchang',   // 顺畅网络 (保持已有 URL 索引不失效)
  'kuaili',      // 快狸 (保持已有 URL 索引不失效)
];

export function getAllProviders(): Provider[] {
  if (!fs.existsSync(PROVIDERS_DIR)) return [];
  const files = fs.readdirSync(PROVIDERS_DIR).filter((f) => f.endsWith('.json'));
  const providers: Provider[] = files.map((file) => {
    const raw = fs.readFileSync(path.join(PROVIDERS_DIR, file), 'utf-8');
    return JSON.parse(raw) as Provider;
  });

  // 按主推权重排序
  return providers.sort((a, b) => {
    const orderA = PRIORITY_ORDER.indexOf(a.slug);
    const orderB = PRIORITY_ORDER.indexOf(b.slug);
    const scoreA = orderA === -1 ? 999 : orderA;
    const scoreB = orderB === -1 ? 999 : orderB;
    return scoreA - scoreB;
  });
}

export function getProviderBySlug(slug: string): Provider | undefined {
  const providers = getAllProviders();
  return providers.find((p) => p.slug === slug);
}

export function getFeaturedProviders(): Provider[] {
  return getAllProviders().slice(0, 10);
}

export function getPriorityProviders(): Provider[] {
  return getAllProviders().slice(0, 4);
}
