import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

export const GET: APIRoute = async (context) => {
  const articles = await getCollection('articles', ({ data }) => !data.draft);
  const articleItems = articles.map((article) => ({
    title: article.data.title,
    description: article.data.description,
    pubDate: new Date(article.data.pubDate),
    link: `/articles/${article.id.replace(/\.(md|mdx)$/, '')}/`,
  }));

  const staticItems = [
    {
      title: '拒绝当韭菜：2026 机场防跑路生存法则与“测速图谎言”深度粉碎',
      description: '深度揭露单线程与多线程测速图造假、节点倍率套路、开业低价年付收割跑路内幕，输出真正安全的订阅策略。',
      pubDate: new Date('2026-08-16'),
      link: '/risk-warning/speedtest-lies/',
    },
    {
      title: '2026 科学上网机场综合排行榜',
      description: '基于晚高峰 SLA 可用性、单线程带宽与 AI 原生纯净 IP 解锁率综合评定的天梯榜。',
      pubDate: new Date('2026-08-16'),
      link: '/airport-ranking/',
    },
    {
      title: 'Clash Verge Rev 电脑端新手配置教程',
      description: '现代化的开源 Clash 客户端，内置 Mihomo 核心，图文讲解从安装到分流全流程。',
      pubDate: new Date('2026-08-16'),
      link: '/tutorial/clash-verge/',
    },
  ];

  return rss({
    title: '机场推荐 Club | 网络代理知识与稳定节点选型',
    description: '机场选择、代理知识与网络工具中文知识库。提供真实中立的节点实测、客户端教程与故障排查指南。',
    site: context.site?.toString() || 'https://jichangtuijian.club/',
    items: [...articleItems, ...staticItems],
    customData: `<language>zh-cn</language>`,
  });
};
