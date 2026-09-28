/* 抓真实网易云数据喂给设计原型：推荐歌单 / 我的歌单 / 榜单 / 一个歌单的曲目 / 一首歌的歌词 */
import fs from 'node:fs'

const B = 'http://127.0.0.1:55822/wyymusic/api'
const g = async (p) => {
  const r = await fetch(B + p)
  const j = await r.json()
  if (j.ok === false) throw new Error(p + ' -> ' + j.error)
  return j
}
const pickPl = (x) => ({ id: x.id, name: x.name, cover: x.cover, playCount: x.playCount || 0, creator: (x.creator && (x.creator.userName || x.creator.name)) || x.subscribedCount || '' })

const rec = await g('/recommend')
const mine = await g('/myplaylists')
const tops = await g('/toplists')
const topList = (tops.groups || []).flatMap((gr) => (gr.toplists || []).map((t) => Object.assign({ group: gr.name }, t))).slice(0, 8)

// 取三个歌单的曲目（头部渐变与卡片需要真实封面色）
const plIds = (rec.playlists || []).slice(0, 8).map((p) => p.id)
const details = {}
for (const id of plIds.slice(0, 3)) {
  const d = await g('/playlist?id=' + id)
  const pl = d.playlist || {}
  details[id] = {
    name: pl.name || '', cover: pl.cover || '', trackCount: pl.trackCount || 0,
    playCount: pl.playCount || 0, description: String(pl.description || '').slice(0, 160),
    songs: (pl.songs || []).slice(0, 8).map((s) => ({ id: s.id, title: s.title, artists: s.artists, album: s.album, interval: s.interval, cover: s.cover })),
  }
}
// 榜单前几首
const topSongs = {}
for (const t of topList.slice(0, 3)) {
  const d = await g('/playlist?id=' + t.id)
  const pl = d.playlist || {}
  topSongs[t.id] = (pl.songs || []).slice(0, 6).map((s) => ({ id: s.id, title: s.title, artists: s.artists, cover: s.cover, interval: s.interval }))
}
// 挑一首真正有歌词的（纯音乐/占位词不要）
const cands = []
for (const id of Object.keys(details)) cands.push(...details[id].songs)
for (const t of topList.slice(0, 3)) cands.push(...(topSongs[t.id] || []))
let lyric = { ok: false }, lyricSong = null
for (const s of cands.slice(0, 10)) {
  const l = await g('/lyric?id=' + s.id)
  const text = String(l.lyric || '')
  if (text.length > 300) { lyric = l; lyricSong = s; break }
}

// 原型只保留歌词的「结构」（行数 / 每行字数 / 时间戳），不落地受版权保护的歌词正文。
// 排版验证用自写占位文案按同样的字数分布填充；运行时歌词仍走插件自己的接口。
function parseLrcText(text) {
  const out = []
  for (const raw of String(text || '').split(/\r?\n/)) {
    const m = raw.match(/^\[(\d+):(\d+(?:[.:]\d+)?)\]\s*(.*)$/)
    if (!m) continue
    const t = Number(m[1]) * 60 + Number(m[2].replace(':', '.'))
    const line = m[3].trim()
    if (line) out.push({ t, text: line })
  }
  return out
}

const out = {
  fetchedAt: new Date().toISOString(),
  // 不落地账号昵称（个人数据），原型用固定占位文案
  account: mine.nickname ? '已登录' : '未登录',
  recommend: (rec.playlists || []).slice(0, 12).map(pickPl),
  mine: (mine.playlists || []).slice(0, 10).map(pickPl),
  toplists: topList.map((t) => ({ id: t.id, name: t.name, cover: t.cover, songs: topSongs[t.id] || [] })),
  details,
  lyric: (() => {
    const lrcLines = parseLrcText(lyric.lyric)
    return {
      song: lyricSong ? { id: lyricSong.id, title: lyricSong.title, artists: lyricSong.artists, album: lyricSong.album, cover: lyricSong.cover, interval: lyricSong.interval } : null,
      count: lrcLines.length,
      chars: lrcLines.slice(0, 32).map((l) => l.text.length),
      times: lrcLines.slice(0, 32).map((l) => Math.round(l.t * 10) / 10),
      hasTrans: !!lyric.trans,
      hasRoma: !!lyric.roma,
      wordLevel: !!lyric.wordLevel,
    }
  })(),
}
fs.writeFileSync('C:/Users/delinger/Desktop/dsh-wyymusic/design/proto-data.json', JSON.stringify(out, null, 1))
console.log('recommend:', out.recommend.length, '| mine:', out.mine.length, '| toplists:', out.toplists.length,
  '| details:', Object.keys(details).join(','), '| lyric lines:', out.lyric.count, '| song:', lyricSong && lyricSong.title)
console.log('sample cover:', out.recommend[0].cover)
