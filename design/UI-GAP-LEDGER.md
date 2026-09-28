# 原型 vs 实物 差距台账（逐条 · 全部实测）

> 判据来源不是"读代码觉得像"，而是**同一台机器、同一视口（1600×1000）、同一套探针**在
> 设计原型（`design/proto.html`）和真实插件（宿主 web 模式 + 隔离 `DSH_HOME`）两边各跑一遍，
> 把两棵树**同构地**摊平成指纹 JSON，再逐键 diff。
> 探针：`%TEMP%/wyy-fingerprint.js`（页面内只读，CSSOM 侧用 `declared()` 读**作者写下的公式**而不是计算值，
> 否则 `calc(var(--x)+var(--y))` 会被折叠成一个数，差距就看不见了）。
> 腿：`wyy-fp-proto.mjs` / `wyy-fp-plugin.mjs` → `cdp-wyy4.mjs` → `wyy-fp-extract.mjs` → `wyy-fp-diff.mjs` → `wyy-fp-tally.mjs`。
> 截图证据：`design/shots/`（19 张，proto-* 与 plugin-* 成对）。

## 0. 差距的账，四个数

| 口径 | A 轮修复前 | A 轮修复后 | **本次全量回归** | 说明 |
|---|---|---|---|---|
| 逐屏逐键实例（raw） | 204 | 206 | **209** | 含"同一套写法 × 不同实时数据"（时长、进度、条数会随当次抓取变） |
| 归一化后（把纯数据量差异折成同一条） | 178 | 175 | **178** | 真正指向"写法不同"的 |
| 恰好消失集（修完只剩数据差 → 不再是差距） | 26 | 31 | **31** | 与 A 轮持平 |
| 归并后的差距**键位**数 | 52 | 46 | **47** | 每个键位是一条可执行的改进项 |

本次比 A 轮 +3 实例 / +1 键位，逐条对得上，且**产品侧零改动**（产品文件 mtime 全部 ≤ 09-28 00:35:32，
本次所有腿都在 01:0x 之后跑）：

- `band.box[]` 6 → 7、`np.box[]` 1 → 2（B 类）：两键都在几何 **2px 容差**边缘进出 —— `box[0]`（宽度
  1319 vs 1070 / 1329 vs 1600）每屏都在，浮动的是 `box[1]`（高度随当次取到的唱片/播放条高度）。
- `np.onColor` 是本次新出现的**键位**（D 类）：全屏墨色 `rgb(24,24,24)` vs `rgb(245,245,245)`，
  与 `np.blurBg` 是同一条设计决定（封面底光 + 浅墨），见 D 表。
- 其余 44 个键位逐条与 A 轮一致（含 raw 口径里 `card.sub` 6 条、`band.meta[]` 7 条这类"实例数一样、内容不同"的）。

7 个视图一一配对（发现 / 排行榜 / 我的 / 搜索 / 歌单详情 / 全屏歌词 / 第二个歌单详情），
每屏另加 `## 标题 [proto#n / plugin#n]` 分节，杜绝跨屏错配。

47 个键位的去向（实例数按本次归一化后的 tally 实算；**成员显式列出**，以后每趟回归都按同一口径重算）：

| 类 | 键位 | 实例 | 成员（键位） |
|---|---|---|---|
| A 本轮已修 | — | 5 条降级 | 改完并复验，见 A 表（已不在本清单里） |
| B 容器宽度派生 | 9 | 49 | `top.h[]` `band.box[]` `bar.h[]` `row.box[]` `card.cover[]` `tile.box[]` `np.box[]` `np.art[]` `np.columns[][]` |
| C 数据量 / 当次文案 | 20 | 82 | `chips.labels[]` `sections[].kids` `bar.title` `bar.sub` `card.name` `card.n` `card.sub` `sections[].rows` `row.n` `row.title` `row.sub` `band.title` `sections.length` `tile.name` `chips.n` `band.meta[]` `band.sub` `band.meta.length` `np.title` `np.artist` |
| D 有意偏差 | 11 | 29 | `band.tools[].bg` `band.tools[].text` `band.tools[].box[]` `band.tools.length` `layout.np.padding` `sections[].links[]` `sections[].links.length` `rail.nav[].bg` `np.blurBg` `np.onColor` `row.badges.length` |
| F 状态 / fixture 坑 | 7 | 18 | `bar.like` `row.idxNum` `row.album` `np.lyricN` `np.onText` `np.hasPast` `chips` |

