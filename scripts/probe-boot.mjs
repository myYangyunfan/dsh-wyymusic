#!/usr/bin/env node
/**
 * scripts/probe-boot.mjs — 「浏览器半边真机探针」：在真内核（0.2.1-rc.2，web 模式）+ 真 Edge 里
 * 证明 dsh-wyymusic 的客户端插件**确实被装载、确实注册了侧栏入口、点开后确实接管了 main 槽**，
 * 并把全程 console error / 未捕获异常原文抄回来（API 漂移的定位点）。
 *
 * 与 smoke-client.mjs 的分工：那条跑 jsdom + 假宿主，证明"接线正确"；这条不打桩 —— 页面是
 * 内核自己吐的 index（带 token），__DSH_BOOT__ 是内核自己组合的启动图，点击是真 DOM 点击。
 *
 * 断言（每条都要证据，不许"看起来对"）：
 *   1  window.__DSH_BOOT__.entries 里存在 id=dsh-wyymusic，并打印该行 url/inject/rev
 *   1b /plugins/* 组合包请求全部 2xx（插件客户端 bundle 真被下发）
 *   2  侧栏出现 label=「网易云音乐」的面板图标（sidebar.panellist），DOM 顺序与几何位置都在「插件」之上
 *   3  点击后：该行 aria-current=page、DOM 出现 .wyy-page、宽度属主区域、对话流标记消失
 *   3b 插件 apply() 真跑过：<style data-plugin="dsh-wyymusic"> 在 head 里
 *   4  Runtime.consoleAPICalled(error) / Runtime.exceptionThrown / Log.entryAdded / 失败请求 全量原文
 *   5  截图落盘
 *
 * 隔离：自建 PROBE_HOME（默认 D:/workspace/_probe/home）的 profile + 指向仓库的 junction，
 * 绝不碰用户真实 ~/.dsh；cookie 只**只读复制**。
 * ⚠️ 删这个临时 home 前必须先 cmd /c rmdir 拆 junction，否则 rm -rf 会顺着 junction 删进仓库。
 *
 * 用法：node scripts/probe-boot.mjs
 * 环境变量：PROBE_PORT(55903) / PROBE_CDP_PORT(9381) / PROBE_HEADED=1 / PROBE_EDGE /
 *          PROBE_HOME / PROBE_SHOTS / PROBE_ROOT / DSH_KERNEL_DIR
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = process.env.PROBE_ROOT || 'D:/workspace/_probe'
const HOME = process.env.PROBE_HOME || join(ROOT, 'home')
const PORT = Number(process.env.PROBE_PORT || 55903)
const CDP_PORT = Number(process.env.PROBE_CDP_PORT || 9381)
const OUT = process.env.PROBE_SHOTS || join(ROOT, 'shots')
const EDGE_PROFILE = join(ROOT, 'edge-profile')
const KERNEL = process.env.DSH_KERNEL_DIR || 'D:/workspace/_dsh_kernel/dsh'
const EDGE = process.env.PROBE_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** 把多行页面脚本拼成一段（避免模板串：本文件保持可被任何工具安全读取） */
const S = (...lines) => lines.join('\n')

const results = []
const check = (label, ok, detail) => {
  results.push({ label, ok: ok === true, detail: String(detail) })
  console.log((ok === true ? 'PASS  ' : 'FAIL  ') + label + '  ' + detail)
}

