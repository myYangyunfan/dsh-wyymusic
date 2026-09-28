/**
 * scripts/harness-ambient.mjs — 「音乐氛围编程」在真 harness + 真浏览器里的验收腿。
 *
 * 与 scripts/smoke-client.mjs 的分工：那条用 jsdom 证明"接线对了、开关真能开关"
 * （没有音频、没有排版、没有合成器）；这条证明另一半 —— 在**官方内核 0.1.7-rc.2**
 * 上对着**真音频**它真的在动，而且切到对话界面之后还在（"突破窗口"的核心证据）。
 *
 * 断言里带反证的（不是"看起来在动"就过）：关总开关必须什么都不铺 / 关单个效果 overlay
 * 里必须真没了 / 范围切"对话栏"left 必须 >100px 而"整窗"必须 =0 / 连打不许刷屏 /
 * 音符必须自己消失 / 抽头 ok 但电平全 0 要能自愈。
 *
 * 前置：
 *   · 解出来的内核树（默认 %TEMP%/dsh-kernel-017rc2，DSH_KERNEL_DIR 覆盖）
 *   · 一份可播的登录态（默认从 ~/.dsh/wyymusic/cookie.json **只读**拷进临时 home；
 *     那里没有就退回另一条腿在用的 %TEMP%/dshhome-official/wyymusic/cookie.json）
 *   · Edge（AMB_EDGE 覆盖）
 *
 * 隔离：自建 %TEMP%/dshhome-amb（profile + 指向仓库的 junction + cookie 副本），绝不碰
 * 用户真实 ~/.dsh，也不碰别的腿在用的 dshhome-official。**删这个临时 home 前必须先
 * `cmd /c rmdir` 拆掉里面的 junction** —— MSYS 的 rm -rf 会顺着 junction 递归删进仓库。
 *
 * 用法：node scripts/harness-ambient.mjs
 * 环境变量：AMB_PORT / AMB_CDP_PORT / AMB_HEADED=1（有头跑，窗口挪到屏幕外）/
 *          AMB_EDGE / AMB_HOME / AMB_SHOTS / DSH_KERNEL_DIR
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const T = process.env.TEMP || process.env.TMP || 'C:/Users/delinger/AppData/Local/Temp'
const KERNEL = process.env.DSH_KERNEL_DIR || join(T, 'dsh-kernel-017rc2')
const HOME = process.env.AMB_HOME || join(T, 'dshhome-amb')
const PORT = Number(process.env.AMB_PORT || 55831)
const CDP_PORT = Number(process.env.AMB_CDP_PORT || 9361)
const OUT = process.env.AMB_SHOTS || join(T, 'wyy-shots-amb')
const EDGE = process.env.AMB_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const check = (label, ok, detail) => {
  results.push({ label, ok: ok === true, detail: String(detail) })
  console.log((ok === true ? 'PASS  ' : 'FAIL  ') + label + '  ' + detail)
}

// =====================================================================
// 1. 隔离 harness：profile + junction + cookie 副本
// =====================================================================
const PW = join(HOME, 'profiles', 'web')
mkdirSync(join(PW, 'node_modules'), { recursive: true })
mkdirSync(join(HOME, 'wyymusic'), { recursive: true })
writeFileSync(join(PW, 'package.json'), JSON.stringify({
  name: 'dsh-profile-web', private: true,
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-wyymusic'] } },
}, null, 2))
writeFileSync(join(PW, 'cordis.yml'), '[]\n')
const JUNC = join(PW, 'node_modules', 'dsh-wyymusic')
if (!existsSync(JUNC)) {
  execFileSync('cmd', ['/c', 'mklink', '/J', JUNC.replace(/\//g, '\\'), REPO.replace(/\//g, '\\')], { stdio: 'ignore' })
}
const srcCookie = process.env.AMB_COOKIE || (existsSync(join(homedir(), '.dsh', 'wyymusic', 'cookie.json'))
  ? join(homedir(), '.dsh', 'wyymusic', 'cookie.json')
  : join(T, 'dshhome-official', 'wyymusic', 'cookie.json'))
if (existsSync(srcCookie)) copyFileSync(srcCookie, join(HOME, 'wyymusic', 'cookie.json'))
console.log('harness home = ' + HOME + '（cookie ' + (existsSync(srcCookie) ? '已从 ' + srcCookie + ' 只读拷入' : '缺失') + '）')

const logBuf = []
const host = spawn(process.execPath, [
  join(KERNEL, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  'web', '--no-open', '--host', '127.0.0.1', '--port', String(PORT),
], { cwd: KERNEL, env: Object.assign({}, process.env, { DSH_HOME: HOME }), stdio: ['ignore', 'pipe', 'pipe'] })
host.stdout.on('data', (d) => logBuf.push(String(d)))
host.stderr.on('data', (d) => logBuf.push(String(d)))

let URL = ''
for (let i = 0; i < 160; i++) {
  const m = logBuf.join('').match(/\?token=([A-Za-z0-9_-]+)/)
  if (m) { URL = 'http://127.0.0.1:' + PORT + '/?token=' + m[1]; break }
  await sleep(500)
}
if (URL === '') {
  console.log('harness 没起来：\n' + logBuf.join('').slice(-2000))
  try { host.kill() } catch { /* ignore */ }
  process.exit(1)
}
console.log('harness = ' + URL.replace(/\?token=.*/, '?token=***'))

// =====================================================================
// 2. 无头 Edge + CDP
// =====================================================================
mkdirSync(OUT, { recursive: true })
const profile = join(T, 'edge-amb-profile')
if (existsSync(profile)) { try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ } }
mkdirSync(profile, { recursive: true })
const HEADED = process.env.AMB_HEADED === '1'
const edge = spawn(EDGE, [
  ...(HEADED ? ['--window-position=-2400,0', '--mute-audio'] : ['--headless=new', '--disable-gpu']),
  '--no-first-run', '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required',
  '--remote-debugging-port=' + CDP_PORT, '--window-size=1600,1000', '--user-data-dir=' + profile, 'about:blank',
], { stdio: 'ignore' })
console.log('浏览器模式：' + (HEADED ? '有头（窗口挪到屏幕外）' : '无头'))

const waitJson = async (path, ms = 40000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try { const r = await fetch('http://127.0.0.1:' + CDP_PORT + path); if (r.ok) return await r.json() } catch { /* not ready */ }
    await sleep(300)
  }
  throw new Error('CDP 未就绪：' + path)
}
await waitJson('/json/version')
const page = (await waitJson('/json/list')).find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })

let seq = 0
const pending = new Map()
const consoleErrors = []
const pageErrors = []
const netFails = []
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id !== undefined && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) rej(new Error(JSON.stringify(msg.error)))
    else res(msg.result)
    return
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push((msg.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 300))
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    pageErrors.push(String((msg.params.exceptionDetails && (msg.params.exceptionDetails.exception || {}).description) || '').slice(0, 300))
  }
  if (msg.method === 'Network.loadingFailed') netFails.push(String(msg.params.errorText || ''))
})
const send = (method, params) => new Promise((res, rej) => {
  const id = ++seq
  pending.set(id, { res, rej })
  ws.send(JSON.stringify({ id, method, params: params || {} }))
})
await send('Runtime.enable')
await send('Page.enable')
await send('Network.enable')
// callFunctionOn 必须挂在某个执行上下文上。锚点**懒建 + 失效重建**：导航会把旧上下文销毁，
// 提前建好的 objectId 到那时就是 "Cannot find context with specified id"（实测踩过）。
let pageAnchor = null
const callPage = async (fnDecl, argValue) => {
  if (pageAnchor === null) pageAnchor = (await send('Runtime.evaluate', { expression: '({})' })).result.objectId
  try {
    return await send('Runtime.callFunctionOn', {
      objectId: pageAnchor, functionDeclaration: fnDecl, arguments: [{ value: argValue }],
      awaitPromise: true, returnByValue: true,
    })
  } catch (e) { pageAnchor = null; throw e }
}

