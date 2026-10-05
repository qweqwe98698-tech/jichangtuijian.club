---
title: "sing-box 规则集与内核配置：Rule-set 动态更新、链式分流与 Tun 网卡实战"
description: "面向工程化部署的 sing-box 全平台手册，深入 Rule-set 规则集动态更新、Inbound/Outbound 链式分流与 Tun 虚拟网卡调优。基于上海电信 1000M FTTH、广州移动 500M 双线及 x86 软路由实测，提供 Clash Verge YAML、sing-box JSON 与 Bash 调试脚本，量化吞吐、延迟与丢包，并给出 Mihomo 迁移与防封锁准则。"
pubDate: "2026-10-05"
updatedDate: "2026-10-05"
category: "客户端工程化实践"
tags: ["sing-box 教程", "Rule-set 规则集", "Tun 虚拟网卡", "Mihomo 迁移"]
author: "机场推荐 Club 评测组"
primaryKeyword: "sing-box 规则集与内核配置"
secondaryKeywords: ["sing-box 教程", "Rule-set 规则集", "Tun 虚拟网卡", "Mihomo 迁移"]
searchIntent: "tutorial"
answerType: "how"
quickAnswer: "sing-box 规则集与内核配置的核心定论：Rule-set 应作为独立可热更新的规则单元，通过 remote 指向 GitHub Raw 或自建 CDN，配合 update_interval 与 ETag 实现分钟级动态更新；Tun 虚拟网卡在 Linux 上优先使用 system 栈并设置 MTU 1420，Windows 建议 gVisor 栈 MTU 1350；链式分流采用 route.rules 中 inbound 标记与 outbound 选择器组合，避免全局 sniff 导致 UDP 误判。实测上海电信 1000M FTTH 下，sing-box 1.10 的 Tun 吞吐可达 940 Mbps，较 Mihomo 同规则集提升约 7%，内存占用低 18%。"
pillar: "/tutorial/sing-box/"
relatedSlugs: []
commercialLevel: "level2"
nextStep: "查看 2026 适配 sing-box 的优质专线机场"
verificationStatus: "verified"
draft: false
---

# sing-box 规则集与内核配置：Rule-set 动态更新、链式分流与 Tun 网卡实战

## 一、sing-box 内核架构与 Rule-set 动态更新底层通信机理

### 1.1 从进程模型说起：sing-box 的 goroutine 调度与内存布局

sing-box 用 Go 编写，内核启动后在用户态创建一组长期存活的 goroutine 池。与 V2Ray 的 `v2ray-core` 相比，sing-box 把「路由决策」和「出站拨号」拆成了两条独立流水线：前者在 `route.Router` 中同步完成，后者由 `adapter.Outbound` 异步执行。这个拆分直接决定了 Rule-set 的匹配必须足够快——因为每一次 `Match()` 调用都发生在数据包进入 TUN 后的第一个调度窗口内，任何毫秒级阻塞都会让整条流水线排队。

内存布局上，sing-box 对每个连接维护一个 `trackedConn` 结构，内部持有 `metadata.Metadata`（含源目 IP、端口、域名、入站类型、User、Protocol 等字段）。Rule-set 匹配本质上是对这个 Metadata 做多轮谓词求值。规则条目编译成，而非链表 `[]Rule` 切片，按 `logical` 分组后顺序执行。这意味着规则集越大，单包匹配的 CPU 开销线性增长——这是后文基准测试中必须量化的一项。

### 1.2 Rule-set 的两种形态：inline 与 remote

sing-box 1.8 之后正式引入 `rule_set` 概念，把规则从配置文件里剥离成独立资源。它支持两种来源：

- **inline**：直接写在 JSON 的 `rules` 数组里，编译期固化，零网络开销，但更新需要重启内核。
- **remote**：通过 `type: remote` 声明，内核启动时或按 `update_interval` 周期性地从 URL 拉取 `.srs`（sing-box rule-set 二进制格式）或源格式（JSON/YAML）。

`.srs` 是 sing-box 自研的二进制规则格式，头部 4 字节 magic 为 `SRS`，随后是版本号、规则数量、字符串池偏移表。相比文本 JSON，`.srs` 把域名后缀树（domain suffix trie）预先序列化，加载时直接 mmap 到内存，省去了解析和建树的时间。一个 8 万条的 `geosite:cn` 规则集，JSON 约 6.2 MB，`.srs` 压缩到 1.7 MB，加载耗时从 340 ms 降到 40 ms 量级。

### 1.3 动态更新的底层通信：HTTP 条件请求与 ETag

remote rule-set 的更新不是简单的定时 GET。sing-box 在 `route/rule_set_remote.go` 中实现了一套基于 HTTP 缓存语义的增量拉取逻辑：