（实例数 49+82+29+18 = **178**、键位 9+20+11+7 = **47**，与归一化总数**恰好对上**，所以这张表不是"举例"而是穷举。
E 类"故意不做"不在指纹里：原型有、上游接口没有的能力，diff 抓不到。
上一版台账里 21/86/26/16 的划法是同一批键位的另一种**边界**（把"计数注解 / 未登录工具集"那几条并进了 C 类），总和 175 相同；
从本次起以本表的成员列表为准。）


---

## A. 本轮已修（改完并复验，每条给出实测数）

| # | 差距 | 之前 | 现在（实测） | 落在哪 |
|---|---|---|---|---|
| A1 | 快选磁贴的字压在封面像素上 | 76px 封面 + 76% 字宽，两框**重叠 33px** | 56px 封面 + 58% 字宽，**SAT 6/6、零相交，最近 4.18px** | `.wyy-tile-*`；守卫已把不相交写成几何不变量 |
| A2 | 色带里的统计量被挤掉 | 作者排第一，"共 N 首"落在最后 | 顺序照原型：首数 · 播放量 · 作者；布局净空 **7px** 无溢出 | `Playlist`/`Rank`/`Mine` 的 `ArtBand.meta` |
| A3 | 播放量排版两套 | `4096.2万`（一位小数、无空格） | 与原型 `fmtPlay` 一致：`4096 万` / `65.0 亿`（数字与万/亿之间留一格，万位取整）→ 5 条差异降级成数据差 | `client.js:271` `fmtCount` |
| A4 | 榜单卡片没有副信息行 | 只有作者 | `播放量 · 作者`，**62/62 张**都有 | `Rank` 的 `ToplistGrid` |
| A5 | 搜索类型比原型少档 | 无 MV / 歌词档 | **6 档 × 30 条**（单曲/歌单/歌手/专辑/MV/歌词），标签走 i18n | `client.js:2042` `TYPES` |
| A6 | 曲目行专辑副行缺失 | 26/30 | **30/30** | `showAlbum` 栅格 |
| A7 | 搜索档位名硬编码中文 | 表外字面量 | `typeMv`/`typeLyric` 等进表，**STR 121 条 · 表外中文字面量 0**；EN 下计数串守卫通过 | `client.js:139-143` |
| A8 | 播放条音量图标 React key 冲突 | `Each child in a list should have a unique key` 警告 | 补 `key:'i'`，console.error **0 条** | `PlayerBar` 音量簇 |
| A9 | **最近播放副行永远空着**（真实链路缺陷，三层） | 客户端存了 `playCount/creator`，宿主白名单只留 `id/name/cover` ⇒ 落盘即丢；详情页两处 `playFrom` 建源时又没带计数；空副行还渲染一个空 `div` 顶出 4px 半行空白 | 白名单放行两字段 + `:1749/:1827/:1858` 三处带 `meta`/`first` 计数 + 没话不占行。实测 `副行 4/6 张（有量并说出量的 3 张，空元素 0 个）`，盘上 `playCount=30775274/34834012`，**旧条目仍只有 id/name/cover**（证明是这次写进去的，不是本来就有） | `index.js` `cleanRecent`、`client.js` `PlaylistGrid` |
| A10 | 左栏/壳层结构（上一轮） | 侧条贴在主体卡片内部 | 通高左栏贴屏幕左缘 + 右侧浮起主体卡片；24 项几何探针全绿 | `UI-PLAN.md` §11 |

**A9 的验证过程本身也修了两次仪器**（都记在这儿，因为它们曾是假红）：
判据先写成"存了 6 条" —— 而 6 只是发现页的**显示切片**，存储上限是 `RECENT_MAX = 8`；
改成"置顶 + 去重 + 上限"的转移判据后实测 `n=7，位置 1 → 0`。
反证也差点空过：主判据还红着就断言"不存在的 id 必须判红"，等于什么都没测；
现在要求**主判据先绿**再做反证（实测输出：`主判据绿（n=7…）且不存在的 id 判红`）。

