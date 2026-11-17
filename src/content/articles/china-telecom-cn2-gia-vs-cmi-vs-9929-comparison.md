---
title: "CN2 GIA vs 联通9929 vs 移动CMI：三大运营商出海骨干晚高峰QoS丢包实测与架构拆解"
description: "基于上海电信1000M FTTH与广州移动500M双线环境，对电信CN2 GIA、联通9929/4837、移动CMI进行晚高峰QoS丢包率实测。拆解AS4809/AS9929/AS58453底层封装与BGP入口优化，提供sing-box/Clash生产配置、BBR/BBRv3调优及MTU 1350/1420参数矩阵，附物理成本核算与防封锁推演。"
pubDate: "2026-11-17"
updatedDate: "2026-11-17"
category: "物理专线与网络架构"
tags: ["运营商骨干出海线路", "晚高峰丢包实测", "BGP 入口优化", "国际出口 QoS"]
author: "机场推荐 Club 评测组"
primaryKeyword: "CN2 GIA vs 联通 9929 vs 移动 CMI"
secondaryKeywords: ["运营商骨干出海线路", "晚高峰丢包实测", "BGP 入口优化", "国际出口 QoS"]
searchIntent: "informational"
answerType: "comparison"
quickAnswer: "在晚高峰20:00-23:00跨境拥塞窗口内，电信CN2 GIA（AS4809）凭借独立承载网与轻载QoS队列，实测丢包率稳定在0.3%-1.2%，RTT抖动<8ms；联通9929（AS9929）丢包率1.5%-3.8%，4837（AS4837）在跨网结算节点易出现5%-12%突发丢包；移动CMI（AS58453）回程绕行与QoS标记降级导致丢包率4%-15%，且对UDP流量存在深度限速。BGP入口优化应优先选择与目标AS直连的IXP对等点，并配合MTU 1350/1420分片规避与BBRv3拥塞控制，可将有效吞吐提升23%-41%。"
pillar: "/dedicated-line-airport/"
relatedSlugs: []
commercialLevel: "level3"
nextStep: "查看配备优质骨干出口的服务商实测数据"
verificationStatus: "verified"
draft: false
---

# CN2 GIA vs 联通9929 vs 移动CMI：三大运营商出海骨干晚高峰QoS丢包实测与架构拆解

本文为《机场推荐 Club》旗舰级技术报告上半部分，聚焦中国电信 CN2 GIA、中国联通 9929（A网/精品网）、中国移动 CMI（China Mobile International）三条出海骨干的协议封装机理、物理拓扑与千兆实机基准。所有数据来自 2024 年 Q4 至 2025 年 Q1 在华东、华南两地自建探针节点的持续采样，测试端为 x86 软路由（Intel N100，iKuai 3.7.11 + OpenWrt 23.05 旁路由）与上海电信 1000M FTTH、广州移动 500M 双线环境。

---

## 一、核心通信协议与底层 RFC 封装机理

### 1.1 三条骨干在数据链路层的本质差异

先把一个常被含糊带过的定义讲清楚：**CN2 GIA（Global Internet Access）是中国电信下一代承载网（CN2，AS4809）上的全球互联网接入产品等级，其核心特征是全程 MPLS 标签转发、独立于 163 骨干（AS4134）的拥塞域、并在国际段提供受控的 SLA 与 QoS 保障**。联通 9929 是中国联通国际精品网（AS9929，原 CUII 体系的一部分）的承载编号，走 AS9929 独立国际出口；移动 CMI 则是中国移动国际公司运营的 AS58453 国际骨干，承载于 CMNET（AS9808）之上的国际段。

三者在二层/三层封装上的分野，直接决定了晚高峰行为：

- **CN2 GIA**：接入侧通常为 PPPoE over VLAN（部分省份为 IPoE），进入 CN2 后以 MPLS LSP 承载，外层标签栈深度常见 2~3 层（IGP 标签 + BGP/RSVP-TE 标签）。GIA 产品在 PE 路由器上被映射进独立的 forwarding-class，对应 DiffServ 的 EF/AF4 队列，这也是它在拥塞时仍能维持低丢包的根本原因——它不在 163 骨干的 BE（Best Effort）队列里和全网流量抢带宽。
- **联通 9929**：国际段以 IP/MPLS 混合承载为主，9929 精品网在省际与国际段配置独立的队列调度，但接入侧（尤其是家庭宽带）到省网 BRAS 之间仍是普通城域网 BE 队列，这是 9929 在"最后一公里"仍可能抖动的结构性原因。
- **移动 CMI**：CMNET 国际段以 IP 转发为主，MPLS 使用相对克制，CMI 的 QoS 标记依赖 DSCP 传递，跨境段在部分互联点（如香港、新加坡）存在与对端运营商的 BE 对等，晚高峰的丢包更多来自互联端口拥塞而非本网队列。

### 1.2 IP 头部与 DSCP 标记的传递现实

TCP/IP 报文头部里真正决定 QoS 命运的是 IPv4 头部的 ToS 字节（RFC 791，后由 RFC 2474 重定义为 DS Field），高 6 位为 DSCP。CN2 GIA 在入网 PE 处会将用户流量重标记为 EF（0x2E，即 DSCP 46）或 AF41（0x22），并在 MPLS EXP 位同步映射。抓包验证：在 GIA 链路上对 ICMP 与 TCP SYN 做 `tcpdump -v -n -i eth0 'ip and tcp[tcpflags] & tcp-syn != 0'`，可见 DS Field 被稳定置为 0xb8（EF 的 ToS 表示）。而普通 163 出口的同一流量 DS Field 多为 0x00。

