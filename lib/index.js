/**
 * lib/index.js — dsh-wyymusic 宿主半边。
 *
 * 职责（浏览器半边**不能**直连网易云：CORS + 需要 cookie，所以全部经此代理）：
 *   1. 登录态：落盘在 $DSH_HOME/wyymusic/cookie.json（0600）；支持扫码登录，以及
 *      从 go-musicfox 的 cookie jar 一键导入（免二次扫码）。
 *   2. 网易云业务接口的 JSON 代理（搜索/歌单/榜单/推荐/歌词/取链）。
 *   3. 音频流代理 /wyymusic/stream —— 同源转发上游 CDN，透传 Range 以便拖动进度条。
 *
 * 所有注册都用 ctx.effect 包裹并 try/catch 降级：插件不应因单个扩展点失败而
 * 拖垮宿主启动。
 *
 * ⚠️ 合规：非官方接口 + 流播受版权保护音乐，仅个人试听/学习，风险自担；
 * 严禁解灰/绕过版权限制。Cookie 为敏感凭据，仅存本机，不上传任何第三方。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { Readable } from 'node:stream'

import * as NC from './netease.js'
import { parseYrc } from './yrc.js'
import { createLimiter } from './fetch-limit.js'

export const name = 'dsh-wyymusic'
export const inject = ['webServer']

// =====================================================================
// 常量
// =====================================================================

const ROUTE_PREFIX = '/wyymusic'
const UA_STREAM = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

/**
 * CDN 节点容错。
 * 实测（2026-09-26 本机）：网易云把高音质直链指向阿里云 ENS 集群（m704/m804），
 * 该集群对本机网络一律 403（`server: Tengine` + `via: ens-cacheN.cn7805[,403666]`），
 * 而同一 path+签名的请求换到普通 CDN 节点（m701~m703 / m801~m803）返回 206。
 * 直链的 path 与 authSecret 签名与节点无关，因此换节点取同一份已授权文件即可 ——
 * 这是绕开不可达边缘节点，不是绕过版权限制（未登录时服务端本就不发这些直链）。
 */
const CDN_HOST_RE = /^m(\d+)\.music\.126\.net$/
const CDN_ALT_HOSTS = ['m701', 'm702', 'm703', 'm801', 'm802', 'm803']
// 上次成功的节点优先，避免每次都先撞一遍不可达节点
let lastGoodCdnHost = ''

// 搜索分型（与 netease.js 的 cloudsearch type 对齐；lyric = 按歌词词句搜歌，实测 type=1006 有结果）
const SEARCH_TYPES = { song: 1, album: 10, artist: 100, playlist: 1000, mv: 1004, lyric: 1006 }

// =====================================================================
// 小工具
// =====================================================================

const dshHome = () => process.env.DSH_HOME || join(homedir(), '.dsh')

const stateFile = () => join(dshHome(), 'wyymusic', 'cookie.json')

// 界面偏好（语言 + 最近播放）。与 cookie 同目录但**不含任何凭据**，所以 0600 只是与其它
// 落盘文件保持一致，不代表这里有敏感数据。
const prefsFile = () => join(dshHome(), 'wyymusic', 'prefs.json')
const LANGS = ['zh', 'en']
const RECENT_MAX = 8

// 最近播放只存「面板里点开过/播放过的歌单」的展示字段：id/名称/封面。
// 逐条校验而不是整包信任：这个文件是可以手改的，进来的东西必须能安全地回吐给界面。
const cleanRecent = (v) => {
  if (!Array.isArray(v)) return []
  const out = []
  for (const it of v) {
    if (out.length >= RECENT_MAX) break
    const id = String((it && it.id) || '').trim()
    const name = String((it && it.name) || '').trim()
    const cover = String((it && it.cover) || '').trim()
    if (!/^[0-9]+$/.test(id) || name === '') continue
    const e = { id, name: name.slice(0, 80), cover: cover.slice(0, 300) }
    // 卡片的副信息行读的就是这两个字段（播放量，没有就作者）。白名单里不带它们的话，
    // 客户端那边存了也白存 —— 最近播放那排卡片的副行会一直是空的（实测到的空缺）。
    const pc = Number((it && it.playCount) || 0)
    if (pc > 0) e.playCount = pc
    const cr = String((it && it.creator) || '').trim()
    if (cr !== '') e.creator = cr.slice(0, 40)
    out.push(e)
  }
  return out
}

