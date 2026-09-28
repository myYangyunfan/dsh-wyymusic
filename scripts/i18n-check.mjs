#!/usr/bin/env node
// i18n 静态守卫。跑法：node scripts/i18n-check.mjs [lib/client.js]
//
// 立这条守卫的理由：切换语言时最容易出的两类事故都"跑得起来"——
//   A) 新加的 UI 忘了进表，中文写死在组件里 → 英文档下漏一个中文，得靠肉眼在截图里找；
//   B) t('xxx') 手抖打错 key → 页面上一片书名号（t() 故意回显 «key» 而不是空白）。
// 所以这里只认三件事：表本身完整、表外没中文、引用的 key 都在表里。
import { readFileSync } from 'node:fs'

const FILE = process.argv[2] || new URL('../lib/client.js', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
const src = readFileSync(FILE, 'utf8')
const fails = []
const CJK = /[\u4e00-\u9fff]/

// ---- 1. 把 STR 表原样切出来（带深度的扫描，不靠正则猜括号）----
const MARK = 'const STR = {'
const open = src.indexOf(MARK)
if (open < 0) { console.error('FAIL: 找不到 const STR = { —— 表被改名了？'); process.exit(1) }
let depth = 0, tblEnd = -1, tq = null
for (let i = open + MARK.length - 1; i < src.length; i++) {
  const c = src[i]
  if (tq) { if (c === tq && src[i - 1] !== '\\') tq = null; continue }
  if (c === "'" || c === '"' || c === '`') { tq = c; continue }
  if (c === '{' || c === '[' || c === '(') depth++
  else if (c === '}' || c === ']' || c === ')') { depth--; if (depth === 0) { tblEnd = i; break } }
}
if (tblEnd < 0) { console.error('FAIL: STR 表的括号没闭合'); process.exit(1) }
const tableSrc = src.slice(open + MARK.length, tblEnd)
// 表外 = 全文去掉这一段（api() 里的 t('eParse') 在表前面，只扫表后就会漏掉它）
const outside = src.slice(0, open + MARK.length) + src.slice(tblEnd)

// ---- 2. 逐条目解析：顶层逗号切分，条目内按引号态拆两列 ----
const chunks = []
let cur = '', d = 0, q = null
for (let i = 0; i < tableSrc.length; i++) {
  const c = tableSrc[i]
  if (q) { cur += c; if (c === q && tableSrc[i - 1] !== '\\') q = null; continue }
  if (c === "'" || c === '"' || c === '`') { q = c; cur += c; continue }
  if (c === '{' || c === '[' || c === '(') d++
  else if (c === '}' || c === ']' || c === ')') d--
  if (c === ',' && d === 0) { chunks.push(cur); cur = ''; continue }
  cur += c
}
if (cur.trim() !== '') chunks.push(cur)
if (chunks.length === 0) { console.error('FAIL: STR 表解析出 0 条 —— 解析器挂了不等于没问题'); process.exit(1) }

const table = new Map()
for (const raw of chunks) {
  const km = raw.match(/(\w+)\s*:\s*\[([\s\S]*)\]/)
  if (km === null) { const s = raw.replace(/\/\/[^\n]*/g, '').trim(); if (s !== '') fails.push('条目解析失败：' + s.slice(0, 40)); continue }
  const key = km[1]
  if (table.has(key)) fails.push('key 重复：' + key)
  const cols = []
  let cell = '', cq = null
  for (let i = 0; i < km[2].length; i++) {
    const c = km[2][i]
    if (cq) { if (c === cq && km[2][i - 1] !== '\\') cq = null; cell += c; continue }
    if (c === "'" || c === '"') { cq = c; cell += c; continue }
    if (c === ',') { cols.push(cell); cell = ''; continue }
    cell += c
  }
  if (cell.trim() !== '') cols.push(cell)
  const val = cols.map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
  if (val.length !== 2) { fails.push(`${key}: 期望 2 列，实际 ${val.length} 列`); continue }
  if (val.some((v) => v === '')) { fails.push(`${key}: 有空列`); continue }
  // 第一列必须是中文（防列序写反）。两列完全相同的条目是"哪种语言都长这样"的记号（按钮上的 EN），豁免。
  if (!CJK.test(val[0]) && val[0] !== val[1]) fails.push(`${key}: 第一列不是中文（列序写反了？）`)
  table.set(key, val)
}

// ---- 3. 表外不许有中文字面量（注释剥掉再找）----
// 登记规则：只登记**不可能出现在英文档里**的中文字面量，且逐字匹配。
// 「亿/万」是 fmtCount 的中文档单位后缀：函数在开头 `ui.lang === 'en'` 时就走 B/M/K 分支返回了，
// 这两行在英文档物理上到不了。改动时把空格一并写进了字面量（原型约定"数字与单位间留一个空格"），
// 所以要三个形式都登记 —— 守卫是精确匹配，不是为了宽松才漏。
const ALLOW = new Set(['亿', '万', ' 亿', ' 万', '网易云音乐'])
// 搜索关键词是**查询数据**，不是文案：英文档下把「晚安」翻成 Good night，搜出来的就是
// 另一批歌了 —— 用户要的是"这个词在网易云里的结果"，所以它们必须留在表外。
// 精确登记、逐字匹配，没登记的中文字面量照样判红（新增一个就红一条）。
const ALLOW_DATA = new Set(['晚安', 'Lo-Fi', '通勤', '民谣', '钢琴', '现场'])
let inBlock = false, inLine = false, sq = null
const clean = []
for (let i = 0; i < outside.length; i++) {
  const c = outside[i], n = outside[i + 1]
  if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++ }; clean.push(c === '\n' ? '\n' : ' '); continue }
  if (inLine) { if (c === '\n') inLine = false; clean.push(' '); continue }
  if (sq) { if (c === sq && outside[i - 1] !== '\\') sq = null; clean.push(c); continue }
  if (c === '/' && n === '*') { inBlock = true; i++; clean.push(' '); continue }
  if (c === '/' && n === '/') { inLine = true; clean.push(' '); continue }
  if (c === "'" || c === '"' || c === '`') { sq = c; clean.push(c); continue }
  clean.push(c)
}
const joined = clean.join('')
const stray = []
const lineOf = (idx) => joined.slice(0, idx).split('\n').length
const litRe = /'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`/g
let lm
while ((lm = litRe.exec(joined))) {
  const v = lm[1] ?? lm[2] ?? lm[3]
  if (CJK.test(v) && !ALLOW.has(v) && !ALLOW_DATA.has(v)) stray.push(lineOf(lm.index) + ": '" + v + "'")
}
for (const s of stray) fails.push('表外硬编码中文（英文档会漏出来）：' + s)

