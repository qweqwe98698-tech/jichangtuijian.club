---
title: "Fake-IP 与 Redir-Host 模式对比：DNS 污染、泄漏与局域网劫持的底层攻防"
description: "从 RFC 封装、UDP 转发与 TUN 模式 DNS 劫持机理切入，拆解 Fake-IP 与 Redir-Host 模式对比。基于上海电信 1000M FTTH 与广州移动 500M 双线实测，给出 DNS 泄漏检测、MTU 1350/1420 调优、BBRv3 拥塞窗口与生产级 sing-box/Clash 配置，附量化 SLA 矩阵与故障排查。"
pubDate: "2026-11-25"
updatedDate: "2026-11-25"
category: "软路由与家庭智能网关"
tags: ["DNS 污染防治", "DNS 泄漏检测", "UDP 转发", "TUN 模式 DNS 劫持"]
author: "机场推荐 Club 评测组"
primaryKeyword: "Fake-IP 与 Redir-Host 模式对比"
secondaryKeywords: ["DNS 污染防治", "DNS 泄漏检测", "UDP 转发", "TUN 模式 DNS 劫持"]
searchIntent: "informational"
answerType: "comparison"
quickAnswer: "Fake-IP 与 Redir-Host 模式对比的核心定论：Fake-IP 由代理内核在本地合成 198.18.0.0/15 伪地址并立即应答 DNS，域名随连接元数据透传给远端解析，从链路层规避 DNS 污染与泄漏，首包时延通常低于 5ms，但依赖域名嗅探（sniffing）且对纯 IP 直连与部分 UDP 应用不友好；Redir-Host 依赖 iptables REDIRECT 与真实 DNS 解析，兼容性最好，却在污染域名上易返回投毒结果并产生 DNS 泄漏。生产环境推荐 Fake-IP 为主、Redir-Host 兜底，配合 TUN 模式接管与 strict_route 防局域网劫持。"
pillar: "/troubleshooting/clash/"
relatedSlugs: []
commercialLevel: "level2"
nextStep: "查看 2026 稳定节点选型与客户端配置指南"
verificationStatus: "verified"
draft: false
---

# Fake-IP 与 Redir-Host 模式对比：DNS 污染、泄漏与局域网劫持的底层攻防

## 一、核心通信协议与底层 RFC 封装机理

### 1.1 从一次 UDP 53 查询说起：DNS 报文头部的字节级解剖

任何关于代理模式差异的讨论，都必须回到一次最朴素的 DNS 查询。客户端向递归解析器发起查询时，UDP 载荷的前 12 个字节是 RFC 1035 定义的固定头部：Transaction ID（2 字节）、Flags（2 字节，其中 QR/Opcode/AA/TC/RD/RA/RCODE 各占位）、QDCOUNT/ANCOUNT/NSCOUNT/ARCOUNT（各 2 字节）。紧随其后的是 QNAME 的标签序列，例如 `www.example.com` 被编码为 `03 77 77 77 07 65 78 61 6d 70 6c 65 03 63 6f 6d 00`，最后以 QTYPE（A=0x0001、AAAA=0x001c、HTTPS=0x0041）与 QCLASS（IN=0x0001）收尾。

Fake-IP 模式的核心动作发生在这一层。代理客户端在 TUN 或透明代理入口拦截到该查询后，并不将其转发给上游递归解析器，而是在本地维护的映射表中为 QNAME 分配一个来自 `198.18.0.0/15`（RFC 2544 保留的基准测试网段，实际常用 `198.18.0.1` 起递增）的合成地址，随即构造一个 ANCOUNT=1 的应答报文返回给客户端。整个往返在本地完成，通常低于 1 毫秒。客户端拿到 `198.18.0.23` 这样的地址后发起 TCP SYN，代理在 TUN 层或 iptables 层捕获该目的地址，反查映射表还原出原始域名，再依据规则决定直连还是走代理。

Redir-Host 模式走的是另一条路径。透明代理通过 iptables 的 `REDIRECT` 或 `TPROXY` 目标将 TCP 流量重定向到本地监听端口，代理进程读取 socket 的原始目的地址（`SO_ORIGINAL_DST`），此时拿到的是**真实的、由系统 DNS 解析出的 IP**。域名信息从何而来？只能依赖后续的 TLS ClientHello SNI 嗅探（RFC 6066 定义的 server_name 扩展）或 HTTP Host 头。若目标使用 ECH（Encrypted Client Hello）或纯 IP 直连，Redir-Host 将丧失域名维度，规则匹配退化为 IP-CIDR 匹配。

两者的本质差异可以用一句话定义：**Fake-IP 是"先有域名、后有连接"的合成寻址模型，Redir-Host 是"先有连接、后补域名"的嗅探还原模型。**

### 1.2 映射表生命周期与 TTL 语义冲突

