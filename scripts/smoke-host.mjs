/**
 * scripts/smoke-host.mjs — 宿主半边冒烟测试（真连网易云，非 mock）。
 *
 * 用一个假 ctx（只实现 effect/webServer.register）把插件挂到真实 http 服务上，
 * 逐个打真实路由，校验「有真数据」而不是只看 HTTP 200 —— 空数组 / total=0 都算失败。
 *
 * 用法：node scripts/smoke-host.mjs
 */

import http from 'node:http'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

let handler = null
const disposers = []
const ctx = {
  effect: (fn) => { disposers.push(fn()) },
  webServer: {
    register: (opts) => { handler = opts.handler; return () => { handler = null } },
  },
  logger: { warn: (m) => console.warn('[warn]', m), info: () => {} },
}

apply(ctx, {})
if (handler === null) {
  console.error('FAIL: 未注册路由')
  process.exit(1)
}

const server = http.createServer((req, res) => handler(req, res))
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}/wyymusic`

const get = async (path) => {
  const res = await fetch(base + path, { signal: AbortSignal.timeout(30000) })
  let j = null
  try { j = await res.json() } catch { /* 非 JSON */ }
  return { status: res.status, json: j }
}

const results = []
const check = async (label, path, validate) => {
  try {
    const { status, json } = await get(path)
    const verdict = validate(json, status)
    results.push({ label, ok: verdict === true, detail: verdict === true ? 'OK' : String(verdict), status })
  } catch (e) {
    results.push({ label, ok: false, detail: 'EXCEPTION ' + String((e && e.message) || e), status: 0 })
  }
}

// ---- 1. 登录态 ----
await check('status', '/api/status', (j, s) => {
  if (s !== 200 || !j || j.ok !== true) return `status=${s} body=${JSON.stringify(j)?.slice(0, 200)}`
  if (typeof j.loggedIn !== 'boolean') return 'loggedIn 字段缺失'
  if (typeof j.musicfoxJar !== 'boolean') return 'musicfoxJar 字段缺失'
  return true
})

// ---- 2. 搜索：必须返回真歌 ----
await check('search 周杰伦', '/api/search?q=' + encodeURIComponent('周杰伦') + '&type=song', (j, s) => {
  if (!j || j.ok !== true) return `status=${s} err=${j && j.error}`
  if (!Array.isArray(j.results) || j.results.length === 0) return '结果为 0 首'
  const first = j.results[0]
  if (!first.id || !first.title) return '首条缺 id/title'
  if (!Array.isArray(first.artists) || first.artists.length === 0) return '首条缺 artists'
  return true
})

// ---- 3. 歌单搜索 ----
await check('search 歌单', '/api/search?q=' + encodeURIComponent('华语') + '&type=playlist', (j) => {
  if (!j || j.ok !== true) return `err=${j && j.error}`
  if (!Array.isArray(j.results) || j.results.length === 0) return '歌单结果为 0'
  if (!j.results[0].id || !j.results[0].name) return '歌单条目缺 id/name'
  return true
})

// ---- 4. 榜单列表 ----
await check('toplists', '/api/toplists', (j) => {
  if (!j || j.ok !== true) return `err=${j && j.error}`
  const g = Array.isArray(j.groups) ? j.groups[0] : null
  if (!g || !Array.isArray(g.toplists) || g.toplists.length === 0) return '榜单为空'
  if (!g.toplists[0].id || !g.toplists[0].name) return '榜单条目缺 id/name'
  return true
})

// ---- 5. 榜单歌曲 ----
let rankId = null
{
  const { json } = await get('/api/toplists')
  if (json && json.ok && json.groups && json.groups[0] && json.groups[0].toplists[0]) {
    rankId = json.groups[0].toplists[0].id
  }
}
await check('toplist songs', `/api/toplist/songs?id=${rankId}&num=10`, (j) => {
  if (rankId === null) return '前置榜单 id 未取到'
  if (!j || j.ok !== true) return `err=${j && j.error}`
  if (!Array.isArray(j.songs) || j.songs.length === 0) return '榜单歌曲为 0'
  return true
})

// ---- 6. 推荐歌单 ----
await check('recommend', '/api/recommend', (j) => {
  if (!j || j.ok !== true) return `err=${j && j.error}`
  if (!Array.isArray(j.playlists) || j.playlists.length === 0) return '推荐歌单为 0'
  return true
})

// ---- 7. 歌单分类 ----
await check('categories', '/api/categories', (j) => {
  if (!j || j.ok !== true) return `err=${j && j.error}`
  if (!Array.isArray(j.categories) || j.categories.length === 0) return '分类为 0'
  return true
})

// ---- 8. 分类歌单 ----
await check('category playlists', '/api/category/playlists?cat=' + encodeURIComponent('华语') + '&limit=10', (j) => {
  if (!j || j.ok !== true) return `err=${j && j.error}`
  if (!Array.isArray(j.playlists) || j.playlists.length === 0) return '分类歌单为 0'
  return true
})

// ---- 9. 歌单详情（用推荐里的第一个） ----
let plId = null
{
  const { json } = await get('/api/recommend')
  if (json && json.ok && json.playlists && json.playlists[0]) plId = json.playlists[0].id
}
await check('playlist detail', `/api/playlist?id=${plId}`, (j) => {
  if (plId === null) return '前置歌单 id 未取到'
  if (!j || j.ok !== true) return `err=${j && j.error}`
  const p = j.playlist
  if (!p || !Array.isArray(p.songs) || p.songs.length === 0) return '歌单歌曲为 0'
  if (!p.name) return '歌单缺 name'
  return true
})

// ---- 10/11. 取链 + 歌词（拿一首免费歌；用榜单首曲探测，失败则换搜索首曲） ----
let songId = null
{
  const { json } = await get(`/api/toplist/songs?id=${rankId}&num=5`)
  const cands = (json && json.songs) || []
  // 优先挑 fee=0 的（免费曲必可播），挑不到就用第一首
  const free = cands.find((s) => s.fee === 0) || cands[0]
  if (free) songId = free.id
}
await check('songurl', `/api/songurl?id=${songId}`, (j) => {
  if (songId === null) return '前置歌曲 id 未取到'
  if (!j) return '无响应体'
  // 取链失败是合法业务结果（VIP/版权），但必须给出 error 说明且不含异常文本
  if (j.ok === false) {
    if (!j.error) return '失败但无 error 说明'
    return true
  }
  if (typeof j.url !== 'string' || !j.url.startsWith('/wyymusic/stream?id=')) return 'url 不是同源代理地址：' + j.url
  return true
})

await check('lyric', `/api/lyric?id=${songId}`, (j) => {
  if (songId === null) return '前置歌曲 id 未取到'
  if (!j || j.ok !== true) return `err=${j && j.error}`
  if (typeof j.lyric !== 'string') return 'lyric 非字符串'
  if (j.lyric === '' && !j.wordLevel) return 'lyric 与逐字均空'
  if (!Array.isArray(j.wordLines)) return 'wordLines 非数组'
  return true
})

// ---- 11b. YRC 解析器定点验证（合成样本，确定性；避免「真歌恰好没逐字」造成假绿） ----
{
  const { parseYrc } = await import('../lib/yrc.js')
  // 行 [起始ms,持续ms]；词 (绝对起始ms,时长ms,占位)字
  const sample = '[0,2000](0,500,0)你(500,500,0)好(1000,1000,0)啊\n[2000,1500](2000,700,0)世(2700,800,0)界'
  const got = parseYrc(sample)
  const checks = []
  if (!got) checks.push('返回 null')
  else {
    if (got.lines.length !== 2) checks.push(`行数=${got.lines.length}（期望 2）`)
    if (got.lines[0] && got.lines[0].text !== '你好啊') checks.push(`首行文本="${got.lines[0].text}"（期望 你好啊）`)
    if (got.lines[0] && got.lines[0].t !== 0) checks.push(`首行 t=${got.lines[0].t}（期望 0）`)
    if (got.lines[1] && got.lines[1].t !== 2) checks.push(`次行 t=${got.lines[1].t}（期望 2）`)
    const w = got.lines[0] && got.lines[0].words
    if (!Array.isArray(w) || w.length !== 3) checks.push(`首行词数=${w && w.length}（期望 3）`)
    else {
      if (w[1].text !== '好') checks.push(`第 2 词="${w[1].text}"（期望 好）`)
      if (w[1].t !== 0.5) checks.push(`第 2 词 t=${w[1].t}（期望 0.5）`)
      if (w[2].end !== 2) checks.push(`第 3 词 end=${w[2].end}（期望 2）`)
    }
    if (got.wordLevel !== true) checks.push('wordLevel 非 true')
  }
  // 反证：纯文本（无逐词标签）不该被当成逐字
  const plain = parseYrc('[0,1000]这是没有逐词标签的一行')
  if (plain && (plain.wordLevel !== false || plain.lines[0].words !== undefined)) checks.push('纯文本行被误判为逐字')
  if (checks.length === 0) results.push({ label: 'yrc parser', ok: true, detail: 'OK 行/词/时基/反证 全中', status: 200 })
  else results.push({ label: 'yrc parser', ok: false, detail: checks.join('；'), status: 0 })
}

// ---- 11c. 真歌逐字可用率（信息项：证明 YRC 主路通，不因某首没逐字而误判） ----
{
  const { json } = await get(`/api/toplist/songs?id=${rankId}&num=20`)
  const ids = ((json && json.songs) || []).map((s) => s.id).slice(0, 12)
  let wordHits = 0
  let lrcHits = 0
  for (const id of ids) {
    const r = await get(`/api/lyric?id=${id}`)
    if (r.json && r.json.ok) {
      if (r.json.lyric) lrcHits++
      if (r.json.wordLevel) wordHits++
    }
  }
  results.push({
    label: 'lyric 实测覆盖',
    ok: lrcHits > 0,
    detail: `${ids.length} 首中 ${lrcHits} 首有歌词、${wordHits} 首有逐字`,
    status: 200,
  })
}

// ---- 12. 流代理：真拉字节（这是「能出声」的硬证据） ----
{
  const { json: su } = await get(`/api/songurl?id=${songId}`)
  if (su && su.ok && su.url) {
    try {
      const res = await fetch('http://127.0.0.1:' + server.address().port + su.url, {
        headers: { Range: 'bytes=0-65535' },
        signal: AbortSignal.timeout(30000),
      })
      const buf = Buffer.from(await res.arrayBuffer())
      const ct = res.headers.get('content-type') || ''
      const cr = res.headers.get('content-range') || ''
      if (res.status !== 206) results.push({ label: 'stream Range', ok: false, detail: `期望 206 实为 ${res.status}`, status: res.status })
      else if (buf.length === 0) results.push({ label: 'stream Range', ok: false, detail: '拿到 0 字节', status: res.status })
      else if (!ct.startsWith('audio')) results.push({ label: 'stream Range', ok: false, detail: 'content-type=' + ct, status: res.status })
      else results.push({ label: 'stream Range', ok: true, detail: `OK 206 ${buf.length}B ${ct} ${cr}`, status: res.status })
    } catch (e) {
      results.push({ label: 'stream Range', ok: false, detail: 'EXCEPTION ' + String((e && e.message) || e), status: 0 })
    }
  } else {
    results.push({ label: 'stream Range', ok: false, detail: '取链失败，无法验证流（' + (su && su.error) + '）', status: 0 })
  }
}

// ---- 13. 未知路由必须 404（反证：证明路由确实在按 path 分派） ----
await check('unknown -> 404', '/api/definitely-not-a-route', (j, s) => (s === 404 ? true : `期望 404 实为 ${s}`))

// ---- 14. 坏参数必须 400（反证：证明参数校验生效） ----
await check('bad id -> 400', '/api/playlist?id=abc', (j, s) => (s === 400 ? true : `期望 400 实为 ${s}`))

// ---- 15. 登录态下 VIP 歌必须真能出声（CDN 节点容错的回归守卫） ----
{
  const st = (await get('/api/status')).json || {}
  if (!st.loggedIn) {
    results.push({ label: 'VIP 播放', ok: false, detail: '未登录，无法验证高音质链路（先跑 /api/import-musicfox）', status: 0 })
  } else {
    const s = await get('/api/search?q=' + encodeURIComponent('孤勇者 陈奕迅') + '&type=song')
    const song = s.json && s.json.results && s.json.results[0]
    if (!song) {
      results.push({ label: 'VIP 播放', ok: false, detail: '搜索无结果', status: 0 })
    } else {
      const u = await get('/api/songurl?id=' + song.id)
      if (!u.json || !u.json.ok) {
        results.push({ label: 'VIP 播放', ok: false, detail: '取链失败：' + (u.json && u.json.error), status: 0 })
      } else {
        const port = server.address().port
        const r = await fetch(`http://127.0.0.1:${port}${u.json.url}`, {
          headers: { Range: 'bytes=0-65535' },
          signal: AbortSignal.timeout(40000),
        })
        const b = Buffer.from(await r.arrayBuffer())
        const ct = r.headers.get('content-type') || ''
        if (r.status !== 206) results.push({ label: 'VIP 播放', ok: false, detail: `HTTP ${r.status}（期望 206）`, status: r.status })
        else if (b.length === 0) results.push({ label: 'VIP 播放', ok: false, detail: '0 字节', status: r.status })
        else if (!ct.startsWith('audio')) results.push({ label: 'VIP 播放', ok: false, detail: 'content-type=' + ct, status: r.status })
        else results.push({ label: 'VIP 播放', ok: true, detail: `OK 206 ${b.length}B ${ct} 品质=${u.json.quality || u.json.level || '?'}`, status: r.status })
      }
    }
  }
}

