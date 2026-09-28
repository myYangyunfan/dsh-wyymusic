/**
 * scripts/smoke-client.mjs — 客户端半边端到端冒烟（真渲染 + 真宿主 + 真网易云）。
 *
 * 做法：把宿主半边挂到本机 http 服务上，再用 jsdom 渲染客户端组件，把客户端里的
 * fetch 重写到该服务 —— 于是这是一条**真链路**：React UI → /wyymusic/api → 网易云 → 渲染回 DOM。
 *
 * 断言不只看「渲染没报错」：
 *   · 侧栏注册的 id/order 必须精确（order=-1 才能排在「插件」之上）
 *   · 排行榜视图里必须出现真实榜单名与真实歌曲
 *   · 点击歌曲行后，模块级 <audio> 的 src 必须变成同源流代理地址（证明「能出声」的接线通了）
 *   · 反证：错误的 order / 错误的 slot 名必须被本测试判失败
 *
 * 依赖 jsdom/react 从 DSH 客户端安装目录解析（本插件自己不装运行时依赖）。
 * 用法：node scripts/smoke-client.mjs
 */

import http from 'node:http'
import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = join(HERE, '..')
const DSH_DIR = process.env.DSH_CLIENT_DIR || 'C:/Users/delinger/Desktop/dsh'

// ---- 从 DSH 客户端安装目录借 jsdom / react ----
const req = createRequire(join(DSH_DIR, 'package.json'))
let JSDOM, React, ReactDOMClient
try {
  ;({ JSDOM } = req('jsdom'))
  React = req('react')
  ReactDOMClient = req('react-dom/client')
} catch (e) {
  console.error('无法从 ' + DSH_DIR + ' 解析 jsdom/react：' + e.message)
  console.error('可用 DSH_CLIENT_DIR=<含 node_modules 的目录> 覆盖。')
  process.exit(2)
}

const results = []
const record = (label, ok, detail) => results.push({ label, ok, detail: String(detail) })

// =====================================================================
// 1. 宿主半边 → 真实 http 服务
// =====================================================================
// 宿主半边把登录态和界面偏好写在 dshHome() = process.env.DSH_HOME || ~/.dsh。
// 这条腿会真点歌、真起播 ⇒ 真的写 prefs。不显式覆盖 DSH_HOME，测试数据就落进用户**真实**的
// ~/.dsh/wyymusic/prefs.json（实测踩过：跑完一次，那个文件的 mtime 变了、条目里多了本次播的歌）。
// 隔离做法：优先复用验证腿已经在用的 %TEMP%/dshhome-official（里面有扫码来的 cookie），
// 没有就另起一个临时 home 并把 cookie **只读地拷一份**过去，永不回写真实目录。
const ISOLATED = join(tmpdir(), 'dshhome-official')
const SCRATCH = join(tmpdir(), 'dsh-wyymusic-smoke')
// 另一条 CDP 腿（指纹截图那套）也在用这个隔离 home 的 lang/recent。要并发跑或者
// 想留一份干净的现场时，用 SMOKE_HOME=<目录> 指一个自己的 home（cookie 会自动拷过去）。
const SMOKE_HOME = process.env.SMOKE_HOME || (existsSync(join(ISOLATED, 'wyymusic', 'cookie.json')) ? ISOLATED : SCRATCH)
process.env.DSH_HOME = SMOKE_HOME
mkdirSync(join(SMOKE_HOME, 'wyymusic'), { recursive: true })
if (!existsSync(join(SMOKE_HOME, 'wyymusic', 'cookie.json'))) {
  const realCookie = join(homedir(), '.dsh', 'wyymusic', 'cookie.json')
  if (existsSync(realCookie)) copyFileSync(realCookie, join(SMOKE_HOME, 'wyymusic', 'cookie.json'))
}
console.log('宿主落盘目录（隔离）：' + SMOKE_HOME)

const { apply: hostApply } = await import('../lib/index.js')
let hostHandler = null
hostApply({
  effect: (fn) => fn(),
  webServer: { register: (o) => { hostHandler = o.handler; return () => {} } },
  logger: { warn: (m) => console.warn('[host warn]', m) },
}, {})
if (hostHandler === null) { console.error('宿主未注册路由'); process.exit(1) }

const server = http.createServer((rq, rs) => hostHandler(rq, rs))
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const ORIGIN = 'http://127.0.0.1:' + server.address().port
console.log('宿主已就绪：' + ORIGIN)

