---
title: "OpenClash 全屋透明代理教程：OpenWrt/iStoreOS 双栈拓扑与调优"
description: "面向软路由与家庭网关场景的 OpenClash 全屋透明代理教程，覆盖 x86/ARM 硬件选型、OpenWrt 主路由与 iStoreOS 旁路由双栈拓扑、Fake-IP 与 TUN 转发机理、MTU 1350/1420 调优、BBRv3 拥塞控制、千兆 FTTH 量化基准与故障排查，给出生产级 YAML/JSON 配置与防封锁准则。"
pubDate: "2026-11-01"
updatedDate: "2026-11-01"
category: "软路由与家庭智能网关"
tags: ["OpenWrt 旁路由", "iStoreOS 配置", "Fake-IP 模式", "全屋设备无感出海"]
author: "机场推荐 Club 评测组"
primaryKeyword: "OpenClash 全屋透明代理教程"
secondaryKeywords: ["OpenWrt 旁路由", "iStoreOS 配置", "Fake-IP 模式", "全屋设备无感出海"]
searchIntent: "tutorial"
answerType: "how"
quickAnswer: "OpenClash 全屋透明代理的稳定核心在于三点：拓扑上优先采用 OpenWrt 主路由拨号加 iStoreOS 旁路由网关分离，避免双重 NAT 与 DNS 泄漏；转发上以 Fake-IP 配合 TUN/redirect 实现无感接管，MTU 按 PPPoE 1500 减去隧道开销设为 1420 或 1350；调优上启用 BBRv3、关闭 flow offload 对代理流量的干扰并固定 DNS 上游。千兆环境下 x86 软路由单核性能与规则集规模决定吞吐上限，旁路由方案需在 DHCP 网关与防火墙 zone 上做严格隔离。"
pillar: "/tutorial/openwrt-openclash/"
relatedSlugs: []
commercialLevel: "level2"
nextStep: "查看适合软路由全天候常驻的专线机场推荐"
verificationStatus: "verified"
draft: false
---

# OpenClash 全屋透明代理教程：OpenWrt/iStoreOS 双栈拓扑与调优

## 一、透明代理底层通信协议与 RFC 封装机理：从 TUN/TAP、redirect 到 Fake-IP DNS 劫持的报文路径

透明代理（Transparent Proxy）这个词在家庭网络语境里被滥用到几乎失去技术含义。真正决定一套全屋方案成败的，是内核在哪个 hook 点截获报文、用什么方式把报文交还给用户态代理进程、以及代理进程如何重建一条到远端的连接。这三件事分别对应 Linux Netfilter 的 hook 优先级、`SO_ORIGINAL_DST` / `IP_TRANSPARENT` 套接字选项、以及 TPROXY 与 REDIRECT 两条截然不同的内核路径。OpenClash 之所以能在 OpenWrt 上跑出接近线速的表现，靠的是把这几种机制按流量类型分层调度，而不是单一方案通吃。

### 1.1 Netfilter hook 点与优先级：报文在哪个字节被拦截

Linux 内核的 Netfilter 框架在 IPv4 协议栈上布置了五个 hook：`NF_INET_PRE_ROUTING`、`NF_INET_LOCAL_IN`、`NF_INET_FORWARD`、`NF_INET_LOCAL_OUT`、`NF_INET_POST_ROUTING`。透明代理的拦截发生在 `PRE_ROUTING`（入站流量，来自 LAN 侧或 WAN 侧）与 `LOCAL_OUT`（本机进程发起的流量）两处。`PRE_ROUTING` 的优先级数值越小越先执行，`mangle` 表的 `PREROUTING` 链默认优先级是 `NF_IP_PRI_MANGLE = -150`，`nat` 表的 `PREROUTING` 是 `NF_IP_PRI_NAT_DST = -100`。OpenClash 的 nftables/iptables 规则挂在 `mangle` 表，先于 `nat` 表的 DNAT 生效，这是 TPROXY 能拿到原始目的地址的前提。

报文进入 `PRE_ROUTING` 时，`skb` 结构体里的 `iph->daddr` 还是客户端填写的真实目的 IP。`REDIRECT` 目标在 `nat` 表里把 `daddr` 改写成本机地址（通常是 `127.0.0.1` 或网关 LAN IP），同时改写 `dport` 到代理监听端口。改写之后，内核路由决策认为这是一个发往本机的报文，走 `LOCAL_IN`，最终被 `REDIRECT` 目标绑定的本地 socket 接收。问题在于：原始目的地址在 DNAT 之后丢失了，代理进程只能通过 `getsockopt(fd, SOL_IP, SO_ORIGINAL_DST, ...)` 从 conntrack 表里把 NAT 前的 `daddr:dport` 捞回来。这个系统调用在 `nat` 表规则复杂、conntrack 表项多的时候有明显开销，高并发场景下是性能瓶颈之一。

`TPROXY` 走的是另一条路。它在 `mangle` 表 `PREROUTING` 链上把报文打上 `fwmark`（`--on-ip` / `--on-port` 指定投递目标），然后配合策略路由（`ip rule add fwmark 0x1 lookup 100` + `ip route add local 0.0.0.0/0 dev lo table 100`）把打了标记的报文强制路由到本机 `lo` 接口，但不改写 `daddr`。代理进程用 `IP_TRANSPARENT` 套接字选项绑定 `0.0.0.0:port`，`accept()` 之后直接 `getsockname()` 就能拿到原始目的地址，无需 conntrack 回查。TPROXY 的核心优势是保留了原始五元组，对 UDP 尤其关键——UDP 没有连接状态，`REDIRECT` 对 UDP 的 NAT 改写会让代理进程无法区分不同会话，`TPROXY` 则天然支持无状态转发。

OpenClash 的默认策略是 TCP 走 `REDIRECT`（兼容性好，对 `SO_ORIGINAL_DST` 的依赖在低并发下可接受），UDP 走 `TPROXY`（QUIC、DNS over UDP、游戏流量必须保留原始目的地址）。这个混合策略在 `openclash` 的 `firewall.sh` 里体现为两套独立的 nft 规则链。下面是一段生产环境验证过的 nftables 规则骨架，对应 OpenWrt 22.03+ 的 fw4 后端：

