/**
 * scripts/probe-host-routes.mjs — dsh-wyymusic 宿主路由功能探针（真内核，非 mock）
 *
 * 与 scripts/smoke-host.mjs 的区别：smoke-host 用假 ctx 把插件直接挂到自建 http 上，
 * 只能证明「处理器本身能跑」；本脚本打的是**真内核**（dsh web 模式）里由
 * ctx.webServer.register({kind:'prefix'}) 注册出来的路由，能证明扩展点在目标内核
 * （0.2.1-rc.2）里确实生效、前缀路由确实被分派到插件。
 *
 * 用法：
 *   node scripts/probe-host-routes.mjs                         # 默认 http://127.0.0.1:55904
 *   node scripts/probe-host-routes.mjs http://127.0.0.1:55904
 *   node scripts/probe-host-routes.mjs http://127.0.0.1:55904 --search-param=q
 *
 * 前置：内核已用隔离 DSH_HOME 起在目标端口，且该 home 的
 *   wyymusic/cookie.json 已放入登录态（只读复制，勿改写源文件）。
 *
 * 说明：
 * - 12 条用例逐条打印 PASS / WARN / FAIL + HTTP 码；FAIL/WARN 附带响应原文（截断 500 字）。
 * - #2 默认按任务书的参数名 keywords= 打；同时会补打 q=（插件实现与 lib/client.js 实际用的参数名），
 *   两者不一致时判 WARN 并在明细里写明，避免把「参数名写错」误报成「功能坏了」。
 * - #11 会真的 POST 一次 lang=zh，写入的是**内核进程的 DSH_HOME**（探针应指向隔离 home）。
 *
 * 退出码：0 = 12 条全 PASS；1 = 有 FAIL；2 = 无 FAIL 但有 WARN。
 */

import { Buffer } from 'node:buffer'