// =====================================================================
// 2. jsdom 环境
// =====================================================================
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
})
globalThis.window = dom.window
globalThis.document = dom.window.document
// getComputedStyle 是**浏览器全局**，jsdom 只把它挂在 dom.window 上。客户端半边读令牌时长
// （tokenMs: getComputedStyle(el).getPropertyValue('--t-art')）在真浏览器里一直是好的，
// 在 jsdom 里却会 ReferenceError —— 这是测试环境的保真度缺口，不是产品 bug，在这里补齐。
// （jsdom 不实现自定义属性的层叠，这里会拿到空串 → 落到兜底值，冒烟本来就只要求不炸。）
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
// Node 24 的全局 navigator 只有 getter，必须 defineProperty 覆盖
const defineGlobal = (k, v) => Object.defineProperty(globalThis, k, { value: v, writable: true, configurable: true })
defineGlobal('navigator', dom.window.navigator)
defineGlobal('HTMLElement', dom.window.HTMLElement)
defineGlobal('Node', dom.window.Node)
defineGlobal('Event', dom.window.Event)
defineGlobal('MouseEvent', dom.window.MouseEvent)
defineGlobal('KeyboardEvent', dom.window.KeyboardEvent)
// 客户端用 new Function(...) 求值，拿的是**Node 的全局作用域**，不是 jsdom 的：
// 凡是客户端里裸写的浏览器全局都得在这里搭桥。漏了 MutationObserver 的后果是
// useDsDark（跟随宿主暗色属性）一挂载就 ReferenceError —— 而这条只在真渲染时炸，
// 静态检查和 jsdom 里跑别的都看不出来。
defineGlobal('MutationObserver', dom.window.MutationObserver)
// loadArt 的 new Image()：jsdom 默认不加载子资源，onload 永不触发，
// 于是走 loadArt 自己的 6s 超时 → 重试 → 交回 null → L2 兜底色（正是设计里的降级路径）。
defineGlobal('Image', dom.window.Image)
globalThis.IS_REACT_ACT_ENVIRONMENT = false
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16)
globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
dom.window.requestAnimationFrame = globalThis.requestAnimationFrame
dom.window.cancelAnimationFrame = globalThis.cancelAnimationFrame

// 客户端只发相对路径；把它重写到真实宿主，相对路径之外的原样放行
const realFetch = globalThis.fetch
let clientCalls = 0
// 逐字歌词注入开关：置上后 /api/lyric 改回合成数据（真歌不一定有 YRC，靠合成样本才能定点验卡拉OK 渲染）
let lyricOverride = false
const SYNTH_LYRIC = {
  ok: true, lyric: '', trans: '', roma: '', wordLevel: true,
  wordLines: [
    { t: 0, end: 2, text: '你好啊', words: [{ t: 0, end: 0.5, text: '你' }, { t: 0.5, end: 1, text: '好' }, { t: 1, end: 2, text: '啊' }] },
    { t: 2, end: 4, text: '世界', words: [{ t: 2, end: 2.7, text: '世' }, { t: 2.7, end: 4, text: '界' }] },
  ],
}
const routedFetch = (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || ''
  if (url.startsWith('/')) {
    clientCalls++
    if (lyricOverride && url.startsWith('/wyymusic/api/lyric')) {
      return Promise.resolve(new Response(JSON.stringify(SYNTH_LYRIC), { status: 200, headers: { 'content-type': 'application/json' } }))
    }
    return realFetch(ORIGIN + url, init)
  }
  return realFetch(input, init)
}
globalThis.fetch = routedFetch
dom.window.fetch = routedFetch

// =====================================================================
// 3. 加载客户端半边并 apply
// =====================================================================
let captured = null
dom.window.__ModuleLoader__ = { load: (o) => { captured = o } }
const src = readFileSync(join(PROJECT, 'lib', 'client.js'), 'utf8')
// 经典脚本：直接用 window/document 等全局求值（与 DSH 客户端加载方式一致）
const run = new Function('window', 'document', 'fetch', 'require', src)
run(dom.window, dom.window.document, routedFetch, (n) => req(n))

if (captured === null) { console.error('客户端未调用 __ModuleLoader__.load'); process.exit(1) }
record('loader id', captured.id === 'dsh-wyymusic', 'id=' + captured.id)

const mod = captured.factory((n) => req(n))

// ---- 假 ctx：记录注册，并按真实语义执行 inject ----
const registrations = []
const effectsRun = []
const fakeCtx = {
  get: (k) => (k === 'slots' ? slotsApi : undefined),
  effect: (fn, label) => { effectsRun.push(label); const d = fn(); return d },
}
const slotsApi = {
  inject: (name, cb) => { void name; return cb() },
  register: (opts, comp) => { registrations.push({ opts, comp }); return () => {} },
}

if (typeof mod.apply !== 'function') { console.error('客户端未导出 apply'); process.exit(1) }
record('inject 声明', Array.isArray(mod.inject) && mod.inject.includes('slots'), JSON.stringify(mod.inject))