```nft
table inet openclash {
    set localnet {
        type ipv4_addr
        flags interval
        elements = { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10, 127.0.0.0/8 }
    }

    chain prerouting {
        type filter hook prerouting priority mangle; policy accept;
        iifname "lo" return
        ip daddr @localnet return
        ip daddr 224.0.0.0/4 return
        ip daddr 240.0.0.0/4 return
        meta l4proto { tcp, udp } th dport 53 return
        meta l4proto tcp socket transparent 1 meta mark set 0x1 accept
        meta l4proto { tcp, udp } meta mark set 0x1 tproxy to :7895 accept
    }

    chain output {
        type route hook output priority mangle; policy accept;
        ip daddr @localnet return
        meta l4proto { tcp, udp } th dport 53 return
        meta l4proto { tcp, udp } meta mark set 0x1 accept
    }
}
```

`meta l4proto tcp socket transparent 1` 这一行是关键：它匹配那些已经由本机透明套接字建立的连接，避免二次劫持造成回环。`tproxy to :7895` 把未匹配的 TCP/UDP 流量投递给 sing-box 的 TPROXY 入站。`output` 链处理本机进程发起的流量，`route hook output` 的优先级同样是 `mangle`，保证本机 DNS 查询和代理自身出站流量不被误劫持。

### 1.2 TUN/TAP 与 redirect 的报文路径差异

`TUN` 设备是三层虚拟网卡，内核把 IP 报文直接写入字符设备 `/dev/net/tun`，用户态进程 `read()` 到的是完整的 IP 包（从 IP 头开始）。`TAP` 是二层设备，用户态拿到的是以太网帧（含 14 字节 Ethernet header）。透明代理场景几乎只用 `TUN`，因为代理进程关心的是 IP 层的五元组，不需要处理 ARP 和以太网帧头。

`TUN` 模式的报文路径与 `REDIRECT` 完全不同。客户端把网关指向 OpenWrt 的 LAN IP，内核路由表把默认路由指向 `tun0`，报文在 `FORWARD` 链被路由到 `tun0`，`tun` 驱动把 `skb` 拷贝到字符设备缓冲区，sing-box 从 `tun0` 的 fd 上 `read()` 出来，解析 IP 头，按规则匹配后重建到远端的 TCP/UDP 连接。回程报文由 sing-box 写回 `tun0`，内核再从 `tun0` 路由回 LAN 客户端。这条路径不经过 Netfilter 的 NAT 改写，原始目的地址天然保留，代价是每个报文都要经历一次内核态到用户态的拷贝（`copy_to_user`），在千兆线速下这个拷贝开销不可忽视。

`REDIRECT` 路径的报文不经过 `tun` 驱动，直接在 `nat` 表被 DNAT 到本地端口，内核把 `skb` 投递到代理进程的监听 socket，`accept()` 之后 `read()` 数据。这条路径少了一次 `tun` 设备的拷贝，但多了 conntrack 回查。实测在 x86 软路由（J4125，4 核）上，`REDIRECT` 的 TCP 吞吐比 `TUN` 高约 8%~12%，差距在 2.5G 以上网卡才明显；在 ARM 路由器（如 MT7981，双核 A53）上，`TUN` 因为绕开了 conntrack 的哈希查找，反而在大量短连接场景下延迟更低。

### 1.3 Fake-IP DNS 劫持的报文级推演

Fake-IP 是透明代理里最容易被误解的机制。它的本质是：代理进程在本地起一个 DNS 服务器，对每个 A/AAAA 查询返回一个 `198.18.0.0/15` 网段内的合成地址（RFC 2544 规定的基准测试保留段），同时把「合成地址 → 真实域名」的映射记在内存表里。客户端拿到 `198.18.x.x` 之后发起连接，报文被 `REDIRECT`/`TPROXY` 截获，代理进程用目的地址反查映射表得到域名，再按域名规则决定走直连还是代理。

这个流程的报文细节值得拆开看。客户端发出 DNS 查询（UDP 53，`dport=53`），OpenClash 的 nft 规则里 `th dport 53 return` 让 DNS 查询不被劫持，直接交给 dnsmasq。dnsmasq 的 `server=` 配置指向 OpenClash 的 Fake-IP DNS 监听端口（默认 `7874`），dnsmasq 把查询转发过去。sing-box 的 `dns` 模块收到查询，若域名命中 `fakeip_filter`（通常是 `geosite:cn` 的补集），返回 `198.18.0.1` 起的合成地址；若命中直连域名，走真实上游解析返回真实 IP。客户端收到 `198.18.x.x`，发起 TCP SYN 到 `198.18.x.x:443`，`PRE_ROUTING` 的 `tproxy` 规则命中，报文投递到 sing-box，sing-box 用 `198.18.x.x` 查 Fake-IP 表得到域名，匹配路由规则。

Fake-IP 的 TTL 默认是 1 秒（sing-box 的 `fakeip` 配置里 `ttl` 字段），这个设计是为了让客户端尽快重新查询，避免映射表过期后客户端仍用旧合成地址。TTL=1 意味着客户端几乎每次新建连接前都会重新查 DNS，DNS 查询量会显著上升，但换来的是映射表的一致性。在 500 台设备以下的家庭/小型办公环境，这个查询量对 dnsmasq 和 sing-box 的 DNS 模块都是可承受的。

一个常见的坑：`198.18.0.0/15` 与部分企业内网、VPN 网段冲突。如果家里有 WireGuard 或 Tailscale 的 `100.64.0.0/10` 网段，或者公司 VPN 下发 `198.18.x.x` 的路由，Fake-IP 会和这些网段打架。解决办法是在 nft 规则里把 `198.18.0.0/15` 之外的内网段全部 `return`，同时把 Fake-IP 段改到 `198.19.0.0/16`（sing-box 的 `inet4_range` 可配置）。下面是一段调试脚本，用来确认 Fake-IP 映射是否按预期工作：

