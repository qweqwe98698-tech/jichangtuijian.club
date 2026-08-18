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

// 核心主推优先级定义：前四固定为 1.光速云 2.星岛梦 3.飞猫云 4.U1S1
const PRIORITY_ORDER = [
  'guangsu',    // 1. 光速云 (综合旗舰老牌 IEPL 专线)
  'xingdaomeng',// 2. 星岛梦 (不限时按量计费与旗舰专线)
  'feimao',     // 3. 飞猫云 (平价超高性价比 7元起)
  'u1s1',       // 4. U1S1 (纯专线低延迟稳定性标杆)
  'lingmao',    // 5. 灵猫网络 (月付大流量)
  'sujie',      // 6. 速界 (AI 专属)
  'yuzhou',     // 7. 宇宙云 (15元性价比)
  'sogo',       // 8. SOGO云
  'weitu',      // 9. 唯兔云
  'yifan',      // 10. 一翻云
  'jilian',     // 11. 极连云
  'guangnian',  // 12. 光年梯
  'ermao',      // 13. 二猫云
  'kexin',      // 14. 可信云
  'kuaili',     // 15. 快狸
  'quanqiu',    // 16. 全球云
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
  return getAllProviders().slice(0, 6);
}

export function getPriorityProviders(): Provider[] {
  return getAllProviders().slice(0, 4);
}
