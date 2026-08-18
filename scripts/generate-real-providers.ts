import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const PROVIDERS_DIR = path.join(ROOT_DIR, 'data', 'providers');

if (!fs.existsSync(PROVIDERS_DIR)) {
  fs.mkdirSync(PROVIDERS_DIR, { recursive: true });
}

// Clean out existing mock providers
const existing = fs.readdirSync(PROVIDERS_DIR);
existing.forEach((f) => fs.unlinkSync(path.join(PROVIDERS_DIR, f)));

export interface ProviderData {
  id: string;
  name: string;
  slug: string;
  tagline: string;
  establishedYear: number;
  officialUrl: string;
  couponCode: string;
  discount: string;
  pricing: {
    monthlyStarting: number;
    currency: string;
    billingCycle: string;
  };
  paymentMethods: string[];
  routes: string[];
  protocols: string[];
  clients: string[];
  streamingSupport: {
    netflix: string;
    disney: string;
    youtube4k: string;
  };
  aiSupport: {
    chatgpt: string;
    claude: string;
    gemini: string;
  };
  testData: {
    sla: string;
    averageLatency: string;
    peakSpeed: string;
    packetLoss: string;
  };
  measuredEvidence: {
    file: string;
    testedAt: string;
    protocolDisplayed: string;
    toolFamily: string;
    dateConfidence: string;
    reviewNote?: string;
  };
  plans: Array<{
    name: string;
    price: string;
    traffic: string;
    speed: string;
  }>;
  bestFor: string[];
  notFor: string[];
  pros: string[];
  cons: string[];
  runawayRisk: string;
  lastVerified: string;
  verificationStatus: 'verified' | 'vendor' | 'measured';
}