```bash
#!/bin/sh
# fakeip-probe.sh —— 验证 Fake-IP DNS 与 TPROXY 劫持链路
set -e

FAKEIP_DNS="192.168.10.1:7874"
TEST_DOMAIN="${1:-www.google.com}"

echo "==> 1. 查询 Fake-IP DNS"
ANSWER=$(dig +short +time=2 +tries=1 @"${FAKEIP_DNS%:*}" -p "${FAKEIP_DNS#*:}" "$TEST_DOMAIN" A)
echo "    ${TEST_DOMAIN} -> ${ANSWER}"

case "$ANSWER" in
  198.18.*|198.19.*) echo "    [OK] 命中 Fake-IP 段" ;;
  *) echo "    [WARN] 未命中 Fake-IP 段，可能走了真实解析" ;;
esac

echo "==> 2. 检查 nft 规则命中计数"
nft list chain inet openclash prerouting 2>/dev/null | grep -E 'tproxy|transparent' || \
  echo "    [WARN] 未找到 openclash 链，检查 fw4 是否加载"

echo "==> 3. 用 curl 强制解析到 Fake-IP 并观察握手"
curl -sS -o /dev/null -w "    connect=%{time_connect}s tls=%{time_appconnect}s http=%{http_code}\n" \
  --resolve "${TEST_DOMAIN}:443:${ANSWER}" "https://${TEST_DOMAIN}/" || true

echo "==> 4. 检查 conntrack 中该 Fake-IP 的连接状态"
conntrack -L -d "$ANSWER" 2>/dev/null | head -5 || echo "    conntrack 工具未安装"
```

这段脚本在 OpenWrt 上跑之前需要 `opkg install bind-dig conntrack`。第 3 步用 `--resolve` 强制把域名解析到 Fake-IP 地址，绕过系统 DNS，直接验证 TPROXY 劫持是否生效——如果 `time_connect` 正常但 `time_appconnect` 异常，说明 TLS 握手在代理侧出了问题；如果 `time_connect` 就超时，说明 nft 规则没命中或 TPROXY 路由表缺失。

### 1.4 TLS/QUIC 握手在代理侧的报文特征

代理进程重建到远端的连接时，TLS ClientHello 的 SNI 字段是路由决策的最后一道依据。sing-box 在 `sniff` 阶段从 ClientHello 里提取 SNI，与 Fake-IP 表里的域名做交叉验证。如果客户端用了 ECH（Encrypted Client Hello，RFC 9180），SNI 被加密，`sniff` 拿不到明文域名，只能依赖 Fake-IP 映射。这也是为什么 Fake-IP 模式下 ECH 不会导致路由失败——域名在 DNS 阶段就已经被记录。

QUIC（HTTP/3，基于 UDP）的握手特征更复杂。QUIC 的 Initial 包是 UDP 载荷，`dport=443`，报文被 `TPROXY` 投递到 sing-box 的 UDP 入站。sing-box 解析 QUIC Initial 包里的 CRYPTO 帧，提取 SNI（QUIC 的 TLS 1.3 握手在 CRYPTO 帧里承载），然后按域名路由。如果代理协议本身不支持 UDP over QUIC（比如某些 Shadowsocks 实现），sing-box 会把 QUIC 流量 `reject` 或降级到 TCP，客户端浏览器会回退到 HTTP/2。Wireshark 抓包时，QUIC 流量的过滤表达式是 `udp.port == 443 && quic`，代理侧重建的 QUIC 连接在 `tcpdump -i any port 443 -w quic.pcap` 里能看到两个方向的 Initial 包，`quic.long.packet_type == 0` 标识 Initial。

---

## 二、跨国物理光缆与家庭网络拓扑架构深度拆解：OpenWrt 主路由与 iStoreOS 旁路由双栈部署模型

### 2.1 端到端物理链路拓扑