---

## B. 容器宽度派生，不是设计差距（9 键位 / 49 实例）

插件面板是宿主里一块可拖拽的面板，原型是整页。视口宽度差 99px（1319 vs 1070 的可用宽），
下面这些键位全部由它线性导出，**改设计也改不掉**：

`top.h[]` 1329 vs 1080 · `band.box[]` 1319 vs 1070 · `bar.h[]` · `row.box[]` 1255 vs 1006 ·
`card.cover[]` 161 vs 153 · `tile.box[]` 199 vs 158 · `np.box[]` `np.art[]` `np.columns[][]`

判据：把插件视口拉到与原型同宽（1600 整页 vs 宿主面板内），这些差值按同一比例收缩到 0。
（`np.columns` 的 2098 vs 788 是全屏歌词左右两栏的高度，随歌词行数与视口同时变，属同一类。
`band.box[]` / `np.box[]` 的实例数会在几何 **2px 容差**边缘上下跳一格 —— 本次各 +1 就是这么来的，不是新差距。）

## C. 数据量与真实文案（20 键位 / 82 实例）

同一次抓取下，两边喂的是**同一份接口**，但原型用的是 `proto-data.json` 快照：

`sections[].kids` 8 vs 30 · `sections[].rows` · `card.n` 18 vs 36 · `row.n` 6 vs 30 ·
`sections.length` 3 vs 4 · `band.title/name/tile.name/row.title/bar.title/bar.sub`（**都是当次真实曲名/歌单名**）·
`chips.labels[]` 16 处（推荐标签云是实时接口）· `chips.n` 15 vs 12（原型搜索页有 `排行榜/歌单关键词/用户` 三档，
上游没有，见 E 类）· `band.meta.length` 2 vs 3（原型快照那条歌单没带创建者）

这一类的正确处理是"折成同一条"，不是"改成一样" —— 归一化 diff 已经这么做了。

## D. 显著**有意**偏差（照抄原型会违反体系自己的规则）

| 键位 | 原型 | 插件 | 为什么故意 |
|---|---|---|---|
| `band.tools[].bg` 5 处 | `rgb(236,65,65)`（`#ec4141`，白字实测 **3.89:1**，不达 4.5） | `rgb(215,53,53)`（`--wyy-brand-fill #d73535`，规范 **4.68:1**、像素实测 **4.72:1**） | L1 规则：带白字的红底走 fill 变体。抄原型会连它违反自己规则的地方一起抄 |
| `layout.np.padding` 7 处 | `var(--s-N) var(--s-N)` | 顶部多一项 `calc(var(--dsh-frame-top-clearance,Npx) + var(--s-N))` | 宿主标题栏压在上面，不给净空就被遮 |
| `sections[].links[]` 7 处（+ `.links.length` 1 处） | `全部` / `更多`（点了没反应的死链） | `共 N 个`（计数注解） | 原型是静态稿；插件里不放无行为的按钮 |
| `rail.nav[].bg` 1 处 | 透明 | 浅主题 `rgb(239,239,240)` | 左栏要与主体卡片异色分界（§11 的判据） |
| `np.blurBg` 1 处 | false | true | 宿主里封面底光叠 backdrop-filter 才有全屏感；对比度由 §9 的像素判据把关（未唱 4.09–5.29） |
| `np.onColor` 1 处 | `rgb(24,24,24)`（页面墨） | `rgb(245,245,245)`（浅墨） | 与 `np.blurBg` 同一条决定：全屏 = 封面底光 + 浅墨；墨不让过渡表碰（§14.3 反证 D） |
| `band.tools[].text` / `.box[]` 各 1 处 | `+ 收藏`（宽 73px） | `返回`（宽 60px） | 同上「未登录工具集」：按钮宽度跟着字走，是内容差不是样式差 |
| `row.badges.length` 2 处 | 0 | 1 | 真实数据有 VIP/付费角标，原型快照没有 |
| `band.tools.length` 2 处 | proto 2 / 5 个 | plugin 1 / 4 个 | 未登录态只留一个红色主按钮（唯一红），登录后才展开全套 |
| 空副行 | — | 不渲染元素 | A9：空 `div` 会顶出 4px 半行空白 |