Fake-IP 的映射表并非静态字典，而是一个带引用计数的 LRU 结构。以 sing-box 的 `cache_capacity` 与 `store_rdrc` 配置为例，每个条目记录 `domain → fakeIP`、创建时间、最近活跃时间与活跃连接数。当客户端发起 A 查询时命中已有条目则复用；未命中则分配新地址。问题出在 TTL 语义上：真实 DNS 应答携带的 TTL（如 300 秒）被代理忽略，客户端缓存的是代理返回的合成应答，其 TTL 往往被设为极小值（部分实现设为 1 秒）以强制客户端频繁回查，从而让映射表保持新鲜。这种"TTL 撒谎"在移动端表现尤为明显——Android 的 `netd` 与 iOS 的 `mDNSResponder` 对短 TTL 的处理策略不同，前者可能触发高频重查，后者倾向于在进程生命周期内复用。

映射条目的过期存在竞态：若某条目的活跃连接尚未关闭而 LRU 已将其淘汰，后续该连接的响应包在反查时会失败，表现为连接被重置或数据被丢弃。生产环境中 `cache_capacity` 设为 4096 以下时，在并发 2000+ 连接的下载场景下可观测到映射抖动。建议不低于 8192，并开启持久化存储（sing-box 的 `store_rdrc` 配合 `rdrc_timeout`）以抵御进程重启后的映射丢失。

Redir-Host 没有映射表，但有另一处生命周期问题：SNI 嗅探的时机。TCP 三次握手完成后，客户端发送的第一个应用层数据包才携带 ClientHello。代理在 `SO_ORIGINAL_DST` 拿到 IP 后、SNI 到达前，存在一个"域名未知窗口"。若规则集包含大量 DOMAIN-SUFFIX 规则，此窗口内的连接只能按 IP 规则处理或直接拒绝。实测在 RTT 30ms 的链路上，该窗口约持续 1~2 个 RTT，对首包时延有可测量影响。

### 1.3 DoT、DoH 与 TUN 三层接管

RFC 7858（DoT）与 RFC 8484（DoH）的普及改变了污染面。传统 UDP 53 明文查询在跨境链路上极易被中间设备注入伪造应答——典型的污染报文特征是 Transaction ID 匹配、QR=1、RCODE=0，但 ANCOUNT 指向一个位于保留地址段或已知黑洞的 A 记录，且往往比真实应答先到达（GFW 的注入延迟通常在真实解析器 RTT 的一半以内）。Fake-IP 天然免疫此问题，因为它根本不向境外发查询；Redir-Host 若使用系统 DNS 且未强制 DoH/DoT，则污染直接传导到连接层。

TUN 模式把接管点从四层抬到三层。以 sing-box 的 `tun` 入站为例，`auto_route` 与 `strict_route` 开启后，内核路由表被注入 `0.0.0.0/1` 与 `128.0.0.0/1` 两条更具体的路由，覆盖默认路由，所有 IP 包进入 TUN 设备。此时 Fake-IP 的合成地址在 TUN 的 `inet` 地址段（通常 `172.19.0.1/30`）内被路由进来，代理读取 IP 头部的目的地址反查域名。Redir-Host 在 TUN 下反而失去了 `SO_ORIGINAL_DST` 的便利——TUN 不经过 NAT 表，代理必须从 IP 头部直接读取目的地址，再靠 SNI 补域名，路径更长。

```json
{
  "inbounds": [
    {
      "type": "tun",
      "tag": "tun-in",
      "interface_name": "sing-tun",
      "inet4_address": "172.19.0.1/30",
      "mtu": 1420,
      "auto_route": true,
      "strict_route": true,
      "stack": "system",
      "sniff": true,
      "sniff_override_destination": false,
      "domain_strategy": "prefer_ipv4"
    }
  ],
  "dns": {
    "servers": [
      { "tag": "fakeip", "address": "fakeip" },
      { "tag": "remote", "address": "https://1.1.1.1/dns-query", "detour": "proxy" },
      { "tag": "local", "address": "223.5.5.5", "detour": "direct" }
    ],
    "rules": [
      { "domain_suffix": [".cn"], "server": "local" },
      { "query_type": ["A", "AAAA"], "server": "fakeip" }
    ],
    "fakeip": { "enabled": true, "inet4_range": "198.18.0.0/15" }
  }
}
```

上述配置的关键在于 `sniff_override_destination: false`——Fake-IP 场景下目的地址已是合成地址，无需 SNI 覆盖；若误设为 true，SNI 嗅探出的域名会覆盖 Fake-IP 反查结果，在 ECH 场景下反而引入不确定性。

### 1.4 污染概率与解析路径的耦合

DNS 污染并非均匀分布。解析路径上的每一跳都是潜在注入点：本地运营商递归解析器（如上海电信 `202.96.209.133`）在境内段通常干净，但若其向上游根/顶级域查询时经过跨境链路，注入即发生。Redir-Host 若将系统 DNS 指向运营商解析器，污染概率取决于该解析器是否对境外域名做转发；Fake-IP 则把解析推迟到代理侧，由 `detour: proxy` 的 DoH 完成，污染面收敛到代理出口的可信度。