// =====================================================================
// 1. 隔离 home：profile + junction + cookie（只读复制）
// =====================================================================
const PW = join(HOME, 'profiles', 'web')
mkdirSync(join(PW, 'node_modules'), { recursive: true })
mkdirSync(join(HOME, 'wyymusic'), { recursive: true })
mkdirSync(OUT, { recursive: true })
// 写 JSON 必须无 BOM：Node 的 writeFileSync 默认不写 BOM；
// PowerShell 的 Set-Content -Encoding UTF8 会写，内核 JSON.parse 直接崩。
writeFileSync(join(PW, 'package.json'), JSON.stringify({
  name: 'dsh-profile-web', private: true,
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-wyymusic'] } },
}, null, 2) + '\n')
writeFileSync(join(PW, 'cordis.yml'), '[]\n')
const JUNC = join(PW, 'node_modules', 'dsh-wyymusic')
if (!existsSync(JUNC)) {
  execFileSync('cmd', ['/c', 'mklink', '/J', JUNC.replace(/\//g, '\\'), REPO.replace(/\//g, '\\')], { stdio: 'ignore' })
}
const srcCookie = process.env.PROBE_COOKIE || join(homedir(), '.dsh', 'wyymusic', 'cookie.json')
const cookieCopied = existsSync(srcCookie)
if (cookieCopied) copyFileSync(srcCookie, join(HOME, 'wyymusic', 'cookie.json'))
console.log('probe home = ' + HOME + '（cookie ' + (cookieCopied ? '只读拷入' : '缺失，面板仍应渲染，只是未登录') + '）')

// =====================================================================
// 2. 起内核 web
// =====================================================================
const hostLog = []
const host = spawn(process.execPath, [
  join(KERNEL, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  'web', '--no-open', '--host', '127.0.0.1', '--port', String(PORT),
], { cwd: KERNEL, env: Object.assign({}, process.env, { DSH_HOME: HOME }), stdio: ['ignore', 'pipe', 'pipe'] })
host.stdout.on('data', (d) => hostLog.push(String(d)))
host.stderr.on('data', (d) => hostLog.push(String(d)))

let URL = ''
for (let i = 0; i < 200; i++) {
  const m = hostLog.join('').match(/\?token=([A-Za-z0-9_-]+)/)
  if (m) { URL = 'http://127.0.0.1:' + PORT + '/?token=' + m[1]; break }
  await sleep(500)
}
if (URL === '') {
  console.log('内核没起来（stdout/stderr 末尾）：\n' + hostLog.join('').slice(-3000))
  try { host.kill() } catch { /* ignore */ }
  process.exit(1)
}
console.log('kernel = ' + URL.replace(/\?token=.*/, '?token=***') + '   (0.2.1-rc.2)')

// =====================================================================
// 3. 无头 Edge + CDP
// =====================================================================
const HEADED = process.env.PROBE_HEADED === '1'
const edge = spawn(EDGE, [
  ...(HEADED ? ['--window-position=-2400,0', '--mute-audio'] : ['--headless=new', '--disable-gpu']),
  '--no-first-run', '--no-default-browser-check', '--disable-features=msEdgeFirstRunExperience',
  '--autoplay-policy=no-user-gesture-required',
  '--remote-debugging-port=' + CDP_PORT, '--window-size=1600,1000',
  '--user-data-dir=' + EDGE_PROFILE, 'about:blank',
], { stdio: 'ignore' })
console.log('浏览器：' + (HEADED ? '有头（窗口在屏幕外）' : '无头') + '，CDP :' + CDP_PORT)

const waitJson = async (path, ms = 45000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try { const r = await fetch('http://127.0.0.1:' + CDP_PORT + path); if (r.ok) return await r.json() } catch { /* not ready */ }
    await sleep(300)
  }
  throw new Error('CDP 未就绪：' + path)
}

let ws = null
const cleanup = () => {
  try { ws && ws.close() } catch { /* ignore */ }
  try { edge.kill() } catch { /* ignore */ }
  try { host.kill() } catch { /* ignore */ }
}

try {
await waitJson('/json/version')
const page = (await waitJson('/json/list')).find((t) => t.type === 'page')
ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })

let seq = 0
const pending = new Map()
const consoleErrors = []
const exceptions = []
const logEntries = []
const netFails = []
const httpErrors = []
const pluginBundles = []

const describeException = (details) => {
  const exc = details.exception || {}
  const head = String(exc.description || details.text || 'throw')
  const frames = (details.stackTrace && details.stackTrace.callFrames) || []
  if (head.indexOf('\n    at ') !== -1 || frames.length === 0) return head.slice(0, 4000)
  const stack = frames.map((f) => '    at ' + (f.functionName || '<anonymous>') + ' (' + (f.url || '?') + ':' + (f.lineNumber + 1) + ':' + (f.columnNumber + 1) + ')').join('\n')
  return (head + '\n' + stack).slice(0, 4000)
}

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id !== undefined && pending.has(msg.id)) {
    const entry = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) entry.rej(new Error(JSON.stringify(msg.error)))
    else entry.res(msg.result)
    return
  }
  const p = msg.params || {}
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = (p.args || []).map((x) => x.value !== undefined ? String(x.value) : (x.description || x.type || '')).join(' ')
    if (p.type === 'error' || p.type === 'assert') consoleErrors.push(text.slice(0, 4000))
    else if (p.type === 'warning') logEntries.push('[console.warn] ' + text.slice(0, 1000))
  } else if (msg.method === 'Runtime.exceptionThrown') {
    exceptions.push(describeException(p.exceptionDetails || {}))
  } else if (msg.method === 'Log.entryAdded') {
    const e = p.entry || {}
    if (e.level === 'error' || e.level === 'warning') logEntries.push('[' + e.level + '] ' + (e.source || '') + ' ' + String(e.text || '').slice(0, 1500) + (e.url ? '  @ ' + e.url : ''))
  } else if (msg.method === 'Network.loadingFailed') {
    if (!p.canceled) netFails.push(String(p.errorText || '') + '  type=' + String(p.type || ''))
  } else if (msg.method === 'Network.responseReceived') {
    const r = p.response || {}
    const u = String(r.url || '')
    if (r.status >= 400) httpErrors.push(r.status + ' ' + u.slice(0, 300))
    if (u.indexOf('/plugins/') !== -1) pluginBundles.push({ status: r.status, url: u.replace(/https?:\/\/[^/]+/, ''), mime: r.mimeType })
  }
})
const send = (method, params) => new Promise((res, rej) => {
  const id = ++seq
  pending.set(id, { res, rej })
  ws.send(JSON.stringify({ id, method, params: params || {} }))
})
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) return { err: describeException(r.exceptionDetails) }
  return { v: r.result.value }
}
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, name + '.png'), Buffer.from(r.data, 'base64'))
  return name + '.png'
}
const poll = async (expr, ms = 20000, step = 250) => {
  const t0 = Date.now()
  let last = null
  while (Date.now() - t0 < ms) {
    const r = await ev(expr)
    last = r.v
    if (last) return last
    await sleep(step)
  }
  return last
}

