/**
 * scripts/probe-seek.mjs — 一次性测量：复现"点进度条/歌词跳回曲首"。
 *
 * 用户实机报的现场：`rs=4 range=1 {"target":104.6,"rs":1,"seekable":1,"got":0,"tries":1,"result":"ok"}`
 * —— 点下去那一刻 readyState 只有 1（元数据刚到位），写 currentTime 之后读回来是 0，
 * 而 seek 的收尾却判成了 ok。本探针要回答两个问题：
 *   Q1 元素在 rs=1 / rs≥3 两种时刻被要求 seek 时，浏览器实际把播放头落在哪、seekable 区间是什么；
 *   Q2 拖动时浏览器到底发了哪些 Range 请求、同源代理 /wyymusic/stream 回了什么（状态码/Content-Range）。
 * 以及产品级复现：换歌后立刻点进度条 70%，读插件自己的 data-seek。
 *
 * 这不是验收腿：它只打印观测值，不做断言。改完 seekTo 之后再跑一次对比。
 * 隔离：自建 %TEMP%/dshhome-seek（独立于 dshhome-amb 与 dshhome-official），
 * cookie 从真实 ~/.dsh **只读**拷入；**删临时 home 前先 cmd /c rmdir 拆 junction**。
 *
 * 用法：node scripts/probe-seek.mjs   （SEEK_HEADED=1 有头跑）
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const T = process.env.TEMP || process.env.TMP || 'C:/Users/delinger/AppData/Local/Temp'
const KERNEL = process.env.DSH_KERNEL_DIR || join(T, 'dsh-kernel-017rc2')
const HOME = process.env.SEEK_HOME || join(T, 'dshhome-seek')
const PORT = Number(process.env.SEEK_PORT || 55841)
const CDP_PORT = Number(process.env.SEEK_CDP_PORT || 9371)
const EDGE = process.env.AMB_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const HEADED = process.env.SEEK_HEADED === '1'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- 隔离 home ----
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
const srcCookie = existsSync(join(homedir(), '.dsh', 'wyymusic', 'cookie.json'))
  ? join(homedir(), '.dsh', 'wyymusic', 'cookie.json')
  : join(T, 'dshhome-official', 'wyymusic', 'cookie.json')
if (existsSync(srcCookie)) copyFileSync(srcCookie, join(HOME, 'wyymusic', 'cookie.json'))
console.log('probe home = ' + HOME + '（cookie ' + (existsSync(srcCookie) ? '已只读拷入' : '缺失') + '）')

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
  console.log('host 没起来：\n' + logBuf.join('').slice(-2000))
  try { host.kill() } catch { /* ignore */ }
  process.exit(1)
}
console.log('host = ' + URL.replace(/\?token=.*/, '?token=***'))