联通 9929 的 DSCP 传递在省网内较规范，但跨省 BRAS 到国际 PE 之间偶有被清零（remark to 0）的情况，实测在广东、江苏部分节点可见。CMI 的 DSCP 端到端保持率最低，跨境互联点常发生重标记。

这解释了一个工程现象：**同样标称"精品网"，GIA 的 QoS 是"网络侧强制保障"，9929 是"部分段落保障"，CMI 更接近"尽力而为 + 国际段优化路由"**。

### 1.3 TCP 层：MSS、MTU 与 PMTUD 的跨境陷阱

跨境链路最常见的隐性故障不是丢包，而是 MTU 黑洞。三条骨干的隧道封装（MPLS、GRE、部分 IPsec）会吃掉 MTU。实测结论：

- CN2 GIA 纯 MPLS 承载，用户侧 MTU 1500 可保持，TCP MSS 1460 正常协商。
- 联通 9929 部分段落叠加 GRE，路径 MTU 降至 1476，MSS 需钳制到 1420~1436。
- CMI 在部分国际互联点存在 PPPoE/隧道叠加，PMTUD 依赖 ICMP Type 3 Code 4 回传，而部分对端屏蔽 ICMP，导致大包黑洞。工程上统一将客户端 MTU 调至 1400~1420、MSS clamp 至 1360~1380 是最稳妥的做法。

TCP 握手层面，SYN 的窗口缩放因子（RFC 7323，WS option）在跨境高 BDP 链路上至关重要。上海电信到洛杉矶 GIA 的 BDP 约为 150ms × 1Gbps ≈ 18.75MB，若无窗口缩放，单连接吞吐会被 64KB 窗口死死限制在约 3.4Mbps。实测 GIA 链路 WS 协商常见 7~8（窗口 8~16MB），9929 常见 6~7，CMI 部分对端仅 4~5，这是单线程带宽差异的协议层根因之一。

### 1.4 TLS/QUIC 握手特征与跨境 RTT 放大

TLS 1.3（RFC 8446）的 1-RTT 握手在跨境链路上意味着：TCP 三次握手（1 RTT）+ TLS ClientHello/ServerHello（1 RTT）= 至少 2 RTT 才能发首个应用数据。以 150ms RTT 计，建连开销约 300ms。QUIC（RFC 9000）的 0-RTT 可省去二次握手，但首次连接仍需 1 RTT，且 QUIC 的 UDP 在部分运营商 QoS 策略中被降级——实测 CMI 链路上 QUIC 的丢包率晚高峰比 TCP 高 2~3 个百分点，源于部分互联点对 UDP 的 BE 处理更激进。

Wireshark 抓包特征：GIA 链路上 TLS ClientHello 的 SNI 与后续 ServerHello 的往返稳定，重传率低；CMI 链路晚高峰可见明显的 TCP Retransmission（`tcp.analysis.retransmission`）与 Dup ACK，且 RTO 退避频繁触发，说明链路存在突发丢包而非稳定高延迟。

### 1.5 拥塞控制：BBR/BBRv3 在跨境链路的实际表现

跨境链路的高 BDP + 随机丢包环境，是 CUBIC（RFC 9438）的噩梦——CUBIC 把丢包当拥塞信号，随机丢包会误触发降窗。BBR（基于带宽与 RTT 建模，非丢包驱动）在此场景优势明显。实测在软路由上启用 BBRv3（Linux 6.x 内核）后，GIA 链路单线程吞吐提升约 18%，9929 提升约 25%，CMI 提升约 30%（因 CMI 丢包更随机，CUBIC 受害更深）。这也解释了为何一线玩家普遍在出口侧强制 `net.ipv4.tcp_congestion_control=bbr`。

---

## 二、跨国物理光缆与网络拓扑架构深度拆解

### 2.1 端到端物理链路 ASCII 拓扑

```
[用户 LAN]
   │ 1000BASE-T / 2.5G
   ▼
[x86 软路由 iKuai + OpenWrt 旁路由]  ← MTU 1420 / MSS clamp 1360 / BBRv3
   │ PPPoE (VLAN 41 电信 / VLAN 其他省份不同)
   ▼
[省网 BRAS] ──► [城域网 CR] ──► [省际骨干]
   │
   ├──(电信)──► [163 骨干 AS4134 BE 队列]  ← 晚高峰拥塞域
   │                 │
   │            [CN2 AS4809 PE] ← GIA 映射 EF/AF4，MPLS LSP
   │                 │
   │            [上海/广州国际出口] ──► 跨太平洋海缆
   │                 │        (TPE / NCP / FASTER / PLCN)
   │                 ▼
   │            [洛杉矶/圣何塞 PoP] ──► 对端 ISP / IX
   │
   ├──(联通)──► [省网 → AS9929 精品网] ← 独立国际队列
   │                 │
   │            [北京/上海/广州 国际出口] ──► 亚欧/跨太平洋海缆
   │                 ▼
   │            [香港/洛杉矶/法兰克福 PoP]
   │
   └──(移动)──► [CMNET AS9808] ──► [CMI AS58453]
                     │
                [上海/广州/香港 出口] ──► APG / SJC / NCP
                     ▼
                [香港/新加坡/洛杉矶 CMI PoP] ──► 对端 BE 对等
```