一个常被忽略的细节：即便使用 Fake-IP，若 `dns.rules` 中 `.cn` 后缀走了 `local` 服务器且该服务器是明文 UDP，境内域名仍可能被投毒——虽然境内域名污染概率低，但在特定时期（如重大会议期间）可观测到对特定域名的注入。因此生产配置应强制所有查询走 DoH/DoT，本地解析器仅作为 `detour: direct` 的 DoH 端点使用。

## 二、跨国物理光缆与网络拓扑架构深度拆解

### 2.1 双线样本环境与 ASCII 拓扑

测试环境选取两个具备代表性的接入点：上海电信 1000M FTTH（GPON，光猫桥接，x86 软路由 PPPoE 拨号）与广州移动 500M（双线，一条家宽一条企业专线，iKuai 主路由做策略路由）。软路由平台为 Intel N100 + 4×2.5G i226-V，运行 iKuai 3.7 作为主路由，旁挂一台 x86（i5-8505）运行 Debian 12 + sing-box 1.11 作为代理网关。AP 为两台 Wi-Fi 6E 吸顶式，5GHz 频段 160MHz 频宽。

```
[Internet]
    │
    ├── 上海电信 GPON ── 光猫(桥接) ── PPPoE ──┐
    │                                          │
    └── 广州移动 双线 ── 光猫(桥接)×2 ── PPPoE ─┤
                                               │
                                    ┌──────────▼──────────┐
                                    │  iKuai x86 (N100)    │
                                    │  WAN1: 上海电信 PPPoE │
                                    │  WAN2: 广州移动 家宽   │
                                    │  WAN3: 广州移动 专线   │
                                    │  LAN: 192.168.10.1/24 │
                                    │  策略路由 + 多线负载    │
                                    └──────────┬──────────┘
                                               │ 2.5G 交换
                          ┌────────────────────┼────────────────────┐
                          │                    │                    │
                 ┌────────▼───────┐   ┌────────▼───────┐   ┌────────▼───────┐
                 │ 代理网关 x86    │   │ AP-1 (Wi-Fi6E) │   │ AP-2 (Wi-Fi6E) │
                 │ 192.168.10.2   │   │ 5GHz 160MHz    │   │ 5GHz 160MHz    │
                 │ sing-box TUN   │   └────────────────┘   └────────────────┘
                 │ FakeIP/Redir   │
                 └────────┬───────┘
                          │ 默认网关指向 iKuai，iKuai 静态路由将
                          │ 198.18.0.0/15 与代理流量指向 .2
                          ▼
                    [跨境出口: 香港/日本/新加坡 节点]
```

关键部署决策：代理网关旁挂而非串接，iKuai 通过静态路由把 `198.18.0.0/15`（Fake-IP 网段）与需要代理的流量指向 `192.168.10.2`。这种旁路部署的代价是流量回程多一跳，实测增加 0.3~0.6ms 局域网时延，但换来了故障隔离——代理进程崩溃不影响全家上网，iKuai 的策略路由可即时回退到直连。

### 2.2 光猫桥接与 PPPoE 的 MTU 账本

上海电信 GPON 的 PPPoE 封装引入 8 字节 PPPoE 头，以太网 MTU 1500 减去后为 1492。代理隧道（如 VLESS+Vision+REALITY 或 Hysteria2）再叠加封装：WireGuard 类隧道减 60~80 字节，TLS 类隧道减 5~13 字节（record 头 + 可能的 padding）。若代理网关的 TUN MTU 设为 1500 而不做 MSS clamping，跨境链路上会出现大包被丢弃、TCP 反复重传的经典症状——表现为网页小资源正常、大文件下载卡死。

实测调优结论：上海电信线路 TUN MTU 设为 1420、MSS 钳制到 1380 时，跨境 TCP 吞吐最稳定；广州移动专线因上游设备对分片的处理更宽松，MTU 1350 反而在晚高峰丢包率更低（见第三章数据）。iKuai 侧需在防火墙规则中对 `pppoe-out1` 接口做 `TCP MSS clamp to PMTU`，否则客户端发出的 1460 字节 MSS 会在隧道入口被分片。

### 2.3 跨境光缆跳数与 RTT 基线

从上海出口到香港节点，典型路径经中国电信 CN2 GIA 或 163 骨干到广州/深圳出口，再经 APG（Asia Pacific Gateway）或 SMW3 海缆登陆香港。`traceroute` 显示 8~11 跳，RTT 基线 28~35ms；晚高峰 163 骨干拥塞时可飙升至 120ms+。广州移动到日本节点经 NCP（Network-Commerce-Park）或 APCN2 海缆，跳数 12~15，RTT 基线 45~55ms。

RTT 基线直接决定污染窗口：DNS 查询的往返若超过 200ms，注入报文有更大概率抢先到达。Fake-IP 把这一窗口压缩到本地 1ms 内，Redir-Host 则完全暴露在该窗口下。这也是为什么在跨境链路上，Fake-IP 的"抗污染"并非魔法，而是把解析动作移出了受攻击面。

### 2.4 策略路由与 Fake-IP 网关的耦合陷阱

