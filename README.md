# 服务器优选工具

一个基于 Cloudflare Workers / Pages Functions 的服务器优选订阅生成工具，用于为自有 VPS 生成带 Cloudflare CDN 优选入口的代理订阅链接。

本工具本身不提供代理服务，只负责根据用户填写的 VPS 域名、UUID、WebSocket 路径及优选策略，自动生成适用于 VLESS、Trojan、VMess 等协议的订阅节点。

GitHub 原项目：
https://github.com/byJoey/yx-auto

---

## 一、主要功能

### 1. 优选域名

内置多组实测可用的 Cloudflare 优选域名，并支持从 BestCF 动态域名源补充候选入口。

当前内置优选域名包含：

```text
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

已加入本地黑名单的失效域名不会再生成到订阅中。

---

### 2. 优选 IP

支持从 wetest.vip 获取动态 Cloudflare 优选 IP，并可按 IPv4 / IPv6、移动 / 联通 / 电信进行筛选。

优选 IP 适合与优选域名组合使用，手机端建议开启优选 IP，但不建议同时开启 GitHub 大池。

---

### 3. GitHub / BestCF 优选源

支持从 GitHub Raw 源或 BestCF 源获取 Cloudflare 优选 IP。

默认支持：

```text
BestCF 通用优选 IP
BestCF 移动优选 IP
BestCF 联通优选 IP
BestCF 电信优选 IP
BestCF 动态优选域名
```

GitHub / BestCF 大池数量较多，适合电脑端或管理员筛选使用。手机端如果出现真连接延迟测试 `-1`、卡住、OperationCanceled 等情况，建议关闭 GitHub 优选。

---

### 4. 候选池与输出控制

工具会先构建后台候选池，再根据用户 UUID 打散顺序，最后按规则输出订阅节点。

当前规则：

```text
后台候选池上限：60 个
仅启用优选 IP：输出 18 个
其他有效组合：默认输出 25 个
电脑端可通过 top=30 输出 30 个
```

后台候选池不是直接输出给用户，而是作为候选来源。实际输出数量由参数组合和 `top` 控制。

---

### 5. UUID 自动打散

每个用户订阅链接中的 UUID 会自动作为打散种子。

也就是说，即使不同用户使用同一台 VPS、同样的参数，只要 UUID 不同，最终刷出来的节点顺序和前排节点也会有所差异，从而降低多人集中连接同一批 CDN 入口的概率。

示例：

```text
用户A：/UUID-A/sub?domain=vps.example.com
用户B：/UUID-B/sub?domain=vps.example.com
```

两人使用相同 VPS 域名，但因为 UUID 不同，订阅节点会自动分散。

---

### 6. 仅优选 IP 模式优化

当只开启优选 IP 时：

```text
epd=no&epi=yes&egi=no
```

工具会采用轻量输出策略：

```text
原生地址 1 个
内置优选域名 3 个
优选 IP 池为主
如果不足 18 个，再从动态域名池、GitHub / BestCF 池补位
```

这样既保证只开优选 IP 时不会节点过少，又避免把 GitHub 大池全部塞进手机端订阅。

---

### 7. 多协议支持

支持以下协议：

```text
VLESS
Trojan
VMess
```

默认启用 VLESS。
Trojan 和 VMess 可通过参数开启。

---

### 8. 多客户端格式支持

默认输出 Base64 订阅，同时支持以下格式：

```text
base64
clash
surge
quantumult
quanx
```

Clash 配置中内置：

```text
url-test 自动测速组
fallback 故障切换组
```

方便 Clash / Mihomo / Stash / Karing 等客户端自动选择可用节点。

---

### 9. 缓存机制

工具内置 60 分钟内存缓存，用于减少重复拉取第三方优选源。

```text
缓存时间：60 分钟
```

缓存可以降低第三方源波动带来的影响，也能减少多人同时更新订阅时的外部请求压力。

注意：Cloudflare Worker 冷启动后内存缓存可能会清空，这是正常现象。

---

## 二、推荐使用方式

### 1. 手机用户推荐

手机端建议只开启：

```text
优选域名：yes
优选 IP：yes
GitHub 优选：no
```

推荐参数：

```text
epd=yes&epi=yes&egi=no&top=25
```

示例：

```text
https://your-worker.pages.dev/{UUID}/sub?domain=your-vps-domain.com&epd=yes&epi=yes&egi=no&ev=yes&ipv6=no&dkby=yes&path=%2Fyour-ws-path&top=25
```

如果手机端真连接延迟仍然测不出来，可以降低到：

```text
top=18
```

---

### 2. 电脑用户推荐

电脑端真连接测速能力更强，可以开启 GitHub / BestCF 大池。

推荐参数：

```text
epd=yes&epi=yes&egi=yes&top=30
```

示例：

```text
https://your-worker.pages.dev/{UUID}/sub?domain=your-vps-domain.com&epd=yes&epi=yes&egi=yes&ev=yes&ipv6=no&dkby=yes&path=%2Fyour-ws-path&top=30
```

---

### 3. 仅测试优选 IP

如果只想测试优选 IP：

```text
epd=no&epi=yes&egi=no
```

示例：

```text
https://your-worker.pages.dev/{UUID}/sub?domain=your-vps-domain.com&epd=no&epi=yes&egi=no&ev=yes&ipv6=no&dkby=yes&path=%2Fyour-ws-path
```

该模式会自动控制在 18 个节点左右，并加入 3 个内置优选域名作为前置兜底。

---

### 4. 洛杉矶 VPS 推荐模式

如果你的 VPS 在洛杉矶，可以在电脑端或管理员测试时启用：

```text
mode=la
```

示例：

```text
https://your-worker.pages.dev/{UUID}/sub?domain=your-vps-domain.com&epd=yes&epi=yes&egi=yes&mode=la&top=30
```

洛杉矶模式会额外接入 BestCF 通用、移动、联通、电信优选 IP 源，适合电脑端进行更大范围筛选。

手机用户不建议默认开启该模式。

---

## 三、部署方式

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

```text
_worker.js
```

2. 放在项目根目录；
3. 推送到 GitHub；
4. 等待 Cloudflare Pages 自动部署；
5. 使用生产域名访问工具首页。

---

## 四、订阅链接格式

基础格式：

```text
https://your-worker.pages.dev/{UUID}/sub?domain=your-vps-domain.com
```

完整示例：

```text
https://your-worker.pages.dev/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx/sub?domain=vps.example.com&epd=yes&epi=yes&egi=no&ev=yes&ipv6=no&dkby=yes&path=%2Fcdn-path&top=25
```

---

## 五、主要 URL 参数

### 基础参数

| 参数       | 说明                  | 默认值             |
| -------- | ------------------- | --------------- |
| `domain` | 你的 VPS 域名 / 回源域名，必填 | 无               |
| `path`   | WebSocket 路径        | `/`             |
| `top`    | 输出节点数量              | 普通模式 25，电脑可设 30 |
| `target` | 输出格式                | `base64`        |

---

### 优选来源参数

| 参数    | 说明                    | 默认值           |
| ----- | --------------------- | ------------- |
| `epd` | 启用优选域名                | `yes`         |
| `epi` | 启用优选 IP               | `yes`         |
| `egi` | 启用 GitHub / BestCF 优选 | `yes`         |
| `piu` | 自定义 IP 来源 URL         | 默认 BestCF 通用源 |

建议：

```text
手机端：epd=yes&epi=yes&egi=no
电脑端：epd=yes&epi=yes&egi=yes
```

---

### 协议参数

| 参数     | 说明        | 默认值   |
| ------ | --------- | ----- |
| `ev`   | 启用 VLESS  | `yes` |
| `et`   | 启用 Trojan | `no`  |
| `mess` | 启用 VMess  | `no`  |

注意：VMess 参数使用 `mess`，不是 `vm`。

---

### IP 与运营商筛选

| 参数           | 说明            | 默认值   |
| ------------ | ------------- | ----- |
| `ipv4`       | 启用 IPv4 优选 IP | `yes` |
| `ipv6`       | 启用 IPv6 优选 IP | `yes` |
| `ispMobile`  | 启用移动优选 IP     | `yes` |
| `ispUnicom`  | 启用联通优选 IP     | `yes` |
| `ispTelecom` | 启用电信优选 IP     | `yes` |

如果手机端 IPv6 支持不好，可以使用：

```text
ipv6=no
```

---

### TLS 与模式参数

| 参数        | 说明           | 默认值       |
| --------- | ------------ | --------- |
| `dkby`    | 仅生成 TLS 节点   | `no`      |
| `mode=la` | 洛杉矶 VPS 推荐模式 | 关闭        |
| `uid`     | 自定义打散种子      | 默认使用 UUID |
| `rotate`  | 节点轮换周期       | `12h`     |

常用：

```text
dkby=yes
```

表示只生成 TLS 节点，不生成 80 端口等非 TLS 节点。

---

## 六、常见组合

### 手机常用

```text
epd=yes&epi=yes&egi=no&top=25
```

### 手机轻量测试

```text
epd=yes&epi=yes&egi=no&top=18
```

### 电脑常用

```text
epd=yes&epi=yes&egi=yes&top=30
```

### 仅优选 IP

```text
epd=no&epi=yes&egi=no
```

### 仅优选域名

```text
epd=yes&epi=no&egi=no
```

### 洛杉矶电脑测试

```text
epd=yes&epi=yes&egi=yes&mode=la&top=30
```

---

## 七、注意事项

1. 本工具只是订阅生成工具，不提供代理服务；
2. 生成的节点需要配合你自己的 VPS、Xray 入站和 WebSocket 路径使用；
3. `domain` 必须填写对应 VPS 的回源域名；
4. `path` 必须与 VPS 上 Xray 入站 WebSocket 路径一致；
5. 手机端如果出现大量 `-1`，建议关闭 GitHub 优选，即使用 `egi=no`；
6. 不建议给手机端一次性输出过多节点；
7. 多人使用时建议每个用户使用不同 UUID；
8. UUID 不同可以自动打散节点顺序，降低多人集中到同一批 CDN 入口的概率；
9. VMess 使用 `mess=yes` 开启，不使用 `vm=yes`；
10. 公开优选源会波动，实测稳定的内置域名优先级更高。

---

## 八、推荐分发策略

如果你有多台 VPS、多名用户，建议：

```text
每台 VPS 固定 domain 和 path
每个用户只更换 UUID
手机用户关闭 GitHub 优选
电脑用户可开启 GitHub 优选
每个用户输出 18～30 个节点
```

示例：

```text
用户A：
https://your-worker.pages.dev/UUID-A/sub?domain=vps1.example.com&epd=yes&epi=yes&egi=no&ev=yes&ipv6=no&dkby=yes&path=%2Fcdn1&top=25

用户B：
https://your-worker.pages.dev/UUID-B/sub?domain=vps1.example.com&epd=yes&epi=yes&egi=no&ev=yes&ipv6=no&dkby=yes&path=%2Fcdn1&top=25
```

两名用户虽然使用同一台 VPS，但因为 UUID 不同，订阅节点会自动打散。

---

## 九、免责声明

本项目仅用于自有服务器的订阅链接生成与网络连接优化测试。
请遵守当地法律法规及 Cloudflare、VPS 服务商相关服务条款。
工具本身不存储用户流量，不提供代理节点，不负责第三方优选源的稳定性。