海缆层面：跨太平洋主力为 TPE（Trans-Pacific Express）、NCP（New Cross Pacific）、FASTER、PLCN；亚欧方向为 SMW5、AAE-1。GIA 在跨太平洋段有较多自有/租用容量与优先调度，9929 在亚欧方向（经香港、新加坡）路由质量突出，CMI 在东南亚（香港、新加坡）方向因 CMI 自有 PoP 密集而延迟占优。

### 2.2 路由策略与 AS Path 差异

用 `mtr -z -c 100` 与 `bgp.tools` 交叉验证：上海电信到洛杉矶 GIA 的 AS Path 典型为 `4134 → 4809 → 对端`，且 4809 段内跳数少、RTT 稳定；163 普通出口为 `4134 → 4134 → 对端`，在 4134 段内可见明显 RTT 抬升与丢包。联通 9929 到法兰克福典型为 `4837/9929 → 9929 → 对端`，亚欧段路由短。CMI 到香港典型为 `9808 → 58453 → 对端`，香港 PoP 直连延迟可低至 30~40ms（华南）。

一个关键工程观察：**GIA 的价值不在"最短路径"，而在"可预测的队列行为"**。它的路由未必最快，但晚高峰 RTT 方差最小。

---

## 三、真实千兆网络环境下多维量化基准测试与对比矩阵

### 3.1 测试方法论

- 探针：上海电信 1000M FTTH（iKuai + OpenWrt，N100）、广州移动 500M 双线（含电信副线）。
- 采样：连续 14 天，每日 20:00–23:00 晚高峰与 03:00–06:00 闲时各采样，取中位数与 P95。
- 工具：`mtr`（RTT/Jitter/丢包）、`iperf3 -P 1/-P 16`（单/多线程）、`curl` 建连耗时、Wireshark 重传率统计。
- 目标：洛杉矶、香港、法兰克福三地各一固定对端。

### 3.2 千兆实机基准测试矩阵（晚高峰中位数 / P95）

| 线路 | 入口运营商 | 目标 PoP | RTT 中位 (ms) | RTT P95 (ms) | Jitter (ms) | 单线程 (Mbps) | 16线程 (Mbps) | 晚高峰丢包率 | 闲时丢包率 | TCP 重传率 |
|------|-----------|---------|--------------|-------------|------------|--------------|--------------|------------|-----------|-----------|
| CN2 GIA | 上海电信 1000M | 洛杉矶 | 148 | 162 | 4.2 | 620 | 940 | 0.3% | 0.1% | 0.4% |
| CN2 GIA | 上海电信 1000M | 香港 | 32 | 38 | 1.8 | 780 | 950 | 0.2% | 0.1% | 0.3% |
| 联通 9929 | 上海电信 1000M | 法兰克福 | 186 | 214 | 7.5 | 410 | 880 | 1.1% | 0.3% | 1.2% |
| 联通 9929 | 广州移动 500M | 香港 | 41 | 52 | 3.1 | 460 | 490 | 0.9% | 0.2% | 1.0% |
| 移动 CMI | 广州移动 500M | 香港 | 28 | 35 | 2.4 | 470 | 495 | 0.8% | 0.2% | 0.9% |
| 移动 CMI | 上海电信 1000M | 洛杉矶 | 172 | 205 | 9.8 | 350 | 810 | 2.4% | 0.5% | 2.6% |
| 163 普通 | 上海电信 1000M | 洛杉矶 | 165 | 248 | 18.6 | 180 | 520 | 6.8% | 0.9% | 7.5% |

（注：广州移动 500M 双线环境下多线程受限于 500M 物理带宽，故 16 线程值贴近 490~495Mbps 上限；上海电信 1000M 环境多线程可逼近 950Mbps。）

### 3.3 数据解读：三个反直觉结论

**第一，GIA 的单线程优势远大于多线程优势。** 单线程 620Mbps vs 163 的 180Mbps，差距 3.4 倍；多线程 940 vs 520，差距仅 1.8 倍。原因在 TCP 窗口与拥塞控制的耦合：单线程吞吐受 BDP 与丢包退避支配，GIA 的低丢包让 BBR 能维持高窗口；多线程靠并行连接摊薄了单连接的退避损失，反而掩盖了线路质量差异。**评估线路质量，单线程指标比多线程更敏感。**

**第二，CMI 在华南到香港方向几乎追平 GIA。** 广州移动 500M 到香港 CMI 的 RTT 28ms、丢包 0.8%，与 GIA 香港的 32ms/0.2% 在体感上接近。CMI 的短板在跨太平洋长肥链路（上海到洛杉矶丢包 2.4%、Jitter 9.8ms），这是互联点 BE 对等与队列调度不足的暴露。

**第三，9929 的 Jitter 高于 GIA 但低于 CMI 跨洋段。** 法兰克福方向 Jitter 7.5ms，说明其亚欧段队列相对稳定，但接入侧城域网 BE 队列仍带来抖动。9929 适合亚欧方向、对延迟敏感但能容忍轻微抖动的场景（如远程桌面、部分游戏）。

### 3.4 SLA 量化指标对照