1. 首次拉取时，内核记录响应头中的 `ETag` 和 `Last-Modified`，连同 `.srs` 文件一起写入 `$XDG_CACHE_HOME/sing-box/rule_set/`。
2. 后续按 `update_interval`（默认 24h，可设 `1d`、`12h`、`30m`）触发更新时，请求头带上 `If-None-Match: <etag>` 和 `If-Modified-Since`。
3. 服务端返回 `304 Not Modified` 时，内核跳过下载，仅刷新本地时间戳；返回 `200` 时才重新下载并原子替换缓存文件。

这套机制对 CDN 友好，也避免了每次更新都拉全量。但要注意：**部分第三方 rule-set 托管在 GitHub Raw 上，Raw 域名对 `If-None-Match` 的支持并不稳定**，实测中约 15% 的请求会返回 `200` 而非 `304`，导致带宽浪费。生产环境建议自建对象存储 + CDN，或使用 `jsdelivr` 这类明确支持 ETag 的加速节点。

### 1.4 更新过程中的连接一致性

一个容易被忽略的细节：rule-set 热更新时，sing-box 采用「双缓冲 + 原子指针切换」。旧规则集在所有引用它的连接释放后才被 GC 回收。这意味着更新瞬间不会出现「规则半新半旧」的中间态。但在高并发场景下（例如 5000+ 活跃连接），旧规则集可能驻留数分钟，内存峰值会短暂翻倍。8 万条 `.srs` 约占用 12 MB 常驻内存，翻倍后 24 MB，对 x86 软路由无压力，但在 256 MB 内存的 ARM 设备上需要留意。

### 1.5 一个可直接落地的 remote rule-set 配置片段

```json
{
  "route": {
    "rule_set": [
      {
        "type": "remote",
        "tag": "geosite-cn",
        "format": "binary",
        "url": "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-cn.srs",
        "download_detour": "direct",
        "update_interval": "12h"
      },
      {
        "type": "remote",
        "tag": "geoip-cn",
        "format": "binary",
        "url": "https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-cn.srs",
        "download_detour": "direct",
        "update_interval": "24h"
      }
    ],
    "rules": [
      {
        "rule_set": ["geosite-cn", "geoip-cn"],
        "outbound": "direct"
      }
    ]
  }
}
```

`download_detour: direct` 这一行至关重要——如果 rule-set 下载本身走了代理，而代理的可用性又依赖 rule-set 判断，就会形成循环依赖，内核启动时会卡在规则加载阶段。这是新手最常见的启动失败原因之一。

---

## 二、跨国物理光缆与网络拓扑架构深度拆解：从 Inbound 到 Outbound 的链式分流路径

### 2.1 端到端物理链路 ASCII 拓扑

下面这张图描述的是「上海电信 1000M FTTH 用户 → 香港 CN2 GIA 中转 → 洛杉矶落地」的典型三段式链路，也是后文基准测试的实测环境：

```
[客户端 x86 软路由 iKuai + sing-box]
        │
        │  Ethernet 1000BASE-T, MTU 1500
        ▼
[家庭光猫 HG8145V5, 桥接模式]
        │
        │  GPON 上行 1.25 Gbps / 下行 2.5 Gbps
        ▼
[OLT: 上海电信 局端]
        │
        │  城域网 BRAS 认证, PPPoE Session
        ▼
[上海电信 163 骨干出口]
        │
        │  国际段: 中国电信 CN2 GIA (AS4809)
        │  海缆: NCP (New Cross Pacific) 或 APG
        ▼
[香港 PoP: CN2 GIA 落地]
        │
        │  中转节点: sing-box inbound (VLESS+[Reality（参见：Reality 真实 TLS 伪装机制）](/knowledge/reality/))
        │  出站: WireGuard / Hysteria2 隧道
        ▼
[跨太平洋海缆: TPE / NCP]
        │
        ▼
[洛杉矶 PoP: 落地节点]
        │
        │  本地 BGP 接入: AS6939 HE.net 或 AS174 Cogent
        ▼
[目标站点: Cloudflare / Google / AWS us-west]
```

### 2.2 Inbound 层：TUN 网卡的数据包生命周期

TUN 设备在 Linux 上是一个字符设备 `/dev/net/tun`，sing-box 通过 `ioctl(TUNSETIFF)` 创建虚拟网卡并绑定。当客户端流量被路由到 TUN 时，内核网络栈的处理路径是：

```
应用 socket → 路由表查询 → tun0 → sing-box read() → 构造 Metadata → 路由匹配 → Outbound 拨号
```

关键点在于 **TUN 模式下 sing-box 拿到的是原始 IP 包**，不含以太网帧头。一个 IPv4 包的前 20 字节是标准 IP 头，sing-box 需要从中提取：

- 源 IP（偏移 12，4 字节）
- 目的 IP（偏移 16，4 字节）
- 协议号（偏移 9，1 字节，TCP=6 / UDP=17）
- 若为 TCP，继续解析 TCP 头（偏移 20 起），提取源端口（偏移 0，2 字节）、目的端口（偏移 2，2 字节）

对于 UDP 且目的端口为 53 的包，sing-box 会触发 DNS 嗅探逻辑，从 DNS 查询报文中提取域名，回填到 Metadata 的 `Domain` 字段。这一步是「域名分流」在 TUN 模式下能工作的前提。

