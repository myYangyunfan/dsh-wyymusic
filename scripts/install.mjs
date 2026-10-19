#!/usr/bin/env node
/**
 * scripts/install.mjs — 把本仓库装进一个 DSH profile（本机安装器）。
 *
 * 为什么需要它：DSH 0.2.1-rc.2 的 profile 是 pnpm(hoisted) 管理的一棵依赖树，
 * 并靠 package.json 的 dsh.profile.bundles 决定加载哪些 bundle。手工挂载要同时改
 * 三处（dependencies / bundles / node_modules 链接），漏一处就是「重启后入口不见了」。
 * 这个脚本把三处一次改对，并且可重复跑（幂等）、可回滚（--uninstall）。
 *
 * 用法：
 *   node scripts/install.mjs                  # 装进 $DSH_HOME/profiles/$DSH_PROFILE（默认 desktop）
 *   node scripts/install.mjs --profile web    # 指定 profile
 *   node scripts/install.mjs --home D:/tmp/dshhome
 *   node scripts/install.mjs --dry-run        # 只打印将要做的改动
 *   node scripts/install.mjs --uninstall      # 反安装（拆链接、去掉依赖与 bundle 条目）
 *
 * 注意：本脚本**不跑 pnpm**。它直接写 package.json + 建 junction/symlink，
 * 因此不会动 profile 里其它包，也不会因为 registry/网络问题失败。
 * 代价是 pnpm 的 lockfile 不记录本包 —— 下次在插件页装/卸别的插件时，
 * pnpm 可能把不在依赖图里的 node_modules 条目清掉；dependencies 里已写好
 * link: 条目，重跑本脚本即可恢复（也可用插件页直接装同一路径）。
 */
import { existsSync, lstatSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir, platform } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const PKG = 'dsh-wyymusic'
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WIN = platform() === 'win32'

const args = process.argv.slice(2)
const flag = (name) => args.includes('--' + name)
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}

const HOME = resolve(opt('home', process.env.DSH_HOME || join(homedir(), '.dsh')))
const PROFILE = opt('profile', process.env.DSH_PROFILE || 'desktop')
const DIR = join(HOME, 'profiles', PROFILE)
const MANIFEST = join(DIR, 'package.json')
const MODULES = join(DIR, 'node_modules')
const LINK = join(MODULES, PKG)
const DRY = flag('dry-run')
const UNINSTALL = flag('uninstall')

const say = (s) => console.log(s)
const die = (s) => { console.error('install: ' + s); process.exit(1) }

// ---- 前置检查 ----
const repoPkgPath = join(REPO, 'package.json')
if (!existsSync(repoPkgPath)) die('仓库根没有 package.json（要在 dsh-wyymusic 仓库里跑）')
const repoPkg = JSON.parse(readFileSync(repoPkgPath, 'utf8'))
if (repoPkg.name !== PKG) die('package.json 的 name 不是 ' + PKG)
if (!existsSync(join(REPO, 'lib', 'index.js'))) die('缺 lib/index.js —— 这不是完整包')
const patch = repoPkg.dsh?.bundle?.patch
if (patch === undefined) die('package.json 缺 dsh.bundle.patch，内核不会把它当 bundle 加载')
for (const f of [].concat(patch)) if (!existsSync(join(REPO, f))) die('dsh.bundle.patch 指向的文件不存在：' + f)

if (!existsSync(MANIFEST)) die('找不到 profile 清单：' + MANIFEST + '\n先启动一次 DeepSeek Harness（它会初始化 profile），或用 --home/--profile 指对位置')

const read = () => JSON.parse(readFileSync(MANIFEST, 'utf8').replace(/^\uFEFF/, ''))
const manifest = read()
say('profile  = ' + DIR)
say('repo     = ' + REPO)
say('版本     = ' + repoPkg.version)