const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) return { err: String((r.exceptionDetails.exception || {}).description || 'throw').slice(0, 300) }
  return { v: r.result.value }
}
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, name + '.png'), Buffer.from(r.data, 'base64'))
  return name + '.png'
}
const poll = async (expr, ms = 20000, step = 300) => {
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

try {
  // ---- 3. 开页 + 首启弹层 ----
  await send('Page.navigate', { url: URL })
  await sleep(3000)
  await poll(`document.querySelectorAll('button').length > 3`, 40000)
  // 首次启动会弹「内测声明/继续」与「添加一个 API Key / 稍后配置」
  for (const label of ['继续', '稍后配置', '跳过', 'Skip']) {
    const clicked = await ev(`(async () => {
      const end = Date.now() + 4000
      const find = () => {
        const c = [...document.querySelectorAll('button')].filter((e) => (e.textContent || '').trim() === ${JSON.stringify(label)} && e.getBoundingClientRect().height > 0)
        return c[0] || null
      }
      while (Date.now() < end) { const el = find(); if (el) { el.click(); return 'clicked' } await new Promise((r) => setTimeout(r, 200)) }
      return 'none'
    })()`)
    void clicked
    await sleep(600)
  }
  const booted = await ev(`(() => {
    const btns = [...document.querySelectorAll('button')].filter((b) => (b.getAttribute('title') || b.getAttribute('aria-label')))
    return JSON.stringify({ n: btns.length, hasSidebar: !!document.querySelector('[data-shell-overlay]') || btns.some((b) => /新建会话|New session/i.test(b.getAttribute('aria-label') || b.getAttribute('title') || '')) })
  })()`)
  let bd = { n: 0, hasSidebar: false }
  try { bd = JSON.parse(booted.v) } catch { /* ignore */ }
  check('harness 启动（带 title/aria 的按钮已渲染）', bd.n > 3 && bd.hasSidebar === true, '按钮=' + bd.n + '，侧栏/frame=' + bd.hasSidebar)

  // ---- 4. 打开音乐面板 ----
  const opened = await ev(`(async () => {
    const end = Date.now() + 10000
    const hit = () => [...document.querySelectorAll('button')].find((b) => {
      const s = (b.getAttribute('title') || '') + '|' + (b.getAttribute('aria-label') || '') + '|' + (b.textContent || '')
      return /网易云音乐|wyymusic|dsh-wyymusic/i.test(s) && b.getBoundingClientRect().height > 0
    })
    while (Date.now() < end) { const b = hit(); if (b) { b.click(); return 'clicked:' + (b.getAttribute('title') || b.getAttribute('aria-label') || b.textContent || '').trim() } await new Promise((r) => setTimeout(r, 250)) }
    return 'none'
  })()`)
  const pageOk = await poll(`document.querySelector('.wyy-page') !== null`, 15000)
  check('侧栏入口点开音乐面板', opened.v !== 'none' && pageOk === true, String(opened.v) + ' / .wyy-page=' + pageOk)

  // 语言钉到 zh（氛围文案断言不依赖它，但截图/文案要一致）
  await ev(`(async () => {
    const end = Date.now() + 6000
    while (Date.now() < end) {
      const p = document.querySelector('.wyy-page')
      if (p && p.getAttribute('data-lang') === 'zh') return 'zh'
      const b = document.querySelector('.wyy-lang')
      if (b) b.click()
      await new Promise((r) => setTimeout(r, 300))
    }
    return 'stuck'
  })()`)

  // ---- 5. 左栏下栏的三个按钮 → 点亮氛围 ----
  const railBtns = await ev(`JSON.stringify([...document.querySelectorAll('.wyy-rail-amb-btn')].map((b) => b.getAttribute('data-amb-toggle')))`)
  check('左栏下栏 3 个按钮（bg/bar/set）', railBtns.v === '["bg","bar","set"]', String(railBtns.v))
  // 品牌行右侧的三连此时还没歌可放（队列为空）⇒ 必须是禁用的。等到后面真播起来了再验它们真管事。
  const ctlIdle = await ev(`(() => {
    const bs = [...document.querySelectorAll('.wyy-brand-ctl button')]
    return JSON.stringify({ n: bs.length, disabled: bs.map((b) => b.disabled === true) })
  })()`)
  let ci0 = {}
  try { ci0 = JSON.parse(ctlIdle.v) } catch { /* ignore */ }
  check('反证：队列为空时品牌行三连是禁用的（不是"按了没反应"）',
    ci0.n === 3 && ci0.disabled.join(',') === 'true,true,true', '个数=' + ci0.n + '，disabled=' + JSON.stringify(ci0.disabled))
  // 快捷按钮在"总开关已开"时是**切换**语义，所以不能"点一下就当它开了"：
  // 按观察结果驱动到开（最多 4 次），再量结果。
  const driveOn = async (expr, probe, tries = 4) => {
    for (let i = 0; i < tries; i++) {
      const r = await ev(probe)
      if (r.v === true) return true
      await ev(expr)
      await sleep(400)
    }
    return (await ev(probe)).v === true
  }
  const bgOnOk = await driveOn(
    `document.querySelector('.wyy-rail-amb-btn[data-amb-toggle="bg"]').click()`,
    `(() => { const el = document.querySelector('.wyy-amb'); const r = document.querySelector('.wyy-amb-bg-root'); return !!el && el.getAttribute('data-amb') === 'on' && !!r && r.getAttribute('data-amb-bg') === 'on' && !!r.querySelector('.wyy-amb-cover') })()`,
  )
  check('点亮后背景层挂出（糊封面 + 取色地板）', bgOnOk === true, 'data-amb=on + bg-root(cover/floor) → ' + bgOnOk)

  // 层级证据：氛围层必须在**宿主 frame 的 overlay**里，而不是我们面板内部
  const layer = await ev(`(() => {
    const amb = document.querySelector('.wyy-amb')
    if (!amb) return JSON.stringify({ amb: false })
    const overlay = document.querySelector('[data-shell-overlay]')
    const page = document.querySelector('.wyy-page')
    return JSON.stringify({
      inOverlay: !!(overlay && overlay.contains(amb)),
      inPage: !!(page && page.contains(amb)),
      overlayExists: !!overlay,
      pos: getComputedStyle(amb.parentElement).position,
      parentZ: getComputedStyle(amb.parentElement).zIndex,
    })
  })()`)
  let layerObj = {}
  try { layerObj = JSON.parse(layer.v) } catch { /* ignore */ }
  check('氛围层挂在宿主 frame 的 shell.overlay（不在插件面板里）',
    layerObj.inOverlay === true && layerObj.inPage === false,
    JSON.stringify(layerObj))
  const ambNodes = await ev(`document.querySelectorAll('.wyy-amb *, .wyy-amb-bg-root *').length`)
  const ambCanvas = await ev(`document.querySelectorAll('.wyy-amb canvas').length`)
  const ambFilter = await ev(`[...document.querySelectorAll('.wyy-amb *, .wyy-amb-bg-root *')].filter((e) => (getComputedStyle(e).filter || 'none') !== 'none').length`)
  const bgBlur = await ev(`(() => { const c = document.querySelector('.wyy-amb-cover'); return c ? (getComputedStyle(c).filter || 'none') : 'missing' })()`)
  check('低成本实现：无 canvas、只有背景层那一个静态 blur（不是逐帧滤镜）',
    ambCanvas.v === 0 && ambFilter.v === 1 && /blur\(70px\)/.test(String(bgBlur.v)),
    'DOM 节点 ' + ambNodes.v + ' 个，canvas=' + ambCanvas.v + '，带 filter 的元素=' + ambFilter.v + '（背景封面：' + String(bgBlur.v).slice(0, 28) + '）')

  // "塞在整个底下"的架构证据：背景层必须是 frame 的**第一个子节点**，且不在 overlay 层里
  const bottom = await ev(`(() => {
    const r = document.querySelector('.wyy-amb-bg-root')
    if (!r) return JSON.stringify({ ok: false })
    const overlay = document.querySelector('[data-shell-overlay]')
    const frame = overlay ? overlay.parentElement : null
    return JSON.stringify({
      first: !!(frame && frame.firstElementChild === r),
      inOverlay: !!(overlay && overlay.contains(r)),
      parentCls: String((r.parentElement && r.parentElement.className) || '').slice(0, 24),
      cols: (() => { const s = getComputedStyle(r); return [s.left, s.right, s.opacity] })(),
    })
  })()`)
  let bt = {}
  try { bt = JSON.parse(bottom.v) } catch { /* ignore */ }
  check('背景层插在 frame 最底下（首个子节点、不在 overlay 里）', bt.first === true && bt.inOverlay === false,
    JSON.stringify(bt))

  // ---- 6. 播一首歌 → 真音频分析 ----
  await ev(`(async () => {
    const end = Date.now() + 12000
    const hit = () => [...document.querySelectorAll('.wyy-rail-item')].find((e) => (e.textContent || '').trim() === '排行榜')
    while (Date.now() < end) { const b = hit(); if (b) { b.click(); return 'ok' } await new Promise((r) => setTimeout(r, 250)) }
    return 'miss'
  })()`)
  await poll(`document.querySelectorAll('.wyy-row').length > 0`, 20000)
  await ev(`document.querySelector('.wyy-row').click()`)
  const playing = await poll(`(() => { const a = document.querySelector('audio'); return !!a && !a.paused && a.currentTime > 0.15 })()`, 40000, 500)
  check('点歌后真的在播（audio.currentTime 在走）', playing === true, 'playing=' + playing)
  const tap = await poll(`(() => { const el = document.querySelector('.wyy-amb'); return el ? el.getAttribute('data-amb-audio') : null })()`, 20000, 400)
  const tapErr = await ev(`(() => { const el = document.querySelector('.wyy-amb'); return el ? (el.getAttribute('data-amb-err') || '(无 err)') : '(无 .wyy-amb)' })()`)
  // 抽头不可用时先手工复现一次：分清"这个环境没有 captureStream/音轨"与"我们的接线写错"
  const manual = await ev(`(async () => {
    const a = document.querySelector('audio')
    if (!a) return 'no <audio>'
    const info = { cap: typeof a.captureStream, proto: typeof HTMLMediaElement.prototype.captureStream, ac: typeof window.AudioContext, paused: a.paused, rs: a.readyState }
    if (typeof a.captureStream !== 'function') return JSON.stringify(Object.assign(info, { verdict: 'captureStream 不存在' }))
    try {
      const ctx = new window.AudioContext()
      const an = ctx.createAnalyser(); an.fftSize = 1024
      const st = a.captureStream()
      const tracks = st.getAudioTracks()
      if (tracks.length === 0) return JSON.stringify(Object.assign(info, { verdict: 'captureStream 返回 0 音轨，state=' + ctx.state }))
      const src = ctx.createMediaStreamSource(st)
      src.connect(an)
      await new Promise((r) => setTimeout(r, 1500))
      const buf = new Uint8Array(an.frequencyBinCount)
      an.getByteFrequencyData(buf)
      let mx = 0
      for (const v of buf) mx = Math.max(mx, v)
      return JSON.stringify(Object.assign(info, { verdict: '手工抽头可跑', tracks: tracks.length, state: ctx.state, max: mx, head: Array.from(buf.slice(0, 6)) }))
    } catch (e) { return JSON.stringify(Object.assign(info, { verdict: 'THREW: ' + String((e && e.message) || e) })) }
  })()`)
  console.log('  抽头诊断：' + manual.v)
  check('音频抽头就绪（data-amb-audio=ok）', tap === 'ok', 'data-amb-audio=' + tap + '，err=' + tapErr.v)
  const levelProbe = await ev(`(async () => {
    const el = document.querySelector('.wyy-amb')
    const t0 = Date.now()
    let maxL = 0, maxB = 0, barMin = 1, barMax = 0
    const bars = [...document.querySelectorAll('.wyy-amb-bar i')]
    while (Date.now() - t0 < 9000) {
      maxL = Math.max(maxL, parseFloat(el.getAttribute('data-amb-level') || '0'))
      maxB = Math.max(maxB, parseInt(el.getAttribute('data-amb-beats') || '0', 10))
      for (const b of bars) {
        const m = /scaleY\\(([\\d.]+)\\)/.exec(b.style.transform || '')
        if (m) { const v = parseFloat(m[1]); barMin = Math.min(barMin, v); barMax = Math.max(barMax, v) }
      }
      await new Promise((r) => setTimeout(r, 120))
    }
    return JSON.stringify({ maxL, maxB, barMin, barMax, tap: el.getAttribute('data-amb-tap'), err: el.getAttribute('data-amb-err') })
  })()`)
  let lv = {}
  try { lv = JSON.parse(levelProbe.v) } catch { /* ignore */ }
  console.log('  抽头实况：' + (lv.tap || '?') + ' / err=' + (lv.err || '(无)'))
  check('电平随音乐跳动（level>0.02）', (lv.maxL || 0) > 0.02, '9s 内 max level=' + lv.maxL)
  check('柱子响应频谱（scaleY 有实际变化）', (lv.barMax || 0) > (lv.barMin || 0) + 0.05,
    'scaleY 区间 [' + lv.barMin + ',' + lv.barMax + ']')
  const blobMove = await ev(`(async () => {
    const b = document.querySelector('.wyy-amb-cover')
    if (!b) return JSON.stringify({ err: 'no cover' })
    const read = () => b.style.transform
    const t0 = Date.now()
    const first = read()
    let changed = 0
    while (Date.now() - t0 < 2500) { if (read() !== first) changed++; await new Promise((r) => setTimeout(r, 150)) }
    return JSON.stringify({ changed, sample: first })
  })()`)
  let bm = {}
  try { bm = JSON.parse(blobMove.v) } catch { /* ignore */ }
  check('背景在缓慢迁移（transform 在变，颜色不动）', (bm.changed || 0) > 3,
    '2.5s 内 transform 变化 ' + bm.changed + ' 次，样本=' + bm.sample)
  await shot('amb-music-playing')

  // ---- 7. 取色确实"跟着歌走"：换一首封面不同的歌，氛围层的色必须变，且与面板 L3 令牌同源 ----
  {
    // 颜色一律先归一化再比：我们的层上写的是 hex（内联），面板上读到的是 computed 的 rgb()——
    // 同一个色会以两种写法出现（首次跑就栽在这：`#d42c74` vs `rgb(212, 44, 116)` 被判不等）。
    const readVars = `(() => { const el = document.querySelector('.wyy-amb-bg-root'); const page = document.querySelector('.wyy-page');
      const norm = (v) => { const d = document.createElement('div'); d.style.color = v; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c };
      return JSON.stringify({
        c1: el ? el.style.getPropertyValue('--amb-c1-l') : '',
        art: page ? getComputedStyle(page).getPropertyValue('--art-vivid-l') : '',
        playing: (() => { const s = document.querySelector('.wyy-bar-title'); return s ? s.textContent : '' })(),
      }) })()`
    const a = await ev(readVars)
    let va = {}
    try { va = JSON.parse(a.v) } catch { /* ignore */ }
    const same = await ev(`(() => { const norm = (v) => { const d = document.createElement('div'); d.style.color = v; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c };
      return norm(${JSON.stringify(va.c1)}) === norm(${JSON.stringify(va.art)}) })()`)
    const rows = await ev(`document.querySelectorAll('.wyy-row').length`)
    if ((rows.v || 0) > 1 && va.c1 !== '') {
      check('氛围取色与面板 L3 令牌同源（同一张封面 → 同一个色）', same.v === true,
        '氛围 --amb-c1-l=' + va.c1 + '，面板 --art-vivid-l=' + va.art + '（归一化后相同=' + same.v + '，曲目 ' + va.playing + '）')
      await ev(`document.querySelectorAll('.wyy-row')[1].click()`)
      const changed = await poll(`(() => { const el = document.querySelector('.wyy-amb-bg-root'); if (!el) return null; const v = el.style.getPropertyValue('--amb-c1-l'); return (v && v !== ${JSON.stringify(va.c1)}) ? v : null })()`, 25000, 400)
      check('换歌后氛围色真的换掉（取色跟着当前歌曲）', typeof changed === 'string' && changed !== va.c1,
        '第二首的 --amb-c1-l=' + changed + '（第一首是 ' + va.c1 + '）')
    } else {
      check('氛围取色与面板 L3 令牌同源（同一张封面 → 同一个色）', false, '没有第二行可点或氛围层没色：' + JSON.stringify(va))
      check('换歌后氛围色真的换掉（取色跟着当前歌曲）', false, '前置不满足')
    }
  }

  // ---- 7a. 真点击的跳转守卫（用户报过"点进度条/歌词/下一首都跳回曲首"；之前缺的就是这条腿）----
  {
    const before = (await ev(`(() => { const a = document.querySelector('audio'); return JSON.stringify({ ct: Math.round(a.currentTime * 10) / 10, dur: Number.isFinite(a.duration) ? Math.round(a.duration * 10) / 10 : null, title: (document.querySelector('.wyy-bar-title') || {}).textContent }) })()`)).v
    let bf = {}
    try { bf = JSON.parse(before) } catch { /* ignore */ }
    const trk = (await ev(`(() => { const tr = document.querySelector('.wyy-bar-prog .wyy-track'); if (!tr) return null; const r = tr.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width * 0.7), y: Math.round(r.top + r.height / 2) }) })()`)).v
    let tk = null
    try { tk = JSON.parse(trk) } catch { /* ignore */ }
    if (tk === null || bf.dur === null) {
      check('点进度条 70% → 真的跳到 70%（±4s）', false, '前置不足：dur=' + bf.dur + ' track=' + trk)
    } else {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: tk.x, y: tk.y, button: 'left', clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tk.x, y: tk.y, button: 'left', clickCount: 1 })
      await sleep(1500)
      const after = (await ev(`(() => { const a = document.querySelector('audio'); return JSON.stringify({ ct: Math.round(a.currentTime * 10) / 10, seek: a.getAttribute('data-seek'), ui: (document.querySelector('.wyy-time') || {}).textContent }) })()`)).v
      let af = {}
      try { af = JSON.parse(after) } catch { /* ignore */ }
      const want = bf.dur * 0.7
      check('点进度条 70% → 真的跳到 70%（±4s）',
        Math.abs((af.ct || 0) - want) <= 4,
        '目标 ' + Math.round(want) + 's，实测 ' + af.ct + 's（点前 ' + bf.ct + 's，dur=' + bf.dur + '），data-seek=' + af.seek)
      // 歌词行：进全屏点靠后的一行，必须落到后半段（不是回曲首）
      await ev(`(() => { const b = [...document.querySelectorAll('.wyy-bar-right .wyy-btn.ghost.small')][0]; if (b) b.click(); return 'ok' })()`)
      const npOpen = await poll(`document.querySelectorAll('.wyy-np-ly').length > 3`, 15000)
      await sleep(1200)
      const lineClick = await ev(`(() => { const ls = [...document.querySelectorAll('.wyy-np-ly')]; if (ls.length < 4) return null
        const el = ls[Math.floor(ls.length * 0.7)]
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        return JSON.stringify({ text: (el.textContent || '').slice(0, 14), idx: Math.floor(ls.length * 0.7), n: ls.length }) })()`)
      await sleep(1500)
      const afterLy = (await ev(`(() => { const a = document.querySelector('audio'); return JSON.stringify({ ct: Math.round(a.currentTime * 10) / 10, seek: a.getAttribute('data-seek') }) })()`)).v
      let al = {}
      try { al = JSON.parse(afterLy) } catch { /* ignore */ }
      check('点靠后一行歌词 → 落到后半段（不是回曲首）',
        npOpen === true && (al.ct || 0) > bf.dur * 0.45,
        '点 ' + lineClick + '，实测 ' + al.ct + 's（dur=' + bf.dur + '，后半段门槛 ' + Math.round(bf.dur * 0.45) + 's），data-seek=' + al.seek)
      // 全屏歌词**自己的地板**必须保持不透明：背景层的"让开宿主表面"曾经把采样点上的
      // NowPlaying 地板当成挡路表面清成透明（用户报的"开全屏歌词时那块背景突然透了"）。
      await sleep(1200) // 让 2Hz 的 ambClearCovers 至少跑一拍
      const npg = await ev(`(() => {
        const g = document.querySelector('.wyy-np-ground')
        if (!g) return JSON.stringify({ err: 'no .wyy-np-ground' })
        const s = getComputedStyle(g)
        return JSON.stringify({ bg: s.backgroundColor, self: g.hasAttribute('data-amb-cleared'), cleared: document.querySelectorAll('[data-amb-cleared]').length })
      })()`)
      let ng = {}
      try { ng = JSON.parse(npg.v) } catch { /* ignore */ }
      check('全屏歌词地板保持不透明（不被"让开宿主表面"误清）',
        ng.err === undefined && ng.bg !== 'rgba(0, 0, 0, 0)' && ng.bg !== 'transparent' && ng.self === false,
        '地板底=' + ng.bg + '，自己被清=' + ng.self + '，全页被清元素数=' + ng.cleared)
      // 收起全屏，免得挡住后面的面板操作
      await ev(`(() => { const b = document.querySelector('.wyy-np-collapse'); if (b) b.click(); return 'ok' })()`)
      await sleep(1600)
      // 下一首：必须**换歌**（曲名变 + 新歌从 0 起播），而不是原地回到本曲开头
      const beforeNext = (await ev(`(() => { const a = document.querySelector('audio'); return JSON.stringify({ title: (document.querySelector('.wyy-bar-title') || {}).textContent, ct: Math.round(a.currentTime * 10) / 10 }) })()`)).v
      await ev(`(() => { const b = [...document.querySelectorAll('.wyy-bar-ctrl .wyy-icon-btn')].find((x) => /下一首/.test(x.getAttribute('title') || '')); if (b) b.click(); return 'ok' })()`)
      await sleep(2600)
      const afterNext = (await ev(`(() => { const a = document.querySelector('audio'); return JSON.stringify({ title: (document.querySelector('.wyy-bar-title') || {}).textContent, ct: Math.round(a.currentTime * 10) / 10, seek: a.getAttribute('data-seek') }) })()`)).v
      let bn = {}
      let an = {}
      try { bn = JSON.parse(beforeNext); an = JSON.parse(afterNext) } catch { /* ignore */ }
      check('点下一首 → 真的换歌（曲名变、新曲从 0 起播）',
        bn.title !== undefined && an.title !== undefined && an.title !== bn.title && (an.ct || 99) < 8,
        '「' + bn.title + '」→「' + an.title + '」，新曲 ' + an.ct + 's，data-seek=' + an.seek)

      // 品牌行右侧的三连（用户点名要的"三个小按钮"）：要在"网易云音乐"那一行的右边，
      // 而且要**真能控制播放**（换歌 / 暂停恢复），不是三个装饰。
      const ctlInfo = await ev(`(() => {
        const line = document.querySelector('.wyy-brandline')
        const box = document.querySelector('.wyy-brand-ctl')
        const bs = box ? [...box.querySelectorAll('button')] : []
        const lr = line ? line.getBoundingClientRect() : null
        const br = bs.length > 0 ? bs[0].getBoundingClientRect() : null
        const label = line ? [...line.children].find((e) => e.tagName === 'B') : null
        const rr = label ? label.getBoundingClientRect() : null
        return JSON.stringify({
          keys: bs.map((b) => b.getAttribute('data-brand-ctl')),
          labels: bs.map((b) => b.getAttribute('aria-label')),
          disabled: bs.map((b) => b.disabled === true),
          sameRow: lr !== null && br !== null && Math.round(br.top) >= Math.round(lr.top) && Math.round(br.bottom) <= Math.round(lr.bottom),
          rightOfTitle: rr !== null && br !== null && br.left >= rr.right,
          rowWidth: lr === null ? 0 : Math.round(lr.width),
        })
      })()`)
      let ci = {}
      try { ci = JSON.parse(ctlInfo.v) } catch { /* ignore */ }
      check('品牌行右侧 3 个播放控制钮（上一首/停·播/下一首）',
        ci.keys && ci.keys.join('/') === 'prev/toggle/next' && ci.sameRow === true && ci.rightOfTitle === true
        && ci.labels && ci.labels.every((x) => typeof x === 'string' && x.length > 0) && ci.disabled.join(',') === 'false,false,false',
        'keys=' + JSON.stringify(ci.keys) + '，文案=' + JSON.stringify(ci.labels) + '，disabled=' + JSON.stringify(ci.disabled)
        + '，同行=' + ci.sameRow + '，在标题右侧=' + ci.rightOfTitle + '（行宽 ' + ci.rowWidth + 'px）')
      // 品牌名不许被这三连挤到截断 —— 它真的被挤过：整行只剩 ~200px，名字被截成"DSH · 网…"
      // （前缀吃掉了名字自己的位置）。现在只渲染名字，rail 收窄到最窄档 176px 时名字整个退场。
      const brandFit = await ev(`(() => {
        const rail = document.querySelector('.wyy-rail')
        const b0 = document.querySelector('.wyy-brandline b')
        if (!rail || !b0) return JSON.stringify({ err: 'no brandline' })
        const wide = { text: b0.textContent, clipped: b0.scrollWidth > b0.clientWidth + 1 }
        const w0 = rail.style.width
        rail.style.width = '176px'
        const b1 = document.querySelector('.wyy-brandline b')
        const narrow = {
          hidden: b1 === null || getComputedStyle(b1).display === 'none',
          ctls: document.querySelectorAll('.wyy-brand-ctl button').length,
        }
        rail.style.width = w0 || ''
        return JSON.stringify({ text: wide.text, clipped: wide.clipped, hidden: narrow.hidden, ctls: narrow.ctls })
      })()`)
      let bi = {}
      try { bi = JSON.parse(brandFit.v) } catch { /* ignore */ }
      check('品牌名不被三连挤到截断；rail 收到最窄档时名字退场、三连还在',
        bi.text !== undefined && bi.text.length > 0 && bi.text.indexOf('·') < 0 && bi.clipped === false
        && bi.hidden === true && bi.ctls === 3,
        '名字="' + bi.text + '"（1..232px 档）截断=' + bi.clipped + '；收到 176px → 名字隐藏=' + bi.hidden
        + '，三连=' + bi.ctls + ' 个')
      const clickCtl = (k) => ev(`(() => { const b = document.querySelector('[data-brand-ctl="${k}"]'); if (!b) return 'missing'; b.click(); return 'clicked' })()`)
      const titleNow = async () => {
        const r = await ev(`(() => { const a = document.querySelector('audio'); return JSON.stringify({ t: (document.querySelector('.wyy-bar-title') || {}).textContent, ct: Math.round((a ? a.currentTime : 0) * 10) / 10, paused: a ? a.paused : null }) })()`)
        try { return JSON.parse(r.v) } catch { return {} }
      }
      const beforeCtl = await titleNow()
      await ev(`(() => { window.__ambT0 = (document.querySelector('.wyy-bar-title') || {}).textContent || ''; return 'ok' })()`)
      await clickCtl('next')
      const nextOk = await poll(`(() => { const t = (document.querySelector('.wyy-bar-title') || {}).textContent; return t !== window.__ambT0 })()`, 8000, 300)
      await sleep(4200) // 让新曲走一会儿，好验证"上一首"走的是"回曲首"那一支
      const midCtl = await titleNow()
      await ev(`(() => { window.__ambT1 = (document.querySelector('.wyy-bar-title') || {}).textContent || ''; return 'ok' })()`)
      await clickCtl('prev')
      const prevOk = await poll(`(() => {
        const a = document.querySelector('audio')
        const t = (document.querySelector('.wyy-bar-title') || {}).textContent
        return t === window.__ambT0 || (t === window.__ambT1 && !!a && a.currentTime < 1.5)
      })()`, 8000, 300)
      await sleep(600)
      const afterPrev = await titleNow()
      await clickCtl('toggle')
      const pausedOk = await poll(`(() => { const a = document.querySelector('audio'); return !!a && a.paused === true })()`, 6000, 300)
      await clickCtl('toggle')
      const resumedOk = await poll(`(() => { const a = document.querySelector('audio'); return !!a && a.paused === false })()`, 8000, 300)
      const afterToggle = await titleNow()
      check('品牌行三连真的控制播放（下一首换歌 / 上一首回退 / 停·播切换）',
        nextOk === true && prevOk === true && pausedOk === true && resumedOk === true,
        '下一首→' + nextOk + '，「' + beforeCtl.t + '」→「' + midCtl.t + '」；上一首→' + prevOk + '（' + midCtl.ct + 's → ' + afterPrev.ct
        + 's，「' + afterPrev.t + '」）；暂停→' + pausedOk + '，恢复→' + resumedOk + '（paused=' + afterToggle.paused + '）')
    }
  }

  // ---- 7a-2. 换歌那一瞬间点进度条（探针 R1 的形状：点下去时 <audio> 还装着上一首）----
  // 用户报的"点进度条直接跳到曲首"里最脏的一支：点下去那一刻 state 已切到新曲、而元素还装着旧曲。
  // 旧实现在这个窗口里把"按旧曲算出的绝对时刻"写给旧元素，浏览器把这条待定 seek 带进新资源、
  // 钳到新曲末尾（探针 R1 实测：seeked@1.26s ct=末尾 → ended → 自动跳下一首）。
  // 现在的守卫：元素装的不是这次点击那首就**先不写**，等它真装上再按**点击比例**落。
  // 这条腿刻意选"短曲当点击目标、长曲当正在播的那首"（0.7×长 > 短曲全长）：
  // 守卫或比例折算任一被撤掉，落点都会掉进钳位 → ended → 自动换歌，这条腿立刻变红。
  // 两个"口径坑"（第一版都踩了，写在这里免得再踩）：
  //   ① 曲单钉在**队列抽屉**上 —— 面板页在别的腿里可能停在搜索/歌单页（.wyy-row 实测 0）；
  //   ② "这首放起来了"的判据必须是**元素真的装上这首**（sid 换人 + 标题对上 + 数据到位）：
  //      只测"rs=4 且在播"会拿到**上一首**的状态，基准时长取错，对的落点会被误判成红的。
  {
    const elState = async () => {
      const r = await ev(`(() => { const a = document.querySelector('audio'); if (!a) return '{}'
        return JSON.stringify({ sid: ((a.src || '').match(/id=(\\d+)/) || [])[1] || '',
          dur: Number.isFinite(a.duration) ? Math.round(a.duration * 10) / 10 : 0,
          ct: Math.round(a.currentTime * 10) / 10, rs: a.readyState, paused: a.paused,
          title: (document.querySelector('.wyy-bar-title') || {}).textContent }) })()`)
      try { return JSON.parse(r.v) } catch { return {} }
    }
    const QROW = (i) => `document.querySelectorAll('.wyy-queue .wyy-row')[${i}]`
    /**
     * 点队列第 i 行 → 等**元素真的装上这首**：sid 换人 + 标题对上 + 在播 + 数据到位，
     * 然后再等 1.6s 让时长收敛（流式 MP3 的 duration 会随数据修正，拿早期估计当基准会误判）。
     */
    const clickRowSettle = async (i) => {
      const pre = await elState()
      const rt = await ev(`(() => { const r = ${QROW(i)}; return r ? ((r.querySelector('.wyy-row-title') || {}).textContent || '') : null })()`)
      if (rt.v === null || rt.v === undefined) return { i: i, ok: false, pre: pre, why: '第 ' + i + ' 行不在队列里' }
      const title = String(rt.v)
      const cl = await ev(`(() => { const r = ${QROW(i)}; if (!r) return 'missing'; r.click(); return 'ok' })()`)
      if (cl.v !== 'ok') return { i: i, ok: false, pre: pre, title: title, why: '点不动：' + String(cl.v) }
      const reached = await poll(`(() => {
        const a = document.querySelector('audio'); if (!a) return false
        const sid = ((a.src || '').match(/id=(\\d+)/) || [])[1] || ''
        const t = ((document.querySelector('.wyy-bar-title') || {}).textContent) || ''
        return sid !== '' && sid !== '${pre.sid}' && t === ${JSON.stringify(title)} && a.paused === false && a.readyState === 4 && a.currentTime > 0.3
      })()`, 15000, 250)
      await sleep(1600)
      const post = await elState()
      const ok = reached === true && post.sid !== pre.sid
      return { i: i, ok: ok, pre: pre, post: post, title: title, why: ok ? '' : '15s 内没等到它上元素（rs=' + post.rs + ' ct=' + post.ct + ' sid=' + post.sid + '）' }
    }
    const emit = (ok1, ok2, msg1, msg2) => {
      check('换歌瞬间点进度条 → 按点击比例落到新曲对应位置（不是曲首/曲末）', ok1, msg1)
      check('换歌瞬间点进度条后不被"待定 seek"带跑（不 ended、不自动换歌）', ok2, msg2)
    }
    const readRows = () => ev(`(() => {
        const parse = (s) => { const m = /(\\d+):(\\d\\d)/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : 0 }
        return JSON.stringify([...document.querySelectorAll('.wyy-queue .wyy-row')].map((r, i) => ({
          i, dur: parse(((r.querySelector('.wyy-row-dur') || {}).textContent) || ''),
          name: (((r.querySelector('.wyy-row-title') || {}).textContent) || '').slice(0, 10),
          active: r.classList.contains('active'),
        })))
      })()`)
    // 列表口径钉在**队列抽屉**上：面板页在别的腿里可能停在搜索/歌单页（.wyy-row 实测为 0），
    // 队列抽屉是"哪一页都能开、整队在列"的那一份（第一次跑这条腿就栽在 rows=0 上）。
    const openQueue = async () => {
      const n = await ev(`document.querySelectorAll('.wyy-queue .wyy-row').length`)
      if ((n.v || 0) > 0) return n.v
      await ev(`(() => {
        const b = [...document.querySelectorAll('.wyy-bar button')].find((x) => /队列|Queue/.test((x.getAttribute('aria-label') || '') + (x.getAttribute('title') || '')))
        if (b) b.click()
        return b ? 'clicked' : 'missing'
      })()`)
      return await poll(`document.querySelectorAll('.wyy-queue .wyy-row').length`, 10000, 300)
    }
    const closeQueue = async () => {
      const n = await ev(`document.querySelectorAll('.wyy-queue .wyy-row').length`)
      if (!((n.v || 0) > 0)) return true
      await ev(`(() => { const b = document.querySelector('.wyy-queue .wyy-icon-btn'); if (b) b.click(); return 'ok' })()`)
      const left = await poll(`document.querySelectorAll('.wyy-queue .wyy-row').length`, 4000, 250)
      return !((left || 0) > 0)
    }
    await openQueue()
    const cur = await elState()
    const rowsRes = await readRows()
    let list = []
    try { list = JSON.parse(rowsRes.v || '[]') } catch { /* ignore */ }
    const withDur = list.filter((x) => x.dur > 0)
    // 开局那首（active 行；兜底按标题对）：收尾点回去 —— 后面的像素腿取的是"当前歌曲的色"
    const curRow = withDur.find((x) => x.active === true)
      || withDur.find((x) => String(cur.title || '') !== '' && x.name === String(cur.title).slice(0, 10)) || null
    // 候选只按**行提示时长**挑最长/最短那两行；基准与判据一律用元素实测时长
    const byHint = withDur.slice().sort((a, b) => b.dur - a.dur)
    const cands = []
    for (const Lc of byHint.slice(0, 2)) for (const Sc of byHint.slice(-2).reverse()) if (Sc.i !== Lc.i) cands.push({ Lc: Lc, Sc: Sc })
    const note = []
    let pair = null
    for (const c of cands.slice(0, 3)) {
      const S = await clickRowSettle(c.Sc.i)
      if (!S.ok) { note.push('短#' + c.Sc.i + '：' + S.why); continue }
      const L = await clickRowSettle(c.Lc.i)
      if (!L.ok) { note.push('长#' + c.Lc.i + '：' + L.why); continue }
      note.push('短#' + c.Sc.i + '「' + S.title + '」实测 ' + S.post.dur + 's ／ 长#' + c.Lc.i + '「' + L.title + '」实测 ' + L.post.dur + 's')
      // 反证成立的前提：0.7×长曲 > 短曲全长（否则"待定 seek 被钳到末尾"那条路根本进不去，这条腿白跑）
      if (S.post.dur > 10 && 0.7 * L.post.dur > S.post.dur + 5) { pair = { S: S, L: L }; break }
    }
    if (pair === null) {
      emit(false, false,
        '队列里挑不出一对"0.7×长曲 > 短曲全长"的曲对：' + note.join('；') + '；队列（前 6 行）=' + JSON.stringify(withDur.slice(0, 6)),
        '前置不满足')
    }
    if (pair !== null) {
      // 配对循环结束时元素正停在**长曲**上（S 先点、L 后点），正是竞态要的前置
      const S = pair.S
      const L = pair.L
      // 竞态：同一个同步块里"点歌 + 点进度条 70%"。取链是 fetch（宏任务），所以这一瞬元素必然还装着长曲
      const race = await ev(`(() => {
        const a = document.querySelector('audio')
        const target = ${QROW(S.i)}
        const st = { t0: performance.now(), durLog: [] }
        window.__ambSeekRace = st
        a.addEventListener('durationchange', () => {
          if (st.durLog.length < 24) st.durLog.push({ ms: Math.round(performance.now() - st.t0),
            dur: Number.isFinite(a.duration) ? Math.round(a.duration * 10) / 10 : 0,
            rs: a.readyState, ct: Math.round(a.currentTime * 10) / 10 })
        })
        const beforeDur = Number.isFinite(a.duration) ? Math.round(a.duration * 10) / 10 : 0
        const beforeSid = ((a.src || '').match(/id=(\\d+)/) || [])[1] || ''
        const beforeTitle = (document.querySelector('.wyy-bar-title') || {}).textContent
        target.click()
        const bar = document.querySelector('.wyy-bar-prog .wyy-track')
        const r0 = bar.getBoundingClientRect()
        const x = Math.round(r0.left + r0.width * 0.7)
        const y = Math.round(r0.top + r0.height / 2)
        const ratio = Math.round(((x - r0.left) / (r0.width || 1)) * 1000) / 1000
        for (const type of ['pointerdown', 'pointerup', 'click']) {
          bar.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0 }))
        }
        return JSON.stringify({ beforeSid: beforeSid, beforeDur: beforeDur, beforeTitle: beforeTitle,
          sidAtClick: ((a.src || '').match(/id=(\\d+)/) || [])[1] || '', ratio: ratio })
      })()`)
      const rc = (() => { try { return JSON.parse(race.v) } catch { return {} } })()
      const seekNow = async () => {
        const r = await ev(`(() => { const a = document.querySelector('audio'); if (!a) return '{}'
          const s = a.getAttribute('data-seek')
          let j = {}
          try { j = JSON.parse(s) } catch { /* ignore */ }
          return JSON.stringify({ raw: s, sid: ((a.src || '').match(/id=(\\d+)/) || [])[1] || '',
            ct: Math.round(a.currentTime * 10) / 10,
            dur: Number.isFinite(a.duration) ? Math.round(a.duration * 10) / 10 : 0,
            rs: a.readyState, result: j.result || '', target: j.target, got: j.got, via: j.via,
            tries: j.tries, hist: j.hist, diagDur: j.dur, seekEnd: j.seekEnd, bufEnd: j.bufEnd,
            title: (document.querySelector('.wyy-bar-title') || {}).textContent }) })()`)
        try { return JSON.parse(r.v) } catch { return {} }
      }
      const landed = await poll(`(() => { const a = document.querySelector('audio'); if (!a) return null
        const s = a.getAttribute('data-seek')
        if (!s) return null
        let j = null
        try { j = JSON.parse(s) } catch { return null }
        return (j.result === 'ok' || j.result === 'ok-reload') ? 'y' : null })()`, 20000, 300)
      const atLand = await seekNow()
      await sleep(1800)
      const held = await seekNow()
      const durLog = await ev(`JSON.stringify((window.__ambSeekRace || {}).durLog || [])`)
      const want = Math.round(S.post.dur * 0.7)
      const carried = Math.round(rc.beforeDur * 0.7)
      const brief = '点下去时装着「' + rc.beforeTitle + '」' + rc.beforeDur + 's（id=' + rc.sidAtClick + '，ratio=' + rc.ratio + '）'
        + '；落到「' + atLand.title + '」' + atLand.ct + 's／目标 ' + want + 's（点击目标实测 ' + S.post.dur + 's，长曲实测 '
        + L.post.dur + 's；若按旧曲的绝对时刻会落到 ' + carried + 's）'
      const ok1 = rc.sidAtClick !== '' && rc.sidAtClick === rc.beforeSid && rc.sidAtClick === L.post.sid
        && atLand.sid === S.post.sid && (atLand.ct || 0) > 5 && Math.abs((atLand.ct || 0) - S.post.dur * 0.7) <= 6
      const ok2 = landed === 'y' && held.sid === atLand.sid && held.title === atLand.title
        && Math.abs((held.ct || 0) - (atLand.ct || 0) - 1.8) < 1.6
      emit(ok1, ok2,
        ok1 ? brief : brief + '；result=' + atLand.result + ' tries=' + atLand.tries + ' diag.dur@落=' + atLand.diagDur
          + ' hist=' + JSON.stringify(atLand.hist || []) + '；durLog=' + String(durLog.v || '').slice(0, 200),
        '1.8s 后「' + held.title + '」' + held.ct + 's（刚落 ' + atLand.ct + 's，差 '
          + Math.round(((held.ct || 0) - (atLand.ct || 0)) * 10) / 10 + 's；result=' + held.result + ' sid=' + held.sid
          + (ok2 ? '' : '；landed=' + String(landed)))
    }
    // 收尾：把开局那首点回去 —— 后面的像素腿取的是"当前歌曲的色"，这条腿不该改它们的前置；抽屉合上
    let restored = curRow === null ? '没找到开局那首（' + String(cur.title || '') + '）的队列行' : ''
    if (curRow !== null) {
      const now = await elState()
      if (now.sid !== '' && now.sid === cur.sid) restored = '本来就在「' + curRow.name + '」'
      else {
        const rb = await clickRowSettle(curRow.i)
        restored = rb.ok ? ('点回「' + curRow.name + '」' + rb.post.dur + 's') : ('没点回来：' + rb.why)
      }
    }
    const closedOk = await closeQueue()
    console.log('  收尾：' + restored + '；队列抽屉=' + (closedOk ? '已合上' : '没合上'))
  }

  // ---- 7b. 动效 oracle（onetake：curves / rests / continuity 三腿 + 两条反证）----
  // 判据全部沿用上一轮动效腿的口径：速度按**动画自己的钟**算（document.timeline 的 rAF 时间戳），
  // 80px/帧@30fps 无快门即频闪 = 2400px/s；实时 UI 的单次写入位移上限另报一个原始 px。
  {
    const sample = await ev(`(async () => {
      const amb = document.querySelector('.wyy-amb')
      if (!amb) return JSON.stringify({ err: 'no .wyy-amb' })
      const blobs = [...document.querySelectorAll('.wyy-amb-cover')]
      const bar = document.querySelector('.wyy-amb-bar i')
      const readBar = () => {
        if (!bar) return 0
        const m = /scaleY\\(([\\d.]+)\\)/.exec(bar.style.transform || '')
        return m ? parseFloat(m[1]) : 0
      }
      const rectOf = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top] }
      const frames = []
      const t0 = document.timeline.currentTime
      let prevBar = readBar()
      let barMaxStep = 0
      await new Promise((resolve) => {
        const tick = () => {
          const t = document.timeline.currentTime
          frames.push({ t: Math.round(t - t0), pos: blobs.map(rectOf) })
          const b = readBar()
          const bs = Math.abs(b - prevBar)
          if (bs > barMaxStep) barMaxStep = bs
          prevBar = b
          if (t - t0 < 6000) requestAnimationFrame(tick)
          else resolve()
        }
        requestAnimationFrame(tick)
      })
      let maxSpeed = 0
      let maxStepPx = 0
      let movedFrames = 0
      const speeds = []
      for (let i = 1; i < frames.length; i++) {
        const dt = Math.max(1, frames[i].t - frames[i - 1].t)
        let step = 0
        for (let b = 0; b < frames[i].pos.length; b++) {
          const dx = frames[i].pos[b][0] - frames[i - 1].pos[b][0]
          const dy = frames[i].pos[b][1] - frames[i - 1].pos[b][1]
          const d = Math.sqrt(dx * dx + dy * dy)
          if (d > step) step = d
        }
        const sp = step / (dt / 1000)
        speeds.push(sp)
        if (sp > maxSpeed) maxSpeed = sp
        if (step > maxStepPx) maxStepPx = step
        if (step > 0.4) movedFrames++
      }
      let rest = 0
      let bestRest = 0
      for (const sp of speeds) {
        if (sp < 60) { rest += 33; if (rest > bestRest) bestRest = rest } else rest = 0
      }
      const env = (amb.getAttribute('data-amb-env') || '').split('|')
      return JSON.stringify({
        frames: frames.length,
        maxSpeed: Math.round(maxSpeed),
        maxStepPx: Math.round(maxStepPx * 10) / 10,
        movedFrames,
        restingMs: Math.round(bestRest),
        barMaxStep: Math.round(barMaxStep * 100) / 100,
        beats: amb.getAttribute('data-amb-beats'),
        level: amb.getAttribute('data-amb-level'),
        envAmp: env[0],
        envMove: env[1],
      })
    })()`)
    let sm = {}
    try { sm = JSON.parse(sample.v) } catch { /* ignore */ }
    console.log('  动效采样：' + JSON.stringify(sm))
    check('curves：逐帧速度不越频闪线（≤2400px/s）且单次写入位移 ≤40px',
      (sm.maxSpeed || 1e9) <= 2400 && (sm.maxStepPx || 1e9) <= 40 && (sm.movedFrames || 0) >= 10,
      '峰值 ' + sm.maxSpeed + 'px/s（线 2400），单次最大位移 ' + sm.maxStepPx + 'px（线 40），动过的帧 ' + sm.movedFrames + '（≥10 才算没空跑）')
    check('rests：6s 内存在 ≥250ms 的近静止窗（画面不是永远在动）',
      (sm.restingMs || 0) >= 250,
      '最长静止窗 ' + sm.restingMs + 'ms（线 250）')
    const barMask = await ev(`(() => { const b = document.querySelector('.wyy-amb-bar'); if (!b) return 'none'; const s = getComputedStyle(b); const m = (s.maskImage && s.maskImage !== 'none') ? s.maskImage : (s.webkitMaskImage || 'none'); return m === '' ? 'none' : m })()`)
    check('律动条顶边羽化（屏幕下方过渡不生硬）', String(barMask.v) !== 'none' && /gradient/.test(String(barMask.v)),
      'mask=' + String(barMask.v).slice(0, 60))
    // 上界是主张（"跳"不是"抖"）；下界只防空跑：**当时真的有声**才要求在动 ——
    // 换歌后新曲还在缓冲时柱子本来就该是静的（实测踩过：把静音当成了"柱子不动"的假红）。
    const audible = parseFloat(String(sm.level || 0)) > 0.05 // 只看**当前**电平：beats 是累计量，不能当"现在有声"
    check('律动条：单次写入幅度 ≤0.25（是"跳"不是"抖"）',
      sm.barMaxStep !== undefined && sm.barMaxStep <= 0.25 && (!audible || sm.barMaxStep > 0.005),
      '单次最大 scaleY 变化 ' + sm.barMaxStep + '（当时 level=' + sm.level + ' beats=' + sm.beats + '，有声=' + audible + '）')

    // continuity：换歌时取色必须**迁移**（有中间态、时长可测），不是一帧硬切
    const carryProbe = `(async (injectNone) => {
      const el = document.querySelector('.wyy-amb-bg-root')
      if (!el) return JSON.stringify({ err: 'no .wyy-amb-bg-root' })
      const inlineBefore = el.style.getPropertyValue('--amb-c1-l')
      const before = getComputedStyle(el).getPropertyValue('--amb-c1-l').trim()
      if (injectNone) el.style.transition = 'none'
      el.style.setProperty('--amb-c1-l', 'rgb(0, 255, 0)')
      const seen = new Set([before])
      const t0 = document.timeline.currentTime
      let first = -1
      let last = -1
      await new Promise((resolve) => {
        const tick = () => {
          const t = Math.round(document.timeline.currentTime - t0)
          const v = getComputedStyle(el).getPropertyValue('--amb-c1-l').trim()
          if (v !== before) { if (first < 0) first = t; last = t }
          seen.add(v)
          if (t > 1800) resolve()
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      // 还原：把 React 写的那份内联值放回去，并撤掉注入
      el.style.transition = ''
      if (inlineBefore) el.style.setProperty('--amb-c1-l', inlineBefore)
      else el.style.removeProperty('--amb-c1-l')
      return JSON.stringify({ distinct: seen.size, firstMs: first, lastMs: last, durMs: first < 0 ? 0 : last - first, before })
    })(INJECT)`
    const carry = await ev(carryProbe.replace('INJECT', 'false'))
    let ca = {}
    try { ca = JSON.parse(carry.v) } catch { /* ignore */ }
    // 中间态个数按"这段过渡里**渲染出来的帧数**上限算：页面忙时 rAF 采样会稀疏（实测 22→6）。
    // 判"不是硬切"的主证据是**时长可测**+ 下面那条 transition:none 反证；中间态只要求 ≥5。
    check('continuity：换色是迁移（中间态 ≥4 个、时长 400–2500ms）',
      (ca.distinct || 0) >= 4 && (ca.durMs || 0) >= 400 && (ca.durMs || 0) <= 2500,
      '中间态 ' + ca.distinct + ' 个，实测 ' + ca.durMs + 'ms（' + ca.firstMs + '→' + ca.lastMs + 'ms）')
    // 反证：把 transition 掐掉，同一条腿必须红 —— 否则这个 oracle 只是在看"有变化"
    const carryMut = await ev(carryProbe.replace('INJECT', 'true'))
    let cm = {}
    try { cm = JSON.parse(carryMut.v) } catch { /* ignore */ }
    check('反证：transition:none 时 carry 腿必须红（中间态 ≤2 或时长 ≤100ms）',
      (cm.distinct || 99) <= 2 || (cm.durMs || 9999) <= 100,
      '掐掉过渡后：中间态 ' + cm.distinct + ' 个，时长 ' + cm.durMs + 'ms（对比正常 ' + ca.distinct + '/' + ca.durMs + 'ms）')
  }

  // ---- 7c. prefers-reduced-motion：装饰性动效必须整体让路 ----
  {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    const red = await poll(`(() => { const el = document.querySelector('.wyy-amb'); return el && el.getAttribute('data-amb-motion') === 'reduced' })()`, 8000, 300)
    const still = await ev(`(async () => {
      const b = document.querySelector('.wyy-amb-cover')
      if (!b) return JSON.stringify({ err: 'no cover' })
      const a = b.style.transform
      await new Promise((r) => setTimeout(r, 700))
      const c = b.style.transform
      return JSON.stringify({ same: a === c, t: a })
    })()`)
    let si = {}
    try { si = JSON.parse(still.v) } catch { /* ignore */ }
    check('reduced-motion：标记切到 reduced 且 blob 停住（不再跑循环）',
      red === true && si.same === true, 'data-amb-motion=reduced=' + red + '，700ms 内 transform 不变=' + si.same)
    await send('Emulation.setEmulatedMedia', { features: [] })
    const back = await poll(`(() => { const el = document.querySelector('.wyy-amb'); return el && el.getAttribute('data-amb-motion') === 'full' })()`, 8000, 300)
    check('reduced-motion：撤销模拟后恢复 full', back === true, 'data-amb-motion=full=' + back)
  }

  // ---- 8. 设置面板：设置点律动 + 反证（关掉一个效果，overlay 里真没了）----
  await ev(`document.querySelector('.wyy-rail-amb-btn[data-amb-toggle="set"]').click()`)
  const panelOk = await poll(`document.querySelector('.wyy-amb-panel') !== null`, 8000)
  const beatArmed = await ev(`(() => { const p = document.querySelector('.wyy-amb-panel'); return p ? p.getAttribute('data-amb-beat') : null })()`)
  // rAF 是"下一帧"才写这个变量：面板刚打开就读会读到空串，得等它写进去
  const beatVar = await poll(`(() => { const p = document.querySelector('.wyy-amb-panel'); const v = p ? p.style.getPropertyValue('--amb-beat') : ''; return v === '' ? null : v })()`, 5000, 200)
  check('设置面板打开且设置点律动武装', panelOk === true && beatArmed.v === 'on', 'data-amb-beat=' + beatArmed.v)
  check('设置点拿到实时节拍变量（--amb-beat 有值）', String(beatVar).length > 0, '--amb-beat=' + beatVar)
  await shot('amb-settings-panel')
  const barsOff = await ev(`(() => {
    const row = document.querySelector('.wyy-amb-panel [data-amb-row="bar"]')
    const sw = row && row.querySelector('.wyy-amb-switch')
    if (!sw) return 'MISS'
    sw.click()
    return 'clicked'
  })()`)
  const barGone = await poll(`document.querySelectorAll('.wyy-amb-bar i').length === 0`, 6000)
  const bgStill = await ev(`document.querySelector('.wyy-amb-bg-root') !== null`)
  check('反证：关掉律动条后 overlay 里真没了（背景仍在）', barsOff.v === 'clicked' && barGone === true && bgStill.v === true,
    'bar 移除=' + barGone + '，背景层仍在=' + bgStill.v)
  // 再点回来（覆盖两个方向）
  await ev(`(() => {
    const row = document.querySelector('.wyy-amb-panel [data-amb-row="bar"]')
    const sw = row && row.querySelector('.wyy-amb-switch')
    if (sw) sw.click()
    return 'ok'
  })()`)
  const barBack = await poll(`document.querySelectorAll('.wyy-amb-bar i').length === 72`, 6000)
  check('再点回来 72 根柱子', barBack === true, 'bars=' + barBack)
  // 聚光灯（用户要的"对话页上方左右两盏随拍摇曳的光"）：在位 + 两盏 + 反向摆动，关掉必须真没了
  const spotOn = await poll(`(() => { const s = document.querySelector('.wyy-amb-spot'); return !!s && s.children.length === 2 })()`, 6000)
  const spotSway = await ev(`(async () => {
    const ls = [...document.querySelectorAll('.wyy-amb-spot i')]
    if (ls.length !== 2) return JSON.stringify({ err: 'lamps=' + ls.length })
    const t0 = document.timeline.currentTime
    const seen = ls.map(() => new Set())
    let a0 = []
    while (document.timeline.currentTime - t0 < 2600) {
      ls.forEach((l, i) => { seen[i].add(l.style.transform || 'none') })
      a0 = ls.map((l) => l.style.getPropertyValue('--amb-spot-a') || '')
      await new Promise((r) => requestAnimationFrame(r))
    }
    return JSON.stringify({ rotStates: seen.map((x) => x.size), alpha: a0 })
  })()`)
  let sp = {}
  try { sp = JSON.parse(spotSway.v) } catch { /* ignore */ }
  // "是光柱不是光晕"：束身必须是 conic 楔（往下渐宽）+ 沿程遮罩（亮→透），亮芯再一层
  const beam = await ev(`(() => {
    const ls = [...document.querySelectorAll('.wyy-amb-spot i')]
    if (ls.length !== 2) return JSON.stringify({ err: ls.length })
    return JSON.stringify(ls.map((l) => {
      const s = getComputedStyle(l)
      const core = getComputedStyle(l, '::after')
      // 带 mask / mix-blend-mode 的元素，Chromium 会把 transform 算成 matrix3d 而不是 matrix ——
      // 两种形式的前两个分量都是 (a, b)，按它们取角度就对两种都成立
      const tr = s.transform || ''
      const nums = tr.indexOf('matrix') >= 0 ? tr.split('(')[1].split(')')[0].split(',').map(Number) : []
      let deg = null
      if (nums.length >= 2) deg = Math.round(Math.atan2(nums[1], nums[0]) * 180 / Math.PI * 10) / 10
      return {
        cone: /conic-gradient/.test(s.backgroundImage),
        mask: (s.maskImage || s.webkitMaskImage || 'none') !== 'none',
        coreCone: /conic-gradient/.test(core.backgroundImage),
        blend: s.mixBlendMode,
        deg: deg,
      }
    }))
  })()`)
  let bm2 = []
  try { bm2 = JSON.parse(beam.v) } catch { /* ignore */ }
  check('聚光灯是**丁达尔光柱**（锥形楔 + 沿程遮罩 + 亮芯）',
    bm2.length === 2 && bm2.every((x) => x.cone && x.mask && x.coreCone),
    '两盏：' + JSON.stringify(bm2))
  // "朝着**屏幕**中间"要按几何验：拿灯头与屏幕中心的水平差、光柱长度算期望角度，与实测比
  const aim = await ev(`(() => {
    const box = document.querySelector('.wyy-amb-spot')
    const ls = [...document.querySelectorAll('.wyy-amb-spot i')]
    if (!box || ls.length !== 2) return JSON.stringify({ err: 'no spot' })
    const r = box.getBoundingClientRect()
    const cx = window.innerWidth / 2
    const want = [0, 1].map((i) => {
      const lampX = r.left + r.width * (i === 0 ? 0.03 : 0.97)
      // 与实现同一条约定：CSS 正角=顺时针 ⇒ 朝中间是**负**角（这里写清，免得再翻错）
      return Math.round(-Math.atan2(cx - lampX, r.height) * 180 / Math.PI * 10) / 10
    })
    const got = ls.map((l) => {
      const t = getComputedStyle(l).transform || ''
      const n = t.indexOf('matrix') >= 0 ? t.split('(')[1].split(')')[0].split(',').map(Number) : []
      return n.length >= 2 ? Math.round(Math.atan2(n[1], n[0]) * 180 / Math.PI * 10) / 10 : null
    })
    const spotEl = document.querySelector('.wyy-amb-spot')
    return JSON.stringify({ cx: cx, want: want, got: got, diag: spotEl ? spotEl.getAttribute('data-amb-tilt') : null })
  })()`)
  let am = {}
  try { am = JSON.parse(aim.v) } catch { /* ignore */ }
  check('两束光都朝着**屏幕中心**（实测倾角与几何期望差 ≤7°）',
    (am.got || []).length === 2 && (am.got || []).every((g, i) => g !== null && Math.abs(g - am.want[i]) <= 7),
    '屏幕中心x=' + am.cx + '，期望 ' + JSON.stringify(am.want) + '°，实测 ' + JSON.stringify(am.got) + '°，诊断 ' + am.diag)
  check('聚光灯：两盏在位且各自在摆（旋转状态在变）',
    spotOn === true && (sp.rotStates || []).length === 2 && sp.rotStates.every((n) => n > 3),
    'lamps=' + (sp.rotStates || []).join('/') + ' 个旋转状态，alpha=' + (sp.alpha || []).join('/'))
  const spotOff = await ev(`(() => { const row = document.querySelector('.wyy-amb-panel [data-amb-row="spot"]'); const sw = row && row.querySelector('.wyy-amb-switch'); if (!sw) return 'MISS'; sw.click(); return 'clicked' })()`)
  const spotGone = await poll(`document.querySelector('.wyy-amb-spot') === null`, 6000)
  check('反证：关掉聚光灯后 overlay 里真没了', spotOff.v === 'clicked' && spotGone === true, 'spot 移除=' + spotGone)
  await ev(`(() => { const row = document.querySelector('.wyy-amb-panel [data-amb-row="spot"]'); const sw = row && row.querySelector('.wyy-amb-switch'); if (sw) sw.click(); return 'ok' })()`)
  await poll(`document.querySelector('.wyy-amb-spot') !== null`, 6000)

  // 方向-像素：只搜"朝中间那一侧"的窗口，必须能找到明显偏离该行中位数的光斑。
  {
    const cap2 = await send('Page.captureScreenshot', { format: 'png' })
    const fn2 = `async function (b64) {
      try {
        const img = new Image()
        img.src = 'data:image/png;base64,' + b64
        await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode fail')) })
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const ctx = c.getContext('2d')
        ctx.drawImage(img, 0, 0)
        const box = document.querySelector('.wyy-amb-spot').getBoundingClientRect()
        const y = Math.round(box.top + box.height * 0.3)
        const lampXs = [box.left + box.width * 0.03, box.left + box.width * 0.97]
        const lum = (d) => 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2]
        // 基准取**窗口内**的中位数，不用整行：整行里侧栏(250)与卡片(246)本身就差 4，
        // 用整行会把光斑的相对差吃掉（实测偏差只剩 3.8，其实光斑是有的）。
        const res = [0, 1].map((i) => {
          const lx = Math.round(lampXs[i])
          const dir = i === 0 ? 1 : -1
          const xs = []
          const ls = []
          for (let k = 12; k <= 420; k += 3) {
            const x = lx + dir * k
            if (x < box.left + 2 || x > box.right - 2) break
            xs.push(x)
            ls.push(lum(ctx.getImageData(x, y, 1, 1).data))
          }
          const sorted = ls.slice().sort((a, b) => a - b)
          const local = sorted[Math.floor(sorted.length / 2)] || 0
          let peak = -1
          let peakX = lx
          for (let j = 0; j < xs.length; j++) {
            const dev = Math.abs(ls[j] - local)
            if (dev > peak) { peak = dev; peakX = xs[j] }
          }
          return { lampX: lx, peakX: peakX, offset: (peakX - lx) * dir, gain: Math.round(peak * 10) / 10, local: Math.round(local) }
        })
        const row = []
        for (let x = Math.round(box.left); x < Math.round(box.right); x += 3) row.push(lum(ctx.getImageData(x, y, 1, 1).data))
        row.sort((a, b) => a - b)
        const med = row[Math.floor(row.length / 2)] || 0
        const prof = []
        for (let k = 0; k <= 420; k += 30) {
          const x = Math.round(lampXs[0]) + k
          if (x > box.right - 2) break
          prof.push(k + ':' + Math.round(lum(ctx.getImageData(x, y, 1, 1).data)))
        }
        return JSON.stringify({ y: y, med: Math.round(med * 10) / 10, res: res, prof: prof.join(' ') })
      } catch (e) { return JSON.stringify({ err: String((e && e.message) || e) }) }
    }`
    const r2 = await callPage(fn2, cap2.data)
    let bd = {}
    try { bd = JSON.parse(r2.result.value) } catch { bd = { err: 'no value ' + JSON.stringify(r2.exceptionDetails || {}).slice(0, 200) } }
    const ok = bd.res && bd.res.length === 2 && bd.res.every((x) => x.offset > 40 && x.gain > 4)
    check('方向-像素：两束光都落在**朝屏幕中间那一侧**（光斑偏移 >40px 且偏离本行中位数 4+）',
      ok === true,
      bd.err ? ('采样失败：' + bd.err)
        : ('行 y=' + bd.y + ' 整行中位 ' + bd.med + '，左灯偏移 ' + bd.res[0].offset + 'px/增益 ' + bd.res[0].gain
          + '，右灯偏移 ' + bd.res[1].offset + 'px/增益 ' + bd.res[1].gain + '；左window剖面 ' + bd.prof))
  }

  // 范围（对话栏 / 整个窗口）必须真的改变几何。宿主自己那套 --dsh-frame-leading-clearance
  // 在 0.1.7-rc.2 上读到的是空串（实测），所以这里量的是**我们量出来的列边界**有没有生效。
  const barLeftExpr = `(() => { const b = document.querySelector('.wyy-amb-bar'); return b ? Math.round(b.getBoundingClientRect().left) : -1 })()`
  const barLeft = async () => (await ev(barLeftExpr)).v
  const clickSegExpr = (i) => `document.querySelector('.wyy-amb-panel [data-amb-row="bar"]').querySelectorAll('.wyy-amb-seg')[${i}].click()`
  const panelDiag = async () => (await ev(`(() => {
    const row = document.querySelector('.wyy-amb-panel [data-amb-row="bar"]')
    const segs = row ? [...row.querySelectorAll('.wyy-amb-seg')] : []
    return JSON.stringify({ panel: !!document.querySelector('.wyy-amb-panel'), page: !!document.querySelector('.wyy-page'), rows: rows.length, segs: segs.map((b) => b.getAttribute('aria-pressed')) })
  })()`)).v
  const l1 = await barLeft()
  const d1 = await panelDiag()
  const m1 = (await ev(`(() => { const el = document.querySelector('.wyy-amb'); return el ? (el.getAttribute('data-amb-measure') || '?') + ' / var=' + (el.style.getPropertyValue('--amb-left') || '(空)') + ' / computed=' + getComputedStyle(el).getPropertyValue('--amb-left') : 'no-amb' })()`)).v
  console.log('  测量态（对话栏）：' + m1)
  const clickErr1 = (await ev(clickSegExpr(1))).err
  const toFrame = await driveOn(clickSegExpr(1), `(() => { const b = document.querySelector('.wyy-amb-bar'); return !!b && Math.round(b.getBoundingClientRect().left) === 0 })()`)
  const d2 = await panelDiag()
  const clickErr2 = (await ev(clickSegExpr(0))).err
  const toConvo = await driveOn(clickSegExpr(0), `(() => { const b = document.querySelector('.wyy-amb-bar'); return !!b && Math.round(b.getBoundingClientRect().left) > 100 })()`)
  const d3 = await panelDiag()
  check('范围设置真的改变几何（对话栏 >100px / 整窗 =0）', l1 > 100 && toFrame === true && toConvo === true,
    '对话栏 left=' + l1 + '，整窗→' + toFrame + '，回对话栏→' + toConvo + '，末尾 left=' + (await barLeft())
    + '；面板态 ' + d1 + ' → ' + d2 + ' → ' + d3 + '；clickErr ' + clickErr1 + ' / ' + clickErr2)

  // ---- 8. 切回对话界面：氛围层必须还在（这就是"突破窗口"）----
  const sidebarDump = await ev(`JSON.stringify([...document.querySelectorAll('button')]
    .filter((b) => { const r = b.getBoundingClientRect(); return r.height > 0 && r.width > 0 && (b.getAttribute('title') || b.getAttribute('aria-label')) })
    .slice(0, 40)
    .map((b) => ((b.getAttribute('title') || '') + '|' + (b.getAttribute('aria-label') || '')).slice(0, 60)))`)
  console.log('  侧栏按钮清单：' + String(sidebarDump.v).slice(0, 900))
  const back = await ev(`(async () => {
    const pats = [/新建会话/, /新会话/, /new session/i, /new chat/i]
    const end = Date.now() + 8000
    while (Date.now() < end) {
      for (const p of pats) {
        const b = [...document.querySelectorAll('button')].find((x) => {
          if (x.closest('.wyy-page')) return false   // 面板里的字（"对话栏"是范围分段）不算
          const s = (x.getAttribute('title') || '') + '|' + (x.getAttribute('aria-label') || '') + '|' + (x.textContent || '')
          const r = x.getBoundingClientRect()
          return p.test(s) && r.height > 0 && r.width > 0
        })
        if (b) { b.click(); return 'clicked:' + ((b.getAttribute('title') || b.getAttribute('aria-label') || b.textContent) || '').trim().slice(0, 30) }
      }
      await new Promise((r) => setTimeout(r, 300))
    }
    return 'none'
  })()`)
  await sleep(3000)
  const convState = await ev(`JSON.stringify({
    pageGone: document.querySelector('.wyy-page') === null,
    ambThere: document.querySelector('.wyy-amb') !== null,
    bg: document.querySelector('.wyy-amb-bg-root') !== null,
    bars: document.querySelectorAll('.wyy-amb-bar i').length,
    composer: !!document.querySelector('[data-lexical-editor]'),
    bodyText: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 120),
  })`)
  let cs = {}
  try { cs = JSON.parse(convState.v) } catch { /* ignore */ }
  check('切回对话界面（插件面板已卸载）', cs.pageGone === true, '.wyy-page 消失=' + cs.pageGone + '，back=' + back.v + '，正文=' + cs.bodyText)
  check('对话界面下面板外氛围层仍在（突破窗口的核心证据）',
    cs.ambThere === true && (cs.bg === true || cs.bars > 0),
    'amb=' + cs.ambThere + ' 背景层=' + cs.bg + ' bar=' + cs.bars)

  // ---- 8b. 对话里的"小表面"融入背景（合成元素验机制；反证：按钮不许被洗）----
  {
    const injected = await ev(`(() => {
      const col = document.querySelector('[data-conversation-scroll]') || document.querySelector('[data-conversation-session]')
      if (!col) return JSON.stringify({ err: 'no transcript' })
      const mk = (id, isButton) => {
        const el = document.createElement(isButton ? 'button' : 'div')
        el.id = id
        el.textContent = 'wyytest'
        el.style.cssText = 'width:320px;height:44px;background:#ffffff;border-radius:14px;margin:6px;display:block'
        col.appendChild(el)
      }
      mk('wyy-fake-bubble', false)
      mk('wyy-fake-button', true)
      return JSON.stringify({ ok: true })
    })()`)
    let inj = {}
    try { inj = JSON.parse(injected.v) } catch { /* ignore */ }
    const tagged = await poll(`(() => { const b = document.getElementById('wyy-fake-bubble'); return !!b && b.getAttribute('data-wyy-amb-blend') === '1' })()`, 8000, 300)
    const bubbleBg = await ev(`(() => { const b = document.getElementById('wyy-fake-bubble'); if (!b) return JSON.stringify({ bg: 'missing', alpha: 1 }); const s = getComputedStyle(b); const v = s.backgroundColor; let a = 1; if (v.indexOf('/') > 0) a = parseFloat(v.split('/')[1]) ; else { const n = v.indexOf('(') > 0 ? v.split('(')[1].split(')')[0].split(',').map(Number) : []; if (n.length >= 4) a = n[3] } return JSON.stringify({ bg: v, alpha: a }) })()`)
    let bb = {}
    try { bb = JSON.parse(bubbleBg.v) } catch { /* ignore */ }
    const btnTagged = await ev(`(() => { const b = document.getElementById('wyy-fake-button'); return !!b && b.getAttribute('data-wyy-amb-blend') === '1' })()`)
    check('对话里的气泡/芯片被标为"融入"（底色变半透明，不是消失）',
      inj.ok === true && tagged === true && (bb.alpha === undefined || bb.alpha < 1),
      '标记=' + tagged + '，底色=' + bb.bg + '（alpha=' + bb.alpha + '，<1 才算真的半透明）')
    check('反证：按钮不参与"融入"（同一副白圆角装扮也不许被洗）', btnTagged.v === false, '按钮被标记=' + btnTagged.v)
    await ev(`(() => { const a = document.getElementById('wyy-fake-bubble'); const b = document.getElementById('wyy-fake-button'); if (a) a.remove(); if (b) b.remove(); return 'ok' })()`)
  }
  // ---- 8c. 代码表面融入（行内芯片 + 代码块）----
  // 8c/8d 的像素级 A/B（"透出来的真的是背景"）要有一个**已知的背景色**当被测对象：
  // 背景层的模糊封面是随歌取色、还在缓慢迁移的 —— 有一次跑到采样点上刚好是近白（块内 [253,252,252]
  // vs 重涂 [251,252,253]，差 3），同一条腿就红了，而实现没变。所以这里先把背景层换成一块
  // **定死的绿**（隐藏封面 + 钉住地板与取色令牌），量完再撤 —— 探针的变量必须可控，红的才可信。
  const freezeAmb = () => ev(`(() => {
    const old = document.getElementById('wyy-freeze-amb')
    if (old) old.remove()
    const s = document.createElement('style')
    s.id = 'wyy-freeze-amb'
    s.textContent = '.wyy-amb-cover{display:none !important}'
      + '.wyy-amb-bg-root{--amb-floor:#2f7f52 !important;--amb-c1:#1f8f4f !important;--amb-c2:#1f8f4f !important;'
      + '--amb-c3:#1f8f4f !important;--amb-c4:#1f8f4f !important}'
    document.head.appendChild(s)
    return 'ok'
  })()`)
  const unfreezeAmb = () => ev(`(() => { const s = document.getElementById('wyy-freeze-amb'); if (s) s.remove(); return 'ok' })()`)
  await freezeAmb()
  await sleep(500)
  // 现场没有真代码块：这条腿用的是空会话，而代码块要么由模型产出、要么由工具结果产出，
  // 两条都得有 LLM（隔离 home 里没有凭据，也不该花用户的钱）。所以这里**照宿主 bundle 里的声明
  // 做一份合成件**：类名/属性（.md-code-block、[data-code-block-banner]、[data-code-block-content]）
  // 与令牌链（--dsl-code-block-background 由 .block 自己定义、banner 走 --dsw-alias-markdown-code-block-banner、
  // 粘性容器走 --dsw-alias-bg-base）都是 0.1.7-rc.2 客户端 bundle 里读出来的原样。
  // 验的是"识别 + 令牌改写"这条链，不是"宿主的类名有没有变"。
  {
    const injected = await ev(`(() => {
      const host = document.querySelector('[data-conversation-scroll]') || document.querySelector('[data-conversation-session]')
      if (!host) return JSON.stringify({ err: 'no transcript' })
      const wrap = document.createElement('div')
      wrap.id = 'wyy-fake-code'
      wrap.innerHTML = '<div class="md-code-block" style="--dsl-code-block-background:var(--dsw-alias-markdown-code-block);'
        // 这两个局部变量是 .block 自己在 bundle 里声明的（CodeBlock.module.css 第 5 行与第 11 行）：
        // 令牌链是 --dsl-code-block-background → --dsw-alias-markdown-code-block，
        // 标题条是 --dsl-code-block-banner-background-color → --dsw-alias-markdown-code-block-banner。
        + '--dsl-code-block-banner-background-color:var(--dsw-alias-markdown-code-block-banner);'
        + 'background:var(--dsl-code-block-background);border-radius:12px;margin:16px 0;width:520px;color:#1a1a1a">'
        // 真实结构是**两层**：.bannerWrap（sticky，底色走 --dsw-alias-bg-base）里套 .banner/CodeToolbar
        // （[data-code-block-banner]，底色走 --dsl-code-block-banner-background-color）。只做一层会漏掉
        // 那条最显眼的"粘性白条"，所以两层都照 bundle 摆上，也都量。
        + '<div class="bannerWrap" style="background-color:var(--dsw-alias-bg-base);position:sticky;top:0">'
        + '<div data-code-block-banner style="background:var(--dsl-code-block-banner-background-color);padding:9px 14px">js</div>'
        + '</div>'
        + '<div data-code-block-content><pre style="background:var(--dsl-code-block-background);margin:0;padding:16px">'
        + '<code>const probe = 1</code></pre></div></div>'
        + '<p style="margin:8px 0">行内 <code style="background:var(--dsw-alias-markdown-inline-code);'
        + 'border-radius:8px;padding:0 5px;display:inline-block;height:22px;line-height:22px">inlineVar</code> 芯片</p>'
        + '<p style="margin:8px 0"><code id="wyy-fake-darkcode" style="background:#23262e;color:#eee;border-radius:8px;'
        + 'padding:0 5px;display:inline-block;height:22px;line-height:22px">darkVar</code></p>'
      host.appendChild(wrap)
      wrap.scrollIntoView({ block: 'center' })
      return JSON.stringify({ ok: true })
    })()`)
    let inj2 = {}
    try { inj2 = JSON.parse(injected.v) } catch { /* ignore */ }
    const codeTagged = await poll(`(() => {
      const root = document.querySelector('#wyy-fake-code .md-code-block')
      const inline = document.querySelector('#wyy-fake-code p code')
      return !!root && !!inline && root.getAttribute('data-wyy-amb-blend') === '2' && inline.getAttribute('data-wyy-amb-blend') === '2'
    })()`, 8000, 300)
    const cdiag = await ev(`(() => {
      const alphaOf = (v) => {
        if (typeof v !== 'string') return -1
        if (v.indexOf('/') > 0) return parseFloat(v.split('/')[1])
        const n = v.indexOf('(') > 0 ? v.split('(')[1].split(')')[0].split(',').map(Number) : []
        return n.length >= 4 ? n[3] : 1
      }
      const root = document.querySelector('#wyy-fake-code .md-code-block')
      const pre = document.querySelector('#wyy-fake-code pre')
      const wrapEl = document.querySelector('#wyy-fake-code .bannerWrap')
      const banner = document.querySelector('#wyy-fake-code [data-code-block-banner]')
      const inline = document.querySelector('#wyy-fake-code p code')
      const dark = document.getElementById('wyy-fake-darkcode')
      const g = (el) => (el ? getComputedStyle(el) : null)
      return JSON.stringify({
        root: root && root.getAttribute('data-wyy-amb-blend'), rootA: alphaOf(g(root) && g(root).backgroundColor),
        preTag: pre && pre.getAttribute('data-wyy-amb-blend'), preA: alphaOf(g(pre) && g(pre).backgroundColor),
        wrapA: alphaOf(g(wrapEl) && g(wrapEl).backgroundColor),
        bannerA: alphaOf(g(banner) && g(banner).backgroundColor),
        inline: inline && inline.getAttribute('data-wyy-amb-blend'), inlineA: alphaOf(g(inline) && g(inline).backgroundColor),
        darkTag: dark ? dark.getAttribute('data-wyy-amb-blend') : 'missing',
        darkA: alphaOf(g(dark) && g(dark).backgroundColor),
      })
    })()`)
    let cd = {}
    try { cd = JSON.parse(cdiag.v) } catch { /* ignore */ }
    check('代码块 + 行内芯片被标为"融入"（底色变半透明，不是消失）',
      inj2.ok === true && codeTagged === true && cd.root === '2' && cd.inline === '2'
      && cd.rootA > 0 && cd.rootA < 1 && cd.inlineA > 0 && cd.inlineA < 1
      && cd.bannerA > 0 && cd.bannerA < 1 && cd.wrapA > 0 && cd.wrapA < 1,
      '标记 root=' + cd.root + '/inline=' + cd.inline + '，alpha root=' + cd.rootA + ' inline=' + cd.inlineA
      + ' 粘性条=' + cd.wrapA + ' 标题条=' + cd.bannerA + '，内层 pre 标记=' + cd.preTag + '（外层已溶则不再重复打标，但底色跟着一起透：'
      + cd.preA + '）')
    check('反证：浅色主题下的深底芯片不许被洗（同一个 <code> 装扮，只换了底色）',
      cd.darkTag === null && cd.darkA === 1, '深底芯片标记=' + cd.darkTag + '，alpha=' + cd.darkA)
    // 像素：块内的颜色必须是"环境色 + 白纱"的混合，而不是白 —— 反过来，把它按宿主的原样涂回不透明时必须变回近白
    const codeShot = async () => {
      const cap = await send('Page.captureScreenshot', { format: 'png' })
      const fn = `async function (a) {
        try {
          const img = new Image()
          img.src = 'data:image/png;base64,' + a.b64
          await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode fail')) })
          const c = document.createElement('canvas')
          c.width = img.width
          c.height = img.height
          const ctx = c.getContext('2d')
          ctx.drawImage(img, 0, 0)
          const el = document.querySelector(a.q)
          if (!el) return JSON.stringify({ ok: false, err: 'no element ' + a.q })
          const r = el.getBoundingClientRect()
          if (r.top < 8 || r.bottom > window.innerHeight - 8) return JSON.stringify({ ok: false, err: 'out of view ' + Math.round(r.top) + '..' + Math.round(r.bottom) })
          const px = (x, y) => { const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data; return [d[0], d[1], d[2]] }
          return JSON.stringify({ ok: true, inBlock: px(r.left + r.width - 12, r.top + r.height - 10),
            near: px(r.left - 30, r.top + r.height - 10), rect: [Math.round(r.left), Math.round(r.top)] })
        } catch (e) { return JSON.stringify({ ok: false, err: String((e && e.message) || e) }) }
      }`
      const r = await callPage(fn, { b64: cap.data, q: '#wyy-fake-code .md-code-block' })
      try { return JSON.parse(r.result.value) } catch { return { ok: false, err: 'no value' } }
    }
    const sum = (p, q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2])
    const white = [255, 255, 255]
    const p1 = await codeShot()
    await ev(`(() => { const el = document.querySelector('#wyy-fake-code .md-code-block'); el.style.setProperty('background-color', '#f6f8fa', 'important'); return 'ok' })()`)
    await sleep(400)
    const p2 = await codeShot() // 反证态：宿主原样（不透明）重涂
    await ev(`(() => { const el = document.querySelector('#wyy-fake-code .md-code-block'); el.style.removeProperty('background-color'); return 'ok' })()`)
    check('代码块：透过来的真的是背景（同一像素：带标记 vs 宿主原样重涂，差 ≥30）',
      p1.ok === true && p2.ok === true && sum(p1.inBlock, p2.inBlock) >= 30 && sum(p1.inBlock, white) >= 24,
      p1.ok !== true ? ('采样失败：' + p1.err)
        : ('块内 ' + JSON.stringify(p1.inBlock) + ' vs 重涂 ' + JSON.stringify(p2.inBlock) + '（差 ' + sum(p1.inBlock, p2.inBlock)
          + '）；离纯白 ' + sum(p1.inBlock, white) + '（重涂态离纯白 ' + sum(p2.inBlock, white) + '）；块外环境 ' + JSON.stringify(p1.near)))
    await ev(`(() => { const w = document.getElementById('wyy-fake-code'); if (w) w.remove(); return 'ok' })()`)
  }
  // ---- 8d. 输入框那一带（用户点名的第二处）----
  // 真会话里宿主的输入框底板是一条 bg-base 渐变（composerSeat，sticky 在底部，从透明渐到页面底色）——
  // 卡片再半透明，透过来的也是那块白板。空会话（hero 布局）没有这条底板，所以底板这一半同样用
  // **照 bundle 声明做的合成件**验：一个"画底祖先"包住一张 [data-composer-card]，
  // 认的是"从卡片往上第一个自己在画底的祖先"这条规则，不是类名。
  {
    const card = await ev(`(() => {
      const c = document.querySelector('[data-composer-card]')
      if (!c) return JSON.stringify({ err: 'no composer' })
      const s = getComputedStyle(c)
      return JSON.stringify({ tag: c.getAttribute('data-wyy-amb-blend'), bg: s.backgroundColor, radius: s.borderRadius })
    })()`)
    let cv = {}
    try { cv = JSON.parse(card.v) } catch { /* ignore */ }
    const alphaOf = (v) => {
      if (typeof v !== 'string') return -1
      if (v.indexOf('/') > 0) return parseFloat(v.split('/')[1])
      const n = v.indexOf('(') > 0 ? v.split('(')[1].split(')')[0].split(',').map(Number) : []
      return n.length >= 4 ? n[3] : 1
    }
    await freezeAmb()
    await sleep(500)
    check('输入框卡片本身被标为"融入"（认宿主自己的 data-composer-card 标记）',
      cv.tag === '3' && alphaOf(cv.bg) < 1, '标记=' + cv.tag + '，底色=' + cv.bg)

    // 底板：合成一份"卡片 + 画底祖先"，塞在 body 最前面（querySelector 会先拿到它）
    const seatInj = await ev(`(() => {
      const seat = document.createElement('div')
      seat.id = 'wyy-fake-seat'
      // 出处：dsh-client-ui-conversation 的 .D_tfqW_composerSeat（0.1.7-rc.2）。
      // 位置必须落在**氛围层画得到的地方**：第一版贴在视口左上角（压着左栏），采样两次都是纯白 ——
      // 那片根本没有取色底，量出来的是"白压白"（差 0），跟实现好坏无关。
      // 现在按背景层的矩形定位到对话列左缘 6%、纵向 62% 处（正好是铺满腿采样的那个点）。
      const root = document.querySelector('.wyy-amb-bg-root')
      const k = root.getBoundingClientRect()
      const x = Math.round(k.left + (k.right - k.left) * 0.06)
      const y = Math.round(k.top + (k.bottom - k.top) * 0.62)
      // z-index 只为让它压过应用界面被截进图里（真机上底板本来就在应用自己的层里）
      seat.style.cssText = 'position:fixed;z-index:9999;box-sizing:border-box;height:160px;width:640px;padding:24px;'
        + 'left:' + (x - 20) + 'px;top:' + (y - 130) + 'px;'
        + 'background:linear-gradient(180deg, color-mix(in srgb, var(--dsw-alias-bg-base) 0%, transparent) 0px, var(--dsw-alias-bg-base) 36px)'
      const card = document.createElement('div')
      card.setAttribute('data-composer-card', '')
      card.style.cssText = 'height:112px;border-radius:18px;background:var(--dsw-specific-input-major)'
      seat.appendChild(card)
      document.body.insertBefore(seat, document.body.firstElementChild)
      return JSON.stringify({ ok: true, at: [x, y] })
    })()`)
    let si = {}
    try { si = JSON.parse(seatInj.v) } catch { /* ignore */ }
    const seatTagged = await poll(`(() => { const s = document.getElementById('wyy-fake-seat'); return !!s && s.getAttribute('data-wyy-amb-blend') === '4' })()`, 8000, 300)
    const seatDiag = await ev(`(() => {
      const s = document.getElementById('wyy-fake-seat')
      const c = document.querySelector('[data-composer-card]')
      const g = getComputedStyle(s)
      const gc = getComputedStyle(c)
      return JSON.stringify({ tag: s.getAttribute('data-wyy-amb-blend'), bgi: g.backgroundImage.slice(0, 120),
        cardTag: c.getAttribute('data-wyy-amb-blend'), cardBg: gc.backgroundColor })
    })()`)
    let sd = {}
    try { sd = JSON.parse(seatDiag.v) } catch { /* ignore */ }
    check('输入框底板（画底祖先）被认出并换成半透明渐变（形状保留）',
      si.ok === true && seatTagged === true && sd.tag === '4' && alphaOf(sd.cardBg) < 1 && /color-mix|rgba/.test(String(sd.bgi)),
      '标记=' + sd.tag + '，卡片标记=' + sd.cardTag + '，卡片 alpha=' + alphaOf(sd.cardBg) + '，底板渐变=' + String(sd.bgi).slice(0, 90))
    const seatShot = async () => {
      const cap = await send('Page.captureScreenshot', { format: 'png' })
      const fn = `async function (a) {
        try {
          const img = new Image()
          img.src = 'data:image/png;base64,' + a.b64
          await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode fail')) })
          const c = document.createElement('canvas')
          c.width = img.width
          c.height = img.height
          const ctx = c.getContext('2d')
          ctx.drawImage(img, 0, 0)
          const s = document.getElementById('wyy-fake-seat')
          if (!s) return JSON.stringify({ ok: false, err: 'no seat' })
          const r = s.getBoundingClientRect()
          const px = (x, y) => { const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data; return [d[0], d[1], d[2]] }
          return JSON.stringify({ ok: true, band: px(r.left + 20, r.bottom - 30), near: px(r.left + 20, r.top + 8) })
        } catch (e) { return JSON.stringify({ ok: false, err: String((e && e.message) || e) }) }
      }`
      const r = await callPage(fn, { b64: cap.data })
      try { return JSON.parse(r.result.value) } catch { return { ok: false, err: 'no value' } }
    }
    const sum2 = (p, q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2])
    const s1 = await seatShot()
    await ev(`(() => { const s = document.getElementById('wyy-fake-seat')
      s.style.setProperty('background-image', 'linear-gradient(180deg, rgba(255,255,255,0) 0px, #ffffff 36px)', 'important')
      return 'ok' })()`)
    await sleep(400)
    const s2 = await seatShot() // 反证态：宿主原样（不透明）重涂
    await ev(`(() => { const s = document.getElementById('wyy-fake-seat'); if (s) s.remove(); return 'ok' })()`)
    check('输入框底板：底带真的透出背景（带标记 vs 宿主原样重涂，差 ≥30）',
      s1.ok === true && s2.ok === true && sum2(s1.band, s2.band) >= 30 && sum2(s1.band, [255, 255, 255]) >= 24,
      s1.ok !== true ? ('采样失败：' + s1.err)
        : ('底带 ' + JSON.stringify(s1.band) + ' vs 重涂 ' + JSON.stringify(s2.band) + '（差 ' + sum2(s1.band, s2.band)
          + '）；离纯白 ' + sum2(s1.band, [255, 255, 255]) + '，重涂态离纯白 ' + sum2(s2.band, [255, 255, 255])))
    await unfreezeAmb()
  }
  // 范围（对话栏 vs 整窗）到底能不能分辨：量 --dsh-frame-leading-clearance 在**我们这一层**有没有值，
  // 以及 frame 的列结构长什么样。分辨不出来就得改实现（挂个空设置比不给设置更糟）。
  const layout = await ev(`(() => {
    const amb = document.querySelector('.wyy-amb')
    const overlay = document.querySelector('[data-shell-overlay]')
    const frame = overlay ? overlay.parentElement : null
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }
    const leadOn = (el) => (el ? getComputedStyle(el).getPropertyValue('--dsh-frame-leading-clearance') : null)
    return JSON.stringify({
      leadOnAmb: leadOn(amb),
      leadOnOverlay: leadOn(overlay),
      leadOnFrame: leadOn(frame),
      barRect: rect(document.querySelector('.wyy-amb-bar')),
      bgRect: rect(document.querySelector('.wyy-amb-bg-root')),
      overlayRect: rect(overlay),
      frameKids: frame ? [...frame.children].map((e) => [(e.className || '').toString().slice(0, 34), rect(e)]) : null,
      convRegion: rect(document.querySelector('[data-conversation-region]')),
      convSession: rect(document.querySelector('[data-conversation-session]')),
    })
  })()`)
  console.log('  范围/列结构：' + String(layout.v).slice(0, 700))
  await shot('amb-conversation')
  // 铺满 + 可读性：像素级判定（上一版地板渐变在下方收敛成透明 → 用户看到"只有上方那个板块有"）。
  // 把截屏画进 canvas 采样对话列左缘（空白带，避开卡片与正文）上中下四点，并与页面底色求差。
  const ambSample = async () => {
    const cap = await send('Page.captureScreenshot', { format: 'png' })
    const fn = `async function (b64) {
      try {
        const img = new Image()
        img.src = 'data:image/png;base64,' + b64
        await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode fail')) })
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const ctx = c.getContext('2d')
        ctx.drawImage(img, 0, 0)
        const nums = (v) => v.split('(')[1].split(')')[0].split(',').map(Number).slice(0, 3)
        const pageBg = nums(getComputedStyle(document.body).backgroundColor)
        const txt = nums(getComputedStyle(document.body).color)
        const root = document.querySelector('.wyy-amb-bg-root')
        const k = root ? root.getBoundingClientRect() : { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight }
        const x = Math.round(k.left + (k.right - k.left) * 0.06)
        const ys = [0.12, 0.35, 0.62, 0.85].map((f) => Math.round(k.top + (k.bottom - k.top) * f))
        const samples = ys.map((y) => { const d = ctx.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]] })
        const lum = (q) => { const f = (v) => { const z = v / 255; return z <= 0.03928 ? z / 12.92 : Math.pow((z + 0.055) / 1.055, 2.4) }; return 0.2126 * f(q[0]) + 0.7152 * f(q[1]) + 0.0722 * f(q[2]) }
        const l1 = lum(txt)
        const contrasts = samples.map((sm) => { const l2 = lum(sm); const hi = Math.max(l1, l2); const lo = Math.min(l1, l2); return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100 })
        return JSON.stringify({ pageBg: pageBg, txt: txt, samples: samples, x: x, contrasts: contrasts, ok: true })
      } catch (e) { return JSON.stringify({ ok: false, err: String((e && e.message) || e) }) }
    }`
    const r = await callPage(fn, cap.data)
    let cv = {}
    try { cv = JSON.parse(r.result.value) } catch { cv = { ok: false, err: 'no value ' + JSON.stringify(r.exceptionDetails || {}).slice(0, 140) } }
    return cv
  }
  const ambPixelLeg = async (tag, pre) => {
    const cv = pre || await ambSample()
    const pg = cv.pageBg || [0, 0, 0]
    const deltas = (cv.samples || []).map((sm) => Math.abs(sm[0] - pg[0]) + Math.abs(sm[1] - pg[1]) + Math.abs(sm[2] - pg[2]))
    check('背景铺满（' + tag + '）：对话列从上到下都带上当前歌曲的色',
      cv.ok === true && deltas.length === 4 && deltas.every((d) => d >= 8),
      cv.ok !== true ? ('采样失败：' + cv.err)
        : ('页面底色 ' + JSON.stringify(cv.pageBg) + '，左缘 x=' + cv.x + ' 采样 ' + JSON.stringify(cv.samples)
          + '，与底色差 ' + JSON.stringify(deltas) + '（每点 ≥8：用户报的是"完全没铺到"=0，8 已是肉眼可见的有色）'))
    check('背景不破坏正文对比度（' + tag + '，≥4.5:1）',
      cv.ok === true && (cv.contrasts || []).every((v) => v >= 4.5),
      '正文色 ' + JSON.stringify(cv.txt) + '，四点对比度 ' + JSON.stringify(cv.contrasts))
  }
  await ambPixelLeg('浅色')
  // 暗色也出一张 + 跑同一套像素腿：浅/暗两套底色下的观感与对比度是两回事（浅色已被证明会掉到 4.1）
  await ev(`document.body.setAttribute('data-ds-dark-theme', '')`)
  await sleep(1200)
  await shot('amb-conversation-dark')
  await ambPixelLeg('暗色')
  // 反证（黑纱存在的理由）：把封面强制成**纯白**（最坏情况 —— 封面越白，暗色主题的氛围越亮、
  // 近白正文越难读）。这一条在加黑纱之前是红的：实测那首歌 35% 处只有 4.36（线 4.5）。
  // 白封面是**构造出来的**，不靠"碰巧抽到一首白封面的歌"。
  await ev(`(() => { const s = document.createElement('style'); s.id = 'wyy-white-cover'
    s.textContent = '.wyy-amb-cover{background-image:linear-gradient(#fff,#fff) !important}'
    document.head.appendChild(s); return 'ok' })()`)
  await sleep(700)
  const cvWhite = await ambPixelLeg('暗色·纯白封面反证', await ambSample())
  await ev(`(() => { const s = document.getElementById('wyy-white-cover'); if (s) s.remove(); return 'ok' })()`)
  await sleep(300)
  await ev(`document.body.removeAttribute('data-ds-dark-theme')`)
  await sleep(400)


  const mem = await ev(`JSON.stringify({
    heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1,
    nodes: document.querySelectorAll('.wyy-amb *').length,
    bars: document.querySelectorAll('.wyy-amb-bar i').length,
    bg: document.querySelector('.wyy-amb-bg-root') !== null,
  })`)
  console.log('  内存/节点：' + mem.v + '（MB / 节点数，含 blob+bars）')

  check('运行期无 console.error', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | ') || 'ok')
  check('运行期无未捕获异常', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || 'ok')
  const realNetFails = netFails.filter((s) => !/net::ERR_ABORTED/.test(s))
  check('无网络硬失败', realNetFails.length === 0, realNetFails.slice(0, 3).join(' | ') || '（忽略 ERR_ABORTED：切视图会掐掉在途请求）')
} catch (e) {
  check('验收脚本未崩溃', false, String((e && e.message) || e).slice(0, 300))
} finally {
  try { ws.close() } catch { /* ignore */ }
  try { edge.kill() } catch { /* ignore */ }
  try { host.kill() } catch { /* ignore */ }
  writeFileSync(join(OUT, 'harness.log'), logBuf.join(''))
}

console.log('')
console.log('===== 氛围编程 runtime 验收（截图在 ' + OUT + '）=====')
let pass = 0
for (const r of results) if (r.ok) pass++
console.log(pass + '/' + results.length + ' 通过')
process.exit(pass === results.length ? 0 : 1)