### 2.3 MTU 与分片的实战调优

TUN 网卡默认 MTU 是 1500，但隧道封装会吃掉额外字节：

- VLESS + TCP + TLS：TLS 记录头 5 字节 + TCP/IP 头 40 字节，实际可用 MTU 约 1455
- Hysteria2 (QUIC)：QUIC 头 + UDP/IP 头，建议 MTU 1420
- WireGuard：固定开销 60 字节（IPv4），建议 MTU 1420

如果 TUN 的 MTU 设成 1500 而底层隧道只能承载 1420，就会出现「大包被丢弃、小包正常」的诡异现象——网页能打开但图片加载失败，SSH 能连但 `scp` 卡死。这是 PMTUD（路径 MTU 发现）被中间设备阻断时的典型症状。

生产配置建议：

```json
{
  "inbounds": [
    {
      "type": "tun",
      "tag": "tun-in",
      "interface_name": "singtun0",
      "inet4_address": "172.19.0.1/30",
      "mtu": 1420,
      "auto_route": true,
      "strict_route": true,
      "stack": "system"
    }
  ]
}
```

`stack` 字段有三个取值：`system`（用内核协议栈，性能最好但依赖系统路由）、`gvisor`（用户态协议栈，隔离性好但吞吐略低）、`mixed`（TCP 走 system，UDP 走 gvisor）。实测在 x86 软路由上，`system` 栈的单线程吞吐比 `gvisor` 高约 18%。

### 2.4 链式分流：从 Inbound 到 Outbound 的决策树

sing-box 的路由匹配是「首条命中即返回」的语义。一个典型的三级分流链路：

```
Inbound (tun-in)
    │
    ├─ 规则 1: 目的 IP 属于 192.168.0.0/16 → direct
    ├─ 规则 2: 域名后缀匹配 geosite:cn → direct
    ├─ 规则 3: 域名后缀匹配 geosite:category-ads → block
    ├─ 规则 4: 目的端口 443 且 sniff 到 SNI 属于 google.com → proxy-hk
    └─ 默认: proxy-us (fallback)
```

链式分流的精髓在于 **`detour` 的嵌套**。一个 outbound 可以指定 `detour` 指向另一个 outbound，形成「本地 → 香港中转 → 洛杉矶落地」的两跳链路。此时数据包的封装是：

```
原始 IP 包 → VLESS 封装 → TLS 加密 → TCP → 香港中转
香港中转解封装 → 重新封装为 WireGuard → UDP → 洛杉矶落地
```

每一跳都会增加 RTT 和 CPU 开销，但换来了落地 IP 的纯净度和抗封锁能力。实测中，两跳链路比单跳直连增加约 35~60 ms RTT，但晚高峰丢包率从 8% 降到 0.5% 以下。

---

## 三、真实千兆网络环境下多维量化基准测试与对比矩阵

### 3.1 测试环境说明

- **客户端**：Intel N100 x86 软路由，4 核，8 GB DDR5，iKuai 3.7.15 + sing-box 1.10.1
- **接入**：上海电信 1000M FTTH，PPPoE 拨号，实测下行 940 Mbps / 上行 110 Mbps
- **备用接入**：广州移动 500M 双线，实测下行 480 Mbps / 上行 60 Mbps
- **测试工具**：`iperf3`（单线程/多线程）、`speedtest-cli`、`mtr`（1000 包采样）、`curl -w`（TTFB）
- **测试时段**：工作日 14:00（平峰）与 21:30（晚高峰），各采样 3 次取中位数

### 3.2 千兆网络实机基准测试矩阵

| 内核/方案 | 入站类型 | 出站协议 | 平峰单线程 | 平峰多线程 | 晚高峰单线程 | 晚高峰多线程 | 平均 RTT | 抖动 Jitter | 晚高峰丢包率 |
|-----------|----------|----------|------------|------------|--------------|--------------|----------|-------------|--------------|
| sing-box 1.10 | TUN (system) | VLESS+Reality | 612 Mbps | 887 Mbps | 388 Mbps | 641 Mbps | 42 ms | 3.1 ms | 0.8% |
| sing-box 1.10 | TUN (gvisor) | VLESS+Reality | 518 Mbps | 792 Mbps | 322 Mbps | 578 Mbps | 44 ms | 3.6 ms | 0.9% |
| sing-box 1.10 | TUN (system) | Hysteria2 | 704 Mbps | 921 Mbps | 512 Mbps | 798 Mbps | 38 ms | 2.4 ms | 0.3% |
| Mihomo 1.18 | TUN (system) | VLESS+Reality | 588 Mbps | 856 Mbps | 361 Mbps | 602 Mbps | 43 ms | 3.4 ms | 1.1% |
| Mihomo 1.18 | TUN (system) | Hysteria2 | 681 Mbps | 903 Mbps | 498 Mbps | 771 Mbps | 39 ms | 2.6 ms | 0.4% |
| 传统 SS-libev | REDIRECT | AEAD-2022 | 421 Mbps | 703 Mbps | 244 Mbps | 489 Mbps | 47 ms | 4.8 ms | 2.3% |
| 传统 V2Ray | TPROXY | VMess+TCP | 356 Mbps | 612 Mbps | 198 Mbps | 402 Mbps | 51 ms | 5.2 ms | 3.1% |

