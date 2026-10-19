# 内核兼容性审计：dsh-wyymusic 0.2.1 × @deepseek-ai/dsh 0.2.1-rc.2

> 审计对象：`D:\workspace\dsh-wyymusic`（插件 v0.2.1，README 自述"已实测 0.1.7-rc.2 / 0.2.0-rc.1"）
> 审计基准：`D:\workspace\_dsh_kernel\dsh`（内核树，全部 `@deepseek-ai/*` 包 `0.2.1-rc.2`，Desktop app 44.7.0）
> 口径：只读对照。每条给出「插件用法（文件:行号）→ 内核现定义（文件:行号 + 原文）→ 结论 → 最小修复」。

---

## 0. 结论摘要

| 分类 | 条数 | 内容 |
|---|---|---|
| ❌ 硬断裂（插件跑不起来） | **0** | 无。10 个扩展点在 0.2.1-rc.2 全部仍然存在且签名兼容 |
| 🟡 必须改（不报错但行为/显示不对，或声明是空的） | **3** | M1 `dsh.client.inject` 指向非插件行；M2 缺显示元数据（locale/icon）；M3 侧栏 label 不走 locale |
| 🔵 建议改（稳健性/观感） | **3** | S1 `shell.overlay` order；S2 氛围背景层 HMR 自愈；S3 `$DSH_HOME` 解析改用内核服务 |
| ✅ 已核对无需改 | 10 | 见第 2 节逐条 |

**一句话**：插件踩的都是"仍然在线"的扩展点，漂移不在 API 形状上，而在**声明质量**（一个空 inject、一份内核不读的元数据文件、一句硬编码的中文 label）与**一整套只靠内部实现细节支撑的宿主 DOM 依赖**上。

---

## 1. 证据基准

内核各包 README 是权威契约，本次实际引用：

- `@deepseek-ai/dsh-host-webserver/README.zh.md`（路由注册、匹配顺序）
- `@deepseek-ai/dsh-client-modules/README.zh.md`（`dsh.client` 声明、bundle 形态、模块图）
- `@deepseek-ai/dsh-client-ui-layout/README.zh.md`、`dsh-client-ui-sidebar/README.zh.md`、`dsh-client-ui-theme/README.zh.md`、`dsh-client-ui-renderer/README.zh.md`
- `@deepseek-ai/dsh-app-boot/README.zh.md`（profile / `dsh.bundle.patch`）
- `@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/`（`SKILL.md` + `references/host-plugin.md` + `references/ui-plugin.md` + `templates/decoration/`）——这是内核自己给插件作者的成文规范，等于"官方模板"

另有一份**比 README 更细的运行时契约**：内核内置的 slot 目录（`cordis_inspect` 的 Slots provider 数据），硬编码在
`@deepseek-ai/dsh-cordis-client-runner/lib/client.js`：`main` 在 4324 行、`shell.overlay` 在 5433 行、`sidebar.panellist` 在 5700 行。
它给出每个 slot 的 `kind` / `scope` / `registerOptions`（含 required）/ `ownerProps` / `declaredBy`，本文用它做逐项对照。

---

## 2. 逐条对照（宿主角 + 客户端角）

### 2.1 宿主侧

#### ① `export inject=['webServer']` + `ctx.webServer.register({kind:'prefix', path, handler})`

- **插件用法**
  - `lib/index.js:27` `export const inject = ['webServer']`
  - `lib/index.js:637-641` `ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler: serve }), 'dsh-wyymusic: routes')`
  - 路由前缀 `lib/index.js:33` `const ROUTE_PREFIX = '/wyymusic'`；`serve` 自解析 `req.url` 并自管 404/5xx（:404、:631-634）
- **内核现定义**
  - 服务名：`dsh-host-webserver/lib/index.js:286` `super(ctx, "webServer")`
  - 注册：`lib/index.js:326-333` `register(route)` → `route.kind === "exact" ? this.exact : this.prefixes`（**任何非 exact 都进前缀表**），重复路径抛错，返回 disposer
  - 匹配：`lib/index.js:495-504` 先精确表，再最长前缀；`:500` `if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue` → `/wyymusic` 命中 `/wyymusic/api/*`、`/wyymusic/stream`，且不会误吃 `/wyymusicX`
  - 调用：`lib/index.js:378-385` `await route.handler(req, res)`（handler 抛错由内核回 400，README.zh.md:71）
  - README 契约：`README.zh.md:61`「`register(route)` 添加具名的 `exact`／`prefix` HTTP route … 两者返回的 disposer 都会移除注册」