mod.apply(fakeCtx)

// ---- 注册元数据断言 ----
const side = registrations.find((r) => r.opts.name === 'sidebar.panellist')
const main = registrations.find((r) => r.opts.name === 'main')

record('侧栏注册存在', side !== undefined, side === undefined ? '未注册 sidebar.panellist' : 'ok')
if (side !== undefined) {
  record('侧栏 order=-1（须在「插件」=0 之上）', side.opts.order === -1, 'order=' + side.opts.order)
  record('侧栏 id 合法', side.opts.id === 'wyymusic', 'id=' + side.opts.id)
  record('侧栏 label', typeof side.opts.label === 'string' && side.opts.label !== '', 'label=' + side.opts.label)
  record('侧栏图标是组件', typeof side.comp === 'function', typeof side.comp)
}
record('主面板注册存在', main !== undefined, main === undefined ? '未注册 main' : 'ok')
if (main !== undefined) {
  record('主面板 key 与侧栏 id 同名', main.opts.key === side?.opts?.id, 'key=' + main.opts.key)
  record('主面板是组件', typeof main.comp === 'function', typeof main.comp)
}

// 氛围层注册在**宿主 layout 的 shell.overlay**（不是 main）：这是"突破窗口"的落点 ——
// 挂在 main 里的东西一切换到对话界面就随面板卸载了，只有这一层会留下来。
const overlay = registrations.find((r) => r.opts.name === 'shell.overlay')
record('氛围层注册到 shell.overlay', overlay !== undefined, overlay === undefined ? '未注册 shell.overlay' : 'ok')
if (overlay !== undefined) {
  record('氛围层 id 合法（list 槽必须有 id）', overlay.opts.id === 'wyymusic-ambient', 'id=' + overlay.opts.id)
  record('氛围层是组件', typeof overlay.comp === 'function', typeof overlay.comp)
}

// ---- 反证：故意用错 order 必须被判失败 ----
record('反证 order 守卫有效', side !== undefined && side.opts.order !== 0,
  side !== undefined && side.opts.order === 0 ? 'order=0 会与「插件」并列，守卫应报错' : 'ok')

// =====================================================================
// 4. 真渲染
// =====================================================================
const errors = []
// jsdom 未实现的媒体方法（load/play）不算本插件缺陷：真浏览器/Electron 渲染进程都有实现。
// 单独计数并在汇总里显式打印，避免「把环境局限当成通过」。
let mediaLimitations = 0
const origError = console.error
console.error = (...a) => {
  const s = a.map(String).join(' ')
  if (/Not implemented: HTMLMediaElement/.test(s)) { mediaLimitations++; return }
  if (/not wrapped in act|ReactDOMTestUtils/.test(s)) return
  errors.push(s)
}

const container = dom.window.document.getElementById('root')
const root = ReactDOMClient.createRoot(container)
root.render(React.createElement(main.comp))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(fn, ms = 25000, step = 200) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try { if (fn()) return true } catch { /* 继续等 */ }
    await sleep(step)
  }
  return false
}

const text = () => container.textContent || ''
const $$ = (sel) => Array.from(container.querySelectorAll(sel))
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))

// 4a-0. 先把界面语言钉到 zh。语言是持久化在 $DSH_HOME 的 prefs 里的：
// 上一趟跑过 i18n 流程（最后停在 en）时，本轮所有中文断言会集体假红 —— 指纹流程已经踩过这个坑。
const langPinned = await waitFor(() => {
  const page = container.querySelector('.wyy-page')
  if (page !== null && page.getAttribute('data-lang') === 'zh') return true
  const b = container.querySelector('.wyy-lang')
  if (b !== null) click(b)
  return false
}, 15000)
record('界面语言钉到 zh', langPinned, langPinned ? 'data-lang=zh' : '15s 内没能切到 zh')

// 4a. 首屏骨架（品牌名 / 左栏导航项 / 播放条）
const bootOk = await waitFor(() => text().includes('网易云音乐') && $$('.wyy-rail-item').length >= 3 && $$('.wyy-bar').length === 1)
record('首屏骨架渲染', bootOk, bootOk ? $$('.wyy-rail-item').length + ' 个左栏项 + 播放条' : ('实际文本：' + text().slice(0, 180)))

// 4b. 登录态从宿主读出（本机已导入 cookie）
const loginOk = await waitFor(() => /\d+ · VIP|· VIP/.test(text()) || text().includes('登录'))
record('登录态读取', loginOk, loginOk ? 'header 已显示账号态' : 'header 未见账号态')