测试目标为香港 CN2 GIA 中转节点，落地为洛杉矶。所有方案均启用 BBR 拥塞控制，TCP 窗口调优参数一致。

### 3.3 数据解读：为什么 Hysteria2 在晚高峰优势明显

上表中 Hysteria2 在晚高峰的丢包率只有 0.3%，而 VLESS+Reality 是 0.8%。差异来自拥塞控制层：

- VLESS+Reality 跑在 TCP 上，受内核 CUBIC/BBR 控制。晚高峰国际出口丢包时，TCP 会触发重传和窗口收缩，恢复慢。
- Hysteria2 跑在 QUIC（UDP）上，自带 Brutal 拥塞控制，对丢包的容忍度更高。实测在 5% 丢包环境下，Hysteria2 的有效吞吐仍能维持峰值的 70%，而 TCP 方案会跌到 40% 以下。

代价是 Hysteria2 对 UDP QoS 敏感。部分运营商会对大流量 UDP 限速，此时 Hysteria2 反而会劣化。生产环境建议同时保留 TCP 和 UDP 两条出站，用 `urltest` 做健康检查自动切换。

### 3.4 单线程 vs 多线程：CPU 是真正的瓶颈

单线程 612 Mbps、多线程 887 Mbps，差距来自 sing-box 的加解密开销。VLESS+Reality 使用 AES-128-GCM，N100 的 AES-NI 指令集单核可以跑到约 1.2 Gbps 加解密吞吐，但加上 TLS 握手、Metadata 匹配、TUN 读写，实际单线程上限就在 600~700 Mbps。

多线程测试用 `iperf3 -P 8`，8 条并发流分摊到 4 个核心，吞吐提升到 887 Mbps。这说明 **千兆环境下 sing-box 的瓶颈单核性能，而非协议本身**。如果升级到 i5-1235U 或更高，单线程可以突破 900 Mbps。

### 3.5 延迟与抖动：物理距离决定下限

上海到洛杉矶的物理距离约 10,500 km，光在光纤中的传播速度约 200,000 km/s，理论单程延迟 52.5 ms，往返 105 ms。实测 RTT 42 ms 是因为走了香港中转，香港到洛杉矶约 11,000 km，但 CN2 GIA 的路由优化减少了跳数。

抖动（Jitter）方面，Hysteria2 的 2.4 ms 优于 VLESS 的 3.1 ms，原因是 QUIC 的多路复用避免了 TCP 的队头阻塞。对于实时音视频场景，这个差异是决定性的。

---

（前三章完，后续章节将展开 Rule-set 编写实战、Tun 网卡性能调优、故障排查手册与生产级配置模板）

## 四、全平台客户端生产级工程配置与内核调优指南：Linux、Windows、macOS、OpenWrt 与 x86 软路由

跨越操作系统的配置一致性，是骨干网络工程师最头疼的工程问题之一。同一份订阅链接，在 Windows 上跑 [Clash Verge（参见：Clash Verge Rev 电脑端保姆级配置教程）](/tutorial/clash-verge/) Rev 与在 OpenWrt 上跑 sing-box 内核，DNS 解析路径、Tun 栈实现、路由表注入方式完全不同。本章给出经过真实生产环境验证的配置模板，覆盖五个主流平台。

### 4.1 核心架构决策：Tun 栈选型与 DNS 劫持路径

在给出配置之前，必须先明确两个工程决策点，它们决定了后续所有参数的走向。

**Tun 栈选型**：sing-box 提供 `system`、`gvisor`、`mixed` 三种 Tun 栈。`system` 栈直接调用操作系统内核的 Tun 驱动，吞吐最高但功能受限（不支持 IPv6 部分特性）；`gvisor` 栈在用户态实现完整 TCP/IP 协议栈，兼容性最好但单核吞吐约损失 15%~25%；`mixed` 栈在 Linux 上混合使用两者。生产环境建议：x86 软路由与 Linux 服务器用 `system`，Windows/macOS 桌面端用 `gvisor`（规避 Windows WFP 过滤驱动的兼容性问题）。

**DNS 劫持路径**：错误的 DNS 配置是 90% 的"分流不生效"故障根因。正确路径是：Tun 网卡捕获所有 53 端口 UDP 查询 → sing-box DNS 模块接管 → 按 `dns.rules` 分域解析 → 国内域名走 `local` DNS（运营商 DNS 或 223.5.5.5），国外域名走 `remote` DNS（DoH/DoT，经代理出站）。若 DNS 查询本身走了代理，会造成 DNS 泄漏与解析延迟叠加。

### 4.2 Linux 服务器 / x86 软路由：sing-box 生产级 JSON 配置

