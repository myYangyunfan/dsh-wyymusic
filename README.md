# dsh-wyymusic

**简体中文** | [English](README.en.md)

在 DeepSeek Harness 侧栏加一个独立入口「网易云音乐」，点开后**全屏接管主区域**，是一套自研的网易云音乐播放界面（不是 TUI、不是外链、不是官方客户端套壳）。

- 位置：侧栏 `sidebar.panellist`，`order: -1`，排在「插件」(=0) **之上**
- 主区：`main` 槽位注册 `wyymusic` 页，点开即整块替换主区域，可随时切回会话
- 音乐能力：**不调 CLI**。宿主半边直接走网易云 weapi/linuxapi/eapi，浏览器半边只打宿主的同源路由

支持的内核：`@deepseek-ai/dsh` ≥ 0.1.7（`sidebar.panellist` 自 0.1.7 起提供）。已实测 **0.2.1-rc.2**（Desktop 44.7.0，2026-10-19 全量复验）/ 0.2.0-rc.1 / 0.1.7-rc.2。

> 0.2.1-rc.2 适配要点：`dsh.client.inject` 原先指向 `@deepseek-ai/dsh-client-ui-slots`，该包在新内核里**已不存在**
> （`slots` 服务改由 `@deepseek-ai/dsh-client-ui-renderer` 提供），0.2.2 起改指后者。旧值不会立刻报错（内核只把它当装配顺序提示），
> 但那是随包发布的陈旧元数据，一旦内核开始校验就是硬失败。

**0.2.2 变更**（适配 0.2.1-rc.2，逐项真机验证过；逐条证据见 [`docs/kernel-compat-0.2.1.md`](docs/kernel-compat-0.2.1.md)）：

| 项 | 改动 | 为什么 |
| --- | --- | --- |
| `dsh.client.inject` | `…-ui-slots` → `…-ui-renderer` | 前者在新内核里不是插件包（是 shell 的静态 seed 模块），指向它等于没写 |
| 侧栏 label | 硬编码中文 → 宿主 locale thunk | 英文界面下 tooltip 一直是中文；只有 locale 服务变更才会重投影 |
| 氛围层 `order` | `0` → `-10` | 与官方 toast 同档且后注册，会画在提示条之上并参与 `mix-blend-mode` 混色 |
| 背景层自愈 | 重建前判 `isConnected` | 宿主 frame 重挂（HMR/布局重建）后旧节点已脱离文档 → 背景层静默永久消失 |
| home 解析 | 改用内核 `dshHomePath` 服务 | 部署若改用「显式配置的 home」，cookie/prefs 才不会仍写进 `~/.dsh` |
| 插件页元数据 | 新增 `locale/{zh,en}.json` + `icon.svg` | 内核**不读** `dsh.plugin.json`，标题/描述/图标只认这两样 |
| 安装 | 新增 `scripts/install.mjs` | dependencies / bundles / junction 三处一次改对，幂等、可 `--uninstall` |

**0.2.3 变更**（安全面，逐条真机验证）：

| 项 | 改动 | 为什么 |
| --- | --- | --- |
| 路由守卫 | Host 白名单（非监听地址 403）+ 写操作同源（`Origin` / `Sec-Fetch-Site`） | 内核 webServer 路由零鉴权：挡 DNS rebinding 与跨站表单 POST（`/api/logout` 这类只看方法） |
| body 上限 | `readBody` ≤ 64 KiB，超限 413 并断连 | 原实现 `for await` 无限收 body，本机 DoS 面 |
| 流并发上限 | `/stream` 同时 ≤ 4 条，超出 429 | 多 `<audio>` 同时 seek / 循环取链会堆上游连接、白耗 VIP 取链权益 |
| Cookie 上送 | `/stream` 不再带 cookie 取流 | 实测 6 个 CDN 节点带不带 cookie 都是 206/1024B；而直链是 `http://`，明文发 `MUSIC_U` 只是白给 |
| 错误回传 | 500 只说 `internal error`（细节进日志）；502 只回末次状态码 | 原样透传上游/本机错误原文 = 情报泄露 |
| 回归 | 新增 `scripts/probe-security.mjs`（8 条） | 该拒的拒了、该放的没被误伤，两者都要有人盯着 |