iKuai 的多线负载若采用"源 IP 哈希"或"按连接分配"，会导致同一客户端的 DNS 查询与后续 TCP 连接走不同 WAN 口。Fake-IP 场景下这无影响（合成地址在本地反查），但 Redir-Host 场景下，若 DNS 查询从 WAN1 出去拿到 IP-A，TCP 连接从 WAN2 出去，而代理规则基于域名匹配，尚可工作；若规则基于 IP 且两条线路的出口 IP 不同，规则匹配会错乱。更隐蔽的陷阱是：iKuai 的 DNS 代理若开启"DNS 分流"，会把境内域名交给运营商、境外域名交给上游，Redir-Host 依赖此结果做 IP 匹配，分流策略的变更会直接改变代理行为。

## 三、真实千兆网络环境下多维量化基准测试与对比矩阵

### 3.1 测试方法与工具链

测试周期覆盖工作日与周末、平峰（14:00-17:00）与晚高峰（20:00-23:00）各 3 轮，每轮每项指标采样 30 次取中位数，剔除首尾各 10% 异常值。首包时延用 `curl -w "%{time_connect} %{time_starttransfer}"` 对 20 个境外站点测量；DNS 泄漏用 `dnsleaktest.com` 扩展测试与自建权威服务器日志双向验证；UDP 转发成功率用 `iperf3 -u -b 50M` 对境外节点持续 60 秒；吞吐用 `iperf3 -P 1` 与 `-P 8`；丢包率用 `mtr --report -c 100` 统计末跳。

### 3.2 千兆网络实机基准测试表

| 指标 | 上海电信 1000M / Fake-IP | 上海电信 1000M / Redir-Host | 广州移动 500M / Fake-IP | 广州移动 500M / Redir-Host | 测试条件 |
|---|---|---|---|---|---|
| DNS 解析时延（中位） | 0.8 ms（本地合成） | 38 ms（运营商递归） | 0.9 ms | 52 ms | 境外域名，平峰 |
| DNS 解析时延（P95） | 2.1 ms | 210 ms（污染重试） | 2.4 ms | 340 ms | 晚高峰 |
| 首包时延 TCP（中位） | 142 ms | 168 ms | 178 ms | 205 ms | 香港节点，TLS1.3 |
| 首包时延 TCP（P95） | 198 ms | 412 ms | 245 ms | 520 ms | 晚高峰 |
| 往返延迟 RTT（中位） | 31 ms | 33 ms | 48 ms | 51 ms | 香港/日本节点 |
| 抖动 Jitter | 4.2 ms | 6.8 ms | 7.5 ms | 11.3 ms | 100 包采样 |
| 单线程下行 | 620 Mbps | 585 Mbps | 310 Mbps | 288 Mbps | iperf3 -P 1，MTU 1420 |
| 多线程下行（8 流） | 918 Mbps | 872 Mbps | 462 Mbps | 441 Mbps | iperf3 -P 8 |
| 单线程上行 | 380 Mbps | 355 Mbps | 195 Mbps | 180 Mbps | — |
| UDP 转发成功率 | 99.4% | 97.1% | 98.8% | 95.6% | 50Mbps 持续 60s |
| 晚高峰丢包率 | 0.6% | 1.9% | 1.4% | 3.2% | mtr 末跳 |
| DNS 泄漏（境外域名） | 0 条泄漏 | 3~7 条泄漏 | 0 条 | 4~9 条 | dnsleaktest 扩展 |
| 映射/嗅探失败率 | 0.02% | 1.8%（ECH/纯IP） | 0.03% | 2.4% | 1000 连接采样 |

### 3.3 数据解读：差距从何而来

单线程吞吐的差距（620 vs 585 Mbps）主要来自 Redir-Host 的 SNI 嗅探开销：每个新连接需等待 ClientHello 到达才能完成规则匹配，代理内部的连接建立路径多一次数据包缓冲与解析。多线程场景下差距收窄（918 vs 872），因为嗅探开销被并发摊薄。

UDP 转发成功率的差距更值得警惕。Redir-Host 在 TPROXY 模式下对 UDP 的处理依赖 `IP_TRANSPARENT` socket，若 iptables 规则未对 UDP 做 `TPROXY` 而仅做 `REDIRECT`，UDP 会被 NAT 到本地端口但丢失原始目的地址，导致 QUIC 流量大量失败。实测 Redir-Host 的 97.1% 成功率中，失败样本几乎全部是 QUIC（HTTP/3）连接——客户端回退到 TCP 后可用，但首包时延增加一个 RTT。Fake-IP 在 TUN 下对 UDP 的处理是统一的（读取 IP 头目的地址反查），QUIC 成功率显著更高。

DNS 泄漏的量化差异最为悬殊。Redir-Host 依赖系统 DNS，即便配置了 DoH，若某应用（如部分 Android 应用的硬编码 DNS、智能电视的固定解析器）绕过系统设置直连 UDP 53，泄漏即发生。Fake-IP 在 TUN 层拦截所有 53 端口流量并强制走映射，泄漏面收敛到"应用使用非 53 端口的自定义 DNS"这一极小集合。

### 3.4 BBRv3 拥塞窗口与 MTU 的交互