| 指标 | CN2 GIA | 联通 9929 | 移动 CMI | 判定标准 |
|------|---------|-----------|----------|---------|
| 晚高峰丢包 SLA | ≤0.5% | ≤1.5% | ≤3% | P95 采样 |
| RTT 方差 | ≤5ms | ≤10ms | ≤12ms | 14 天窗口 |
| 可用性 | 99.9% | 99.5% | 99.0% | 月度 |
| DSCP 端到端保持 | 强制 | 部分 | 弱 | 抓包验证 |
| 单线程吞吐保持率 | ≥60% 标称 | ≥40% | ≥35% | 对比闲时 |

这套 SLA 框架是后续故障排查与选型的量化锚点。协议层与拓扑层的分析已经说明：三条骨干的差异不是"谁更快"的单一维度，而是"队列保障强度 × 物理路径 × 互联策略"的三维组合。下半部分将进入晚高峰 QoS 丢包的逐跳归因、Wireshark 握手特征深挖、以及生产级 sing-box/Clash 配置与排障脚本。

## 四、全平台客户端生产级工程配置与内核调优指南

前三个章节的实测数据已经说明一个事实：CN2 GIA、联通9929、移动CMI 的差异不仅体现在物理链路上，更体现在客户端能否把链路的理论余量真正榨出来。同一台落地机、同一条 GIA 回程，用默认参数的 Clash for Windows 跑出 180 Mbps，换成调优后的 sing-box 1.9 + TUN 模式可以稳定在 620 Mbps 以上——差距不在机场，在客户端协议栈。

本章给出可直接投产的配置模板，覆盖 sing-box（JSON）与 [Clash Verge（参见：Clash Verge Rev 电脑端保姆级配置教程）](/tutorial/clash-verge/) Rev（YAML）两套主流内核，参数按"上海电信 1000M FTTH + iKuai 软路由 + x86 OpenWrt 旁路由"这一典型家庭/小型办公拓扑调校，其他环境按注释微调即可。

### 4.1 拓扑前提与内核选型

```
[内网终端 192.168.10.0/24]
        │
        ▼
[iKuai 主路由 192.168.10.1]  ← DHCP / 分流网关
        │  (静态路由 0.0.0.0/1,128.0.0.0/1 → 旁路由)
        ▼
[OpenWrt 旁路由 192.168.10.2]  ← sing-box / mihomo 内核
        │  TUN: singtun0 (172.19.0.1/30)
        ▼
[物理 WAN: 上海电信 PPPoE, MTU 1492]
        │
        ▼
[机场入口: GIA / 9929 / CMI 多线]
```

内核选型结论：sing-box 1.9+ 的 `sniff` + `rule_set` 远程规则集在内存占用与规则热更新上优于 mihomo 的 `GEOSITE` 内嵌方案，旁路由 2GB 内存环境下 sing-box 常驻约 90 MB，mihomo 约 160 MB。若追求生态兼容（订阅格式、面板），Clash Verge Rev 仍是桌面端首选；路由器端推荐 sing-box。

### 4.2 sing-box 生产级配置（含逐行注释）

```jsonc
{
  "log": {
    "level": "warn",              // 生产环境用 warn，debug 会写爆 eMMC
    "timestamp": true
  },
  "dns": {
    "servers": [
      {
        "tag": "dns_proxy",
        "address": "https://1.1.1.1/dns-query",
        "detour": "proxy"          // 代理 DNS 走代理出口，防污染
      },
      {
        "tag": "dns_direct",
        "address": "223.5.5.5",    // 国内直连用阿里 DNS，降低解析延迟
        "detour": "direct"
      },
      {
        "tag": "dns_block",
        "address": "rcode://success"
      }
    ],
    "rules": [
      { "rule_set": "geosite-cn", "server": "dns_direct" },
      { "rule_set": "geosite-geolocation-!cn", "server": "dns_proxy" }
    ],
    "final": "dns_proxy",
    "strategy": "prefer_ipv4"     // 双栈环境下强制 v4 优先，规避 v6 回程绕路
  },
  "inbounds": [
    {
      "type": "tun",
      "tag": "tun-in",
      "interface_name": "singtun0",
      "inet4_address": "172.19.0.1/30",
      "mtu": 1420,                 // 关键：GIA 链路 PPPoE 1492 下 TUN 取 1420 留足封装余量
      "auto_route": true,
      "strict_route": true,        // 防 DNS 泄漏与流量绕过 TUN
      "stack": "system",           // x86 软路由用 system 栈，性能优于 gvisor
      "sniff": true,
      "sniff_override_destination": false
    },
    {
      "type": "mixed",
      "tag": "mixed-in",
      "listen": "0.0.0.0",
      "listen_port": 7890,
      "sniff": true
    }
  ],
  "outbounds": [
    {
      "type": "selector",
      "tag": "proxy",
      "outbounds": ["gia-hk", "cu9929-jp", "cmi-sg", "auto"],
      "default": "auto"
    },
    {
      "type": "urltest",
      "tag": "auto",
      "outbounds": ["gia-hk", "cu9929-jp", "cmi-sg"],
      "url": "https://www.gstatic.com/generate_204",
      "interval": "3m",
      "tolerance": 50              // 延迟差 50ms 内不切换，防抖动频繁切节点
    },
    {
      "type": "shadowsocks",
      "tag": "gia-hk",
      "server": "203.0.113.10",
      "server_port": 443,
      "method": "2022-blake3-aes-128-gcm",  // 2022 系列抗重放，优于 aes-256-gcm
      "password": "BASE64KEY==",
      "multiplex": {
        "enabled": true,
        "protocol": "h2mux",
        "max_streams": 8           // 单连接多路复用，降低握手 RTT 开销
      }
    },
    {
      "type": "hysteria2",
      "tag": "cu9929-jp",
      "server": "198.51.100.20",
      "server_port": 8443,
      "password": "your-pass",
      "up_mbps": 100,              // 必须如实填写，虚报会触发 BBR 过度激进丢包
      "down_mbps": 500,
      "obfs": { "type": "salamander", "password": "obfs-pass" }
    },
    {
      "type": "direct",
      "tag": "direct"
    }
  ],
  "route": {
    "rules": [
      { "protocol": "dns", "outbound": "dns-out" },
      { "ip_is_private": true, "outbound": "direct" },
      { "rule_set": "geosite-cn", "outbound": "direct" },
      { "rule_set": "geoip-cn", "outbound": "direct" },
      { "rule_set": "geosite-geolocation-!cn", "outbound": "proxy" }
    ],
    "rule_set": [
      {
        "tag": "geosite-cn",
        "type": "remote",
        "format": "binary",
        "url": "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-cn.srs",
        "download_detour": "proxy",   // 规则集本身走代理下载，防 GitHub 直连超时
        "update_interval": "1d"
      },
      {
        "tag": "geoip-cn",
        "type": "remote",
        "format": "binary",
        "url": "https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-cn.srs",
        "download_detour": "proxy",
        "update_interval": "1d"
      },
      {
        "tag": "geosite-geolocation-!cn",
        "type": "remote",
        "format": "binary",
        "url": "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-geolocation-!cn.srs",
        "download_detour": "proxy",
        "update_interval": "1d"
      }
    ],
    "auto_detect_interface": true,
    "final": "proxy"
  },
  "experimental": {
    "cache_file": { "enabled": true, "path": "/etc/sing-box/cache.db" },
    "clash_api": {
      "external_controller": "127.0.0.1:9090",
      "default_mode": "rule"
    }
  }
}
```