## 安装

前置：宿主内核 `@deepseek-ai/dsh` ≥ 0.1.7。包零运行时依赖 —— `react` 是 peer、
`@deepseek-ai/dsh-client-ui-renderer`（旧内核为 `-ui-slots`）由宿主注入，都不用另装。

装完**必须重启应用**（bundle 列表与页内注入清单只在宿主启动时读一次，刷新页面无效）。

### 一行装（本机/开发推荐）

```sh
node scripts/install.mjs            # 装进 $DSH_HOME/profiles/$DSH_PROFILE（默认 desktop）
node scripts/install.mjs --dry-run  # 只打印将要改的三处
node scripts/install.mjs --uninstall
```

它把内核加载所需的**三处**一次改对、幂等可重跑：profile 的 `dependencies` 写 `link:<repo 绝对路径>`、
`dsh.profile.bundles` 追加 `dsh-wyymusic`、`node_modules/dsh-wyymusic` 建 junction 指向本仓库
（旧链接指错目标会被拆掉重建，并备份 `package.json`）。**不跑 pnpm**，所以不会动 profile 里别的包，也不受网络影响。

### 插件页安装

在应用的**设置 → 插件**里填安装源（或让 agent 用 `plugin_manager` 装）。内核接受的写法与实测结论：

| 安装源 | 内核认成 | 说明 |
| --- | --- | --- |
| `<本仓库的绝对路径>` | link | **本机最稳**，等同上面的一行装；改代码重启即生效 |
| `github:myYangyunfan/dsh-wyymusic` | git | 可加 `#分支/标签` |
| `https://github.com/myYangyunfan/dsh-wyymusic` | git | 可加 `#分支/标签` |
| `git+https://github.com/myYangyunfan/dsh-wyymusic.git` | git | |
| `dsh-wyymusic` | npm registry | **尚未发布**，现在装会 404 |
| `<绝对路径>/dsh-wyymusic-0.2.2.tgz` | tarball | `npm pack` 的产物 |

> ⚠️ 两种 git 写法都依赖 `github.com`/`codeload.github.com` 的连通性，**两条线在本机都不稳**
> （实测会轮流出现 `RPC failed; HTTP 504` / `ERR_PNPM_FETCH_504`，报错出现在 pnpm 侧、与插件无关）。
> 本机请优先用**绝对路径（link）**或 tarball；git 源留给网络正常的机器。

### 开发联调：repo 直挂

改 repo 立即生效、不必重装 —— 就是上面一行装的默认形态（junction 直挂）。

> ⚠️ 该 profile 是 `nodeLinker: hoisted`：**下次从插件页装/卸任何东西时，pnpm 可能把不在它依赖图里的
> `node_modules` 条目清掉**，junction 被剪掉 —— 现象是重启后入口消失。重跑 `node scripts/install.mjs` 即可
> （`dependencies` 里已留 `link:` 条目，pnpm 下次也会照它重建）。

> ⚠️ 覆盖**同一个路径**的 `.tgz` 后重装，pnpm 会说 `Already up to date` 不刷新（实测：先 `pnpm remove dsh-wyymusic` 再 add 才换新）。版本号变了就是新路径，不受影响。

> 官方 Harness 的内核打包在 `resources/app.asar` 里、跑在 Electron 主进程内；`dsh` CLI **拒绝以 `--profile desktop` 启动**
> （桌面 profile 由 Electron 应用独占）。要单独跑起来验见下方「自检」的 `probe:boot` / `probe:host`。

## 结构

| 半边 | 文件 | 职责 |
| --- | --- | --- |
| 宿主 | `lib/index.js` | `/wyymusic/*` 路由、登录态落盘、上游代理、音频流代理 |
| 宿主 | `lib/netease.js` | 网易云接口层（移植自 MIT 的 `dsh-music-player`，见 `LICENSE.dsh-music-player.txt`） |
| 宿主 | `lib/yrc.js` | 逐字歌词（YRC）解析 |
| 宿主 | `lib/fetch-limit.js` | 并发/速率限制 |
| 客户端 | `lib/client.js` | 侧栏图标 + 全屏 GUI（发现 / 排行榜 / 我的歌单 / 搜索 / 播放条 / 歌词） |
| 客户端 | `lib/vendor/qrcode.mjs` | 扫码登录二维码 |