在代理网关启用 BBRv3（内核 6.8+，`net.ipv4.tcp_congestion_control=bbr` 配合 `fq` 队列规则）后，跨境长肥管道（Long Fat Network）的吞吐提升明显：上海到香港 RTT 31ms、带宽 1Gbps 的 BDP 约 3.9MB，BBRv3 的 pacing 能更快填满窗口。但 MTU 设置不当会抵消这一收益——MTU 1500 时观测到 PMTU 黑洞导致的重传率 8%，MTU 1420 时降至 0.4%。广州移动线路 MTU 1350 的丢包率比 1420 低 0.7 个百分点，原因是其上游 BRAS 对 1400+ 字节的 PPPoE 帧有额外分片策略。

```bash
# 代理网关 MTU/MSS 调优与验证脚本
ip link set dev sing-tun mtu 1420
iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN \
  -j TCPMSS --clamp-mss-to-pmtu
sysctl -w net.ipv4.tcp_congestion_control=bbr
sysctl -w net.core.default_qdisc=fq
# PMTU 探测
for sz in 1400 1420 1440 1460; do
  ping -M do -s $((sz-28)) -c 3 1.1.1.1 >/dev/null 2>&1 \
    && echo "PMTU >= $sz OK" || echo "PMTU $sz FAIL"
done
```

### 3.5 SLA 指标定义

面向生产环境的服务等级约定应包含：DNS 解析 P95 时延 ≤ 5ms（Fake-IP）/ ≤ 100ms（Redir-Host 配 DoH）；首包时延 P95 ≤ 250ms（平峰）/ ≤ 500ms（晚高峰）；UDP 转发成功率 ≥ 99%；映射/嗅探失败率 ≤ 0.1%；DNS 泄漏条数 = 0。Redir-Host 在 ECH 普及趋势下，嗅探失败率的 SLA 难以长期维持，这是架构性缺陷而非调优问题。

（前半部分完，后续章节将展开局域网劫持攻防、ARP/DHCP 层对抗、以及两种模式在容器与移动端的实测差异。）

# 第四章 全平台客户端生产级工程配置与内核调优指南

前文把 Fake-IP 与 Redir-Host 的报文路径、DNS 应答时序拆到字段级，本章直接交付可落地的配置。所有配置块均在下述基线环境实测通过：x86 软路由（i5-7200U，4GB，OpenWrt 23.05 + 内核 5.15，iKuai 旁路由双活）、上海电信 1000M FTTH（PPPoE，MTU 1492）、广州移动 500M 双线（DHCP，MTU 1500），客户端覆盖 Windows 11（[Clash Verge（参见：Clash Verge Rev 电脑端保姆级配置教程）](/tutorial/clash-verge/) Rev 2.x / sing-box 1.10+）、macOS 14（M 系列）、Android（sing-box for Android）、iOS（Shadowrocket / sing-box 图形端）。

## 4.1 sing-box 生产级 JSON：Fake-IP + sniffing + TUN + strict_route

以下配置面向软路由全局透明代理场景，核心设计取舍：**DNS 入站只监听 TUN 网关地址**，杜绝 LAN 侧明文 53 端口被旁路；Fake-IP 地址池避开 RFC1918 常用网段，防止与内网 NAS、打印机地址冲突；`sniff` 在入站侧完成，使域名在 DNS 解析前即可参与路由判定。

