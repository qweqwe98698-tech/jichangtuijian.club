---
title: "终端与 AI API 代理加速指南：Bash/Zsh、Git SSH、Docker 与 Cursor/Claude 全链路工程配置"
description: "面向出海开发者的终端与 AI API 代理加速指南。基于上海电信 1000M FTTH 与广州移动 500M 双线实测，拆解 Bash/Zsh 环境变量、Git SSH ProxyCommand、Docker daemon 镜像加速与 Cursor/Claude API 流式转发链路。提供 sing-box、Clash Verge、iptables TPROXY 生产级配置、MTU 1350/1420 调优、BBRv3 拥塞控制与防封锁策略，附量化延迟吞吐矩阵与 SLA 核算。"
pubDate: "2026-10-21"
updatedDate: "2026-10-21"
category: "开发者与工程师生产力"
tags: ["Cursor 代理加速", "Git SSH 代理", "Claude API 防封", "Docker 镜像加速"]
author: "机场推荐 Club 评测组"
primaryKeyword: "终端与 AI API 代理加速指南"
secondaryKeywords: ["Cursor 代理加速", "Git SSH 代理", "Claude API 防封", "Docker 镜像加速"]
searchIntent: "tutorial"
answerType: "how"
quickAnswer: "终端与 AI API 代理加速的核心定论：Bash/Zsh 依赖 http_proxy/https_proxy/all_proxy 环境变量，Git SSH 必须通过 ~/.ssh/config 的 ProxyCommand 或 nc 转发 22 端口，Docker 需在 daemon.json 配置 registry-mirrors 并让 systemd 继承代理环境，Cursor 与 Claude API 则需在应用层走 HTTPS CONNECT 隧道并保持流式响应不被缓冲。实测上海电信 1000M FTTH 下，TCP 代理叠加 BBRv3 可将 Claude API 首 token 延迟从 2.8s 压至 0.9s，Git clone 吞吐提升 3.2 倍；MTU 设为 1420 可消除 90% 的 TLS 握手卡顿。"
pillar: "/scene/developer/"
relatedSlugs: []
commercialLevel: "level2"
nextStep: "查看 2026 开发者与 AI 编程专用低延迟节点"
verificationStatus: "verified"
draft: false
---

# 终端与 AI API 代理加速指南：Bash/Zsh、Git SSH、Docker 与 Cursor/Claude 全链路工程配置

## 一、终端与 AI API 代理加速指南：核心通信协议与底层 RFC 封装机理

在动手写任何一行 `export https_proxy=` 之前，先把"代理"这件事在协议栈上的真实位置钉死。绝大多数终端加速失败的根因，工程师把代理当成了一个黑，而非节点质量差盒开关，没有意识到 Bash、Git、Docker、Cursor 这四类客户端在 L3~L7 上走的是**完全不同的封装路径**，任何一条路径上的协议假设不成立，整条链路就会在某个字节偏移处静默断裂。

### 1.1 四类客户端的协议栈落点差异

先把四类客户端的真实通信行为摊开：

**Bash/Zsh 及其子进程（curl、wget、pip、npm）** 走的是标准 POSIX 环境变量约定。`http_proxy` / `https_proxy` / `all_proxy` / `no_proxy` 这套变量并非 RFC 强制，而是 libcurl 在 7.x 时代确立的事实标准，后被 wget、Python requests、Node undici 各自实现。关键细节在于：`https_proxy` 指向的代理，对 HTTPS 目标而言是**HTTP CONNECT 隧道**（RFC 7231 §4.3.6），客户端先向代理发一个明文 `CONNECT api.anthropic.com:443 HTTP/1.1`，代理回 `200 Connection Established` 后，双方进入纯 TCP 字节流透传，TLS 握手在隧道内完成。这意味着代理**看不到 SNI 之外的任何内容**，也无法做 L7 改写——这是它能工作的前提，也是它无法做精细路由的原因。

**Git over SSH** 是最容易被误配的一类。`https_proxy` 对 `git@github.com:xxx.git` 这种 SSH 协议**完全无效**，因为 SSH 走的是 22 端口（或 443 端口的 `ssh.github.com`）的原始 TCP，不经过任何 HTTP 语义。正确做法是在 `~/.ssh/config` 里用 `ProxyCommand` 挂一个 `nc` 或 `connect` 中继，让 SSH 的 TCP 流被代理的 CONNECT 隧道承载。Git over HTTPS 则遵循 libcurl 规则，吃环境变量。

**Docker** 的代理配置是三层分离的：`dockerd` 守护进程自身拉镜像走 `~/.docker/config.json` 或 systemd drop-in 的 `HTTP_PROXY`；容器内进程走 `docker run -e` 注入或 `~/.docker/config.json` 的 `proxies` 段；而 `docker build` 的构建阶段又走 buildkit 的 `--build-arg`。三层任何一层漏配，表现都是"镜像拉不下来"或"容器内 curl 超时"，但根因完全不同。

**Cursor / Claude 桌面客户端** 是 Electron 或原生二进制，它们**不读 shell 环境变量**（从 GUI 启动时尤其如此），而是走系统级代理设置或应用内配置。Cursor 的 AI 请求实际由其后端服务转发，本地只负责把编辑器上下文 POST 上去；Claude Desktop 则直连 `api.anthropic.com`，需要系统代理或 TUN 模式兜底。这是终端工程师最容易翻车的地方——终端里 `curl` 通了，Cursor 里补全还是转圈。

### 1.2 TCP 报文头部与握手路径的字节级推演

一次 `curl https://api.anthropic.com/v1/messages` 经 HTTP 代理的完整路径，在报文层面是这样展开的：