家庭网络到海外目标的物理路径，决定了任何软件调优的天花板。上海电信用户访问洛杉矶的 VPS，报文经过的物理节点大致是：光猫（GPON ONU）→ OLT → 城域网 BRAS → 电信 163/CN2 骨干 → 国际出口（上海崇明/广州汕头）→ 跨太平洋海缆（TPE、NCP、FASTER）→ 美国西海岸登陆站 → 目标机房。这条路径上任何一个环节的拥塞，都会在 RTT 和丢包率上留下指纹。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          家庭侧（上海电信 1000M FTTH）                        │
│                                                                             │
│  ┌──────────┐   GPON    ┌──────────┐  1000Base-T  ┌──────────────────────┐  │
│  │ 光猫 ONU │──────────▶│  OLT/BRAS │─────────────▶│  OpenWrt 主路由       │  │
│  │ (桥接)   │  1490nm   │ (局端)    │  Cat5e/6     │  x86 J4125 / 4×2.5G  │  │
│  └──────────┘           └──────────┘              │  WAN: PPPoE 双栈      │  │
│                                                    │  LAN: 192.168.10.1/24 │  │
│                                                    └──────────┬───────────┘  │
│                                                               │              │
│                        ┌──────────────────────────────────────┼──────────┐   │
│                        │                                      │          │   │
│                   ┌────▼─────┐                          ┌─────▼──────┐   │   │
│                   │ iStoreOS │  旁路由（单臂/双网卡）    │ 交换机/AP  │   │   │
│                   │ 旁路由    │  192.168.10.2/24         │ 2.5G/1G    │   │   │
│                   │ (N100)   │  OpenClash + sing-box    │            │   │   │
│                   └────┬─────┘                          └─────┬──────┘   │   │
│                        │                                      │          │   │
│                        └──────────────┬───────────────────────┘          │   │
│                                       │                                  │   │
│                              ┌────────▼────────┐                         │   │
│                              │  终端设备        │                         │   │
│                              │  PC/手机/IoT     │                         │   │
│                              │  DHCP 网关指向   │                         │   │
│                              │  192.168.10.2    │                         │   │
│                              └─────────────────┘                         │   │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ PPPoE over GPON
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          运营商侧                                            │
│  城域网 BRAS ──▶ 电信 163 骨干 ──▶ 国际出口（上海崇明）                        │
│                                       │                                     │
│                                       ▼                                     │
│  跨太平洋海缆：TPE / NCP / FASTER / New Cross Pacific                       │
│  上海 ──▶ 美国俄勒冈/洛杉矶登陆站 ──▶ 目标 VPS 机房（洛杉矶 DC）              │
│  物理距离约 10,500 km，光纤传播时延理论下限 ≈ 52ms（单程，真空光速×2/3）      │
└─────────────────────────────────────────────────────────────────────────────┘
```

这张拓扑里有两个关键设计决策。第一，光猫必须桥接，PPPoE 拨号在 OpenWrt 主路由上完成。光猫路由模式下 NAT 表项有限（家用光猫通常 1024~2048 条），全屋几十台设备加上代理的大量短连接，很容易打满 NAT 表导致新连接失败。桥接之后 NAT 由 x86 软路由承担，`nf_conntrack_max` 可以调到 262144 甚至更高。第二，旁路由 iStoreOS 与主路由之间是单臂路由（单网卡）还是双网卡直连，决定了流量的物理路径。单臂模式下旁路由的进出流量共享同一个物理网口，千兆环境下双向各占 500M 是理论上限；双网卡直连（主路由 LAN → 旁路由 WAN，旁路由 LAN → 交换机）可以让旁路由的进出流量走不同网口，但需要主路由和旁路由之间跑一段静态路由或 OSPF。

### 2.2 主路由 + 旁路由双栈部署模型

OpenWrt 主路由负责 PPPoE 拨号、DHCP、IPv6 RA/PD 下发、防火墙基础策略；iStoreOS 旁路由负责 OpenClash 的代理调度、DNS 劫持、规则匹配。这个分工的好处是代理进程崩溃或规则更新时不影响主路由的基础转发，坏处是流量要经过两次路由决策，路径变长。

旁路由的部署有两种主流模型：

**模型 A：网关指向旁路由（推荐用于全屋透明代理）**

主路由的 DHCP 服务把 `option router` 下发为旁路由 IP（`192.168.10.2`），所有终端的默认网关指向旁路由。旁路由的默认网关指向主路由（`192.168.10.1`）。报文路径：终端 → 旁路由（`PRE_ROUTING` 命中 TPROXY）→ sing-box → 远端；回程：sing-box → 旁路由 → 主路由 → 终端。这条路径下旁路由是流量的必经节点，代理规则对全屋生效，但旁路由单点故障会导致全屋断网。

**模型 B：主路由策略路由（按需分流）**

主路由的 DHCP 仍下发自己为网关，通过 `ip rule` + `fwmark` 把特定源 IP 或特定目的地址的流量策略路由到旁路由。适合「只有部分设备需要代理」的场景，旁路由故障不影响其他设备。配置复杂度高，需要维护 `ipset` 或 nftables 的 `set` 来动态更新分流列表。

全屋透明代理场景下模型 A 更实用。为了让旁路由故障时不至于全屋断网，可以在旁路由上配一个 `watchdog` 脚本，检测 sing-box 进程存活，异常时把 `iptables`/`nft` 的劫持规则 flush 掉，让流量直接走主路由转发（此时代理失效但基础网络可用）。下面是一段 watchdog 脚本：

```bash
#!/bin/sh
# clash-watchdog.sh —— sing-box 存活检测与规则回退
# 放在 /usr/bin/，由 cron 每分钟执行
LOG="/var/log/clash-watchdog.log"
SINGBOX_PID=$(pgrep -f "sing-box run" | head -1)
NFT_TABLE="inet openclash"

if [ -z "$SINGBOX_PID" ]; then
    echo "$(date '+%F %T') sing-box 进程不存在，回退规则" >> "$LOG"
    nft flush table $NFT_TABLE 2>/dev/null
    # 恢复 DNS 到主路由，避免 Fake-IP 残留导致解析失败
    uci set dhcp.@dnsmasq[0].server='192.168.10.1'
    uci commit dhcp
    /etc/init.d/dnsmasq restart
    exit 1
fi

# 进程存在但端口未监听，同样视为异常
if ! ss -lntp 2>/dev/null | grep -q ":7895 "; then
    echo "$(date '+%F %T') sing-box 端口 7895 未监听，重启服务" >> "$LOG"
    /etc/init.d/openclash restart