仓库里另外三块：`design/`（原型 `proto.html` + 视觉方案 UI-PLAN.md + 差距台账 UI-GAP-LEDGER.md +
氛围架构 AMBIENT.md + `shots/` 截图证据）、`scripts/`（自检腿 + 真机探针 `probe-boot` / `probe-host-routes` /
一次性探针 `probe-seek`）、`docs/`（[内核兼容性审计](docs/kernel-compat-0.2.1.md) +
[0.2.2 真机验收与截图](docs/verify-0.2.2.md)）。

`dsh.plugin.json` / `cordis.patch.yml` 是自装载声明：包自己往 loader 插一行 `dsh-wyymusic`，**不写 profile 的 patch 层**。
（注意：`dsh.plugin.json` 内核**不读**，插件页的标题/描述/图标来自 `locale/{zh,en}.json` 与 `icon.svg`。）
`locale/` 与 `icon.svg` 只服务插件页展示；运行时文案仍走 `lib/client.js` 自己的 STR 表。

## 宿主路由

全部挂在 `webServer` 的 `prefix: /wyymusic` 下，同源、无 CORS。

| 路由 | 方法 | 说明 |
| --- | --- | --- |
| `/wyymusic/api/status` | GET | 登录态（`loggedIn` / `userId` / `nickname` / `vipType`） |
| `/wyymusic/api/qr` | GET | 取扫码登录二维码 key |
| `/wyymusic/api/qr/check` | GET | 轮询扫码结果，成功后落盘 |
| `/wyymusic/api/import-musicfox` | POST | 从 go-musicfox 的 cookie jar 一键导入（免二次扫码） |
| `/wyymusic/api/logout` | POST | 清登录态 |
| `/wyymusic/api/search` | GET | 搜歌曲 / 歌单 / 歌手 |
| `/wyymusic/api/toplists` | GET | 榜单列表 |
| `/wyymusic/api/toplist/songs` | GET | 榜单曲目 |
| `/wyymusic/api/recommend` | GET | 推荐歌单 |
| `/wyymusic/api/categories` | GET | 分类歌单标签 |
| `/wyymusic/api/category/playlists` | GET | 分类下的歌单 |
| `/wyymusic/api/playlist` | GET | 歌单详情 |
| `/wyymusic/api/playlist/subscribe` | POST | 收藏 / 取消收藏歌单 |
| `/wyymusic/api/myplaylists` | GET | 我的歌单 |
| `/wyymusic/api/lyric` | GET | 歌词（含逐字 YRC） |
| `/wyymusic/api/songurl` | GET | 取播放地址（返回的是同源 `/wyymusic/stream?id=`，不暴露上游 CDN） |
| `/wyymusic/api/prefs` | GET / POST | 界面偏好：语言、最近播放、**氛围设置**（POST 局部合并，数值逐项 clamp） |
| `/wyymusic/stream` | GET | 音频流代理（带 cookie 取流后转出） |
| 其他 | * | `404 {ok:false,error:"not found"}` |

## 安全边界

宿主半边是**同源代理**：浏览器不直连网易云（CORS + cookie），所有请求都打到宿主自己的 `/wyymusic/*`。
内核的 `webServer` 路由表**不带任何鉴权**（它的 README 原话："It knows no harness concepts"），所以这些路由的
第一道闸必须由插件自己立。0.2.3 起有下面四道：