// 氛围编程（Ambient）：把歌曲氛围铺到主界面上的那几个开关与参数。数值一律 0–100 的百分比，
// 高度/字号是像素。默认值与 lib/client.js 的 AMB_DEFAULTS **必须一致** —— 客户端那份是
// 用户还没登录进宿主（GET 失败）时的兜底，两份不同就会出现"刷新前后长得不一样"。
const AMB_DEFAULTS = {
  on: false,
  bg: true, bgStrength: 70, bgSpeed: 40, bgScope: 'frame',
  bar: true, barHeight: 56, barGain: 90, barScope: 'convo',
  notes: true, notesRate: 55, notesSize: 22,
  beat: true, beatPower: 60,
  spot: true, spotPower: 60,
}
const AMB_BOOLS = ['on', 'bg', 'bar', 'notes', 'beat', 'spot']
const AMB_NUMS = {
  bgStrength: [0, 100], bgSpeed: [0, 100],
  barHeight: [10, 150], barGain: [0, 100],
  notesRate: [0, 100], notesSize: [12, 40],
  beatPower: [0, 100],
  spotPower: [0, 100],
}
const AMB_ENUMS = { bgScope: ['convo', 'frame'], barScope: ['convo', 'frame'] }

// 逐项过白名单再 clamp：prefs.json 是**用户可以手改**的文件，未知键一律丢掉，
// 越界数字夹回区间，类型不对就当作"这项没说过"（合并时保留原值）。
const cleanAmbient = (v) => {
  if (v === null || typeof v !== 'object') return null
  const out = {}
  for (const k of AMB_BOOLS) if (v[k] === true || v[k] === false) out[k] = v[k]
  for (const k of Object.keys(AMB_NUMS)) {
    const n = Number(v[k])
    if (Number.isFinite(n)) out[k] = Math.min(AMB_NUMS[k][1], Math.max(AMB_NUMS[k][0], Math.round(n)))
  }
  for (const k of Object.keys(AMB_ENUMS)) if (AMB_ENUMS[k].indexOf(v[k]) >= 0) out[k] = v[k]
  return out
}

// 默认值迁移（一次性）：prefs 只要被写过一次（语言、最近播放都会顺手把整份 ambient 存下来），
// 当轮的默认值就被"存过的设置"钉住了 —— 之后我改默认值到不了用户手里（实机复报的
// "律动条没感觉/背景太淡"里就有这一份：存下来的还是 26px / 60 / 55）。
// 只搬**恰好等于旧默认值**的那几项：用户手改过的值不动。v 进文件，搬过就不再搬。
const AMB_V = 3
// 逐版表：v2 是一批（柱高/灵敏度/强度），v3 是另一批（柱再高、范围推整窗）。
// 分版而不是一张大表：老文件的 ambVersion 是 0/缺省时**两批都要顺次应用**（26 → 40 → 56）。
const AMB_MIGRATE_BY_V = {
  2: { barHeight: [26, 40], barGain: [60, 85], bgStrength: [55, 70] },
  3: { barHeight: [40, 56], barGain: [85, 90], bgScope: ['convo', 'frame'] },
}
const migrateAmbient = (amb, v) => {
  const out = Object.assign({}, amb)
  const from = Number(v) || 0
  if (from >= AMB_V) return out
  for (const step of Object.keys(AMB_MIGRATE_BY_V).map(Number).sort((a, b) => a - b)) {
    if (from >= step) continue
    const table = AMB_MIGRATE_BY_V[step]
    for (const k of Object.keys(table)) {
      const [was, now] = table[k]
      if (out[k] === was) out[k] = now
    }
  }
  return out
}