/** 判断现有 node_modules/<pkg> 是什么：link(junction/symlink) | dir(真实目录) | none */
function linkState() {
  // 用 lstat 而不是 existsSync：仓库搬走后 junction 是「悬空」的，
  // existsSync 会跟着链接返回 false，于是误判成"没有"、mklink 又因条目已存在而失败。
  try {
    return lstatSync(LINK).isSymbolicLink() ? 'link' : 'dir'
  } catch {
    return 'none'
  }
}

/** 拆掉 junction/symlink。Windows 上对 junction 用 rmdir 才只删链接、不递归删目标。 */
function unlinkExisting() {
  const state = linkState()
  if (state === 'none') return false
  if (state === 'dir') {
    // 真实目录（pnpm 拷贝安装或历史残留）：只认「确实是本包」的才动，且整体改名保留证据
    let name = ''
    try { name = JSON.parse(readFileSync(join(LINK, 'package.json'), 'utf8')).name } catch { /* 不是包 */ }
    if (name !== PKG) die(LINK + ' 是个真实目录且不像是 ' + PKG + '，拒绝动它；请手工确认后重跑')
    if (DRY) { say('[dry-run] 会把真实目录改名保留：' + LINK + '.bak-<ts>'); return true }
    const bak = LINK + '.bak-' + Date.now()
    renameSync(LINK, bak)
    say('已把旧的拷贝安装改名保留：' + bak)
    return true
  }
  if (DRY) { say('[dry-run] 会拆掉旧链接 ' + LINK); return true }
  if (WIN) execFileSync('cmd', ['/c', 'rmdir', LINK], { stdio: 'ignore' })
  else execFileSync('rm', ['-f', LINK], { stdio: 'ignore' })
  say('已拆掉旧链接 ' + LINK)
  return true
}

function makeLink() {
  if (DRY) { say('[dry-run] 会建链接 ' + LINK + ' -> ' + REPO); return }
  mkdirSync(MODULES, { recursive: true })
  if (WIN) execFileSync('cmd', ['/c', 'mklink', '/J', LINK, REPO], { stdio: 'ignore' })
  else execFileSync('ln', ['-sfn', REPO, LINK], { stdio: 'ignore' })
  say('已建链接 ' + LINK + ' -> ' + REPO)
}

function writeManifest(next) {
  if (DRY) { say('[dry-run] 会写 ' + MANIFEST); return }
  const bak = MANIFEST + '.bak-' + Date.now()
  writeFileSync(bak, readFileSync(MANIFEST, 'utf8'))
  writeFileSync(MANIFEST, JSON.stringify(next, null, 2) + '\n', 'utf8')
  say('已更新 profile 清单（备份 ' + bak + '）')
}

if (UNINSTALL) {
  unlinkExisting()
  const next = read()
  if (next.dependencies !== undefined) delete next.dependencies[PKG]
  if (Array.isArray(next.dsh?.profile?.bundles)) {
    next.dsh.profile.bundles = next.dsh.profile.bundles.filter((n) => n !== PKG)
  }
  writeManifest(next)
  say('\n已反安装。重启 DeepSeek Harness 后侧栏入口消失。')
  process.exit(0)
}

// ---- 安装 ----
const next = JSON.parse(JSON.stringify(manifest))
next.dependencies = next.dependencies || {}
next.dependencies[PKG] = 'link:' + REPO.split("\\").join('/')
next.dsh = next.dsh || {}
next.dsh.profile = next.dsh.profile || {}
const bundles = Array.isArray(next.dsh.profile.bundles) ? next.dsh.profile.bundles.slice() : []
if (!bundles.includes(PKG)) bundles.push(PKG)
next.dsh.profile.bundles = bundles

// 先拆再建：旧链接指向别处（比如仓库搬走后的死链）时必须换掉
unlinkExisting()
makeLink()
writeManifest(next)

say('')
say('bundle 列表：' + bundles.join(', '))
say('')
say('完成。⚠️ 必须重启 DeepSeek Harness（不是刷新页面）：bundle 列表与页内注入清单只在宿主启动时读一次。')