## E. 故意不做（原型里有、上游没有对应能力）

- 原型搜索页的 `排行榜` / `歌单关键词` / `用户` 三档：网易云非官方接口没有对应的搜索类型，
  做了就是**点了报错**的空壳，宁可少三档。
- 原型的"取色面板"浮层：那是**设计评审仪器**，不是产品界面；它的职责已经由 §9/§11 的自动化验收接管。

## F. 仪器与原型 fixture 坑（不是插件的差距，但会污染账目）

> 表里前 5 行（`bar.like` / `row.album` / `chips` / 歌词那一行的 3 个键 / `row.idxNum`）对应指纹 F 类的
> **7 个键位 / 18 条实例**；「历史条数」与「指纹腿跑错文件」两行是**仪器自身的坑**（本轮都修过并加了反证，见 §14.6）；
> 「冒烟腿写进真实 `~/.dsh`」「新 profile 弹窗」两行同理 —— 都不是 diff 键位，是仪器自己的越界/盲区。

| 现象 | 真相 |
|---|---|
| `bar.like` 7 处 proto=true vs plugin=false | 当次播放的那首**有没有被红心**，是账号状态不是样式；两腿播的是不同歌单 |
| `row.album` proto=`null` vs plugin=专辑名 | 原型 fixture 根本没填这列 —— 曾被读成"插件多了一行" |
| `chips` proto=`—`（缺键） vs plugin=65 个 4 行 | 原型搜索页没做标签云探针（注意与 C 类的 `chips.labels[]`/`chips.n` 分开：那两条是**两侧都有**、值不同） |
| `np.lyricN` 24 vs 65、`np.hasPast/onText` | 歌词行数与"当前播放到第几行"是**状态**，同一首歌两次跑都可能不同 |
| `row.idxNum` `N` vs 空 | hover/playing 态决定序号是否显示，两腿鼠标位置不同 |
| 历史条数 6 vs 8 | 显示切片 ≠ 存储上限。A9 里已把公开那条改成转移判据；**本轮发现 fp 腿自己也犯了同一个错**：收尾断言写死 `a.length !== 6`（6 是发现页 `slice(0,6)`，上限是 `RECENT_MAX = 8`），于是永远红。改成"前置快照 + 置顶 + 去重 + 上限 8"后实测 `n=7（前置 7）first=…`；并补了一条零样本收口（点的卡片必须不在榜首）与一台逻辑电池（8 份合成状态：3 绿 5 红，`%TEMP%/wyy-fp-rulerlog.mjs`），见 §14.6 |
| 冒烟腿写进用户真实 `~/.dsh` | `smoke-client.mjs` 挂的是宿主半边，落盘目录 = `DSH_HOME || ~/.dsh`。证据：`~/.dsh/wyymusic/prefs.json` 在 19:36:10 被改写，且条目带**本轮刚加的 `playCount`** ⇒ 是新代码写的。现在腿开头显式钉 `DSH_HOME=%TEMP%/dshhome-official`；前后对拍：真实 prefs mtime/大小不变、隔离那份被重写、25/25 仍全绿 |
| 指纹腿跑错文件 | 曾把上一轮的 steps 当本轮的跑，全绿但其实没测新东西。**本轮又抓到升级版：混合年份的输入** —— 重跑命令把两侧 cdp 腿的输出收进链日志，却没刷新 `wyy-fp-<side>.log`，而 extract 读的正是这两个文件 ⇒ 用 proto 19:10 的指纹 × plugin 19:14 的指纹算 diff，两侧连视图数都不同（**7 vs 4**），三个数塌成 101/85/16/31，**五桶却是全 0**。修法：链里每条腿只写下游真正读的文件 + 判据 `7 × 7` 指纹数必须相等（不等即红），见 §14.6 |
| 新 profile 首启 API Key 弹窗遮罩 | 覆盖整页，守卫正确拒绝测量却被误读成"没采到字" |

**纪律**（踩过假红/假绿才加的）：取样前等 320ms 过渡收敛；采样窗 = 自己的矩形 ∩ 全部裁剪祖先 ∩ 视口；
被整块裁掉的实例跳过并**计数并可断言**；每条新守卫配一条"必须变红"的反证。

---