// 4c. 发现页：推荐歌单必须渲染出真实卡片
const recOk = await waitFor(() => $$('.wyy-card').length > 0)
const cardNames = $$('.wyy-card-name').map((e) => e.textContent).filter(Boolean)
record('推荐歌单渲染', recOk && cardNames.length > 0,
  recOk ? cardNames.length + ' 个卡片，例：' + cardNames.slice(0, 3).join(' / ') : '无卡片')

// 4d. 切到排行榜：色带给出当期主推榜名（.wyy-band-title），下面是这一榜的真实歌曲行
const navRank = $$('.wyy-rail-item').find((e) => (e.textContent || '').trim() === '排行榜')
record('排行榜导航存在', navRank !== undefined, navRank === undefined ? '未找到导航项' : 'ok')
if (navRank !== undefined) {
  click(navRank)
  const rankOk = await waitFor(() => $$('.wyy-band-title').length > 0 && $$('.wyy-row').length > 0)
  const rankNames = $$('.wyy-band-title').map((e) => e.textContent).filter(Boolean)
  const rowTitles = $$('.wyy-row-title').map((e) => e.textContent).filter(Boolean)
  record('榜单 + 歌曲渲染', rankOk && rowTitles.length > 0,
    rankOk ? rankNames.length + ' 个榜名（色带），' + rowTitles.length + ' 行，例：' + rowTitles.slice(0, 3).join(' / ') : '榜单或歌曲行为空')
}

// 4e. 点歌 → 模块级 audio 拿到同源流代理地址（「能出声」的接线证据）
const firstRow = $$('.wyy-row')[0]
if (firstRow !== undefined) {
  click(firstRow)
  const audio = dom.window.document.querySelector('audio')
  const ok = await waitFor(() => audio !== null && typeof audio.src === 'string' && audio.src.includes('/wyymusic/stream?id='), 30000)
  record('点歌后 audio.src 指向流代理', ok, ok ? String(audio.src).replace(ORIGIN, '') : ('audio=' + (audio === null ? '不存在' : audio.src)))
  const barTitle = await waitFor(() => $$('.wyy-bar-title').some((e) => e.textContent && e.textContent !== '未在播放'))
  record('播放条显示当前曲目', barTitle, barTitle ? ($$('.wyy-bar-title')[0] || {}).textContent : '播放条仍为空')
} else {
  record('点歌后 audio.src 指向流代理', false, '没有可点的歌曲行')
}

// 4f. 歌词在全屏层里（.wyy-np 是覆盖层）：先从播放条右簇的「全屏歌词」按钮进去，
//     再断言真歌必须有词。旧断言找的 .wyy-lyric-line 是改造前的行内歌词区，早已不存在。
const fsBtn = $$('.wyy-bar-right .wyy-btn.ghost.small')[0]
record('全屏歌词入口存在', fsBtn !== undefined, fsBtn === undefined ? '未找到播放条上的全屏按钮' : 'ok')
if (fsBtn !== undefined) click(fsBtn)
const npOk = await waitFor(() => $$('.wyy-np').length === 1 && $$('.wyy-np-ly').length > 0, 25000)
record('歌词渲染', npOk, npOk ? $$('.wyy-np-ly').length + ' 行（逐字：' + ($$('.wyy-word').length > 0) + '）' : '歌词区为空')