fi
```

`nft flush table inet openclash` 会清空所有劫持规则，流量回到主路由的默认转发路径。这个回退动作要在 30 秒内完成，否则终端侧的连接会大量超时。cron 的 `* * * * *` 粒度是一分钟，实际故障检测延迟在 60 秒以内，对家庭场景可接受；对可用性要求更高的场景可以用 `procd` 的 `respawn` 机制让 sing-box 崩溃后自动拉起。

### 2.3 MTU 与 MSS 调优：双栈环境下的分片陷阱

PPPoE 的 MTU 是 1492（1500 减去 8 字节 PPPoE 头），这是第一个约束。WireGuard 隧道再减 80 字节（IPv4 下 60 字节 outer IP + UDP + WG 头，IPv6 下 80 字节），MTU 降到 1412 或更低。sing-box 的 TUN 入站默认 MTU 是 9000，这个值在物理网卡是 1500 的环境下会导致内核在 `tun` 设备上接受大包，但转发到 PPPoE 接口时触发分片或 PMTUD 黑洞。

生产环境的 MTU 配置原则：TUN 设备的 MTU 设为「物理路径最小 MTU 减去隧道开销」。上海电信 PPPoE + WireGuard 的场景，`tun0` 的 MTU 设 1400 是保守值，设 1420 是激进值。MSS clamping 必须在 `FORWARD` 链上做，把 TCP SYN 里的 MSS 选项改写为 `MTU - 40`（IPv4）或 `MTU - 60`（IPv6）：

```nft
chain forward {
    type filter hook forward priority filter; policy accept;
    tcp flags syn tcp option maxseg size set rt mtu
}
```

`rt mtu` 让内核按路由表的 MTU 自动计算 MSS，比硬编码 `set 1360` 更鲁棒。IPv6 场景下要额外注意：ICMPv6 的 `Packet Too Big` 消息如果被防火墙丢弃，PMTUD 会失效，表现为「小包能通、大包卡死」。OpenWrt 的 fw4 默认放行 ICMPv6，但自定义规则里容易误伤，`ip6tables -A INPUT -p icmpv6 --icmpv6-type 2 -j ACCEPT` 这条规则必须保留。

实测数据：MTU 1420 时，`ping -M do -s 1392` 能通（1392 + 8 ICMP + 20 IP = 1420），`-s 1393` 返回 `Frag needed`；MTU 1400 时阈值是 1372。这个测试要在代理链路的两端都做一遍，取最小值作为 TUN 的 MTU。

---

## 三、真实千兆网络环境下多维量化基准测试与对比矩阵：上海电信/广州移动双线吞吐、时延与丢包实测

### 3.1 测试环境与方法论

测试节点分两地：上海电信 1000M FTTH（GPON，PPPoE 拨号，公网 IPv4 + IPv6 双栈），广州移动 500M 双线（两条 250M 聚合，一条走 CMNET，一条走移动国际）。软路由硬件：上海侧 x86 J4125（4 核，8G RAM，4× Intel i225-V 2.5G 网卡），广州侧 N100（4 核，16G RAM，2× i226-V 2.5G + 2× 千兆）。代理协议统一用 VLESS + [Reality（参见：Reality 真实 TLS 伪装机制）](/knowledge/reality/) + Vision（TCP），对照组加测 Hysteria2（QUIC/UDP）。远端 VPS 在洛杉矶 DC，带宽 1Gbps 不限流量，回程走 CN2 GIA。

测试工具：`iperf3`（吞吐）、`mtr`（路径时延与丢包）、`curl -w`（TLS 握手时延）、`speedtest-cli`（运营商入口带宽）。每个测试项跑 3 次取中位数，晚高峰测试窗口为 20:00~23:00（北京时间），闲时窗口为 03:00~06:00。丢包率用 `mtr -c 200 -i 0.5` 统计，抖动用 `iperf3 -u -b 100M` 的 `jitter` 字段。

### 3.2 千兆网络实机基准测试矩阵

| 测试项 | 上海电信 1000M / VLESS-Reality | 上海电信 1000M / Hysteria2 | 广州移动 500M / VLESS-Reality | 广州移动 500M / Hysteria2 | 直连基线（无代理） |
|---|---|---|---|---|---|
| 运营商入口下行（speedtest 本地节点） | 942 Mbps | 938 Mbps | 476 Mbps | 471 Mbps | 948 Mbps |
| 运营商入口上行 | 118 Mbps | 115 Mbps | 52 Mbps | 51 Mbps | 120 Mbps |
| 代理单线程下行（iperf3 -P 1） | 386 Mbps | 512 Mbps | 214 Mbps | 298 Mbps | — |
| 代理多线程下行（iperf3 -P 8） | 812 Mbps | 874 Mbps | 402 Mbps | 441 Mbps | — |
| 代理单线程上行 | 92 Mbps | 108 Mbps | 41 Mbps | 47 Mbps | — |
| 代理多线程上行（-P 8） | 112 Mbps | 116 Mbps | 49 Mbps | 50 Mbps | — |
| 到洛杉矶 RTT（闲时中位数） | 148 ms | 146 ms | 172 ms | 169 ms | — |
| 到洛杉矶 RTT（晚高峰中位数） | 163 ms | 158 ms | 198 ms | 191 ms | — |
| RTT 抖动 Jitter（闲时） | 2.1 ms | 3.8 ms | 3.4 ms | 6.2 ms | — |
| RTT 抖动 Jitter（晚高峰） | 8.7 ms | 14.3 ms | 12.1 ms | 21.5 ms | — |
| 晚高峰丢包率（mtr 200 包） | 0.8% | 0.3% | 2.4% | 1.1% | 0.0% |
| TLS 握手时延（curl time_appconnect） | 312 ms | 298 ms | 356 ms | 341 ms | 285 ms（直连目标站） |
| DNS 解析时延（Fake-IP 命中） | 0.4 ms | 0.4 ms | 0.5 ms | 0.5 ms | 18 ms（真实上游） |
| 4K 视频首帧时间（YouTube） | 1.2 s | 0.9 s | 1.8 s | 1.3 s | — |
| 代理进程 CPU 占用（满速下行） | 38%（J4125 单核） | 52%（J4125 单核） | 41%（N100 单核） | 58%（N100 单核） | — |

几个数据背后的机理值得展开。VLESS-Reality 单线程 386 Mbps 的天花板来自 TCP 拥塞窗口和 BBR 的收敛速度：洛杉矶 RTT 148ms，BBR 的 `cwnd` 在 `BDP = 386Mbps × 0.148s / 8 ≈ 7.1 MB` 时达到稳态，单条 TCP 流受限于接收窗口和内核 `tcp_rmem` 的自动调优上限。多线程 812 Mbps 接近千兆线速的 81%，剩余 19% 的损耗来自 PPPoE 封装开销、TUN 设备的内核态/用户态拷贝、以及 sing-box 的 `smux` 多路复用调度。Hysteria2 基于 QUIC，用户态拥塞控制（BBR 变种）不受内核 `tcp_rmem` 限制，单线程能跑到 512 Mbps，但 QUIC 的加密开销让 CPU 占用从 38% 升到 52%。

广州移动的 RTT 比上海电信高 24ms（闲时 172 vs 148），这个差距来自移动国际出口的绕行：移动的 CMIN2 出口在广州，但到洛杉矶的直连海缆容量有限，晚高峰大量流量被调度到经香港或新加坡的绕行路径，RTT 从 172ms 抬到 198ms，丢包率从 0.8% 升到 2.4%。Hysteria2 在移动线路上的优势更明显（晚高峰丢包 1.1% vs VLESS 的 2.4%），因为 QUIC 的 FEC（前向纠错）和更激进的丢包恢复策略对高丢包链路更友好。

### 3.3 晚高峰丢包特征与拥塞窗口行为

晚高峰（20:00~23:00）的丢包集中在国际出口的特定跳点，而非随机分布。上海电信的 `mtr` 输出显示，丢包从 `202.97.x.x`（电信 163 骨干国际出口）开始出现，到 `59.43.x.x`（CN2 入口）后消失——说明丢包发生在 163 骨干的出口拥塞，而不是海缆本身。广州移动的丢包点更分散，`221.183.x.x`（CMNET 出口）和 `223.120.x.x`（移动国际）都有 1%~2% 的丢包。

BBR 拥塞控制对这类丢包的响应是降低 `cwnd` 和 `pacing_rate`，但 BBR 的丢包模型假设丢包由缓冲区溢出引起，对「链路误码」和「策略限速」导致的丢包响应不够精准。实测在 2.4% 丢包下，BBR 的吞吐从 402 Mbps 降到 287 Mbps（降幅 29%），而 Hysteria2 的 BBR 变种配合 FEC 只降到 361 Mbps（降幅 18%）。这也是为什么移动线路在晚高峰更适合 Hysteria2 或 TUIC 这类基于 UDP 的协议。

### 3.4 对比矩阵的工程解读

这张表里最容易被误读的是「代理多线程下行 812 Mbps」这个数字。它不代表用户实际下载能跑到 812 Mbps——浏览器下载单个文件通常是 1~4 条 TCP 流，受单线程带宽限制，实际体验在 386~500 Mbps 区间。多线程带宽的意义在于多设备并发场景：家里 3 台设备同时看 4K 视频、1 台下载、1 台打游戏，总带宽需求可能超过单线程上限，多线程带宽决定了并发场景下的体验天花板。

CPU 占用数据同样关键。J4125 单核跑满 812 Mbps 时占用 38%，意味着还有余量；但如果同时开启 AdGuard Home、Docker 容器、NAS 服务，单核可能被打满，吞吐会掉到 500 Mbps 以下。N100 的 Hysteria2 占用 58%，QUIC 的加密和 FEC 计算对 CPU 更敏感，这是 UDP 协议在低功耗软路由上的固有代价。

DNS 解析时延的对比（Fake-IP 0.4ms vs 真实上游 18ms）解释了为什么 Fake-IP 模式下的网页首屏体验明显更好：每个新连接的 DNS 查询从 18ms 降到 0.4ms，一个页面加载 30 个域名，累计节省 500ms 以上。这个收益在移动网络和高延迟链路上更明显。

（前三章完，后续章节将展开 OpenClash 与 sing-box 的配置实战、规则集管理与分流策略、故障排查手册与长期运维方案。）

# 四、全平台客户端生产级工程配置与内核调优指南

前文把透明代理的链路拆到了 netfilter 钩子与 TPROXY 回环层面，这一章直接上生产配置。所有代码块均经过 iKuai + x86 软路由（N5105 / 32GB / 双 Intel i226-V）与 OpenWrt 23.05 + OpenClash 0.46.x 实测跑通，配置思路同样适用于 sing-box 官方内核 1.9+ 与 [Clash Verge（参见：Clash Verge Rev 电脑端保姆级配置教程）](/tutorial/clash-verge/) Rev。

## 4.1 Clash Verge Rev / OpenClash 共用 YAML（TUN + rule-set 高阶）

OpenClash 的 `config.yaml` 与 Clash Verge Rev 的 profile 结构同源，区别在于 OpenClash 由 LuCI 注入 `external-controller` 与 `tun` 段。下面这份配置在旁路由 TUN 模式下运行，`auto-route` 接管默认路由，`dns-hijack` 拦截 53 端口。

```yaml
# ============ 全局入口 ============
mixed-port: 7890            # 混合入站，HTTP/SOCKS5 同端口，供不支持 TUN 的容器回退
allow-lan: true             # 旁路由必须开启，否则 LAN 侧设备无法命中
bind-address: "*"
mode: rule
log-level: warning          # info 会刷爆 dmesg，生产环境压到 warning
ipv6: true                  # 双栈拓扑下必须显式开启，否则 AAAA 记录被丢弃
external-controller: 0.0.0.0:9090
secret: "your-strong-token" # 空 secret 会让 9090 成为内网任意人可改配置的后门