## G. 用户报的交互缺陷（第五轮 · 不是原型差距，但记在同一本账上）

这几条**指纹 diff 抓不到**：原型（`proto-data.json`）里根本没有 LRC 署名行，也就没有"点它等于回曲首"的场景；
动效在原型里也只是"有过渡"。它们的判据只能来自**真页面上的行为**，所以单独立账。

| # | 报告 | 真根因（量出来的） | 修法与实测 |
|---|---|---|---|
| G1 | 点歌词还是有点跳回曲首 | 元数据丢失那条上一轮已修（`PENDING_SEEK`）；剩下的是**片头署名行**：LRC 头几行时间戳就是 `[00:00.000]`（作词/作曲/编曲/制作人），点了**等于**回曲首，一首歌 2~4 行，随机点命中率不低 | `t ≤ 0.05s` 的行标 `plain`：不给 handler、不给 `role=button`、`cursor:default`；歌词自动滚动在指针进入列表时冻结。实测点第 0 行：类名 `wyy-np-ly past plain`、role=null、窗口内 **0 条 seek 事件**、t 44.17 → 47.90s 照常前进（`%TEMP%/trace-run5.log`） |
| G2 | 动效（按 onetake 重做） | 之前只有"快/慢"两档体感：852px 的飞行给 900ms 无依据、峰值速度无上限、地板与封面同层同淡（飞行途中封面会淡出，"接续"就断了） | 曲线按峰值斜率分档（新增 `--ease-glide` 2.29）、时长由 `852px ÷ 2400px/s` 反推 ⇒ `--t-art` **1000ms**；地板挪成绝对定位兄弟层 `.wyy-np-ground`，320ms 淡入与封面 1s 实心飞行解耦。实测（两趟独立 `wyy-motion-r11/r12.log`，**7/7、断言失败 0**）：起手/收尾偏差 **0px**、峰值 **1925 / 1930px·s⁻¹ @67ms 窗**（单步 1945/1938 @33ms；设计值 1951）、**1114 / 1095ms**；抽屉 **278 / 259ms**、原点距按下点 0px；按压 **38 / 46ms、隔 1 次几何更新** |

| G3 | 换主题那 1–2 秒里，色带 / 播放条会不会撞成中间态 | 老实现按"当前主题"各取一次色 ⇒ 翻转那条链上有"表面已经翻了、调色盘还没跟上"的窗口：r4 实测播放条 **4.13:1**（底 `rgb(212,207,209)`、墨 `#5f5f66` @`.wyy-bar-sub`）。当时的处置是把等法改成"连续 3 次读数相同"，红就没了 —— 但那是**采样窗躲开了**，不是病好了 | 改成**一次像素扫描同时算出浅/深两套**（`artStyle` 写 `-l/-d` 共 16 项，主题块只换引用）⇒ 换主题同帧、零延迟、不碰网络；墨 `--art-on-l/-d` **有意不进**过渡表。ink 腿 **59 条断言 + 4 条反证全绿**（`%TEMP%/wyy-ink-r8.log`）：正式 1 色带 **4.8:1 / 中间态帧 0**；反证 A（底不翻）**3.63:1** 窗 506ms、反证 B（调色盘迟到）**4.13:1**（与 r4 读数逐字相同）、反证 C（掐掉滑行）中间值 **0 个 / 0ms**、反证 D（墨押后）**1.24:1** 窗 784ms —— 四条都**只塌自己那块面**，其余两块仍绿 |

**G1 的反证**：同一条腿里把第 0 行改回"可点 + `currentTime=0`"，仪器一次报出 5 条不合格
（时间倒退 47.91s、2.4s 只走了 −45.45s、`seeking@0 seeked@0`…）—— 绿是真绿，不是空跑。
**G2 的反证**：给 `.wyy-np-art` 打 `transition:none`，开场那条立刻判红（起手偏差 **852px**、峰值
**0px/s @0ms** —— 窗塌了也走"量不出速度"那条判红，不给假绿留门）。
**G2 的尺子修过第三次**（本轮全量回归时抓到）：峰值速度原按 `performance.now()` 读数算，而几何是按
**动画时间轴**的帧网格算出来的 —— 同一份产品在 r7/r8 两趟被判 2543/2518px·s⁻¹（假红），换钟后同一趟读出
**平顶 1939/1931/1930/1925/1921**（= 设计值 1951）。机制、五趟对照与"宿主掉帧不假红"的处置见
`UI-PLAN.md` §14.4。

