# 服务器优选工具

一个基于 Cloudflare Workers / Pages Functions 的服务器 CDN 优选订阅生成工具，用于为自有 VPS 生成带 Cloudflare 优选入口的 VLESS / Trojan / VMess 订阅链接。

本工具本身不提供代理服务，只负责根据用户填写的 VPS 域名、UUID、WebSocket 路径及优选策略，自动生成适用于多客户端的订阅节点。

原项目来源：
https://github.com/byJoey/yx-auto

当前版本：
**V12 精简稳定版**

---

## 一、工具定位

本工具适合以下场景：

```text id="g3m0iq"
客户端 → Cloudflare 优选入口 → 自有 VPS → 目标网站
```

主要作用：

```text id="lib0ux"
1. 利用 Cloudflare 优选域名 / 优选 IP 改善访问入口质量；
2. 保持 VPS 作为固定落地出口 IP；
3. 为不同用户生成不同 UUID 的订阅链接；
4. 根据 UUID 自动打散节点顺序，降低多人集中到同一批 CDN 入口的概率；
5. 控制输出节点数量，避免手机端批量测速压力过大。
```

---

## 二、主要功能

### 1. 优选域名

内置实测可用的 Cloudflare 优选域名，并支持从 BestCF 动态域名源补充候选入口。

当前内置优选域名包括：

```text id="hgtr1k"
bestcf.top
cf.0sm.com
saas.sin.fan
xn--b6gac.eu.org
cf.cnae.top
cloudflare.22336666.xyz
cloudflare.cnae.top
cloudflare.byoip.top
cloudflare.19931110.xyz
yg1.ygkkk.dpdns.org
yg2.ygkkk.dpdns.org
yg3.ygkkk.dpdns.org
```

已实测不稳定或失效的域名已加入黑名单，不再生成到订阅中。

---

### 2. 优选 IP

支持从 wetest.vip 获取动态 Cloudflare 优选 IP，并支持：

```text id="a7wjyl"
IPv4 / IPv6 筛选
移动 / 联通 / 电信筛选
TLS / 非 TLS 节点控制
```

根据实测，优选 IP 质量存在波动，因此当前版本已降低优选 IP 输出比例：

```text id="twzdnj"
普通组合：优选 IP 最多输出 6 个
仅优选 IP 模式：优选 IP 最多输出 9 个
```

---

### 3. GitHub / BestCF 优选源

支持 GitHub Raw 源、BestCF 通用源、BestCF 分运营商源等。

默认支持：

```text id="dvksrd"
BestCF 通用优选 IP
BestCF 移动优选 IP
BestCF 联通优选 IP
BestCF 电信优选 IP
BestCF 动态优选域名
```

GitHub / BestCF 源数量较多，适合电脑端或管理员筛选使用。
手机端如出现真连接延迟测试 `-1`、卡住、OperationCanceled 等情况，建议关闭 GitHub 优选。

---

### 4. 多协议支持

支持以下协议：

```text id="gg0ghm"
VLESS
Trojan
VMess
```

默认启用 VLESS。

参数说明：

```text id="xp0cin"
ev=yes      启用 VLESS
et=yes      启用 Trojan
mess=yes    启用 VMess
```

注意：VMess 使用 `mess=yes`，不是 `vm=yes`。

---

### 5. 多客户端格式支持

默认输出 Base64 订阅，同时支持：

```text id="2vmlzc"
base64
clash
surge
quantumult
quanx
```

Clash / Mihomo 配置内置：

```text id="lhycfx"
url-test 自动测速组
fallback 故障切换组
```

---

## 三、V12 输出规则

### 1. 后台候选池

工具会先构建后台候选池，再根据 UUID 打散，最后按规则输出。

```text id="5on7rz"
后台候选池上限：60 个
缓存时间：60 分钟
```

后台候选池不是直接输出给客户端，而是作为筛选来源。

---

### 2. 普通组合输出规则

除“仅优选 IP”外，其他有效组合默认输出：

```text id="1u2pft"
25 个节点
```

电脑端可通过：

```text id="iyaz38"
top=30
```

输出 30 个节点。

普通组合中，优选 IP 最多输出：

```text id="jisdso"
6 个
```

其余由优选域名、GitHub / BestCF 源补齐。

---

### 3. 仅优选 IP 模式输出规则

当参数为：

```text id="wp5159"
epd=no&epi=yes&egi=no
```

即只开启优选 IP 时，当前版本输出规则为：