const argv = process.argv.slice(2)
const opt = (k, d) => {
  const hit = argv.find((a) => a.startsWith('--' + k + '='))
  return hit === undefined ? d : hit.slice(k.length + 3)
}
let base = 'http://127.0.0.1:55904'
for (const a of argv) if (/^https?:\/\//i.test(a)) base = a.replace(/\/+$/, '')
// 任务书原文用的是 keywords=，插件实现读的是 q=（见 lib/index.js 搜索分支、lib/client.js 调用处）
const SEARCH_PARAM = opt('search-param', 'keywords')
const TIMEOUT_MS = Number(opt('timeout', '45000')) || 45000

const rows = []
const rec = (n, label, verdict, status, detail) => rows.push({ n, label, verdict, status, detail })

async function hit(path, init = {}) {
  const t0 = Date.now()
  try {
    const res = await fetch(base + path, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
    const buf = Buffer.from(await res.arrayBuffer())
    const text = buf.toString('utf8')
    let json = null
    try { json = JSON.parse(text) } catch { /* 非 JSON */ }
    return { ok: true, status: res.status, headers: res.headers, bytes: buf.length, text, json, ms: Date.now() - t0 }
  } catch (e) {
    const code = (e && (e.cause && e.cause.code)) || (e && e.name) || 'Error'
    const msg = String((e && (e.cause && e.cause.message)) || (e && e.message) || e)
    return { ok: false, status: 0, error: code + ': ' + msg, ms: Date.now() - t0 }
  }
}

/** 失败/WARN 用的原文证据（截断，避免刷屏）。 */
const raw = (r) => {
  if (!r || r.ok !== true) return 'REQUEST FAILED — ' + (r && r.error ? r.error : 'unknown')
  const head = 'HTTP ' + r.status + ' ' + r.bytes + 'B ' + r.ms + 'ms'
  const body = r.text.length > 500 ? r.text.slice(0, 500) + '…(truncated)' : r.text
  return head + ' :: ' + body
}
const arr = (v) => (Array.isArray(v) ? v : [])

// 前面用例取到的上下文，供后续用例复用（同一首歌、同一个榜单）
const ctx = { toplistId: null, songId: null, songurl: null }

// =====================================================================
// 1. 登录态
// =====================================================================
{
  const r = await hit('/wyymusic/api/status')
  let verdict = 'FAIL'
  let detail = ''
  if (!r.ok) detail = '请求失败'
  else if (r.status !== 200) detail = 'HTTP ' + r.status
  else if (!r.json || r.json.ok !== true) detail = 'ok !== true'
  else if (r.json.loggedIn !== true) detail = 'loggedIn=' + r.json.loggedIn + '（cookie 未生效或已失效）'
  else if (typeof r.json.nickname !== 'string' || r.json.nickname.trim() === '') detail = 'nickname 为空'
  else { verdict = 'PASS'; detail = 'loggedIn=true nickname=' + r.json.nickname + ' userId=' + r.json.userId + ' vipType=' + r.json.vipType }
  rec(1, 'GET /api/status', verdict, r.status, detail + (verdict === 'PASS' ? '' : ' | ' + raw(r)))
}

// =====================================================================
// 2. 搜索（任务书参数名 keywords=；同时补打实现实际用的 q=）
// =====================================================================
{
  const qs = '/wyymusic/api/search?' + SEARCH_PARAM + '=' + encodeURIComponent('晴天') + '&type=song'
  const r = await hit(qs)
  const got = arr(r.json && r.json.results)
  let verdict = 'FAIL'
  let detail = ''
  if (!r.ok) detail = '请求失败'
  else if (r.status !== 200) detail = 'HTTP ' + r.status
  else if (!r.json || r.json.ok !== true) detail = 'ok !== true'
  else if (got.length === 0) {
    // 参数名不是实现认的那个 → 补打 q= 区分「参数名写错」与「搜索坏了」
    const alt = await hit('/wyymusic/api/search?q=' + encodeURIComponent('晴天') + '&type=song')
    const altGot = arr(alt.json && alt.json.results)
    if (altGot.length > 0) {
      verdict = SEARCH_PARAM === 'q' ? 'FAIL' : 'WARN'
      detail = '按 ' + SEARCH_PARAM + '= 返回 0 条（total=' + (r.json && r.json.total) + '）；'
        + '按 q= 返回 ' + altGot.length + ' 条（total=' + (alt.json && alt.json.total) + '）'
        + ' → 路由只读 q（lib/index.js 搜索分支），' + SEARCH_PARAM + ' 未被识别'
    } else {
      detail = '结果为 0 条（total=' + (r.json && r.json.total) + '），q= 补打也 0 条'
    }
  } else {
    const f = got[0]
    verdict = 'PASS'
    detail = '返回 ' + got.length + ' 条 (total=' + (r.json.total || '?') + ')，首条 id=' + f.id + ' title=' + JSON.stringify(f.title)
  }
  rec(2, 'GET /api/search?' + SEARCH_PARAM + '=晴天&type=song', verdict, r.status, detail + (verdict === 'PASS' ? '' : ' | ' + raw(r)))
}

// =====================================================================
// 3. 榜单列表
// =====================================================================
{
  const r = await hit('/wyymusic/api/toplists')
  let verdict = 'FAIL'
  let detail = ''
  const groups = arr(r.json && r.json.groups)
  const flat = groups.flatMap((g) => arr(g && g.toplists))
  if (!r.ok) detail = '请求失败'
  else if (r.status !== 200) detail = 'HTTP ' + r.status
  else if (!r.json || r.json.ok !== true) detail = 'ok !== true'
  else if (flat.length === 0) detail = '榜单为空（groups=' + groups.length + '）'
  else {
    ctx.toplistId = String(flat[0].id)
    verdict = 'PASS'
    detail = groups.length + ' 组 / ' + flat.length + ' 个榜单，首个 id=' + ctx.toplistId + ' name=' + JSON.stringify(flat[0].name)
  }
  rec(3, 'GET /api/toplists', verdict, r.status, detail + (verdict === 'PASS' ? '' : ' | ' + raw(r)))
}

// =====================================================================
// 4. 榜单曲目（id 取 #3 的第一个榜单）
// =====================================================================
{
  const id = ctx.toplistId
  if (id === null) {
    rec(4, 'GET /api/toplist/songs?id=<#3 首榜>', 'FAIL', 0, '前置：#3 未取到榜单 id，无法构造请求')
  } else {
    const r = await hit('/wyymusic/api/toplist/songs?id=' + encodeURIComponent(id) + '&num=10')
    const songs = arr(r.json && r.json.songs)
    let verdict = 'FAIL'
    let detail = ''
    if (!r.ok) detail = '请求失败'
    else if (r.status !== 200) detail = 'HTTP ' + r.status
    else if (!r.json || r.json.ok !== true) detail = 'ok !== true'
    else if (songs.length === 0) detail = '曲目为空'
    else { verdict = 'PASS'; detail = 'id=' + id + ' 返回 ' + songs.length + ' 首，首曲 id=' + songs[0].id + ' title=' + JSON.stringify(songs[0].title) }
    rec(4, 'GET /api/toplist/songs?id=' + id, verdict, r.status, detail + (verdict === 'PASS' ? '' : ' | ' + raw(r)))
  }
}

// =====================================================================
// 5. 推荐歌单
// =====================================================================
{
  const r = await hit('/wyymusic/api/recommend')
  const list = arr(r.json && r.json.playlists)
  let verdict = 'FAIL'
  let detail = ''
  if (!r.ok) detail = '请求失败'
  else if (r.status !== 200) detail = 'HTTP ' + r.status
  else if (!r.json || r.json.ok !== true) detail = 'ok !== true'
  else if (list.length === 0) detail = '推荐歌单为空'
  else { verdict = 'PASS'; detail = '返回 ' + list.length + ' 个歌单，首个 id=' + list[0].id + ' name=' + JSON.stringify(list[0].name) }
  rec(5, 'GET /api/recommend', verdict, r.status, detail + (verdict === 'PASS' ? '' : ' | ' + raw(r)))
}

// =====================================================================
// 6. 我的歌单（登录态下）
// =====================================================================
{
  const r = await hit('/wyymusic/api/myplaylists')
  const list = arr(r.json && r.json.playlists)
  let verdict = 'FAIL'
  let detail = ''
  if (!r.ok) detail = '请求失败'
  else if (r.status === 401) detail = 'HTTP 401 未登录（needLogin=' + (r.json && r.json.needLogin) + '）'
  else if (r.status !== 200) detail = 'HTTP ' + r.status
  else if (!r.json || r.json.ok !== true) detail = 'ok !== true'
  else if (list.length === 0) detail = '我的歌单为空'
  else { verdict = 'PASS'; detail = '返回 ' + list.length + ' 个歌单，首个 id=' + list[0].id + ' name=' + JSON.stringify(list[0].name) }
  rec(6, 'GET /api/myplaylists', verdict, r.status, detail + (verdict === 'PASS' ? '' : ' | ' + raw(r)))
}

// =====================================================================
// 7/8/9 的取样：从 #2 的搜索结果里挑一首「歌词非空」的歌
// =====================================================================
async function pickSong() {
  const r = await hit('/wyymusic/api/search?q=' + encodeURIComponent('晴天') + '&type=song')
  const cands = arr(r.json && r.json.results).slice(0, 8)
  for (const s of cands) {
    const lyr = await hit('/wyymusic/api/lyric?id=' + encodeURIComponent(s.id))
    const j = lyr.json
    if (lyr.status === 200 && j && j.ok === true && typeof j.lyric === 'string' && j.lyric.trim() !== '') {
      return { song: s, lyric: lyr, tried: cands.indexOf(s) + 1 }
    }
  }
  return { song: cands[0] || null, lyric: null, tried: cands.length }
}

// =====================================================================
// 7. 歌词
// =====================================================================
{
  const picked = await pickSong()
  const s = picked.song
  if (s === null) {
    rec(7, 'GET /api/lyric?id=<某首歌>', 'FAIL', 0, '前置：搜索无结果，无法挑歌')
  } else {
    const r = picked.lyric || await hit('/wyymusic/api/lyric?id=' + encodeURIComponent(s.id))
    ctx.songId = String(s.id)
    const j = r.json
    let verdict = 'FAIL'
    let detail = ''
    if (!r.ok) detail = '请求失败'
    else if (r.status !== 200) detail = 'HTTP ' + r.status
    else if (!j || j.ok !== true) detail = 'ok !== true'
    else if (typeof j.lyric !== 'string' || j.lyric.trim() === '') detail = 'lyric 为空（wordLevel=' + j.wordLevel + '）'
    else {
      verdict = 'PASS'
      detail = 'id=' + s.id + ' title=' + JSON.stringify(s.title) + ' lyric=' + j.lyric.length + ' 字'
        + ' wordLevel=' + j.wordLevel + ' wordLines=' + arr(j.wordLines).length + '（试到第 ' + picked.tried + ' 首）'
    }
    rec(7, 'GET /api/lyric?id=' + s.id, verdict, r.status, detail + (verdict === 'PASS' ? '' : ' | ' + raw(r)))
  }
}

// =====================================================================
// 8. 取链（同一首）
// =====================================================================
{
  const id = ctx.songId
  if (id === null) {
    rec(8, 'GET /api/songurl?id=<#7 同曲>', 'FAIL', 0, '前置：#7 未确定歌曲 id')
  } else {
    const r = await hit('/wyymusic/api/songurl?id=' + encodeURIComponent(id))
    const j = r.json
    let verdict = 'FAIL'
    let detail = ''
    if (!r.ok) detail = '请求失败'
    else if (r.status !== 200) detail = 'HTTP ' + r.status
    else if (!j || j.ok !== true) detail = 'ok !== true，error=' + JSON.stringify(j && j.error) + '（VIP 专享/版权受限是合法业务结果，但本用例要求登录态下可播）'
    else if (typeof j.url !== 'string' || !j.url.startsWith('/wyymusic/stream')) detail = 'url 不是同源代理地址：' + JSON.stringify(j.url)
    else {
      verdict = 'PASS'
      ctx.songurl = j
      detail = 'id=' + id + ' url=' + j.url + ' level=' + j.level + ' br=' + j.br + ' quality=' + JSON.stringify(j.quality) + ' fee=' + j.fee
    }
    rec(8, 'GET /api/songurl?id=' + id, verdict, r.status, detail + (verdict === 'PASS' ? '' : ' | ' + raw(r)))
  }
}

// =====================================================================
// 9. 流代理（同一首，Range: bytes=0-1023）
// =====================================================================
{
  const id = ctx.songId
  if (id === null || !ctx.songurl) {
    rec(9, 'GET /wyymusic/stream?id=<#8 同曲> (Range 0-1023)', 'FAIL', 0, '前置：#8 未取到可用直链，无法验证流')
  } else {
    const r = await hit('/wyymusic/stream?id=' + encodeURIComponent(id), { headers: { Range: 'bytes=0-1023' } })
    let verdict = 'FAIL'
    let detail = ''
    if (!r.ok) detail = '请求失败'
    else if (r.status !== 206 && r.status !== 200) detail = 'HTTP ' + r.status + '（期望 206 或 200）'
    else if (r.bytes === 0) detail = '返回 0 字节'
    else if (r.bytes < 900) detail = '字节数偏少：' + r.bytes + 'B（期望接近 1024）'
    else {
      verdict = 'PASS'
      const ct = r.headers.get('content-type') || ''
      const cr = r.headers.get('content-range') || ''
      detail = 'HTTP ' + r.status + ' ' + r.bytes + 'B content-type=' + ct + (cr ? ' content-range=' + cr : '') + ' ' + r.ms + 'ms'
    }
    rec(9, 'GET /wyymusic/stream?id=' + id + ' (Range bytes=0-1023)', verdict, r.status, detail + (verdict === 'PASS' ? '' : ' | ' + raw(r)))
  }
}

// =====================================================================
// 10. 界面偏好读取
// =====================================================================
{
  const r = await hit('/wyymusic/api/prefs')
  const j = r.json
  let verdict = 'FAIL'
  let detail = ''
  const hasKeys = j && Object.prototype.hasOwnProperty.call(j, 'lang') && Object.prototype.hasOwnProperty.call(j, 'recent') && Object.prototype.hasOwnProperty.call(j, 'ambient')
  if (!r.ok) detail = '请求失败'
  else if (r.status !== 200) detail = 'HTTP ' + r.status
  else if (!j || j.ok !== true) detail = 'ok !== true'
  else if (!hasKeys) detail = '缺字段：' + JSON.stringify(Object.keys(j || {}))
  else if (!Array.isArray(j.recent)) detail = 'recent 非数组'
  else if (j.ambient === null || typeof j.ambient !== 'object') detail = 'ambient 非对象'
  else { verdict = 'PASS'; detail = 'lang=' + j.lang + ' recent=' + j.recent.length + ' 条 ambient.on=' + j.ambient.on + ' ambient.barHeight=' + j.ambient.barHeight }
  rec(10, 'GET /api/prefs', verdict, r.status, detail + (verdict === 'PASS' ? '' : ' | ' + raw(r)))
}

// =====================================================================
// 11. 界面偏好写入
// =====================================================================
{
  const r = await hit('/wyymusic/api/prefs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lang: 'zh' }),
  })
  const j = r.json
  let verdict = 'FAIL'
  let detail = ''
  if (!r.ok) detail = '请求失败'
  else if (r.status !== 200) detail = 'HTTP ' + r.status
  else if (!j || j.ok !== true) detail = 'ok !== true'
  else if (j.lang !== 'zh') detail = '回显 lang=' + j.lang + '（期望 zh）'
  else {
    // 落盘反证：再 GET 一次必须读到 zh（证明写进的是服务端 DSH_HOME 里的 prefs.json）
    const back = await hit('/wyymusic/api/prefs')
    if (back.json && back.json.lang === 'zh') { verdict = 'PASS'; detail = 'POST ok saved=' + j.saved + '，回读 lang=zh' }
    else detail = '回读 lang=' + (back.json && back.json.lang) + '（写入未生效）'
  }
  rec(11, 'POST /api/prefs {"lang":"zh"}', verdict, r.status, detail + (verdict === 'PASS' ? '' : ' | ' + raw(r)))
}

// =====================================================================
// 12. 未知路由必须 404 且 ok:false（反证：证明前缀路由确实在按 path 分派）
// =====================================================================
{
  const r = await hit('/wyymusic/api/nope')
  const j = r.json
  let verdict = 'FAIL'
  let detail = ''
  if (!r.ok) detail = '请求失败'
  else if (r.status !== 404) detail = 'HTTP ' + r.status + '（期望 404）'
  else if (!j || j.ok !== false) detail = 'body 不是 {ok:false}'
  else { verdict = 'PASS'; detail = 'HTTP 404 ok=false error=' + JSON.stringify(j.error) }
  rec(12, 'GET /api/nope', verdict, r.status, detail + (verdict === 'PASS' ? '' : ' | ' + raw(r)))
}

// =====================================================================
// 汇总
// =====================================================================
console.log('')
console.log('===== dsh-wyymusic 宿主路由探针（真内核）=====')
console.log('base = ' + base + '   search-param = ' + SEARCH_PARAM)
console.log('')
let pass = 0
let warn = 0
let fail = 0
for (const r of rows) {
  if (r.verdict === 'PASS') pass++
  else if (r.verdict === 'WARN') warn++
  else fail++
  console.log(r.verdict.padEnd(4) + ' ' + String(r.n).padStart(2) + '. ' + r.label)
  console.log('       HTTP ' + (r.status || '---') + '  ' + r.detail)
}
console.log('')
console.log('合计：' + pass + '/' + rows.length + ' PASS' + (warn ? '，' + warn + ' WARN' : '') + (fail ? '，' + fail + ' FAIL' : ''))
console.log('')
if (fail > 0 || warn > 0) {
  console.log('--- 非 PASS 项的证据原文 ---')
  for (const r of rows) if (r.verdict !== 'PASS') console.log('#' + r.n + ' [' + r.verdict + '] ' + r.detail)
  console.log('')
}
process.exit(fail > 0 ? 1 : warn > 0 ? 2 : 0)