| 面 | 做什么 | 挡的是 |
| --- | --- | --- |
| Host 白名单 | 只接受内核实际监听的地址（+ `127.0.0.1` / `localhost` / `[::1]`），其余 403 | **DNS rebinding**：攻击者域名解析到 127.0.0.1 后，浏览器发来的 Host 仍是他的域名，而 GET 是简单请求、响应体照读 |
| 写操作同源 | `POST` 必须有同源 `Origin`（或 `Sec-Fetch-Site: same-origin/none`）；`cross-site` 一律 403 | **跨站表单 POST**：这类请求不走 preflight，只看方法就能打 `/api/logout` |
| body 上限 | JSON body ≤ 64 KiB，超限 413 并断开连接 | 任意大的 body 全收进内存（本机 DoS 面） |
| 流并发上限 | `/stream` 同时最多 4 条上游流，超出 429 | 页面里多个 `<audio>` 同时 seek / 脚本循环取链 → 堆上游连接、白耗 VIP 取链权益、触发网易风控 |

另外两条**凭据卫生**：

- `/stream` **不再把 Cookie 发给上游 CDN**。实测（2026-10-20，VIP 登录态，lossless 直链）：同一份签名 URL 在
  `m701/m702/m703/m801/m802/m803` 上「带 cookie」与「不带 cookie」都是 `206` + 同样的 1024 字节 —— 直链本身
  就是签名授权的。网易返回的是 `http://` 直链，把 `MUSIC_U` 明文发出去只是白给（同网段可截获）。
- 500 错误对外只说 `internal error`，细节进内核日志；502 只回末次状态码，不回上游错误原文（那是本机网络细节）。

> ⚠️ 这些**不是身份认证**。绑到非回环地址时，同一网络里的人仍可直接调用这些接口（那是部署者的选择，插件不改绑定）。
> 要真隔离，请把 webserver 绑回 `127.0.0.1`，或在前面挂带鉴权的反向代理。
>
> 回归：`node scripts/probe-security.mjs http://127.0.0.1:<port>`（8 条，既测「该拒的拒了」，也测「该放的没被误伤」）。

## 氛围编程（突破插件窗口）

歌曲的氛围可以铺到**插件面板之外**的对话界面上。入口在音乐页**左栏下栏**：两个快捷开关
（氛围背景 / 律动条）+ 一个总设置按钮。

| 效果 | 它是什么 | 挂在哪 |
| --- | --- | --- |
| 氛围背景 | **全屏歌词那套背景**（模糊封面 + 取色地板）以 60% 不透明度铺在对话界面**最底下**；只迁移位置、不变颜色 | 宿主 frame 的**第一个子节点**（在所有列之下，靠对话列透明透出来） |
| 聚光灯 | 屏幕**左上 / 右上两盏丁达尔光柱**，各自朝屏幕中心倾斜，随节拍摇曳 + 闪光（对话界面也亮） | 同上 |
| 律动条 | 对话栏最下方 72 根频谱柱（默认 56px 高），随声音跳动，重音时整条呼吸 + 底沿闪光 | 同上 |
| 打字音符 | 在对话框打字时，光标右上方蹦出一个小音符，760ms 自己消失 | 同上（document 级只读观测输入） |
| 设置点律动 | 氛围设置页里的每个开关随节拍左右晃动 + 闪光 | 设置面板内（`--amb-beat` 由 rAF 写入） |

设置面板底部常驻一行**播放诊断**（`rs` / `range` / 最近一次 seek 的结果）—— 遇到"点了进度条不跳"这类
只在别人机器上出现的问题，那一行就是现场。

关键点：这些效果挂在宿主 **`shell.overlay`** 而不是 `main` —— 后者在切到对话界面时会被卸载，
挂里面等于"一离开音乐页就没了"。设置落盘在 `prefs.json` 的 `ambient` 字段（与语言/最近播放同源）。

成本口径：一张缓慢漂移的背景封面 + 72 根柱子（实测 77 个 DOM 节点），**只写 transform**，无 canvas、无 `filter: blur()`；播放中 30fps、
暂停降到 12.5fps、总开关关闭 0 帧。音频分析走 `captureStream() + AnalyserNode` 的**只读旁支**
（不接 destination，不影响出声）。架构、宿主侧实测坑与逐条反证见 [`design/AMBIENT.md`](design/AMBIENT.md)。

## 登录态