- **结论**：✅ **一致**。形状、kind 取值、前缀语义、handler 签名全部未变。
- **最小修复**：无。
- **附注**：`webServer` 行在 `dsh-web-app/cordis.patch.yml:179-188`（`id: webserver`），**没有** `disabled` 门控；同一 file 的 `:45-62` 用 `profileContext.name === 'desktop'` 门控其它行，反证 Desktop profile 也组合 `dsh-web-app`，故 `inject:['webServer']` 在 Desktop 一样能满足（不是只有 `dsh web` 模式才有）。

#### ② `ctx.effect` 包裹与 disposer 语义

- **插件用法**：`lib/index.js:637-644`（路由，try/catch 降级 + `ctx.logger?.warn?`）、`lib/client.js:5299/5308/5314/5320/5326/5333/5337/5345/5351`（客户端 9 处）
- **内核现定义**
  - `cordis/lib/index.js:1169` `effect(execute, label = "anonymous")` —— 第二参数就是 label，插件写法合法
  - `:1175-1185` disposer **幂等**（`disposing` 标记）、按**注册逆序**串行释放（返回 Promise 时等它完成）
  - `:1193-1197` `collect` 把内层 effect 挂到当前 fiber 的 children，随 fiber 卸载级联
  - `ctx.logger` 不需要 inject：它是 `Context` 原型属性（`cordis/lib/index.js:1688` `this.logger = new LoggerService(self)`），子 ctx 直接可见，故 `:643` 的 `ctx.logger?.warn?(`…)` 不会抛
  - 规范：`references/host-plugin.md:64`「Register every resource inside `apply` with `ctx.effect` or `ctx.on` and return its cleanup」
- **结论**：✅ **一致**。
- **最小修复**：无。

#### ③ `package.json dsh.bundle.patch` + `cordis.patch.yml` 的 `insert` 自装载

- **插件用法**
  - `package.json` `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`
  - `cordis.patch.yml:1-3` `- insert:` / `- id: dsh-wyymusic` / `name: 'dsh-wyymusic'`
- **内核现定义**
  - `dsh-app-boot/README.zh.md:50`「组合包的 `dsh.bundle.patch` 指定一个 patch 文件或一个有序的文件列表；`bundlePatchFiles` 校验该声明，`bundlePatchPaths` 把它解析为绝对路径」
  - 实现：`dsh-app-boot/lib/index.js:517-531`（字符串或字符串数组，相对包目录 join）
  - patch 方言：`lib/index.js:3039-3045` `patchStructure()` → `properties: { insert: ref("entryList") }`，描述「An insert appends entries, optionally inside the group identified by id」；`:2401` 内核自己组合行时也产出 `[{ insert: rows }]`
  - 层序：`README.zh.md:50` 与 `:1131` —— base → 各 bundle patch（按 `dsh.profile.bundles` 顺序）→ profile 自己的 `cordis.patch.yml` → home 级 → CLI `--patch`
- **结论**：✅ **一致**（`insert` 仍是现行方言；`id` + `name` 是正确写法；`config` 可省）。
- **最小修复**：无。
- **两条必须知道的补充**（不是 bug，但影响"自装载"的叙述准确性）：
  1. `dsh.bundle.patch` 只描述"被选中时插什么行"。包要真正进组合，必须出现在 profile 的 `dsh.profile.bundles`（模板见 `dsh-app-boot/lib/index.js:551-557`）；由安装器（插件页 / `dsh plugin add`）写 profile manifest，而不是包改 profile 的 patch 层。插件 README:62 的说法「包自己往 loader 插一行，不写 profile 的 patch 层」是对的，但**不等于**"放上去就自动生效"。
  2. `dsh.plugin.json` **内核完全不读**：全树 grep `dsh\.plugin` 仅 1 处命中，且是无关的 store 名（`dsh-client-ui-plugin-manager/lib/client.js:987` `persist: { name: "dsh.plugin-manager.install-registry" }`）。其中的 `capabilities.webServer`、`categories` 没有任何消费方。→ 见 M2。

#### ④ `dsh.client {platform,inject}` / `exports["./client"]` / `__ModuleLoader__.load({id,factory})`

- **插件用法**
  - `package.json`：`dsh.client = { inject: ["@deepseek-ai/dsh-client-ui-slots"], platform: "web" }`；`exports["./client"] = "./lib/client.js"`
  - `lib/client.js:23-25` `window.__ModuleLoader__.load({ id: 'dsh-wyymusic', factory: (require) => { … } })`
  - `lib/client.js:5357-5359` `exports.apply = apply` / `exports.inject = inject` / `exports.PANEL_ID = PANEL_ID`
  - 只 `require('react')`（`lib/client.js:30`），无别的模块请求
- **内核现定义**
  - `dsh-client-modules/README.zh.md:34`「浏览器插件包在其 `package.json` 中以 `platform: 'web'` 声明 `dsh.client`，导出 `./client` bundle，并在 `dsh.client.external` 下列出任何基座之外的模块请求」
  - 宿主解析：`lib/index.js:732-745`（`platform !== "web"` 直接跳过；`:738` 声明了 `dsh.client` 却无 `./client` 导出 → 抛错；`:743` `inject` 原样带进图 row，仅作**排序提示**）
  - 浏览器注册：`lib/client.js:696-713` `target.load = (registration) => this.register(registration)`，接受 `{ id, factory, chunk? }`；重复 id 抛「duplicate factory registration」
  - **`inject` 里指向图里不存在的包名 = 静默忽略**：`lib/client.js:789-792` `const dependency = this.graphRows.get(packageName); if (dependency !== void 0) await this.arriveDependency(...)`；宿主侧 `orderByModuleGraph`（`lib/index.js:422-444`）**只看 `external`，根本不看 `inject`**
  - 静态基座模块表（seed）含 slots 包：`dsh-web-frontend/dist/assets/index-CN7NIWNw.js:190` `function SZ(){return{react:…,"@deepseek-ai/dsh-client-ui-slots":SI,"@deepseek-ai/dsh-client-ui-primitives":zU,…}}`
  - `immediately` 的现行语义只是**预取**：同 bundle `:919554` `async prefetchImmediateTier(){await Promise.all(this.manifest.plugins.filter(e=>e.immediately).map(e=>this.modules.prefetch(e.id)…}`，与激活无关（激活由 `ClientEntries.reconcile` 逐行 `loader.create` 完成）
- **结论**：🟡 **结构一致，声明有一处是空的**。
  `dsh.client.inject` 写的是**静态基座模块名**（`dsh-client-ui-slots` 根本不是插件包——内核树里没有这个包目录，它是 shell 的 seed 模块），
  所以这一行不产生任何加载边，等于没写。真正提供 `slots` 服务的是 `@deepseek-ai/dsh-client-ui-renderer`
  （`dsh-client-ui-renderer/lib/client.js:1348` `super(ctx, "slots")`）。
  功能上无害（模块级 `inject: ['slots']` 已经由 cordis 兜住依赖），但声明是错的。
- **最小修复（M1）**：`package.json` 里改成
  ```json
  "client": { "inject": ["@deepseek-ai/dsh-client-ui-renderer"], "platform": "web" }
  ```
  （或直接删掉 `inject` 字段——它不是必需字段。）
- **附注**：不写 `immediately` 只影响 bundle 预取时机（多一次串行请求），不影响启动激活；`id` 必须等于包名 `dsh-wyymusic`，插件已满足（`lib/client.js:24`）。

### 2.2 客户端侧

#### ⑤ `sidebar.panellist`（list / root）：id / order / label + 组件收到的 ownerProps

- **插件用法**：`lib/client.js:5345-5348`
  `slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: -1, label: '网易云音乐' }, IconMusic)`；组件 `:1024` `function IconMusic({ size = 18 })`
- **内核现定义**（slot 目录 `dsh-cordis-client-runner/lib/client.js:5700-5745`）
  - `kind: "list"`, `scope: "root"`
  - `doc`：「Global panel icons. **Each list id addresses the matching main panel**; the sidebar owns the button and resolves its label from list metadata.」（plugins 与 main 同名这条至今是硬要求）
  - `registerOptions`：`id` **required**；`order` optional number（ascending，default 0）；`label` optional `string | (() => string)`（"A thunk is re-read on every projection, so localized text follows the active locale without re-registering"）
  - `ownerProps`：`SidebarPanelIconOwnerProps { size: number; active: boolean }`
  - 声明处：`dsh-client-ui-sidebar/lib/client.js:503-506` `"sidebar.panellist": { kind: "list", scope: "root" }`
  - 渲染：`lib/client.js:190-193` `renderSlot("sidebar.panellist", { size: wide ? 16 : 18, active }, { only: id })`
  - label 解析：`:459` `resolveSlotLabel(options.label) ?? id`；`resolveSlotLabel` = `typeof e==="function"?e():e`（shell dist:484951）
  - 排序：`:461` `.sort((a,b) => a.order - b.order)` → `order: -1` 仍排在 order 0 的「插件」之上 ✅
- **结论**：✅ **一致**（字符串 label 合法；id/order 语义未变；ownerProps `{size, active}` 与 `IconMusic({size})` 匹配，`active` 未用但可忽略）。
- **最小修复**：无（功能层面）。文案层面见 **M3**。

#### ⑥ `main`（keyed / root）：key + 组件

- **插件用法**：`lib/client.js:5351-5354` `slots.register({ name: 'main', key: PANEL_ID }, WyyPage)`；`WyyPage()` 不取 props（`:4092`）
- **内核现定义**
  - 目录 `cordis-client-runner/lib/client.js:4324-4359`：`kind: "keyed"`, `scope: "root"`，`registerOptions` 只有 `key`（**required**），`ownerProps: []`，`keyDomain`：`open: any string the owner dispatches (no compile-time key set), already taken: conversation`
  - 声明：`dsh-client-ui-layout/lib/client.js:631-634` `"main": { kind: "keyed", scope: "root" }`
  - 渲染：`:118-120` `renderSlot("main", {}, { entryKey: usePanelInfo(i => i.activePanelId) ?? "conversation" })`；`:1178-1181` 按 `options.key` 精确匹配
  - 可达性：`:614-617` `retainMainPanels(ctx.slots.entries("main").flatMap(e => e.options.key === undefined ? [] : [e.options.key]))` + `hasMainPanel = id => ctx.slots.entries("main").some(e => e.options.key === id)`；`:468-469` `selectPanel(panelId)` 对未注册 key **抛错**
- **结论**：✅ **一致**。官方 `client-ui-schedule` 用的也是同一写法（`dsh-client-ui-schedule/lib/client.js:7473-7483`：`{ name: 'main', key: PANEL_ID }`），可作孪生证据。
- **最小修复**：无。
- **附注**：`main` 的 key 与 `sidebar.panellist` 的 id 必须同名（`:4327` "Central panel selected by sidebar entry id"）——插件用同一个 `PANEL_ID` 已满足。

#### ⑦ `shell.overlay`（list / root）：注册项

- **插件用法**：`lib/client.js:5320-5323` `slots.register({ name: 'shell.overlay', id: PANEL_ID + '-ambient', order: 0 }, AmbientLayer)`；
  根元素 `:2592-2599` `<div className="wyy-amb" style={{ pointerEvents: 'none', … }}>`
- **内核现定义**
  - 目录 `cordis-client-runner/lib/client.js:5433-5479`：`kind: "list"`, `scope: "root"`，`id` required，`ownerProps: []`
  - `doc`（原文）：「Frame-wide floating layer, above every column and outside their scroll containers. Deliberately generic and unowned by any feature … **The layer itself is click-through — entries opt back into pointer events — so an occupant never blocks the app underneath.**」
  - 实现：`dsh-client-ui-layout/lib/client.js:349-353` `<div className={overlayLayer} data-shell-overlay>{overlays}</div>`；CSS（同 file:73）`.BynINW_overlayLayer{z-index:20;pointer-events:none;position:absolute;inset:0}` + **`.BynINW_overlayLayer>*{pointer-events:auto}`**
- **结论**：✅ **一致**（且插件正确规避了唯一陷阱：因为宿主给"每个直接子节点"重新打开 `pointer-events:auto`，全窗覆盖的装饰层必须自己写回 `none`——插件在 `:2597` 内联 `pointerEvents: 'none'`，见 `:1555`、`:5316` 的注释说明。**这行 inline 是必需的，不要"优化"掉。**）
- **建议修复（S1）**：`order: 0` 与官方 toast 同档（occupants：`chat.quota-notice`、`plugin-manager.refresh-toast`、`schedule.delete-toast`），list 按升序渲染、官方先注册 → 氛围层会画在 toast **之上**，而它带 `mix-blend-mode`，会把 toast 一起混。改 `order: -10` 让它稳定留在最底。一行改动。

#### ⑧ `ctx.get('slots')` / `slots.inject(name, fn)` / `slots.register(opts, Component)` 的存在性与签名

- **插件用法**：`lib/client.js:5293` `inject = ['slots']`；`:5296` `const slots = ctx.get('slots')`；`:5297` undefined 静默 return；
  `:5299` `ctx.effect(() => { …styles… }, label)`；`:5320/5345/5351` `ctx.effect(() => slots.inject(name, () => slots.register(opts, Comp)), label)`
- **内核现定义**
  - 服务名：`dsh-client-ui-renderer/lib/client.js:1348` `super(ctx, "slots")`
  - `inject(key, callback)`：`:1368-1390` —— 自己就是 `ctx.effect(...)`；声明已存在时**同步**执行回调，否则在 `register()` 提交声明后执行；返回幂等 disposer；回调可返回 disposer 或 disposer 的可迭代集合
  - `register(rawOptions, component)`：`:1813-1815` `return this.ctx.effect(() => this["_register"](options, component), "slots.register()")`
  - `this.ctx` 的语义：服务被 `ctx.slots` 访问时，traceable 代理把 `.ctx` 换成**调用方**的 ctx（`cordis/lib/index.js:105-158`，关键行 `:128` `if (prop === tracker.property) return ctx`）→ 注册与声明注入都挂在**插件自己的 fiber** 上，插件卸载即回收（renderer 源码注释 `:1295-1297` 也这么写）
  - 必填校验（SlotCore，shell dist 自 `:484951` 起）：keyed 缺 `key` 抛 `… requires options.key`；list 缺 `id` 抛 `… requires options.id`；chain 缺 `select` 抛错
- **结论**：✅ **一致**。插件"外层 ctx.effect 套 slots.inject"是合法且更稳的写法（inject 的 disposer 被外层 effect 收下，双重幂等无害）。
- **最小修复**：无。
- **建议**：`:5297` 的 `if (slots === undefined) return` 建议补一条 `ctx.logger.warn`。有 `inject` 保证时理论上不会命中，但一旦命中就是"插件静默不显示任何东西"，最难查。

### 2.3 宿主 DOM 钩子（氛围层）

插件氛围层（`lib/client.js` 里 `ambBackdrop*` / `AmbientLayer` / `ambBlendSurfaces` / `ambComposerRetint`）用到 6 类宿主 DOM 契约。**逐条在 0.2.1-rc.2 源码里定位如下：**

| 插件用的钩子 | 插件行号 | 0.2.1-rc.2 现状 | 结论 |
|---|---|---|---|
| `body[data-ds-dark-theme]` | 1486-1495（观察）、4482/4489/5091/5123…（CSS） | `dsh-client-ui-theme/lib/index.js:151-159` boot 脚本 `document.body.toggleAttribute('data-ds-dark-theme', dark)`；`dsh-client-ui-layout/lib/client.js:505` `DARK_ATTRIBUTE="data-ds-dark-theme"`，`:552-554` ThemePresenter 写/删 body 属性 | ✅ 仍成立（写的是 **body**，与插件假设一致） |
| `[data-shell-overlay]` → `parentElement` 当 frame，`insertBefore(el, frame.firstChild)` | 1983-1996 | `dsh-client-ui-layout/lib/client.js:349-353` `data-shell-overlay` 挂在 `.overlayLayer`（`position:absolute;inset:0;z-index:20`），其父即 `.frame`（`:316-328`，`position:relative;overflow:hidden;display:grid`） | ✅ 属性与父子关系仍在；⚠️ 但"往 React 管的 grid 容器插首子节点"**不是契约**（见 S2） |
| `[data-conversation-scroll]` | 1878 | `dsh-client-ui-conversation/lib/client.js:17869-17872` `<div className={scrollBody} data-conversation-scroll>`（含 Views + composerSeat） | ✅ 仍在 |
| `[data-conversation-session]` | 1879 | 同 file `:17865-17866` `data-conversation-session={sessionId}` | ✅ 仍在 |
| `[data-composer-card]` | 1930（及 1895 的跳过判定） | 同 file `:18987-18990` `"data-composer-card": true`（输入卡片 div） | ✅ 仍在 |
| `--dsw-alias-bg-base` / `--dsw-alias-markdown-code-block` / `-inline-code` / `-code-block-banner` | 5260/5271/5275-5276 | `dsh-client-ui-theme/lib/client.js` 四个令牌均有定义（grep `--dsw-alias-X:` 各命中 1 次） | ✅ 仍在 |

- **结论**：🟡 **6/6 钩子在 0.2.1-rc.2 全部仍然成立，氛围层不会因内核升级而整体失效**。但它们都是**实现细节**（`data-*` 属性没有任何 README 承诺），随版本随时可变；插件把它们当成契约使用，风险自留。
- **建议修复（S2，稳健性）**：`ambBackdropSync`（`:1968-2016`）只在 `node === null` 时重建。AppFrame 一旦重挂（HMR、布局重建、root entry 重注册），插入的那层会被连同旧 DOM 一起丢掉，而 `ambBackdrop.node` 仍指向**已脱离文档**的节点 → 背景层静默永久消失。加一行自愈：
  ```js
  // :1977 之后
  if (node !== null && !node.isConnected) { ambBackdrop.node = null; return ambBackdropSync() }
  ```
  （严格说还要把 `ambBackdrop.cover/floor` 置空后重走创建分支，等价于先调 `ambBackdropUnmount()` 再递归一次。）

### 2.4 内核 README 里标注 deprecated / 重命名的扩展点

- 检索面：内核树全部 `README.zh.md`（`废弃|deprecated|重命名|renamed|不再提供` 等）。命中的 deprecation 与本插件**无关**：`agent-preset-registry` 的 `modeSelectionEnabled`、`experimental-auto-review` 的 `snapshotEvents()`、`session-format-v0→v1` 的事件改名。插件用到的 10 个扩展点**没有一个**被标记废弃或改名。
- 但反方向发现一处"**用了不存在的元数据契约**"：`dsh.plugin.json`。见 **M2**。

---

## 3. 必须改（lead 可直接照做）

> **工作区状态（2026-10-19 收尾，v0.2.2）**：M1/M2/M3 与 S1/S2/S3 **全部已落地**（逐条见文末「8. 落地状态」）。本节保留"修复前"描述以便复核。

### M1 — `package.json` 的 `dsh.client.inject` 指向了静态基座模块，等于没写

- **现状**：`"inject": ["@deepseek-ai/dsh-client-ui-slots"]`
- **为什么错**：`dsh-client-ui-slots` 不是插件包（内核树无此目录），它是 shell 的 seed 模块（`dsh-web-frontend/dist/assets/index-CN7NIWNw.js:190`）；`dsh.client.inject` 只对"图里的插件行"生效（`dsh-client-modules/lib/client.js:789-792` 找不到就静默跳过；宿主排序只看 `external`，`lib/index.js:422-444`）。
- **最小修复**：
  ```diff
  -      "inject": [
  -        "@deepseek-ai/dsh-client-ui-slots"
  -      ],
  +      "inject": [
  +        "@deepseek-ai/dsh-client-ui-renderer"
  +      ],
  ```
  风险：无（该字段只影响到达顺序）。也可以整段删掉 `inject`。
- **连带**：README.md:16 的「`@deepseek-ai/dsh-client-ui-slots` 是宿主注入」表述建议改为「`slots` 服务由 `dsh-client-ui-renderer` 提供，本包通过 `inject:['slots']` 获取」。

### M2 — 缺内核认的显示元数据：插件页会把标题显示成 "dsh-wyymusic"、图标用默认图

- **现状**：包里有 `dsh.plugin.json`（name/description/categories/capabilities），但**内核不读它**；同时缺 `locale/*.json` 与 `icon`。
- **内核契约**：`dsh-app-boot/lib/index.js:2216-2243` `readPluginMeta(specifier, parentURL)`：
  - 标题/描述读 `<pkg>/locale/en.json`（及同目录其它语言）的 `meta.title` / `meta.description`（`:2182-2183`），缺失时回退 `package.json` 的 `name` / `description`（`:2224-2225`）
  - 图标读 `package.json` 顶层 `icon`（相对路径）或导出资源 `<pkg>/icon`（`:2085-2117`），SVG/PNG/JPEG/WebP ≤ 256 KiB
  - 成文规范：`references/host-plugin.md:29-51`
- **后果**：设置 → 插件 / 插件管理器里该行标题 = `dsh-wyymusic`（不是"网易云音乐"），描述走包 description，图标是通用占位图。
- **最小修复**（3 个小动作，全部在 `package.json` + 新增 2~3 个文件）：
  1. 新增 `locale/zh.json`：`{ "meta": { "title": "网易云音乐", "description": "侧栏独立入口 + 全屏接管式播放界面／氛围层。" } }`
  2. 新增 `locale/en.json`：`{ "meta": { "title": "NetEase Music", "description": "…" } }`
  3. 新增 `icon.svg`（可把 `lib/client.js:1024` 的 IconMusic 图形抽成 SVG）
  4. `exports` 增补 `"./locale/*.json": "./locale/*.json"`, `"./icon": "./icon.svg"`；`files` 增补 `"locale/*.json"`, `"icon.svg"`
  - `dsh.plugin.json` 可保留作人读文档（无害），但它不再是任何行为的来源。

### M3 — 侧栏 label 硬编码中文，不跟宿主语言

- **现状**：`lib/client.js:5346` `label: '网易云音乐'`（明文字符串）
- **内核契约**：`label` 接受 `string | (() => string)`，"A thunk is re-read on every projection, so localized text follows the active locale without re-registering"（目录 `cordis-client-runner/lib/client.js:5718-5723`）；成文规范 `references/ui-plugin.md:5`「Route visible UI text through the Client locale service」。
  官方同款写法：`dsh-client-ui-plugin-manager/lib/client.js:4477-4483` `{ name:'sidebar.panellist', id, order:0, label: () => t("panel"), locale: NS }`。
- **最小修复（推荐写法）**：客户端 `inject` 加 `'locale'`，apply 里
  `ctx.effect(() => ctx.locale.register('wyymusic', { zh: { panel: '网易云音乐' }, en: { panel: 'NetEase Music' } }), 'wyymusic: locale')`，
  注册项改成 `{ …, locale: 'wyymusic', label: () => ctx.locale.bind('wyymusic')('panel') }`
  （`ctx.locale.register(ns, dicts)` / `bind(ns)`：`dsh-client-locale/lib/client.js:1387-1422`，任意 ns 不在运行时做白名单校验）。
- **不推荐"省事写法"**：只把 label 改成读插件自己的语言（`label: () => (ui.lang === 'en' ? 'NetEase Music' : '网易云音乐')`，`ui.lang` 在 `lib/client.js:227`）。
  侧栏的 panel 列表是快照 store，`syncPanels` 只在两类事件里重跑：`ctx.slots.subscribe("sidebar.panellist")` 与 `ctx.locale.subscribe(...)`
  （`dsh-client-ui-sidebar/lib/client.js:469-470`）。走 `ui.lang` 时切语言不会触发任何一类 → tooltip 要等到下次槽位变化才更新，等于"切了不生效"。
- **风险**：低。当前英文界面下侧栏 tooltip 显示中文，属观感缺陷而非功能缺陷。

---

## 4. 建议改（非阻塞）

- **S1 `shell.overlay` 的 `order`**：`lib/client.js:5321` `order: 0` → `-10`。理由：list 按 `order` 升序渲染，官方 toast 也在 0 档且先注册，当前氛围层画在它们**之上**（还带 `mix-blend-mode`）。一行。
- **S2 氛围背景层 HMR 自愈**：见 2.3 末。三行（`ambBackdropSync` 里判 `isConnected`）。
- **S3 `$DSH_HOME` 解析**：`lib/index.js:56` 用 `process.env.DSH_HOME || join(homedir(), '.dsh')`，与内核 `resolveDshHome()` 的**当前默认**一致（`dsh-home-paths` README.zh.md:39/84：显式配置 > `$DSH_HOME` > `~/.dsh`，空白视为未设置）。但内核把真正解析结果作为服务暴露了：`dsh-app-boot/lib/index.js:4526` `ctx.provide("dshHomePath", dshHomePath)`（`dshHomePath(dir, ...segments)`）。建议改成
  `const home = ctx.get('dshHomePath') ?? ((...s) => join(process.env.DSH_HOME || join(homedir(), '.dsh'), ...s))`，
  这样部署用"显式配置的 home"时 cookie/prefs 不会写到 `~/.dsh`。风险：低（`dshHomePath` 只在 `boot()` 里 provide；取不到时走原逻辑）。

---

## 5. 附录 A：核对过、**不需要动**的点（避免下一轮重复审计）

- `lib/index.js` 的 README 路由表所列全部 `/wyymusic/api/*` 路由（含 `prefs` 的 GET/POST 双方法）：`serve` 自行解析 `req.url`、自行 404/400/5xx，符合 `prefix` handler 契约（内核只负责选中路由并 `await handler(req,res)`）。
- `lib/index.js:642-644` 的 try/catch 降级 + `ctx.logger?.warn?`：`logger` 是 Context 原型属性（cordis:1688），不需要 inject。
- 客户端 `require('react')`：react 在 seed 表里（shell dist:190），不需要 `dsh.client.external`。
- 客户端 bundle 形态：经典脚本 + `__ModuleLoader__.load({id, factory})`，无 ESM 顶层 import —— 与 `dsh-client-modules` 现行载体一致（README.zh.md:38/73）。
- 事件/生命周期：9 处 `ctx.effect` 全部返回 disposer，随插件 fiber 卸载回收。
- `slots.register` 的必填项：`main` 有 `key`、`sidebar.panellist` 有 `id`、`shell.overlay` 有 `id` —— 与 SlotCore 校验（keyed requires key / list requires id）完全对齐。
- 4 个 `--dsw-alias-*` 令牌仍在主题包里定义。

## 6. 附录 B：无法在本次审计内验证的部分（诚实边界）

- **没有 0.1.7-rc.2 / 0.2.0-rc.1 的内核树可比对**，所以本报告给的是「插件用法 vs 0.2.1-rc.2 现行契约」的对齐结果，**不是**逐版本 diff。凡"仍然成立"的结论都基于 0.2.1-rc.2 源码定位，不基于历史推断。
- **运行时行为未验证**：本报告不含真机跑通证据（那是 task-1 浏览器探针 / task-2 路由功能测试的产出）。API 形状一致 ≠ 页面真的渲染出来。
- `dsh-client-ui-slots` 的源码不在内核树里（它是 shell 打包的 seed 模块，只有压缩产物），本文对 SlotCore 的校验细节是从 `dsh-web-frontend/dist/assets/index-CN7NIWNw.js` 的压缩串反推的；引用时已标注 "shell dist"。

## 7. 附录 C：复现命令（PowerShell，只读）

```powershell
$R='D:\workspace\_dsh_kernel\dsh\node_modules\@deepseek-ai'
# 1) slots 服务由谁提供
Select-String -Path "$R\dsh-client-ui-renderer\lib\client.js" -Pattern 'super\(ctx, "slots"\)'
# 2) main / sidebar.panellist / shell.overlay 的 kind 声明
Select-String -Path "$R\dsh-client-ui-layout\lib\client.js" -Pattern '"main"|shell\.overlay'
Select-String -Path "$R\dsh-client-ui-sidebar\lib\client.js" -Pattern 'sidebar\.panellist'
# 3) 宿主 DOM 钩子是否还在
Select-String -Path "$R\dsh-client-ui-layout\lib\client.js" -Pattern 'data-shell-overlay|data-ds-dark-theme'
Select-String -Path "$R\dsh-client-ui-conversation\lib\client.js" -Pattern 'data-conversation-scroll|data-conversation-session|data-composer-card'
# 4) dsh.plugin.json 是否被内核读取（预期：0 命中）
Get-ChildItem "$R" -Recurse -Include *.js,*.ts,*.json | Select-String -Pattern 'dsh\.plugin\.json' -List
```
## 8. 落地状态（lead 补记，2026-10-19）

| 项 | 状态 | 落地位置 |
| --- | --- | --- |
| M1 `dsh.client.inject` | 已落地 | `package.json` → `@deepseek-ai/dsh-client-ui-renderer` |
| M2 插件页元数据 | 已落地 | 新增 `locale/zh.json`、`locale/en.json`、`icon.svg`；`package.json` 增顶层 `icon` 与 `exports` 的 `./icon`、`./locale/*.json`，`files` 同步 |
| M3 侧栏 label | 已落地 | `lib/client.js`：`inject` 增 `'locale'`、`ctx.locale.register('wyymusic', …)`、`label: () => panelLabel()`（thunk 走宿主 locale，取不到服务时退回插件自己的 `t('appName')`） |
| S1 overlay order | 已落地 | `lib/client.js` 的 `shell.overlay` 注册项 `order: -10` |
| S2 背景层自愈 | 已落地 | `lib/client.js` `ambBackdropSync()`：`node !== null && !node.isConnected` → 先 `ambBackdropUnmount()` 再重建 |
| S3 home 解析 | 已落地 | `lib/index.js`：`dshHomePath(...segments)` 优先用 `ctx.get('dshHomePath')`，缺席退回 `$DSH_HOME` 或 `~/.dsh` |

**落地后复验（真内核 0.2.1-rc.2，2026-10-19）**

- `node scripts/probe-boot.mjs` → **7/7 PASS**，全程 console error / 未捕获异常 / 4xx·5xx = 0；侧栏「网易云音乐」仍在「插件」之上，点击后 `.wyy-page` 接管 main 槽，往返切换不炸。
- `node scripts/probe-host-routes.mjs --search-param=q` → **12/12 PASS**（登录态 status、搜索、榜单、歌单、歌词、取链、`Range` 206 流、prefs GET/POST、404 兜底）。
- `node scripts/i18n-check.mjs` → 通过（STR 152 条，表外中文字面量 0）。
- 桌面组合（`dsh-base` + `dsh-web-app` + agent-team / auto-review / voice-input + ds-bot + vibe-island + inspector + better-sidebar + cover-pipeline + dsh-wyymusic）在隔离 home 里用**同名 bundle 列表的另一个 profile 名**启动成功：`/wyymusic/api/status` 200，index 注入行带 `inject:["@deepseek-ai/dsh-client-ui-renderer"]`。