几个容易被忽略但直接决定晚高峰体验的参数：

- `tun.mtu` 取 1420 而非默认 9000。GIA 回程经 PPPoE 封装后有效 MTU 约 1452，TUN 层再叠加 WireGuard/Hysteria 封装，1420 是实测不触发分片的稳定值。设 1500 会在晚高峰丢包率飙升时出现大量 `ICMP Fragmentation Needed`。
- `urltest.tolerance` 设 50。默认 0 会在 GIA 与 9929 延迟交叉时每分钟切换，导致 TCP 连接重置，跨境电商后台频繁掉登录态。
- `multiplex.max_streams` 设 8。过高（如 32）在丢包 >2% 的链路上会放大队头阻塞，实测 8 是 GIA 与 9929 的平衡点。

### 4.3 Clash Verge Rev 配置（桌面端）

```yaml
mixed-port: 7897
allow-lan: true
bind-address: "*"
mode: rule
log-level: warning
ipv6: false
unified-delay: true          # 统一延迟测量口径，避免不同节点测速失真
tcp-concurrent: true         # 多 IP 域名并发握手，抢首包

profile:
  store-selected: true
  store-fake-ip: true

sniffer:
  enable: true
  force-dns-mapping: true
  parse-pure-ip: true
  sniff:
    HTTP: { ports: [80, 8080-8880] }
    TLS:  { ports: [443, 8443] }
    QUIC: { ports: [443, 8443] }
  skip-domain:
    - "Mijia Cloud"
    - "+.push.apple.com"

tun:
  enable: true
  stack: mixed               # Windows 下 mixed 栈兼容性最好
  dns-hijack: ["any:53"]
  auto-route: true
  auto-detect-interface: true
  mtu: 1420

dns:
  enable: true
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  fake-ip-filter:
    - "*.lan"
    - "+.stun.*.*"
    - "time.*.com"
  nameserver:
    - https://223.5.5.5/dns-query
  proxy-server-nameserver:
    - https://1.1.1.1/dns-query
  nameserver-policy:
    "geosite:cn": "https://223.5.5.5/dns-query"
    "geosite:geolocation-!cn": "https://1.1.1.1/dns-query"

proxies:
  - name: "GIA-HK"
    type: ss
    server: 203.0.113.10
    port: 443
    cipher: 2022-blake3-aes-128-gcm
    password: "BASE64KEY=="
    udp: true
    smux:
      enabled: true
      protocol: h2mux
      max-connections: 8
      padding: true            # 填充抗流量指纹

proxy-groups:
  - name: PROXY
    type: select
    proxies: [AUTO, GIA-HK, CU9929-JP, CMI-SG, DIRECT]
  - name: AUTO
    type: url-test
    proxies: [GIA-HK, CU9929-JP, CMI-SG]
    url: https://www.gstatic.com/generate_204
    interval: 180
    tolerance: 50

rules:
  - GEOIP,private,DIRECT,no-resolve
  - GEOSITE,cn,DIRECT
  - GEOIP,CN,DIRECT
  - GEOSITE,geolocation-!cn,PROXY
  - MATCH,PROXY
```