await send('Runtime.enable')
await send('Page.enable')
await send('Network.enable')
await send('Log.enable')

// ---- 开页 ----
await send('Page.navigate', { url: URL })
await sleep(2500)
await poll('document.querySelectorAll("button").length > 2', 45000)
// 首启弹层：「继续」/「稍后配置」
for (const label of ['继续', '稍后配置', '跳过', 'Skip', 'Continue']) {
  await ev(S(
    '(async () => {',
    '  const end = Date.now() + 1500',
    '  const find = () => [...document.querySelectorAll("button")].find((e) => (e.textContent || "").trim() === ' + JSON.stringify(label) + ' && e.getBoundingClientRect().height > 0)',
    '  while (Date.now() < end) { const el = find(); if (el) { el.click(); return "clicked" } await new Promise((r) => setTimeout(r, 200)) }',
    '  return "none"',
    '})()',
  ))
  await sleep(400)
}
// 宿主首启的「开始使用（添加 API Key / 登录）」弹层会盖住主区域 —— 与插件无关，
// 但会污染截图与 bodyText，先点它的关闭按钮，再补一次 Esc。
const dismiss = await ev(S(
  '(() => {',
  '  const b = [...document.querySelectorAll("button")].find((x) => /关闭|Close/i.test(String(x.getAttribute("aria-label") || "")) && x.getBoundingClientRect().height > 0)',
  '  if (b) { b.click(); return "closed:" + (b.getAttribute("aria-label") || "") }',
  '  return "none"',
  '})()',
))
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await sleep(600)
console.log('首启弹层关闭：' + dismiss.v)
await poll('document.querySelectorAll("button[aria-label]").length > 3', 30000)
await sleep(1500)