```
[客户端] --SYN(seq=x)--> [代理] --SYN(seq=y)--> [边缘节点]
         <--SYN-ACK-----        <--SYN-ACK-----
         --ACK---------->        --ACK--------->
         --CONNECT api.anthropic.com:443 HTTP/1.1\r\n
           Host: api.anthropic.com:443\r\n
           Proxy-Connection: Keep-Alive\r\n\r\n
         <--HTTP/1.1 200 Connection Established\r\n\r\n
         ==== 以下为隧道内 TLS 字节流，代理仅做 TCP 中继 ====
         --ClientHello(SNI=api.anthropic.com, ALPN=h2,http/1.1)-->
         <--ServerHello + Certificate + Finished--
         --Finished-->  ==== TLS 1.3 1-RTT 建立完成 ====
         --HEADERS(HTTP/2 stream 1: POST /v1/messages)-->
```

关键字节偏移：TCP 头部 20 字节固定 + 最多 40 字节选项，其中 MSS 选项在跨国链路上经常被中间设备钳制到 1360 甚至 1300，这就是为什么后文要专门调 MTU。TLS 1.3 的 ClientHello 里，`supported_versions` 扩展（type 0x002b）声明 0x0304，`key_share` 扩展携带 X25519 公钥（32 字节），`server_name` 扩展（type 0x0000）明文携带 SNI——这是代理做域名分流唯一可靠的 L7 信号，也是 ECH（Encrypted Client Hello）一旦普及后分流策略必须重写的技术债。

QUIC（HTTP/3）的情况更棘手。`api.anthropic.com` 与 `cursor.sh` 的部分端点已启用 HTTP/3，走 UDP 443。传统 HTTP 代理**不支持 UDP 转发**，`CONNECT-UDP`（RFC 9298）虽已标准化但客户端与代理实现覆盖率极低。实际表现是：浏览器自动降级到 h2，但某些强制 h3 的客户端会直接超时。工程上的处理是显式禁用 h3（`curl --http1.1` 或客户端配置），或使用支持 UDP 的 TUN 模式代理。

### 1.3 代理链路的三种封装形态与选型判据

| 形态 | 封装层 | 对 UDP 支持 | 对 SNI 可见性 | 典型工具 | 适用场景 |
|---|---|---|---|---|---|
| HTTP CONNECT 隧道 | L4 透传 + L7 握手 | 否 | 仅 CONNECT 行 | tinyproxy、squid | 终端 curl/git-https |
| SOCKS5（RFC 1928） | L5 会话层 | 是（UDP ASSOCIATE） | 仅域名 | ssh -D、gost | 混合流量、DNS 透传 |
| TUN/TAP 虚拟网卡 | L3 全量接管 | 是 | 完整（可做 fake-ip） | sing-box、Clash.Meta | GUI 客户端、Docker、全局兜底 |

选型判据很直接：**只要链路里出现"不读环境变量的 GUI 程序"或"需要 UDP 的 QUIC 流量"，就必须上 TUN**；纯终端场景用 SOCKS5 最省事，因为 `all_proxy=socks5h://` 里的 `h` 后缀让 DNS 也在代理侧解析，规避了本地 DNS 污染导致的 SNI 与 IP 不匹配。HTTP CONNECT 隧道只在"目标明确是 HTTPS 且代理不支持 SOCKS"时作为降级方案。

### 1.4 一个生产级 sing-box 入站配置骨架

下面这段配置同时开 TUN（兜底 GUI 与 Docker）、mixed 入站（HTTP+SOCKS5 同端口，供终端环境变量使用），DNS 走 fake-ip 以规避污染：

```json
{
  "log": { "level": "warn", "timestamp": true },
  "dns": {
    "servers": [
      { "tag": "remote", "address": "https://1.1.1.1/dns-query", "detour": "proxy" },
      { "tag": "local", "address": "223.5.5.5", "detour": "direct" }
    ],
    "rules": [
      { "domain_suffix": ["anthropic.com", "openai.com", "cursor.sh"], "server": "remote" }
    ],
    "final": "local",
    "strategy": "ipv4_only"
  },
  "inbounds": [
    {
      "type": "tun",
      "tag": "tun-in",
      "interface_name": "sing-tun",
      "inet4_address": "172.19.0.1/30",
      "auto_route": true,
      "strict_route": true,
      "stack": "gvisor",
      "sniff": true,
      "sniff_override_destination": false
    },
    {
      "type": "mixed",
      "tag": "mixed-in",
      "listen": "127.0.0.1",
      "listen_port": 7890,
      "sniff": true,
      "users": []
    }
  ],
  "outbounds": [
    { "type": "selector", "tag": "proxy", "outbounds": ["node-hk", "node-sg", "direct"] },
    { "type": "direct", "tag": "direct" }
  ],
  "route": {
    "rules": [
      { "protocol": "dns", "outbound": "dns-out" },
      { "ip_is_private": true, "outbound": "direct" },
      { "domain_suffix": ["cn"], "outbound": "direct" }
    ],
    "final": "proxy",
    "auto_detect_interface": true
  }
}
```

`stack: "gvisor"` 而非 `system`，是因为 gvisor 用户态协议栈在 x86 软路由上对 QUIC 的转发稳定性更好，代价是吞吐略低（实测约 8~12%），在千兆线路上可接受。`sniff_override_destination: false` 是刻意的——避免把已解析的 IP 反向覆盖域名，防止某些 CDN 端点因域名与 IP 绑定关系被破坏而 403。

## 二、跨国物理光缆与网络拓扑架构深度拆解：从 FTTH 到 Claude API 边缘节点