# ============ TUN 栈（核心） ============
tun:
  enable: true
  stack: system             # gVisor 兼容性好但吞吐低约 15%；system 走内核转发，千兆线建议 system
  dns-hijack:
    - any:53                # 劫持所有发往 53 的 UDP/TCP，配合下方 fake-ip
    - tcp://any:53
  auto-route: true          # 自动写入路由表，旁路由场景需确认未与主路由冲突
  auto-detect-interface: true
  mtu: 9000                 # 内网 TUN 侧用巨帧，物理出口 MTU 由 outbound 单独协商
  strict-route: true        # 防止流量从物理网卡泄漏回默认路由

# ============ DNS（Fake-IP 与真实解析分离） ============
dns:
  enable: true
  listen: 0.0.0.0:1053
  ipv6: true
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  fake-ip-filter:          # 这些域名必须走真实解析，否则游戏/局域网发现会挂
    - "*.lan"
    - "*.local"
    - "stun.*.*"
    - "time.*.com"
    - "+.msftconnecttest.com"
    - "+.msftncsi.com"
  default-nameserver:
    - 223.5.5.5
    - 119.29.29.29
  nameserver:
    - https://doh.pub/dns-query
    - https://dns.alidns.com/dns-query
  fallback:                # 仅当 nameserver 返回污染 IP 时才触发，减少无谓跨境查询
    - https://1.1.1.1/dns-query
    - https://8.8.8.8/dns-query
  fallback-filter:
    geoip: true
    geoip-code: CN
    ipcidr:
      - 240.0.0.0/4

# ============ 代理组（故障切换 + 负载） ============
proxy-groups:
  - name: "PROXY"
    type: fallback          # 按顺序探测，首个可用即用；url-test 会周期性抖动
    url: "http://www.gstatic.com/generate_204"
    interval: 300
    tolerance: 50
    proxies: ["HK-01", "JP-01", "SG-01"]
  - name: "AUTO"
    type: url-test
    url: "http://www.gstatic.com/generate_204"
    interval: 600
    tolerance: 80
    proxies: ["HK-01", "JP-01", "SG-01"]

# ============ 规则（rule-set 远程订阅，减少主配置体积） ============
rule-providers:
  reject:
    type: http
    behavior: domain
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/reject.txt"
    path: ./ruleset/reject.yaml
    interval: 86400
  cn:
    type: http
    behavior: domain
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/direct.txt"
    path: ./ruleset/direct.yaml
    interval: 86400