// =====================================================================
// 4. 断言 1：__DSH_BOOT__ 里的 dsh-wyymusic 行
// =====================================================================
const bootInfo = await ev(S(
  '(() => {',
  '  const g = window.__DSH_BOOT__',
  '  if (g === undefined || g === null) return JSON.stringify({ missing: true })',
  '  const entries = Array.isArray(g.entries) ? g.entries : []',
  '  const mine = entries.filter((e) => e && e.id === "dsh-wyymusic")',
  '  return JSON.stringify({',
  '    rev: g.rev, release: g.release, total: entries.length,',
  '    ids: entries.map((e) => e && e.id),',
  '    mine: mine,',
  '    loaderMode: (window.__ModuleLoader__ || {}).mode || null,',
  '    batches: (g.batches || []).map((b) => b.phase + ":" + String(b.url || "").slice(0, 100)),',
  '  })',
  '})()',
))
let boot = { missing: true }
try { boot = JSON.parse(bootInfo.v) } catch { boot = { parseFail: String(bootInfo.v || bootInfo.err) } }
console.log('\n__DSH_BOOT__ = ' + JSON.stringify(boot, null, 2))

const bootHas = Array.isArray(boot.mine) && boot.mine.length > 0
check('1  __DSH_BOOT__.entries 含 id=dsh-wyymusic', bootHas,
  bootHas ? 'entry=' + JSON.stringify(boot.mine[0]) : 'entries=' + JSON.stringify(boot.ids || boot).slice(0, 1200))

const bundleOk = pluginBundles.length > 0 && pluginBundles.every((b) => b.status >= 200 && b.status < 300)
check('1b /plugins/* 客户端组合包全部 2xx', bundleOk,
  pluginBundles.length === 0 ? '没有任何 /plugins 请求' : pluginBundles.map((b) => b.status + ' ' + b.url.slice(0, 140)).join(' | '))

await shot('01-boot')

// =====================================================================
// 5. 断言 2：侧栏面板图标（label=网易云音乐，排在「插件」之上）
// =====================================================================
const rows = await ev(S(
  '(() => {',
  '  const btns = [...document.querySelectorAll("button[aria-label]")]',
  '  const list = btns.map((b, i) => {',
  '    const r = b.getBoundingClientRect()',
  '    return {',
  '      i, label: b.getAttribute("aria-label"), current: b.getAttribute("aria-current"),',
  '      top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height),',
  '      cls: String(b.className || "").slice(0, 60),',
  '    }',
  '  }).filter((x) => x.w > 0 && x.h > 0)',
  '  return JSON.stringify(list)',
  '})()',
))
let allRows = []
try { allRows = JSON.parse(rows.v) } catch { allRows = [] }
const panelRows = allRows.filter((r) => r.left < 460)
console.log('\n左侧（left<460）可见 aria-label 按钮（DOM 顺序）：')
for (const r of panelRows) console.log('  #' + r.i + ' top=' + r.top + ' left=' + r.left + ' ' + JSON.stringify(r.label) + (r.current ? ' [current=' + r.current + ']' : ''))

const mineRow = panelRows.find((r) => String(r.label || '').trim() === '网易云音乐')
const plugRow = panelRows.find((r) => /插件|Plugins/i.test(String(r.label || '').trim()))
const aboveOk = mineRow !== undefined && plugRow !== undefined && mineRow.top < plugRow.top && mineRow.i < plugRow.i
check('2  侧栏出现「网易云音乐」面板图标且在「插件」之上', aboveOk,
  mineRow === undefined
    ? '没找到 label=网易云音乐 ; 现有=' + JSON.stringify(panelRows.map((r) => r.label))
    : 'wyymusic top=' + mineRow.top + ' #' + mineRow.i + ' / 插件 top=' + (plugRow ? plugRow.top + ' #' + plugRow.i : 'missing'))

// =====================================================================
// 6. 断言 3：点击 → main 槽挂载
// =====================================================================
const before = await ev(S(
  '(() => {',
  '  const conv = document.querySelectorAll("[data-conversation-region],[data-composer-seat],[data-conversation-content]").length',
  '  const ta = document.querySelectorAll("textarea,[contenteditable=true]").length',
  '  return JSON.stringify({ conv, editable: ta, wyy: !!document.querySelector(".wyy-page") })',
  '})()',
))
console.log('\n点击前：' + before.v)