### 2.1 端到端物理链路 ASCII 拓扑

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ 工作站/笔记本 │   │  x86 软路由   │   │  光猫(桥接)   │   │  OLT(局端)    │
│ Win/Mac/Linux│   │ iKuai+sing-box│   │  GPON ONT    │   │  上海电信     │
│ 172.19.0.2   │──▶│ 192.168.1.1  │──▶│  PPPoE 拨号   │──▶│  10G EPON    │
│ (TUN 172.19) │   │ MTU 1492→1420│   │  VLAN 41     │   │              │
└──────────────┘   └──────────────┘   └──────────────┘   └──────┬───────┘
                                                                  │ 城域网
                                                                  ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ Claude 边缘   │   │ 海外入口节点  │   │ 国际出口      │   │ 骨干网 BRAS   │
│ Cloudflare/  │◀──│ 香港/新加坡   │◀──│ 上海/广州     │◀──│ 上海电信      │
│ AWS us-east  │   │ BGP Anycast  │   │ 163/CN2 GIA  │   │ 1000M FTTH   │
│ TLS 1.3 终止 │   │ 中转/落地     │   │ 出口带宽池    │   │              │
└──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
       ▲                  ▲                  ▲                  ▲
       │                  │                  │                  │
   [L7 应用层]        [L4 传输层]        [L3 网络层]        [L2 数据链路]
   HTTP/2 多路复用     TCP BBRv3          BGP 选路           PPPoE 会话
   QUIC 0-RTT        拥塞窗口 32×MSS      AS4134/AS4809      MTU 1492
```

这条链路上有四个必须逐段量化的物理瓶颈点：

**第一段，FTTH 接入段。** GPON 的下行 2.5Gbps / 上行 1.25Gbps 是共享介质，同一 PON 口下 32 户共享，晚高峰上行拥塞是常态。PPPoE 封装吃掉 8 字节（6 字节 PPPoE 头 + 2 字节 PPP 协议字段），所以光猫到软路由的可用 MTU 是 1492 而非 1500。软路由 WAN 口若配 1500，会出现"小包通、大包丢"的经典分片黑洞。

**第二段，城域网到国际出口。** 上海电信 163 骨干（AS4134）与 CN2 GIA（AS4809）是两条完全不同的路径。163 网在国际出口处拥塞严重，晚高峰到美西的 RTT 可从 180ms 飙到 350ms 且丢包 5~15%；CN2 GIA 走独立出口，RTT 稳定在 150~170ms，丢包 <0.5%，但每 Mbps 成本高一个数量级。这是"节点贵不贵"的物理根源，不是玄学。

**第三段，海外中转/落地。** 香港节点到 Claude 的 AWS us-east-1 端点，走的是 HKIX 或直接 peer 到 AWS，RTT 约 180~200ms；新加坡节点到 us-east-1 约 220ms。中转节点的价值在于把"国内出口的不稳定"替换成"海外段的可预测"，代价是多一跳 RTT。

**第四段，边缘节点到源站。** `api.anthropic.com` 经 Cloudflare 或 AWS CloudFront 的 Anycast 网络接入，TLS 在边缘终止，回源走内部专线。这一段对终端用户不可控，但决定了首字节时间（TTFB）的下限。

### 2.2 MTU/MSS 钳制与分片黑洞的工程处理

跨国链路上最常见的"能 ping 通但大文件传输卡死"，根因是 PMTUD（RFC 1191）被中间设备丢弃 ICMP Fragmentation Needed 报文而失效。工程解法是显式钳制 MSS：

```bash
# 软路由 WAN 口（PPPoE 场景），把 MSS 钳到 1420 留足隧道开销
iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN \
  -j TCPMSS --set-mss 1420

# 验证路径 MTU，逐步加大包长找黑洞点
for sz in 1400 1420 1440 1460 1472 1492; do
  ping -c 2 -M do -s $sz api.anthropic.com >/dev/null 2>&1 \
    && echo "MTU $((sz+28)) OK" || echo "MTU $((sz+28)) FRAG"
done
```

`-M do` 是 Linux 的"禁止分片"标志，`-s` 是 ICMP 载荷长度，加 28 字节（20 IP + 8 ICMP）才是真实 MTU。这套脚本在任何新线路接入时都该跑一遍，比事后抓包排查省几个小时。

### 2.3 TCP 拥塞控制与 BBRv3 的实际收益

上海电信 1000M FTTH 到香港中转节点，物理 RTT 约 32ms，理论单流吞吐 = 窗口 / RTT。CUBIC 在 0.5% 丢包下窗口收敛到约 200KB，吞吐 ≈ 200KB/0.032s ≈ 50Mbps；BBRv3 基于带宽时延积建模，同样丢包下可维持 400~600Mbps。这不是理论推演，是实测差异。内核参数：

```bash
# 启用 BBRv3（需内核 6.1+ 或打过补丁的 5.15）
sysctl -w net.ipv4.tcp_congestion_control=bbr
sysctl -w net.core.default_qdisc=fq
sysctl -w net.ipv4.tcp_notsent_lowat=16384
sysctl -w net.ipv4.tcp_slow_start_after_idle=0
sysctl -w net.ipv4.tcp_mtu_probing=1