// ---- 16. 氛围设置（ambient）在 prefs 里的往返 + 校验 ----
// 隔离到临时 DSH_HOME：这一节会**真的写** prefs.json，绝不能落到用户真实的 ~/.dsh。
// 前面的网络用例仍用真实 DSH_HOME（cookie 在那），所以这里只在本节内切换再切回来。
{
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-wyymusic-prefs-'))
  const before = process.env.DSH_HOME
  process.env.DSH_HOME = tmp
  const post = async (body) => {
    const res = await fetch(base + '/api/prefs', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    })
    let j = null
    try { j = await res.json() } catch { /* 非 JSON */ }
    return { status: res.status, json: j }
  }
  const checks = []
  try {
    const d = (await get('/api/prefs')).json
    if (!d || !d.ambient) checks.push('GET 缺 ambient')
    else {
      if (d.ambient.on !== false) checks.push('默认 on 应为 false，实为 ' + d.ambient.on)
      if (d.ambient.barHeight !== 56) checks.push('默认 barHeight 应为 56，实为 ' + d.ambient.barHeight)
      if (d.ambient.bgScope !== 'frame') checks.push('默认 bgScope 应为 frame（用户点名"直接全屏"），实为 ' + d.ambient.bgScope)
      if (d.ambient.spot !== true || d.ambient.spotPower !== 60) checks.push('默认 spot/spotPower 不对：' + d.ambient.spot + '/' + d.ambient.spotPower)
    }
    // 越界夹回 / 未知键丢弃 / 枚举兜底：一条 POST 里同时验三种
    // 默认值迁移（一次性）：旧默认值写进过 prefs 的话，读回来必须是新默认值；
// 用户手改过的值（不等于旧默认）不许被动。
    const w = await post({ ambient: { on: true, bgStrength: 999, barHeight: 3, bgScope: 'nonsense', hack: 'x' } })
    if (w.status !== 200 || !w.json || w.json.ok !== true) checks.push('写 ambient 失败：' + JSON.stringify(w.json).slice(0, 120))
    else {
      const a = w.json.ambient || {}
      if (a.on !== true) checks.push('on 没写进去')
      if (a.bgStrength !== 100) checks.push('bgStrength 没夹回 100，实为 ' + a.bgStrength)
      if (a.barHeight !== 10) checks.push('barHeight 没夹回 10，实为 ' + a.barHeight)
      if (a.bgScope !== 'frame') checks.push('非法枚举没被丢弃（该回落到默认 frame），实为 ' + a.bgScope)
      if (Object.prototype.hasOwnProperty.call(a, 'hack')) checks.push('未知键 hack 被写进来了')
    }
    // 局部更新反证：改语言不该把刚写的氛围设置打回默认
    await post({ lang: 'zh' })
    const d2 = (await get('/api/prefs')).json
    if (!d2 || !d2.ambient || d2.ambient.on !== true) checks.push('改 lang 之后 ambient.on 丢了（局部更新被整体覆盖）')
    // 落盘反证：文件里必须真有 ambient（不是只活在内存里）
    const raw = JSON.parse(readFileSync(join(tmp, 'wyymusic', 'prefs.json'), 'utf8'))
    if (!raw.ambient || raw.ambient.on !== true) checks.push('prefs.json 里没有落盘 ambient')
    // 坏类型必须被拒（400），而不是写进去一个字符串
    const bad = await post({ ambient: 'oops' })
    if (bad.status !== 400) checks.push('ambient 传字符串应 400，实为 ' + bad.status)
    // 默认值迁移：手写一份"旧默认"到文件里（模拟用户从旧版本升上来），读回来必须是新默认
    writeFileSync(join(tmp, 'wyymusic', 'prefs.json'), JSON.stringify({
      lang: 'zh', recent: [], ambient: { on: true, barHeight: 26, barGain: 60, bgStrength: 55, bgScope: 'convo' },
    }))
    const mig = (await get('/api/prefs')).json
    if (!mig || !mig.ambient) checks.push('迁移场景读不到 ambient')
    else {
      // 逐版迁移：26 →(v2) 40 →(v3) 56；60 → 85 → 90 —— 必须**顺次**两批都吃到
      if (mig.ambient.barHeight !== 56) checks.push('旧默认 barHeight=26 没顺次迁到 56，实为 ' + mig.ambient.barHeight)
      if (mig.ambient.barGain !== 90) checks.push('旧默认 barGain=60 没顺次迁到 90，实为 ' + mig.ambient.barGain)
      if (mig.ambient.bgStrength !== 70) checks.push('旧默认 bgStrength=55 没迁到 70，实为 ' + mig.ambient.bgStrength)
      if (mig.ambient.on !== true) checks.push('迁移把用户自己的开关冲掉了')
      // 老文件常常没写 ambVersion：那一档必须当成 0，两批都跑
      const mig2 = (await get('/api/prefs')).json
      if (!mig2 || !mig2.ambient || mig2.ambient.bgScope !== 'frame') checks.push('旧文件缺 ambVersion 时 bgScope 没推到 frame，实为 ' + (mig2 && mig2.ambient && mig2.ambient.bgScope))
    }
    // 反证：手改过的值（≠旧默认）不许被迁移覆盖
    writeFileSync(join(tmp, 'wyymusic', 'prefs.json'), JSON.stringify({
      lang: 'zh', recent: [], ambient: { barHeight: 12, barGain: 20, bgStrength: 30 },
    }))
    const kept = (await get('/api/prefs')).json
    if (!kept || !kept.ambient) checks.push('反证场景读不到 ambient')
    else if (kept.ambient.barHeight !== 12 || kept.ambient.barGain !== 20 || kept.ambient.bgStrength !== 30) {
      checks.push('迁移把手改过的值覆盖了：' + JSON.stringify(kept.ambient))
    }
  } catch (e) {
    checks.push('EXCEPTION ' + String((e && e.message) || e))
  } finally {
    if (before === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = before
  }
  if (checks.length === 0) results.push({ label: 'ambient prefs', ok: true, detail: 'OK 默认/夹回/白名单/局部更新/落盘/400 全中', status: 200 })
  else results.push({ label: 'ambient prefs', ok: false, detail: checks.join('；'), status: 0 })
}

server.close()
for (const d of disposers) { try { if (typeof d === 'function') d() } catch { /* ignore */ } }

// ---- 汇总 ----
console.log('')
console.log('===== dsh-wyymusic 宿主冒烟 =====')
let pass = 0
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.label.padEnd(20)} ${r.detail}`)
  if (r.ok) pass++
}
console.log(`\n${pass}/${results.length} 通过`)
process.exit(pass === results.length ? 0 : 1)