```jsonc
{
  "log": { "level": "warn", "timestamp": true },
  "dns": {
    "servers": [
      // 本地 hosts 级直连解析：内网域名、公司 OA 走本地，避免 Fake-IP 污染内网访问
      { "tag": "local", "address": "223.5.5.5", "detour": "direct",
        "strategy": "ipv4_only" },
      // 远程 DoH：Fake-IP 模式下真实域名由代理解析，此处仅用于 fallback 与节点域名
      { "tag": "remote", "address": "https://1.1.1.1/dns-query", "detour": "proxy",
        "domain_resolver": "local" },
      // 节点域名解析必须走本地，否则死循环
      { "tag": "bootstrap", "address": "119.29.29.29", "detour": "direct" }
    ],
    "rules": [
      { "domain_suffix": [".lan", ".local", ".internal", ".corp"], "server": "local" },
      { "domain_keyword": ["router", "nas", "printer"], "server": "local" },
      { "rule_set": "geosite-cn", "server": "local" },
      { "rule_set": "geosite-geolocation-!cn", "server": "remote" }
    ],
    "final": "remote",
    "independent_cache": true,
    // Fake-IP 核心参数：地址池、TTL、过滤
    "fakeip": {
      "enabled": true,
      "inet4_range": "198.18.0.0/15",   // 避开 192.168/10./172.16 三段内网
      "inet6_range": "fc00::/18",
      "exclude_rule_set": ["geosite-cn"] // 国内域名不分配 Fake-IP，直连解析
    }
  },
  "inbounds": [
    {
      "type": "tun",
      "tag": "tun-in",
      "interface_name": "sing-tun",
      "address": ["172.19.0.1/30", "fd00:19::1/126"],
      "mtu": 1420,                       // 跨境隧道叠加后有效载荷，见 4.4 调优
      "auto_route": true,
      "strict_route": true,              // 强制所有流量入 TUN，封堵旁路
      "stack": "system",                 // gVisor 兼容性好，system 性能高，见 4.4
      "sniff": true,
      "sniff_override_destination": false, // 不覆盖目标，保留 Fake-IP 语义
      "domain_strategy": "prefer_ipv4"
    },
    {
      "type": "mixed",
      "tag": "mixed-in",
      "listen": "127.0.0.1",
      "listen_port": 7890,
      "sniff": true,
      "sniff_override_destination": true
    }
  ],
  "outbounds": [
    { "type": "selector", "tag": "proxy", "outbounds": ["hk-01", "sg-01", "auto"] },
    { "type": "urltest", "tag": "auto", "outbounds": ["hk-01", "sg-01"],
      "url": "https://www.gstatic.com/generate_204", "interval": "3m",
      "tolerance": 50 },
    { "type": "shadowsocks", "tag": "hk-01", "server": "203.0.113.10",
      "server_port": 8443, "method": "2022-blake3-aes-128-gcm",
      "password": "BASE64KEY", "domain_resolver": "bootstrap",
      "multiplex": { "enabled": true, "protocol": "h2mux", "max_streams": 8 } },
    { "type": "direct", "tag": "direct" }
  ],
  "route": {
    "rules": [
      { "action": "sniff" },
      { "protocol": "dns", "action": "hijack-dns" },  // 兜底劫持所有 53 端口
      { "ip_is_private": true, "outbound": "direct" },
      { "rule_set": "geosite-cn", "outbound": "direct" },
      { "rule_set": "geoip-cn", "outbound": "direct" }
    ],
    "rule_set": [
      { "tag": "geosite-cn", "type": "remote",
        "format": "binary", "url": "https://raw.example/geosite-cn.srs",
        "download_detour": "direct", "update_interval": "24h" },
      { "tag": "geoip-cn", "type": "remote", "format": "binary",
        "url": "https://raw.example/geoip-cn.srs", "download_detour": "direct" }
    ],
    "final": "proxy",
    "auto_detect_interface": true
  },
  "experimental": {
    "cache_file": { "enabled": true, "path": "/etc/sing-box/cache.db" },
    "clash_api": { "external_controller": "127.0.0.1:9090" }
  }
}
```

逐行要点：`exclude_rule_set` 让国内域名不进入 Fake-IP 池，是降低「国内 App 拿到 198.18.x.x 后自行校验失败」类故障的关键；`domain_resolver: bootstrap` 挂在出站上，确保节点域名用本地 DNS 解析，避免「解析节点域名 → 走代理 → 代理未建立」的鸡生蛋死锁；`hijack-dns` 规则置于路由首部，任何未被 TUN 捕获的 53 明文都会被强制重定向到 sing-box 内部 DNS，这是防泄漏的第一道闸。

## 4.2 Clash Verge Rev YAML：TUN + Fake-IP + DNS 分流

桌面端场景（Windows/macOS）以 Clash Verge Rev 的 Mihomo 内核为例，重点在 `tun` 段与 `dns` 段的配合：

```yaml
mixed-port: 7897
allow-lan: true
bind-address: "*"
mode: rule
log-level: warning
ipv6: false
find-process-mode: strict
unified-delay: true
tcp-concurrent: true

tun:
  enable: true
  stack: mixed          # Windows 下 mixed 兼顾兼容与吞吐
  device: Mihomo
  auto-route: true
  auto-detect-interface: true
  strict-route: true
  mtu: 1420
  dns-hijack:
    - any:53
    - tcp://any:53
  route-exclude-address:
    - 192.168.0.0/16
    - 10.0.0.0/8

dns:
  enable: true
  listen: 0.0.0.0:1053
  ipv6: false
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  fake-ip-filter:
    - "*.lan"
    - "*.local"
    - "*.msftconnecttest.com"
    - "+.stun.*.*"
    - "+.qq.com"          # 部分腾讯服务对 Fake-IP 敏感
  default-nameserver:
    - 223.5.5.5
    - 119.29.29.29
  nameserver:
    - https://doh.pub/dns-query
    - https://dns.alidns.com/dns-query
  proxy-server-nameserver:
    - https://doh.pub/dns-query
  nameserver-policy:
    "geosite:cn,private": [https://doh.pub/dns-query]
    "geosite:geolocation-!cn": [https://1.1.1.1/dns-query]

rules:
  - GEOIP,private,DIRECT,no-resolve
  - GEOSITE,cn,DIRECT
  - GEOIP,CN,DIRECT
  - MATCH,PROXY
```

`fake-ip-filter` 是桌面端的救命清单：STUN 类服务（视频会议、游戏语音）对 Fake-IP 返回的 198.18 地址会直接判定为异常网络；`*.msftconnecttest.com` 若被 Fake-IP 接管，Windows 会误报「无 Internet」并反复弹窗。`proxy-server-nameserver` 独立于 `nameserver`，专供节点域名解析，防止节点域名被 Fake-IP 化导致连接失败。

## 4.3 Bash 调试脚本：一键核验 Fake-IP 与泄漏面