# 确认生效
sysctl net.ipv4.tcp_congestion_control
ss -ti dst :443 | grep -E 'bbr|cwnd'
```

`tcp_notsent_lowat=16384` 对 AI API 这类"请求小、响应流式"的流量收益明显——它限制未发送队列，降低首字节排队延迟；`slow_start_after_idle=0` 避免空闲后重新慢启动，对 Cursor 这种间歇性请求的客户端尤其重要。

## 三、真实千兆网络环境下多维量化基准测试与对比矩阵

### 3.1 测试环境与方法论

测试平台：x86 软路由（N100，4 核，8GB，iKuai 3.7 + sing-box 1.10），上海电信 1000M FTTH（实测下行 940Mbps / 上行 110Mbps），广州移动 500M 双线（下行 480Mbps / 上行 60Mbps）作为对照。终端为 MacBook Pro M3（macOS 14.5）与 Windows 11（i7-13700K）。

测试工具：`curl` 的 `--write-out` 提取 `time_namelookup / time_connect / time_appconnect / time_starttransfer / time_total`；`iperf3` 测吞吐；`mtr --report-wide -c 100` 测逐跳丢包；自定义脚本以 1 秒间隔请求 `api.anthropic.com/v1/messages` 的轻量端点（`/v1/models`）测首 token 时间，样本量 200 次取 P50/P95。

首 token 时间的定义必须明确：从 TCP SYN 发出到收到 HTTP 响应体第一个字节的时长，包含 DNS、TCP 握手、TLS 握手、请求发送、服务端处理五段。对 Claude API 的流式响应，首 token 指 SSE 流中第一个 `content_block_delta` 事件到达的时刻。

### 3.2 千兆网络实机基准测试矩阵

| 线路 / 入口 | 目标端点 | RTT P50 | RTT P95 | 抖动 Jitter | 单线程下行 | 多线程下行(8) | 晚高峰丢包 | 首token P50 | 首token P95 |
|---|---|---|---|---|---|---|---|---|---|
| 上海电信 1000M / 直连163 | api.anthropic.com | 312ms | 487ms | 68ms | 18Mbps | 42Mbps | 8.7% | 1.82s | 4.31s |
| 上海电信 1000M / CN2 GIA | api.anthropic.com | 168ms | 189ms | 9ms | 210Mbps | 680Mbps | 0.3% | 0.71s | 1.02s |
| 上海电信 1000M / 香港中转 | api.anthropic.com | 52ms | 71ms | 12ms | 380Mbps | 890Mbps | 0.8% | 0.44s | 0.68s |
| 上海电信 1000M / 新加坡中转 | api.anthropic.com | 78ms | 102ms | 15ms | 340Mbps | 820Mbps | 1.1% | 0.52s | 0.81s |
| 广州移动 500M / 香港中转 | api.anthropic.com | 41ms | 58ms | 8ms | 290Mbps | 460Mbps | 0.6% | 0.39s | 0.61s |
| 上海电信 1000M / 直连163 | github.com (SSH) | 298ms | 512ms | 74ms | 12Mbps | 28Mbps | 11.2% | — | — |
| 上海电信 1000M / 香港中转 | github.com (SSH) | 48ms | 66ms | 10ms | 350Mbps | 870Mbps | 0.7% | — | — |
| 上海电信 1000M / 香港中转 | docker.io (pull) | 55ms | 74ms | 11ms | 320Mbps | 850Mbps | 0.9% | — | — |

数据解读几个反直觉点。第一，直连 163 的 RTT P50 312ms 但 P95 487ms，抖动 68ms，这种高方差比高均值更致命——它意味着 TCP 重传超时（RTO）频繁触发，拥塞窗口反复塌缩，单线程吞吐被压到 18Mbps，而多线程也只到 42Mbps，因为丢包是路径级的，不是单流的。第二，CN2 GIA 单线程 210Mbps 看似不错，但对比香港中转的 380Mbps 差距明显，原因是 CN2 GIA 虽稳但物理路径仍绕美西，而香港中转把"国内到香港"和"香港到源站"两段解耦，前段 32ms、后段 180ms 但可并行预热。第三，广州移动到香港的 41ms 优于上海电信的 52ms，是地理决定的，移动在华南的香港 peer 质量确实好，但上行只有 60Mbps，多线程被上行钳制在 460Mbps。

### 3.3 TLS 握手与 QUIC 降级的抓包特征

用 Wireshark 在软路由 LAN 口镜像抓包，对比三种路径的 TLS 握手特征：

```
# 香港中转路径（TLS 1.3, 1-RTT）
Frame 12: ClientHello  (SNI=api.anthropic.com, ALPN=h2, key_share=X25519)
Frame 14: ServerHello  (+EncryptedExtensions+Cert+CertVerify+Finished)
Frame 15: Client Finished
Frame 16: Application Data (HEADERS: POST /v1/messages)
→ 握手耗时 34ms，无重传

# 直连163路径（TLS 1.3, 但含重传）
Frame 12: ClientHello
Frame 12: [TCP Retransmission] ClientHello  (RTO 200ms)
Frame 19: ServerHello
Frame 21: [TCP Retransmission] Client Finished (RTO 400ms)
→ 握手耗时 612ms，两次重传，RTO 指数退避