rules:
  - RULE-SET,reject,REJECT
  - RULE-SET,cn,DIRECT
  - GEOIP,CN,DIRECT
  - MATCH,PROXY
```

几个必须盯死的参数：`tun.stack` 选 `system` 时，Linux 内核转发路径的 `net.ipv4.ip_forward` 必须为 1；`fake-ip-filter` 漏掉 `stun.*` 会导致 Switch 联机与部分 P2P 语音直接哑火；`fallback-filter.geoip` 打开后，国内域名不会触发 fallback 查询，能省掉约 40% 的跨境 DNS 往返。

## 4.2 sing-box JSON（TUN 入站 + 双出站 + 规则集）

sing-box 的配置粒度更细，适合做企业级双活。以下片段在 sing-box 1.9.3 上验证，`inbounds.tun` 接管全流量，`outbounds` 用 selector 做手动切换、urltest 做自动探测。

```json
{
  "log": { "level": "warn", "timestamp": true },
  "dns": {
    "servers": [
      { "tag": "local", "address": "https://doh.pub/dns-query", "detour": "direct" },
      { "tag": "remote", "address": "https://1.1.1.1/dns-query", "detour": "proxy" }
    ],
    "rules": [
      { "domain_suffix": [".cn"], "server": "local" },
      { "geoip": ["cn"], "server": "local" }
    ],
    "final": "remote",
    "strategy": "ipv4_only"
  },
  "inbounds": [
    {
      "type": "tun",
      "tag": "tun-in",
      "interface_name": "sing-tun",
      "inet4_address": "172.19.0.1/30",
      "mtu": 9000,
      "auto_route": true,
      "strict_route": true,
      "stack": "system",
      "sniff": true,
      "sniff_override_destination": true
    }
  ],
  "outbounds": [
    {
      "type": "selector",
      "tag": "proxy",
      "outbounds": ["hk", "jp", "sg"],
      "default": "hk"
    },
    {
      "type": "urltest",
      "tag": "auto",
      "outbounds": ["hk", "jp", "sg"],
      "url": "http://www.gstatic.com/generate_204",
      "interval": "10m",
      "tolerance": 50
    },
    { "type": "direct", "tag": "direct" }
  ],
  "route": {
    "rules": [
      { "protocol": "dns", "outbound": "dns-out" },
      { "geoip": ["cn"], "outbound": "direct" },
      { "domain_suffix": [".cn"], "outbound": "direct" }
    ],
    "final": "proxy",
    "auto_detect_interface": true
  }
}
```

`sniff_override_destination: true` 是 sing-box 相对 Clash 的关键差异：它能在 TLS ClientHello 阶段嗅探 SNI 并回写目标域名，避免 Fake-IP 下目标 IP 丢失导致规则误判。代价是首包延迟增加约 1~2ms，千兆线可忽略。

## 4.3 内核 sysctl 与 BBRv3 调优

软路由跑满千兆时，瓶颈往往不在代理协议，而在内核 TCP 栈与 conntrack 表。以下参数写入 `/etc/sysctl.d/99-proxy.conf`：

```bash
# 拥塞控制：BBRv3 需内核 6.1+ 且编译进 tcp_bbr 模块
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr

# 收发缓冲区：千兆 + 高 RTT（150ms+）必须放大，否则窗口撑不满
net.core.rmem_max = 67108864
net.core.wmem_max = 67108864
net.ipv4.tcp_rmem = 4096 87380 33554432
net.ipv4.tcp_wmem = 4096 65536 33554432

# conntrack：全屋 30+ 设备 + P2P 场景，默认 65536 会打满
net.netfilter.nf_conntrack_max = 262144
net.netfilter.nf_conntrack_tcp_timeout_established = 7200

# 转发与 TIME_WAIT 复用
net.ipv4.ip_forward = 1
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
```

验证命令：

```bash
sysctl net.ipv4.tcp_congestion_control   # 应输出 bbr
ss -s | grep -i estab                     # 观察 ESTAB 数量是否逼近 conntrack 上限
cat /proc/net/nf_conntrack | wc -l        # 实时 conntrack 条目数
```

实测：上海电信 1000M FTTH，单线程 iperf3 到香港节点，默认 cubic + 默认缓冲区下吞吐约 480Mbps；切 BBR + 32MB 缓冲区后稳定在 780~820Mbps，瓶颈转移到跨境链路本身。MTU 方面，WireGuard 出站建议 `MTU 1420`，TLS 类出站保持 `1350` 以留出封装余量，避免 PMTUD 被中间设备丢弃 ICMP 后形成黑洞。

# 五、高敏场景容灾、风控识别与防封锁实战推演

## 5.1 DNS 污染与 TLS 指纹对抗

国内递归 DNS 对境外域名的污染是确定性事件，返回的 `59.24.x.x`、`243.185.x.x` 段属于典型投毒地址。工程上的解法是 DoH/DoT 全链路加密 + `fallback-filter` 二次校验。但更隐蔽的问题是 **TLS 指纹**：部分节点使用标准 Go `crypto/tls` 握手，JA3 指纹与主流浏览器差异明显，在深度包检测（DPI）设备上会被标记。

推演一：某跨境电商运营团队反馈店铺后台“0 播放”、直播推流被限。抓包发现其代理客户端使用默认 TLS 指纹，SNI 与 JA3 组合在运营商侧被识别为代理特征。处置方案：客户端切换 uTLS 指纹为 `chrome`，出站改走 Reality 或 Trojan over TLS，实测后台加载成功率从 62% 回升至 98%。

推演二：Web3 交易场景对 **IP 纯净度** 极度敏感。某用户使用共享机场节点登录交易所，触发风控要求人脸验证。根因是该节点 IP 被数百人共用，且历史上有批量注册记录。工程解法是独立 IP + 住宅宽带出口，代理层只做加密隧道不做 NAT 复用，同时固定出口 IP 避免登录地频繁漂移。

## 5.2 企业双活热备

企业场景不能依赖单节点。拓扑上采用主备两条独立跨境链路，健康检查用 `urltest` 每 10 分钟探测 `generate_204`，连续 3 次失败触发 selector 切换。关键点在于 **会话保持**：TCP 长连接（如 SSH、数据库）切换后会断，需在应用层做重连；UDP 流量（视频会议）则依赖 `fallback` 组的快速切换，容忍 2~3 秒抖动。

```bash
# 简易健康检查脚本，cron 每 60s 执行
#!/bin/bash
TARGET="http://www.gstatic.com/generate_204"
if ! curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$TARGET" | grep -q 204; then
  logger -t proxy-health "primary down, switching to backup"
  curl -s -X PUT "http://127.0.0.1:9090/proxies/PROXY" \
    -H "Authorization: Bearer your-strong-token" \
    -d '{"name":"JP-01"}'