仪器侧这一轮又清掉三处**假红/零样本**（细节见 `UI-PLAN.md` §14.1）：填充段按**元素自身**比例点
（90% 落在轨道上是 46%，被判"差 71.6s"）、`End` 之后拿**新歌**时长当分母（差 136.7s 全是自己造的）、
从 0.88s 按 ←（`max(0, cur−5)` 落在 0，和"没跳"分不开）。三处产品都是对的。

**全量回归那轮又清掉两类"红得很有道理、其实全是尺子"的**（机制与判据见 `UI-PLAN.md` §14.5）：

- **尺子还在问旧名字。** 双调色盘之后元素上写的是 `--art-band-l/-d` 这类**成对源令牌**，
  无后缀的 `--art-band` 只在样式表里做引用；而 a18 腿的探针与 `wyy-bandguard.js` 都还在读无后缀名
  ⇒ 读到空串 ⇒ 判"没染色" ⇒ 转去查"封面能不能取到" ⇒ 封面可达、`data-art=ok` ⇒ 记成"取色丢了"。
  a18 light/dark 各 9 条红全属此类，产品一直是对的。修完探针顺手把守卫**变强**：要求
  `-l/-d` **成对** + 本主题那套 ≠ **同名牌**的 L2 兜底 + 活跃令牌（计算值）确实指向本主题那一套
  （`.wyy-art` 引用链一断，色带会画出**页面的**调色盘 —— 这条以前没人查）。
- **兄弟腿留下的主题。** tilecp 的判据只在浅色态成立，而它不自己钉主题，链上前一条腿正是 a18 dark ⇒
  整条腿在深色下跑，`复现条件` 与 `反证B·旧公式必须报红` 同时红。现在它在开头自己点 `设置 → 浅色`
  并断言 —— **"前一条腿跑完是浅色"不是前置条件，是运气**（语言同理，i18n 腿早已钉过）。
  本轮还罚了一个**探针自身的 bug**：`waitDyed` 里 `new Promise((res) => setTimeout(r, 300))` 名字写错，
  取色没就绪的那两个视图直接抛 `ReferenceError`，后面的断言没等到染色就量（2 条红）。
  教训记成一条：**eval 抛异常不是"没量到"，是量错了** —— 现在跑完腿要顺带扫日志里的 `[eval] => ERR`。

---

## 复跑配方