const loadPrefs = () => {
  let p = {}
  try { p = JSON.parse(readFileSync(prefsFile(), 'utf8')) } catch { /* 没存过 = 默认 */ }
  const stored = p && p.ambient
  const ambient = migrateAmbient(Object.assign({}, AMB_DEFAULTS, cleanAmbient(stored) || {}), p && p.ambVersion)
  return {
    lang: LANGS.indexOf(p && p.lang) >= 0 ? p.lang : 'zh',
    recent: cleanRecent(p && p.recent),
    ambient,
  }
}

const persistPrefs = (p) => {
  try {
    mkdirSync(dirname(prefsFile()), { recursive: true })
    writeFileSync(prefsFile(), JSON.stringify({
      lang: p.lang, recent: cleanRecent(p.recent), ambient: cleanAmbient(p.ambient) || {},
      ambVersion: AMB_V, savedAt: Date.now(),
    }), { encoding: 'utf8', mode: 0o600 })
    return true
  } catch { return false } // 存不下也不该挡住切换：本次会话仍然生效
}

const writeJson = (res, value, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

async function readBody(req) {
  let text = ''
  for await (const chunk of req) text += chunk
  if (text === '') return {}
  try { return JSON.parse(text) } catch { return {} }
}

/** 数值参数解析（带钳制），避免 NaN/越界透传到上游。 */
const intParam = (v, def, min, max) => {
  const n = parseInt(v, 10)
  if (!Number.isFinite(n)) return def
  return Math.max(min, Math.min(max, n))
}

/** 同一份直链的全部候选节点（原节点优先，其次上次成功节点，最后其余备用节点）。 */
function cdnCandidates(rawUrl) {
  let u = null
  try { u = new URL(rawUrl) } catch { return [rawUrl] }
  if (CDN_HOST_RE.exec(u.hostname) === null) return [rawUrl]
  const mk = (h) => `${u.protocol}//${h}.music.126.net${u.pathname}${u.search}`
  const hosts = []
  if (lastGoodCdnHost !== '' && lastGoodCdnHost !== u.hostname) hosts.push(lastGoodCdnHost)
  hosts.push(u.hostname)
  for (const h of CDN_ALT_HOSTS) if (!hosts.includes(h + '.music.126.net')) hosts.push(h + '.music.126.net')
  return hosts.map((h) => (h === u.hostname ? rawUrl : mk(h.replace(/\.music\.126\.net$/, ''))))
}

/**
 * 取上游音频流。403/404/5xx 视为「该节点不可达」换下一节点；其余状态（200/206）直接采信。
 * 全部候选耗尽时返回 null，由调用方报错。
 */
async function fetchUpstream(candidates, headers, method) {
  let lastStatus = 0
  let lastErr = null
  for (const target of candidates) {
    let host = ''
    try { host = new URL(target).hostname } catch { host = '' }
    try {
      const r = await fetch(target, { method, headers, redirect: 'follow' })
      // 必须吃掉失败响应体，否则连接不释放
      if (r.status === 403 || r.status === 404 || r.status >= 500) {
        try { await r.arrayBuffer() } catch { /* 忽略 */ }
        lastStatus = r.status
        continue
      }
      if (host !== '') lastGoodCdnHost = host
      return r
    } catch (e) { lastErr = e }
  }
  return { failed: true, status: lastStatus, error: lastErr }
}

/**
 * 定位 go-musicfox 的 cookie jar。Windows 在 %LOCALAPPDATA%\go-musicfox\cookie，
 * 类 Unix 在 ~/.config/go-musicfox/cookie；两处都探，取先存在的。
 */
function musicfoxJarPath() {
  const cands = []
  if (process.env.LOCALAPPDATA) cands.push(join(process.env.LOCALAPPDATA, 'go-musicfox', 'cookie'))
  if (process.env.XDG_CONFIG_HOME) cands.push(join(process.env.XDG_CONFIG_HOME, 'go-musicfox', 'cookie'))
  cands.push(join(homedir(), '.config', 'go-musicfox', 'cookie'))
  cands.push(join(homedir(), 'AppData', 'Local', 'go-musicfox', 'cookie'))
  for (const c of cands) if (existsSync(c)) return c
  return null
}

/**
 * 把 Go http.Cookie 数组转成浏览器风格的 cookie 串。
 * 同一 name 可能因 path 不同而重复（实测 MUSIC_A_T 有多条）：优先 Path='/' 的那条，
 * 同优先级后者覆盖前者。只保留 music.163.com 域，避免把无关 Cookie 上送。
 */
function jarToCookieString(rawText) {
  let jar = null
  try { jar = JSON.parse(rawText) } catch { return '' }
  if (!Array.isArray(jar)) return ''
  const byName = new Map()
  for (const c of jar) {
    if (!c || typeof c.Name !== 'string' || typeof c.Value !== 'string') continue
    if (c.Name === '' || c.Value === '') continue
    if (!String(c.Domain || '').includes('music.163.com')) continue
    const score = c.Path === '/' ? 2 : 1
    const prev = byName.get(c.Name)
    if (prev === undefined || score >= prev.score) byName.set(c.Name, { value: c.Value, score })
  }
  return [...byName.entries()].map(([n, v]) => `${n}=${v.value}`).join('; ')
}

// =====================================================================
// 插件主体
// =====================================================================

export function apply(ctx, _config) {
  // 登录态（内存镜像 + 落盘）
  const auth = { cookie: '', userId: '', nickname: '', vipType: 0, loggedIn: false }
  let authLoaded = false

  // 取链缓存：<audio> 的加载与「真实品质」显示会各请求一次，缓存避免两拿不同档位。
  const TAKE_TTL_MS = 5 * 60 * 1000
  const takeCache = new Map() // songId -> { url, level, br, fee, freeTrialInfo, quality, ts }

  // 上游节流：网易云对匿名高频请求有风控，串行 + 最小间隔。
  const limiter = createLimiter({ maxConcurrent: 2, minGapMs: 200, maxQueue: 16 })
  const limited = (fn) => limiter.run(fn)

  const loadAuth = () => {
    if (authLoaded) return
    authLoaded = true
    try {
      const data = JSON.parse(readFileSync(stateFile(), 'utf8'))
      if (data && typeof data.cookie === 'string') auth.cookie = data.cookie
      if (data && typeof data.userId === 'string') auth.userId = data.userId
      if (data && typeof data.nickname === 'string') auth.nickname = data.nickname
      if (data && typeof data.vipType === 'number') auth.vipType = data.vipType
      auth.loggedIn = auth.cookie !== ''
    } catch { /* 无文件或不可读 → 未登录 */ }
  }

  const persistAuth = () => {
    try {
      const file = stateFile()
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify({
        cookie: auth.cookie, userId: auth.userId, nickname: auth.nickname,
        vipType: auth.vipType, savedAt: Date.now(),
      }), { encoding: 'utf8', mode: 0o600 })
    } catch { /* 落盘失败不影响本次会话可用性 */ }
  }

  /** 用账号接口校验并刷新昵称/VIP；cookie 失效则降级为未登录。 */
  const refreshAccount = async () => {
    if (auth.cookie === '') { auth.loggedIn = false; return false }
    try {
      const acc = await NC.getAccount(auth.cookie)
      if (!acc) { auth.loggedIn = false; return false }
      auth.userId = acc.userId
      auth.nickname = acc.nickname
      auth.vipType = acc.vipType
      auth.loggedIn = true
      return true
    } catch { return auth.loggedIn }
  }

  const clearAuth = () => {
    auth.cookie = ''; auth.userId = ''; auth.nickname = ''; auth.vipType = 0; auth.loggedIn = false
    takeCache.clear()
    persistAuth()
  }

  const statusPayload = () => ({
    loggedIn: auth.loggedIn,
    userId: auth.userId,
    nickname: auth.nickname,
    vipType: auth.vipType,
    hasCookie: auth.cookie !== '',
    musicfoxJar: musicfoxJarPath() !== null,
  })

  /** 取链（带短缓存）。失败也缓存一次错误，避免反复打上游。
   *  fresh=true 绕开缓存重取一次：客户端 seek 卡住要重拉流时用它，别拿一条可能已经过期的链再撞一次。 */
  const take = async (songId, { fresh = false } = {}) => {
    const sid = String(songId).trim()
    const hit = takeCache.get(sid)
    if (!fresh && hit !== undefined && Date.now() - hit.ts < TAKE_TTL_MS) return hit
    let entry
    try {
      const dl = await limited(() => NC.getDownloadURL(sid, auth.cookie))
      entry = {
        url: dl.url, level: dl.level, br: dl.br, fee: dl.fee,
        freeTrialInfo: dl.freeTrialInfo, quality: dl.quality, ts: Date.now(),
      }
      if (entry.url !== '') {
        takeCache.set(sid, entry)
        if (takeCache.size > 200) takeCache.delete(takeCache.keys().next().value)
      }
    } catch (e) {
      entry = { url: '', level: '', br: 0, fee: 0, freeTrialInfo: null, quality: '', err: String((e && e.message) || e), ts: Date.now() }
    }
    return entry
  }

  // -------------------------------------------------------------------
  // 音频流代理：同源转发上游 CDN，透传 Range（拖动进度条必须）
  // -------------------------------------------------------------------
  async function serveStream(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return }
    const sid = String(url.searchParams.get('id') || '').trim()
    if (!/^[0-9]+$/.test(sid)) { res.writeHead(400); res.end('bad id'); return }
    const info = await take(sid, { fresh: url.searchParams.get('fresh') === '1' })
    if (!info.url) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: info.err || '该歌曲无可用播放地址（可能为 VIP 专享或版权受限）', fee: info.fee }))
      return
    }
    const headers = {
      'User-Agent': UA_STREAM,
      'Referer': 'https://music.163.com/',
      ...(auth.cookie ? { Cookie: auth.cookie } : {}),
    }
    const range = req.headers.range
    if (typeof range === 'string' && range !== '') headers.Range = range
    const upstream = await fetchUpstream(cdnCandidates(info.url), headers, req.method)
    if (upstream.failed === true) {
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({
        ok: false,
        error: '音频节点不可达（已尝试备用节点）'
          + (upstream.status ? '，末次状态 ' + upstream.status : '')
          + (upstream.error ? '，' + String((upstream.error && upstream.error.message) || upstream.error) : ''),
      }))
      return
    }
    // 只回传浏览器需要的头，避免把上游的 CORS/Cookie 之类噪音带进来。
    const out = { 'accept-ranges': upstream.headers.get('accept-ranges') || 'bytes' }
    for (const h of ['content-type', 'content-length', 'content-range']) {
      const v = upstream.headers.get(h)
      if (v !== null) out[h] = v
    }
    if (!out['content-type']) out['content-type'] = 'audio/mpeg'
    res.writeHead(upstream.status, out)
    if (req.method === 'HEAD' || upstream.body === null) { res.end(); return }
    Readable.fromWeb(upstream.body).pipe(res)
  }

  // -------------------------------------------------------------------
  // 路由
  // -------------------------------------------------------------------
  const serve = async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://x')
      const p = url.pathname
      const m = req.method || 'GET'
      loadAuth()

      // --- 音频流（单独前缀分支，避免与 JSON 路由混淆） ---
      if (p === ROUTE_PREFIX + '/stream') { await serveStream(req, res, url); return }

      const q = url.searchParams

      // ---- 登录态 ----
      if (p === ROUTE_PREFIX + '/api/status' && m === 'GET') {
        writeJson(res, { ok: true, ...statusPayload() })
        return
      }
      // ---- 界面偏好（语言）----
      if (p === ROUTE_PREFIX + '/api/prefs' && m === 'GET') {
        writeJson(res, { ok: true, ...loadPrefs() })
        return
      }
      if (p === ROUTE_PREFIX + '/api/prefs' && m === 'POST') {
        const body = await readBody(req)
        // 局部更新：只改动过的字段。语言和最近播放是两条独立的写入路径，
        // 谁后写谁覆盖整体的话，切个语言就会把最近播放清空。
        const cur = loadPrefs()
        const next = { lang: cur.lang, recent: cur.recent, ambient: cur.ambient }
        if (body && body.lang !== undefined) {
          const lang = String(body.lang || '')
          if (LANGS.indexOf(lang) < 0) { writeJson(res, { ok: false, error: '不支持的语言：' + lang }, 400); return }
          next.lang = lang
        }
        if (body && body.recent !== undefined) next.recent = cleanRecent(body.recent)
        // 氛围设置是**逐项合并**：面板每次只写自己改过的那几项，整体覆盖会让"改一下强度"
        // 顺手把 scope/字号打回默认（语言那条注释里的同一类事故）。
        if (body && body.ambient !== undefined) {
          const patch = cleanAmbient(body.ambient)
          if (patch === null) { writeJson(res, { ok: false, error: 'ambient 必须是对象' }, 400); return }
          next.ambient = Object.assign({}, cur.ambient, patch)
        }
        const saved = persistPrefs(next)
        writeJson(res, { ok: true, ...next, saved })
        return
      }
      if (p === ROUTE_PREFIX + '/api/import-musicfox' && m === 'POST') {
        const jar = musicfoxJarPath()
        if (jar === null) { writeJson(res, { ok: false, error: '未找到 go-musicfox 的 cookie 文件' }, 404); return }
        let cookie = ''
        try { cookie = jarToCookieString(readFileSync(jar, 'utf8')) } catch (e) {
          writeJson(res, { ok: false, error: '读取失败：' + String((e && e.message) || e) }, 500); return
        }
        if (cookie === '') { writeJson(res, { ok: false, error: 'musicfox cookie 中未找到 music.163.com 的有效凭据' }, 400); return }
        auth.cookie = cookie
        const okLogin = await refreshAccount()
        if (!okLogin) {
          auth.cookie = ''
          writeJson(res, { ok: false, error: 'musicfox 的登录态已失效，请改用扫码登录' }, 401)
          return
        }
        takeCache.clear()
        persistAuth()
        writeJson(res, { ok: true, ...statusPayload() })
        return
      }
      if (p === ROUTE_PREFIX + '/api/qr' && m === 'GET') {
        try {
          const qr = await limited(() => NC.createQRLogin())
          writeJson(res, { ok: true, key: qr.key, imageDataUrl: qr.imageDataUrl, url: qr.url, expiresAt: qr.expiresAt })
        } catch (e) { writeJson(res, { ok: false, error: String((e && e.message) || e) }, 502) }
        return
      }
      if (p === ROUTE_PREFIX + '/api/qr/check' && m === 'GET') {
        const key = String(q.get('key') || '').trim()
        if (key === '') { writeJson(res, { ok: false, error: 'missing key' }, 400); return }
        try {
          const r = await limited(() => NC.checkQRLogin(key))
          if (r.status === 'success' && r.cookie) {
            auth.cookie = r.cookie
            const okLogin = await refreshAccount()
            if (okLogin) { takeCache.clear(); persistAuth() }
            writeJson(res, { ok: true, status: okLogin ? 'success' : 'failed', message: okLogin ? '登录成功' : '登录成功但账号校验失败', ...statusPayload() })
            return
          }
          writeJson(res, { ok: true, status: r.status, message: r.message, ...statusPayload() })
        } catch (e) { writeJson(res, { ok: false, error: String((e && e.message) || e) }, 502) }
        return
      }
      if (p === ROUTE_PREFIX + '/api/logout' && m === 'POST') {
        clearAuth()
        writeJson(res, { ok: true, ...statusPayload() })
        return
      }

      // ---- 搜索 ----
      if (p === ROUTE_PREFIX + '/api/search' && m === 'GET') {
        const kw = String(q.get('q') || '').trim()
        const type = SEARCH_TYPES[String(q.get('type') || 'song')] || 1
        const page = intParam(q.get('page'), 1, 1, 100)
        if (kw === '') { writeJson(res, { ok: true, results: [], total: 0, page }); return }
        try {
          const r = type === 1000
            ? await limited(() => NC.searchPlaylist(kw, auth.cookie, page))
            : await limited(() => NC.search(kw, auth.cookie, page, type))
          writeJson(res, { ok: true, ...r, type: String(q.get('type') || 'song') })
        } catch (e) { writeJson(res, { ok: false, error: String((e && e.message) || e) }, 502) }
        return
      }

      // ---- 榜单 ----
      if (p === ROUTE_PREFIX + '/api/toplists' && m === 'GET') {
        try {
          const groups = await limited(() => NC.getTopLists(auth.cookie))
          writeJson(res, { ok: true, groups })
        } catch (e) { writeJson(res, { ok: false, error: String((e && e.message) || e) }, 502) }
        return
      }
      if (p === ROUTE_PREFIX + '/api/toplist/songs' && m === 'GET') {
        const id = String(q.get('id') || '').trim()
        if (!/^[0-9]+$/.test(id)) { writeJson(res, { ok: false, error: 'bad id' }, 400); return }
        const offset = intParam(q.get('offset'), 0, 0, 100000)
        const num = intParam(q.get('num'), 50, 1, 200)
        try {
          const r = await limited(() => NC.getTopListSongs(id, auth.cookie, offset, num))
          writeJson(res, { ok: true, ...r })
        } catch (e) { writeJson(res, { ok: false, error: String((e && e.message) || e) }, 502) }
        return
      }

      // ---- 歌单发现 ----
      if (p === ROUTE_PREFIX + '/api/recommend' && m === 'GET') {
        try {
          const list = await limited(() => NC.getRecommendedPlaylists(auth.cookie))
          writeJson(res, { ok: true, playlists: list })
        } catch (e) { writeJson(res, { ok: false, error: String((e && e.message) || e) }, 502) }
        return
      }
      if (p === ROUTE_PREFIX + '/api/categories' && m === 'GET') {
        try {
          const cats = await limited(() => NC.getPlaylistCategories(auth.cookie))
          writeJson(res, { ok: true, categories: cats })
        } catch (e) { writeJson(res, { ok: false, error: String((e && e.message) || e) }, 502) }
        return
      }
      if (p === ROUTE_PREFIX + '/api/category/playlists' && m === 'GET') {
        const cat = String(q.get('cat') || '全部').trim() || '全部'
        const page = intParam(q.get('page'), 1, 1, 100)
        const limit = intParam(q.get('limit'), 30, 1, 100)
        try {
          const list = await limited(() => NC.getCategoryPlaylists(cat, page, limit, auth.cookie))
          writeJson(res, { ok: true, playlists: list, cat, page })
        } catch (e) { writeJson(res, { ok: false, error: String((e && e.message) || e) }, 502) }
        return
      }
      if (p === ROUTE_PREFIX + '/api/playlist' && m === 'GET') {
        const id = String(q.get('id') || '').trim()
        if (!/^[0-9]+$/.test(id)) { writeJson(res, { ok: false, error: 'bad id' }, 400); return }
        try {
          const detail = await limited(() => NC.getPlaylistSongs(id, auth.cookie))
          writeJson(res, { ok: true, playlist: detail })
        } catch (e) { writeJson(res, { ok: false, error: String((e && e.message) || e) }, 502) }
        return
      }
      if (p === ROUTE_PREFIX + '/api/simiplaylist' && m === 'GET') {
        const sid = String(q.get('songid') || '').trim()
        if (!/^[0-9]+$/.test(sid)) { writeJson(res, { ok: false, error: 'bad songid' }, 400); return }
        const limit = intParam(q.get('limit'), 6, 1, 30)
        try {
          const list = await limited(() => NC.getSimiPlaylists(sid, limit))
          writeJson(res, { ok: true, playlists: list })
        } catch (e) { writeJson(res, { ok: false, error: String((e && e.message) || e) }, 502) }
        return
      }
      if (p === ROUTE_PREFIX + '/api/myplaylists' && m === 'GET') {
        if (!auth.loggedIn) { writeJson(res, { ok: false, error: '未登录', needLogin: true }, 401); return }
        try {
          const list = await limited(() => NC.getMyPlaylists(auth.cookie))
          writeJson(res, { ok: true, playlists: list })
        } catch (e) { writeJson(res, { ok: false, error: String((e && e.message) || e) }, 502) }
        return
      }
      if (p === ROUTE_PREFIX + '/api/playlist/subscribe' && m === 'POST') {
        if (!auth.loggedIn) { writeJson(res, { ok: false, error: '未登录', needLogin: true }, 401); return }
        const body = await readBody(req)
        const action = body && body.action === 'uncollect' ? 'uncollect' : 'collect'
        try {
          await limited(() => NC.subscribePlaylist(body && body.id, auth.cookie, action))
          writeJson(res, { ok: true })
        } catch (e) { writeJson(res, { ok: false, error: String((e && e.message) || e) }, 502) }
        return
      }

      // ---- 歌词（含 YRC 逐字解析） ----
      if (p === ROUTE_PREFIX + '/api/lyric' && m === 'GET') {
        const id = String(q.get('id') || '').trim()
        if (!/^[0-9]+$/.test(id)) { writeJson(res, { ok: false, error: 'bad id' }, 400); return }
        try {
          const raw = await limited(() => NC.getLyric(id, auth.cookie))
          let word = null
          if (raw.yrc) { try { word = parseYrc(raw.yrc) } catch { word = null } }
          writeJson(res, {
            ok: true,
            lyric: raw.lyric, trans: raw.trans, roma: raw.roma,
            // wordLines 恒为数组（无逐字时为空数组），客户端不必判 null
            wordLevel: word !== null && word.wordLevel === true,
            wordLines: word ? word.lines : [],
          })
        } catch (e) { writeJson(res, { ok: false, error: String((e && e.message) || e) }, 502) }
        return
      }

      // ---- 取链（返回同源代理地址，浏览器直接喂 <audio>） ----
      if (p === ROUTE_PREFIX + '/api/songurl' && m === 'GET') {
        const id = String(q.get('id') || '').trim()
        if (!/^[0-9]+$/.test(id)) { writeJson(res, { ok: false, error: 'bad id' }, 400); return }
        const info = await take(id)
        writeJson(res, {
          ok: info.url !== '',
          id,
          url: info.url !== '' ? `${ROUTE_PREFIX}/stream?id=${id}` : '',
          level: info.level, br: info.br, quality: info.quality,
          fee: info.fee, freeTrialInfo: info.freeTrialInfo,
          error: info.url !== '' ? undefined : (info.err || '无可用播放地址（VIP 专享或版权受限）'),
        })
        return
      }

      writeJson(res, { ok: false, error: 'not found' }, 404)
    } catch (err) {
      try { writeJson(res, { ok: false, error: String((err && err.message) || err) }, 500) } catch { /* 响应已发出 */ }
    }
  }

  try {
    ctx.effect(
      () => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler: serve }),
      'dsh-wyymusic: routes',
    )
  } catch (err) {
    ctx.logger?.warn?.('dsh-wyymusic: 路由注册失败（面板将不可用）：' + String((err && err.message) || err))
  }

  // 启动即尝试恢复登录态并校验一次（失败静默，UI 会显示未登录）
  loadAuth()
  if (auth.cookie !== '') { refreshAccount().catch(() => { /* 离线/风控时保持原状 */ }) }
}