```text id="n22s1l"
总输出：25 个节点
原生兜底：1 个
内置优选域名：先取 3 个
优选 IP：最多 9 个
剩余节点：由剩余内置优选域名、动态域名池、GitHub / BestCF 池补齐
```

这样既保留优选 IP 测试能力，又避免低质量优选 IP 占比过高。

---

### 4. UUID 自动打散

每个用户订阅链接中的 UUID 会自动作为打散种子。

示例：

```text id="3a5xgj"
用户A：/UUID-A/sub?domain=vps.example.com
用户B：/UUID-B/sub?domain=vps.example.com
```

即使两人使用相同 VPS、相同参数，只要 UUID 不同，生成的节点顺序和前排节点也会不同，从而降低多人集中连接同一批 CDN 入口的概率。

---

## 四、推荐使用方式

### 1. 手机用户推荐

手机端建议关闭 GitHub 优选，只使用优选域名 + 优选 IP：

```text id="c4b9qu"
epd=yes&epi=yes&egi=no&top=25
```

示例：

```text id="lsycr8"
https://your-worker.pages.dev/{UUID}/sub?domain=your-vps-domain.com&epd=yes&epi=yes&egi=no&ev=yes&ipv6=no&dkby=yes&path=%2Fyour-ws-path&top=25
```

如果手机端仍然测不出真连接延迟，可以尝试降低输出数量：

```text id="dwauap"
top=18
```

---

### 2. 电脑用户推荐

电脑端可以开启 GitHub / BestCF 优选源：

```text id="1zogzq"
epd=yes&epi=yes&egi=yes&top=30
```

示例：

```text id="9lx2qc"
https://your-worker.pages.dev/{UUID}/sub?domain=your-vps-domain.com&epd=yes&epi=yes&egi=yes&ev=yes&ipv6=no&dkby=yes&path=%2Fyour-ws-path&top=30
```

---

### 3. 仅测试优选 IP

```text id="py7gsx"
epd=no&epi=yes&egi=no
```

示例：

```text id="n9kam4"
https://your-worker.pages.dev/{UUID}/sub?domain=your-vps-domain.com&epd=no&epi=yes&egi=no&ev=yes&ipv6=no&dkby=yes&path=%2Fyour-ws-path
```

该模式仍输出 25 个节点，但优选 IP 最多 9 个，其余由内置域名和 GitHub / BestCF 补齐。

---

### 4. 洛杉矶 VPS 推荐模式

如果 VPS 位于洛杉矶，电脑端或管理员测试时可以使用：

```text id="1g9k7k"
mode=la
```

示例：

```text id="sz17bd"
https://your-worker.pages.dev/{UUID}/sub?domain=your-vps-domain.com&epd=yes&epi=yes&egi=yes&mode=la&top=30
```

洛杉矶模式会额外接入 BestCF 通用、移动、联通、电信优选 IP 源。
手机用户不建议默认开启该模式。

---

## 五、部署方式

### Cloudflare Workers 部署

1. 打开 Cloudflare Dashboard；
2. 进入 Workers & Pages；
3. 创建新的 Worker；
4. 将 `_worker.js` 代码完整复制进去；
5. 保存并部署。

---

### Cloudflare Pages 部署

如果使用 Pages 项目：

1. 将代码文件命名为：

```text id="e8t4kg"
_worker.js
```

2. 放在项目根目录；
3. 推送到 GitHub；
4. 等待 Cloudflare Pages 自动部署；
5. 使用生产域名访问工具页面或订阅链接。

---

## 六、订阅链接格式

基础格式：

```text id="jh3cs8"
https://your-worker.pages.dev/{UUID}/sub?domain=your-vps-domain.com
```

完整示例：

```text id="2bdqqy"
https://your-worker.pages.dev/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx/sub?domain=vps.example.com&epd=yes&epi=yes&egi=no&ev=yes&ipv6=no&dkby=yes&path=%2Fcdn-path&top=25
```

---

## 七、URL 参数说明

### 1. 基础参数

| 参数       | 说明           | 默认值          |
| -------- | ------------ | ------------ |
| `domain` | VPS 回源域名，必填  | 无            |
| `path`   | WebSocket 路径 | `/`          |
| `top`    | 输出节点数量       | 普通 25，电脑可 30 |
| `target` | 输出格式         | `base64`     |

---

### 2. 优选来源参数