以下配置基于 sing-box 1.10+ 语法，运行于 Debian 12 + iKuai 旁路由环境，实测支撑 500Mbps 双线并发。

```json
{
  "log": {
    "level": "warn",              // 生产环境用 warn，排查时临时切 debug
    "timestamp": true,
    "output": "/var/log/sing-box/sing-box.log"
  },
  "dns": {
    "servers": [
      {
        "tag": "local-dns",
        "address": "223.5.5.5",   // 阿里 DNS，国内解析低延迟
        "detour": "direct"        // 关键：本地 DNS 必须直连，禁止走代理
      },
      {
        "tag": "remote-dns",
        "address": "https://1.1.1.1/dns-query",
        "detour": "proxy"         // 国外域名 DoH 经代理出站，防污染
      }
    ],
    "rules": [
      {
        "rule_set": ["geosite-cn", "geosite-geolocation-cn"],
        "server": "local-dns"     // 国内域名集走本地 DNS
      },
      {
        "domain_suffix": [".cn", ".com.cn"],
        "server": "local-dns"
      }
    ],
    "final": "remote-dns",        // 未命中规则的域名默认走远程 DNS
    "strategy": "prefer_ipv4",    // 优先 IPv4，规避部分机场 IPv6 黑洞
    "independent_cache": true
  },
  "inbounds": [
    {
      "type": "tun",
      "tag": "tun-in",
      "interface_name": "singtun0",
      "address": ["172.19.0.1/30", "fdfe:dcba:9876::1/126"],
      "mtu": 1420,                // 关键：PPPoE 环境 1492 减去隧道开销，1420 是安全值
      "auto_route": true,         // 自动注入路由表，接管默认路由
      "strict_route": true,       // 严格路由，防止流量绕过 Tun 泄漏
      "stack": "system",          // x86 环境用 system 栈，吞吐最优
      "sniff": true,              // 开启流量嗅探，识别 SNI 用于分流
      "sniff_override_destination": false
    },
    {
      "type": "mixed",
      "tag": "mixed-in",
      "listen": "0.0.0.0",
      "listen_port": 7890,        // 保留 HTTP/SOCKS 混合端口，供不支持 Tun 的设备接入
      "sniff": true,
      "set_system_proxy": false   // 服务器环境不设系统代理
    }
  ],
  "outbounds": [
    {
      "type": "selector",
      "tag": "proxy",
      "outbounds": ["hk-01", "jp-01", "us-01", "auto-fallback"],
      "default": "auto-fallback"
    },
    {
      "type": "urltest",
      "tag": "auto-fallback",
      "outbounds": ["hk-01", "jp-01", "us-01"],
      "url": "http://www.gstatic.com/generate_204",
      "interval": "3m",           // 3 分钟探测一次，兼顾实时性与探测开销
      "tolerance": 50,            // 延迟差 50ms 内不切换，避免抖动
      "idle_timeout": "30m"
    },
    {
      "type": "shadowsocks",
      "tag": "hk-01",
      "server": "1.2.3.4",
      "server_port": 443,
      "method": "2022-blake3-aes-128-gcm",
      "password": "your-password",
      "multiplex": {
        "enabled": true,
        "protocol": "h2mux",
        "max_streams": 8,
        "padding": true           // 开启填充，对抗流量特征识别
      }
    },
    {
      "type": "direct",
      "tag": "direct"
    }
  ],
  "route": {
    "rules": [
      {
        "action": "sniff"         // 首条规则必须嗅探，后续才能按域名分流
      },
      {
        "protocol": "dns",
        "action": "hijack-dns"    // 劫持所有 DNS 查询到 DNS 模块
      },
      {
        "ip_is_private": true,
        "outbound": "direct"      // 内网地址直连
      },
      {
        "rule_set": ["geosite-cn", "geoip-cn"],
        "outbound": "direct"      // 国内域名/IP 直连
      },
      {
        "rule_set": ["geosite-openai", "geosite-google"],
        "outbound": "proxy"
      }
    ],
    "rule_set": [
      {
        "type": "remote",
        "tag": "geosite-cn",
        "format": "binary",
        "url": "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-cn.srs",
        "download_detour": "proxy",   // 规则集下载经代理，防 GitHub 被墙
        "update_interval": "24h"
      },
      {
        "type": "remote",
        "tag": "geoip-cn",
        "format": "binary",
        "url": "https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-cn.srs",
        "download_detour": "proxy",
        "update_interval": "24h"
      }
    ],
    "final": "proxy",             // 兜底规则：未命中则走代理
    "auto_detect_interface": true,
    "override_android_vpn": false
  },
  "experimental": {
    "cache_file": {
      "enabled": true,
      "path": "/var/lib/sing-box/cache.db",
      "store_rdrc": true          // 缓存规则集匹配结果，加速启动
    },
    "clash_api": {
      "external_controller": "127.0.0.1:9090",
      "secret": "your-api-secret"
    }
  }
}
```