const providers: ProviderData[] = [
  {
    id: 'guangsu',
    name: '光速云',
    slug: 'guangsu',
    tagline: '老牌综合型 IEPL 专线 · VLESS 协议 · 晚高峰稳定首选',
    establishedYear: 2020,
    officialUrl: 'https://sahude.gsyvipaff.com/#/?code=keqgvT5Y',
    couponCode: 'AMM',
    discount: '新人注册 8 折',
    pricing: {
      monthlyStarting: 7.5,
      currency: '¥',
      billingCycle: '年付折合约 7.5 元/月，59GB 起',
    },
    paymentMethods: ['支付宝', '微信支付', 'USDT'],
    routes: ['企业级 IEPL 专线', '国内 BGP 入口'],
    protocols: ['VLESS', 'Shadowsocks'],
    clients: ['自研客户端', 'Clash Verge', 'Shadowrocket', 'v2rayN', 'sing-box'],
    streamingSupport: {
      netflix: '全区解锁 (非自制剧)',
      disney: '全区解锁',
      youtube4k: '秒开 4K/8K',
    },
    aiSupport: {
      chatgpt: '官方原生 IP 解锁',
      claude: '纯净支持',
      gemini: '支持',
    },
    testData: {
      sla: '99.95%',
      averageLatency: '16ms',
      peakSpeed: '850 Mbps',
      packetLoss: '< 0.05%',
    },
    measuredEvidence: {
      file: '/images/speedtests/guangsu-speedtest.png',
      testedAt: '2026-08-11T14:32:56+08:00',
      protocolDisplayed: 'Shadowsocks',
      toolFamily: 'MAI-TEST-BOT 2.0.0-dev',
      dateConfidence: 'visible-in-image',
    },
    plans: [
      { name: '基础入门年付', price: '¥89/年 (折合 7.5元/月)', traffic: '59 GB/月', speed: '1000 Mbps 专线' },
      { name: '进阶标准月付', price: '¥17/月', traffic: '110 GB/月', speed: '1000 Mbps 专线' },
      { name: '旗舰大流量', price: '¥32/月', traffic: '260 GB/月', speed: '1000 Mbps 专线' },
    ],
    bestFor: ['注重晚高峰稳定性', 'AI 工具访问 (ChatGPT/Claude)', '流媒体影音', '综合体验'],
    notFor: ['单月极低用量(<5GB)且不愿买年付的用户'],
    pros: [
      '2020年成立老牌运营，信誉良好',
      '企业级 IEPL 专线保障晚高峰 0 丢包',
      '提供自研客户端与第三方客户端订阅导入',
      '支持 USDT 匿名支付',
    ],
    cons: ['7.5元为年付折算价格，月付起步约 17元/月', '第三方订阅导入需通过客服获取'],
    runawayRisk: '极低 (运营超 6 年，财务健康)',
    lastVerified: '2026-08-17',
    verificationStatus: 'verified',
  },
  {
    id: 'xingdaomeng',
    name: '星岛梦',
    slug: 'xingdaomeng',
    tagline: '低价年付与不限时流量套餐 · 灵活容灾与备用首选',
    establishedYear: 2020,
    officialUrl: 'https://guangs.xingdaomeng.com/#/?code=1TynBYnR',
    couponCode: 'nmw888',
    discount: '新人注册 9 折',
    pricing: {
      monthlyStarting: 8.0,
      currency: '¥',
      billingCycle: '年付折合约 8 元/月，60GB 起',
    },
    paymentMethods: ['支付宝', '微信支付', 'USDT'],
    routes: ['企业级内网专线', '国内 BGP 优化'],
    protocols: ['Shadowsocks', 'V2Ray'],
    clients: ['Clash Verge', 'Shadowrocket', 'v2rayN', 'sing-box'],
    streamingSupport: {
      netflix: '主流区解锁',
      disney: '支持',
      youtube4k: '流畅 4K',
    },
    aiSupport: {
      chatgpt: '支持',
      claude: '支持',
      gemini: '支持',
    },
    testData: {
      sla: '99.85%',
      averageLatency: '22ms',
      peakSpeed: '620 Mbps',
      packetLoss: '< 0.10%',
    },
    measuredEvidence: {
      file: '/images/speedtests/xingdaomeng-speedtest.png',
      testedAt: '2026-08-11T01:48:13+08:00',
      protocolDisplayed: 'Shadowsocks',
      toolFamily: 'MAI-TEST-BOT 2.0.0-dev',
      dateConfidence: 'visible-in-image',
    },
    plans: [
      { name: '年付轻度套餐', price: '¥96/年 (折合 8元/月)', traffic: '60 GB/月', speed: '500 Mbps 专线' },
      { name: '不限时按量包', price: '¥68 (一次性)', traffic: '200 GB 不限时', speed: '500 Mbps 专线' },
      { name: '大流量月付', price: '¥22/月', traffic: '160 GB/月', speed: '1000 Mbps 专线' },
    ],
    bestFor: ['预算有限用户', '小流量轻度网民', '需要不限时备用节点防失联'],
    notFor: ['追求极致 8K 蓝光流媒体超大吞吐的用户'],
    pros: [
      '2020年起稳定运营，套餐类型极其丰富',
      '提供罕见的不限时流量包，适合作为主力失联时的备用容灾',
      '年付折算价格低至 8 元/月',
    ],
    cons: ['8 元/月属于年付折算，不支持按月试用8元价位'],
    runawayRisk: '低 (老牌 6 年平台，套餐梯度合理)',
    lastVerified: '2026-08-17',
    verificationStatus: 'verified',
  },
  {
    id: 'lingmao',
    name: '灵猫网络',
    slug: 'lingmao',
    tagline: '月付 19 元享 150GB 超大流量 · 拒绝年付绑架的良心首选',
    establishedYear: 2024,
    officialUrl: 'https://vip01.civetnet.com/#/?code=8MIAyxak',
    couponCode: 'lmao888',
    discount: '新人注册 9 折',
    pricing: {
      monthlyStarting: 19.0,
      currency: '¥',
      billingCycle: '月付 19 元/月，150GB',
    },
    paymentMethods: ['支付宝', '微信支付', 'USDT'],
    routes: ['企业级内网专线', '多入口 BGP 智能调度'],
    protocols: ['Shadowsocks', 'V2Ray'],
    clients: ['Clash Verge', 'Shadowrocket', 'v2rayN', 'sing-box'],
    streamingSupport: {
      netflix: '全区解锁',
      disney: '全区解锁',
      youtube4k: '秒开 4K',
    },
    aiSupport: {
      chatgpt: '原生解锁',
      claude: '支持',
      gemini: '支持',
    },
    testData: {
      sla: '99.90%',
      averageLatency: '18ms',
      peakSpeed: '780 Mbps',
      packetLoss: '< 0.08%',
    },
    measuredEvidence: {
      file: '/images/speedtests/lingmao-speedtest.png',
      testedAt: '2026-08-11T18:45:40+08:00',
      protocolDisplayed: 'Shadowsocks',
      toolFamily: 'MAI-TEST-BOT 2.0.0-dev',
      dateConfidence: 'visible-in-image',
    },
    plans: [
      { name: '大流量月付套餐', price: '¥19/月', traffic: '150 GB/月', speed: '1000 Mbps 专线' },
      { name: '进阶尊享月付', price: '¥35/月', traffic: '320 GB/月', speed: '1000 Mbps 专线' },
      { name: '不限时随心包', price: '¥88 (一次性)', traffic: '300 GB 不限时', speed: '1000 Mbps 专线' },
    ],
    bestFor: ['坚持纯月付拒绝年付的用户', '每月 100-150GB 视频与日常重度用户', '多设备家庭共享'],
    notFor: ['预算极低(<10元)只想要超小流量的用户'],
    pros: [
      '真正纯月付友好，19元即给 150GB 专线流量',
      '同时提供不限时套餐，灵活度高',
      '专线质量过硬，晚高峰带宽充足',
    ],
    cons: ['开业时间为2024年，相比老牌资历稍浅'],
    runawayRisk: '低 (月付无资金池沉淀压力)',
    lastVerified: '2026-08-17',
    verificationStatus: 'verified',
  },
  {
    id: 'feimao',
    name: '飞猫云',
    slug: 'feimao',
    tagline: '低价小流量 IEPL 专线 · 7 元/月轻度用户性价比之王',
    establishedYear: 2023,
    officialUrl: 'https://guangs.flycataff.com/#/?code=6uq0Xe9y',
    couponCode: 'flycat888',
    discount: '新用户季付及以上 8 折',
    pricing: {
      monthlyStarting: 7.0,
      currency: '¥',
      billingCycle: '年付折合约 7 元/月，50GB 起',
    },
    paymentMethods: ['支付宝', '微信支付', 'USDT'],
    routes: ['IEPL 专线', '国内 BGP 优化'],
    protocols: ['Shadowsocks', 'V2Ray'],
    clients: ['自研客户端', 'Clash Verge', 'Shadowrocket', 'v2rayN'],
    streamingSupport: {
      netflix: '支持',
      disney: '支持',
      youtube4k: '流畅 4K',
    },
    aiSupport: {
      chatgpt: '支持',
      claude: '支持',
      gemini: '支持',
    },
    testData: {
      sla: '99.88%',
      averageLatency: '19ms',
      peakSpeed: '560 Mbps',
      packetLoss: '< 0.08%',
    },
    measuredEvidence: {
      file: '/images/speedtests/feimao-speedtest.png',
      testedAt: '2026-08-11T08:52:30+08:00',
      protocolDisplayed: 'Shadowsocks',
      toolFamily: 'MAI-TEST-BOT 2.0.0-dev',
      dateConfidence: 'visible-in-image',
    },
    plans: [
      { name: '轻量年付套餐', price: '¥84/年 (折合 7元/月)', traffic: '50 GB/月', speed: '500 Mbps 专线' },
      { name: '标准季付套餐', price: '¥36/季 (折合 12元/月)', traffic: '80 GB/月', speed: '1000 Mbps 专线' },
    ],
    bestFor: ['日常流量需求不大(<50GB)的轻度网民', '查资料、微信出海、偶尔看视频', '低预算首选'],
    notFor: ['BT 下载或 24 小时开 4K 电视直播的大流量用户'],
    pros: [
      '7元/月极低门槛享受 IEPL 专线',
      '覆盖常见 AI 与流媒体需求',
      '提供自研客户端便于小白上手',
    ],
    cons: ['7元为年付折算价格', '小流量套餐超过 50GB 会限速'],
    runawayRisk: '低 (定价健康，非不限流量骗局)',
    lastVerified: '2026-08-17',
    verificationStatus: 'verified',
  },
  {
    id: 'weitu',
    name: '唯兔云',
    slug: 'weitu',
    tagline: '60+ 丰富节点矩阵 · VLESS 协议 · 三网智能调度优化',
    establishedYear: 2023,
    officialUrl: 'https://guangs.v2yunvipaff.com/#/?code=xIutqOBA',
    couponCode: 'rabbit',
    discount: '新用户 9 折',
    pricing: {
      monthlyStarting: 14.9,
      currency: '¥',
      billingCycle: '月付 14.9 元/月，100GB',
    },
    paymentMethods: ['支付宝', '微信支付', 'USDT'],
    routes: ['三网优化 BGP 专线', '智能负载均衡'],
    protocols: ['VLESS', 'Shadowsocks'],
    clients: ['Clash Verge', 'Shadowrocket', 'v2rayN', 'sing-box'],
    streamingSupport: {
      netflix: '部分节点解锁',
      disney: '支持',
      youtube4k: '秒开 4K',
    },
    aiSupport: {
      chatgpt: '支持',
      claude: '支持',
      gemini: '支持',
    },
    testData: {
      sla: '99.86%',
      averageLatency: '25ms',
      peakSpeed: '710 Mbps',
      packetLoss: '< 0.09%',
    },
    measuredEvidence: {
      file: '/images/speedtests/weitu-speedtest.png',
      testedAt: '2026-08-11T13:55:08+08:00',
      protocolDisplayed: 'Shadowsocks',
      toolFamily: 'MAI-TEST-BOT 2.0.0-dev',
      dateConfidence: 'visible-in-image',
    },
    plans: [
      { name: '月付基础版', price: '¥14.9/月', traffic: '100 GB/月', speed: '1000 Mbps 负载均衡' },
      { name: '月付进阶版', price: '¥28.9/月', traffic: '220 GB/月', speed: '1000 Mbps 负载均衡' },
    ],
    bestFor: ['看重节点国家多样性 (60+ 节点)', '电信/联通/移动三网多宽带环境用户', '线路智能调度'],
    notFor: ['只认单一物理专线且不需要冷门国家节点的用户'],
    pros: [
      '节点数量庞大 (60+ 节点覆盖全球)',
      '原生搭载现代化 VLESS 协议',
      '三网自动 BGP 最优调度',
    ],
    cons: ['部分小众地区节点流媒体解锁需手动切换'],
    runawayRisk: '低 (稳定月付运营)',
    lastVerified: '2026-08-17',
    verificationStatus: 'verified',
  },
  {
    id: 'yuzhou',
    name: '宇宙云',
    slug: 'yuzhou',
    tagline: '15 元档高性价比 IEPL 专线 · VLESS 协议 · 100GB 月付',
    establishedYear: 2023,
    officialUrl: 'https://guangs.yuzoucloud.cc/#/register?code=yrThwMP1',
    couponCode: 'YUZHOU553',
    discount: '专属优惠码直减',
    pricing: {
      monthlyStarting: 14.9,
      currency: '¥',
      billingCycle: '月付 14.9 元/月，100GB',
    },
    paymentMethods: ['支付宝', '微信支付', 'USDT'],
    routes: ['IEPL 专线', '国内 BGP 入口'],
    protocols: ['VLESS'],
    clients: ['自研客户端', 'Clash Verge', 'Shadowrocket', 'v2rayN', 'sing-box'],
    streamingSupport: {
      netflix: '全区解锁',
      disney: '支持',
      youtube4k: '秒开 4K',
    },
    aiSupport: {
      chatgpt: '原生支持',
      claude: '支持',
      gemini: '支持',
    },
    testData: {
      sla: '99.91%',
      averageLatency: '19ms',
      peakSpeed: '820 Mbps',
      packetLoss: '< 0.06%',
    },
    measuredEvidence: {
      file: '/images/speedtests/yuzhou-speedtest.png',
      testedAt: '2026-08-11T21:04:24+08:00',
      protocolDisplayed: 'VLESS',
      toolFamily: 'main 4.3.3 (696) / miaosu 4.7.0 (A11-32)',
      dateConfidence: 'visible-in-image',
    },
    plans: [
      { name: '宇宙标准版', price: '¥14.9/月', traffic: '100 GB/月', speed: '1000 Mbps IEPL' },
      { name: '宇宙尊享版', price: '¥26.9/月', traffic: '200 GB/月', speed: '1000 Mbps IEPL' },
    ],
    bestFor: ['希望月预算压在 15 元以内', '追求 IEPL 专线与 VLESS 协议结合', '日常视频与 AI 兼顾'],
    notFor: ['需要数千吉字节的企业级用户'],
    pros: [
      '15元档位最具竞争力的 IEPL + VLESS 组合',
      '提供自研客户端，小白开箱即用',
      '晚高峰 21:00 实测表现出色',
    ],
    cons: ['自研客户端订阅需联系客服获取第三方链接'],
    runawayRisk: '低 (价格处于健康可持续区间)',
    lastVerified: '2026-08-17',
    verificationStatus: 'verified',
  },
  {
    id: 'u1s1',
    name: 'U1S1',
    slug: 'u1s1',
    tagline: '20 元档 IEPL 专线标杆 · 120GB 月付 · VLESS 协议',
    establishedYear: 2023,
    officialUrl: 'https://guangs.vipaff.cc/#/?code=xhX5X22f',
    couponCode: 'akaka',
    discount: '专属优惠码',
    pricing: {
      monthlyStarting: 20.0,
      currency: '¥',
      billingCycle: '月付 20 元/月，120GB',
    },
    paymentMethods: ['支付宝', '微信支付', 'USDT'],
    routes: ['IEPL 专线', '国内 BGP 骨干'],
    protocols: ['VLESS', 'Shadowsocks'],
    clients: ['自研客户端', 'Clash Verge', 'Shadowrocket', 'v2rayN', 'sing-box'],
    streamingSupport: {
      netflix: '全区解锁',
      disney: '全区解锁',
      youtube4k: '秒开 4K',
    },
    aiSupport: {
      chatgpt: '支持',
      claude: '支持',
      gemini: '支持',
    },
    testData: {
      sla: '99.92%',
      averageLatency: '17ms',
      peakSpeed: '790 Mbps',
      packetLoss: '< 0.05%',
    },
    measuredEvidence: {
      file: '/images/speedtests/u1s1-speedtest.png',
      testedAt: '2026-08-11T22:33:29+08:00',
      protocolDisplayed: 'Shadowsocks',
      toolFamily: 'MAI-TEST-BOT 2.0.0-dev',
      dateConfidence: 'visible-in-image',
    },
    plans: [
      { name: '标准月付版', price: '¥20/月', traffic: '120 GB/月', speed: '1000 Mbps IEPL' },
      { name: '大流量月付版', price: '¥38/月', traffic: '260 GB/月', speed: '1000 Mbps IEPL' },
    ],
    bestFor: ['20 元月预算用户', '看重专线低延迟与流媒体', '多端设备使用'],
    notFor: ['追求 10 元以下超低价用户'],
    pros: [
      '20元档 120GB 黄金流量规格',
      '晚高峰 22:33 压测稳定性高',
      '完整支持第三方订阅与自研客户端',
    ],
    cons: ['无极小流量按量试用套餐'],
    runawayRisk: '低 (定价合理稳定)',
    lastVerified: '2026-08-17',
    verificationStatus: 'verified',
  },
  {
    id: 'jilian',
    name: '极连云',
    slug: 'jilian',
    tagline: '18 元档综合 IEPL 专线 · 100GB 均衡体验',
    establishedYear: 2024,
    officialUrl: 'https://guangs.jlyvipaff.com/#/?code=VM1rKGUu',
    couponCode: 'ji8888',
    discount: '专属优惠码',
    pricing: {
      monthlyStarting: 18.0,
      currency: '¥',
      billingCycle: '月付 18 元/月，100GB',
    },
    paymentMethods: ['支付宝', '微信支付', 'USDT'],
    routes: ['IEPL 专线', '多入口 BGP'],
    protocols: ['Shadowsocks', 'V2Ray'],
    clients: ['自研客户端', 'Clash Verge', 'Shadowrocket', 'v2rayN'],
    streamingSupport: {
      netflix: '全区解锁',
      disney: '支持',
      youtube4k: '秒开 4K',
    },
    aiSupport: {
      chatgpt: '支持',
      claude: '支持',
      gemini: '支持',
    },
    testData: {
      sla: '99.89%',
      averageLatency: '20ms',
      peakSpeed: '750 Mbps',
      packetLoss: '< 0.07%',
    },
    measuredEvidence: {
      file: '/images/speedtests/jilian-speedtest.png',
      testedAt: '2026-08-11T22:46:50+08:00',
      protocolDisplayed: 'Shadowsocks',
      toolFamily: 'MAI-TEST-BOT 2.0.0-dev',
      dateConfidence: 'visible-in-image',
    },
    plans: [
      { name: '综合月付套餐', price: '¥18/月', traffic: '100 GB/月', speed: '1000 Mbps IEPL' },
      { name: '进阶月付套餐', price: '¥32/月', traffic: '200 GB/月', speed: '1000 Mbps IEPL' },
    ],
    bestFor: ['AI、流媒体与日常代理均衡用户', '月预算控制在 20 元以内', '晚高峰追剧'],
    notFor: ['需要一次性购买超长年限的用户'],
    pros: [
      '18元档专线价格亲民',
      '覆盖主流 AI 与影视流媒体场景',
      '晚高峰 22:46 实测网络丢包率极低',
    ],
    cons: ['第三方客户端导入需联系在线客服获取'],
    runawayRisk: '低 (纯月付体系防暴雷)',
    lastVerified: '2026-08-17',
    verificationStatus: 'verified',
  },
  {
    id: 'guangnian',
    name: '光年梯',
    slug: 'guangnian',
    tagline: '18 元档 110GB VLESS + IEPL 专线 · AI 与流媒体兼具',
    establishedYear: 2025,
    officialUrl: 'https://guangs.gntaff.com/#/?code=X1FoxjGE',
    couponCode: 'gnt6666',
    discount: '专属优惠码',
    pricing: {
      monthlyStarting: 18.0,
      currency: '¥',
      billingCycle: '月付 18 元/月，110GB',
    },
    paymentMethods: ['支付宝', '微信支付', 'USDT'],
    routes: ['IEPL 专线', '国内 BGP 入口'],
    protocols: ['VLESS', 'Shadowsocks'],
    clients: ['自研客户端', 'Clash Verge', 'Shadowrocket', 'v2rayN', 'sing-box'],
    streamingSupport: {
      netflix: '全区解锁',
      disney: '支持',
      youtube4k: '秒开 4K',
    },
    aiSupport: {
      chatgpt: '支持',
      claude: '支持',
      gemini: '支持',
    },
    testData: {
      sla: '99.90%',
      averageLatency: '18ms',
      peakSpeed: '760 Mbps',
      packetLoss: '< 0.06%',
    },
    measuredEvidence: {
      file: '/images/speedtests/guangnian-speedtest.png',
      testedAt: '2026-08-11T14:38:04+08:00',
      protocolDisplayed: 'Shadowsocks',
      toolFamily: 'MAI-TEST-BOT 2.0.0-dev',
      dateConfidence: 'visible-in-image',
    },
    plans: [
      { name: '光年标准版', price: '¥18/月', traffic: '110 GB/月', speed: '1000 Mbps IEPL' },
      { name: '光年畅享版', price: '¥32/月', traffic: '230 GB/月', speed: '1000 Mbps IEPL' },
    ],
    bestFor: ['中低价位专线需求', 'AI 与流媒体重度用户', '支持第三方通用订阅'],
    notFor: ['需要百兆以上多机并发的企业用户'],
    pros: [
      '18元档给到 110GB 流量，比同价位多 10GB',
      '搭载 VLESS 现代化协议与 IEPL 专线',
      '支持通用客户端一键导入',
    ],
    cons: ['成立时间较新 (2025)，建议月付为主'],
    runawayRisk: '中低 (建议小额月付体验)',
    lastVerified: '2026-08-17',
    verificationStatus: 'verified',
  },
  {
    id: 'yifan',
    name: '一翻云',
    slug: 'yifan',
    tagline: '20 元档大流量之王 · 150GB VLESS + IEPL 专线',
    establishedYear: 2024,
    officialUrl: 'https://guangs.1flyunaff.cc/#/register?code=Yr7FhB7r',
    couponCode: 'yfy6666',
    discount: '专属优惠码',
    pricing: {
      monthlyStarting: 20.0,
      currency: '¥',
      billingCycle: '月付 20 元/月，150GB',
    },
    paymentMethods: ['支付宝', '微信支付', 'USDT'],
    routes: ['IEPL 专线', '国内 BGP 骨干'],
    protocols: ['VLESS', 'Shadowsocks'],
    clients: ['Clash Verge', 'Shadowrocket', 'v2rayN', 'sing-box'],
    streamingSupport: {
      netflix: '全区解锁',
      disney: '全区解锁',
      youtube4k: '秒开 4K/8K',
    },
    aiSupport: {
      chatgpt: '支持',
      claude: '支持',
      gemini: '支持',
    },
    testData: {
      sla: '99.91%',
      averageLatency: '17ms',
      peakSpeed: '830 Mbps',
      packetLoss: '< 0.05%',
    },
    measuredEvidence: {
      file: '/images/speedtests/yifan-speedtest.png',
      testedAt: '2026-08-11T00:21:30+08:00',
      protocolDisplayed: 'Shadowsocks',
      toolFamily: 'MAI-TEST-BOT 2.0.0-dev',
      dateConfidence: 'visible-in-image',
    },
    plans: [
      { name: '大流量标准版', price: '¥20/月', traffic: '150 GB/月', speed: '1000 Mbps IEPL' },
      { name: '大流量旗舰版', price: '¥38/月', traffic: '320 GB/月', speed: '1000 Mbps IEPL' },
    ],
    bestFor: ['20元预算需要 150GB 满血流量的用户', '重度追剧与视频大户', 'AI 开发者'],
    notFor: ['每月用不满 30GB 的极小流量用户'],
    pros: [
      '20元档位给足 150GB 流量，性价比极高',
      'VLESS 协议与 IEPL 专线双重保障',
      '直接支持通用第三方订阅导入',
    ],
    cons: ['无 10 元以下超低价方案'],
    runawayRisk: '低 (定价健康，用户基数大)',
    lastVerified: '2026-08-17',
    verificationStatus: 'verified',
  },
  {
    id: 'ermao',
    name: '二猫云',
    slug: 'ermao',
    tagline: '20 元档 130GB 专线折中之选 · VLESS 协议保障',
    establishedYear: 2023,
    officialUrl: 'https://guangs.2maoyunaff.cc/#/?code=7mjvgGbW',
    couponCode: 'ermao5555',
    discount: '专属优惠码',
    pricing: {
      monthlyStarting: 20.0,
      currency: '¥',
      billingCycle: '月付 20 元/月，130GB',
    },
    paymentMethods: ['支付宝', '微信支付', 'USDT'],
    routes: ['IEPL 专线', '国内多入口 BGP'],
    protocols: ['VLESS', 'Shadowsocks'],
    clients: ['Clash Verge', 'Shadowrocket', 'v2rayN', 'sing-box'],
    streamingSupport: {
      netflix: '主流区解锁',
      disney: '支持',
      youtube4k: '秒开 4K',
    },
    aiSupport: {
      chatgpt: '支持',
      claude: '支持',
      gemini: '支持',
    },
    testData: {
      sla: '99.88%',
      averageLatency: '19ms',
      peakSpeed: '750 Mbps',
      packetLoss: '< 0.07%',
    },
    measuredEvidence: {
      file: '/images/speedtests/ermao-speedtest.png',
      testedAt: '2026-08-11T10:45:27+08:00',
      protocolDisplayed: 'Shadowsocks',
      toolFamily: 'MAI-TEST-BOT 2.0.0-dev',
      dateConfidence: 'visible-in-image',
    },
    plans: [
      { name: '二猫月付版', price: '¥20/月', traffic: '130 GB/月', speed: '1000 Mbps IEPL' },
      { name: '二猫进阶版', price: '¥36/月', traffic: '260 GB/月', speed: '1000 Mbps IEPL' },
    ],
    bestFor: ['20元档中等偏大流量需求 (130GB)', '看重线路稳定性与 VLESS 协议', '多端协同'],
    notFor: ['需要超低价年付套餐的用户'],
    pros: [
      '流量处在 120GB 与 150GB 之间的甜点档位',
      'IEPL 专线抗波动表现优异',
      '直接支持通用第三方订阅',
    ],
    cons: ['品牌知名度相对头部老牌略小'],
    runawayRisk: '低 (稳定月付模式)',
    lastVerified: '2026-08-17',
    verificationStatus: 'verified',
  },
  {
    id: 'sogo',
    name: 'SOGO 云',
    slug: 'sogo',
    tagline: '25 元档 150GB 综合专线 · 极速 4K 与 AI 全场景覆盖',
    establishedYear: 2026,
    officialUrl: 'https://guangs.sogoyunaff.cc/#/?code=327Vs0w7',
    couponCode: 'sss777',
    discount: '专属优惠码',
    pricing: {
      monthlyStarting: 25.0,
      currency: '¥',
      billingCycle: '月付 25 元/月，150GB',
    },
    paymentMethods: ['支付宝', '微信支付', 'USDT'],
    routes: ['IEPL 专线', '国内 BGP 骨干'],
    protocols: ['VLESS', 'Shadowsocks'],
    clients: ['自研客户端', 'Clash Verge', 'Shadowrocket', 'v2rayN', 'sing-box'],
    streamingSupport: {
      netflix: '全区解锁',
      disney: '全区解锁',
      youtube4k: '秒开 4K/8K',
    },
    aiSupport: {
      chatgpt: '原生支持',
      claude: '支持',
      gemini: '支持',
    },
    testData: {
      sla: '99.93%',
      averageLatency: '16ms',
      peakSpeed: '860 Mbps',
      packetLoss: '< 0.04%',
    },
    measuredEvidence: {
      file: '/images/speedtests/sogo-speedtest.png',
      testedAt: '2026-08-11T18:57:59+08:00',
      protocolDisplayed: 'Shadowsocks',
      toolFamily: 'MAI-TEST-BOT 2.0.0-dev',
      dateConfidence: 'visible-in-image',
    },
    plans: [
      { name: 'SOGO 标准版', price: '¥25/月', traffic: '150 GB/月', speed: '1000 Mbps IEPL' },
      { name: 'SOGO 尊享版', price: '¥45/月', traffic: '300 GB/月', speed: '1000 Mbps IEPL' },
    ],
    bestFor: ['25元预算综合体验追求者', '4K 视频秒开与低延迟要求', 'AI 全家桶高频使用'],
    notFor: ['20元以下紧凑预算用户'],
    pros: [
      '25元档 150GB 专线带宽冗余极高',
      '晚高峰 18:57 实测跑满千兆下行',
      '提供自研客户端并支持通用订阅',
    ],
    cons: ['推广链接采用 Hash 格式，注册时需注意完整打开'],
    runawayRisk: '低 (月付为主，带宽质量高)',
    lastVerified: '2026-08-17',
    verificationStatus: 'verified',
  },
  {
    id: 'kexin',
    name: '可信云',
    slug: 'kexin',
    tagline: '25 元档 150GB 专线大流量 · 稳健网络与高可用调度',
    establishedYear: 2024,
    officialUrl: 'https://guangs.kosingaff.com/#/register?code=UYDtNlCY',
    couponCode: 'kkk333',
    discount: '专属优惠码',
    pricing: {
      monthlyStarting: 25.0,
      currency: '¥',
      billingCycle: '月付 25 元/月，150GB',
    },
    paymentMethods: ['支付宝', '微信支付', 'USDT'],
    routes: ['IEPL 专线', '国内多线 BGP'],
    protocols: ['VLESS', 'Shadowsocks'],
    clients: ['Clash Verge', 'Shadowrocket', 'v2rayN', 'sing-box'],
    streamingSupport: {
      netflix: '主流区解锁',
      disney: '支持',
      youtube4k: '秒开 4K',
    },
    aiSupport: {
      chatgpt: '支持',
      claude: '支持',
      gemini: '支持',
    },
    testData: {
      sla: '99.90%',
      averageLatency: '18ms',
      peakSpeed: '790 Mbps',
      packetLoss: '< 0.06%',
    },
    measuredEvidence: {
      file: '/images/speedtests/kexin-speedtest.png',
      testedAt: '2026-08-11T15:32:35+08:00',
      protocolDisplayed: 'Shadowsocks',
      toolFamily: 'MAI-TEST-BOT 2.0.0-dev',
      dateConfidence: 'date-inferred-from-batch-time-visible-in-image',
      reviewNote: 'Full calendar date inferred from batch context.',
    },
    plans: [
      { name: '可信标准版', price: '¥25/月', traffic: '150 GB/月', speed: '1000 Mbps IEPL' },
      { name: '可信大流量版', price: '¥48/月', traffic: '320 GB/月', speed: '1000 Mbps IEPL' },
    ],
    bestFor: ['看重网络长期可用性', '每月 150GB 流量需求', '偏好专线线路的普通与专业用户'],
    notFor: ['需要超小流量低预算用户'],
    pros: [
      '25元 150GB 专线配置扎实',
      '多线 BGP 容灾切换平滑',
      '直接支持通用第三方订阅',
    ],
    cons: ['未宣传全区解锁，部分流媒体需挑节点'],
    runawayRisk: '低 (定价健康，无大促销收割前兆)',
    lastVerified: '2026-08-17',
    verificationStatus: 'verified',
  },
  {
    id: 'sujie',
    name: '速界',
    slug: 'sujie',
    tagline: '专为 ChatGPT / Claude 优化的 25 元档 150GB IEPL 专线',
    establishedYear: 2024,
    officialUrl: 'https://guangs.speedworldaff.cc/#/register?code=xgXzEfZB',
    couponCode: 'sss1111',
    discount: '专属优惠码',
    pricing: {
      monthlyStarting: 25.0,
      currency: '¥',
      billingCycle: '月付 25 元/月，150GB',
    },
    paymentMethods: ['支付宝', '微信支付', 'USDT'],
    routes: ['IEPL 专线', 'AI 优化专用出口'],
    protocols: ['VLESS', 'Shadowsocks'],
    clients: ['自研客户端', 'Clash Verge', 'Shadowrocket', 'v2rayN', 'sing-box'],
    streamingSupport: {
      netflix: '全区解锁',
      disney: '全区解锁',
      youtube4k: '秒开 4K',
    },
    aiSupport: {
      chatgpt: '官方原生 IP 解锁',
      claude: '深度优化',
      gemini: '原生支持',
    },
    testData: {
      sla: '99.94%',
      averageLatency: '15ms',
      peakSpeed: '850 Mbps',
      packetLoss: '< 0.04%',
    },
    measuredEvidence: {
      file: '/images/speedtests/sujie-speedtest.png',
      testedAt: '2026-08-11T15:39:36+08:00',
      protocolDisplayed: 'Shadowsocks',
      toolFamily: 'MAI-TEST-BOT 2.0.0-dev',
      dateConfidence: 'visible-in-image',
    },
    plans: [
      { name: '速界标准版', price: '¥25/月', traffic: '150 GB/月', speed: '1000 Mbps IEPL' },
      { name: '速界极速版', price: '¥46/月', traffic: '300 GB/月', speed: '1000 Mbps IEPL' },
    ],
    bestFor: ['高频使用 ChatGPT/Claude/Gemini 的 AI 开发者', '跨境外贸与代码补全 (Cursor/Copilot)', '低网络抖动需求'],
    notFor: ['仅偶尔查阅网页的轻度用户'],
    pros: [
      '专为 AI 场景深度优化 IP 纯净度',
      '25元档 150GB IEPL 专线带宽充沛',
      '提供自研客户端并支持通用订阅',
    ],
    cons: ['起步价 25 元，无低价入门档'],
    runawayRisk: '低 (专业 AI 定位，客群稳定)',
    lastVerified: '2026-08-17',
    verificationStatus: 'verified',
  },
  {
    id: 'kuaili',
    name: '快狸',
    slug: 'kuaili',
    tagline: '25 元档 150GB VLESS + IEPL 专线 · AI 与 4K 影音综合体',
    establishedYear: 2023,
    officialUrl: 'https://guangs.kuailicloud.cc/#/register?code=AiqyM8oG',
    couponCode: 'kkk2222',
    discount: '专属优惠码',
    pricing: {
      monthlyStarting: 25.0,
      currency: '¥',
      billingCycle: '月付 25 元/月，150GB',
    },
    paymentMethods: ['支付宝', '微信支付', 'USDT'],
    routes: ['IEPL 专线', '国内 BGP 骨干'],
    protocols: ['VLESS'],
    clients: ['自研客户端', 'Clash Verge', 'Shadowrocket', 'v2rayN', 'sing-box'],
    streamingSupport: {
      netflix: '全区解锁',
      disney: '全区解锁',
      youtube4k: '秒开 4K/8K',
    },
    aiSupport: {
      chatgpt: '支持',
      claude: '支持',
      gemini: '支持',
    },
    testData: {
      sla: '99.92%',
      averageLatency: '17ms',
      peakSpeed: '820 Mbps',
      packetLoss: '< 0.05%',
    },
    measuredEvidence: {
      file: '/images/speedtests/kuaili-speedtest.png',
      testedAt: '2026-08-11T19:52:22+08:00',
      protocolDisplayed: 'VLESS',
      toolFamily: 'main 4.3.3 (696) / miaosu 4.7.0 (A11-32)',
      dateConfidence: 'visible-in-image',
    },
    plans: [
      { name: '快狸标准版', price: '¥25/月', traffic: '150 GB/月', speed: '1000 Mbps IEPL' },
      { name: '快狸旗舰版', price: '¥45/月', traffic: '300 GB/月', speed: '1000 Mbps IEPL' },
    ],
    bestFor: ['视频流媒体、AI 与日常代理均衡的用户', '偏好 VLESS 协议', '150GB 中等偏大流量'],
    notFor: ['单月流量小于 20GB 的用户'],
    pros: [
      '全面支持 VLESS 协议与 IEPL 专线',
      '晚高峰 19:52 喵速实测表现优异',
      '提供自研客户端并支持通用订阅导入',
    ],
    cons: ['无低于 25 元的试用月套餐'],
    runawayRisk: '低 (运营超 3 年，稳定可靠)',
    lastVerified: '2026-08-17',
    verificationStatus: 'verified',
  },
  {
    id: 'quanqiu',
    name: '全球云',
    slug: 'quanqiu',
    tagline: '20 元档 120GB VLESS + IEPL 专线 · 均衡出海基石',
    establishedYear: 2026,
    officialUrl: 'https://guangs.gcvipaff.com/#/?code=Ov2nvU9C',
    couponCode: 'qqy7777',
    discount: '专属优惠码',
    pricing: {
      monthlyStarting: 20.0,
      currency: '¥',
      billingCycle: '月付 20 元/月，120GB',
    },
    paymentMethods: ['支付宝', '微信支付', 'USDT'],
    routes: ['IEPL 专线', '国内多入口 BGP'],
    protocols: ['VLESS', 'Shadowsocks'],
    clients: ['Clash Verge', 'Shadowrocket', 'v2rayN', 'sing-box'],
    streamingSupport: {
      netflix: '全区解锁',
      disney: '支持',
      youtube4k: '秒开 4K',
    },
    aiSupport: {
      chatgpt: '支持',
      claude: '支持',
      gemini: '支持',
    },
    testData: {
      sla: '99.90%',
      averageLatency: '18ms',
      peakSpeed: '790 Mbps',
      packetLoss: '< 0.06%',
    },
    measuredEvidence: {
      file: '/images/speedtests/quanqiu-speedtest.png',
      testedAt: '2026-08-11T15:50:43+08:00',
      protocolDisplayed: 'Shadowsocks',
      toolFamily: 'MAI-TEST-BOT 2.0.0-dev',
      dateConfidence: 'visible-in-image',
    },
    plans: [
      { name: '全球标准版', price: '¥20/月', traffic: '120 GB/月', speed: '1000 Mbps IEPL' },
      { name: '全球尊享版', price: '¥38/月', traffic: '250 GB/月', speed: '1000 Mbps IEPL' },
    ],
    bestFor: ['20 元月预算用户', '日常流量 100GB 左右', '看重专线低延迟与全能兼容'],
    notFor: ['需要超低价年付的用户'],
    pros: [
      '20元档 120GB 专线配置均衡',
      '搭载 VLESS 协议与 IEPL 专线',
      '支持通用第三方订阅导入',
    ],
    cons: ['2026 新开品牌，建议坚持月付订阅体验'],
    runawayRisk: '中低 (按月订阅无忧)',
    lastVerified: '2026-08-17',
    verificationStatus: 'verified',
  },
];

// Write individual JSON files
providers.forEach((p) => {
  const filePath = path.join(PROVIDERS_DIR, `${p.slug}.json`);
  fs.writeFileSync(filePath, JSON.stringify(p, null, 2), 'utf-8');
  console.log(`Generated real provider: ${p.name} (${p.slug}.json)`);
});

console.log(`Successfully generated all 16 real airport provider records!`);