// 4g. 逐字歌词（卡拉OK）定点验证。真歌不一定带 YRC，靠注入合成逐字样本才能定点验：
//     SYNTH_LYRIC 两行 —— 0~2s「你好啊」（你 0~0.5 / 好 0.5~1 / 啊 1~2）、2~4s「世界」（世 2~2.7 / 界 2.7~4）。
//     换一首歌触发重新取词，再驱动媒体时钟，断言当前行切换与词级渐变百分比确实算出来。
lyricOverride = true
const karaokeRows = $$('.wyy-row')
const otherRow = karaokeRows.length > 1 ? karaokeRows[1] : undefined
if (otherRow === undefined) {
  record('逐字歌词渲染', false, '没有第二行可点，无法触发重新取词')
  record('当前行随走时切换', false, '没有第二行可点，无法触发重新取词')
  record('逐字渐变填充生效', false, '没有第二行可点，无法触发重新取词')
} else {
  click(otherRow)
  const karaokeAudio = dom.window.document.querySelector('audio')
  // jsdom 的 play() 是空实现（既不抛错也不派发事件），这里补发浏览器本该发出的 play 事件：
  // 否则 playing 恒为 false → 平滑走时循环不启动 → 卡拉OK 断言就成了假绿。
  if (karaokeAudio !== null) karaokeAudio.dispatchEvent(new dom.window.Event('play'))
  // jsdom 的媒体时钟永不前进，必须手动推到目标时刻，再由 rAF 平滑走时循环按真实读取路径取值。
  const at = (sec) => { if (karaokeAudio !== null) karaokeAudio.currentTime = sec }
  // 全屏歌词一次渲染**所有**行，所以要盯的是当前行（.on）里的词 span；
  // 盘中所有行的 span 数不会随走时变，拿总数当断言等于什么都没测。
  const onWords = () => $$('.wyy-np-ly.on .wyy-word')
  const wordText = () => onWords().map((e) => e.textContent).join('')
  const wordPct = () => onWords().map((e) => {
    // 渐变两端是 --wyy-ly-on / --wyy-ly-off（旧版行内歌词用的是 --wyy-accent，已随改造消失）
    const m = /linear-gradient\(90deg,\s*var\(--wyy-ly-on\)\s*([\d.]+)%/.exec(e.getAttribute('style') || '')
    return m === null ? null : Number(m[1])
  })

  at(0)
  const line1Ok = await waitFor(() => onWords().length === 3 && wordText() === '你好啊', 20000)
  record('逐字歌词渲染', line1Ok,
    line1Ok ? 't=0 当前行 3 个词 span：' + wordText() : `未渲染出逐字 span（当前行 ${onWords().length} 个，全文 ${$$('.wyy-word').length} 个）`)

  at(3.5)
  const line2Ok = await waitFor(() => onWords().length === 2 && wordText() === '世界', 10000)
  record('当前行随走时切换', line2Ok, line2Ok ? 't=3.5s → 第 2 行成为当前行' : `t=3.5s 后当前行词 span=${JSON.stringify(wordText())}`)

  // t=3.5s：世（2~2.7）已唱完 → 100%；界（2.7~4）唱到 (3.5-2.7)/1.3 ≈ 61.5%
  const ps = wordPct()
  const fillOk = ps.length === 2 && ps[0] === 100 && ps[1] > 0 && ps[1] < 100
  record('逐字渐变填充生效', fillOk, '词进度=' + JSON.stringify(ps) + '，期望 [100, 0<p<100]')
}
lyricOverride = false

// =====================================================================
// 4h. 氛围层（"突破窗口"的那三样效果 + 设置面板 + 左栏下栏控制）
// =====================================================================
// 氛围层在宿主里挂在 shell.overlay（与 main 面板是两棵独立的树），所以这里也另起一个
// React 根来渲染它 —— 和宿主同构：面板卸载了它也不卸载。
const ambBox = dom.window.document.createElement('div')
dom.window.document.body.appendChild(ambBox)
const ambRoot = ReactDOMClient.createRoot(ambBox)
ambRoot.render(React.createElement(overlay.comp))
await sleep(80)

const ambEl = () => ambBox.querySelector('.wyy-amb')
// 背景层**不在 ambBox 里**：它插在宿主 frame 的最底下（jsdom 里兜底挂 body），所以按 document 找
const bgRoot = () => dom.window.document.querySelector('.wyy-amb-bg-root')
const barCount = () => ambBox.querySelectorAll('.wyy-amb-bar i').length

// 左栏下栏：2 个快捷开关 + 1 个总设置入口（用户点名要的三个按钮）
const railAmb = container.querySelector('.wyy-rail-ambient')
const ambBtns = railAmb === null ? [] : Array.from(railAmb.querySelectorAll('.wyy-rail-amb-btn'))
record('左栏下栏 3 个按钮', ambBtns.length === 3,
  '找到 ' + ambBtns.length + ' 个：' + ambBtns.map((b) => b.getAttribute('data-amb-toggle')).join('/'))

// 品牌行右侧的三连（上一首 / 停·播 / 下一首）：用户点名要的"在网易云音乐大按钮右边加 3 个小按钮"。
// 这条只验接线（"真能控播放"归 harness 那条腿在真音频上验）：三钮在品牌行里、文案齐、队列非空时不禁用、
// 「下一首」真的换歌。
const brandLine = container.querySelector('.wyy-brandline')
const brandCtls = brandLine === null ? [] : Array.from(brandLine.querySelectorAll('.wyy-brand-ctl button'))
record('品牌行右侧 3 个播放控制钮', brandCtls.length === 3
  && brandCtls.map((b) => b.getAttribute('data-brand-ctl')).join('/') === 'prev/toggle/next'
  && brandCtls.every((b) => (b.getAttribute('aria-label') || '') !== '' && b.disabled === false),
  '找到 ' + brandCtls.length + ' 个：' + brandCtls.map((b) => b.getAttribute('data-brand-ctl')).join('/')
  + '，文案=' + JSON.stringify(brandCtls.map((b) => b.getAttribute('aria-label')))
  + '，disabled=' + JSON.stringify(brandCtls.map((b) => b.disabled)))
const brandNext = brandCtls.find((b) => b.getAttribute('data-brand-ctl') === 'next')
const barTitleNow = () => (container.querySelector('.wyy-bar-title') || {}).textContent
if (brandNext === undefined) {
  record('品牌行「下一首」真的换歌', false, '没找到 data-brand-ctl=next')
} else {
  const t0 = barTitleNow()
  click(brandNext)
  const changed = await waitFor(() => barTitleNow() !== t0 && barTitleNow() !== '未在播放', 20000)
  record('品牌行「下一首」真的换歌', changed, '「' + t0 + '」→「' + barTitleNow() + '」')
}

const setBtn = ambBtns.find((b) => b.getAttribute('data-amb-toggle') === 'set')
if (setBtn === undefined) {
  record('设置面板可打开', false, '没找到 data-amb-toggle=set 的按钮')
} else {
  click(setBtn)
}
const panelOk = await waitFor(() => container.querySelector('.wyy-amb-panel') !== null, 6000)
const panel = container.querySelector('.wyy-amb-panel')
const rows = panel === null ? [] : Array.from(panel.querySelectorAll('.wyy-amb-row'))
const switches = panel === null ? 0 : panel.querySelectorAll('.wyy-amb-switch').length
record('设置面板打开（1 总开关 + 5 行）', panelOk && switches === 6 && rows.length === 5,
  panelOk ? '开关=' + switches + '，设置行=' + rows.length + '（' + rows.map((r) => (r.querySelector('.wyy-amb-row-title') || {}).textContent).join('/') + '）' : '6s 内没打开')

// 这一节**不假设初始态**：氛围设置是落盘的，上一趟跑剩的值就是这一趟的起点
// （实测：第二次跑时总开关已经是开的 —— 按"默认关"写断言必红，而且红得没有信息量）。
// 所以下面一律先把控件驱动到目标态，再量结果。
const swOf = (id) => (panel === null ? null
  : (id === 'master'
    ? panel.querySelector('.wyy-amb-master .wyy-amb-switch')
    : panel.querySelector('[data-amb-row="' + id + '"] .wyy-amb-switch')))
const swOn = (el) => el !== null && el.getAttribute('aria-checked') === 'true'
const drive = async (el, pred, tries = 6) => {
  for (let i = 0; i < tries; i++) {
    if (pred()) return true
    if (el === null) return false
    click(el)
    await sleep(180)
  }
  return pred()
}

// 反证 1：总开关关掉后必须什么都不铺。关着还铺一层，就等于"开关是个摆设"。
const masterOff = await drive(swOf('master'), () => !swOn(swOf('master')))
const cleanOff = await waitFor(() => bgRoot() === null && barCount() === 0
  && ambBox.querySelector('.wyy-amb-notes') === null && ambBox.querySelector('.wyy-amb-spot') === null, 4000)
record('总开关关掉后不铺任何层（反证）', masterOff && cleanOff,
  'master=' + (masterOff ? 'off' : '没能关掉') + '，bg=' + (bgRoot() !== null) + ' bar=' + barCount()
  + ' spot=' + (ambBox.querySelector('.wyy-amb-spot') !== null) + ' notes=' + (ambBox.querySelector('.wyy-amb-notes') !== null))

// 左栏「氛围背景」快捷按钮：不管当前什么态，点它就该看到背景（这就是快捷开关的语义）
const bgBtn = ambBtns.find((b) => b.getAttribute('data-amb-toggle') === 'bg')
if (bgBtn === undefined) {
  record('快捷开关点亮氛围背景', false, '没找到 data-amb-toggle=bg 的按钮')
  record('氛围背景是单张漂移封面（只动 transform）', false, '没找到按钮')
} else {
  click(bgBtn)
  const bgOn = await waitFor(() => {
    const r = bgRoot()
    return r !== null && r.getAttribute('data-amb-bg') === 'on'
      && r.querySelector('.wyy-amb-cover') !== null && r.querySelector('.wyy-amb-floor') !== null
  }, 6000)
  const root = bgRoot()
  record('快捷开关点亮背景层（糊封面 + 取色地板）', bgOn,
    bgOn ? 'bg-root on，cover/floor 都在，强度=' + (root.style.getPropertyValue('--amb-strength') || '(空)')
      : '6s 内没点亮')
  // 动的是 transform（位置迁移）；背景图只是一条静态 url，不是动画属性
  const cov = root === null ? null : root.querySelector('.wyy-amb-cover')
  const anim = cov === null ? [] : Array.from(cov.getAnimations ? cov.getAnimations() : []).map((a) => a.animationName)
  record('背景层：封面是静态 url、只有 transform 在动', cov !== null && /url\(/.test(cov.style.backgroundImage || '')
    && (cov.style.background || '') === '' && anim.length === 0,
    'url=' + ((cov && cov.style.backgroundImage) || '').slice(0, 34) + '，动画=' + anim.length)
}

// 律动条这一行：独立开关，两个方向都要量 —— 只量"打开"会把"开关是死的"当成通过
  const barSw = swOf('bar')
  if (barSw === null) {
    record('面板开关独立控制律动条', false, '第 2 行没有开关')
    record('关掉后 overlay 里真没了', false, '第 2 行没有开关')
    record('律动条写入循环活着', false, '第 2 行没有开关')
  } else {
    const barUp = await drive(barSw, () => barCount() === 72)
    record('面板开关独立控制律动条', barUp, barUp ? '开启后 72 根柱子' : '开启后柱子=' + barCount())
    click(barSw)
    const barDown = await waitFor(() => barCount() === 0, 6000)
    record('关掉后 overlay 里真没了', barDown,
      barDown ? '律动条已移除，背景还在=' + (bgRoot() !== null) : '6s 内还是 ' + barCount() + ' 根')
    await drive(barSw, () => barCount() === 72)
    // 循环真的在写（静音下只能证明"在写 + 诊断位在更新"；"随乐跳动"要靠 harness 的真音频）
    await sleep(220)
    const bar0 = ambBox.querySelector('.wyy-amb-bar i')
    const wrote = bar0 !== null && /scaleY/.test(bar0.style.transform || '')
    const level = ambEl() === null ? null : ambEl().getAttribute('data-amb-level')
    const beats = ambEl() === null ? null : ambEl().getAttribute('data-amb-beats')
    record('律动条写入循环活着', wrote && level !== null && beats !== null,
      wrote ? 'transform=' + bar0.style.transform + '，data-amb-level=' + level + '，beats=' + beats : '没有 transform 写入')
  }

  // --amb-bar-h 挂在**层根**上，不许挂在条子上：读它的有两处 —— 条子的 height 与提示气泡的
  // bottom（气泡是条子的**兄弟**，写在其中之一身上另一路只会吃到 CSS 兜底值、压在条子上）。
  // 反证：把它挪回条子（只写条子的 style），这条立刻红。
  {
    const layerEl = ambEl()
    const onRoot = layerEl === null ? '' : layerEl.style.getPropertyValue('--amb-bar-h')
    const barEl = ambBox.querySelector('.wyy-amb-bar')
    const onBar = barEl === null ? '(无条子)' : barEl.style.getPropertyValue('--amb-bar-h')
    record('--amb-bar-h 挂在层根（条子与气泡共用同一份）',
      layerEl !== null && /^\d+px$/.test(onRoot) && onBar === '',
      '层根=' + (onRoot || '(空)') + '，条子自带=' + (onBar === '' ? '(无，按继承取根上的)' : onBar))
  }

  // 功能 3：设置点律动。总开关已开，把这一行驱动到"武装"（根部 data-amb-beat=on）——
  // 开关的晃动/闪光全靠这个标记（写 CSS 变量的是 rAF，不是 React state）
  const beatArmed = await drive(swOf('beat'), () => panel !== null && panel.getAttribute('data-amb-beat') === 'on')
  record('设置点律动已武装（data-amb-beat=on）', beatArmed,
    panel === null ? '面板没打开' : 'data-amb-beat=' + panel.getAttribute('data-amb-beat'))

  // 打字音符那一行必须开着，后面的落点/反证测试才有意义
  const notesUp = await drive(swOf('notes'), () => ambBox.querySelector('.wyy-amb-notes') !== null)
  record('打字音符开关挂出宿主层', notesUp, notesUp ? '.wyy-amb-notes 在' : '没挂出来')

// 功能 4：打字音符。jsdom 没有布局，Range 的 rect 全是 0（客户端把"量不到光标"当无效、
// 刻意不落音符），所以这里补上 jsdom 缺的那层布局再驱动 input —— 测的是我们的判定与落点，
// 不是 jsdom 的排版。
const fakeRect = { x: 300, y: 400, width: 0, height: 18, top: 400, left: 300, right: 300, bottom: 418 }
dom.window.Range.prototype.getBoundingClientRect = function () { return fakeRect }
dom.window.Range.prototype.getClientRects = function () { return [] }
const editor = dom.window.document.createElement('div')
editor.setAttribute('data-lexical-editor', 'true')
dom.window.document.body.appendChild(editor)
const putCaretIn = (el) => {
  const rng = dom.window.document.createRange()
  rng.selectNodeContents(el)
  rng.collapse(true)
  const sel = dom.window.getSelection()
  sel.removeAllRanges()
  sel.addRange(rng)
}
putCaretIn(editor)
const fireInput = (el) => el.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
const notes = () => ambBox.querySelectorAll('.wyy-amb-note')
fireInput(editor)
const noteOk = await waitFor(() => notes().length === 1, 4000)
const note = notes()[0]
record('打字音符在光标右上蹦出', noteOk,
  noteOk ? '音符=' + (note.textContent || '') + '，left=' + note.style.left + ' top=' + note.style.top + '（光标 right=300 top=400）' : '4s 内没出现音符')
// 落点也要对：left ≈ 光标右缘（300+2）、top 在光标上方一点 —— 否则"右上方"是空话
record('音符落点贴着光标右上方',
  noteOk && Math.abs(parseFloat(note.style.left) - 302) < 2 && parseFloat(note.style.top) < 400,
  noteOk ? 'left=' + note.style.left + ' top=' + note.style.top : '没有音符可量')

// 反证 2：非 composer 的元素里打字不该出音符（网页别处也有 contenteditable）
const plain = dom.window.document.createElement('div')
plain.setAttribute('contenteditable', 'true')
dom.window.document.body.appendChild(plain)
putCaretIn(plain)
fireInput(plain)
await sleep(300)
record('非对话框的输入不出音符（反证）', notes().length === 1, '音符数=' + notes().length + '（期望仍为 1）')

// 输入法（拼音 + 点候选选词）：组字过程不出音符，**提交那一刻**必须出一个。
// 实测过的坑：Chromium 提交候选时 input 早于 compositionend，只认 input 就一个都不出（用户报的）。
{
  await waitFor(() => notes().length === 0, 4000)
  const comp = (type, isComposing) => {
    const e = new dom.window.Event(type, { bubbles: true })
    if (isComposing !== undefined) Object.defineProperty(e, 'isComposing', { value: isComposing })
    return e
  }
  editor.dispatchEvent(comp('compositionstart'))
  for (const _ of [1, 2, 3]) { // 拼音三下：都不该出音符
    editor.dispatchEvent(comp('input', true))
    await sleep(120)
  }
  const during = notes().length
  editor.dispatchEvent(comp('compositionend'))
  const after = await waitFor(() => notes().length === 1, 3000)
  record('输入法：组字过程不出音符、提交候选出一个',
    during === 0 && after === true,
    '组字中音符=' + during + '（期望 0），提交后=' + notes().length + '（期望 1）')
  // 提交后浏览器通常还会补一条 isComposing=false 的 input：密度上限要把它挡掉，不能出两个
  editor.dispatchEvent(comp('input', false))
  await sleep(250)
  record('输入法：提交后的补发 input 不重复出音符', notes().length === 1, '音符数=' + notes().length + '（期望 1）')
  await waitFor(() => notes().length === 0, 4000)
}

// 反证 3：连打不能刷屏。先把存量清空（音符靠 1400ms 兜底定时器收尾，jsdom 不跑 CSS 动画），
// 再一口气打 6 次 —— 没有密度上限的话这里会冒出 6 个。
const drainedFirst = await waitFor(() => notes().length === 0, 4000)
for (let i = 0; i < 6; i++) fireInput(editor)
await sleep(300)
record('连打被密度上限挡住（反证）', drainedFirst && notes().length === 1,
  '清空=' + drainedFirst + '，连打 6 次后音符数=' + notes().length + '（期望 1）')
const drained = await waitFor(() => notes().length === 0, 4000)
record('音符自动消失（不留残留节点）', drained, drained ? '已清空' : '仍有 ' + notes().length + ' 个音符挂在层里')

try { ambRoot.unmount() } catch { /* ignore */ }
if (ambBox.parentNode !== null) ambBox.parentNode.removeChild(ambBox)

record('渲染期间无异常', errors.length === 0, errors.length === 0 ? 'ok' : errors.slice(0, 2).join(' | '))

console.error = origError

// =====================================================================
// 5. 汇总
// =====================================================================
try { root.unmount() } catch { /* ignore */ }
server.close()

console.log('')
console.log('===== dsh-wyymusic 客户端冒烟 =====')
let pass = 0
for (const r of results) {
  console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.label.padEnd(26) + ' ' + r.detail)
  if (r.ok) pass++
}
console.log('\n' + pass + '/' + results.length + ' 通过   （客户端→宿主请求 ' + clientCalls + ' 次）')
console.log('已执行的 effect：' + effectsRun.join(' | '))
// 显式暴露环境局限，别让它藏在「通过」里
console.log('jsdom 未实现的媒体方法调用 ' + mediaLimitations + ' 次（load/play；真浏览器/Electron 有实现，不计入失败）')
process.exit(pass === results.length ? 0 : 1)