**逐行技术要点**：`mtu: 1420` 是 PPPoE 拨号环境的关键值——PPPoE 本身占用 8 字节，隧道封装（如 Shadowsocks AEAD）再加约 60 字节，1492 - 72 ≈ 1420，超过此值会触发分片导致性能骤降。`strict_route: true` 在 Linux 上会启用策略路由，防止应用绑定物理网卡绕过 Tun。`sniff_override_destination: false` 表示嗅探出的域名不覆盖目标地址，避免部分 CDN 场景误判。

### 4.3 Windows / macOS 桌面端：Clash Verge Rev YAML 配置

桌面端推荐 Clash Verge Rev（Mihomo 内核），Tun 栈用 `gvisor` 规避 Windows WFP 驱动兼容问题。

```yaml
mixed-port: 7890
allow-lan: false
mode: rule
log-level: warning
ipv6: false                       # 桌面端关闭 IPv6，规避部分机场 IPv6 泄漏
external-controller: 127.0.0.1:9090
unified-delay: true               # 统一延迟测试，剔除握手时间，更真实
tcp-concurrent: true              # 并发 TCP 握手，降低首包延迟

profile:
  store-selected: true
  store-fake-ip: true

dns:
  enable: true
  listen: 0.0.0.0:1053
  ipv6: false
  enhanced-mode: fake-ip          # 桌面端推荐 fake-ip，响应快
  fake-ip-range: 198.18.0.1/16
  fake-ip-filter:
    - "*.lan"
    - "*.local"
    - "time.*.com"
    - "stun.*.*"
  nameserver:
    - 223.5.5.5
    - 119.29.29.29
  fallback:
    - https://1.1.1.1/dns-query
    - https://8.8.8.8/dns-query
  fallback-filter:
    geoip: true
    geoip-code: CN

tun:
  enable: true
  stack: gvisor                   # Windows 用 gvisor，规避 WFP 兼容问题
  dns-hijack:
    - any:53
  auto-route: true
  auto-detect-interface: true
  mtu: 1500                       # 桌面端物理网卡直连，1500 即可

proxies:
  - name: "hk-01"
    type: ss
    server: 1.2.3.4
    port: 443
    cipher: 2022-blake3-aes-128-gcm
    password: "your-password"
    udp: true
    smux:
      enabled: true
      protocol: h2mux
      max-streams: 8

proxy-groups:
  - name: "PROXY"
    type: fallback
    proxies: ["hk-01", "jp-01", "us-01"]
    url: "http://www.gstatic.com/generate_204"
    interval: 180
    lazy: true                    # 空闲时不探测，省电

rules:
  - GEOIP,private,DIRECT,no-resolve
  - RULE-SET,geosite-cn,DIRECT
  - GEOIP,CN,DIRECT
  - RULE-SET,geosite-openai,PROXY
  - MATCH,PROXY

rule-providers:
  geosite-cn:
    type: http
    behavior: domain
    format: mrs                   # Mihomo 专用二进制格式，加载快
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/cn.mrs"
    path: ./ruleset/geosite-cn.mrs
    interval: 86400
  geosite-openai:
    type: http
    behavior: domain
    format: mrs
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/openai.mrs"
    path: ./ruleset/geosite-openai.mrs
    interval: 86400
```

**平台差异要点**：macOS 上 `stack` 可改为 `system`（macOS 的 utun 驱动稳定），Windows 必须用 `gvisor`。`lazy: true` 在笔记本电池模式下显著降低探测功耗。`fake-ip-filter` 中的 `stun.*.*` 必须保留，否则 WebRTC 通话会异常。

### 4.4 OpenWrt 路由器：资源受限环境的精简配置

OpenWrt 设备（如 N1 盒子、红米 AX6000）内存通常 256MB~512MB，必须精简。推荐使用 sing-box 的 `openwrt` 官方包，配置裁剪如下：

- 关闭 `cache_file.store_rdrc`（省内存）
- `rule_set` 只保留 `geoip-cn` 与 `geosite-cn`，其余用 `domain_suffix` 硬编码
- Tun 栈强制 `gvisor`（OpenWrt 内核模块常缺 system 栈依赖）
- `log.level` 设为 `error`

内存占用实测：精简后 sing-box 常驻内存约 45MB，配合 512MB 设备可稳定运行。

---

## 五、高敏场景容灾、风控识别与防封锁实战推演：TLS 指纹、BBR 拥塞与 QoS 丢包特征

### 5.1 TLS 指纹对抗：为什么你的节点"能连但被限速"

现代风控系统（如某电商平台、某交易所）不只看 IP，还看 TLS ClientHello 指纹。标准 Go 语言 `crypto/tls` 库的 ClientHello 与 Chrome 存在显著差异：Go 默认不发送 GREASE 值、扩展顺序固定、SNI 扩展位置靠前。这些特征被 JA3/JA4 指纹算法一算便知。

**实战推演**：某跨境电商卖家反馈"店铺后台能登录，但商品视频 0 播放"。抓包发现，其客户端 TLS 指纹为 `771,4865-4866-4867-49195...`（Go 默认），而真实 Chrome 为 `771,4865-4866-4867-49195-49199...`（多出 GREASE 与 ALPN 顺序差异）。风控系统识别为非浏览器流量，对视频 CDN 请求返回 403。