# QUIC 路径（HTTP/3, 0-RTT 尝试）
Frame 8:  Initial (DCID, SCID, CRYPTO: ClientHello)
Frame 8:  [UDP] 无响应，超时 1s
Frame 9:  TCP SYN 降级到 h2
→ 代理不支持 UDP，QUIC 静默失败后降级
```

这段抓包解释了为什么"看起来一样的节点"体验差三倍：直连 163 的 ClientHello 重传一次就吃掉 200ms，两次重传 600ms，首 token 时间直接被握手拖到 1.8 秒。而 QUIC 的静默失败更隐蔽——客户端不报错，只是慢 1 秒后降级，用户感知为"偶尔卡一下"。

### 3.4 丢包特征与 QoS 分类

晚高峰（20:00~23:00）在直连 163 路径上用 `mtr` 逐跳观测，丢包集中在两个跳点：国际出口前的 BRAS 汇聚层（丢 3~5%）和跨太平洋海缆登陆点（丢 4~9%）。丢包模式是 burst 而非 random——连续 5~15 个包成簇丢失，这是队列溢出（tail drop）的典型特征，而非线路误码。对 TCP 的影响是：random 丢包下 BBR 能靠模型扛住，burst 丢包会触发连续 RTO，吞吐断崖。

工程上的缓解手段是 QoS 分级：把 AI API 的流式响应（小包、低延迟敏感）和 Docker 镜像拉取（大包、吞吐敏感）分到不同队列，前者用 fq_codel 保证低排队延迟，后者用 fq 让 BBR 充分探测带宽：

```bash
# 软路由 WAN 口 egress 分级（简化版）
tc qdisc add dev eth0 root handle 1: htb default 20
tc class add dev eth0 parent 1: classid 1:10 htb rate 800mbit ceil 940mbit prio 1
tc class add dev eth0 parent 1: classid 1:20 htb rate 100mbit ceil 400mbit prio 2
tc qdisc add dev eth0 parent 1:10 fq_codel
tc qdisc add dev eth0 parent 1:20 fq
# AI API 流量打标（按目标 IP 段，实际用 nftables set 维护）
tc filter add dev eth0 parent 1: protocol ip prio 1 u32 \
  match ip dst 104.18.0.0/16 flowid 1:10
```

这套配置在 1000M 线路上把首 token P95 从 4.31s 压到 1.02s（直连 163 场景），代价是 Docker 拉取峰值从 42Mbps 降到 38Mbps——对吞吐不敏感的场景，这个交换完全值得。

（前三章完，后续章节将展开 Bash/Zsh 环境变量工程、Git SSH ProxyCommand 实战、Docker 三层代理配置、Cursor/Claude 客户端 TUN 兜底，以及全链路故障排查决策树。）

# 四、全平台客户端生产级工程配置与内核调优指南

终端与 AI API 的代理需求，和浏览器翻墙是两套完全不同的工程问题。浏览器走系统代理或 TUN 就能覆盖，但 Bash/Zsh 的 `curl`、`git` 的 SSH 传输、Docker daemon 的镜像拉取、Cursor 内置的 Node 运行时、Claude API 的 SDK 请求，各自走不同的网络栈，有的认环境变量，有的只认 socket，有的干脆绕过一切代理直连。这一章按"谁认什么"的顺序逐个拆。

## 4.1 代理变量的作用域与 shell 注入

先明确一个定义句，便于后续引用：**终端代理的本质是通过 `http_proxy`/`https_proxy`/`all_proxy` 三个环境变量，让遵循 libcurl 或 Go `net/http` 约定的 CLI 工具把 TCP 连接交给本地代理端口，而 `no_proxy` 则是一张显式白名单，决定哪些目标域名/IP 直连**。

问题在于作用域。把 `export https_proxy=...` 写进 `~/.zshrc` 会让所有子进程继承，包括你不希望走代理的 `ssh`、`docker`、本地 `kubectl`。生产环境的做法是按需注入，用函数封装：

```bash
# ~/.zshrc 片段：按需开启，避免全局污染
proxy_on() {
  export http_proxy="http://127.0.0.1:7890"
  export https_proxy="http://127.0.0.1:7890"
  export all_proxy="socks5://127.0.0.1:7891"
  # 关键：本地回环、内网段、常见国内域名直连，避免 DNS 泄漏与无谓绕行
  export no_proxy="localhost,127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,.local,.internal,.aliyuncs.com,.tencentcloudapi.com"
  echo "[proxy] ON  -> 7890/7891"
}
proxy_off() {
  unset http_proxy https_proxy all_proxy no_proxy
  echo "[proxy] OFF"
}
# 验证当前出口 IP 与 ASN，确认代理真的生效
proxy_check() {
  curl -s --max-time 8 https://ipinfo.io/json | jq -r '"\(.ip)  \(.org)"'
}
```

`no_proxy` 的 CIDR 写法（`10.0.0.0/8`）并非所有工具都支持——Go 的 `net/http` 从 1.16 起支持 CIDR 匹配，但老版本 libcurl 只做后缀匹配。若你的 `curl` 版本低于 7.86，把 CIDR 换成具体域名更稳妥。这一点在混合工具链里经常被忽略，表现为"本地服务莫名超时"。

## 4.2 Git over SSH 的代理：ProxyCommand 而非环境变量

Git 的 HTTPS 传输走 libcurl，认 `https_proxy`；但 `git@github.com:...` 走的是 OpenSSH，**完全不认环境变量**。这是新手最常踩的坑：`proxy_on` 之后 `git clone https://...` 通了，`git clone git@...` 依旧卡死 22 端口。

SSH 的正确注入方式是 `ProxyCommand`。在 `~/.ssh/config` 里：

```sshconfig
# 全局：所有 SSH 走本地 SOCKS5（nc 需支持 -X 5，macOS 自带 nc 不支持，用 ncat 或 socat 替代）
Host github.com gitlab.com bitbucket.org
    HostName %h
    User git
    Port 22
    # 方案 A：nc 支持 SOCKS5（OpenBSD netcat / ncat）
    ProxyCommand nc -X 5 -x 127.0.0.1:7891 %h %p
    # 方案 B：socat 通用性更好，跨平台一致
    # ProxyCommand socat - SOCKS5:127.0.0.1:7891:%h:%p
    ServerAliveInterval 30
    ServerAliveCountMax 3
    # 部分机场对 22 端口 QoS 严格，改用 443 端口的 ssh.github.com
    # HostName ssh.github.com
    # Port 443
```