// ---- 4. 引用的 key 必须在表里 ----
const used = new Set()
const useRe = /\btf?\(\s*'(\w+)'/g
let u
while ((u = useRe.exec(outside))) used.add(u[1])
for (const k of used) if (!table.has(k)) fails.push(`引用了不存在的 key：t('${k}')`)

// 有的 key 是"存起来晚点再 t()"的（NAV/TYPES/QUALITY_KEY 都只放字符串），
// 按裸字面量出现也算引用 —— 否则守不了真、还全是噪音。
const deferred = new Set()
for (const k of table.keys()) {
  if (used.has(k)) continue
  if (new RegExp("['\"]" + k + "['\"]").test(outside)) deferred.add(k)
}
const unused = [...table.keys()].filter((k) => !used.has(k) && !deferred.has(k))

// ---- 5. 英文列不许混中文 —— 除了"就该用对方文字来称呼那门语言"的三条 ----
const EN_CJK_OK = new Set(['langNextZh', 'langNextEn', 'langTip'])
for (const [k, v] of table) if (CJK.test(v[1]) && !EN_CJK_OK.has(k)) fails.push(`${k}: 英文列里混进了中文`)

// ---- 6. 不许再有第二个叫 t 的绑定 ----
// 这不是洁癖，是实测出来的坑：翻译函数叫 t()，而音乐面板里 t 天生表示"当前秒数"，
// 局部 const t = useSmoothTime(...) 会把同作用域的 t() 遮蔽掉，全屏歌词一开就
// "t is not a function" 整个槽位崩溃。读代码看不出来，只有跑起来才知道 —— 所以钉死在静态里。
const TRANSLATOR = 'const t = (k) =>'
const declT = [...src.matchAll(/(?:const|let|var)\s+t\s*=\s*([^\n]*)/g)]
for (const m of declT) {
  const line = src.slice(0, m.index).split('\n').length
  const full = src.slice(m.index, m.index + TRANSLATOR.length)
  if (full !== TRANSLATOR) fails.push(`第 ${line} 行又绑了一个 t（会遮蔽 t() 翻译函数）：${m[0].slice(0, 46)}`)
}
const bareT = (params) => params.split(',').map((p) => p.trim().replace(/=.*$/, '').trim())
  .some((p) => p === 't' || p.startsWith('t:') || p === '{ t' || /^\{\s*t\s*[,}]/.test(p))
for (const m of src.matchAll(/function\s+\w+\s*\(([^)]*)\)/g)) {
  if (bareT(m[1])) fails.push('函数参数里占了 t：' + m[0].slice(0, 60))
}
for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g)) {
  if (bareT(m[1])) fails.push('箭头函数参数里占了 t：(' + m[1].slice(0, 50) + ') =>')
}