```bash
# 差距账（两腿必须串行：共用隔离 DSH_HOME/wyymusic/prefs.json）
# **这两条 cdp 腿的输出必须落进 wyy-fp-<side>.log** —— extract 读的就是这两个文件（漏写 = 拿上一轮的指纹算账）
node %TEMP%/wyy-fp-proto.mjs   && node %TEMP%/cdp-wyy4.mjs %TEMP%/wyy-url-proto.txt %TEMP%/wyy-shots-fp-proto %TEMP%/wyy-steps-fp-proto.json > %TEMP%/wyy-fp-proto.log
node %TEMP%/wyy-fp-plugin.mjs  && node %TEMP%/cdp-wyy4.mjs %TEMP%/wyy-url-fp.txt  %TEMP%/wyy-shots-fp-plug %TEMP%/wyy-steps-fp-plugin.json > %TEMP%/wyy-fp-plugin.log
node %TEMP%/wyy-fp-extract.mjs proto ; node %TEMP%/wyy-fp-extract.mjs plugin ; node %TEMP%/wyy-fp-diff.mjs ; node %TEMP%/wyy-fp-tally.mjs
# ← 做到这一步先看两侧指纹条数是否相等（本次 7 × 7）；不等 = 混年份/混视图，先修输入再谈账
# 判据电池：把 fp 腿那条"历史写盘"断言抽出来喂 8 份合成状态（3 绿 5 红），验它的每个分支
node %TEMP%/wyy-fp-rulerlog.mjs
# 台账自检：拿实测 diff 当"真值"，验本台账第 0 节那张类表是不是**恰好划分**（并集覆盖全部键位、四类两两不交）
node %TEMP%/wyy-check-classes.mjs
#   （反证已做：从 C 类删掉 `chips.n` → 报"没被任何一类认领"；把 `np.onColor` 同时抄进 F 类 → 报"重复认领"，两次都 exit 1）
# A9 那条链路（历史写盘 / 副行 / 白名单，含反证）
node %TEMP%/wyy-build-steps-histcheck.mjs && node %TEMP%/cdp-wyy4.mjs %TEMP%/wyy-url-hist.txt %TEMP%/wyy-shots-hist4 %TEMP%/wyy-steps-histcheck.json
# 交互：点条 / 点歌词 / 键盘 / 换歌瞬间，10 条判据 + 第 0 行那条反证（13/13）
node %TEMP%/wyy-build-steps-trace.mjs  && node %TEMP%/cdp-wyy4.mjs %TEMP%/wyy-url-trace.txt  %TEMP%/wyy-shots-trace5  %TEMP%/wyy-steps-trace.json
# 动效：逐帧量 carry / 峰值速度 / 实测时长，4 个 beat + 1 条反证（7/7；含一条"把原始几何摊出来"的诊断）
node %TEMP%/wyy-build-steps-motion.mjs && node %TEMP%/cdp-wyy4.mjs %TEMP%/wyy-url-motion.txt %TEMP%/wyy-shots-motion11 %TEMP%/wyy-steps-motion.json
# 过渡期对比度：换主题 4 条反证 + 换曲滑行 1 条反证（59 条断言；50ms 一帧采 色带/播放条/选中行 三块面）
node %TEMP%/wyy-build-steps-ink.mjs       && node %TEMP%/cdp-wyy4.mjs %TEMP%/wyy-url.txt %TEMP%/wyy-shots-ink       %TEMP%/wyy-steps-ink.json
# 取色：浅/深两套同源、全屏歌词地板、像素对比度（50 条断言）
node %TEMP%/wyy-build-steps-art-light.mjs && node %TEMP%/cdp-wyy4.mjs %TEMP%/wyy-url.txt %TEMP%/wyy-shots-art-light %TEMP%/wyy-steps-art-light.json
# 左栏/壳层几何：浅一趟、深一趟（13 条；两趟必须串行，共用隔离 prefs）
node %TEMP%/cdp-wyy4.mjs %TEMP%/wyy-url.txt %TEMP%/wyy-shots-railcp-light %TEMP%/wyy-steps-railcp-light.json
node %TEMP%/cdp-wyy4.mjs %TEMP%/wyy-url.txt %TEMP%/wyy-shots-railcp-dark  %TEMP%/wyy-steps-railcp-dark.json
# 色带 + 磁贴（浅/深各一趟）+ 磁贴采样窗 A/B 反证 + 多语言全视图遍历（四条腿，同样必须串行）
# 这四条腿**自己钉主题与语言**（开头点 设置→浅色、`.wyy-lang`→中文），别省：主题/语言是跨轮残留状态，
# 兄弟腿跑完留在深色时，tilecp 的"反证必须红"那条会假红（r4 实测，见 UI-PLAN §14.5）
node %TEMP%/wyy-build-steps-a18.mjs light && node %TEMP%/cdp-wyy4.mjs %TEMP%/wyy-url.txt %TEMP%/wyy-shots-a18-light %TEMP%/wyy-steps-a18-light.json
node %TEMP%/wyy-build-steps-a18.mjs dark  && node %TEMP%/cdp-wyy4.mjs %TEMP%/wyy-url.txt %TEMP%/wyy-shots-a18-dark  %TEMP%/wyy-steps-a18-dark.json
node %TEMP%/wyy-build-steps-tilecp.mjs    && node %TEMP%/cdp-wyy4.mjs %TEMP%/wyy-url.txt %TEMP%/wyy-shots-tilecp    %TEMP%/wyy-steps-tilecp.json
node %TEMP%/wyy-build-steps-i18n.mjs      && node %TEMP%/cdp-wyy4.mjs %TEMP%/wyy-url.txt %TEMP%/wyy-shots-i18n      %TEMP%/wyy-steps-i18n.json
# 或者一条链跑完全部（串行，约 35 分钟；把上面所有腿 + fp 差距账 + 两条冒烟按序跑掉，逐腿落日志）
# 链自己带趟戳（日志名 -r5 → -<戳>，截图目录同样带戳并落在 %TEMP%）；早先没给截图目录加临时目录前缀，
# 6 个 wyy-shots-fp-*-rN 目录漏进了仓库根（本轮已搬回 %TEMP%，脚本已修）
node %TEMP%/wyy-regress-all.mjs
# 仪器自检：steps JSON 里每个表达式先过语法闸（省一次 5 分钟的跑腿）
node %TEMP%/wyy-check-steps.mjs %TEMP%/wyy-steps-ink.json
node scripts/smoke-host.mjs        # 17/17（真连网易云；DSH_HOME 显式钉到隔离目录，别让它落真实 ~/.dsh）
node scripts/smoke-client.mjs      # 25/25（腿自己把 DSH_HOME 钉到 %TEMP%，不写真实 ~/.dsh）
node scripts/i18n-check.mjs        # 表外中文字面量 0 + 不许再有第二个叫 t 的绑定
```