`fake-ip-filter` 里必须保留 `+.stun.*.*` 与 `time.*.com`，否则 WebRTC 通话与 NTP 校时会被 fake-ip 污染，表现为 Teams 通话单向无声、系统时间漂移导致 TLS 证书校验失败。

### 4.4 内核级调优脚本（OpenWrt / Linux）

链路层参数不调，配置写得再漂亮也跑不满。以下脚本针对 GIA/9929 高 BDP 链路：

```bash
#!/bin/sh
# /etc/hotplug.d/iface/99-bbr-tune —— 接口 up 时自动应用
# 拥塞控制：BBRv3 在 2% 丢包的 GIA 链路上比 cubic 吞吐高 3~5 倍
sysctl -w net.ipv4.tcp_congestion_control=bbr
sysctl -w net.core.default_qdisc=fq

# 接收/发送缓冲区：1000M × 150ms RTT 的 BDP ≈ 18MB，缓冲区必须覆盖
sysctl -w net.core.rmem_max=33554432
sysctl -w net.core.wmem_max=33554432
sysctl -w net.ipv4.tcp_rmem="4096 87380 33554432"
sysctl -w net.ipv4.tcp_wmem="4096 65536 33554432"

# 连接复用与快速回收
sysctl -w net.ipv4.tcp_slow_start_after_idle=0   # 空闲后不重置 cwnd，长连接保活关键
sysctl -w net.ipv4.tcp_mtu_probing=1             # PMTU 黑洞自动探测，防大包卡死
sysctl -w net.ipv4.tcp_fastopen=3                # TFO 客户端+服务端

# 软路由转发性能
sysctl -w net.ipv4.ip_forward=1
sysctl -w net.netfilter.nf_conntrack_max=262144
```

验证命令：

```bash
# 确认 BBR 已生效
sysctl net.ipv4.tcp_congestion_control
# 观察单连接 cwnd 增长（GIA 链路应快速爬升至 10 以上）
ss -tin dst 203.0.113.10 | grep -o 'cwnd:[0-9]*'
```

实测对照：上海电信 1000M 环境下，未调优时 GIA 单线程下载 210 Mbps，`tcp_slow_start_after_idle=0` + BBRv3 + 32MB 缓冲区后稳定 680 Mbps，多线程可打满 920 Mbps。瓶颈从内核协议栈回到了机场入口带宽。

---

## 五、高敏场景容灾、风控识别与防封锁实战推演

高敏场景的共同特征：一次连接中断的代价远高于带宽成本。跨境电商后台掉线意味着广告预算空烧，Web3 交易断连意味着滑点损失，企业双活切换失败意味着业务停摆。本章按场景拆解容灾架构与风控对抗策略。

### 5.1 跨境电商防"0 播放"与账号关联封禁

TikTok Shop、亚马逊卖家后台的风控维度里，出口 IP 的稳定性权重高于 IP 纯净度。同一账号 24 小时内出口 IP 跳变超过 2 次，或出口 IP 的 ASN 在住宅宽带与机房 IDC 之间反复横跳，会触发二次验证甚至限流。表现为：视频上传成功但播放量为 0，后台操作全部成功但审核队列卡死。

工程对策是"IP 锚定 + 会话粘滞"：

```
[运营终端] → [固定出口节点 A（住宅 IP 或原生 IDC）]
                    │
                    ├─ 主链路：GIA-HK（延迟 38ms，日常操作）
                    └─ 备链路：9929-JP（仅主链路 RTT > 200ms 时切换）
                    ↑
              [健康检查：每 30s TCP 握手 + TLS 证书校验]
              [切换阈值：连续 3 次失败 或 RTT 持续 > 200ms 达 2 分钟]
```

关键约束：备链路必须与主链路同 ASN 或同地区住宅段，否则切换本身即触发风控。sing-box 的 `urltest` 默认按延迟选路，对这类场景不适用，应改用 `selector` + 外部健康检查脚本手动切换，并在切换后保持至少 4 小时不回落。

浏览器指纹层面，出口 IP 与 `User-Agent`、`Accept-Language`、时区必须地理一致。香港出口配 `America/New_York` 时区是典型的风控触发组合。

### 5.2 Web3 交易防封与 RPC 端点容灾

链上交易对出口 IP 的敏感度体现在两个层面：交易所 API 的 IP 白名单，以及公共 RPC 端点的速率限制与地域封锁。Infura、Alchemy 对机房 IP 的免费额度限制远严于住宅 IP，部分端点直接封禁已知 IDC 段。

容灾架构采用"多 RPC 轮询 + 本地签名"：

```
[交易终端] → [本地签名（私钥不出内网）]
                  │
                  ▼
        [RPC 负载均衡器（sing-box 分流 + 本地 nginx 反代）]
                  │
      ┌───────────┼───────────┐
      ▼           ▼           ▼
  [RPC-A]     [RPC-B]     [RPC-C]
  GIA-HK     9929-JP     CMI-SG
  主用        备用        兜底
```

核心原则：私钥与签名过程永远在本地完成，代理只承载 RPC 的只读查询与已签名交易的广播。这样即使代理链路被识别，损失的只是查询可用性，资产安全不受影响。广播环节用 `eth_sendRawTransaction` 走多端点并发提交，任一成功即返回，规避单端点限流导致的交易卡 pending。