落盘在 `$DSH_HOME/wyymusic/cookie.json`（mode `0600`）。两条获取路径：扫码，或从 go-musicfox 的 cookie jar 导入（Windows 在 `%LOCALAPPDATA%\go-musicfox\cookie`）。**cookie 只在本机使用，不上传任何地方。**

## 自检

```sh
node scripts/i18n-check.mjs        # 静态守卫：表外不许有中文字面量、STR 表必须两列
node scripts/smoke-host.mjs        # 宿主半边：真实打网易云接口（18 项）
node scripts/smoke-client.mjs      # 客户端半边：jsdom 里真渲染（48 项，含氛围层的开关与反证）
node scripts/probe-host-routes.mjs # 真内核里打 12 条宿主路由（登录态/搜索/榜单/取链/Range 流/prefs/404）
node scripts/probe-security.mjs     # 同源守卫 8 条（伪造 Host / 跨站 Origin / 超大 body / 误伤对照组）
node scripts/probe-boot.mjs        # 真内核 + 真 Edge：启动图条目、侧栏入口、main 槽接管、全量报错
node scripts/harness-ambient.mjs   # 氛围编程：真内核 + 真浏览器 + 真音频 + 动效 oracle + 真点击跳转（61 项，出 4 张截图）
```

等价 `npm run i18n` / `smoke:host` / `smoke:client` / `probe:host` / `probe:boot` / `harness`。排查"点了进度条不跳"这类只在实机出现的
问题时，用 `node scripts/probe-seek.mjs`（一次性探针：只打印观测值、不做断言）。

后三条的分工：jsdom 没有音频/排版/合成器，只能证明接线与开关；`probe-boot` 不打桩 —— 页面是内核自己吐的
index、`__DSH_BOOT__` 是内核自己组合的启动图、点击是真 DOM 点击，用来抓「换内核后到底哪一步漂移了」；
`harness-ambient` 用解出来的内核树跑 `web` 模式（隔离 `DSH_HOME`，只读拷一份 cookie），验"对着真音乐它真的在动、
切到对话界面后还在"。三条都要求一份**解出来的内核树**（`DSH_KERNEL_DIR`，默认 `D:/workspace/_dsh_kernel/dsh`）：

```sh
# 从已安装的 Desktop 里解出内核树（app.asar 是 Electron 归档，纯 node 读不了，需要 asar 工具）
npx @electron/asar extract "C:/Users/<你>/AppData/Local/Programs/DeepSeek Harness/resources/app.asar" ./_dsh_kernel_raw
# 再把 resources/app.asar.unpacked/dsh/* 覆盖进去（原生模块：node-pty / @img / koffi …）
```

前置与坑见各脚本头部注释。

> 桌面 profile 由 Electron 应用独占（CLI 明确拒绝 `--profile desktop`），所以这三条真机腿都用**同 bundle 列表的另一个
> profile 名**（如 `web`）在隔离 `DSH_HOME` 里跑，验完不影响真实安装。

## 合规

⚠️ 均为非官方接口 + 流播受版权保护音乐，**仅用于个人试听/学习**，违反平台 ToS，风险自担；账号风控风险由使用者承担。**严禁解灰/绕过版权限制。**

仅供个人学习与自用，请支持正版。

## 许可

本项目自身代码（`lib/index.js`、`lib/client.js`、`scripts/`、`design/` 等）以 **Apache-2.0** 许可开源 ——
全文见 [`LICENSE`](LICENSE)，版权归属见 [`NOTICE`](NOTICE)。

「网易云 API 访问层」的移植文件（`lib/netease.js` / `lib/yrc.js` / `lib/fetch-limit.js` /
`lib/vendor/qrcode.mjs`）仍是其原始的 **MIT** 许可，出处与版权逐项列在
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)；Apache-2.0 允许收录 MIT 代码，这些文件的许可不被替换。

## 交流群

装不上、有 bug、想加功能 —— 欢迎来群里说（群号 **1090365627**），也欢迎直接开 [Issue](https://github.com/myYangyunfan/dsh-wyymusic/issues)。

<img src="assets/qq-group.jpg" alt="【DSH】鲸小子交流群二维码，群号 1090365627" width="320">