const clickRes = await ev(S(
  '(async () => {',
  '  const end = Date.now() + 8000',
  '  const hit = () => [...document.querySelectorAll("button[aria-label]")].find((b) => String(b.getAttribute("aria-label") || "").trim() === "网易云音乐" && b.getBoundingClientRect().height > 0)',
  '  while (Date.now() < end) {',
  '    const b = hit()',
  '    if (b) {',
  '      const r = b.getBoundingClientRect()',
  '      const cx = r.left + r.width / 2, cy = r.top + r.height / 2',
  '      b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: cx, clientY: cy }))',
  '      b.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: cx, clientY: cy }))',
  '      b.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, clientX: cx, clientY: cy }))',
  '      b.click()',
  '      return "clicked at " + Math.round(cx) + "," + Math.round(cy)',
  '    }',
  '    await new Promise((r) => setTimeout(r, 200))',
  '  }',
  '  return "none"',
  '})()',
))
console.log('点击：' + clickRes.v)

const mounted = await poll('document.querySelector(".wyy-page") !== null', 15000)
await sleep(2500)
const after = await ev(S(
  '(() => {',
  '  const p = document.querySelector(".wyy-page")',
  '  const row = [...document.querySelectorAll("button[aria-label]")].find((b) => String(b.getAttribute("aria-label") || "").trim() === "网易云音乐")',
  '  const r = p ? p.getBoundingClientRect() : null',
  '  const chain = []',
  '  let n = p',
  '  for (let i = 0; n && i < 6; i++) { chain.push(n.tagName.toLowerCase() + "." + String(n.className || "").split(/\s+/).filter(Boolean).slice(0, 3).join(".")); n = n.parentElement }',
  '  return JSON.stringify({',
  '    wyy: !!p,',
  '    rect: r ? { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) } : null,',
  '    rowCurrent: row ? row.getAttribute("aria-current") : null,',
  '    chain,',
  '    conv: document.querySelectorAll("[data-conversation-region],[data-composer-seat],[data-conversation-content]").length,',
  '    editable: document.querySelectorAll("textarea,[contenteditable=true]").length,',
  '    ownStyle: !!document.querySelector("style[data-plugin=dsh-wyymusic]"),',
  '    amb: !!document.querySelector(".wyy-amb"),',
  '    bodyText: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 200),',
  '  })',
  '})()',
))
let a = {}
try { a = JSON.parse(after.v) } catch { a = { parseFail: String(after.v || after.err) } }
console.log('\n点击后 DOM：' + JSON.stringify(a, null, 2))

// left>=200：面板根节点必须落在布局中栏（側栏 280px 之外），而不是被塞进侧栏
const mainOk = mounted === true && a.wyy === true && a.rect !== null && a.rect.w > 500 && a.rect.left >= 200 && a.rowCurrent === 'page' && a.conv === 0
check('3  点击图标后 main 槽挂载 .wyy-page（主区域不再是对话流）', mainOk === true,
  'wyy=' + !!a.wyy + ' rect=' + JSON.stringify(a.rect) + ' aria-current=' + a.rowCurrent +
  ' 对话标记 ' + before.v + ' -> conv=' + a.conv + ' 可编辑=' + a.editable + ' 祖先链=' + JSON.stringify(a.chain))
check('3b 插件 apply() 真执行（<style data-plugin="dsh-wyymusic"> 已注入）', a.ownStyle === true,
  'style=' + !!a.ownStyle + ' shell.overlay(.wyy-amb)=' + !!a.amb)

await shot('02-panel')

// 往返切换：插件面板 <-> 插件管理器，证明 selectPanel 双向不炸
if (plugRow !== undefined) {
  await ev('(() => { const b = [...document.querySelectorAll("button[aria-label]")].find((x) => /插件|Plugins/i.test(String(x.getAttribute("aria-label") || "").trim())); if (b) b.click(); return "x" })()')
  await sleep(1800)
  const back1 = await ev('JSON.stringify({ wyy: !!document.querySelector(".wyy-page"), conv: document.querySelectorAll("[data-conversation-region],[data-composer-seat]").length })')
  await ev('(() => { const b = [...document.querySelectorAll("button[aria-label]")].find((x) => String(x.getAttribute("aria-label") || "").trim() === "网易云音乐"); if (b) b.click(); return "x" })()')
  await sleep(1800)
  const back2 = await ev('JSON.stringify({ wyy: !!document.querySelector(".wyy-page") })')
  console.log('\n往返切换：切到「插件」后 = ' + back1.v + ' ；再切回音乐 = ' + back2.v)
  await shot('03-roundtrip')
}