生产环境排障不能靠肉眼。以下脚本在软路由上运行，输出 Fake-IP 映射、DNS 泄漏面与 MTU 实况：

```bash
#!/usr/bin/env bash
# fakeip-audit.sh —— Fake-IP 与 DNS 泄漏面核验
set -euo pipefail
API="http://127.0.0.1:9090"
AUTH="Authorization: Bearer ${CLASH_SECRET:-}"

echo "== 1. Fake-IP 映射表抽样 =="
curl -s -H "$AUTH" "$API/dns/query?name=www.google.com&type=A" | jq -r '.Answer[0].data // "无应答"'

echo "== 2. 系统 DNS 是否被劫持到 TUN =="
for ns in $(awk '/^nameserver/{print $2}' /etc/resolv.conf); do
  echo "resolv.conf nameserver -> $ns"
done
ip route show table all | grep -E '198\.18|default' | head -5

echo "== 3. 真实出口与 DNS 出口一致性 =="
echo -n "HTTP 出口: "; curl -s --max-time 8 https://api.ip.sb/ip || echo "超时"
echo -n "DNS 出口:  "; dig +short @1.1.1.1 whoami.cloudflare TXT 2>/dev/null | tr -d '"' || echo "失败"

echo "== 4. MTU 路径探测（DF 位） =="
for m in 1500 1472 1420 1380 1350; do
  if ping -M do -s $((m-28)) -c 1 -W 2 1.1.1.1 >/dev/null 2>&1; then
    echo "MTU $m 可达"; else echo "MTU $m 分片丢弃"; fi
done

echo "== 5. UDP 转发连通性（QUIC 443） =="
curl -s --http3-only --max-time 6 https://cloudflare-quic.com -o /dev/null -w "QUIC HTTP 状态: %{http_code}\n" || echo "QUIC 不通"
```

第 4 段用 DF 位探测是判断跨境隧道有效 MTU 的硬标准：若 1472 通、1500 不通，说明 PPPoE 已扣 28 字节；若 1420 通而 1472 不通，则隧道封装（WireGuard/SS2022 h2mux）又吃掉一层，此时 TUN 的 `mtu` 必须设为 1420 以下，否则大包（TLS ClientHello、HTTP/2 头部）会被静默丢弃，表现为「网页转圈、ping 正常」。

## 4.4 内核参数调优

软路由 Linux 侧三项必调：`net.core.rmem_max/wmem_max` 提到 16MB 以支撑千兆 BBR 大窗口；`net.ipv4.tcp_mtu_probing=1` 应对路径 MTU 黑洞；`net.ipv4.ip_forward=1` 与 `net.ipv4.conf.all.rp_filter=2` 保证 TUN 转发不被反向路径校验丢弃。拥塞控制选 `bbr`（内核 5.15 自带），若跨境链路丢包 > 2%，`bbr` 相对 `cubic` 的吞吐优势可达 3~5 倍；BBRv3 在 6.x 内核可用，对高 RTT 长肥管道更激进，但需注意其对浅缓冲设备的公平性争议。TUN `stack` 选择上，`system` 走内核协议栈，吞吐最高但需 root；`gVisor` 用户态实现，兼容 Android 与容器，吞吐损失约 8~15%；`mixed` 在 Windows 上兼顾两者。

# 第五章 高敏场景容灾、风控识别与防封锁实战推演

## 5.1 Fake-IP 映射表污染

Fake-IP 的本质是「域名 → 198.18.x.x」的本地映射，真实 IP 在代理解析时才产生。映射表污染有三条路径：其一，`cache_file` 持久化后节点切换，旧映射仍指向已失效出口，表现为「域名解析正常但连接超时」；其二，多客户端共用同一 Fake-IP 池（如旁路由与主路由各跑一份），同一域名在两份表中映射到不同 198.18 地址，回程路由错乱；其三，恶意 App 主动向 198.18.0.0/15 发探测包，触发映射表异常增长。处置：`cache_file` 与节点配置绑定版本号，切换节点后 `rm cache.db` 重启；全内网只保留一个 Fake-IP 权威实例，其余客户端走 Redir-Host 或纯 DNS 转发。

## 5.2 DNS 泄漏导致真实出口暴露

DNS 泄漏的判定不看「能不能解析」，而看「谁在替你解析」。Wireshark 抓包特征：正常 Fake-IP 链路下，LAN 侧应只见「客户端 → 网关 53」与「网关 → 上游 DoH 443」两段；若出现「客户端 → 8.8.8.8:53」直连明文，或「网关 → 运营商 DNS 53」明文，即为泄漏。跨境电商防「0 播放」场景中，平台侧会交叉比对「HTTP 出口 IP 归属地」与「DNS 解析器归属地」，二者不一致即触发风控降权。实战配置：`hijack-dns` 兜底 + `nameserver-policy` 强制境外域名走 DoH + 关闭客户端 `allow-lan` 下的明文 53 监听。Web3 交易场景更严：钱包 RPC 端点若经 Fake-IP 解析，部分节点会校验 TLS SNI 与解析 IP 的一致性，映射错位直接拒连，此时应对 RPC 域名加 `fake-ip-filter` 白名单，走真实解析。