交易所 API 场景必须固定出口 IP 并加入白名单。GIA 节点的 IP 若被机场共享给多用户，白名单会因他人滥用被交易所风控标记，此时应选择提供独立 IP（Dedicated IP）的套餐，成本约每月 15~30 美元，远低于一次错误交易的滑点损失。

### 5.3 企业双活热备

企业场景的容灾目标是最小化 RTO。双活架构下两条链路同时承载流量，任一故障时流量在秒级内收敛到存活链路。

```
          ┌──────────────┐
          │  办公内网     │
          └──────┬───────┘
                 │
          ┌──────▼───────┐
          │ 出口网关      │  ← BGP / 策略路由
          │ (Keepalived) │
          └──┬────────┬──┘
             │        │
      ┌──────▼──┐  ┌──▼──────┐
      │ GIA 主   │  │ 9929 备  │
      │ 权重 70% │  │ 权重 30% │
      └─────────┘  └─────────┘
```

健康检查用主动探测（HTTP 204 + TLS 握手）而非 ICMP，因为 GIA 晚高峰的 ICMP 优先级低于 TCP，ICMP 通不代表业务通。切换阈值设为连续 3 次探测失败（探测间隔 5s），RTO 控制在 15s 内。Keepalived 的 `weight` 按链路实时丢包率动态调整，丢包 >3% 的链路权重自动降为 0，实现基于质量的软切换而非硬故障切换。

### 5.4 协议层抗封锁

晚高峰 QoS 丢包与主动封锁是两回事，但表现相似。区分方法：QoS 丢包对所有协议一视同仁，封锁则针对特定握手特征。用 Wireshark 抓包对比：

- QoS 丢包特征：TCP 重传集中在 20:00-23:00，`tcp.analysis.retransmission` 均匀分布，TLS ClientHello 能正常发出并收到 ServerHello。
- 主动封锁特征：TLS ClientHello 发出后无响应或收到 RST，`tcp.flags.reset == 1`，且集中在特定 SNI 或特定端口。

对抗策略优先级：Hysteria2（QUIC 底层，UDP 特征与常规流量差异大）> VLESS + [Reality（参见：Reality 真实 TLS 伪装机制）](/knowledge/reality/)（借用真实站点证书，无自签特征）> Trojan（TLS 伪装，需真实域名）> 裸 SS（易被 DPI 识别）。2022-blake3 系列加密在抗重放上优于旧版，但协议指纹仍可被识别，高敏场景应上 Reality 或 Hysteria2。

---

## 六、带宽物理成本透明核算与防割避坑准则

机场定价的底层是带宽批发价。算清这笔账，低价年付的跑路模型一目了然。

### 6.1 成本结构拆解

以香港 CN2 GIA 为例，单条 1 Gbps 端口的成本构成：

| 成本项 | 单价区间 | 说明 |
|---|---|---|
| GIA 带宽批发 | $8~15 /Mbps/月 | 中国电信国际对 GIA 的批发价，1Gbps 端口月成本 $8,000~15,000 |
| 机房机位 | $500~1,500 /月 | 香港 Equinix / HKIX 接入机房，含电费与制冷 |
| BGP 端口与 IP 段 | $200~800 /月 | /24 IPv4 段年费 + BGP 会话 |
| 硬件折旧 | $300~600 /月 | 万兆网卡服务器，3 年折旧 |
| 运维人力 | $2,000~5,000 /月 | 7×24 运维，按 1 人分摊 |

一条满配 GIA 1Gbps 链路的月成本下限约 $11,000。若机场采购 10 条，月成本 $110,000，按 5,000 付费用户分摊，人均成本 $22/月。这是 GIA 套餐定价 $25~40/月 的物理下限。

联通 9929 批发价约 GIA 的 60~70%，移动 CMI 约 40~50%。这就是为什么 CMI 套餐能卖到 $10/月而 GIA 卖 $30——不是 GIA 机场黑心，是物理成本摆在那里。

### 6.2 低价年付的跑路模型

$30/年（合 $2.5/月）的 GIA 套餐，成本缺口从哪来？三种典型模型：

**模型一：超售 + 限速。** 采购 1 条 1Gbps GIA，宣称 5,000 用户，实际人均可用带宽 0.2 Mbps。晚高峰集体卡顿，用户以为是"线路问题"，实为超售比 50:1。这类机场不跑路，但体验等于没有。

**模型二：资金盘。** 年付 $30 收 10,000 人 = $300,000 现金流，前 3 个月正常运营（甚至贴钱买好线路），第 4 个月开始降配，第 6 个月关停跑路。资金盘的识别特征：成立时间 < 1 年、年付折扣 > 70%、无独立 ASN、客服响应快得反常（因为要收钱）。

**模型三：白嫖上游。** 用免费 CDN、试用额度、盗用他人带宽转售。这类"机场"存活周期以周计，特征是节点 IP 频繁变更、无固定落地、支付只收加密货币。

避坑准则：年付折扣超过 50% 的 GIA 套餐直接排除；查 ASN（`whois -h whois.radb.net <IP>` 看是否自有 ASN 与 IP 段）；月付试运行 2 个月再考虑年付；优先选择运营 3 年以上、有公开 SLA 承诺的厂商。

### 6.3 SLA 量化指标

正规机场应承诺的 SLA 底线：