// =====================================================================
// 7. 断言 4：错误全量原文
// =====================================================================
console.log('\n================ 错误汇总 ================')
console.log('console error : ' + consoleErrors.length)
consoleErrors.forEach((t, i) => console.log('  [' + (i + 1) + '] ' + t))
console.log('未捕获异常   : ' + exceptions.length)
exceptions.forEach((t, i) => console.log('  [' + (i + 1) + ']\n' + t))
console.log('Log.entryAdded(error/warn) : ' + logEntries.length)
logEntries.forEach((t, i) => console.log('  [' + (i + 1) + '] ' + t))
console.log('请求失败     : ' + netFails.length)
netFails.forEach((t, i) => console.log('  [' + (i + 1) + '] ' + t))
console.log('HTTP >=400   : ' + httpErrors.length)
httpErrors.forEach((t, i) => console.log('  [' + (i + 1) + '] ' + t))

const quiet = consoleErrors.length === 0 && exceptions.length === 0
check('4  全程无 console error / 未捕获异常', quiet,
  'console.error=' + consoleErrors.length + ' exception=' + exceptions.length +
  ' log(err/warn)=' + logEntries.length + ' netFail=' + netFails.length + ' http4xx5xx=' + httpErrors.length)

// ---- 4b 采集器自检：故意制造一条 console.error + 一个未捕获异常 ----
// 目的：证明上面那个 "0 条" 是**页面真安静**，而不是我这条 CDP 管道根本没接上。
const selfBefore = consoleErrors.length + exceptions.length
await ev(S(
  '(() => {',
  '  console.error("probe-selfcheck-console-error")',
  '  setTimeout(() => { throw new Error("probe-selfcheck-uncaught") }, 0)',
  '  return 1',
  '})()',
))
await sleep(900)
const selfConsole = consoleErrors.some((t) => t.indexOf('probe-selfcheck-console-error') !== -1)
const selfThrow = exceptions.some((t) => t.indexOf('probe-selfcheck-uncaught') !== -1)
check('4b 采集器自检：故意报的错必须被抓到', selfConsole === true && selfThrow === true,
  'console=' + selfConsole + ' exception=' + selfThrow + '（自检前已收 ' + selfBefore + ' 条）')

// =====================================================================
// 8. 报告
// =====================================================================
const selfChecked = (t) => t.indexOf('probe-selfcheck') !== -1
const realErrors = {
  consoleErrors: consoleErrors.filter((t) => !selfChecked(t)),
  exceptions: exceptions.filter((t) => !selfChecked(t)),
  logEntries, netFails, httpErrors,
}
const report = {
  at: new Date().toISOString(),
  kernel: KERNEL, port: PORT, url: URL.replace(/\?token=.*/, '?token=***'),
  pass: results.every((r) => r.ok),
  results, boot, rows: panelRows, before: before.v, after: a,
  // 已剔除 4b 自检注入的两条人造错误：这里只留页面真实产生的
  errors: realErrors,
  selfCheck: { console: selfConsole, exception: selfThrow },
  kernelLogTail: hostLog.join('').slice(-3000),
  shots: ['01-boot.png', '02-panel.png', '03-roundtrip.png'],
}
writeFileSync(join(ROOT, 'probe-boot.json'), JSON.stringify(report, null, 2) + '\n')
console.log('\n报告：' + join(ROOT, 'probe-boot.json'))
console.log('截图：' + OUT)
console.log('\n结论：' + (report.pass ? 'PASS' : 'FAIL'))
cleanup()
process.exit(report.pass ? 0 : 2)
} catch (err) {
  console.log('\n探针自身异常：' + ((err && err.stack) || err))
  console.log('内核日志末尾：\n' + hostLog.join('').slice(-2000))
  cleanup()
  process.exit(3)
}