const profile = join(T, 'edge-seek-profile')
if (existsSync(profile)) { try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ } }
mkdirSync(profile, { recursive: true })
spawn(EDGE, [
  ...(HEADED ? ['--window-position=-2400,0', '--mute-audio'] : ['--headless=new', '--disable-gpu']),
  '--no-first-run', '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required',
  '--remote-debugging-port=' + CDP_PORT, '--window-size=1600,1000', '--user-data-dir=' + profile, 'about:blank',
], { stdio: 'ignore' })
console.log('浏览器：' + (HEADED ? '有头' : '无头'))

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
const netLog = [] // /wyymusic/stream 的请求-响应流水（含 Range 与状态码）
const netFails = []
const pageErrs = []
const consoleErrs = []
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id !== undefined && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) rej(new Error(JSON.stringify(msg.error)))
    else res(msg.result)
    return
  }
  const p = msg.params || {}
  if (msg.method === 'Runtime.exceptionThrown') {
    pageErrs.push(String((p.exceptionDetails && (p.exceptionDetails.exception || {}).description) || p.exceptionDetails.text || '').slice(0, 400))
  }
  if (msg.method === 'Runtime.consoleAPICalled' && p.type === 'error') {
    consoleErrs.push((p.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 300))
  }
  if (msg.method === 'Network.requestWillBeSent' && String(p.request && p.request.url).includes('/wyymusic/stream')) {
    netLog.push({ ev: 'req', id: p.requestId, range: (p.request.headers || {}).Range || '(无)', method: p.request.method })
  }
  if (msg.method === 'Network.responseReceived' && String(p.response && p.response.url).includes('/wyymusic/stream')) {
    const row = netLog.find((x) => x.id === p.requestId && x.ev === 'req')
    const h = p.response.headers || {}
    const rec = {
      ev: 'res', id: p.requestId, status: p.response.status, mime: p.response.mimeType,
      contentRange: h['content-range'] || h['Content-Range'] || '(无)',
      contentLength: h['content-length'] || h['Content-Length'] || '(无)',
      acceptRanges: h['accept-ranges'] || h['Accept-Ranges'] || '(无)',
    }
    if (row) Object.assign(row, rec)
    else netLog.push(rec)
  }
  if (msg.method === 'Network.loadingFailed') {
    const row = netLog.find((x) => x.id === p.requestId && x.ev === 'req')
    if (row) row.failed = String(p.errorText || '')
    else netFails.push(String(p.errorText || ''))
  }
})
const send = (method, params) => new Promise((res, rej) => {
  const id = ++seq
  pending.set(id, { res, rej })
  ws.send(JSON.stringify({ id, method, params: params || {} }))
})
await send('Runtime.enable')
await send('Page.enable')
await send('Network.enable')
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) return { err: String((r.exceptionDetails.exception || {}).description || 'throw').slice(0, 400) }
  return { v: r.result.value }
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

const report = (name, v) => console.log('\n== ' + name + ' ==\n' + (typeof v === 'string' ? v : JSON.stringify(v, null, 1)))