每趟跑完看**五个桶**（前四个都必须是 0，最后一个必须是 0）：`页面异常` / `console.error` / `网络 >=400` /
**`探针异常`** / `断言失败`。第五个桶是 r5 加的：`eval` 抛异常不是"没量到"，是**量错了** ——
探针自己写错名字时异常被吞成一行 ERR，紧跟的断言在"根本没等"的状态下量，红的是产品、病在尺子
（a18 r5 实测：`waitDyed` 里 `setTimeout(r,300)` 的参数名写错 ⇒ 两个视图各假红一条）。

**最近一次全绿记录（全量回归那轮）：13 趟浏览器腿 + 2 条冒烟，全部串行跑过，[PASS] 型断言 335 条。**

| 腿 | 断言 | 五桶 |
|---|---|---|
| a18 浅 / 深（r6） | 23 / 23 | 0 |
| tilecp 磁贴采样窗（r6） | 17 | 0 |
| i18n 全视图 · 双语（r6） | 45 | 0 |
| ink 过渡期对比度（r10） | 59 | 0 |
| art-light 取色 / 地板（r10） | 50 | 0 |
| railcp 左栏几何 浅 / 深（r4） | 13 / 13 | 0 |
| trace 点条 / 点歌词 / 键盘（r7） | 15 | 0 |
| hist 历史链路（r5） | 8 | 0 |
| motion 动效 oracle（r13） | 7 | 0（唯一 ≥400 是**外部封面 CDN** 对某张图 404，重取仍是 404） |
| fp 差距账 proto + plugin（r7） | 7 + 13 | 0（proto 腿唯一 ≥400 是本地静态服务器 `favicon.ico`） |
| `smoke-host` / `smoke-client`（r5） | 17 / 25 | —（词进度 `[100, 61.54]`） |

另加静态 i18n 表检查：STR 条目 **122**（直接引用 109 / 间接 13）、**表外中文字面量 0**。
五个桶（页面异常 / console.error / 网络 ≥400 / 探针异常 / 断言失败）除上面两条**外部 / 本地资源 404** 外全 0。
回归里先后红过、最后都判为**尺子**的四处：速度时钟（§14.4）、命名改版 + 兄弟腿残留主题（§14.5），
本轮又添两处（混合年份的输入 / fixture 快照的不变量）与一条零样本收口（§14.6）。
`smoke-client` 这轮还补了一个 jsdom 保真度缺口：`getComputedStyle` 是浏览器全局、jsdom 只挂在 `dom.window` 上，
产品里的 `tokenMs` 因此在冒烟里 `ReferenceError`（真浏览器一直是好的）—— 补 shim，不是改产品。

## 还剩什么

按"能不能在屏幕上被看出"排序，只有两条值得继续花工时，且都不是配色问题：

1. **B 类**：若宿主允许，把插件面板的默认宽度对齐原型（差距一次性归零），否则接受为面板宽度自适应的代价。
2. **C 类**：`sections.length` 3 vs 4 —— 详情页比原型多一个区块。需要产品决定是砍区块还是改原型，不宜由实现单方面动。

D/E/F 三类是**记录在案的取舍**，不再算差距；G 类是**行为缺陷**，已修并带反证。