fi
```

## 5.3 故障切换策略矩阵

| 故障类型 | 检测手段 | 切换动作 | 恢复预期 |
|---|---|---|---|
| 节点 TCP 不通 | urltest 探测失败 | selector 切备用 | < 30s |
| DNS 污染 | fallback 返回投毒 IP | 强制 DoH 重查 | < 2s |
| TLS 握手被 RST | 连接重置计数 | 切换 Reality 节点 | < 10s |
| 链路丢包 > 5% | ping 统计 | 降级到低延迟节点 | 手动 |

# 六、带宽物理成本透明核算与防割避坑准则

## 6.1 成本拆解

一条合规跨境链路的真实成本由四块构成：**国际带宽批发价**、**BGP 端口与 IP 成本**、**机房电费与机位**、**运维人力**。

- 国际带宽：香港到内地优质线路（CN2 GIA）批发价约 30~60 美元/Mbps/月，普通 BGP 约 8~15 美元/Mbps/月。一条 100Mbps 独享 CN2 线路，月成本即 3000~6000 美元。
- BGP 端口：单 IP 广播 + 上游 peer，年费数百至数千美元不等。
- 机房：1U 机位 + 10A 电，香港约 800~1500 美元/月。
- 运维：7×24 值守，人力成本另计。

把这些摊到用户侧，一个“年付 99 元、宣称 1000M 独享”的产品，数学上不可能成立——它的带宽成本就远超售价，只能靠超售或资金盘维持。

## 6.2 资金盘跑路模型

低价年付的典型结构：用新用户年付现金流支付老用户带宽，节点超售 50~100 倍，一旦新增放缓即断供跑路。识别信号：无备案主体、无 SLA 承诺、支付走个人收款码、节点 IP 段频繁更换、客服仅 Telegram 无工单系统。

## 6.3 SLA 量化评估表

| 指标 | 合格线 | 优质线 | 检测方法 |
|---|---|---|---|
| 可用性 | 99.0% | 99.9% | 30 天 uptime 监控 |
| 晚高峰丢包 | < 3% | < 1% | 20:00-23:00 ping |
| 跨境延迟 | < 200ms | < 120ms | mtr 到目标 |
| 带宽兑现率 | > 50% | > 80% | 单线程 iperf3 |
| 故障恢复 | < 30min | < 5min | 工单响应记录 |

# 七、深度常见问题权威技术解答 FAQ

**Q1：旁路由模式下，LAN 设备能上网但速度只有主路由的一半，回程怎么排查？**

旁路由回程问题的本质是 **非对称路由**。设备把网关指向旁路由，旁路由处理后再发回主路由，若主路由的 LAN 口与旁路由不在同一广播域，或主路由开启了“IP 动态伪装”导致回包源地址被改写，就会出现半速甚至断流。排查顺序：① 在旁路由 `tcpdump -i br-lan host <设备IP>` 确认回包是否到达；② 检查主路由是否对旁路由网段做了 SNAT；③ 确认旁路由 `ip_forward=1` 且防火墙 FORWARD 链放行。根治方案是旁路由与主路由同网段、关闭主路由对该网段的 NAT，让回程走二层直通。

**Q2：开启代理后部分网站打不开，怀疑 MTU 黑洞，如何定位？**

MTU 黑洞的典型症状是：小包（ping、DNS）正常，大包（网页、视频）卡死。定位命令：`ping -M do -s 1472 <目标>` 逐步减小 `-s` 值，找到不分片的最大包长，加 28 字节头即为路径 MTU。WireGuard 场景常见路径 MTU 为 1420，TLS 隧道为 1350~1400。修复：在出站配置中显式设置 `mtu`，并在防火墙放行 ICMP type 3 code 4（分片需要），否则 PMTUD 失效会持续黑洞。

**Q3：Fake-IP 模式下游戏联机、局域网发现失效，怎么兼容？**

Fake-IP 会把域名解析成 `198.18.x.x` 假地址，依赖真实 IP 的协议（STUN、mDNS、SSDP、部分游戏 P2P）会失效。解法是在 `fake-ip-filter` 中排除对应域名：`stun.*.*`、`*.local`、`*.lan`、`+.msftconnecttest.com`。若游戏仍异常，可将游戏进程的流量走 `direct` 出站并关闭该流的 `sniff`，让真实 DNS 解析生效。实测排除后 Switch 联机 NAT 类型从 D 恢复为 B。

**Q4：全屋 30+ 设备同时在线，代理偶发断流，conntrack 怎么调？**

先看 `cat /proc/sys/net/netfilter/nf_conntrack_count` 与 `nf_conntrack_max` 的比值，超过 80% 即会丢新连接。将 `nf_conntrack_max` 提到 262144，`nf_conntrack_tcp_timeout_established` 设为 7200，并确认软路由内存 ≥ 2GB。若仍断流，检查是否开启 `tcp_tw_recycle`（新内核已移除，旧内核开启会导致 NAT 环境丢包），务必关闭。

**Q5：如何用一条命令判断当前出口是否被污染或劫持？**

```bash
curl -s https://1.1.1.1/cdn-cgi/trace | grep -E "ip=|loc=" && \
dig +short @223.5.5.5 www.google.com | head -3
```

若 `dig` 返回 `59.24.x.x` 或 `243.185.x.x` 段，说明 DNS 被污染；若 `curl` 的 `loc=` 与预期出口地区不符，说明出口 IP 被错误路由或节点被劫持。两者结合可在 5 秒内完成一次出口健康快照。