try {
  await send('Page.navigate', { url: URL })
  await sleep(3000)
  await poll(`document.querySelectorAll('button').length > 3`, 40000)
  for (const label of ['继续', '稍后配置', '跳过', 'Skip']) {
    await ev(`(async () => {
      const end = Date.now() + 4000
      const find = () => [...document.querySelectorAll('button')].filter((e) => (e.textContent || '').trim() === ${JSON.stringify(label)} && e.getBoundingClientRect().height > 0)[0] || null
      while (Date.now() < end) { const el = find(); if (el) { el.click(); return 'clicked' } await new Promise((r) => setTimeout(r, 200)) }
      return 'none'
    })()`)
    await sleep(600)
  }
  // 打开音乐面板
  await ev(`(async () => {
    const end = Date.now() + 10000
    const hit = () => [...document.querySelectorAll('button')].find((b) => {
      const s = (b.getAttribute('title') || '') + '|' + (b.getAttribute('aria-label') || '') + '|' + (b.textContent || '')
      return /网易云音乐|wyymusic|dsh-wyymusic/i.test(s) && b.getBoundingClientRect().height > 0
    })
    while (Date.now() < end) { const b = hit(); if (b) { b.click(); return 'clicked' } await new Promise((r) => setTimeout(r, 250)) }
    return 'none'
  })()`)
  await poll(`document.querySelector('.wyy-page') !== null`, 15000)
  // 排行榜 → 第一行开播
  await ev(`(async () => {
    const end = Date.now() + 12000
    const hit = () => [...document.querySelectorAll('.wyy-rail-item')].find((e) => (e.textContent || '').trim() === '排行榜')
    while (Date.now() < end) { const b = hit(); if (b) { b.click(); return 'ok' } await new Promise((r) => setTimeout(r, 250)) }
    return 'miss'
  })()`)
  await poll(`document.querySelectorAll('.wyy-row').length > 0`, 20000)
  await ev(`document.querySelector('.wyy-row').click()`)
  const playing = await poll(`(() => { const a = document.querySelector('audio'); return !!a && !a.paused && a.currentTime > 0.15 })()`, 40000, 500)
  console.log('\n在播 = ' + playing)
  if (playing !== true) { report('前置失败：没播起来', { log: logBuf.join('').slice(-1500) }) } else {
    // ---- P1/P2：裸元素在 rs=1 与 canplay 后 seek 的差别 ----
    const raw = await ev(`(async () => {
      const src = document.querySelector('audio').src
      const ranges = (tl) => { const o = []; for (let i = 0; i < tl.length; i++) o.push([Math.round(tl.start(i) * 10) / 10, Number.isFinite(tl.end(i)) ? Math.round(tl.end(i) * 10) / 10 : 'inf']); return o }
      const once = (waitEvent) => new Promise((resolve) => {
        const a = document.createElement('audio')
        a.preload = 'auto'
        a.style.display = 'none'
        document.body.appendChild(a)
        const log = { waitEvent }
        let seekedAt = null
        a.addEventListener('seeked', () => { seekedAt = Math.round(a.currentTime * 10) / 10; log.seekedAt = seekedAt })
        a.addEventListener('error', () => { log.err = a.error ? a.error.code : 'err' })
        a.addEventListener(waitEvent, () => {
          log.atEvent = { rs: a.readyState, dur: Number.isFinite(a.duration) ? Math.round(a.duration * 10) / 10 : String(a.duration), seekable: ranges(a.seekable), bufferedEnd: a.buffered.length ? Math.round(a.buffered.end(a.buffered.length - 1) * 10) / 10 : null }
          const dur = a.duration
          const target = Number.isFinite(dur) && dur > 10 ? Math.round(dur * 0.7 * 10) / 10 : 104.6
          log.target = target
          a.currentTime = target
          log.readbackNow = Math.round(a.currentTime * 10) / 10
          log.seekingNow = a.seeking
          setTimeout(() => { log.t800 = { ct: Math.round(a.currentTime * 10) / 10, seeking: a.seeking, rs: a.readyState, seekable: ranges(a.seekable) } }, 800)
          setTimeout(() => { log.t3000 = { ct: Math.round(a.currentTime * 10) / 10, seeking: a.seeking, rs: a.readyState, seekable: ranges(a.seekable) }; a.src = ''; a.remove(); resolve(JSON.stringify(log)) }, 3000)
        }, { once: true })
        a.src = src
        setTimeout(() => { if (!log.atEvent) { log.timeout = { rs: a.readyState }; a.remove(); resolve(JSON.stringify(log)) } }, 15000)
      })
      return JSON.stringify({ meta: await once('loadedmetadata'), canplay: await once('canplay') })
    })()`)
    report('P1/P2 裸元素：rs=1（loadedmetadata）与 canplay 后 seek 的落点', raw.v || raw.err)

    // ---- P3：浏览器栈里测代理的 Range 支持（只读响应头，立刻 abort，避免下整首） ----
    const rng = await ev(`(async () => {
      const u = document.querySelector('audio').src
      const one = async (h) => {
        const ac = new AbortController()
        const t0 = Date.now()
        try {
          const r = await fetch(u, { headers: h, signal: ac.signal })
          const head = { ask: h.Range || '(无)', status: r.status, cr: r.headers.get('content-range'), cl: r.headers.get('content-length'), ar: r.headers.get('accept-ranges'), ct: r.headers.get('content-type'), ms: Date.now() - t0 }
          ac.abort()
          return head
        } catch (e) { return { ask: h.Range || '(无)', threw: String((e && e.name) || e) } }
      }
      const out = []
      out.push(await one({ Range: 'bytes=0-1' }))
      out.push(await one({ Range: 'bytes=10400000-' }))
      out.push(await one({ Range: 'bytes=0-' }))
      return JSON.stringify(out)
    })()`)
    report('P3 浏览器栈内验代理 Range（只读头）', rng.v || rng.err)

    // ---- P5：正常时刻点进度条 70%（已有腿覆盖的场景，做对照） ----
    const normal = await ev(`(async () => {
      const a = document.querySelector('audio')
      const bar = document.querySelector('.wyy-bar-prog .wyy-track')
      const r0 = bar.getBoundingClientRect()
      const x = Math.round(r0.left + r0.width * 0.7), y = Math.round(r0.top + r0.height / 2)
      const pre = { ct: Math.round(a.currentTime * 10) / 10, rs: a.readyState, dur: Math.round(a.duration * 10) / 10, box: [Math.round(r0.left), Math.round(r0.top), Math.round(r0.width), Math.round(r0.height)], aria: bar.getAttribute('aria-valuemax'), cls: bar.className }
      bar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0, buttons: 1 }))
      bar.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0, buttons: 0 }))
      bar.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }))
      await new Promise((r) => setTimeout(r, 1600))
      return JSON.stringify({ pre, want: Math.round(pre.dur * 0.7 * 10) / 10, after: { ct: Math.round(a.currentTime * 10) / 10 }, seek: a.getAttribute('data-seek') })
    })()`)
    report('P5 对照：正常时刻点进度条 70%', normal.v || normal.err)
    if (pageErrs.length > 0) report('页面异常', pageErrs)
    if (consoleErrs.length > 0) report('console.error', consoleErrs)

    // ---- E1：裸元素 —— seek 之后 60ms 重置 src（换歌那一瞬的机制） ----
    const e1 = await ev(`(async () => {
      const src = document.querySelector('audio').src
      return JSON.stringify(await new Promise((resolve) => {
        const a = document.createElement('audio')
        a.preload = 'auto'; a.style.display = 'none'
        document.body.appendChild(a)
        const log = { seeked: [], loadstart: 0 }
        a.addEventListener('seeked', () => log.seeked.push({ at: 'seeked', ct: Math.round(a.currentTime * 10) / 10, rs: a.readyState }))
        a.addEventListener('loadstart', () => log.loadstart++)
        a.addEventListener('loadedmetadata', () => {
          if (log.started) return
          log.started = true
          log.dur = Math.round(a.duration * 10) / 10
          const target = Math.round(a.duration * 0.7 * 10) / 10
          a.currentTime = target
          log.readback = Math.round(a.currentTime * 10) / 10
          setTimeout(() => { a.src = src; log.resetAt = 'src=' + (a.src === src) }, 60)
          setTimeout(() => { log.t1200 = { ct: Math.round(a.currentTime * 10) / 10, rs: a.readyState, seeking: a.seeking }; a.remove(); resolve(log) }, 1200)
        }, { once: false })
        a.src = src
        setTimeout(() => { if (!log.started) { log.timeout = true; a.remove(); resolve(log) } }, 15000)
      }))
    })()`)
    report('E1 裸元素：seek 后 60ms 重置 src → seeked 何时 fired、落点在哪', e1.v || e1.err)

    // ---- E2：seek **在飞**（seeking=true、Range 请求还没回）时重置 src → 会不会冒出 ct=0 的 seeked ----
    const e2 = await ev(`(async () => {
      const src = document.querySelector('audio').src
      return JSON.stringify(await new Promise((resolve) => {
        const a = document.createElement('audio')
        a.preload = 'auto'; a.style.display = 'none'
        document.body.appendChild(a)
        const log = { seeked: [], err: null }
        const t0 = Date.now()
        const stamp = () => ({ ms: Date.now() - t0, ct: Math.round(a.currentTime * 10) / 10, rs: a.readyState })
        a.addEventListener('seeked', () => log.seeked.push(Object.assign(stamp(), { seekingAt: a.seeking })))
        a.addEventListener('error', () => { log.err = a.error ? a.error.code : 'err' })
        a.addEventListener('loadedmetadata', () => {
          if (log.started) return
          log.started = true
          log.dur = Math.round(a.duration * 10) / 10
          // 跳到很远的位置：Range 请求会真的飞出去（不是缓冲区内的瞬跳）
          const target = Math.round(a.duration * 0.85 * 10) / 10
          log.target = target
          a.currentTime = target
          log.afterSeek = Object.assign(stamp(), { seeking: a.seeking })
          // 让 Range 请求飞出去之后再换 src（复刻"点击之后紧接着换歌/重载"）
          setTimeout(() => { log.resetAt = Object.assign(stamp(), { seeking: a.seeking }); a.src = src }, 80)
          setTimeout(() => { log.t2500 = Object.assign(stamp(), { seeking: a.seeking }); a.remove(); resolve(log) }, 2500)
        }, { once: false })
        a.src = src
        setTimeout(() => { if (!log.started) { log.timeout = true; a.remove(); resolve(log) } }, 15000)
      }))
    })()`)
    report('E2 裸元素：seek 在飞时重置 src → 是否冒出 ct=0 的 seeked', e2.v || e2.err)

    // ---- E3：重载恢复路径可用性 —— load() 之后在 loadedmetadata 补跳，能不能落住 ----
    const e3 = await ev(`(async () => {
      const src = document.querySelector('audio').src
      return JSON.stringify(await new Promise((resolve) => {
        const a = document.createElement('audio')
        a.preload = 'auto'; a.style.display = 'none'
        document.body.appendChild(a)
        const log = {}
        let rounds = 0
        a.addEventListener('loadedmetadata', () => {
          rounds++
          if (rounds === 1) { a.load(); return } // 第一轮：先只加载元数据，随后重载
          const target = Math.round(a.duration * 0.7 * 10) / 10
          a.currentTime = target
          log.landed = Math.round(a.currentTime * 10) / 10
          log.target = target
          setTimeout(() => { log.t1500 = { ct: Math.round(a.currentTime * 10) / 10, seeking: a.seeking, rs: a.readyState }; a.remove(); resolve(log) }, 1500)
        })
        a.src = src
        setTimeout(() => { if (log.t1500 === undefined && log.landed === undefined) { log.timeout = true; a.remove(); resolve(log) } }, 15000)
      }))
    })()`)
    report('E3 裸元素：load() 之后补跳是否落得住（恢复路径可行性）', e3.v || e3.err)

    // ---- N0 对照：只点下一首、不点进度条 —— 谁（什么时点）把播放头冲回 0 ----
    const nextOnly = async (label) => {
      netLog.length = 0
      const r = await ev(`(async () => {
        const a = document.querySelector('audio')
        const nextBtn = document.querySelector('[data-brand-ctl="next"]')
        if (!nextBtn || !a) return JSON.stringify({ err: 'no next button/audio' })
        const evs = []
        let t0 = Date.now()
        for (const n of ['loadstart', 'emptied', 'durationchange', 'ended', 'seeked', 'error', 'abort']) {
          a.addEventListener(n, () => evs.push(n + '@' + (Date.now() - t0)))
        }
        const snap = () => ({
          ct: Math.round(a.currentTime * 10) / 10, rs: a.readyState,
          src: (a.src || '').slice(-26),
          title: (document.querySelector('.wyy-bar-title') || {}).textContent,
          seek: a.getAttribute('data-seek') ? JSON.parse(a.getAttribute('data-seek')).result : null,
        })
        const marks = []
        marks.push(Object.assign({ at: 0, ev: [] }, snap()))
        nextBtn.click()
        let prev = 0
        for (const ms of [250, 500, 1000, 1500, 2000, 3000, 4500, 6000]) {
          await new Promise((r) => setTimeout(r, ms - prev)); prev = ms
          marks.push(Object.assign({ at: ms, ev: evs.slice(-4) }, snap()))
        }
        const rows = [...document.querySelectorAll('.wyy-row')].map((x) => (x.classList.contains('active') ? '>' : ' ') + (x.textContent || '').slice(0, 18))
        return JSON.stringify({ evs, marks, rows })
      })()`)
      report(label, r.v || r.err)
      if (netLog.length > 0) report(label + '：期间的 stream 请求', netLog.slice(0, 6))
    }
    await nextOnly('N0 对照：只点下一首（不点进度条）→ 播放头/元素事件时间线')

    // ---- R1/R2/R3：换歌 + 点进度条的不同时间差（产品级竞态） ----
    const raceAt = async (delayMs, label) => {
      netLog.length = 0
      const r = await ev(`(async () => {
        const a = document.querySelector('audio')
        const oldSrc = a.src
        const log = {}
        const evs = []
        let t0 = Date.now()
        for (const n of ['loadstart', 'emptied', 'durationchange', 'ended', 'seeked', 'error']) {
          a.addEventListener(n, () => evs.push(n + '@' + (Date.now() - t0)))
        }
        const sid = () => ((a.src || '').match(/id=(\\d+)/) || [])[1] || '?'
        const snap = () => ({
          ct: Math.round(a.currentTime * 10) / 10, rs: a.readyState,
          dur: Number.isFinite(a.duration) ? Math.round(a.duration * 10) / 10 : String(a.duration),
          sid: sid(), title: (document.querySelector('.wyy-bar-title') || {}).textContent,
          seek: a.getAttribute('data-seek') ? JSON.parse(a.getAttribute('data-seek')).result : null,
        })
        const nextBtn = document.querySelector('[data-brand-ctl="next"]')
        if (!nextBtn) return JSON.stringify({ err: 'no next button' })
        nextBtn.click()
        t0 = Date.now()
        if (${delayMs} > 0) {
          // 等到"刚设上 src"或固定延迟，谁先到算谁
          while (Date.now() - t0 < ${delayMs} && a.src === oldSrc) await new Promise((r) => setTimeout(r, 10))
          if (${delayMs} >= 100 && a.src !== oldSrc) { while (Date.now() - t0 < ${delayMs}) await new Promise((r) => setTimeout(r, 10)) }
        }
        log.srcSameAsOld = a.src === oldSrc
        log.srcChangedMs = a.src === oldSrc ? null : Date.now() - t0
        log.rsAtClick = a.readyState
        log.durAtClick = Number.isFinite(a.duration) ? Math.round(a.duration * 10) / 10 : String(a.duration)
        const bar = document.querySelector('.wyy-bar-prog .wyy-track')
        const r0 = bar.getBoundingClientRect()
        const x = Math.round(r0.left + r0.width * 0.7), y = Math.round(r0.top + r0.height / 2)
        for (const type of ['pointerdown', 'pointerup', 'click']) {
          bar.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0 }))
        }
        log.seekRightAfter = a.getAttribute('data-seek')
        const marks = [400, 1200, 3000, 6000]
        let prev = 0
        for (const ms of marks) {
          await new Promise((r) => setTimeout(r, ms - prev))
          prev = ms
          log['t' + ms] = Object.assign({ ev: evs.slice(-4) }, snap())
        }
        log.evs = evs
        return JSON.stringify(log)
      })()`)
      report(label, r.v || r.err)
      if (netLog.length > 0) report(label + '：期间的 stream 请求', netLog.slice(0, 6))
    }
    await raceAt(0, 'R1 换歌 + 0ms 后点进度条 70%（src 还没换）')
    await raceAt(150, 'R2 换歌 + 150ms 后点进度条 70%')
    await raceAt(600, 'R3 换歌 + 600ms 后点进度条 70%（src 刚设上、数据还没到）')

    // ---- 拖动时浏览器发了什么 Range ----
    report('拖动/加载期间浏览器对 /wyymusic/stream 的实际请求', netLog)
    if (netFails.length > 0) report('Network.loadingFailed', netFails)
    const tail = await ev(`(() => { const a = document.querySelector('audio'); return JSON.stringify({ ct: Math.round(a.currentTime * 10) / 10, rs: a.readyState, src: (a.src || '').replace(/token=[^&]*/, 'token=***') }) })()`)
    report('收尾时元素状态', tail.v || tail.err)
  }
} catch (e) {
  console.log('\n探针异常：' + String((e && e.stack) || e))
} finally {
  try { host.kill() } catch { /* ignore */ }
  process.exit(0)
}