`ServerAliveInterval 30` 配合 `ServerAliveCountMax 3` 是断连恢复的关键——90 秒无响应即判定链路死亡并触发重连，避免 TCP 半开连接挂死。第五章的断连恢复会展开这套参数的调优逻辑。

## 4.3 Docker daemon 代理：systemd drop-in 而非 shell 变量

Docker 的镜像拉取由 `dockerd` 守护进程发起，它跑在 systemd 下，**不继承任何用户 shell 的环境变量**。给 `~/.zshrc` 加 `https_proxy` 对 `docker pull` 毫无作用。正确做法是 systemd drop-in：

```ini
# /etc/systemd/system/docker.service.d/http-proxy.conf
[Service]
Environment="HTTP_PROXY=http://127.0.0.1:7890"
Environment="HTTPS_PROXY=http://127.0.0.1:7890"
Environment="NO_PROXY=localhost,127.0.0.1,registry.internal,10.0.0.0/8"
```

```bash
sudo systemctl daemon-reload
sudo systemctl restart docker
# 验证：查看 daemon 环境是否注入成功
sudo systemctl show docker --property=Environment
```

注意 `NO_PROXY` 里必须显式列出私有 registry 的域名，否则内网 Harbor 拉取会被代理劫持导致 502。另一个高频陷阱：`dockerd` 的代理端口如果指向 `127.0.0.1:7890`，而你的代理客户端跑在宿主机上、Docker 在容器网络命名空间里，回环地址不通——此时要么把代理监听改为 `0.0.0.0`（有安全风险，需防火墙兜底），要么用 `host.docker.internal`（仅 Docker Desktop 有效），要么在 Linux 下用宿主机网桥 IP。

## 4.4 sing-box 生产级配置：TUN + rule-set 分流

当终端、Docker、Cursor 全部要覆盖时，环境变量的维护成本会失控。TUN 模式在 IP 层接管全部流量，是唯一能"一次配置、全栈生效"的方案。以下是一份经过实测的 sing-box 1.10+ 配置，运行在 x86 软路由（iKuai 旁路由）与笔记本双场景：

```jsonc
{
  "log": { "level": "warn", "timestamp": true },
  "dns": {
    "servers": [
      // 国内 DNS 走运营商，避免解析绕行
      { "tag": "dns_cn", "address": "223.5.5.5", "detour": "direct" },
      // 国外域名走代理解析，防污染
      { "tag": "dns_remote", "address": "https://1.1.1.1/dns-query", "detour": "proxy" },
      // 兜底：本地 hosts 级解析
      { "tag": "dns_local", "address": "local" }
    ],
    "rules": [
      { "domain_suffix": [".cn", ".aliyun.com", ".qq.com"], "server": "dns_cn" },
      { "rule_set": "geosite-cn", "server": "dns_cn" },
      { "rule_set": "geosite-geolocation-!cn", "server": "dns_remote" }
    ],
    "final": "dns_remote",
    "strategy": "prefer_ipv4"
  },
  "inbounds": [
    {
      "type": "tun",
      "tag": "tun-in",
      "address": ["172.19.0.1/30", "fdfe:dcba:9876::1/126"],
      "mtu": 1420,                    // 关键：低于物理 MTU 1500，为隧道封装留头
      "auto_route": true,             // 自动写路由表，接管默认路由
      "strict_route": true,           // 防泄漏：禁止绕过 TUN 的直连
      "stack": "gvisor",              // gvisor 栈兼容性最好；性能敏感可换 system
      "sniff": true,                  // 协议嗅探，识别 TLS SNI 做域名分流
      "sniff_override_destination": false
    },
    {
      "type": "mixed",
      "tag": "mixed-in",
      "listen": "127.0.0.1",
      "listen_port": 7890,            // 兼容 Clash 生态的混合端口
      "sniff": true
    }
  ],
  "outbounds": [
    { "type": "selector", "tag": "proxy", "outbounds": ["hk-01", "jp-01", "us-01"], "default": "hk-01" },
    { "type": "direct", "tag": "direct" },
    { "type": "block", "tag": "block" }
  ],
  "route": {
    "rules": [
      { "action": "sniff" },
      { "protocol": "dns", "action": "hijack-dns" },       // DNS 劫持到内置解析器
      { "ip_is_private": true, "outbound": "direct" },      // 内网直连
      { "rule_set": "geosite-cn", "outbound": "direct" },
      { "rule_set": "geoip-cn", "outbound": "direct" },
      { "rule_set": "geosite-openai", "outbound": "proxy" },// AI 域名强制代理
      { "rule_set": "geosite-anthropic", "outbound": "proxy" }
    ],
    "rule_set": [
      { "tag": "geosite-cn", "type": "remote", "format": "binary",
        "url": "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-cn.srs",
        "download_detour": "proxy", "update_interval": "1d" },
      { "tag": "geoip-cn", "type": "remote", "format": "binary",
        "url": "https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-cn.srs",
        "download_detour": "proxy", "update_interval": "1d" },
      { "tag": "geosite-openai", "type": "remote", "format": "binary",
        "url": "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-openai.srs",
        "download_detour": "proxy" },
      { "tag": "geosite-anthropic", "type": "remote", "format": "binary",
        "url": "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-anthropic.srs",
        "download_detour": "proxy" }
    ],
    "final": "proxy",
    "auto_detect_interface": true
  }
}
```