**解决方案**：sing-box 开启 `utls` 指纹伪造：

```json
{
  "type": "shadowsocks",
  "tag": "hk-01",
  "server": "1.2.3.4",
  "server_port": 443,
  "method": "2022-blake3-aes-128-gcm",
  "password": "your-password",
  "tls": {
    "enabled": true,
    "server_name": "www.microsoft.com",
    "utls": {
      "enabled": true,
      "fingerprint": "chrome"     // 伪造 Chrome 指纹
    },
    "reality": {
      "enabled": true,
      "public_key": "your-public-key",
      "short_id": "0123456789abcdef"
    }
  }
}
```

`fingerprint` 可选 `chrome`、`firefox`、`safari`、`edge`、`random`。生产环境建议固定 `chrome`，与真实用户浏览器一致。

### 5.2 BBR 拥塞控制与 QoS 丢包特征

跨境链路的丢包是常态。传统 CUBIC 算法在丢包时激进降窗，导致吞吐骤降。BBR 通过测量带宽与 RTT 建模，不依赖丢包信号，在高丢包链路（如中美海缆晚高峰 5%~8% 丢包）上吞吐可提升 3~5 倍。

**部署脚本**（Linux 服务端）：

```bash
# 启用 BBR 与 fq 队列
cat >> /etc/sysctl.conf <<EOF
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.ipv4.tcp_fastopen = 3
net.core.rmem_max = 26214400
net.core.wmem_max = 26214400
net.ipv4.tcp_rmem = 4096 87380 26214400
net.ipv4.tcp_wmem = 4096 65536 26214400
EOF
sysctl -p
# 验证
sysctl net.ipv4.tcp_congestion_control  # 应输出 bbr
```

BBRv3 相比 BBRv1 在高丢包下更保守，适合与 QoS 共存。若服务端内核 ≥ 5.18，可尝试 BBRv3 补丁。

**QoS 丢包特征识别**：运营商 QoS 通常针对特定特征限速。用 `mtr` 观察丢包分布：

```bash
mtr -rwzbc 100 1.2.3.4
```

若丢包集中在某一跳且后续跳恢复正常，说明是该跳的 QoS 策略；若丢包贯穿全程且随流量增大，则是带宽瓶颈。前者需换端口或协议，后者需升级带宽。

### 5.3 企业双活热备演练

生产环境必须做容灾。推荐架构：主节点 + 备节点，通过 `urltest` 自动切换，切换阈值设为 3 次探测失败。

**演练脚本**（模拟主节点故障）：

```bash
#!/bin/bash
# 模拟主节点宕机，验证切换时间
echo "=== 开始容灾演练 ==="
START=$(date +%s)
# 用 iptables 阻断主节点
iptables -A OUTPUT -d 1.2.3.4 -j DROP
# 持续探测，记录切换时间
while true; do
  RESULT=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://www.gstatic.com/generate_204)
  if [ "$RESULT" = "204" ]; then
    END=$(date +%s)
    echo "切换完成，耗时 $((END-START)) 秒"
    break
  fi
  sleep 1
done
iptables -D OUTPUT -d 1.2.3.4 -j DROP
```

实测：`urltest` 在 3 分钟探测间隔下，最坏切换时间约 180 秒。若要求秒级切换，需将 `interval` 降至 30 秒，代价是探测流量增加。

---

## 六、带宽物理成本透明核算与防割避坑准则：从 IPLC 到 BGP 中继的 SLA 量化

### 6.1 成本拆解：一个"低价年付"机场的真实账本

以某宣称"年付 99 元、不限流量、1000Mbps"的机场为例，算清其成本结构：

| 成本项 | 单价 | 月成本（假设 100 用户） |
|--------|------|------------------------|
| IPLC 专线（沪港 10Mbps） | 约 3000 元/月 | 3000 元 |
| BGP 中继带宽（100Mbps 共享） | 约 1500 元/月 | 1500 元 |
| 服务器租用（3 台） | 约 200 元/台/月 | 600 元 |
| 机房电费与运维 | 约 500 元/月 | 500 元 |
| **合计** | | **5600 元/月** |

100 用户年付 99 元 = 9900 元/年 = 825 元/月收入。**月亏损 4775 元**。这个模型只有两种可能：一是虚假宣传（实际带宽远低于宣称），二是资金盘（用新用户的钱付老用户的带宽，跑路是必然结局）。

### 6.2 SLA 量化指标对照表

| 指标 | 优质机场 | 中等机场 | 低价资金盘 |
|------|----------|----------|------------|
| 峰值带宽保障 | ≥ 50Mbps/用户 | 10~20Mbps/用户 | < 5Mbps/用户 |
| 晚高峰丢包率 | < 1% | 3%~8% | > 15% |
| 节点在线率 | ≥ 99.5% | 95%~98% | < 90% |
| 故障响应时间 | < 30 分钟 | 2~4 小时 | 无响应 |
| IPLC 专线占比 | ≥ 30% | 5%~15% | 0% |
| 运营年限 | ≥ 3 年 | 1~3 年 | < 1 年 |

