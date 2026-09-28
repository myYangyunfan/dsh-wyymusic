# dsh-wyymusic

在 DeepSeek Harness 侧栏加一个独立入口「网易云音乐」，点开后**全屏接管主区域**，是一套自研的网易云音乐播放界面（不是 TUI、不是外链、不是官方客户端套壳）。

- 位置：侧栏 `sidebar.panellist`，`order: -1`，排在「插件」(=0) **之上**
- 主区：`main` 槽位注册 `wyymusic` 页，点开即整块替换主区域，可随时切回会话
- 音乐能力：**不调 CLI**。宿主半边直接走网易云 weapi/linuxapi/eapi，浏览器半边只打宿主的同源路由

支持的内核：`@deepseek-ai/dsh` ≥ 0.1.7（`sidebar.panellist` 自 0.1.7 起提供）。已实测 0.1.7-rc.2。

## 结构

| 半边 | 文件 | 职责 |
| --- | --- | --- |
| 宿主 | `lib/index.js` | `/wyymusic/*` 路由、登录态落盘、上游代理、音频流代理 |
| 宿主 | `lib/netease.js` | 网易云接口层（移植自 MIT 的 `dsh-music-player`，见 `LICENSE.dsh-music-player.txt`） |
| 宿主 | `lib/yrc.js` | 逐字歌词（YRC）解析 |
| 宿主 | `lib/fetch-limit.js` | 并发/速率限制 |
| 客户端 | `lib/client.js` | 侧栏图标 + 全屏 GUI（发现 / 排行榜 / 我的歌单 / 搜索 / 播放条 / 歌词） |
| 客户端 | `lib/vendor/qrcode.mjs` | 扫码登录二维码 |

仓库里另外两块：`design/`（原型 `proto.html` + 视觉方案 UI-PLAN.md + 差距台账 UI-GAP-LEDGER.md +
氛围架构 AMBIENT.md + `shots/` 截图证据）、`scripts/`（四条自检腿 + 一次性探针 `probe-seek.mjs`）。

`dsh.plugin.json` / `cordis.patch.yml` 是自装载声明：包自己往 loader 插一行 `dsh-wyymusic`，**不写 profile 的 patch 层**。

## 安装

前置：宿主内核 `@deepseek-ai/dsh` ≥ 0.1.7（`sidebar.panellist` 自 0.1.7 起提供；已实测 0.1.7-rc.2）。
包零运行时依赖 —— `react` 是 peer、`@deepseek-ai/dsh-client-ui-slots` 是宿主注入，都不用另装。

在应用的**设置 → 插件**里填安装源（或让 agent 用 `plugin_manager` 装），装完**重启应用**
（页内注入清单只在宿主 ready 时抓一次，刷新页面无效）。内核接受的写法与实测结论：

| 安装源 | 内核认成 | 说明 |
| --- | --- | --- |
| `github:myYangyunfan/dsh-wyymusic` | git | 可加 `#分支/标签` |
| `https://github.com/myYangyunfan/dsh-wyymusic` | git | 可加 `#分支/标签` |
| `git+https://github.com/myYangyunfan/dsh-wyymusic.git` | git | |
| `dsh-wyymusic` | npm registry | **尚未发布**，现在装会 404 |
| `<绝对路径>/dsh-wyymusic-0.2.0.tgz` | tarball | `npm pack` 的产物，见下 |

> ⚠️ git 源由 pnpm 经 `codeload.github.com` 拉包。实测**本机**这条线不通（`github.com` 的 git 协议正常、`codeload` 20s 超时），
> 所以本机装请用 tarball：`npm pack` 出 `dsh-wyymusic-0.2.0.tgz`，把它的**绝对路径**填进插件页。codeload 通的机器上三种 git 写法都能用。

### 开发联调：repo 直挂

改 repo 立即生效、不必重装（本机开发用）。把 repo 挂进 profile 的 `node_modules`：

```sh
node -e "require('fs').symlinkSync(require('node:path').resolve('.'), process.env.USERPROFILE + '/.dsh/profiles/desktop/node_modules/dsh-wyymusic','junction')"
```

再把包名加进 `~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles`，重启应用。

> ⚠️ 该 profile 是 `nodeLinker: hoisted` 且 `dependencies` 里只有 `@dsh-pack/all`：**下次从插件页装/卸任何东西时，pnpm 会把不在依赖图里的 `node_modules` 条目清掉**，junction 被剪掉 —— 现象是重启后入口消失，重跑上面那条即可。

> 官方 Harness 的内核打包在 `resources/app.asar` 里、跑在 Electron 主进程内，不监听本地端口，没法直接 curl 它验；要单独跑起来验见下方「开发自检」。

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
node scripts/harness-ambient.mjs   # 氛围编程：真内核 + 真浏览器 + 真音频 + 动效 oracle + 真点击跳转（61 项，出 4 张截图）
```

等价 `npm run i18n` / `smoke:host` / `smoke:client` / `harness`。排查"点了进度条不跳"这类只在实机出现的
问题时，用 `node scripts/probe-seek.mjs`（一次性探针：只打印观测值、不做断言）。

后两条的分工：jsdom 没有音频/排版/合成器，只能证明接线与开关；`harness-ambient` 用解出来的
内核树跑 `web` 模式（隔离 `DSH_HOME`，只读拷一份 cookie），验"对着真音乐它真的在动、切到对话
界面后还在"。前置与坑见该脚本头部注释。

## 合规

⚠️ 均为非官方接口 + 流播受版权保护音乐，**仅用于个人试听/学习**，违反平台 ToS，风险自担；账号风控风险由使用者承担。**严禁解灰/绕过版权限制。**

仅供个人学习与自用，请支持正版。

## 许可

本项目自身代码（`lib/index.js`、`lib/client.js`、`scripts/`、`design/` 等）以 **Apache-2.0** 许可开源 ——
全文见 [`LICENSE`](LICENSE)，版权归属见 [`NOTICE`](NOTICE)。

「网易云 API 访问层」的移植文件（`lib/netease.js` / `lib/yrc.js` / `lib/fetch-limit.js` /
`lib/vendor/qrcode.mjs`）仍是其原始的 **MIT** 许可，出处与版权逐项列在
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)；Apache-2.0 允许收录 MIT 代码，这些文件的许可不被替换。