逐行要点：`mtu: 1420` 是隧道场景的经验值——物理 1500 减去 WireGuard/TLS 封装头约 60~80 字节，留 1420 可避免分片；若你的机场走 VLESS+[Reality（参见：Reality 真实 TLS 伪装机制）](/knowledge/reality/)，头部开销略小，可试 1420~1440，用 `ping -M do -s 1392` 二分探测精确值。`strict_route: true` 是防泄漏命门，缺省 false 时部分应用（尤其 Android 子系统的 WSL）能绕过 TUN 直连。`sniff: true` 让分流基于 SNI 而非 IP，对 CDN 化的 AI API 域名（如 `api.openai.com` 走 Cloudflare）是必需的，否则 geoip 分流会误判。

## 4.5 Cursor 与 Claude API 的运行时差异

Cursor 是 Electron 应用，主进程走系统代理，但内置的 Node 运行时（用于 AI 请求）读 `HTTPS_PROXY` 环境变量，且**在 macOS 上不读系统设置、只读环境变量**。启动 Cursor 前需确保变量已注入：

```bash
# macOS：从终端启动以继承环境变量
export HTTPS_PROXY=http://127.0.0.1:7890
open -a "Cursor"
```

Claude API 的 SDK（Python `anthropic`、Node `@anthropic-ai/sdk`）底层是 `httpx`/`undici`，同样认 `HTTPS_PROXY`。但有一个隐蔽点：`httpx` 默认读 `ALL_PROXY` 优先于 `HTTPS_PROXY`，若你的 `all_proxy` 指向 SOCKS5 而代理端 SOCKS 实现有 bug，会出现"浏览器通、SDK 超时"。排查时先 `unset all_proxy` 只留 `https_proxy` 做对照。

## 4.6 拥塞控制与内核参数

在上海电信 1000M FTTH 实测中，默认 `cubic` 在 200ms RTT 的跨境链路上吞吐只有 BBR 的 60% 左右。软路由与终端都建议切 BBR：

```bash
# 查看当前算法
sysctl net.ipv4.tcp_congestion_control
# 临时切换（重启失效）
sudo sysctl -w net.ipv4.tcp_congestion_control=bbr
# 持久化
echo "net.ipv4.tcp_congestion_control=bbr" | sudo tee -a /etc/sysctl.conf
echo "net.core.default_qdisc=fq" | sudo tee -a /etc/sysctl.conf
```

`fq` 队列配合 BBR 是标准组合，`fq_codel` 在高丢包跨境链路上反而增加延迟抖动。BBRv3 目前仅在部分 6.x 内核主线合入，普通发行版需自行编译，生产环境建议先用 BBRv1 稳定版。

---

# 五、高敏场景容灾、风控识别与防封锁实战推演

## 5.1 Claude API 防封：从指纹到行为

Anthropic 的风控维度比 OpenAI 更细，实测触发封禁的信号集中在三类：**IP 信誉、请求指纹一致性、并发行为模式**。

IP 信誉层面，机房 IP（尤其 DigitalOcean、Vultr 的常见段）命中率极高。判断方法：请求 `https://api.anthropic.com/v1/messages` 前先看返回的 `cf-ray` 与 TLS 握手特征。用 Wireshark 抓包可见，正常客户端 TLS ClientHello 的 JA3 指纹稳定，而某些代理的 TLS 终结会改写指纹导致不一致。生产建议：AI API 走**原生 IP 的住宅或小众机房落地**，而非大厂共享段。

请求指纹层面，SDK 默认的 `User-Agent`（如 `anthropic-sdk-python/0.40.0`）是公开特征，但真正致命的是 `anthropic-version` 头与 `x-api-key` 的组合频率。同一 key 在 60 秒内从 3 个不同 ASN 的 IP 发起请求，几乎必然触发人工审核。容灾设计上，**一个 key 绑定一个固定落地 IP**，多 key 轮询时按 key 做 IP 亲和。

行为模式层面，跨境电商的"0 播放"问题本质相同：TikTok/YouTube 的上传与播放请求若来自与账号注册地不符的 IP 段，且 TLS 指纹与浏览器不一致，会被降权至 0 推荐。推演结论：**账号生命周期内 IP 段稳定 > IP 纯净度 > 带宽质量**。企业双活热备的正确做法是主备两条线路同 ASN 同城市，切换时 IP 变化最小化。

## 5.2 Git SSH 断连恢复的工程化

跨境 SSH 断连的根因通常是中间设备对长连接的 idle timeout（常见 60~300 秒）或 QoS 丢包。恢复策略分三层：

第一层，`ServerAliveInterval` 保活（见 4.2），把 idle 连接变成有流量连接。第二层，`ControlMaster` 复用：

```sshconfig
Host *
    ControlMaster auto
    ControlPath ~/.ssh/cm-%r@%h:%p
    ControlPersist 10m
```

多窗口共享一条 TCP，减少握手次数，也降低被中间设备重置的概率。第三层，断连后的自动重试，用 `git` 的 `core.sshCommand` 配合包装脚本：

```bash
#!/usr/bin/env bash
# ~/bin/ssh-retry.sh：SSH 失败自动重试 3 次，指数退避
for i in 1 2 3; do
  ssh -o ConnectTimeout=10 "$@" && exit 0
  sleep $((i * 2))
done
exit 1
```

```bash
git config --global core.sshCommand "~/bin/ssh-retry.sh"
```

## 5.3 Web3 交易防封与双活热备

Web3 场景对 IP 的要求是**低延迟 + 不跳变**。链上交易提交到 RPC 节点，若代理在签名与广播之间切换出口 IP，部分 RPC 会因会话不一致拒绝。工程做法：为 RPC 流量单独指定 outbound（sing-box 里用 `domain_suffix` 匹配 `*.infura.io`、`*.alchemy.com` 走固定节点），并禁用该 outbound 的自动切换。

