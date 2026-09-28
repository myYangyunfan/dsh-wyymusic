#!/usr/bin/env node
// i18n-check 的反证：亲手植入各种会漏的样子，守卫必须每一种都报红。
// 为什么要有这个文件：静态检查最容易"永远绿" —— 解析器一挂就退回 0 条目、
// 表外扫描漏剥注释就什么都找不到。所以这里断言的是"它能抓到"，不是"它没话可说"。
// 跑法：node scripts/i18n-check.proof.mjs
//
// 维护须知：这里的锚点是**源文本精确匹配**（改了 client.js 的那一行，这条反证就会"植入失败"）。
// 实测踩过：ToplistCard/recSub 被重构掉之后，4 条反证的锚点全部失配，
// 输出是"植入失败：源文本没匹配上"，脚本 exit=1 —— 那是**红得正确**（反证没测到东西就不算数），
// 但别把它当成产品缺陷去修 client.js：改的是这里的锚点。
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const DIR = fileURLToPath(new URL('.', import.meta.url))
const CHECK = DIR + 'i18n-check.mjs'
const SRC = readFileSync(DIR + '../lib/client.js', 'utf8')

const cases = [
  {
    name: '新组件把中文写死在 JSX 里（表外硬编码）',
    patch: (s) => s.replace(`title: t('mineTitle'),`,
      `title: '我的音乐标题',`),
    want: '表外硬编码中文',
  },
  {
    name: 't() 打错 key（页面会显示 «xxx»）',
    patch: (s) => s.replace(`t('mineTitle')`, `t('mineTitleX')`),
    want: "引用了不存在的 key：t('mineTitleX')",
  },
  {
    name: '某条只写了一列（漏翻译）',
    patch: (s) => s.replace(`      mineTitle: ['我的音乐', 'Your music'],`, `      mineTitle: ['我的音乐'],`),
    want: 'mineTitle: 期望 2 列，实际 1 列',
  },
  {
    name: '英文列留空',
    patch: (s) => s.replace(`      mineTitle: ['我的音乐', 'Your music'],`, `      mineTitle: ['我的音乐', ''],`),
    want: 'mineTitle: 有空列',
  },
  {
    // 登记表是全等匹配：差一个空格也必须红，否则"登记"会退化成"包含就算过"。
    name: '中文单位后缀的字面量多一个空格（登记表不是前缀匹配）',
    patch: (s) => s.replace(`return (v / 100000000).toFixed(1) + ' 亿'`, `return (v / 100000000).toFixed(1) + ' 亿 '`),
    want: '表外硬编码中文',
  },
  {
    name: '整张表被改名（解析器不能装死）',
    patch: (s) => s.replace('const STR = {', 'const TEXTS = {'),
    want: '找不到 const STR',
  },
  {
    name: '又绑了一个局部 t，把同作用域的 t() 遮蔽掉（实测崩过全屏歌词）',
    patch: (s) => s.replace('      const now = useSmoothTime(playing && song !== null)',
      '      const t = useSmoothTime(playing && song !== null)'),
    want: '又绑了一个 t',
  },
  {
    name: '函数参数占了 t',
    patch: (s) => s.replace('    function PlaylistGrid({ items, onOpen, onPlayItem, source, playing, empty }) {',
      '    function PlaylistGrid({ t, items, onOpen, onPlayItem, source, playing, empty }) {'),
    want: '函数参数里占了 t',
  },
  {
    // 这一条不是我编的：pass-2 真的就是这么漏的。QUALITY_KEY + qualityLabel() 都写好了，
    // qLossless 也被 deferred 规则算成"已引用"，静态全绿；可播放条还留着旧的
    // `take.quality || take.level`，于是英文档音质徽标一路显示「无损」。
    name: '会取文案的包装函数没人调用（块体，实测漏掉的那条）',
    patch: (s) => s.replace('const quality = qualityLabel(s.take)',
      "const quality = s.take && s.take.ok ? (s.take.quality || s.take.level || '') : ''"),
    want: 'qualityLabel()，但全文没有一处调用它',
  },
  {
    name: '同上，但包装函数写成表达式体（换个写法不能就躲过去）',
    patch: (s) => s
      .replace('const quality = qualityLabel(s.take)', "const quality = ''")
      .replace(
        /const qualityLabel = \(take\) => \{[\s\S]*?\n    \}/,
        "const qualityLabel = (take) => (take && take.ok ? t('qLossless') : '')"),
    want: 'qualityLabel()，但全文没有一处调用它',
  },
]

const run = (file) => {
  const r = spawnSync(process.execPath, [CHECK, file], { encoding: 'utf8' })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const tmp = tmpdir() + '/wyy-i18n-proof.js'
let bad = 0
console.log('正对照（未改动的 client.js）：')
const base = run(DIR + '../lib/client.js')
if (base.code !== 0) { console.log('  ✗ 基线就不绿，后面的"抓到"也没有参照物\n' + base.out); process.exit(1) }
console.log('  ✓ ' + base.out.trim().split('\n').pop())

for (const c of cases) {
  const mutated = c.patch(SRC)
  if (mutated === SRC) { console.log(`\n[${c.name}]\n  ✗ 植入失败：源文本没匹配上（这条反证什么都没测到）`); bad++; continue }
  writeFileSync(tmp, mutated)
  const r = run(tmp)
  rmSync(tmp, { force: true })
  const caught = r.code !== 0 && r.out.includes(c.want)
  console.log(`\n[${c.name}] exit=${r.code} => ${caught ? '✓ 被抓' : '✗ 没抓到'}`)
  if (!caught) { bad++; console.log('  期望报错包含：' + c.want); console.log('  实际输出：' + r.out.trim().split('\n').slice(-6).join('\n        ')) }
}
if (bad > 0) { console.error('\nFAIL: ' + bad + ' 条反证没通过 —— 守卫是假绿的'); process.exit(1) }
console.log('\nOK 反证 ' + cases.length + '/' + cases.length + ' 全部被抓')