// ---- 7. 会取文案的包装函数，必须有调用点 ----
// 实测踩到的：pass-2 加了 QUALITY_KEY + qualityLabel()，也把 qLossless 记成"间接引用"，
// 于是静态全绿；可播放条那一格仍写着旧的 `take.quality || take.level`，qualityLabel 从没被调过。
// 结果英文档下音质徽标一路显示「无损」。第 4 节的 deferred 规则恰恰放过了这种"表项被引用、
// 但引用它的函数是死代码"的形状 —— 所以补这一条：只要函数体里出现 t()/tf()，它自己就得有人叫。
const bodyAt = (openIdx) => {
  let bd = 0, bq = null
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i]
    if (bq) { if (c === bq && src[i - 1] !== '\\') bq = null; continue }
    if (c === "'" || c === '"' || c === '`') { bq = c; continue }
    if (c === '{') bd++
    else if (c === '}') { bd--; if (bd === 0) return src.slice(openIdx, i + 1) }
  }
  return ''
}
// 块体和表达式体都得查：只认 `{` 那种的话，`const label = (x) => t('k')` 这种死代码就漏了，
// 而它和块体版本是同一个 bug。
const defRe = /const\s+(\w+)\s*=\s*\(([^)]*)\)\s*=>\s*/g
let dm
while ((dm = defRe.exec(src))) {
  const name = dm[1]
  if (name === 't') continue // 翻译函数本体，由第 4 节按 t('key') 的使用情况管
  const rest = src.slice(defRe.lastIndex)
  const body = /^\s*\{/.test(rest) ? bodyAt(defRe.lastIndex + rest.match(/^\s*/) [0].length)
    : rest.split('\n')[0]
  if (!/\btf?\s*\(/.test(body)) continue
  // 定义式是 `const NAME = (args) =>`，NAME 与 ( 之间隔着等号，这个正则匹配不到它，所以不用减定义那次。
  const calls = [...src.matchAll(new RegExp('\\b' + name + '\\s*\\(', 'g'))].length
  if (calls === 0) {
    const line = src.slice(0, dm.index).split('\n').length
    fails.push(`第 ${line} 行定义了会取文案的 ${name}()，但全文没有一处调用它（= 这条翻译是死代码）`)
  }
}

console.log(`STR 条目 ${table.size}，直接引用 ${used.size}，间接引用 ${deferred.size}，表外中文字面量 ${stray.length}`)
if (unused.length) console.log('（提示）表里有但没人用：' + unused.join(', '))
if (fails.length) {
  console.error('\nFAIL ' + fails.length + ' 项：')
  for (const f of fails.slice(0, 40)) console.error('  · ' + f)
  process.exit(1)
}
console.log('OK 通过')