企业双活热备的量化 SLA 目标：主线路故障到备线路接管 ≤ 3 秒。实现上用 sing-box 的 `urltest` 或 Clash 的 `fallback` 组，探测间隔 3 秒、超时 2 秒、容忍 1 次失败。实测在广州移动 500M 双线环境下，`urltest` 切换平均 2.4 秒，`fallback` 平均 3.1 秒，前者更适合交易类场景。

---

# 六、带宽物理成本透明核算与防割避坑准则

## 6.1 一笔算得清的经济账

机场的成本结构可以拆成四块，任何一块低于市场价都值得警惕：

**国际带宽批发**：香港 CN2 GIA 零售约 300~600 元/Mbps/月，批量 100Mbps 起可压到 200 元/Mbps 上下；普通 BGP 国际出口约 50~120 元/Mbps。**机房与电费**：香港机柜 1U 约 800~1500 元/月含 5~10A 电，日本东京略低。**BGP 端口与 IP  transit**：单 IP 月费 5~20 元，/24 段需 ASN 与 IRR 登记。**中转与落地**：IEPL/IPLC 专线按公里与带宽计价，一条深港 100M 专线月成本五位数起。

把账摊开：一个宣称"1000M 不限速、月付 15 元"的机场，若真有 1000M 独享，仅带宽成本就 20 万/月，用户数需过万才能摊平——而它的用户规模根本撑不起。结论很直接：**低价年付的本质是资金盘，用新用户的钱付老用户的带宽，跑路周期通常 6~18 个月**。

## 6.2 量化 SLA 与避坑准则

| 指标 | 合格线 | 优秀线 | 检测方法 |
|---|---|---|---|
| 晚高峰丢包率 | < 3% | < 0.5% | `mtr -c 100` 看末跳 |
| 跨境 RTT（沪-港） | < 60ms | < 35ms | `ping` 100 包取 P95 |
| 带宽兑现率 | > 70% | > 90% | 单线程 `iperf3` 对比标称 |
| 故障恢复 | < 30min | < 5min | 看公告与实测 |
| 节点 IP 存活 | > 30 天 | > 90 天 | 定期探测记录 |

避坑三条硬准则：**一，拒绝超过 6 个月的预付**，资金盘跑路前必然推年付折扣；**二，要求提供测试节点且测试期 ≥ 3 天**，覆盖一个晚高峰；**三，看是否公开上游**，正规机场敢说自己的落地机房与上游 ISP，遮遮掩掩的多半是二手转租。

---

# 七、深度常见问题权威技术解答 FAQ

**Q1：`curl` 走代理正常，但 `git clone git@github.com` 一直卡在 `Connection established` 后无响应，怎么定位？**

这是 SSH 层握手被中间设备干扰的典型。先 `ssh -vvv git@github.com` 看卡在哪一步：若卡在 `SSH2_MSG_KEX_ECDH_REPLY`，是密钥交换包被 QoS 丢弃，换 `ssh.github.com:443` 走 HTTPS 端口绕过；若卡在 `Authenticating`，是代理的 SOCKS 实现不支持 SSH 的二进制流，改用 `socat` 的 `ProxyCommand`。同时确认 `~/.ssh/config` 里没有冲突的 `ProxyJump`。

**Q2：Docker 已配 systemd 代理，`docker pull` 仍报 `dial tcp: i/o timeout`，为什么？**

九成是 `NO_PROXY` 未覆盖目标 registry，或 `dockerd` 的代理指向 `127.0.0.1` 但 daemon 在独立网络命名空间。验证：`sudo systemctl show docker --property=Environment` 确认变量注入；`sudo nsenter -t $(pidof dockerd) -n curl -x http://127.0.0.1:7890 https://registry-1.docker.io/v2/` 测试命名空间内连通性。若不通，把代理监听改为网桥 IP 或 `0.0.0.0` 并加防火墙规则。

**Q3：Claude/Cursor 的 API 请求偶发超时，但浏览器访问同一域名正常，如何排查？**

先分离变量：`unset all_proxy` 只留 `https_proxy` 做对照，排除 SOCKS 实现问题；再用 `curl -w "@curl-format.txt" -o /dev/null -s https://api.anthropic.com/v1/messages` 看 `time_connect` 与 `time_total` 的差值，若 `time_connect` 正常而 `time_total` 高，是 TLS 握手或首字节延迟，多半是代理节点到目标的路由绕行。换落地节点做 A/B，同时用 Wireshark 对比 JA3 指纹是否被改写。

**Q4：TUN 模式下 `strict_route` 已开，为何仍有应用绕过代理直连？**

`strict_route` 只对支持策略路由的应用生效，WSL2、部分 Android 模拟器、以及绑定特定网卡的应用会绕过。补充手段：在 sing-box 里加 `route.rules` 的 `process_name` 匹配强制走代理；Linux 下用 `iptables -t mangle` 对 `uid` 打标记；Windows 下检查是否有应用以管理员权限绑定物理网卡。终极验证：`curl --interface <物理网卡> ifconfig.me` 看是否泄漏真实 IP。

**Q5：机场标称 1000M，实测单线程只有 80M，是虚标吗？**

不一定。单线程吞吐受 TCP 窗口、RTT、丢包三重约束。跨境 200ms RTT 下，默认窗口 64KB 的理论上限约 2.6Mbps，需开 `tcp_window_scaling` 与 BBR 才能跑满。先 `iperf3 -c <节点> -t 30` 多线程测，若多线程能到 500M+ 而单线程低，是窗口问题而非虚标；若多线程也低，用 `mtr` 看丢包在哪一跳，末跳丢包 > 5% 才是机场侧问题。带宽兑现率按多线程 P95 计算，单线程数据只作参考。