| 参数    | 说明                    | 默认值           |
| ----- | --------------------- | ------------- |
| `epd` | 启用优选域名                | `yes`         |
| `epi` | 启用优选 IP               | `yes`         |
| `egi` | 启用 GitHub / BestCF 优选 | `yes`         |
| `piu` | 自定义 IP 来源 URL         | 默认 BestCF 通用源 |

推荐：

```text id="gl76yz"
手机端：epd=yes&epi=yes&egi=no
电脑端：epd=yes&epi=yes&egi=yes
```

---

### 3. 协议参数

| 参数     | 说明        | 默认值   |
| ------ | --------- | ----- |
| `ev`   | 启用 VLESS  | `yes` |
| `et`   | 启用 Trojan | `no`  |
| `mess` | 启用 VMess  | `no`  |

---

### 4. IP 与运营商筛选

| 参数           | 说明            | 默认值   |
| ------------ | ------------- | ----- |
| `ipv4`       | 启用 IPv4 优选 IP | `yes` |
| `ipv6`       | 启用 IPv6 优选 IP | `yes` |
| `ispMobile`  | 启用移动优选 IP     | `yes` |
| `ispUnicom`  | 启用联通优选 IP     | `yes` |
| `ispTelecom` | 启用电信优选 IP     | `yes` |

如果手机端 IPv6 兼容不好，建议使用：

```text id="38wxra"
ipv6=no
```

---

### 5. TLS 与高级参数

| 参数        | 说明           | 默认值       |
| --------- | ------------ | --------- |
| `dkby`    | 仅生成 TLS 节点   | `no`      |
| `mode=la` | 洛杉矶 VPS 推荐模式 | 关闭        |
| `uid`     | 自定义打散种子      | 默认使用 UUID |
| `rotate`  | 节点轮换周期       | `12h`     |

常用：

```text id="8qang7"
dkby=yes
```

表示只生成 TLS 节点。

---

## 八、常见组合

### 手机常用

```text id="t8jrrk"
epd=yes&epi=yes&egi=no&top=25
```

### 手机轻量测试

```text id="q4qh5p"
epd=yes&epi=yes&egi=no&top=18
```

### 电脑常用

```text id="xl7w13"
epd=yes&epi=yes&egi=yes&top=30
```

### 仅优选 IP

```text id="m5jsyx"
epd=no&epi=yes&egi=no
```

### 仅优选域名

```text id="xw1ot5"
epd=yes&epi=no&egi=no
```

### 洛杉矶电脑测试

```text id="ia4597"
epd=yes&epi=yes&egi=yes&mode=la&top=30
```

---

## 九、多人分发建议

如果你有多台 VPS、多名用户，推荐：

```text id="ep3z7g"
每台 VPS 固定 domain 和 path
每个用户只更换 UUID
手机用户关闭 GitHub 优选
电脑用户可开启 GitHub 优选
每个用户输出 18～30 个节点
```

示例：

```text id="1cl9zk"
用户A：
https://your-worker.pages.dev/UUID-A/sub?domain=vps1.example.com&epd=yes&epi=yes&egi=no&ev=yes&ipv6=no&dkby=yes&path=%2Fcdn1&top=25

用户B：
https://your-worker.pages.dev/UUID-B/sub?domain=vps1.example.com&epd=yes&epi=yes&egi=no&ev=yes&ipv6=no&dkby=yes&path=%2Fcdn1&top=25
```

两名用户虽然使用同一台 VPS，但因为 UUID 不同，订阅节点会自动打散。

---

## 十、注意事项

1. 本工具只是订阅生成工具，不提供代理服务；
2. 生成节点需要配合自有 VPS、Xray 入站和 WebSocket 路径使用；
3. `domain` 必须填写对应 VPS 的回源域名；
4. `path` 必须与 VPS 上 Xray 入站 WebSocket 路径一致；
5. 手机端如果大量显示 `-1`，建议关闭 GitHub 优选，即使用 `egi=no`；
6. 不建议给手机端一次性输出过多节点；
7. 多人使用时建议每个用户使用不同 UUID；
8. UUID 不同可以自动打散节点顺序，降低多人集中到同一批 CDN 入口的概率；
9. VMess 使用 `mess=yes` 开启，不使用 `vm=yes`；
10. 公开优选源会波动，实测稳定的内置域名优先级更高。

---

## 十一、免责声明

本项目仅用于自有服务器的订阅链接生成与网络连接优化测试。
请遵守当地法律法规及 Cloudflare、VPS 服务商相关服务条款。
工具本身不提供代理服务，不存储用户流量，不负责第三方优选源的稳定性。