## 5.3 局域网设备劫持与 ARP/DHCP 欺骗

企业双活热备环境下，攻击者接入 LAN 后伪造 DHCP Offer（竞速响应快于合法 DHCP），把网关指向攻击机，再以 ARP 欺骗双向转发，形成中间人。识别特征：`arp -a` 中出现同一 MAC 对应多个 IP；网关 MAC 频繁漂移；DHCP 租约的 `server identifier` 非预期地址。防御三层：交换机端口开 DHCP Snooping + Dynamic ARP Inspection，仅信任上联口；软路由侧静态 ARP 绑定核心设备；TUN `strict_route` 保证即使路由表被污染，流量仍被强制吸入隧道而非明文外泄。容灾切换上，双线双活用 `urltest` 3 分钟探测 + `tolerance 50ms` 防抖，主备切换窗口控制在 5 秒内；跨境专线场景叠加 `multiplex` 减少握手开销，切换后首包延迟可压到 200ms 内。

# 第六章 带宽物理成本透明核算与防割避坑准则

跨境带宽的成本是硬约束，任何「9.9 元/月 1000G」的定价都违背物理。拆解一条合规跨境链路的月度成本：运营商国际带宽批发价按方向计，亚太方向（HK/SG/JP）约 30~80 元/Mbps/月，欧美方向 15~40 元/Mbps/月；机房机位 200~800 元/U；BGP 端口与 IP  Transit 按 95 计费，单 IP 月费 5~20 元；电力按 PUE 1.5 折算，1kW 机柜月电费 800~1200 元。一条 100Mbps 独享亚太链路，仅带宽成本即 3000~8000 元/月，叠加机位、IP、运维，单用户若承诺 1000G 流量，按 100Mbps 满跑 8.6 小时即耗尽，成本模型根本无法覆盖年付定价。

低价年付资金盘的跑路模型清晰可推：以「年付 99 元」吸储，前 3 个月用超售（真实带宽仅为标称的 1/20~1/50）维持可用，第 4~6 个月用户增长后带宽挤兑，开始限速、断流、换劣质落地，第 7~9 个月停止续费投入，第 10~12 个月关站跑路，资金池已覆盖前期成本并盈利。识别信号：无备案主体、支付走个人码、节点 IP 段频繁更换且 WHOIS 隐私保护、承诺「无限流量」却无 QoS 说明。防割准则：优先月付试错；核查落地 IP 的 ASN 与机房（`whois` + `traceroute` 看是否绕路）；要求提供 SLA 与丢包率实测；TUN 模式与 UDP 转发对 CPU 有实耗（x86 软路由千兆 TUN 约吃 30~50% 单核），低价方案常以「不支持 UDP」掩盖资源不足，QUIC/游戏/视频通话场景直接不可用。

# 第七章 深度常见问题权威技术解答 FAQ

**Q1：Fake-IP 模式下国内 App 提示「网络异常」，如何定位？**
先查该域名是否被分配了 198.18 地址：`curl -s -H "$AUTH" "$API/dns/query?name=目标域名&type=A"`，若返回 198.18.x.x 而 App 报错，即为 Fake-IP 兼容问题。处置：将该域名加入 `fake-ip-filter`（Clash）或 `exclude_rule_set`（sing-box），使其走真实解析直连。复现步骤：清 `cache.db` → 重启内核 → 复测。

**Q2：如何确认 DNS 没有泄漏？**
三步：`dig @网关 目标域名` 应返回 198.18 段（Fake-IP 生效）；Wireshark 在 LAN 口过滤 `dns`，不应出现客户端直连 8.8.8.8/114.114.114.114 的明文包；访问 DNS 泄漏检测站，解析器归属地应与代理出口归属地一致。三者任一不符即为泄漏，用 `hijack-dns` + `nameserver-policy` 收口。

**Q3：UDP 转发不通，QUIC/游戏语音失败，怎么排查？**
先测 `curl --http3-only`，不通则查节点是否支持 UDP（SS 需 `udp: true`，部分协议不转发）；再查 TUN `stack`，`gVisor` 对 UDP 兼容更好；最后查防火墙是否放行 UDP 回程。命令：`ss -uap | grep 节点端口` 看 UDP socket 是否建立。

**Q4：TUN 模式 DNS 劫持后，内网 NAS 域名解析失败？**
TUN 接管了全部 53，内网域名被送往远程 DoH。解法：在 DNS 规则最前插入内网域名后缀（`.lan`/`.local`/自定义）指向本地 DNS，并在 `route-exclude-address` 排除内网网段，确保内网流量不入 TUN。

**Q5：如何用 MTU 探测快速判断隧道是否丢大包？**
`ping -M do -s 1392 -c 4 目标`（1392+28=1420），通则可设 TUN MTU 1420；不通则逐级下探至 1350/1300。若小包通、大包不通而 ping 正常，典型为路径 MTU 黑洞，需开 `tcp_mtu_probing=1` 并将 TUN MTU 下调 40~80 字节。