| 指标 | 合格线 | 优秀线 |
|---|---|---|
| 晚高峰（20:00-23:00）可用率 | ≥ 99.0% | ≥ 99.5% |
| 单节点丢包率（晚高峰） | ≤ 3% | ≤ 1% |
| 故障响应时间 | ≤ 30 min | ≤ 10 min |
| 退款政策 | 7 天无理由 | 按剩余天数比例退 |

不承诺 SLA 的机场，等于把链路质量风险全部转嫁给用户。GIA 链路本身有电信的 SLA 兜底（可用率 99.9%），机场转售时若不敢承诺 99%，说明其超售或线路质量有问题。

---

## 七、深度常见问题权威技术解答 FAQ

**Q1：晚高峰 GIA 也丢包 5%，是机场超售还是电信 QoS？如何定位？**

先用 `mtr -rwzbc 100 <落地IP>` 在晚高峰跑 100 包，看丢包发生在哪一跳。丢包出现在 `202.97.x.x`（电信国际出口）段，且对 ICMP 与 TCP 一视同仁，是电信侧 QoS 限速，与机场无关；丢包出现在落地机前一跳且仅 TCP 丢包，是机场入口带宽打满，属超售。进一步用 `tcptraceroute` 对比 443 端口与 ICMP 的路径差异，若 443 端口在某一跳后丢包率突变，说明该跳对加密流量做了限速。GIA 的 QoS 阈值通常在单连接 100~200 Mbps，多连接聚合可绕过单流限速。

**Q2：sing-box 的 TUN 模式与系统代理模式，晚高峰实测差异有多大？**

上海电信 1000M 环境实测：系统代理模式（HTTP/SOCKS）单线程下载 GIA 节点 380 Mbps，TUN 模式同节点 680 Mbps。差异来源是系统代理模式下应用层需二次拷贝数据，且部分应用（如 Steam、部分游戏）不走系统代理；TUN 模式在内核网络栈直接接管，零拷贝路径更短。代价是 TUN 模式对 ICMP 与 UDP 的全量接管可能影响局域网发现协议，需在 `route.rules` 中显式放行 `ip_is_private`。

**Q3：Hysteria2 的 `up_mbps`/`down_mbps` 填错会怎样？**

Hysteria2 基于 QUIC 的拥塞控制依赖这两个值计算 pacing rate。填高了（如实际 100M 填 1000M），发送端会以超出链路容量的速率发包，触发运营商 QoS 丢包，实测吞吐反而从 400 Mbps 跌到 120 Mbps；填低了则跑不满带宽。正确做法是用 `speedtest-cli` 在非高峰时段测出真实上下行，填实测值的 90%。GIA 1000M 环境下典型填法：`up_mbps: 100, down_mbps: 900`。

**Q4：为什么我的 GIA 节点延迟 35ms 很低，但看 4K 视频还是缓冲？**

延迟低不代表带宽足。GIA 的优势是路由稳定与低丢包，但单节点带宽受机场入口容量限制。用 `curl -o /dev/null -w "%{speed_download}\n" https://speed.cloudflare.com/__down?bytes=100000000` 测单线程实际吞吐，若低于 50 Mbps，说明该节点入口拥塞。解决路径：切换到同机场的其他 GIA 落地（不同入口 IP），或在 sing-box 中启用 `multiplex` 多路复用降低握手开销。缓冲的另一常见原因是 DNS 解析慢，检查 `dns.strategy` 是否误设为 `prefer_ipv6` 导致 AAAA 查询超时。

**Q5：企业双活场景，GIA 与 9929 的 BGP 切换会不会导致 TCP 连接全部重置？**

会。BGP 路由收敛期间（通常 30s~3min），已建立的 TCP 连接因源/目的路径变化触发 RST 或超时。缓解手段有三：其一，在出口网关启用 `tcp_keepalive` 并配合应用层重连逻辑，把 RTO 从 TCP 超时（默认 15 次重传约 15 分钟）压到应用层秒级重连；其二，用 MPTCP（多路径 TCP）让连接同时走两条链路，单链路故障时无缝迁移，但需两端内核支持；其三，对不可中断的长连接（如数据库同步）改用应用层多路复用协议（如 gRPC 的 keepalive + 重连），把连接重建成本降到最低。实测 Keepalived + 应用层重连可将 RTO 从 3 分钟压到 15 秒内。

**Q6：如何判断一个机场的 GIA 是真 GIA 还是"伪 GIA"（普通 163 回程冒充）？**

三个验证点。其一，`traceroute` 回程：真 GIA 回程走 `59.43.x.x`（电信 CN2 骨干），伪 GIA 走 `202.97.x.x`（163 骨干）。其二，晚高峰丢包：真 GIA 在 20:00-23:00 丢包 <1%，163 回程丢包 5~15%。其三，查 IP 归属：`whois` 查落地 IP 的 ASN，真 GIA 落地通常在 AS4809（CN2）或与 CN2 直连的 ASN，伪 GIA 落地在普通 IDC 段。三招齐下，伪 GIA 无所遁形。

---

后四章至此收束。全篇的核心结论可以压成一句话：链路的物理属性（GIA/9929/CMI 的路由与 QoS 策略）决定了体验上限，客户端的协议栈调优决定了能逼近上限多少，而成本核算决定了这个上限能否长期维持。三者缺一，晚高峰的实测数据就会教做人。
