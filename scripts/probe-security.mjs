#!/usr/bin/env node
/**
 * scripts/probe-security.mjs — 宿主路由的「同源守卫」回归探针（真内核）。
 *
 * 为什么要有这条腿：webServer 的路由表不带来任何鉴权，/wyymusic/* 因此对所有能到达
 * 这个端口的"页面"开放。lib/index.js 里那两道闸（Host 白名单 + 写操作同源）是**唯一**
 * 挡住 DNS rebinding 与跨站表单 POST 的东西 —— 它们又特别容易在后续重构里被顺手删掉，
 * 所以钉在这儿：每条都真打一次，既测"该拒的拒了"，也测"该放的没被拦"。
 *
 * 用法：
 *   node scripts/probe-security.mjs                      # 默认 http://127.0.0.1:55904
 *   node scripts/probe-security.mjs http://127.0.0.1:55904
 *
 * 前置：内核已用隔离 DSH_HOME 起在目标端口（其余同 probe-host-routes.mjs）。
 * 退出码：0 = 全 PASS；1 = 有 FAIL。
 *
 * 用 node:http 而不是 fetch：fetch 的 Headers 守卫会拦掉 Host / Sec-Fetch-Site 这类
 * 伪造头 —— 而本探针的全部意义就是伪造它们。
 */
import http from 'node:http'

const argv = process.argv.slice(2)
let base = 'http://127.0.0.1:55904'
for (const a of argv) if (/^https?:\/\//i.test(a)) base = a.replace(/\/+$/, '')
const U = new URL(base)
const PORT = Number(U.port) || 80
const HOST = U.hostname
const NORMAL_HOST = HOST + ':' + PORT

const results = []
const check = (label, ok, detail) => {
  results.push({ label, ok: ok === true, detail: String(detail) })
  console.log((ok === true ? 'PASS  ' : 'FAIL  ') + label + '  ' + detail)
}

/** 真发一个请求：headers 原样发出（可伪造 Host / Origin / Sec-Fetch-Site）。 */
const req = (method, path, { headers = {}, body = null } = {}) => new Promise((resolve) => {
  const h = Object.assign({ Host: NORMAL_HOST }, headers)
  if (body !== null) h['Content-Length'] = Buffer.byteLength(body)
  const r = http.request({ host: HOST, port: PORT, method, path, headers: h, timeout: 20000 }, (res) => {
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }))
  })
  r.on('timeout', () => { r.destroy(new Error('timeout')) })
  r.on('error', (e) => resolve({ status: 0, text: 'REQ ' + e.message }))
  if (body !== null) r.write(body)
  r.end()
})

const json = (t) => { try { return JSON.parse(t) } catch { return null } }

console.log('===== dsh-wyymusic 同源守卫探针（真内核 ' + base + '）=====')

// 1) 正常 Host 放行
{
  const r = await req('GET', '/wyymusic/api/status')
  const j = json(r.text)
  check('1. 正常 Host 的 GET 放行', r.status === 200 && j !== null && j.ok === true, 'HTTP ' + r.status + ' ' + (j ? 'ok=' + j.ok : (r.text || '').slice(0, 60)))
}

// 2) DNS rebinding：Host 是攻击者域名 → 403
{
  const r = await req('GET', '/wyymusic/api/status', { headers: { Host: 'evil.example:' + PORT } })
  const j = json(r.text)
  check('2. 伪造 Host（DNS rebinding）被拒', r.status === 403 && j !== null && j.ok === false, 'HTTP ' + r.status + ' ' + (r.text || '').slice(0, 80))
}

// 3) 跨站 Origin 的写操作 → 403
{
  const body = JSON.stringify({ lang: 'zh' })
  const r = await req('POST', '/wyymusic/api/prefs', {
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    body,
  })
  check('3. 跨站 Origin 的 POST 被拒', r.status === 403, 'HTTP ' + r.status + ' ' + (r.text || '').slice(0, 80))
}

// 4) 同源 Origin 的写操作 → 放行（不能被误伤）
{
  const body = JSON.stringify({ lang: 'zh' })
  const r = await req('POST', '/wyymusic/api/prefs', {
    headers: { Origin: base, 'Content-Type': 'application/json' },
    body,
  })
  const j = json(r.text)
  check('4. 同源 Origin 的 POST 放行', r.status === 200 && j !== null && j.ok === true, 'HTTP ' + r.status + ' ' + (r.text || '').slice(0, 80))
}

// 5) 浏览器明说 cross-site（哪怕没有 Origin）→ 403
{
  const body = JSON.stringify({ lang: 'zh' })
  const r = await req('POST', '/wyymusic/api/prefs', {
    headers: { 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'application/json' },
    body,
  })
  check('5. Sec-Fetch-Site: cross-site 被拒', r.status === 403, 'HTTP ' + r.status + ' ' + (r.text || '').slice(0, 80))
}

// 6) 非浏览器客户端（无 Origin / 无 Sec-Fetch-Site）→ 放行（curl 用法不能被破坏）
{
  const body = JSON.stringify({ lang: 'zh' })
  const r = await req('POST', '/wyymusic/api/prefs', { headers: { 'Content-Type': 'application/json' }, body })
  const j = json(r.text)
  check('6. 无 Origin 的非浏览器 POST 放行', r.status === 200 && j !== null && j.ok === true, 'HTTP ' + r.status)
}

// 7) 超大 body → 413
{
  const big = JSON.stringify({ lang: 'zh', pad: 'x'.repeat(80 * 1024) })
  const r = await req('POST', '/wyymusic/api/prefs', { headers: { 'Content-Type': 'application/json' }, body: big })
  check('7. 80 KiB body 被拒（413）', r.status === 413, 'HTTP ' + r.status + ' ' + (r.text || '').slice(0, 80))
}

// 8) 正常大小的 body 仍能写（上一条的对照组）
{
  const body = JSON.stringify({ lang: 'zh' })
  const r = await req('POST', '/wyymusic/api/prefs', { headers: { 'Content-Type': 'application/json' }, body })
  check('8. 正常大小 body 仍可写（413 未误伤）', r.status === 200, 'HTTP ' + r.status)
}

const fails = results.filter((x) => !x.ok)
console.log('\n合计：' + (results.length - fails.length) + '/' + results.length + ' PASS')
if (fails.length > 0) {
  console.log('--- 非 PASS 项 ---')
  for (const f of fails) console.log('  [' + 'FAIL' + '] ' + f.label + ' | ' + f.detail)
}
process.exit(fails.length === 0 ? 0 : 1)
