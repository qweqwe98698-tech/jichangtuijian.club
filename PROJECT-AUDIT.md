# PROJECT-AUDIT.md: 机场推荐 Club (jichangtuijian.club) 全站工程审计

## 1. 扫描概述
- **项目目录**: `c:\Users\Pro User\Desktop\jichangtuijian.club`
- **项目状态**: 全新工程初始化 (Clean Slate)
- **基准域名**: `https://jichangtuijian.club/`
- **品牌名称**: 机场推荐 Club
- **品牌副标题**: 机场选择、代理知识与网络工具中文知识库
- **定位**: 机场选择决策中心 + 品牌评测数据库 + 客户端教程中心 + 代理技术知识库 + 网络故障排查中心 + 风险预警中心 + 海外网络需求内容入口

---

## 2. 路由与资产分类矩阵

| 模块 / 路径 | 分类类型 | 规划动作 / 说明 |
| :--- | :--- | :--- |
| `/` (首页) | NEW | 落地 SIGNAL ATLAS 信号地图架构，包含 13 个独立功能板块 |
| `/airport-ranking/` (排行榜) | NEW | P0 商业决策主入口，基于多维 SLA / 延迟 / 解锁率数据排序 |
| `/stable-airport/` (稳定机场) | NEW | P0 专攻晚高峰稳定性、SLA 保证与冗余专线 |
| `/cheap-airport/` (便宜机场) | NEW | P1 专攻低预算、高性价比、学生党与轻度用户 |
| `/dedicated-line-airport/` (专线机场) | NEW | P1 专攻 IPLC / IEPL 纯内网专线与高可用场景 |
| `/value-airport/` (高性价比) | NEW | P1 均衡带宽、流量与价格的性价比选型 |
| `/clash-airport/` 等客户端专题 | NEW | P3 客户端商业聚合页（Clash / Shadowrocket / v2rayN） |
| `/chatgpt-airport/` 等场景专题 | NEW | P4 场景商业聚合页（ChatGPT / 流媒体 / 游戏 / 外贸） |
| `/iepl-airport/` 等技术商业专题 | NEW | P5 技术商业专题（IEPL / IPLC / 中转 / 原生IP / Hysteria2） |
| `/knowledge/*` (知识库) | NEW | P10 代理技术、协议、线路、IP类型百科知识库 |
| `/troubleshooting/*` (故障排查) | NEW | P7 针对节点全红、超时、更新失败等高频故障的标准 SOP |
| `/risk-warning/*` (风险预警) | NEW | P8 跑路预警、测速图揭秘、假官网识别与安全指南 |
| `/brands/*` (品牌库) | NEW | P6 解耦的品牌数据库与独立评测页面 |
| `/tools/*` (网络工具) | NEW | P9 泛流量网络工具与概念入口 |
| `/tutorial/*` (客户端教程) | NEW | 实操客户端下载、安装、配置与分流教程 |
| `/chatgpt/*` 等超级流量 Pillar | NEW | LEVEL A 超级流量池（Pillar + 注册/登录/排查/选型） |
| `/methodology/` 等 EEAT 页面 | NEW | 关于我们、评测方法论、编辑政策、免责声明、更新机制 |

---

## 3. 技术栈与架构确认
- **框架**: Astro 5 (Static Output, `output: 'static'`)
- **样式**: Tailwind CSS (自定义深色 SIGNAL ATLAS 设计系统)
- **内容引擎**: Astro Content Collections (Type-Safe Content Schema + Decoupled JSON Data)
- **搜索引擎**: Pagefind 静态全文搜索
- **SEO/GEO**: `@astrojs/sitemap`, `@astrojs/rss`, Dynamic `robots.txt`, Schema.org (JSON-LD), QuickAnswer GEO 引擎
- **自动化工具**: `scripts/seo-audit.ts`, `scripts/keyword-coverage.ts`
- **构建目标**: Cloudflare Pages 完美适配

---

## 4. 迁移与重定向风险
- 本项目为全新启动工程，无旧 URL 冲突。
- 确立全站 Canonical 标准为 `https://jichangtuijian.club/[slug]/`。