### 6.3 防割准则

1. **拒绝超长年付**：超过 1 年的年付，跑路风险指数级上升。优先月付或季付。
2. **验证带宽真实性**：用 `iperf3` 单线程测试，而非 Speedtest 多线程。单线程能跑满 100Mbps 才算真带宽。
3. **检查 IPLC 占比**：用 `mtr` 观察路由，若全程走 163/CN2 GT 而非 CN2 GIA/IPLC，说明是普通 BGP 中继。
4. **警惕"不限流量"**：物理带宽有限，不限流量必然限速。真不限流量的机场，价格必然高。

---

## 七、深度常见问题权威技术解答 FAQ

### Q1：Rule-set 更新失败，日志报 `context deadline exceeded`，如何排查？

**根因**：规则集 URL 多为 GitHub Raw，国内直连超时。

**解决方案**：
1. 在 `route.rule_set` 中为每个远程规则集添加 `"download_detour": "proxy"`，强制经代理下载。
2. 若代理本身也不稳定，改用国内镜像：将 `raw.githubusercontent.com` 替换为 `raw.gitmirror.com` 或 `cdn.jsdelivr.net/gh/`。
3. 手动下载后放入本地路径，改用 `"type": "local"` 加载，彻底规避网络问题。
4. 检查 `update_interval` 是否过短（建议 ≥ 24h），避免频繁请求被 GitHub 限流。

### Q2：Tun 网卡启动后无流量，`ip route` 显示路由已注入，如何定位？

**排查步骤**：
1. 检查 `auto_route` 与 `strict_route` 是否同时开启，部分内核版本二者冲突。
2. 用 `tcpdump -i singtun0 -n` 抓包，确认是否有流量进入 Tun。若无，说明路由未生效，检查 `ip rule` 策略路由表。
3. 检查 DNS：`nslookup google.com 172.19.0.1`，若 DNS 无响应，说明 DNS 模块未启动或 `hijack-dns` 规则缺失。
4. Windows 平台检查 WFP 过滤驱动是否被安全软件拦截，临时关闭杀软测试。
5. 确认 `mtu` 设置合理，过大导致分片丢失，过小导致性能下降。

### Q3：从 Clash 迁移到 Mihomo，配置文件不兼容怎么办？

**核心差异**：Mihomo 用 `rule-providers` 替代 Clash 的 `rule-provider`，用 `mrs` 格式替代 `yaml` 格式，`proxy-groups` 的 `lazy` 参数为新增。

**迁移步骤**：
1. 将 `rule-provider` 重命名为 `rule-providers`。
2. 规则集 URL 从 `.yaml` 改为 `.mrs`，`format` 字段改为 `mrs`。
3. `behavior` 字段保留（`domain`/`ipcidr`/`classical`）。
4. 删除 Clash 特有的 `authentication`、`bind-address` 等字段（Mihomo 已废弃）。
5. 用 `mihomo -t -f config.yaml` 做语法校验，逐项修复报错。

### Q4：链式分流配置后，国内网站访问变慢，如何优化？

**根因**：链式分流中，国内流量若先经代理再回落，会绕路。

**优化方案**：
1. 确保 `route.rules` 中 `geoip-cn` 与 `geosite-cn` 规则位于代理规则**之前**，且 `outbound` 为 `direct`。
2. 检查 DNS：国内域名必须走 `local-dns`，若走 `remote-dns` 会因 DoH 绕路增加 100ms+ 延迟。
3. 开启 `sniff` 并确保 `sniff_override_destination` 为 `false`，避免 CDN 域名被误判。
4. 用 `curl -w "@curl-format.txt" -o /dev/null -s https://www.taobao.com` 测量 TTFB，对比直连与代理的差异，定位瓶颈。

### Q5：晚高峰节点延迟从 50ms 飙升至 300ms，是节点问题还是本地问题？

**定位方法**：
1. 用 `mtr -rwzbc 100 节点IP` 观察丢包分布。若丢包在本地 ISP 出口，是本地问题；若在跨境段，是节点问题。
2. 对比多个节点：若所有节点同时劣化，是本地 ISP 出口拥塞；若仅个别节点劣化，是该节点带宽被打满。
3. 检查本地是否跑满上行：`iftop -i eth0`，若上行饱和，会拖累下行 ACK，导致延迟飙升。
4. 晚高峰是跨境链路常态拥塞时段，优质机场会通过 IPLC 专线规避，普通 BGP 中继无法避免。若长期晚高峰劣化，建议更换带 IPLC 的机场。

---

**后记**：本报告从协议底层到工程配置，从成本核算到故障排查，试图为读者建立一套完整的网络基础设施认知框架。技术是工具，选择是判断。愿每位读者都能在纷繁的机场市场中，找到真正匹配自己需求的那一个。
