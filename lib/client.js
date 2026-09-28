/**
 * lib/client.js — dsh-wyymusic 浏览器半边（DSH 客户端插件，经典脚本，走 __ModuleLoader__）。
 *
 * 两个扩展点（与官方 dsh-client-ui-plugin-manager 同款）：
 *   1. `sidebar.panellist`（root / list）—— 侧栏全局面板图标。order=-1 排在「插件」(=0) 之上。
 *      列表 id 与 `main` 的 key 同名（wyymusic），侧栏点图标即 ctx.layout.selectPanel('wyymusic')。
 *   2. `main`（root / keyed）—— 全屏接管主区域的面板内容。
 *
 * 关键设计：<audio> 与播放状态放在**模块作用域**，不进 React 树。DSH 切换面板时
 * 会卸载面板组件，若把 <audio> 挂在组件里，切回对话界面音乐就断了。因此这里自己
 * 建单例 audio 元素挂到 body，React 只订阅它的状态。
 *
 * 界面：Spotify 式交互（顶栏药丸搜索 / 图标侧栏 / 悬停浮出圆形播放键的卡片 /
 * 三区播放条 / 全屏 Now Playing 大屏歌词）。配色浅色走网易云（白底 + 品牌红），
 * 暗色抄 Spotify 色阶（#121212/#181818/#242424，次级文字 #b3b3b3），强调色仍是网易红。
 * 暗色钩子用宿主自己的 `body[data-ds-dark-theme]`（见 dsh-client-ui-theme 的 boot 脚本）。
 *
 * 数据一律经宿主半边的同源路由 /wyymusic/*（浏览器直连网易云会被 CORS 挡且缺 cookie）。
 *
 * ⚠️ 合规：非官方接口 + 流播受版权保护音乐，仅个人试听/学习，风险自担；严禁解灰。
 */

window.__ModuleLoader__.load({
  id: 'dsh-wyymusic',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { useState, useEffect, useLayoutEffect, useRef, useCallback } = React

    const PANEL_ID = 'wyymusic'
    const API = '/wyymusic/api'

    // =================================================================
    // 工具
    // =================================================================

    async function api(path, opts) {
      const res = await fetch(API + path, opts)
      let j = null
      try { j = await res.json() } catch { /* 非 JSON */ }
      if (j === null) throw new Error(tf('eParse', { n: res.status }))
      if (j.ok === false) {
        const err = new Error(j.error || t('eReq'))
        err.needLogin = j.needLogin === true
        throw err
      }
      return j
    }

    // =================================================================
    // 文案层：界面语言（简体 / English）
    // =================================================================

    // 一张表两列 [中文, English]。少一列会被 scripts/i18n-check.mjs 在静态检查里判红 ——
    // 漏翻译不该等肉眼在截图里发现。歌单名、曲名、歌词是网易云返回的数据，不进这张表。
    const STR = {
      loading: ['加载中…', 'Loading…'],
      back: ['返回', 'Back'],
      close: ['关闭', 'Close'],
      play: ['播放', 'Play'],
      pause: ['暂停', 'Pause'],
      playName: ['播放 {x}', 'Play {x}'],
      prev: ['上一首', 'Previous'],
      next: ['下一首', 'Next'],
      playAll: ['播放全部', 'Play all'],
      nowPlaying: ['正在播放', 'Now playing'],
      notPlaying: ['未在播放', 'Nothing playing'],
      progress: ['播放进度', 'Playback position'],
      volume: ['音量', 'Volume'],
      shuffle: ['随机播放', 'Shuffle'],
      repeat: ['循环模式', 'Repeat'],
      clear: ['清空', 'Clear'],
      loadMore: ['加载更多', 'Load more'],
      other: ['其他', 'Other'],
      trial: ['试听', 'Preview'],
      plays: ['{n}次播放', '{n} plays'],
      // 色带元信息里的播放量：原型这里是 `fmtPlay(x) + ' 播放'`（没有「次」），
      // 与卡片副信息那行区别开 —— 元信息行是"量级"，卡片那行是"多少次播放"。
      playsBare: ['{n} 播放', '{n} plays'],
      tracks: ['{n} 首', '{n} tracks'],
      totalTracks: ['共 {n} 首', '{n} songs'],
      totalItems: ['共 {n} 个', '{n} results'],
      sortBy: ['排序：{x}', 'Sort: {x}'],
      sortDefault: ['默认', 'Default'],
      sortDur: ['时长', 'Length'],
      sortName: ['名称', 'Name'],
      // 左栏品牌行只有 165px 可用宽（232 栏 - 圆点/间距/内边距）。同字体实测：中文串 126px、
      // 官方全名「DSH · NetEase Cloud Music」204px（会截断）、短名「DSH · NetEase Music」155px。
      // 保留「DSH · 」前缀（原型就是这么排的），英文侧用短名把这一行压进预算内。
      brand: ['DSH · 网易云音乐', 'DSH · NetEase Music'],
      navDiscover: ['发现', 'Discover'],
      navToplist: ['排行榜', 'Charts'],
      navMine: ['我的音乐', 'Your Library'],
      navSearch: ['搜索', 'Search'],
      libTitle: ['我的歌单', 'Playlists'],
      searchPh: ['搜索歌曲 / 歌单 / 歌手', 'Songs / playlists / artists'],
      searching: ['搜索中…', 'Searching…'],
      searchStart: ['输入关键词开始搜索', 'Start typing to search'],
      searchEmpty: ['没有找到结果', 'No results'],
      searchPrefix: ['搜索：', 'Search: '],
      recTitle: ['推荐歌单', 'Recommended'],
      kickerWeek: ['每日推荐 · 为你挑选', 'Daily picks · chosen for you'],
      kickerRank: ['榜单', 'Chart'],
      kickerAccount: ['账号', 'Account'],
      queue: ['队列', 'Queue'],
      playNext: ['下一首播放', 'Play next'],
      emptyQueue: ['队列为空', 'Queue is empty'],
      lyrics: ['歌词', 'Lyrics'],
      // 时段词两侧留空格是原型就有的排印手法：把"白天/夜晚"这个变量从整句里分出来
      madeForDay: ['为 白天 准备', 'Made for daytime'],
      madeForNight: ['为 夜晚 准备', 'Made for night'],
      recent: ['最近播放', 'Recently played'],
      tracksHead: ['曲目', 'Tracks'],
      simiTitle: ['相似歌单', 'Similar playlists'],
      allCharts: ['全部榜单', 'All charts'],
      official: ['网易云官方榜', 'NetEase charts'],
      discSub: ['根据你的口味每日更新', 'Fresh picks for you, updated daily'],
      discSubN: ['本周的心情样本：{n} 次播放', "This week's mood sample: {n} plays"],
      editedBy: ['由网易云编辑推荐', 'Picked by NetEase editors'],
      rankSub: ['根据平台播放与互动数据每小时更新', 'Updated hourly from plays and engagement'],
      mineSub: ['本地与云端收藏，登录后可同步创建的歌单', 'Local and cloud collection — sign in to sync your playlists'],
      notLoggedIn: ['未登录', 'Not signed in'],
      mineCreated: ['创建的歌单', 'Created by you'],
      mineSubscribed: ['订阅的歌单', 'Subscribed'],
      collect: ['收藏', 'Save'],
      collected: ['已收藏', 'Saved'],
      collecting: ['收藏中…', 'Saving…'],
      eCollect: ['收藏失败：{m}', 'Could not save: {m}'],
      plCount: ['{n} 个歌单', '{n} playlists'],
      catTitle: ['分类歌单', 'Browse by genre'],
      emptySongs: ['暂无歌曲', 'No songs here'],
      emptyPl: ['暂无歌单', 'No playlists here'],
      noPl: ['没有歌单', 'Nothing here yet'],
      kickerPl: ['歌单', 'Playlist'],
      playlist: ['歌单', 'Playlist'],
      typeSong: ['单曲', 'Single'],
      typeArtist: ['歌手', 'Artist'],
      typeAlbum: ['专辑', 'Album'],
      typeMv: ['MV', 'MV'],
      typeLyric: ['歌词', 'Lyrics'],
      mineTitle: ['我的音乐', 'Your music'],
      fullscreen: ['全屏播放', 'Full screen'],
      loginToSee: ['登录后可查看「我的歌单」', 'Sign in to see your playlists'],
      loginBtn: ['登录网易云音乐', 'Sign in with NetEase'],
      login: ['登录', 'Sign in'],
      logout: ['退出', 'Sign out'],
      barEmpty: ['从左边挑一首开始', 'Pick a song to start'],
      npEmpty: ['从左边挑一首开始播放', 'Pick a song from the queue to start'],
      npOpen: ['全屏歌词', 'Full-screen lyrics'],
      npCollapse: ['收起（Esc）', 'Collapse (Esc)'],
      npCollapseAria: ['收起全屏歌词', 'Hide full-screen lyrics'],
      lyLoading: ['歌词加载中…', 'Loading lyrics…'],
      lyNone: ['这首歌暂无歌词', 'This song has no lyrics'],
      lySeek: ['跳到这一句', 'Jump to this line'],
      openNp: ['打开全屏歌词', 'Open full-screen lyrics'],
      qStandard: ['标准', 'Standard'],
      qHigh: ['高音质', 'Higher'],
      qLossless: ['无损', 'Lossless'],
      tabQr: ['扫码登录', 'QR sign-in'],
      tabMf: ['导入 musicfox', 'Import musicfox'],
      qrLoading: ['正在获取二维码…', 'Fetching QR code…'],
      qrScan: ['请用网易云音乐 App 扫码', 'Scan it with the NetEase Music app'],
      qrWaiting: ['等待扫码…', 'Waiting for scan…'],
      qrExpired: ['二维码已过期，正在刷新…', 'QR expired, refreshing…'],
      qrRefresh: ['刷新二维码', 'New QR code'],
      qrAlt: ['登录二维码', 'Sign-in QR code'],
      qrPh: ['二维码加载中', 'QR loading'],
      loginOk: ['登录成功', 'Signed in'],
      mfExplain: ['本机 go-musicfox 已登录的话，可直接复用它的登录凭据，免去二次扫码。凭据只从本机文件读取，不会外发。',
        'Reuse the session of a signed-in local go-musicfox so you don’t have to scan again. Read from a local file only — nothing leaves the machine.'],
      mfImport: ['从 musicfox 导入登录态', 'Import from musicfox'],
      importing: ['导入中…', 'Importing…'],
      mfImported: ['已导入 musicfox 登录态', 'musicfox session imported'],
      langTip: ['切换界面语言（简体 / English）', 'Switch interface language (简体中文 / English)'],
      // 按钮上写"切过去是什么语言"，所以这两条两种语言下都长成自己的样子 —— 不翻译才是对的。
      langNextEn: ['EN', 'EN'],
      langNextZh: ['中文', '中文'],
      eParse: ['响应解析失败（HTTP {n}）', 'Bad response (HTTP {n})'],
      eReq: ['请求失败', 'Request failed'],
      eAudio: ['音频加载失败，已跳过', 'Audio failed to load, skipped'],
      eTake: ['取链失败：{m}', 'Could not get the stream: {m}'],
      eNoUrl: ['该歌曲当前无可用播放地址', 'No playable stream for this song right now'],
      eAutoplay: ['浏览器拦截了自动播放，请点击播放按钮', 'Autoplay was blocked — press play'],
      ePlay: ['播放失败：{m}', 'Playback failed: {m}'],
      eEmptyPl: ['这个歌单没有可播放的歌曲', 'This playlist has no playable songs'],
      eOpenPl: ['打开歌单失败：{m}', 'Could not open the playlist: {m}'],
      // 重试用尽还没跳过去：说清"是跳不过去"，而不是让进度自己弹回原处（用户实机复报过这一现象）
      eSeek: ['这首歌暂时跳不过去（音频流还没就绪或不可拖动）', 'Cannot seek in this track yet (stream not ready or not seekable)'],

      // ---- 氛围编程（Ambient）----
      ambTitle: ['音乐氛围', 'Music ambience'],
      ambSub: ['跟随当前歌曲，把氛围铺到对话界面', 'Follows the current track across the chat UI'],
      ambMaster: ['氛围编程模式', 'Ambient coding mode'],
      ambOpen: ['氛围设置', 'Ambience settings'],
      ambBg: ['氛围背景', 'Ambient backdrop'],
      ambBgSub: ['取色跟着歌走，只迁移位置、不变颜色', 'Colours follow the track; only positions drift'],
      ambBar: ['律动条', 'Rhythm bar'],
      ambBarSub: ['对话最下方随音乐跳动的频谱', 'Spectrum dancing at the bottom of the conversation'],
      ambNotes: ['打字音符', 'Typing notes'],
      ambNotesSub: ['打字时在字的右上方蹦出一个小音符', 'A little note pops above each typed character'],
      ambBeat: ['设置点律动', 'Switch beat'],
      ambBeatSub: ['这一页的开关随节拍左右晃动并闪光', 'Switches on this page sway and flash on the beat'],
      ambSpot: ['聚光灯', 'Spotlights'],
      ambSpotSub: ['对话上方左右两盏随节拍摇曳的光（普通页面也亮）', 'Two lights above the conversation, swaying and flashing on the beat'],
      ambSpotPower: ['光强', 'Brightness'],
      ambDiag: ['播放诊断', 'Playback diagnostics'],
      ambStrength: ['强度', 'Intensity'],
      ambSpeed: ['速度', 'Speed'],
      ambHeight: ['高度', 'Height'],
      ambGain: ['灵敏度', 'Sensitivity'],
      ambRate: ['密度', 'Density'],
      ambSize: ['大小', 'Size'],
      ambPower: ['幅度', 'Amount'],
      ambScopeLabel: ['范围', 'Scope'],
      ambScopeConvo: ['对话栏', 'Chat column'],
      ambScopeFrame: ['整个窗口', 'Whole window'],
      ambNeedPlay: ['开一首歌，氛围才会跟着动', 'Play a track to bring the ambience to life'],
      ambNoTap: ['当前环境拿不到音频分析，效果不随节拍', 'Audio analysis unavailable here — effects will not follow the beat'],
    }

    // 语言是模块级状态：面板卸载重挂（切侧栏、开全屏）都不该把用户选的档位弄丢。
    const LANGS = ['zh', 'en']
    const ui = {
      lang: 'zh',
      loaded: false,
      // 最近播放：与宿主 prefs 同源，面板重挂 / 刷新浏览器都还在（发现页第一个区块靠它）
      recent: [],
      subs: new Set(),
      recentSubs: new Set(),
      subscribe(fn) {
        ui.subs.add(fn)
        return () => ui.subs.delete(fn)
      },
      subscribeRecent(fn) {
        ui.recentSubs.add(fn)
        return () => ui.recentSubs.delete(fn)
      },
      apply(l) {
        if (LANGS.indexOf(l) < 0 || ui.lang === l) return
        ui.lang = l
        for (const fn of ui.subs) fn(l)
      },
      applyRecent(list) {
        ui.recent = Array.isArray(list) ? list : []
        for (const fn of ui.recentSubs) fn(ui.recent)
      },
      /** 播放/打开一个歌单就把它推到最前；同 id 去重，最多 8 条。 */
      pushRecent(p) {
        if (!p || !p.id || !p.name) return
        // 播放量与作者跟着一起存：卡片的副信息行是"播放量，没有就作者"（照原型 card()），
        // 只存 id/name/cover 的话最近播放那排卡片永远是空的副信息行。
        const item = { id: String(p.id), name: String(p.name), cover: String(p.cover || '') }
        if (p.playCount) item.playCount = Number(p.playCount) || 0
        if (p.creator) item.creator = String(p.creator)
        const next = [item].concat(ui.recent.filter((x) => x.id !== item.id)).slice(0, 8)
        if (next.length === ui.recent.length && next.every((x, i) => ui.recent[i] && x.id === ui.recent[i].id)) return
        ui.applyRecent(next)
        api('/prefs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ recent: next }) })
          .catch(() => { /* 存不下只影响下次进来少一条，不打断播放 */ })
      },
      setLang(l) {
        ui.apply(l)
        api('/prefs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lang: l }) })
          .catch(() => { /* 存不下也只是下次进来回到默认档，不该打断切换 */ })
      },
      async load() {
        if (ui.loaded) return
        try {
          const r = await api('/prefs')
          ui.apply(r.lang)
          ui.applyRecent(r.recent)
          amb.hydrate(r.ambient) // 氛围设置与语言同源：同一份 prefs.json
        } catch { /* 宿主没起 / 路由没命中 → 保持默认 */ }
        ui.loaded = true
      },
    }

    /** 取文案。键写错时把键名露在界面上，而不是静默变空白 —— 那种 bug 在截图里最难发现。 */
    const t = (k) => {
      const e = STR[k]
      if (e === undefined) return '«' + k + '»'
      return ui.lang === 'en' ? e[1] : e[0]
    }
    const tf = (k, vars) => String(t(k)).replace(/\{(\w+)\}/g, (m, n) => (vars && vars[n] !== undefined ? String(vars[n]) : m))

    // 音质标签原先由宿主按中文写死（QUALITY_LABELS），英文态要自己按 level 码映射。
    const QUALITY_KEY = { standard: 'qStandard', exhigh: 'qHigh', lossless: 'qLossless', hires: 'qLossless', jyeffect: 'qLossless', jymaster: 'qLossless' }
    const qualityLabel = (take) => {
      if (!take || !take.ok) return ''
      const k = QUALITY_KEY[take.level]
      if (k !== undefined) return t(k)
      return take.quality || take.level || ''
    }

    const fmtTime = (s) => {
      if (!Number.isFinite(s) || s < 0) return '0:00'
      const m = Math.floor(s / 60)
      const ss = Math.floor(s % 60)
      return m + ':' + (ss < 10 ? '0' : '') + ss
    }

    const fmtCount = (n) => {
      const v = Number(n) || 0
      if (ui.lang === 'en') {
        if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B'
        if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'
        if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K'
        return String(v)
      }
      // 数字与"万/亿"之间留一个空格、万位取整：照原型 fmtPlay 的写法。
      // 原来写的是 (v/1e4).toFixed(1)+'万'（"4096.2万"），跟同一屏里的 "共 30 首" 两套排版，
      // 而且小数在这类大数上没有信息量 —— 4096.2 万和 4096 万读到的是同一个量级。
      if (v >= 100000000) return (v / 100000000).toFixed(1) + ' 亿'
      if (v >= 10000) return Math.round(v / 10000) + ' 万'
      return String(v)
    }

    const artistLine = (song) => (Array.isArray(song.artists) ? song.artists.join(' / ') : '')

    /** 把 LRC 文本解析成 [{t, text}]（秒）。 */
    function parseLrc(raw) {
      const out = []
      for (const line of String(raw || '').split(/\r?\n/)) {
        const m = /^\[(\d+):(\d+(?:[.:]\d+)?)\]\s*(.*)$/.exec(line.trim())
        if (m === null) continue
        const sec = Number(m[1]) * 60 + Number(String(m[2]).replace(':', '.'))
        const text = m[3].trim()
        if (text === '') continue
        out.push({ t: sec, text })
      }
      out.sort((a, b) => a.t - b.t)
      return out
    }

    /** 翻译/罗马音按时间戳并入主歌词行（同一时刻才合并，避免错行）。 */
    function mergeByTime(lines, extra) {
      if (!Array.isArray(extra) || extra.length === 0) return lines
      const byKey = new Map()
      for (const e of extra) byKey.set(e.t.toFixed(2), e.text)
      for (const l of lines) {
        const v = byKey.get(l.t.toFixed(2))
        if (v !== undefined) l.sub = v
      }
      return lines
    }

    // =================================================================
    // 播放器单例（模块作用域，跨面板切换存活）
    // =================================================================

    const listeners = new Set()
    const timeListeners = new Set()
    const player = {
      state: {
        queue: [],
        idx: -1,
        playing: false,
        dur: 0,
        volume: 0.8,
        repeat: 'off', // off | one | all
        shuffle: false,
        take: null, // { ok, url, quality, level, error, fee }
        loading: false,
        error: '',
        // 队列来源（Spotify 式：卡片上能显示"正在播这个歌单"）
        source: null, // { kind: 'playlist' | 'toplist' | 'search' | 'category', id, name }
      },
      // 走时单独一条通道：timeupdate 每秒约 4 次，若混进主状态会让整页（含长列表）
      // 每秒重渲染 4 次。只有进度条与歌词需要高频，各自订阅这一条。
      time: 0,
      set(patch) {
        this.state = Object.assign({}, this.state, patch)
        for (const fn of listeners) fn(this.state)
      },
      setTime(sec) {
        this.time = sec
        for (const fn of timeListeners) fn(sec)
      },
      subscribe(fn) {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
      subscribeTime(fn) {
        timeListeners.add(fn)
        return () => timeListeners.delete(fn)
      },
    }

    let audioEl = null
    let playToken = 0
    let autoAdvance = false // 换歌是"上一首放完自动走"还是"用户自己点的"（决定挂起的 seek 跟不跟过去）

    function ensureAudio() {
      if (audioEl !== null) return audioEl
      const a = document.createElement('audio')
      a.preload = 'auto'
      a.style.display = 'none'
      a.volume = player.state.volume
      document.body.appendChild(a)

      // 挂起的 seek 期间不让 timeupdate 把 UI 拽回真实播放头：这段时间走时归 seek 那条链管，
      // 跳不成/跳不过去时它会显式同步回来（旧实现没这道闸，点下去会"先跳到目标、再自己弹回曲首"）
      a.addEventListener('timeupdate', () => { if (PENDING_SEEK === null) player.setTime(a.currentTime) })
      a.addEventListener('durationchange', () => player.set({ dur: Number.isFinite(a.duration) ? a.duration : 0 }))
      a.addEventListener('loadedmetadata', () => { player.set({ dur: Number.isFinite(a.duration) ? a.duration : 0 }); seekOnReady() })
      a.addEventListener('canplay', () => { seekOnReady() })
      // seeked **不是**成功信号 —— 落点不对时它照样会到（旧实现就在这儿撒的谎）。
      // 它只负责两件事：停稳了就提前进入落点复核；落到别处了就立刻再补一跳。
      a.addEventListener('seeked', () => {
        const it = PENDING_SEEK
        if (it === null) return
        snapDiag(a)
        seekDiag.got = Math.round(a.currentTime * 10) / 10
        const want = seekTarget(a, it)
        if (seekLanded(a, want)) { it.stuck = 0; seekStartVerify() }
        else if (it.lastAssign !== 0) seekTickSoon(60)
      })
      a.addEventListener('play', () => player.set({ playing: true, error: '' }))
      a.addEventListener('pause', () => player.set({ playing: false }))
      a.addEventListener('ended', () => { handleEnded() })
      a.addEventListener('error', () => {
        const s = player.state
        if (s.loading) return
        player.set({ playing: false, error: t('eAudio') })
        setTimeout(() => { if (player.state.error !== '') nextTrack(false) }, 900)
      })
      audioEl = a
      return a
    }

    /** 载入并播放队列第 i 首。取链失败也会给出明确文案而不是静默无声。 */
    async function playAt(i, { autoplay = true } = {}) {
      const q = player.state.queue
      if (!(i >= 0 && i < q.length)) return
      const song = q[i]
      const token = ++playToken
      // 挂起的 seek 不再无条件丢掉 —— 那正是"点完位置紧接着换歌、位置被冲回曲首"的来源。
      //  · 上一首放完自动换（autoAdvance）：意图作废，用户点的是上一首；
      //  · 用户自己换（下一首/点歌）：1.5s 内点下的算点在新曲上，seekTarget 按点击比例落过去；
      //  · 更早的旧意图由 seekTick / 落点复核判 dropped（诊断里能看到 dropped）。
      if (autoAdvance && PENDING_SEEK !== null) { PENDING_SEEK = null; seekDiagPush('dropped') }
      player.setTime(0)
      player.set({ idx: i, loading: true, error: '', take: null, dur: 0 })
      const a = ensureAudio()
      let take = null
      try {
        take = await api('/songurl?id=' + encodeURIComponent(song.id))
      } catch (e) {
        if (token === playToken) player.set({ loading: false, error: tf('eTake', { m: e.message }), take: { ok: false, error: e.message } })
        return
      }
      if (token !== playToken) return // 已被后续点歌取代
      player.set({ take, loading: false })
      if (!take.ok) {
        player.set({ error: take.error || t('eNoUrl'), playing: false })
        return
      }
      audioSongId = String(song.id)
      streamSrc = take.url
      a.src = take.url
      a.load()
      if (autoplay) {
        try {
          await a.play()
        } catch {
          // 浏览器自动播放策略：需要一次用户手势。此时保持暂停並提示。
          player.set({ playing: false, error: t('eAutoplay') })
        }
      }
    }

    function nextTrack(auto) {
      const s = player.state
      if (s.queue.length === 0) return
      if (auto && s.repeat === 'one') { playAt(s.idx); return }
      let i
      if (s.shuffle) {
        i = s.queue.length === 1 ? 0 : (() => {
          let n = s.idx
          while (n === s.idx) n = Math.floor(Math.random() * s.queue.length)
          return n
        })()
      } else {
        i = s.idx + 1
        if (i >= s.queue.length) {
          if (s.repeat === 'all') i = 0
          else { player.set({ playing: false }); player.setTime(0); return }
        }
      }
      playAt(i)
    }

    function prevTrack() {
      const s = player.state
      if (s.queue.length === 0) return
      if (player.time > 3) { seekTo(0, 0); return }
      playAt(s.idx <= 0 ? s.queue.length - 1 : s.idx - 1)
    }

    function handleEnded() {
      const s = player.state
      if (s.repeat === 'one') { const a = ensureAudio(); a.currentTime = 0; a.play().catch(() => {}); return }
      autoAdvance = true
      nextTrack(true)
      autoAdvance = false
    }

    /** 播放一个列表（点击某行 = 以该列表为队列，从第 index 首开始）。 */
    function playFrom(list, index, source) {
      const songs = (list || []).filter((s) => s && s.id)
      if (songs.length === 0) return
      player.set({ queue: songs, source: source || null })
      // 发现页的「最近播放」以"从哪个歌单开播"为准：搜索这种一次性来源不进历史
      const at = index >= 0 && index < songs.length ? index : 0
      if (source && source.kind !== 'search' && source.id && source.name) {
        ui.pushRecent({ id: source.id, name: source.name, cover: source.cover || songs[at].cover || '',
          playCount: source.playCount, creator: source.creator })
      }
      playAt(at)
    }

    /** 把一首歌插到当前播放的下一首（歌曲行尾那一格）。已在队列里则不重复插。 */
    function playNext(song) {
      const s = player.state
      if (!song || !song.id) return
      if (s.queue.some((x) => x && x.id === song.id)) return
      // 还没在放任何东西时没有"下一首"可言：直接开播，比按下去没反应强
      if (s.idx < 0) { playFrom([song], 0, s.source); return }
      const queue = s.queue.slice()
      queue.splice(s.idx + 1, 0, song)
      player.set({ queue })
    }

    function togglePlay() {
      const a = ensureAudio()
      const s = player.state
      if (s.idx < 0) {
        if (s.queue.length > 0) playAt(0)
        return
      }
      if (a.paused) a.play().catch((e) => player.set({ error: tf('ePlay', { m: String((e && e.message) || e) }) }))
      else a.pause()
    }

    // 流还没准备好时写 currentTime 会被浏览器**静默丢掉**（readyState=0 或 seekable 为空）。
    // 表现就是"点进度条、点歌词直接跳回曲首"：seek 没生效，走时仍从 0 爬。
    //
    // 2026-09-28 第二轮（用户实机复报 + scripts/probe-seek.mjs 在隔离 harness 里实测）：
    // 探针抓到了两类**假成功**，旧实现两条都踩：
    //   ① 拿"信号"当成功 —— 赋值没抛异常、或 seeked 事件到了就记 ok。实测 seeked 会在落点
    //      根本不是目标时照常到达（元素被钳住跳不动时也会走完 seeked）；用户带回来的
    //      {target:104.6, got:0, result:"ok"} 就是它：诊断说 ok、播放头在 0、重试循环已收工。
    //   ② 落地之后被**资源重载悄悄冲掉** —— 换歌/重拉时 a.src=/load() 会把刚跳好的播放头
    //      重置回 0 且不报任何错（探针 E1/E2/R1/R2：点完 300ms 内还在目标上，随后回到 0 从头播，
    //      data-seek 一路写着 ok）。
    // 所以成功定义只留一个：**播放头真的在目标上、而且站得住**（落点复核 + 900ms 守望）。
    // 站不住时按代价从小到大恢复：① 重跳（换歌那一瞬点下的按**点击比例**落到新曲上 —— 用户要的
    // "跳到对应位置"）；② 重拉一次流（带 fresh=1 绕开宿主 5 分钟取链缓存）再补跳；
    // 都不行才认输：把走时同步回真实播放头 + 明说跳不过去，不再让 UI 停在假目标上。
    let PENDING_SEEK = null // { sec, ratio, songId, at, tries, stuck, wipes, reloads, lastAssign }
    let seekTimer = 0
    let seekVerify = 0
    const seekDiag = { target: 0, rs: 0, ns: 0, dur: 0, seekEnd: null, bufEnd: null, got: 0, tries: 0, err: null, via: '', hist: [], result: 'idle' }
    // 元素当前**装着**的那首（不是 player.state.idx —— 换歌取链那几百毫秒里两者会错位）
    let audioSongId = ''
    let streamSrc = ''

    function seekDiagPush(result) {
      seekDiag.result = result
      if (audioEl !== null) audioEl.setAttribute('data-seek', JSON.stringify(seekDiag))
    }

    function snapDiag(a) {
      seekDiag.rs = a.readyState
      seekDiag.ns = a.networkState
      seekDiag.dur = Number.isFinite(a.duration) ? Math.round(a.duration * 10) / 10 : 0
      seekDiag.seekEnd = a.seekable !== null && a.seekable.length > 0
        ? Math.round(a.seekable.end(a.seekable.length - 1) * 10) / 10 : null
      seekDiag.bufEnd = a.buffered !== null && a.buffered.length > 0
        ? Math.round(a.buffered.end(a.buffered.length - 1) * 10) / 10 : null
      seekDiag.err = a.error !== null ? a.error.code : null
    }

    function seekHist(a) {
      const ms = PENDING_SEEK === null ? 0 : Date.now() - PENDING_SEEK.at
      seekDiag.hist.push('+' + ms + 'ms rs' + a.readyState + ' ct' + (Math.round(a.currentTime * 10) / 10))
      if (seekDiag.hist.length > 5) seekDiag.hist.shift()
    }

    /** 播放头现在真在目标上吗（±1.5s，且没有在飞的 seek）。 */
    function seekLanded(a, sec) {
      return !a.seeking && Math.abs(a.currentTime - sec) <= 1.5
    }

    function curSongId() {
      const s = player.state
      const song = s.idx >= 0 && s.idx < s.queue.length ? s.queue[s.idx] : null
      return song && song.id ? String(song.id) : ''
    }

    /**
     * 这次 seek 该跳到哪。
     * 有比例就以**比例**为准：条上显示的总时长可能是列表 interval 兜底或换歌瞬间的旧值，
     * 而玩家点的是"整首歌的第几成"——元素真时长到位后按它折算才落得准
     * （探针 R1：旧曲 313s 上按 70% 算出的绝对时刻 218.7，落到新曲 130.6s 上被钳到末尾，
     * 直接触发 ended → 自动下一首）。没有比例（键盘/程序化调用）才用绝对时刻。
     */
    function seekTarget(a, it) {
      const d = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 0
      if (it.ratio !== null && d > 0) return Math.min(it.ratio * d, Math.max(0, d - 0.5))
      return it.sec
    }

    /** 元素现在装的是不是这次点击说的那首（it.songId 为空＝无从判断，放行）。 */
    function onIntentSong(it) {
      return it.songId === '' || audioSongId === it.songId
    }

    /** 跳一把。返回 'landed' | 'assigned' | 'wait'。 */
    function seekAttempt() {
      const a = audioEl
      const it = PENDING_SEEK
      if (a === null || it === null) return 'wait'
      // 元素还装着换歌前的旧曲子时不写：写下去会被浏览器的"待定 seek"带进新资源、
      // 钳到新曲末尾（探针 R1 实测 → ended → 自动跳下一首）。等元素真装上这首再落。
      if (!onIntentSong(it)) return 'wait'
      const dst = seekTarget(a, it)
      seekDiag.target = Math.round(dst * 10) / 10
      snapDiag(a)
      if (seekLanded(a, dst)) { seekDiag.got = Math.round(a.currentTime * 10) / 10; return 'landed' }
      if (a.readyState >= 1 && a.seekable !== null && a.seekable.length > 0) {
        // 250ms 内不重复写：loadedmetadata/canplay 与 tick 可能同一拍打进来
        if (Date.now() - it.lastAssign > 250) {
          it.lastAssign = Date.now()
          a.currentTime = dst
          seekDiag.got = Math.round(a.currentTime * 10) / 10
          seekHist(a)
        }
        if (seekLanded(a, dst)) return 'landed'
        return 'assigned'
      }
      return 'wait'
    }

    function seekOnReady() {
      const it = PENDING_SEEK
      if (it === null) return
      if (seekAttempt() === 'landed') seekStartVerify()
    }

    function seekTickSoon(ms) {
      if (seekTimer === 0) seekTimer = window.setTimeout(seekTick, ms)
    }

    /** 落点复核：跳上去之后再看一眼，没被资源重载冲掉才算真成。 */
    function seekStartVerify() {
      if (seekVerify !== 0) window.clearTimeout(seekVerify)
      const it = PENDING_SEEK
      if (it === null || audioEl === null) return
      seekDiag.got = Math.round(audioEl.currentTime * 10) / 10
      seekVerify = window.setTimeout(() => {
        seekVerify = 0
        const a = audioEl
        if (a === null || PENDING_SEEK !== it) return
        const want = seekTarget(a, it)
        // 资源重载/换歌会把刚落好的播放头冲回 0（探针 R1/R2 实测）：落到别处才算被冲掉；
        // 落点站住了就是成 —— 哪怕这中间换过歌（按点击比例落到新曲上正是用户要的）。
        if (!(want > 5 && !a.seeking && a.currentTime < Math.min(2.5, want))) {
          PENDING_SEEK = null
          seekDiag.got = Math.round(a.currentTime * 10) / 10
          seekDiagPush(seekDiag.via === 'reload' ? 'ok-reload' : 'ok')
          return
        }
        // 元素已经换成别的歌：这次点击的落点是被换歌接管（不是"落不上"），如实记 dropped，别再补跳
        if (!onIntentSong(it)) {
          PENDING_SEEK = null
          player.setTime(a.currentTime)
          seekDiagPush('dropped')
          return
        }
        // 被冲掉了：换歌前点的旧意图不再追（如实记 dropped），新曲上点的按原意图再跳
        const cur = curSongId()
        if (cur !== '' && it.songId !== '' && cur !== it.songId && Date.now() - it.at > 1500) {
          PENDING_SEEK = null
          player.setTime(a.currentTime)
          seekDiagPush('dropped')
          return
        }
        if (it.wipes < 2) {
          it.wipes++
          it.tries = 0
          it.stuck = 0
          it.lastAssign = 0
          player.setTime(want)
          seekDiagPush('re-seek')
          seekTickSoon(120)
          return
        }
        seekGiveUp()
      }, 900)
    }

    /** 元素跳不动/没有可跳区间的最后手段：整条流重拉（fresh=1 绕开宿主取链缓存）再补跳。 */
    function seekReload(a) {
      const wasPlaying = !a.paused
      if (streamSrc !== '') {
        const u = streamSrc + (streamSrc.indexOf('?') >= 0 ? '&' : '?') + 'fresh=1&r=' + (PENDING_SEEK === null ? 0 : PENDING_SEEK.reloads)
        if (a.src !== u) a.src = u
      }
      a.load()
      if (wasPlaying) a.play().catch(() => { /* 自动播放被拒时保持暂停 */ })
    }

    /** 认输：把走时同步回真实播放头 + 明说跳不过去（不再让 UI 停在假目标上）。 */
    function seekGiveUp() {
      const a = audioEl
      PENDING_SEEK = null
      if (seekTimer !== 0) { window.clearTimeout(seekTimer); seekTimer = 0 }
      if (a !== null) player.setTime(a.currentTime)
      seekDiagPush('gaveup')
      player.set({ error: t('eSeek') })
    }

    function seekTick() {
      seekTimer = 0
      const it = PENDING_SEEK
      const a = audioEl
      if (it === null || a === null) return
      it.tries++
      seekDiag.tries = it.tries
      // 换歌：1.5s 内点下的算"点在新曲上"（seekTarget 会按比例落过去）；更早的意图不追过去
      const cur = curSongId()
      if (cur !== '' && it.songId !== '' && cur !== it.songId && Date.now() - it.at > 1500) {
        PENDING_SEEK = null
        player.setTime(a.currentTime)
        seekDiagPush('dropped')
        return
      }
      const r = seekAttempt()
      if (r === 'landed') { seekStartVerify(); return }
      // 写得进去、落不上（被钳住）——连续两次就重拉；连可跳区间都没有，早点重拉。
      // 换歌途中（元素还没装上这次点击那首）不重拉：那条流马上就作废了。
      const mine = onIntentSong(it)
      if (mine && r === 'assigned' && !a.seeking && Math.abs(a.currentTime - seekDiag.target) > 1.5) it.stuck++
      const noRanges = mine && a.readyState >= 1 && (a.seekable === null || a.seekable.length === 0)
      if (it.reloads < 2 && (it.stuck >= 2 || (noRanges && it.tries >= 6))) {
        it.reloads++
        seekDiag.via = 'reload'
        seekReload(a)
        seekTickSoon(200)
        return
      }
      if (it.tries >= (it.reloads > 0 ? 35 : 20)) { seekGiveUp(); return }
      seekTickSoon(200)
    }

    function seekTo(sec, ratio) {
      ensureAudio()
      if (!Number.isFinite(sec)) return
      const target = Math.max(0, sec)
      player.setTime(target)
      PENDING_SEEK = {
        sec: target,
        ratio: Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : null,
        songId: curSongId(),
        at: Date.now(),
        tries: 0, stuck: 0, wipes: 0, reloads: 0, lastAssign: 0,
      }
      seekDiag.target = Math.round(target * 10) / 10
      seekDiag.tries = 0
      seekDiag.hist = []
      seekDiag.via = ''
      if (seekVerify !== 0) { window.clearTimeout(seekVerify); seekVerify = 0 }
      if (seekAttempt() === 'landed') seekStartVerify()
      else seekTickSoon(200)
      seekDiagPush('pending')
    }

    /**
     * 进度条可用的总时长。
     * 不能只用 s.dur：流式 MP3 的 duration 要等 loadedmetadata 才有值，而这段时间里
     * 用户已经在点进度条了 —— 拿不到总长就只能"点了没反应"。列表数据里本来就有 interval（秒），
     * 用它兜底，点得中的窗口从"元数据到位"提前到"歌单一渲染出来"。
     */
    function trackDur(song, s) {
      if (s.dur > 0) return s.dur
      const iv = song ? Number(song.interval) : 0
      return iv > 0 ? iv : 0
    }

    function setVolume(v) {
      const a = ensureAudio()
      const nv = Math.max(0, Math.min(1, v))
      a.volume = nv
      player.set({ volume: nv })
    }

    /**
     * 进度条的"点得中 + 拖得动 + 键可控"。
     * 为什么 onClick 不够：可见条高只有 4px（那是设计刻度里的一档，不该为了好点改成 12px），
     * 命中区靠 CSS 的 ::before 撑开；而 onClick 只在"按下与抬起在同一处"时才发，
     * 按住往边缘拖出去就没有后续 —— 拖动必须走 pointer 事件 + setPointerCapture。
     * 键盘那条是 role="slider" 的义务：Arrow ±5s（Shift 15s）、PageUp/Down 十分之一首。
     */
    // 拖动状态放模块级，不放 handler 闭包里。scrubProps 每次渲染都新建一套 handler，而全屏里的
    // 进度条每帧（rAF 走时）都重渲染 —— 实测 dragging 写在闭包时，pointerdown 之后下一次 render
    // 就把它抹回 false，于是"点了能跳、拖着不动"整段失效。同一时刻只可能有一个指针在拖
    // （setPointerCapture 保证），所以一个全局槽足够。
    let SCRUB = null
    function scrubProps(getDur, getTime, onSeek) {
      const ratioAt = (e) => {
        const b = e.currentTarget.getBoundingClientRect()
        return Math.max(0, Math.min(1, (e.clientX - b.left) / (b.width || 1)))
      }
      const stop = (e) => { if (SCRUB !== null && (e.currentTarget === SCRUB.el)) SCRUB = null }
      // onSeek(秒, 比例)：比例是给"点完紧接着换歌"用的 —— 绝对秒数属于当时的资源，
      // 新曲要按同样的相对位置落（seekTo 里的 seekTarget 用）
      return {
        onPointerDown: (e) => {
          const d = getDur()
          if (!(d > 0)) return
          const r = ratioAt(e)
          const target = r * d
          SCRUB = { el: e.currentTarget, last: target }
          try { if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 老引擎 */ }
          onSeek(target, r)
          e.preventDefault()
        },
        onPointerMove: (e) => {
          if (SCRUB === null || SCRUB.el !== e.currentTarget) return
          // 鼠标必须真的按着：万一 pointerup 丢了（在窗口外松开、被系统抢走焦点），
          // SCRUB 会卡住，那时"只是划过进度条"就会一路 seek —— 比点不动还糟。
          if (e.pointerType === 'mouse' && e.buttons === 0) { SCRUB = null; return }
          const d = getDur()
          if (!(d > 0)) return
          const r = ratioAt(e)
          const target = r * d
          // 每次 pointermove 都设 currentTime 会一路发 Range 请求；跨 0.75s 才真跳一次
          if (Math.abs(target - SCRUB.last) < 0.75) return
          SCRUB.last = target
          onSeek(target, r)
        },
        onPointerUp: stop,
        onPointerCancel: stop,
        onKeyDown: (e) => {
          const d = getDur()
          if (!(d > 0)) return
          const cur = getTime()
          const step = e.shiftKey ? 15 : 5
          const go = (v) => {
            const v2 = Math.max(0, Math.min(d, v))
            onSeek(v2, v2 / d)
            e.preventDefault()
          }
          if (e.key === 'ArrowRight') go(cur + step)
          else if (e.key === 'ArrowLeft') go(cur - step)
          else if (e.key === 'PageUp') go(cur + d * 0.1)
          else if (e.key === 'PageDown') go(cur - d * 0.1)
          else if (e.key === 'Home') go(0)
          else if (e.key === 'End') go(d - 1)
        },
      }
    }

    // 歌词列表的滚动：自己用 rAF 走 easeOutExpo，而不是 scrollTo({behavior:'smooth'})。
    // 三个理由都是实测出来的，不是洁癖：
    //   ① 浏览器自带 smooth 的时长不可控，也没法被"指针悬停时暂停"打断；
    //   ② 用户把指针按在某一行上准备点时，自动滚动正在把那一行滑走 —— mousedown 与 mouseup
    //      之间行移了位，click 落到的是**另一行**，时间戳跟着跳到别处（这就是"点这儿跳到那儿"）；
    //   ③ 只有纯 f(t) 的滚动才能被仪器逐帧复现："连续"要是可测的，不能是希望出来的。
    // 时长取 --t-slow，和面板其它位移同一档；被打断时从当前 scrollTop 续走，不回到起点。
    let SCROLL_RAF = 0
    function stopScroll() { if (SCROLL_RAF !== 0) { cancelAnimationFrame(SCROLL_RAF); SCROLL_RAF = 0 } }
    function tweenScroll(box, to, ms) {
      stopScroll()
      const from = box.scrollTop
      const d = to - from
      if (Math.abs(d) < 1 || !(ms > 0)) { box.scrollTop = to; return }
      const t0 = performance.now()
      // 形参不能叫 t：i18n 静态检查钉死"不许再有第二个叫 t 的绑定"（t() 是翻译函数，
      // 音乐面板里 t 又天生表示当前秒数，遮蔽过一次就把全屏歌词整个槽位搞崩了）
      const step = (ts) => {
        const p = Math.min(1, (ts - t0) / ms)
        const e = p >= 1 ? 1 : 1 - Math.pow(2, -10 * p) // easeOutExpo，t80≈.22，与 --ease-snap 同族
        box.scrollTop = from + d * e
        SCROLL_RAF = p < 1 ? requestAnimationFrame(step) : 0
      }
      SCROLL_RAF = requestAnimationFrame(step)
    }
    // 弹层（队列抽屉 / 登录弹窗）入场的原点 = **用户按下去的那一点**。
    // 一处 pointerdown 捕获比给每个触发按钮接线更省、也更真：打开的永远是你刚按的地方，
    // 而不是某个按钮的几何中心。弹层从这一点长出来 —— 因果看得见，而不是凭空出现。
    let PRESS = null
    function installPressOrigin() {
      const onDown = (e) => { PRESS = { x: e.clientX, y: e.clientY } }
      document.addEventListener('pointerdown', onDown, true)
      return () => document.removeEventListener('pointerdown', onDown, true)
    }
    function applyOrigin(el) {
      if (el === null || el === undefined || PRESS === null) return
      // 量之前先把入场动画摘掉：wyy-pop 从 scale(.94) 起，动画期间 getBoundingClientRect 给的是
      // **被缩小过的**框，拿它反推原点会把原点推离按下点（实测 21px：13px 横 + 16px 纵，正好是
      // .94 相对默认中心原点缩掉的量）。摘掉动画量基框再装回去 —— 这一步在首次绘制之前跑，
      // 动画照样从头播，用户看不到差别。
      const had = el.style.animation
      el.style.animation = 'none'
      const b = el.getBoundingClientRect()
      el.style.animation = had
      if (b.width === 0 || b.height === 0) return
      el.style.transformOrigin = (PRESS.x - b.left) + 'px ' + (PRESS.y - b.top) + 'px'
    }

    /** 读一个时长令牌（ms）。JS 侧的时长不许各写各的常数，要和 CSS 用同一套刻度。 */
    function tokenMs(el, name, dflt) {
      const v = getComputedStyle(el).getPropertyValue(name).trim()
      const n = parseFloat(v)
      if (!Number.isFinite(n) || n <= 0) return dflt
      return v.indexOf('ms') >= 0 ? n : n * 1000
    }

    /** 订阅播放器状态（面板卸载不中断播放）。走时不在其中，避免高频重渲染。 */
    function usePlayer() {
      const [s, setS] = useState(player.state)
      useEffect(() => player.subscribe(setS), [])
      return s
    }

    /** 订阅走时（仅进度条/歌词需要；每秒约 4 次）。 */
    function usePlayerTime() {
      const [t, setT] = useState(player.time)
      useEffect(() => player.subscribeTime(setT), [])
      return t
    }

    /** 平滑走时（仅全屏歌词打开时跑，避免无谓 rAF）。 */
    function useSmoothTime(active) {
      const [t, setT] = useState(0)
      useEffect(() => {
        if (!active) return undefined
        let raf = 0
        const tick = () => {
          if (audioEl !== null) setT(audioEl.currentTime)
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
      }, [active])
      return t
    }

    // =================================================================
    // 歌词数据（模块级缓存 + 预取：进全屏时立即有内容）
    // =================================================================

    const LYRIC_CACHE = new Map() // songId -> { lines }
    const LYRIC_PENDING = new Map() // songId -> Promise

    function fetchLyric(id) {
      const cached = LYRIC_CACHE.get(id)
      if (cached !== undefined) return Promise.resolve(cached)
      const pending = LYRIC_PENDING.get(id)
      if (pending !== undefined) return pending
      const p = api('/lyric?id=' + encodeURIComponent(id)).then((r) => {
        let lines
        if (r.wordLevel && Array.isArray(r.wordLines) && r.wordLines.length > 0) {
          // 逐字：宿主已把 YRC 解析成 { t, end, text, words }（秒时基）
          lines = r.wordLines.map((l) => ({ t: l.t, end: l.end, text: l.text, words: l.words }))
        } else {
          lines = parseLrc(r.lyric)
          for (let i = 0; i < lines.length; i++) {
            lines[i].end = i + 1 < lines.length ? lines[i + 1].t : lines[i].t + 4
          }
          // 纯 LRC 也走卡拉OK：整行当作"一个词"，从行首渐变填到行尾
          for (const l of lines) {
            if (l.words === undefined) l.words = [{ t: l.t, end: l.end, text: l.text }]
          }
        }
        // 译文并入必须在两个分支之外：YRC 逐字歌词走的 if，tlyric 照样有行 —— 之前
        // 只在 else 里并，于是"有逐字"就"没译文"（有 YRC 的歌恰恰是最热门的那些）。
        mergeByTime(lines, parseLrc(r.trans))
        for (const l of lines) if (l.end === undefined) l.end = l.t + 4
        const payload = { lines }
        LYRIC_CACHE.set(id, payload)
        LYRIC_PENDING.delete(id)
        return payload
      }).catch((e) => { LYRIC_PENDING.delete(id); throw e })
      LYRIC_PENDING.set(id, p)
      return p
    }

    function useLyric(songId) {
      const [state, setState] = useState(() => (LYRIC_CACHE.has(songId) ? { data: LYRIC_CACHE.get(songId), err: '' } : { data: null, err: '' }))
      useEffect(() => {
        if (songId === '' || songId === null || songId === undefined) { setState({ data: null, err: '' }); return undefined }
        let cancelled = false
        const cached = LYRIC_CACHE.get(songId)
        if (cached !== undefined) { setState({ data: cached, err: '' }); return undefined }
        setState({ data: null, err: '' })
        fetchLyric(songId).then((d) => { if (!cancelled) setState({ data: d, err: '' }) })
          .catch((e) => { if (!cancelled) setState({ data: null, err: e.message }) })
        return () => { cancelled = true }
      }, [songId])
      return state
    }

    /** 当前播放到第几行（-1 = 还没到第一行）。 */
    function activeLineIndex(lines, sec) {
      let active = -1
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].t <= sec + 0.05) active = i
        else break
      }
      return active
    }

    // =================================================================
    // 图标
    // =================================================================

    /** 双联音符：16/18px 下仍能一眼认出是「音乐」（侧栏入口，勿改）。 */
    function IconMusic({ size = 18 }) {
      return React.createElement('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        'aria-hidden': 'true', focusable: 'false',
      }, [
        React.createElement('path', {
          key: 'stem',
          d: 'M9.5 17.2V6.4a1 1 0 0 1 .8-1l8-1.6a1 1 0 0 1 1.2 1v10.4',
          stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        }),
        React.createElement('circle', { key: 'a', cx: 6.9, cy: 17.4, r: 2.6, fill: 'currentColor' }),
        React.createElement('circle', { key: 'b', cx: 17, cy: 15.6, r: 2.6, fill: 'currentColor' }),
      ])
    }

    const S = (size, children, extra) => React.createElement('svg', Object.assign({
      width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false',
    }, extra || {}), children)

    const IconPlay = ({ size = 16 }) => S(size, React.createElement('path', { d: 'M8 5.2v13.6a.9.9 0 0 0 1.37.77l11-6.8a.9.9 0 0 0 0-1.54l-11-6.8A.9.9 0 0 0 8 5.2z', fill: 'currentColor' }))
    const IconPause = ({ size = 16 }) => S(size, React.createElement('path', { d: 'M7 4h3.5v16H7zM13.5 4H17v16h-3.5z', fill: 'currentColor' }))
    const IconPrev = ({ size = 16 }) => S(size, React.createElement('path', { d: 'M7 5h2.2v14H7zM19 6.1v11.8a.9.9 0 0 1-1.4.76l-8.3-5.9a.9.9 0 0 1 0-1.52l8.3-5.9A.9.9 0 0 1 19 6.1z', fill: 'currentColor' }))
    const IconNext = ({ size = 16 }) => S(size, React.createElement('path', { d: 'M14.8 5H17v14h-2.2zM5 6.1v11.8a.9.9 0 0 0 1.4.76l8.3-5.9a.9.9 0 0 0 0-1.52l-8.3-5.9A.9.9 0 0 0 5 6.1z', fill: 'currentColor' }))
    const IconSearch = ({ size = 15 }) => S(size, [
      React.createElement('circle', { key: 'c', cx: 10.5, cy: 10.5, r: 6.5, stroke: 'currentColor', strokeWidth: 1.9, fill: 'none' }),
      React.createElement('path', { key: 'l', d: 'M15.5 15.5 20 20', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' }),
    ])
    const IconShuffle = ({ size = 16 }) => S(size, React.createElement('path', { d: 'M16 4h4v4M20 4l-6.2 6.2M16 20h4v-4M20 20l-6.2-6.2M4 6.5h2.6c1 0 1.9.4 2.6 1.1L14 12M4 17.5h2.6c1 0 1.9-.4 2.6-1.1L10.8 15', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }))
    const IconRepeat = ({ size = 16 }) => S(size, React.createElement('path', { d: 'M17 3.5 20.5 7 17 10.5M20.5 7H7a3.5 3.5 0 0 0-3.5 3.5v1M7 20.5 3.5 17 7 13.5M3.5 17H17a3.5 3.5 0 0 0 3.5-3.5v-1', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }))
    const IconNote = ({ size = 14 }) => S(size, [
      React.createElement('path', { key: 'p', d: 'M9 18V6.5l10-2v11', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }),
      React.createElement('circle', { key: 'a', cx: 6.5, cy: 18, r: 2.5, fill: 'currentColor' }),
      React.createElement('circle', { key: 'b', cx: 16.5, cy: 15.5, r: 2.5, fill: 'currentColor' }),
    ])
    const IconHome = ({ size = 18 }) => S(size, React.createElement('path', { d: 'M4 10.6 12 4.2l8 6.4V19a1.6 1.6 0 0 1-1.6 1.6h-3.9v-5.4H9.5v5.4H5.6A1.6 1.6 0 0 1 4 19z', stroke: 'currentColor', strokeWidth: 1.7, strokeLinejoin: 'round', fill: 'none' }))
    const IconChart = ({ size = 18 }) => S(size, React.createElement('path', { d: 'M5 19.5V11M10 19.5V4.5M15 19.5v-6M20 19.5V8', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', fill: 'none' }))
    const IconLibrary = ({ size = 18 }) => S(size, [
      React.createElement('path', { key: 'a', d: 'M4 6h16M4 12h16M4 18h9', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', fill: 'none' }),
    ])
    const IconChevronDown = ({ size = 20 }) => S(size, React.createElement('path', { d: 'M6 9.5 12 15.5 18 9.5', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }))
    // 队列（原型的 I.queue：三条文本线 + 一列"下一首"箭头）
    const IconQueue = ({ size = 16 }) => S(size, [
      React.createElement('path', { key: 'l', d: 'M4 7h11M4 12h11M4 17h7', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', fill: 'none' }),
      React.createElement('path', { key: 's', d: 'M18 10v8', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', fill: 'none' }),
      React.createElement('circle', { key: 'c', cx: 20, cy: 18, r: 2, stroke: 'currentColor', strokeWidth: 1.7, fill: 'none' }),
    ])
    const IconVolume = ({ size = 16 }) => S(size, [
      React.createElement('path', { key: 'a', d: 'M4.5 9.5h3.2L12 6v12l-4.3-3.5H4.5z', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round', fill: 'none' }),
      React.createElement('path', { key: 'b', d: 'M15.4 9.2a4.2 4.2 0 0 1 0 5.6M17.9 6.6a7.6 7.6 0 0 1 0 10.8', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', fill: 'none' }),
    ])
    // 红心：初始一律空心（本插件没有歌单收藏状态的读取接口，实心只用于"已收藏"这类已知状态）
    const IconHeart = ({ size = 16 }) => S(size, React.createElement('path', { d: 'M12 20.2 4.9 13a4.6 4.6 0 0 1 6.5-6.5l.6.6.6-.6A4.6 4.6 0 0 1 19.1 13z', stroke: 'currentColor', strokeWidth: 1.7, strokeLinejoin: 'round', fill: 'none' }))
    const IconHeartFill = ({ size = 16 }) => S(size, React.createElement('path', { d: 'M12 20.6 4.6 13.1a4.9 4.9 0 0 1 6.9-6.9l.5.5.5-.5a4.9 4.9 0 0 1 6.9 6.9z', fill: 'currentColor' }))
    // 「下一首播放」：三角 + 加号。跟 IconNext（下一首）不是一回事，所以不复用
    const IconPlayNext = ({ size = 16 }) => S(size, [
      React.createElement('path', { key: 'p', d: 'M4 7.9v8.2a.8.8 0 0 0 1.22.68l6.6-4.1a.8.8 0 0 0 0-1.36l-6.6-4.1A.8.8 0 0 0 4 7.9z', fill: 'currentColor' }),
      React.createElement('path', { key: 'x', d: 'M17.6 8.4v6.4M14.4 11.6h6.4', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
    ])

    // 氛围背景：一圈晕开的同心弧（"氛围"不能画成太阳/亮度图标，那是系统设置的语义）
    const IconAura = ({ size = 18 }) => S(size, [
      React.createElement('circle', { key: 'c', cx: 12, cy: 12, r: 3.1, fill: 'currentColor' }),
      React.createElement('path', { key: 'a', d: 'M12 5.6a6.4 6.4 0 0 1 0 12.8', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', fill: 'none' }),
      React.createElement('path', { key: 'b', d: 'M12 18.4a6.4 6.4 0 0 1 0-12.8', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', fill: 'none' }),
      React.createElement('path', { key: 'd', d: 'M12 2.6a9.4 9.4 0 0 1 0 18.8M12 21.4a9.4 9.4 0 0 1 0-18.8', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', fill: 'none', opacity: 0.55 }),
    ])
    // 律动条：中间高两边低的一排柱子（与 IconChart 的"递增四柱"区分开）
    const IconBars = ({ size = 18 }) => S(size,
      [3.4, 7.4, 10.6, 7.4, 3.4].map((h, i) => React.createElement('rect', {
        key: i, x: 3.2 + i * 3.6, y: 12 - h / 2, width: 2.2, height: h, rx: 1.1, fill: 'currentColor',
      })))
    // 设置齿轮（氛围设置入口）
    const IconGear = ({ size = 18 }) => S(size, [
      React.createElement('circle', { key: 'c', cx: 12, cy: 12, r: 3.1, stroke: 'currentColor', strokeWidth: 1.7, fill: 'none' }),
      React.createElement('path', {
        key: 'g',
        d: 'M12 3.2v2.1M12 18.7v2.1M4.8 12H2.7M21.3 12h-2.1M6.9 6.9 5.4 5.4M18.6 18.6l-1.5-1.5M17.1 6.9l1.5-1.5M5.4 18.6l1.5-1.5',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', fill: 'none',
      }),
    ])

    /** 正在播放的三条跳动音柱（Spotify 的 now-playing 指示器）。 */
    function Equalizer({ playing }) {
      return React.createElement('span', { className: 'wyy-eq' + (playing ? ' on' : ''), 'aria-hidden': 'true' },
        [0, 1, 2].map((i) => React.createElement('i', { key: i, style: { animationDelay: (i * 0.22) + 's' } })))
    }

    // =================================================================
    // L3 取色引擎：封面像素 -> --art-* 令牌
    // =================================================================

    /* 三层色彩的第三层。L1 品牌红只管控件，L2 灰阶定层级，L3 由当前封面实时算出来，
       只铺在大面积表面上（色带 / 歌词 wash / 播放条）——这样"强调色"永远不跟封面打架。
       参数抄自 AndroidX Palette 的公开实现：权重 .24 占比 / .52 饱和 / .24 明度，
       36×10° 色相桶，vibrant 饱和下限 .35，darkvibrant 目标明度 .26。
       只读像素，不落地封面原图，也不落地任何文本。 */

    const ART_SAMPLE = 56 // 56×56=3136 像素，单次遍历实测 2–6ms
    const HUE_BUCKETS = 36

    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

    function rgbToHsl(r, g, b) {
      r /= 255; g /= 255; b /= 255
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const l = (max + min) / 2
      const d = max - min
      let h = 0
      let s = 0
      if (d > 1e-6) {
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
        if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
        else if (max === g) h = (b - r) / d + 2
        else h = (r - g) / d + 4
        h *= 60
      }
      return [h, s, l]
    }

    function hslToRgb(h, s, l) {
      const hn = (((h % 360) + 360) % 360) / 360
      const a = s * Math.min(l, 1 - l)
      const f = (n) => {
        const k = (n + hn * 12) % 12
        return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))
      }
      return [Math.round(f(0) * 255), Math.round(f(4) * 255), Math.round(f(8) * 255)]
    }

    const hslToHex = (h, s, l) => '#' + hslToRgb(h, s, l)
      .map((v) => clamp(v, 0, 255).toString(16).padStart(2, '0')).join('')

    /** WCAG 相对亮度：决定色带上该用深字还是浅字，而不是凭感觉。 */
    function srgbLuminance(r, g, b) {
      const f = (v) => {
        const x = v / 255
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
      }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    function hslLuminance(h, s, l) {
      const c = hslToRgb(h, s, l)
      return srgbLuminance(c[0], c[1], c[2])
    }

    const wcagContrast = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)

    /** 中心方形裁切后缩到 ART_SAMPLE²：封面信息集中在中间，四角常是留白和文案。 */
    function sampleArtPixels(src) {
      const w = src.naturalWidth || src.width
      const h = src.naturalHeight || src.height
      if (!w || !h) return null
      const side = Math.min(w, h)
      const canvas = document.createElement('canvas')
      canvas.width = ART_SAMPLE
      canvas.height = ART_SAMPLE
      const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false })
      if (ctx === null) return null
      ctx.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, ART_SAMPLE, ART_SAMPLE)
      try {
        return ctx.getImageData(0, 0, ART_SAMPLE, ART_SAMPLE).data
      } catch {
        // 画布被跨域封面污染：这是最需要知道的一种失败，单独计数而不是静默返回 null
        artDiag.tainted++
        return null
      }
    }

    const newBucket = () => ({ sin: 0, cos: 0, sSum: 0, lSum: 0, pop: 0 })

    function bucketPixels(data) {
      const buckets = []
      for (let i = 0; i < HUE_BUCKETS; i++) buckets.push(newBucket())
      const total = data.length / 4
      const gray = newBucket()

      for (let p = 0; p < total; p++) {
        const o = p * 4
        if (data[o + 3] < 250) continue // 透明/半透明不算信息
        const [h, s, l] = rgbToHsl(data[o], data[o + 1], data[o + 2])
        if (l <= 0.05 || l >= 0.95) continue // 纯黑纯白没有色相可言
        if (s < 0.08) { // 近中性色单独攒着，用于判断"这张封面根本没有色彩"
          gray.sSum += s; gray.lSum += l; gray.pop++
          continue
        }
        const b = buckets[Math.floor(h / (360 / HUE_BUCKETS)) % HUE_BUCKETS]
        const rad = h * Math.PI / 180
        b.sin += Math.sin(rad)
        b.cos += Math.cos(rad) // 色相走向量平均，否则 350° 与 10° 会相互抵消成"品红"
        b.sSum += s; b.lSum += l; b.pop++
      }

      const out = []
      for (const bk of buckets) {
        if (!bk.pop) continue
        if (bk.pop / total < 0.015) continue // 占比 <1.5% 是噪点
        let hue = Math.atan2(bk.sin, bk.cos) * 180 / Math.PI
        if (hue < 0) hue += 360
        out.push({ hue, s: bk.sSum / bk.pop, l: bk.lSum / bk.pop, pop: bk.pop / total })
      }
      return {
        candidates: out,
        gray: gray.pop ? { s: gray.sSum / gray.pop, l: gray.lSum / gray.pop, pop: gray.pop / total } : null,
      }
    }

    /** 亮度惩罚让「显眼」而不是「最艳」胜出——纯荧光色往往不是封面的主色。 */
    function swatchScore(c, sMin, sMax, lTarget, lSpread) {
      const satScore = Math.min(1, Math.max(0, c.s - sMin) / (sMax - sMin + 1e-6))
      const lumScore = Math.max(0, 1 - Math.abs(c.l - lTarget) / lSpread)
      return c.pop * 0.24 + satScore * 0.52 + lumScore * 0.24
    }

    function pickSwatch(list, sMin, sMax, lTarget, lSpread) {
      let best = null
      let bestScore = -1
      for (const c of list) {
        if (c.s < sMin) continue
        if (c.l < 0.06 || c.l > 0.96) continue
        const sc = swatchScore(c, sMin, sMax, lTarget, lSpread)
        if (sc > bestScore) { bestScore = sc; best = c }
      }
      return best
    }

    function extractArt(img) {
      const data = sampleArtPixels(img)
      if (data === null) return null
      const { candidates, gray } = bucketPixels(data)
      // 一个候选色都没有**不等于**没法取色：黑白/灰度封面（实测「民谣盛宴」那张：中心 64² 里
      // 1212 像素中性、2884 像素近黑近白、有彩 0）就该走 gray 这条路 —— buildArtTokens 里
      // 早就写好了中性分支，原来在这里被 `return null` 拦住，等于让"无色封面"永远掉回 L2 粉底，
      // 既丢了封面的明度，又让"取色丢了"和"封面本来就没色"这两件事在守卫眼里长得一模一样。
      // empty 只留给**真的什么都没有**的封面（整张纯黑/纯白/全透明）。
      if (candidates.length === 0 && !gray) { artDiag.empty++; return null }
      if (candidates.length === 0) artDiag.gray++
      const sorted = candidates.slice().sort((a, b) => (b.pop * b.s) - (a.pop * a.s))
      return {
        vibrant: pickSwatch(candidates, 0.35, 1, 0.55, 0.45),
        lightVibrant: pickSwatch(candidates, 0.25, 1, 0.78, 0.45),
        darkVibrant: pickSwatch(candidates, 0.35, 1, 0.26, 0.45),
        muted: pickSwatch(candidates, 0.12, 0.5, 0.5, 0.55),
        darkMuted: pickSwatch(candidates, 0.1, 0.45, 0.26, 0.45),
        prominent: sorted[0] || null,
        gray,
      }
    }

    const tone = (sw, sMin, sMax, lMin, lMax) => (sw === null || sw === undefined
      ? null
      : { h: sw.hue, s: clamp(sw.s, sMin, sMax), l: clamp(sw.l, lMin, lMax) })

    /** 深色主题下艺术色要降饱和、压暗，否则会在 #121212 这类新黑表面上发荧。 */
    const darkSurface = (h, s, l) => ({ h, s: clamp(s * 0.78, 0.14, 0.62), l: clamp(l * 0.42, 0.12, 0.32) })

    /**
     * 提取值 -> 七个 --art-* 令牌。band 单独映射：
     * 浅色把艺术色「粉彩化」（提亮 + 降饱和）配固定深字，这才像网易云的轻快，
     * 也让 12–14px 副标题真的过 4.5:1；深色压暗降饱和配 #f5f5f5，能平滑融回 #121212。
     */
    function buildArtTokens(sw, mode) {
      const v = sw.vibrant || sw.prominent || sw.lightVibrant || sw.darkVibrant
        || (sw.gray ? { hue: 220, s: Math.min(0.2, sw.gray.s * 2), l: clamp(sw.gray.l, 0.3, 0.5) } : null)
      if (!v) return null
      const d = sw.darkVibrant || sw.darkMuted || v
      const light = mode === 'light'

      const vivid = light ? tone(v, 0.32, 0.66, 0.42, 0.6) : tone(v, 0.28, 0.6, 0.34, 0.56)
      const deep = light
        ? { h: vivid.h, s: clamp(vivid.s * 0.5, 0.08, 0.34), l: clamp(vivid.l * 0.32, 0.14, 0.26) }
        : darkSurface(vivid.h, vivid.s, vivid.l)
      const wash = light
        ? { h: vivid.h, s: clamp(vivid.s * 0.55, 0.1, 0.4), l: clamp(vivid.l * 1.05, 0.5, 0.78) }
        : tone(d, 0.2, 0.5, 0.22, 0.42)
      // tint 是"给小字当地板"的那一层，所以它的亮度必须锁死：
      // 浅色态 l=.94（最坏 #eaeaf6，13px 灰字还有 4.9:1），
      // 暗色态原先是 .16，实测叠 70% 后底色升到 #172c26，把 fg-3 从 5.59 拖到 4.40（不达标）；
      // 压到 .115 且降饱和，让暗色 tint 只比 #121212 亮一点点，灰阶才有活路。
      const tint = { h: vivid.h, s: clamp(vivid.s * 0.55, 0.08, 0.3), l: light ? 0.94 : 0.115 }
      const band = light
        ? { h: vivid.h, s: clamp(vivid.s * 0.72, 0.16, 0.46), l: clamp(0.7 + (vivid.l - 0.5) * 0.26, 0.66, 0.82) }
        : { h: vivid.h, s: clamp(vivid.s * 0.86, 0.24, 0.5), l: clamp(vivid.l * 0.62, 0.22, 0.32) }
      const highlight = light
        ? { h: vivid.h, s: clamp(vivid.s * 0.75, 0.15, 0.5), l: 0.72 }
        : { h: vivid.h, s: clamp(vivid.s * 0.9, 0.2, 0.72), l: 0.78 }

      // 判据里的"黑"和"白"必须就是**真正画上去**的那两个墨色。
      // 之前写的是 hslLuminance(0,0,0.09) = #171717 —— 比实际用的 #101012 亮一档，
      // 于是 #d04986 这类中间色被判成"黑字 4.25 不达标"→ 换成白字，而白字实测只有 3.87:1
      // （色带/磁贴守卫第一次跑就抓到了）。判定和画面共用一套账，才不会互相骗。
      const INK_DARK = '#101012'
      const INK_LIGHT = '#f5f5f5'
      const blackL = srgbLuminance(16, 16, 18)
      const whiteL = srgbLuminance(245, 245, 245)
      /**
       * (底色, 前景) 这一对**真的**达标，而不只是"挑了个相对好的"：
       * 先按对比度挑墨色，若两边都不够（亮度落在 [0.164, 0.198] 死区：实测 #b06a2c
       * 黑字 4.49、白字 3.89，两边都不达标），就朝选中那一侧挪明度，直到 >= 4.5。
       */
      const pairUp = (c, cap) => {
        const pick = () => (wcagContrast(hslLuminance(c.h, c.s, c.l), blackL)
          >= wcagContrast(hslLuminance(c.h, c.s, c.l), whiteL) ? INK_DARK : INK_LIGHT)
        let ink = pick()
        const need = () => (ink === INK_DARK
          ? wcagContrast(hslLuminance(c.h, c.s, c.l), blackL)
          : wcagContrast(hslLuminance(c.h, c.s, c.l), whiteL))
        const step = ink === INK_DARK ? 0.015 : -0.015
        for (let i = 0; i < 20 && need() < 4.5; i++) {
          const next = clamp(c.l + step, 0.06, cap)
          if (next === c.l) break
          c.l = next
          ink = pick()
        }
        return ink
      }

      let onBand
      if (light) {
        // 抬明度直到深字达标，而不是"差不多能读"就交出去
        for (let i = 0; i < 12 && wcagContrast(hslLuminance(band.h, band.s, band.l), blackL) < 4.5; i++) {
          band.l = Math.min(0.92, band.l + 0.02)
        }
        onBand = pairUp(band, 0.92)
      } else {
        onBand = pairUp(band, 0.92)
      }
      const bandLum = hslLuminance(band.h, band.s, band.l)

      // 磁贴是"饱和色块"，和色带一样**自带**一个在这块面上达标的前景色。
      // 为什么不直接复用 onBand：onBand 的 4.5:1 只对 band 那个明度做过保证，
      // 换一块底色（原型就是这么干的：把 var(--art-on) 写到 vivid→deep 的渐变上）
      // 保证立刻作废。判据同一条：黑/白二选一，两边都不够就把面色挪出死区。
      const tile = light ? tone(v, 0.44, 0.82, 0.44, 0.58) : tone(v, 0.34, 0.7, 0.24, 0.4)
      const onTile = pairUp(tile, 0.92)
      const tileLum = hslLuminance(tile.h, tile.s, tile.l)

      // 全屏歌词是一块**沉浸式**表面：不管宿主是浅色还是深色，地板都必须够暗、字必须是亮墨。
      // 为什么不再走 L2 的白地板：歌词区占半屏，白底杵在彩色封面旁边就是用户三次反馈的"太突兀"；
      // 而把白地板染色（先试 12%，再退 9%）会立刻撞上另一条账 —— 已唱行只有 3:1 的余量，
      // 底色一深就判红（实测 2.98）。**换墨色方向**才是解：地板压暗到白字 ≥8:1，
      // "带色"和"读得清"就不再互相挤，深色主题下也天然一致。
      const np = { h: deep.h, s: clamp(deep.s * 1.05, 0.12, 0.46), l: clamp(deep.l * 0.86, 0.05, 0.19) }
      for (let i = 0; i < 16 && wcagContrast(hslLuminance(np.h, np.s, np.l), whiteL) < 8; i++) {
        np.l = Math.max(0.035, np.l - 0.015)
      }
      const npLum = hslLuminance(np.h, np.s, np.l)

      return {
        mode,
        band: hslToHex(band.h, band.s, band.l),
        vivid: hslToHex(vivid.h, vivid.s, vivid.l),
        deep: hslToHex(deep.h, deep.s, deep.l),
        wash: hslToHex(wash.h, wash.s, wash.l),
        tint: hslToHex(tint.h, tint.s, tint.l),
        highlight: hslToHex(highlight.h, highlight.s, highlight.l),
        tile: hslToHex(tile.h, tile.s, tile.l),
        npFloor: hslToHex(np.h, np.s, np.l),
        npContrast: +(wcagContrast(npLum, whiteL)).toFixed(2),
        onTile,
        tileContrast: +(onTile === '#f5f5f5'
          ? wcagContrast(tileLum, whiteL)
          : wcagContrast(tileLum, blackL)).toFixed(2),
        onBand,
        bandContrast: +(onBand === '#f5f5f5'
          ? wcagContrast(bandLum, whiteL)
          : wcagContrast(bandLum, blackL)).toFixed(2),
      }
    }

    /**
     * 一次像素扫描 -> 浅/深**两套**令牌（buildArtTokens 不写任何外部状态，调两次是安全的）。
     * 为什么不再按主题各取一次色：宿主翻主题是同一帧写完 body[data-ds-dark-theme] 的，
     * 而"再取一次色"要等网络 + 解码（实测 0.4–1.1s）。那段时间里播放条/选中行拿**旧主题**的
     * tint 去混**新主题**的底，墨却已经跟着主题翻了 —— ink 腿实测掉到 4.13:1。
     * 两套都在手，翻主题就只是级联里换一次引用：同帧、零延迟、不经过任何 JS。
     */
    function buildArtPair(sw) {
      const light = buildArtTokens(sw, 'light')
      const dark = buildArtTokens(sw, 'dark')
      return light && dark ? { light, dark } : null
    }

    // 降级路径全部收敛到 null：页面回到 L2 中性表面，绝不出现灰块或半透明脏色。
    // 每个计数都必须对应一条**能看到的**失败：没有计数的 catch 等于把异常藏起来（静默的假绿）。
    const artDiag = { ok: 0, gray: 0, tainted: 0, empty: 0, threw: 0, imgError: 0, timeout: 0 }
    const artCache = new Map() // url -> {light,dark}（只存稳定结论）
    const artPending = new Map()
    /**
     * 把计数写成属性。React 只在别的状态变化时才重渲染，取色完成本身不触发渲染，
     * 所以这个"观测点"以前是**首屏快照**：跑完再读永远是 0，等于没有。
     * 直接写 DOM，读的时候才是真数字。
     */
    const pushDiag = () => {
      const el = document.querySelector('.wyy-page')
      if (el) el.setAttribute('data-art-diag', JSON.stringify(artDiag))
    }

    /** 采样用 140px 缩略图：一次提取只需 3136 像素，拉 600px 原图是白白的流量。 */
    const artSampleUrl = (url) => (/[?&]param=/.test(url)
      ? url
      : url + (url.includes('?') ? '&' : '?') + 'param=140y140')

    /**
     * 取一张封面的艺术色（两套一起）。**失败不进缓存**：网络抖一下不该被记一辈子 ——
     * 实测"我的歌单"那张封面在 display <img> 已经加载出来的情况下仍然没染上色，就是
     * 旧的 10s 超时把 null 缓存死了（第二次进同一个视图也不会再试）。现在超时/加载错误
     * 只记录不缓存，并按下面的退避表再试；都失败才交回 null -> L2 兜底。
     * 退避是实测逼出来的：封面 CDN 会**成片**卡 6s 以上（一次会话 data-art-diag 里 timeout
     * 3~7 笔，0.2.0-rc.1 上两条取色红腿就是这么来的），"立刻重发"落在同一个卡顿窗里等于
     * 没重试 —— 这一首的色就一直空到下次换歌。0 / 3s / 9s 再各试一次：网络缓过来色就补上，
     * 真拿不到仍回 L2（结论不进缓存，下次挂载/换歌会重新试）。
     * 缓存键是**封面 url 本身**（不是 url|mode）：一次提取已经把两套都算出来了。
     */
    function loadArt(url) {
      const key = url
      if (artCache.has(key)) return Promise.resolve(artCache.get(key))
      if (artPending.has(key)) return artPending.get(key)
      const attempt = () => new Promise((resolve) => {
        let settled = false
        // transient = 网络层的抖动（超时/加载错误），结论不稳定，**不写缓存**
        const done = (pair, transient) => {
          if (settled) return
          settled = true
          if (!transient) artCache.set(key, pair)
          resolve({ pair, transient })
        }
        const img = new Image()
        // 网易云 CDN 的 ACAO 头只随 GET 下发（HEAD 没有），所以必须走 <img> 而不是 fetch HEAD 预判
        img.crossOrigin = 'anonymous'
        img.decoding = 'async'
        img.onload = () => {
          let pair = null
          try {
            const sw = extractArt(img)
            pair = sw === null ? null : buildArtPair(sw)
          } catch { pair = null; artDiag.threw++; pushDiag() } // 任何像素层的意外都不该让面板崩
          if (pair) artDiag.ok++
          pushDiag()
          // 拿到了色，或确认这张封面根本没有色彩（empty 已计数）：结论稳定，写缓存
          done(pair, false)
        }
        img.onerror = () => { artDiag.imgError++; pushDiag(); done(null, true) }
        // 网络挂起时别把这条 key 永远卡在 pending。计数只在真的没落定时加，
        // 否则每张成功封面 6 秒后都会给 timeout 记一笔假账（实测踩过）。
        setTimeout(() => { if (!settled) { artDiag.timeout++; pushDiag(); done(null, true) } }, 6000)
        img.src = artSampleUrl(url)
      })
      const backoff = [0, 3000, 9000]
      const p = (async () => {
        for (let i = 0; i <= backoff.length; i++) {
          if (i > 0) await new Promise((r) => setTimeout(r, backoff[i - 1]))
          const r = await attempt()
          if (!r.transient) return r.pair
        }
        return null
      })()
      artPending.set(key, p)
      p.then(() => { artPending.delete(key) })
      return p
    }

    /** 宿主的暗色钩子是 body[data-ds-dark-theme]，由宿主主题插件写；这里只跟随，不提供开关。 */
    function useDsDark() {
      const read = () => document.body.hasAttribute('data-ds-dark-theme')
      const [dark, setDark] = useState(read)
      useEffect(() => {
        const ob = new MutationObserver(() => setDark(read()))
        ob.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
        return () => ob.disconnect()
      }, [])
      return dark
    }

    /**
     * 两套令牌 -> React style。写的是**带后缀的源令牌**（-l / -d）：活跃令牌在样式表里
     * 用 var() 指向当前主题那一套，所以换主题只是引用替换（同帧），换歌才是这两组一起过渡。
     * 没取到色就返回空对象，让 CSS 里的 L2 默认值接手。
     */
    function artStyle(pair) {
      if (!pair) return {}
      const { light, dark } = pair
      return {
        '--art-band-l': light.band, '--art-band-d': dark.band,
        '--art-vivid-l': light.vivid, '--art-vivid-d': dark.vivid,
        '--art-deep-l': light.deep, '--art-deep-d': dark.deep,
        '--art-wash-l': light.wash, '--art-wash-d': dark.wash,
        '--art-tint-l': light.tint, '--art-tint-d': dark.tint,
        '--art-highlight-l': light.highlight, '--art-highlight-d': dark.highlight,
        '--art-on-l': light.onBand, '--art-on-d': dark.onBand,
        '--art-tile-l': light.tile, '--art-tile-d': dark.tile,
        '--art-on-tile-l': light.onTile, '--art-on-tile-d': dark.onTile,
        '--np-floor-l': light.npFloor, '--np-floor-d': dark.npFloor,
      }
    }

    /**
     * 一张封面的艺术色。返回 { style, state, tokens }：state ∈ pending|ok|none，
     * 铺到 data-art 上作为"取色真的跑通了"的可测证据。
     * 依赖里**没有 mode**：主题翻转是样式表自己的事，这里不该重取色（也就没有翻转那一帧的空窗）。
     */
    function useArt(coverUrl) {
      const [tk, setTk] = useState(null)
      const [state, setState] = useState(coverUrl ? 'pending' : 'none')
      useEffect(() => {
        if (!coverUrl) { setTk(null); setState('none'); return undefined }
        let alive = true
        setState('pending')
        const run = () => {
          loadArt(coverUrl).then((pair) => {
            if (!alive) return
            setTk(pair) // 失败时清空旧色，回落到 L2；成功时直接换上新封面的色
            setState(pair ? 'ok' : 'none')
          })
        }
        // 取色是纯 CPU 活，排到空闲帧，别和首屏几十张封面图的解码抢主线程
        if (typeof window.requestIdleCallback === 'function') {
          const id = window.requestIdleCallback(run, { timeout: 1500 })
          return () => { alive = false; window.cancelIdleCallback(id) }
        }
        const timer = setTimeout(run, 80)
        return () => { alive = false; clearTimeout(timer) }
      }, [coverUrl])
      return { style: artStyle(tk), state, tokens: tk }
    }

    // =================================================================
    // 氛围引擎（Ambient）—— 跨越插件窗口的 app 级子系统
    //
    // 名字里的"突破窗口"是字面意思：插件自己的面板在 main 槽里，切到对话就被卸载；
    // 这三样效果必须活在**面板之外**，所以它们挂的是宿主 layout 的 shell.overlay
    // （全窗绝对定位层，z-index 20，自己 pointer-events:none），与 main 面板互不依赖。
    //
    // 分区（三块只通过总线对话，谁都不 import 谁）：
    //   A 总线：A0 设置（宿主 prefs 持久化）/ A1 调色板（当前曲目艺术色）/ A2 音频（只读频谱抽头）
    //   B 效果：氛围背景（frame 下的独立节点）/ 律动条 / 聚光灯 / 打字音符 —— 各自独立开关
    //   C 控制：插件页左栏底部 2 个快捷开关 + 1 个设置入口；AmbientSettings 是设置面板本体
    //
    // 内存与主线程预算是这里的硬约束（用户点名要求"占内存少的方式"）：
    //   不做 canvas、不做逐帧全屏 filter/blur、不建像素缓冲；
    //   只有一张缓慢漂移的背景封面 + 72 根柱子，全部写成 GPU 合成的 transform；
    //   rAF 只在「总开关开 + 有对应效果」时跑，播放中 30fps、暂停后 80fps→12.5fps 降频。
    // =================================================================

    // ---- A0. 设置（宿主 prefs 的 ambient 字段是持久层；这里的内存副本永远先生效）----
    // 默认值与 lib/index.js 的 AMB_DEFAULTS **必须一致**：两份不同就会出现
    // "宿主没起来 vs 起来了"两条路上刷新后长得不一样。
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

    /** 客户端侧的同一套白名单/clamp（宿主那份是权威，这份只保证"本地改的也不会越界"）。 */
    const ambClean = (v) => {
      const out = {}
      if (v === null || typeof v !== 'object') return out
      for (const k of AMB_BOOLS) if (v[k] === true || v[k] === false) out[k] = v[k]
      for (const k of Object.keys(AMB_NUMS)) {
        const n = Number(v[k])
        if (Number.isFinite(n)) out[k] = Math.min(AMB_NUMS[k][1], Math.max(AMB_NUMS[k][0], Math.round(n)))
      }
      for (const k of Object.keys(AMB_ENUMS)) if (AMB_ENUMS[k].indexOf(v[k]) >= 0) out[k] = v[k]
      return out
    }

    const amb = {
      s: Object.assign({}, AMB_DEFAULTS),
      subs: new Set(),
      saveTimer: 0,
      loaded: false,
      subscribe(fn) {
        amb.subs.add(fn)
        return () => amb.subs.delete(fn)
      },
      /** 局部更新：只传改动项（宿主也是逐项合并，整体覆盖会把别的设置打回默认）。 */
      apply(patch) {
        const clean = ambClean(patch)
        amb.s = Object.assign({}, amb.s, clean)
        for (const fn of amb.subs) fn(amb.s)
        amb.persist(clean)
      },
      toggle(k) { amb.apply({ [k]: !amb.s[k] }) },
      /** 面板拖滑块时每帧都会调：合并进一次写盘，300ms 收口。 */
      persist(patch) {
        if (Object.keys(patch).length === 0) return
        amb.pending = Object.assign({}, amb.pending, patch)
        if (amb.saveTimer !== 0) window.clearTimeout(amb.saveTimer)
        amb.saveTimer = window.setTimeout(() => {
          amb.saveTimer = 0
          const body = amb.pending
          amb.pending = {}
          api('/prefs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ambient: body }) })
            .catch(() => { /* 存不下只影响"下次进来是默认" —— 本次会话仍然按内存副本跑 */ })
        }, 300)
      },
      pending: {},
      /** 宿主 GET /prefs 的结果回填。只在用户没动过任何开关时覆盖（避免刚点开关就被回包打回）。 */
      hydrate(v) {
        if (amb.loaded) return
        amb.loaded = true
        const clean = ambClean(v)
        if (Object.keys(clean).length === 0) return
        amb.s = Object.assign({}, AMB_DEFAULTS, clean)
        for (const fn of amb.subs) fn(amb.s)
      },
    }

    // ---- A1. 调色板总线：当前曲目的艺术色（复用 L3 取色，不新增一次像素遍历）----
    const ambArt = {
      pair: null,
      cover: '',
      key: '',
      subs: new Set(),
      subscribe(fn) {
        ambArt.subs.add(fn)
        return () => ambArt.subs.delete(fn)
      },
      publish(pair) {
        ambArt.pair = pair
        for (const fn of ambArt.subs) fn(pair)
      },
    }

    let ambArtOff = null
    /** 跟随播放器换歌取色。**与面板是否挂载无关** —— 对话界面里也要跟着变色，就靠这一条。 */
    function startAmbArt() {
      if (ambArtOff !== null) return
      const sync = () => {
        const s = player.state
        const song = s.idx >= 0 && s.idx < s.queue.length ? s.queue[s.idx] : null
        const key = song && song.cover ? song.cover : ''
        if (key === ambArt.key) return
        ambArt.key = key
        ambArt.cover = key // 背景层要的是**封面本身**（模糊后铺底），所以 url 也得发布出去
        // 换歌了：重挂额度清零（上一首用完 3 次不该影响这一首）
        ambRetaps = 0
        ambSilentFrames = 0
        if (key === '') { ambArt.publish(null); return }
        // loadArt 自带缓存与"失败不缓存"策略：面板那边也已经取过一次，通常这里直接命中
        loadArt(key).then((pair) => { if (ambArt.key === key) ambArt.publish(pair) })
      }
      ambArtOff = player.subscribe(sync)
      sync()
    }
    function stopAmbArt() {
      if (ambArtOff !== null) ambArtOff()
      ambArtOff = null
    }

    // ---- B0. 背景层：**插在 frame 最底下**的取色底（用户点名的形态）----
    // 为什么"塞在底下"可行（实测，见 design/AMBIENT.md）：宿主 body/frame 有不透明白底，而对话那一列
    // （centerCol / [data-conversation-session] / scroll）的底色都是 rgba(0,0,0,0) —— 把自己插成
    // frame 的**第一个子节点**，它就透过透明的对话列显示出来；侧栏、输入卡这些自带底色的表面照旧盖住它。
    // 比"在顶上叠一层再混合"干净：normal 混合、不碰任何宿主节点、不挡点击。
    //
    // 形制照抄全屏歌词那套（用户要的就是它）：模糊+加饱和的封面 + 取色地板，整层默认 60% 不透明度。
    const ambBackdrop = {
      node: null,
      cover: null,
      floor: null,
      unsub: [],
      raf: 0,
      lastPaint: 0,
      lastKeep: 0,
      prev: [0, 0],
      prevK: 1.14,
      reduced: false,
      cleared: [], // 被我们临时让开的宿主底板（卸载时原样还回去）
    }

    /** 量出"中间那一列"的左右边界（frame 里最宽的那一列；侧栏/右侧栏都比它窄，拖拽把手只有 8px）。
    自家那两层（背景层、overlay 层）必须显式跳过 —— 它们也是 frame 的子节点且更宽，
    不跳就会把自己量成"对话列"（实测踩过：范围设置因此永远算出 left=0）。 */
    function ambMeasureCols(frame, self) {
      if (frame === null) return { left: 0, right: 0 }
      const orect = frame.getBoundingClientRect()
      let best = null
      for (const kid of frame.children) {
        if (kid === self || kid.contains(self) || self.contains(kid)) continue
        if (kid.hasAttribute('data-amb-bg-root') || kid.hasAttribute('data-shell-overlay')) continue
        const r = kid.getBoundingClientRect()
        if (r.width < 80) continue
        if (best === null || r.width > best.w) best = { l: r.left, w: r.width }
      }
      if (best === null) return { left: 0, right: 0 }
      return {
        left: Math.max(0, Math.round(best.l - orect.left)),
        right: Math.max(0, Math.round(orect.right - (best.l + best.w))),
      }
    }

    function ambBackdropPaintColors() {
      const node = ambBackdrop.node
      if (node === null) return
      node.setAttribute('data-amb-cover', ambArt.cover === '' ? 'none' : 'ok')
      if (ambBackdrop.cover !== null && ambArt.cover !== '') {
        ambBackdrop.cover.style.backgroundImage = 'url("' + ambArt.cover + '")'
      }
      const pair = ambArt.pair
      if (pair === null) return
      const put = (n, l, d) => {
        if (l) node.style.setProperty('--amb-c' + n + '-l', l)
        if (d) node.style.setProperty('--amb-c' + n + '-d', d)
      }
      put(1, pair.light.vivid, pair.dark.vivid)
      put(2, pair.light.highlight, pair.dark.highlight)
      put(3, pair.light.band, pair.dark.band)
      put(4, pair.light.deep, pair.dark.deep)
      // 地板底色：暗色直接用**压暗过的 npFloor**（= 全屏歌词的 --np-floor，同一个色）；
      // 浅色不能用 npFloor —— 那一支是给"深底浅字"的全屏歌词配的（实测：拿它铺浅色页面，
      // 正文对比度掉到 4.07，低于 4.5 的线）。浅色改用它自己的 band（亮调取色），
      // 颜色强度交给封面的模糊层 + 白纱去调，可读性优先。
      if (pair.light.band) node.style.setProperty('--amb-floor-l', pair.light.band)
      // 暗色的地板色要**再压一半**：npFloor 只保证"自家地板 + 白字 ≥8:1"（全屏歌词的账），
      // 铺到这儿还要被 55% 的白封面罩和黑纱乘一遍。probe-contrast 实测（白封面反证点法）：
      // 不压暗时，一张亮地板（rgb(150,180,155)，构造上取不到这么亮）在黑纱 .34 下 35% 处只有 4.13 ——
      // 光靠黑纱兜不住带色地板。压一半后，连"比可达上限还亮的灰"（rgb(80,80,80)＝npFloor 的
      // 8:1 推降边界，压暗后亮度仍高于任何真实地板）都有 5.34；真实地板 6.14。
      if (pair.dark.npFloor) node.style.setProperty('--amb-floor-d', 'color-mix(in oklab, ' + pair.dark.npFloor + ' 50%, #08080a)')
    }

    function ambBackdropLoop() {
      const node = ambBackdrop.node
      if (node === null || ambReduced()) { ambBackdrop.raf = 0; return } // reduced：保留静态背景，停掉漂移
      ambBackdrop.raf = window.requestAnimationFrame(ambBackdropLoop)
      const now = performance.now()
      const gap = ambAudio.active ? 33 : 80
      if (now - ambBackdrop.lastPaint < gap) return
      ambBackdrop.lastPaint = now
      // 位置迁移（用户最早那条"只迁移位置、不变颜色"）：模糊封面在缓慢漂 + 极缓的呼吸缩放。
      // 位移/缩放都按帧设上限 —— 和前景共用同一条频闪闸，任何一个包络爆掉都不会瞬移。
      const speed = amb.s.bgSpeed / 100
      // 这是一张**背景**：漂移要看得见（用户最早那条"位置迁移"），但不能抢戏。
      // 静止时 ~4% 幅度 / 25s 周期 ≈ 20~30px/s 的慢漂；拍上把幅度再顶起来。
      const ph = now / 1000 * (0.16 + speed * 0.22)
      const amp = 4.2 + ambAudio.ampEnv * 2.2
      const env = 0.55 + 0.45 * ambAudio.moveEnv
      const tx0 = Math.sin(ph) * amp * env
      const ty0 = Math.cos(ph * 0.77) * amp * 0.8 * env
      let tx = tx0
      let ty = ty0
      const dx = tx - ambBackdrop.prev[0]
      const dy = ty - ambBackdrop.prev[1]
      const d = Math.sqrt(dx * dx + dy * dy)
      const maxStep = 0.35 // %/帧
      if (d > maxStep) {
        tx = ambBackdrop.prev[0] + (dx / d) * maxStep
        ty = ambBackdrop.prev[1] + (dy / d) * maxStep
      }
      ambBackdrop.prev[0] = tx
      ambBackdrop.prev[1] = ty
      let k = 1.14 + ambAudio.moveEnv * 0.02
      if (k > ambBackdrop.prevK + 0.004) k = ambBackdrop.prevK + 0.004
      else if (k < ambBackdrop.prevK - 0.004) k = ambBackdrop.prevK - 0.004
      ambBackdrop.prevK = k
      if (ambBackdrop.cover !== null) {
        ambBackdrop.cover.style.transform = 'translate3d(' + tx.toFixed(2) + '%,' + ty.toFixed(2) + '%,0) scale(' + k.toFixed(3) + ')'
      }
      // 低频兜底：React 重渲染可能把新节点插到我们前面（那样就不再"在最底下"了）。2Hz 里核一次位置，
      // 掉了就塞回去 —— 父节点不变时 insertBefore 是廉价的，不改任何宿主节点的内容。
      if (now - ambBackdrop.lastKeep > 500) {
        ambBackdrop.lastKeep = now
        const frame = node.parentElement
        if (frame !== null && frame.firstElementChild !== node) frame.insertBefore(node, frame.firstChild)
        const cols = ambMeasureCols(frame, node)
        node.style.setProperty('--amb-left', cols.left + 'px')
        node.style.setProperty('--amb-right', cols.right + 'px')
        ambClearCovers() // 视图切换/换主题后宿主可能重新画上底板：跟着再让一次
        ambBlendSurfaces() // 新来的消息也要融入（每个元素只体检一次，代价很低）
        ambComposerRetint() // 输入框那一带：卡片 + 它底下的那条渐变底板
      }
    }

    function ambBackdropUnmount() {
      ambRestoreCovers()
      ambBlendRestore()
      if (ambBackdrop.raf !== 0) { window.cancelAnimationFrame(ambBackdrop.raf); ambBackdrop.raf = 0 }
      for (const fn of ambBackdrop.unsub) { try { fn() } catch { /* ignore */ } }
      ambBackdrop.unsub = []
      const node = ambBackdrop.node
      if (node !== null && node.parentNode !== null) node.parentNode.removeChild(node)
      ambBackdrop.node = null
      ambBackdrop.cover = null
      ambBackdrop.floor = null
    }

    /** 找出"对话列里到底是谁在画底"，并把它临时让开。
    宿主的表面常自带不透明白底（浅色主题尤其明显）：我们插在最底下的层会被它整块盖住 ——
    实测现象就是用户描述的"只有上方那个板块有色，下面全白"（那条腿的像素采样：12% 处差 23，35/62/85% 处差 0）。
    做法：在对话列里取几个采样点，`elementsFromPoint` 自上而下找**第一个不透明、且覆盖了大半列**的元素，
    把它的背景临时改成透明（原值记下来，卸载时原样还回去）。卡片/按钮/正文不满足"覆盖大半列"，一律不碰。 */
    function ambClearCovers() {
      const node = ambBackdrop.node
      if (node === null || node.parentElement === null) return
      // 采样范围 = **我们这一层的实际矩形**（它自己就是 scope 的体现）：scope=frame 时覆盖整窗，
      // 侧栏那块不透明底也会被认出来并让开；scope=convo 时只在对话列里找。
      const rect = node.getBoundingClientRect()
      if (rect.width < 80 || rect.height < 80) return
      const pts = [[0.06, 0.12], [0.06, 0.62], [0.5, 0.85], [0.94, 0.3], [0.94, 0.7]]
      for (const [fx, fy] of pts) {
        const x = rect.left + rect.width * fx
        const y = rect.top + rect.height * fy
        const stack = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(x, y) : []
        for (const el of stack) {
          if (el === node || el.contains(node) || node.contains(el)) continue
          if (el === document.body || el === document.documentElement) continue
          // 自家面板（全屏歌词、队列抽屉、登录弹窗）绝不许动：它们盖在采样点上时，
          // elementsFromPoint 会先命中它们，把它们的底清成透明 —— 实测就是"开全屏歌词时
          // 那块背景突然透了"（用户报的现象）。fixed 的覆盖层同理，一律跳过。
          if (el.closest !== undefined && el.closest('.wyy-page, .wyy-np, .wyy-modal-mask') !== null) continue
          if (getComputedStyle(el).position === 'fixed') continue
          const s = getComputedStyle(el)
          const opaque = s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent'
          const hasImg = s.backgroundImage !== 'none'
          if (!opaque && !hasImg) continue
          const r = el.getBoundingClientRect()
          if (r.width < rect.width * 0.6 || r.height < rect.height * 0.5) continue
          if (ambBackdrop.cleared.some((c) => c.el === el)) break
          ambBackdrop.cleared.push({
            el,
            background: el.style.background,
            backgroundImage: el.style.backgroundImage,
            backgroundColor: el.style.backgroundColor,
          })
          el.style.background = 'transparent'
          el.setAttribute('data-amb-cleared', '1')
          break
        }
      }
    }

    /**
     * 让对话里的**小表面**（我发出的消息气泡、变量名/文件名芯片）融入背景：
     * 它们是不透明的白色圆角矩形，压在我们的取色底上就是一块块"贴纸"（用户点名的现象）。
     * 做法与"让开大表面"同族：运行时**按特征**认出来（圆角 + 不透明浅底 + 尺寸像气泡/芯片 +
     * 不是控件），打一个属性标记，由样式表把底色换成半透明 —— 用户要的是"融入"，不是"消失"，
     * 所以走半透明而不是透明。每个元素只体检一次（WeakSet），2Hz 复查以接住新来的消息。
     */
    const ambBlendSeen = typeof WeakSet === 'function' ? new WeakSet() : null
    const ambBlendTagged = new Set()
    function ambBlendSurfaces() {
      const col = document.querySelector('[data-conversation-scroll]')
        || document.querySelector('[data-conversation-session]')
      if (col === null || ambBlendSeen === null) return
      const dark = document.body.hasAttribute('data-ds-dark-theme')
      const nodes = col.querySelectorAll('div, span, p, code, pre')
      const cap = Math.min(nodes.length, 2000)
      for (let i = 0; i < cap; i++) {
        const el = nodes[i]
        if (ambBlendSeen.has(el)) continue
        ambBlendSeen.add(el)
        if (el.hasAttribute('data-wyy-amb-blend')) continue
        if (el.closest('.wyy-page, .wyy-np, .wyy-modal-mask') !== null) continue
        // 外层已经溶了就不再动里层：代码块的内层 <pre>、输入框卡片里的零件都归外层的令牌管
        if (el.closest('[data-wyy-amb-blend]') !== null) continue
        // 输入框那一带归 ambComposerRetint 管（卡片 '3' + 底板 '4'）。这条**必须先于**通用体检拦下：
        // 卡片本身就是"圆角 + 浅底 + 尺寸合适"，通用尺子会抢先把卡片标成 '1'，
        // 于是"卡片是否被单独认领"就永远看不出来了（实测踩过：标记=1 而不是 3）。
        if (el.closest('[data-composer-card]') !== null) continue
        if (el.matches('button, input, textarea, select, a, svg, img, [role="button"]')) continue
        const st = getComputedStyle(el)
        if (st.position === 'fixed') continue
        const bg = st.backgroundColor
        if (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') continue
        const r = el.getBoundingClientRect()
        // 代码表面用另一把尺子。用户点名的"变量名 / 代码块"**不是**圆角矩形：
        // 行内芯片窄（三个字 ≈ 40px）、代码块高（>420 的一抓一把），拿气泡那把尺子量必然全漏。
        // 识别改走宿主自己的标记（<code> / <pre> / .md-code-block），尺寸只做兜底。
        const code = el.tagName === 'CODE' || el.tagName === 'PRE' || el.classList.contains('md-code-block')
        if (code) {
          if (r.width < 12 || r.height < 12) continue
        } else {
          if (st.borderRadius === '0px') continue // "圆角矩形"是用户描述的形状，也是最好的判别特征
          if (r.width < 60 || r.height < 18 || r.height > 420) continue
        }
        const n = bg.split('(')[1].split(')')[0].split(',').map(Number)
        const lum = (0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2]) / 255
        if (dark ? lum > 0.42 : lum < 0.62) continue // 只洗浅底/暗底，彩色徽标与告警条不碰
        el.setAttribute('data-wyy-amb-blend', code ? '2' : '1')
        ambBlendTagged.add(el)
      }
    }

    /**
     * 输入框那一带（用户点名的第二处）。实测（0.1.7-rc.2 的客户端 bundle）：
     * 输入框卡片自己半透明了没用 —— 它**底下垫着一条 composerSeat 的 bg-base 渐变底板**
     * （`linear-gradient(180deg, transparent 0px, var(--dsw-alias-bg-base) 36px)`，sticky 在底部），
     * 透过卡片看到的还是那块白板，看上去就是"输入框还是没铺上背景"。
     * 做法：卡片认宿主自己的标记（[data-composer-card]）；底板则从卡片往上找**第一个自己在画底的祖先**
     * （不认类名 —— 那是构建期哈希的），打上标记后由样式表把那条渐变的颜色换成半透明：
     * 形状保留（滚过去的消息照样被压住），只让颜色透出来。
     */
    function ambComposerRetint() {
      const card = document.querySelector('[data-composer-card]')
      if (card === null) return
      const tag = (el, v) => {
        if (el.hasAttribute('data-wyy-amb-blend')) return
        el.setAttribute('data-wyy-amb-blend', v)
        ambBlendTagged.add(el)
      }
      if (card.closest('.wyy-page, .wyy-np, .wyy-modal-mask') === null) tag(card, '3')
      // 往上只走到 frame 之前（frame 的底色是宿主的地基，不是"盖在输入框上的东西"）
      const frame = ambBackdrop.node === null ? null : ambBackdrop.node.parentElement
      let el = card.parentElement
      for (let i = 0; el !== null && el !== frame && el !== document.body && el !== document.documentElement && i < 8; i++) {
        const st = getComputedStyle(el)
        const paints = st.backgroundImage !== 'none'
          || (st.backgroundColor !== 'rgba(0, 0, 0, 0)' && st.backgroundColor !== 'transparent')
        if (paints) {
          if (el.closest('.wyy-page, .wyy-np, .wyy-modal-mask') === null) tag(el, '4')
          break
        }
        el = el.parentElement
      }
    }

    function ambBlendRestore() {
      for (const el of ambBlendTagged) el.removeAttribute('data-wyy-amb-blend')
      ambBlendTagged.clear()
    }

    function ambRestoreCovers() {
      for (const c of ambBackdrop.cleared) {
        c.el.style.background = c.background
        c.el.style.backgroundImage = c.backgroundImage
        c.el.style.backgroundColor = c.backgroundColor
        c.el.removeAttribute('data-amb-cleared')
      }
      ambBackdrop.cleared.length = 0
    }

    function ambBackdropSync() {
      // 背景层不是 React 树里的东西，所以"系统偏好变了"要自己听（实测踩过：CDP 切 reduced 之后
      // 循环照跑，因为没人再调 sync）。reduced 下**保留**静态背景、只停漂移 —— 直接藏掉更糟：
      // 用户只是不想看动，不是不要氛围。
      if (ambMotionMq === null && typeof window.matchMedia === 'function') {
        ambMotionMq = window.matchMedia('(prefers-reduced-motion: reduce)')
        ambMotionMq.addEventListener('change', () => ambBackdropSync())
      }
      const on = amb.s.on && amb.s.bg
      const node = ambBackdrop.node
      if (!on) {
        if (node !== null) ambBackdropUnmount()
        return
      }
      if (node === null) {
        const overlay = document.querySelector('[data-shell-overlay]')
        const frame = overlay === null ? null : overlay.parentElement
        const el = document.createElement('div')
        el.className = 'wyy-amb-bg-root'
        el.setAttribute('data-amb-bg-root', '1')
        const floor = document.createElement('div')
        floor.className = 'wyy-amb-floor'
        const cover = document.createElement('div')
        cover.className = 'wyy-amb-cover'
        el.appendChild(floor)
        el.appendChild(cover)
        // 宿主里 frame 一定在；兜底挂 body 只为让不完整环境（jsdom）也能挂上并自证
        if (frame !== null) frame.insertBefore(el, frame.firstChild)
        else document.body.appendChild(el)
        ambBackdrop.node = el
        ambBackdrop.cover = cover
        ambBackdrop.floor = floor
        ambBackdropPaintColors()
        ambBackdrop.unsub.push(ambArt.subscribe(ambBackdropPaintColors))
        ambClearCovers()
        ambBlendSurfaces()
        ambComposerRetint()
      }
      const n = ambBackdrop.node
      n.setAttribute('data-amb-bg', 'on')
      n.setAttribute('data-amb-motion', ambReduced() ? 'reduced' : 'full')
      n.setAttribute('data-amb-scope', amb.s.bgScope)
      n.style.setProperty('--amb-strength', String(amb.s.bgStrength / 100))
      if (ambBackdrop.raf === 0 && !ambReduced()) ambBackdrop.raf = window.requestAnimationFrame(ambBackdropLoop)
      else if (ambReduced() && ambBackdrop.cover !== null) {
        // 静态位：与漂移的初值一致，切换过去不会"跳一下"
        ambBackdrop.cover.style.transform = 'translate3d(0%,0%,0) scale(1.14)'
      }
    }

    // ---- A2. 音频总线：captureStream + AnalyserNode（只读抽头）----
    // 绝不用 createMediaElementSource：那会把 <audio> 的媒体流**重路由**进 AudioContext，
    // 图里一断（或 ctx 被挂起）整首歌直接静音。captureStream 拿到的是同一路输出的副本，
    // 频谱只是它的一个只读旁支，读数字不影响出声。
    const AMB_BARS = 72
    // 静止底：拍与拍之间留一点慢漂，但不能"永远在动"（onetake 的 rests 规则）
    const AMB_REST = 0.18
    let ambAmpEnv = 0
    let ambMoveEnv = 0
    const ambAudio = {
      supported: true,
      // 挂抽头失败的原因（"unsupported" 是个结论，原因得能看见 —— 否则没法区分
      // "这个环境真没有 captureStream" 和"我这里写错了"）
      err: '',
      active: false,
      // 两条包络（曲线分角色的产物）：振幅快起慢落、运动随拍顶起再松弛。都留给仪器读。
      ampEnv: 0,
      moveEnv: 0,
      level: 0,
      beat: 0,
      beats: 0, // 累计重音数：留给仪器"真的在跟拍"的证据，别拿"看起来在动"当结论
      frames: 0,
      bands: new Float32Array(AMB_BARS),
      subs: new Set(),
      subscribe(fn) {
        ambAudio.subs.add(fn)
        return () => ambAudio.subs.delete(fn)
      },
    }
    let ambTap = null
    let ambRaf = 0
    let ambLastFrame = 0
    let ambBassAvg = 0
    let ambLastBeat = 0
    let ambTapTries = 0
    let ambTapTimer = 0
    let ambMotionMq = null // prefers-reduced-motion 的媒体查询句柄（背景层用它听系统偏好）
    let ambSilentFrames = 0
    let ambRetaps = 0
    let ambPeak = 0

    function ambTapAttach() {
      if (ambTap !== null || !ambAudio.supported) return
      const a = audioEl
      if (a === null) return // <audio> 还没建出来（未播放过）：下一次 play 事件再来挂
      if (typeof a.captureStream !== 'function') { ambAudio.supported = false; ambAudio.err = 'no captureStream on <audio>'; return }
      const Ctor = window.AudioContext || window.webkitAudioContext
      if (typeof Ctor !== 'function') { ambAudio.supported = false; ambAudio.err = 'no AudioContext'; return }
      try {
        const stream = a.captureStream()
        const tracks = stream.getAudioTracks()
        if (tracks.length === 0) {
          // **可重试**，不能一次判死：实测（headless Edge）在"点播放那一刻"挂上去拿到的是
          // tracks=0 的空流，而同一首歌播到 1.5s 后手工抽头 max=113、6 个频点都有数。
          // 媒体管道是先出声再吐音轨的，所以这里返回、交给 ambLoopSync 的定时器重试。
          // 诊断位写英文：这不是界面文案，但 i18n 守卫只认"表外不许有中文字面量"，
          // 而它确实不该出现在任何语言的界面上（只进 data-amb-err 给仪器读）。
          ambAudio.err = 'captureStream tracks=0 (retry pending)'
          return
        }
        const actx = new Ctor()
        const an = actx.createAnalyser()
        an.fftSize = 1024
        an.smoothingTimeConstant = 0.75
        const src = actx.createMediaStreamSource(stream)
        src.connect(an) // 到此为止：分析节点不接 destination，这条支路只读数字
        // src 必须留引用：只连着 analyser 的 MediaStreamAudioSourceNode 有可能被 GC 掉，
        // 表现就是"抽头是 ok、电平恒 0"（实测踩过）
        ambTap = { actx, an, src, freq: new Uint8Array(an.frequencyBinCount) }
        ambAudio.err = ''
        ambTapTries = 0
        if (actx.state === 'suspended') actx.resume().catch(() => { /* 下一次 play 还会再试 */ })
      } catch (e) {
        ambAudio.supported = false
        ambAudio.err = String((e && e.message) || e).slice(0, 120)
        ambTap = null
      }
    }

    /** 拆掉当前抽头（重挂前先收干净，别把 AudioContext 漏在进程里）。 */
    function ambTapDrop() {
      if (ambTap === null) return
      try { ambTap.src.disconnect() } catch { /* ignore */ }
      try { ambTap.an.disconnect() } catch { /* ignore */ }
      try { ambTap.actx.close() } catch { /* ignore */ }
      ambTap = null
    }

    /**
     * 重挂抽头。为什么需要它：在"刚 play 的那一刻"建图，实测（headless Edge，真歌）
     * 拿到的是**恒定全 0** 的频谱；同一首歌播到十几秒后再建图，max=106 立刻有数。
     * 与其赌什么时候建图对，不如"读满 1.5s 全 0 就重挂一次"，最多 3 次（换歌时清零）。
     */
    function ambRetap() {
      ambTapDrop()
      ambTapTries = 0
      ambRetaps++
      ambTapAttach()
      if (ambTap !== null) ambAudio.err = 're-tap #' + ambRetaps + ' (silence)'
    }

    /** 频段映射：低频给前几根柱子（人耳对低频最"看得见"），按对数分桶取窗口峰值。 */
    function ambReadBands(freq) {
      const n = freq.length
      for (let i = 0; i < AMB_BARS; i++) {
        const lo = Math.floor(Math.pow(i / AMB_BARS, 1.7) * (n * 0.72))
        const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / AMB_BARS, 1.7) * (n * 0.72)))
        let peak = 0
        for (let k = lo; k < hi; k++) if (freq[k] > peak) peak = freq[k]
        ambAudio.bands[i] = peak / 255
      }
    }

    function ambTick(ts) {
      ambRaf = window.requestAnimationFrame(ambTick)
      // 暂停时降到 12.5fps：柱子要落下来、背景封面还要慢慢漂，但不需要每帧
      const gap = ambAudio.active ? 33 : 80
      if (ts - ambLastFrame < gap) return
      ambLastFrame = ts
      const tap = ambTap
      if (tap !== null && ambAudio.active) {
        // AudioContext 可能被浏览器自动挂起（节能/无手势策略）：每 ~2s 兜一次，别让频谱莫名其妙归零
        if (tap.actx.state !== 'running' && ambAudio.frames % 60 === 0) {
          tap.actx.resume().catch(() => { /* 下一次 tick 还会再试 */ })
        }
        tap.an.getByteFrequencyData(tap.freq)
        // 全 0 = 这条图根本没在收数据（不是"音乐安静"）：攒够 1.5s 就重挂一次
        let peak = 0
        for (let k = 0; k < tap.freq.length; k += 4) if (tap.freq[k] > peak) peak = tap.freq[k]
        ambPeak = peak
        if (peak === 0) {
          ambSilentFrames++
          if (ambSilentFrames > 45 && ambRetaps < 3) { ambSilentFrames = 0; ambRetap() }
        } else {
          ambSilentFrames = 0
        }
        ambReadBands(tap.freq)
        let bass = 0
        for (let k = 1; k <= 8; k++) bass += tap.freq[k]
        bass /= 8 * 255
        let mid = 0
        for (let k = 9; k <= 40; k++) mid += tap.freq[k]
        mid /= 32 * 255
        let high = 0
        for (let k = 41; k <= 120; k++) high += tap.freq[k]
        high /= 80 * 255
        ambAudio.level = Math.min(1, bass * 0.62 + mid * 0.3 + high * 0.08)
        // 重音：低频能量越过自己的慢速均值一定比例，且距上一次重音 >170ms（防同一拍连击）
        ambBassAvg = ambBassAvg * 0.92 + bass * 0.08
        if (bass > 0.06 && bass > ambBassAvg * 1.32 && ts - ambLastBeat > 170) {
          ambLastBeat = ts
          ambAudio.beat = 1
          ambAudio.beats++
        } else {
          ambAudio.beat *= 0.84
        }
        // ---- 曲线分角色（onetake：别拿一条 smootherstep 到处套）----
        // ① 振幅包络：**快起慢落**。直接把 level 乘进位移的话，频谱一跳背景就瞬移 ——
        //    这正是频闪腿要抓的东西（实测：原始 level 逐帧抖 ±0.3，等于 ±90px 的单帧跳）。
        ambAmpEnv += (ambAudio.level - ambAmpEnv) * (ambAudio.level > ambAmpEnv ? 0.30 : 0.08)
        // ② 运动包络：重音把它顶向 1，之后按 ~0.2s 的松弛回落，落在 0.18 的底上。
        //    "画面不能永远在动"（onetake 硬规则）—— 运动集中在拍上，拍与拍之间近乎静止，
        //    顺带把 rAF 的有效工作量也压下来。
        const beatTop = ambAudio.beat > 0.6 ? 1 : 0
        ambMoveEnv += (beatTop - ambMoveEnv) * (beatTop > ambMoveEnv ? 0.34 : 0.065)
        ambAudio.ampEnv = ambAmpEnv
        ambAudio.moveEnv = ambMoveEnv
        ambAudio.frames++
      } else {
        ambAudio.level *= 0.9
        ambAudio.beat *= 0.84
        ambAmpEnv += (0 - ambAmpEnv) * 0.08
        ambMoveEnv += (AMB_REST - ambMoveEnv) * 0.065
        ambAudio.ampEnv = ambAmpEnv
        ambAudio.moveEnv = ambMoveEnv
        for (let i = 0; i < AMB_BARS; i++) ambAudio.bands[i] *= 0.9
      }
      for (const fn of ambAudio.subs) fn(ts)
    }

    function ambLoopSync() {
      // 先挂抽头再判断能不能跑：挂失败会把 supported 翻掉，顺序反了要多等一轮 play 才纠正
      const playing = amb.s.on && player.state.playing
      if (playing) ambTapAttach()
      const want = playing && ambAudio.supported && ambTap !== null
      ambAudio.active = want
      if (want) {
        if (ambRaf === 0) ambRaf = window.requestAnimationFrame(ambTick)
      } else if (ambRaf !== 0) {
        window.cancelAnimationFrame(ambRaf)
        ambRaf = 0
      }
      if (!playing) { ambTapTries = 0; return } // 停了就重置重试额度：下一首还要能挂
      // 还在播但还没挂上：短定时器重试（音轨是播放开始后才出现的）
      if (ambTap === null && ambAudio.supported && ambTapTimer === 0 && ambTapTries < 12) {
        ambTapTimer = window.setTimeout(() => {
          ambTapTimer = 0
          ambTapTries++
          ambLoopSync()
        }, 260)
      }
    }

    // ---- 订阅用的小 hooks（都走总线，不直接把总线塞进 React state）----
    function useAmbient() {
      const [s, setS] = useState(amb.s)
      useEffect(() => { const off = amb.subscribe(setS); return () => { off() } }, [])
      return s
    }
    function useAmbColors() {
      const [c, setC] = useState(ambArt.pair)
      useEffect(() => { const off = ambArt.subscribe(setC); return () => { off() } }, [])
      return c
    }
    /** 把节拍写进 CSS 变量而不是 React state：这个值 30fps 在变，state 会让整页跟着重渲染。 */
    function useBeatVar(ref, enabled) {
      useEffect(() => {
        if (!enabled) return undefined
        let raf = 0
        const draw = () => {
          raf = window.requestAnimationFrame(draw)
          const el = ref.current
          if (el === null) return
          el.style.setProperty('--amb-beat', ambAudio.beat.toFixed(3))
        }
        raf = window.requestAnimationFrame(draw)
        return () => window.cancelAnimationFrame(raf)
      }, [ref, enabled])
    }

    /** 系统级"减少动态效果"。装饰性动效必须能整体让路（onetake：动效得是**有意的**）。 */
    const ambReduced = () => typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    function useAmbReduced() {
      const [red, setRed] = useState(ambReduced)
      useEffect(() => {
        if (typeof window.matchMedia !== 'function') return undefined
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
        const on = () => setRed(mq.matches)
        mq.addEventListener('change', on)
        return () => mq.removeEventListener('change', on)
      }, [])
      return red
    }

    // ---- B. 效果层：注册进宿主 shell.overlay 的常驻层 ----
    const ambColorVars = (pair) => {
      if (!pair) return {}
      const L = pair.light
      const D = pair.dark
      const out = {}
      const put = (i, l, d) => {
        if (l) out['--amb-c' + i + '-l'] = l
        if (d) out['--amb-c' + i + '-d'] = d
      }
      put(1, L.vivid, D.vivid)
      put(2, L.highlight, D.highlight)
      put(3, L.band, D.band)
      put(4, L.deep, D.deep)
      return out
    }

    /** 打字音符：宿主 composer 是 Lexical contenteditable，没有公开的插入点回调，
       所以这里只做**只读观测** —— 听 document 级的 input，用原生 Selection 量光标框，
       再把音符挂到我们自己的 overlay 层里。不碰宿主 DOM 的一个节点。 */
    function ambIsComposer(target) {
      if (target === null || typeof target.closest !== 'function') return false
      return target.closest('[data-lexical-editor]') !== null
        || target.closest('[data-composer-input]') !== null
        || target.closest('[data-composer-card]') !== null
    }

    /** 光标/选区末端的视口矩形。折叠光标在 Chromium 下 getClientRects 常为空，回落到 rect。 */
    function ambCaretRect() {
      const sel = window.getSelection()
      if (sel === null || sel.rangeCount === 0) return null
      const r = sel.getRangeAt(0)
      const rects = r.getClientRects()
      const box = rects.length > 0 ? rects[rects.length - 1] : r.getBoundingClientRect()
      if (box === undefined || box === null) return null
      if (box.height === 0 && box.width === 0) return null
      return box
    }

    const AMB_NOTES = ['\u266a', '\u266b', '\u2669']
    function ambSpawnNote(host, box, size, seed) {
      const el = document.createElement('span')
      el.className = 'wyy-amb-note n' + (seed % 4)
      el.textContent = AMB_NOTES[seed % AMB_NOTES.length]
      el.style.fontSize = size + 'px'
      el.style.left = Math.round(box.right + 2) + 'px'
      el.style.top = Math.round(box.top - size * 0.35) + 'px'
      el.style.setProperty('--amb-note-rot', ((seed % 5) - 2) * 7 + 'deg')
      const kill = () => { if (el.parentNode !== null) el.parentNode.removeChild(el) }
      el.addEventListener('animationend', kill)
      // 动画没跑（被 reduced-motion 关掉等）时兜底：不能留下永远不消失的节点
      window.setTimeout(kill, 1400)
      host.appendChild(el)
      return el
    }

    function AmbientLayer() {
      const st = useAmbient()
      const pair = useAmbColors()
      const reduced = useAmbReduced()
      const rootRef = useRef(null)
      const barRef = useRef(null)
      const spotRef = useRef(null)
      const notesRef = useRef(null)

      // 音频总线只在"总开关开着"时才需要跑（关掉就完全不自旋，省 CPU/电）
      useEffect(() => {
        ambLoopSync()
        const off = player.subscribe(() => ambLoopSync())
        return () => { off(); ambLoopSync() }
      }, [st.on])

      // 诊断位：把总线的实时值写回 DOM（总线不是 React state，读快照永远是 0 —— 老坑了）。
      // 10fps 足够，反正只是给仪器/守卫读的。
      useEffect(() => {
        if (!st.on) return undefined
        let raf = 0
        let last = 0
        const draw = (ts) => {
          raf = window.requestAnimationFrame(draw)
          if (ts - last < 100) return
          last = ts
          const el = rootRef.current
          if (el === null) return
          el.setAttribute('data-amb-audio', ambAudio.supported ? (ambAudio.active ? 'ok' : 'idle') : 'unsupported')
          if (ambAudio.err !== '' && el.getAttribute('data-amb-err') !== ambAudio.err) el.setAttribute('data-amb-err', ambAudio.err)
          el.setAttribute('data-amb-tap', (ambTap === null ? 'none' : ambTap.actx.state) + '|peak=' + ambPeak + '|retaps=' + ambRetaps)
          el.setAttribute('data-amb-level', ambAudio.level.toFixed(2))
          el.setAttribute('data-amb-beats', String(ambAudio.beats))
          // 两条包络也写出来：oracle 要靠它判"运动是不是集中在拍上"（rests 腿）
          el.setAttribute('data-amb-env', ambAudio.ampEnv.toFixed(3) + '|' + ambAudio.moveEnv.toFixed(3))
        }
        raf = window.requestAnimationFrame(draw)
        return () => window.cancelAnimationFrame(raf)
      }, [st.on])

      // 范围（对话栏 / 整个窗口）的实现在这里：量出**中间那一列**的左右边界写进 --amb-left/-right。
      // 为什么不用宿主的 --dsh-frame-leading-clearance：0.1.7-rc.2 上实测它在 overlay / 我们的层 /
      // frame 三处读到的都是**空串**（frame 的列是 hash 类名，没有对外契约），照抄它等于挂一个
      // "点了没反应"的假开关。这里的取法：优先用对话视图自己的 data- 属性，视图不在（在看音乐面板）
      // 就退到"frame 里最宽的那一列"——侧栏 280 永远窄于中间列，这个判据比类名稳。
      useEffect(() => {
        if (!st.on || (st.bgScope !== 'convo' && st.barScope !== 'convo')) return undefined
        const el = rootRef.current
        if (el === null) return undefined
        const measure = () => {
          // 用宿主自己的标记找 overlay 层：我们的槽位外面还套着 renderer 的包装元素，
          // 所以 el.parentElement **不是** overlay 层（实测：按 parentElement.parentElement 取，
          // 扫到的是包装元素的空 children，量出来 best=null → 范围设置永远 0）。
          const layer = el.closest('[data-shell-overlay]')
          const frame = layer === null ? null : layer.parentElement
          if (frame === null) return
          const orect = layer.getBoundingClientRect()
          // 对话栏 = frame 里**最宽的那一列**。不用 [data-conversation-*]：那套在我们面板
          // 接管主区时量到的是"另一棵树"的框（实测：切回对话栏后 left 被算成 0 就不再回来），
          // 而列容器在两种视图下都是同一批（侧栏 280 / 中间列 1288 / 右侧栏 0 / 拖拽把手 8px）。
          let best = null
          for (const kid of frame.children) {
            if (kid === layer || kid.contains(layer)) continue
            // 背景层（frame 首个子节点）也是我们自己的、也更宽：必须跳过，否则会把自己量成"对话列"
            if (kid.hasAttribute('data-amb-bg-root')) continue
            const r = kid.getBoundingClientRect()
            if (r.width < 80) continue
            if (best === null || r.width > best.w) best = { l: r.left, w: r.width }
          }
          const left = best === null ? 0 : Math.max(0, Math.round(best.l - orect.left))
          const right = best === null ? 0 : Math.max(0, Math.round(orect.right - (best.l + best.w)))
          el.style.setProperty('--amb-left', left + 'px')
          el.style.setProperty('--amb-right', right + 'px')
          el.setAttribute('data-amb-measure', left + '|' + right + '|' + (best === null ? 'none' : 'col'))
        }
        // 只挂 ResizeObserver 不够：切面板/切视图/收侧栏都不改 overlay 的尺寸（实测：切回"对话栏"
        // 之后量到的 left 一直停在 0，怎么点都不回来）。所以这里自己按 2Hz 重算 —— 5 次
        // getBoundingClientRect/秒，代价可以忽略，换来的是任何布局变化都会自己收敛。
        measure()
        let raf = 0
        let last = 0
        const tick = (ts) => {
          raf = window.requestAnimationFrame(tick)
          if (ts - last < 500) return
          last = ts
          measure()
        }
        raf = window.requestAnimationFrame(tick)
        const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
        if (ro !== null && el.parentElement !== null) ro.observe(el.parentElement)
        window.addEventListener('resize', measure)
        return () => {
          window.cancelAnimationFrame(raf)
          window.removeEventListener('resize', measure)
          if (ro !== null) ro.disconnect()
        }
      }, [st.on, st.bgScope, st.barScope])

      // 效果 1（背景）**不在这一层**：它挂在 frame 最底下（ambBackdropSync 那套），这里只放
      // 需要在内容**之上**的三样：律动条 / 聚光灯 / 打字音符。

      // 效果 2：律动条 —— 48 根柱子 scaleY；整条的节拍闪光走 --amb-beat
      useEffect(() => {
        if (!st.on || !st.bar) return undefined
        const el = barRef.current
        if (el === null) return undefined
        const bars = []
        for (let i = 0; i < el.children.length; i++) bars.push(el.children[i])
        let raf = 0
        let last = 0
        const gain = 0.45 + st.barGain / 100
        // 快起慢落（频谱的经典包络）：起手 0.55/帧（≈55ms 到八成），回落 0.16/帧（≈300ms）。
        // 直接写原始频段的话柱子逐帧抖 —— 那是"抖"，不是"跳"，而且是频闪腿的靶子。
        // 再叠一条单帧幅度上限（0.22），保证任何输入都不会让某根柱子一帧内窜满。
        const prev = []
        for (let i = 0; i < bars.length; i++) prev.push(0.02)
        const draw = (ts) => {
          raf = window.requestAnimationFrame(draw)
          const gap = ambAudio.active ? 33 : 80
          if (ts - last < gap) return
          last = ts
          for (let i = 0; i < bars.length; i++) {
            const target = Math.max(0.02, Math.min(1, ambAudio.bands[i] * gain))
            // 回落放慢到 0.09（约 350ms）：峰值得以留住，"跳"才看得出来；
            // 0.16 那版实测柱子在两拍之间就已经塌平了 —— 这是"没感觉"的一半原因。
            const k = target > prev[i] ? 0.55 : 0.09
            let v = prev[i] + (target - prev[i]) * k
            if (v > prev[i] + 0.22) v = prev[i] + 0.22
            else if (v < prev[i] - 0.22) v = prev[i] - 0.22
            prev[i] = v
            bars[i].style.transform = 'scaleY(' + v.toFixed(3) + ')'
          }
          // 节拍闪光在 reduced 档要熄掉：这是纯装饰，不是信息（柱子本身才是信息）
          const beat = reduced ? 0 : ambAudio.beat
          el.style.setProperty('--amb-beat', beat.toFixed(3))
          el.style.setProperty('--amb-level', ambAudio.level.toFixed(3))
          // 整条随重音"提一口气"（2~4% 的纵向呼吸）：单根柱子之外，让条子整体也在动
          el.style.transform = 'scaleY(' + (1 + beat * 0.06).toFixed(4) + ')'
        }
        raf = window.requestAnimationFrame(draw)
        return () => window.cancelAnimationFrame(raf)
      }, [st.on, st.bar, st.barGain, reduced])

      // 效果 4：聚光灯 —— 对话页上方左右两盏，随节拍**左右摇曳**（rotate）+ 闪光（透明度）。
      // 同样只有 transform/opacity 在动，并各自设了单帧上限：速度与背景共用同一条频闪闸。
      useEffect(() => {
        if (!st.on || !st.spot || reduced) return undefined
        const el = spotRef.current
        if (el === null) return undefined
        const lamps = []
        for (let i = 0; i < el.children.length; i++) lamps.push(el.children[i])
        const t0 = performance.now()
        const power = st.spotPower / 100
        let raf = 0
        let last = 0
        const prevRot = [0, 0]
        const prevA = [0, 0]
        const prevK = [1, 1]
        // 朝向基准：按**屏幕中心**算，不按对话列中心（列中心因为左侧栏而比屏幕中心偏右，
        // 用户点名的"朝着屏幕中间"就是这个差别）。角度 = atan2(屏幕中心x − 灯头x, 光柱长度)。
        const tilt = [0, 0]
        const tiltOf = () => {
          const r = el.getBoundingClientRect()
          if (r.width < 80 || r.height < 80) return
          const cx = window.innerWidth / 2
          const len = r.height
          for (let i = 0; i < 2; i++) {
            const lampX = r.left + r.width * (i === 0 ? 0.03 : 0.97)
            // CSS rotate 正角是**顺时针**：对向下的光柱，(0,1) 转 +θ 会跑到左下（x' = −sinθ）。
            // 所以"光尖朝屏幕中间"要取**负**角度（用户报的"光柱还是反的"就是这里翻了号）。
            tilt[i] = Math.max(-58, Math.min(58, -Math.atan2(cx - lampX, len) * 180 / Math.PI))
            // 起始角直接落在目标上：单帧限速（频闪闸）本来会让光柱从 0° 慢慢转过去，
            // 挂载后要两秒才到位 —— 那两秒里朝向是错的（守卫实测到 12° 就是它）。
            prevRot[i] = tilt[i]
          }
        }
        tiltOf()
        window.addEventListener('resize', tiltOf)
        const tiltTimer = window.setInterval(tiltOf, 1200) // 侧栏收放/窗口变化都要跟着改朝向
        // 自证位：仪器要能看见"量到的是哪个矩形"（朝向算错时，第一件事就是看这个）
        const tiltDiag = () => {
          const r = el.getBoundingClientRect()
          el.setAttribute('data-amb-tilt', tilt.map((v) => v.toFixed(1)).join('/')
            + '|rect=' + Math.round(r.left) + ',' + Math.round(r.width) + 'x' + Math.round(r.height)
            + '|vw=' + window.innerWidth)
        }
        const draw = (ts) => {
          raf = window.requestAnimationFrame(draw)
          const gap = ambAudio.active ? 33 : 80
          if (ts - last < gap) return
          last = ts
          const ph = ((ts - t0) / 1000) * (0.35 + power * 0.35)
          tiltDiag()
          for (let i = 0; i < lamps.length; i++) {
            // 朝**中间**射：左灯顺时针、右灯逆时针，各带一个朝内的基准倾角（用户点名"朝着中间射向"），
            // 摆动叠在基准上 —— 光束始终朝场地中心聚，不是两根平行的竖光。
            const inward = i === 0 ? 1 : -1
            const base = tilt[i] !== 0 ? tilt[i] : inward * 20 // 兜底：量不到容器时给一个朝内的角度
            const sway = Math.sin(ph * 0.9 + i * 1.7) * (2.5 + power * 4) // 摆动幅度收小：朝向已经是主角
            const wantRot = base + sway + ambAudio.moveEnv * power * 3 * inward
            let rot = wantRot
            if (rot > prevRot[i] + 0.6) rot = prevRot[i] + 0.6
            else if (rot < prevRot[i] - 0.6) rot = prevRot[i] - 0.6
            prevRot[i] = rot
            const wantA = 0.3 + power * 0.52 + ambAudio.moveEnv * power * 0.6
            let a = wantA
            if (a > prevA[i] + 0.05) a = prevA[i] + 0.05
            else if (a < prevA[i] - 0.05) a = prevA[i] - 0.05
            prevA[i] = a
            // 束宽随拍呼吸：丁达尔光束在重音上会"亮一档、宽一点"（1.0 → 1.08）
            const wantK = 1 + ambAudio.moveEnv * 0.08
            if (wantK > prevK[i] + 0.02) prevK[i] = prevK[i] + 0.02
            else if (wantK < prevK[i] - 0.02) prevK[i] = prevK[i] - 0.02
            else prevK[i] = wantK
            lamps[i].style.transform = 'rotate(' + rot.toFixed(2) + 'deg) scaleX(' + prevK[i].toFixed(3) + ')'
            lamps[i].style.setProperty('--amb-spot-a', a.toFixed(3))
          }
        }
        raf = window.requestAnimationFrame(draw)
        return () => {
          window.cancelAnimationFrame(raf)
          window.removeEventListener('resize', tiltOf)
          window.clearInterval(tiltTimer)
        }
      }, [st.on, st.spot, st.spotPower, reduced])

      // 效果 3：打字音符 —— document 级只读观测（含输入法保护：合成中的字符不出音符）
      useEffect(() => {
        if (!st.on || !st.notes || reduced) return undefined
        const host = notesRef.current
        if (host === null) return undefined
        let composing = false
        let lastNote = 0
        let seed = 0
        const gap = Math.max(45, 240 - (st.notesRate / 100) * 195)
        const spawn = () => {
          const now = performance.now()
          if (now - lastNote < gap) return
          const box = ambCaretRect()
          if (box === null) return
          lastNote = now
          seed++
          if (host.children.length >= 8) host.removeChild(host.firstChild)
          ambSpawnNote(host, box, st.notesSize, seed)
        }
        const onStart = (e) => { if (ambIsComposer(e.target)) composing = true }
        // 输入法选词（点候选 / 按 1234）算"打出一个词"，那一刻必须出音符。
        // 原来只靠 input：Chromium 在提交候选时 **input 早于 compositionend**，而 input 那边看到
        // isComposing=true 就跳过了 —— 于是"打拼音 + 点选词"一个音符都不出（用户实测）。
        // 现在两个信号都认：组字过程（isComposing / composing）一律不出，**提交那一刻**出。
        const onEnd = (e) => {
          if (!ambIsComposer(e.target)) return
          const was = composing
          composing = false
          if (was) spawn()
        }
        const onInput = (e) => {
          if (e.isComposing === true) { composing = true; return } // 组字中的拼音不是"字"
          if (composing) return
          if (!ambIsComposer(e.target)) return
          spawn()
        }
        document.addEventListener('compositionstart', onStart, true)
        document.addEventListener('compositionend', onEnd, true)
        document.addEventListener('input', onInput, true)
        return () => {
          document.removeEventListener('compositionstart', onStart, true)
          document.removeEventListener('compositionend', onEnd, true)
          document.removeEventListener('input', onInput, true)
        }
      }, [st.on, st.notes, st.notesRate, st.notesSize])

      const scopeCls = (scope) => (scope === 'frame' ? ' frame' : '')
      return React.createElement('div', {
        className: 'wyy-amb' + (st.on ? ' on' : ''),
        ref: rootRef,
        // --amb-bar-h 挂在**层根**而不是条子上：条子与提示气泡都要读它，写在其中之一的身上
        // 另一路就只能吃 CSS 兜底值（气泡会压在条子上）。
        style: Object.assign({ pointerEvents: 'none', '--amb-bar-h': st.barHeight + 'px' }, ambColorVars(pair)),
        'data-amb': st.on ? 'on' : 'off',
        'data-amb-motion': reduced ? 'reduced' : 'full',
      }, [
        st.on && st.bar
          ? React.createElement('div', {
            key: 'bar', ref: barRef, className: 'wyy-amb-bar' + scopeCls(st.barScope),
            'data-amb-bar': st.barScope,
          }, Array.from({ length: AMB_BARS }, (_, i) => React.createElement('i', { key: i })))
          : null,
        st.on && st.spot
          ? React.createElement('div', {
            key: 'spot', ref: spotRef, className: 'wyy-amb-spot' + scopeCls(st.bgScope),
            'data-amb-spot': st.bgScope,
          }, [
            React.createElement('i', { key: 'l', className: 'l' }),
            React.createElement('i', { key: 'r', className: 'r' }),
          ])
          : null,
        st.on && st.notes ? React.createElement('div', { key: 'notes', ref: notesRef, className: 'wyy-amb-notes' }) : null,
        ambAudio.supported ? null : React.createElement('div', { key: 'nt', className: 'wyy-amb-toast' }, t('ambNoTap')),
      ])
    }

    // ---- C. 控制层：设置面板（面板里的开关自己也在律动 = 功能 3）----
    function AmbSwitch({ on, onClick, label, beat }) {
      return React.createElement('button', {
        type: 'button', role: 'switch', 'aria-checked': on ? 'true' : 'false',
        className: 'wyy-amb-switch' + (on ? ' on' : '') + (beat ? ' beat' : ''),
        onClick, 'aria-label': label, title: label,
      }, React.createElement('span', { className: 'knob' }))
    }

    function AmbSlider({ label, value, min, max, onChange }) {
      return React.createElement('label', { className: 'wyy-amb-slider' }, [
        React.createElement('span', { key: 'l', className: 'lab' }, label),
        React.createElement('input', {
          key: 'i', type: 'range', min: min, max: max, step: 1, value,
          'aria-label': label, onChange: (e) => onChange(Number(e.target.value)),
        }),
        React.createElement('span', { key: 'v', className: 'val' }, String(value)),
      ])
    }

    function AmbScope({ label, value, onChange }) {
      return React.createElement('div', { className: 'wyy-amb-scope' }, [
        React.createElement('span', { key: 'l', className: 'lab' }, label),
        React.createElement('button', {
          key: 'c', type: 'button', className: 'wyy-amb-seg' + (value === 'convo' ? ' on' : ''),
          onClick: () => onChange('convo'), 'aria-pressed': value === 'convo' ? 'true' : 'false',
        }, t('ambScopeConvo')),
        React.createElement('button', {
          key: 'f', type: 'button', className: 'wyy-amb-seg' + (value === 'frame' ? ' on' : ''),
          onClick: () => onChange('frame'), 'aria-pressed': value === 'frame' ? 'true' : 'false',
        }, t('ambScopeFrame')),
      ])
    }

    function AmbRow({ id, title, sub, on, onToggle, children }) {
      return React.createElement('div', {
        className: 'wyy-amb-row' + (on ? ' on' : ''),
        // 行身份写进 DOM：守卫按 id 选行，不再靠"第几行"（加一行就把测试选错，实测踩过）
        'data-amb-row': id,
      }, [
        React.createElement('div', { key: 'h', className: 'wyy-amb-row-head' }, [
          React.createElement('div', { key: 't', className: 'wyy-amb-row-text' }, [
            React.createElement('span', { key: 'a', className: 'wyy-amb-row-title' }, title),
            React.createElement('span', { key: 'b', className: 'wyy-amb-row-sub' }, sub),
          ]),
          React.createElement(AmbSwitch, { key: 's', on, onClick: onToggle, label: title, beat: true }),
        ]),
        children ? React.createElement('div', { key: 'b', className: 'wyy-amb-row-body' }, children) : null,
      ])
    }

    function AmbientSettings({ onClose }) {
      const st = useAmbient()
      const rootRef = useRef(null)
      useBeatVar(rootRef, st.on && st.beat)
      // 播放诊断：seek 在别的机器上不生效时，这一行就是唯一能带回来的现场
      // （data-seek 由 seekTo 写：target/readyState/seekable/got/tries/result）
      const [diag, setDiag] = useState('')
      useEffect(() => {
        const read = () => {
          const a = document.querySelector('audio')
          if (a === null) { setDiag('no <audio>'); return }
          const sk = a.getAttribute('data-seek') || '{}'
          setDiag('rs=' + a.readyState + ' range=' + (a.seekable ? a.seekable.length : 0) + ' ' + sk)
        }
        read()
        const timer = window.setInterval(read, 1000)
        return () => window.clearInterval(timer)
      }, [])
      useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose() }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [onClose])
      const playingSong = player.state.idx >= 0 && player.state.idx < player.state.queue.length
        ? player.state.queue[player.state.idx] : null
      return React.createElement('div', {
        className: 'wyy-amb-panel' + (st.beat && st.on ? ' beat' : ''),
        ref: rootRef, 'data-amb-beat': st.beat && st.on ? 'on' : 'off',
        'data-amb-master': st.on ? 'on' : 'off',
        // 晃动幅度走一个变量：CSS 那边只负责"幅度 × 节拍"，判断都在 JS 总线里
        style: { '--amb-beat-amp': (st.beatPower / 100 * 6).toFixed(2) + 'px' },
      }, [
        React.createElement('div', { key: 'h', className: 'wyy-amb-panel-head' }, [
          React.createElement('div', { key: 't', className: 'wyy-queue-title' }, [
            React.createElement('span', { key: 'k', className: 'wyy-queue-kicker' }, t('ambTitle')),
            React.createElement('span', { key: 's', className: 'wyy-queue-sub' },
              playingSong === null ? t('ambNeedPlay') : playingSong.title),
          ]),
          React.createElement('button', {
            key: 'x', className: 'wyy-icon-btn small', title: t('close'), 'aria-label': t('close'), onClick: onClose,
          }, '\u2715'),
        ]),
        React.createElement('div', { key: 'm', className: 'wyy-amb-master' }, [
          React.createElement('div', { key: 't', className: 'wyy-amb-row-text' }, [
            React.createElement('span', { key: 'a', className: 'wyy-amb-master-title' }, t('ambMaster')),
            React.createElement('span', { key: 'b', className: 'wyy-amb-row-sub' }, t('ambSub')),
          ]),
          React.createElement(AmbSwitch, {
            key: 's', on: st.on, label: t('ambMaster'), beat: true, onClick: () => amb.toggle('on'),
          }),
        ]),
        React.createElement('div', { key: 'b', className: 'wyy-amb-panel-body' }, [
          React.createElement(AmbRow, {
            key: 'bg', id: 'bg', title: t('ambBg'), sub: t('ambBgSub'),
            on: st.on && st.bg, onToggle: () => amb.toggle('bg'),
          }, [
            React.createElement(AmbSlider, {
              key: 's', label: t('ambStrength'), value: st.bgStrength, min: 0, max: 100,
              onChange: (v) => amb.apply({ bgStrength: v }),
            }),
            React.createElement(AmbSlider, {
              key: 'p', label: t('ambSpeed'), value: st.bgSpeed, min: 0, max: 100,
              onChange: (v) => amb.apply({ bgSpeed: v }),
            }),
            React.createElement(AmbScope, {
              key: 'c', label: t('ambScopeLabel'), value: st.bgScope, onChange: (v) => amb.apply({ bgScope: v }),
            }),
          ]),
          React.createElement(AmbRow, {
            key: 'spot', id: 'spot', title: t('ambSpot'), sub: t('ambSpotSub'),
            on: st.on && st.spot, onToggle: () => amb.toggle('spot'),
          }, [
            React.createElement(AmbSlider, {
              key: 'p', label: t('ambSpotPower'), value: st.spotPower, min: 0, max: 100,
              onChange: (v) => amb.apply({ spotPower: v }),
            }),
          ]),
          React.createElement(AmbRow, {
            key: 'bar', id: 'bar', title: t('ambBar'), sub: t('ambBarSub'),
            on: st.on && st.bar, onToggle: () => amb.toggle('bar'),
          }, [
            React.createElement(AmbSlider, {
              key: 'h', label: t('ambHeight'), value: st.barHeight, min: 10, max: 150,
              onChange: (v) => amb.apply({ barHeight: v }),
            }),
            React.createElement(AmbSlider, {
              key: 'g', label: t('ambGain'), value: st.barGain, min: 0, max: 100,
              onChange: (v) => amb.apply({ barGain: v }),
            }),
            React.createElement(AmbScope, {
              key: 'c', label: t('ambScopeLabel'), value: st.barScope, onChange: (v) => amb.apply({ barScope: v }),
            }),
          ]),
          React.createElement(AmbRow, {
            key: 'notes', id: 'notes', title: t('ambNotes'), sub: t('ambNotesSub'),
            on: st.on && st.notes, onToggle: () => amb.toggle('notes'),
          }, [
            React.createElement(AmbSlider, {
              key: 'r', label: t('ambRate'), value: st.notesRate, min: 0, max: 100,
              onChange: (v) => amb.apply({ notesRate: v }),
            }),
            React.createElement(AmbSlider, {
              key: 'z', label: t('ambSize'), value: st.notesSize, min: 12, max: 40,
              onChange: (v) => amb.apply({ notesSize: v }),
            }),
          ]),
          React.createElement(AmbRow, {
            key: 'beat', id: 'beat', title: t('ambBeat'), sub: t('ambBeatSub'),
            on: st.beat, onToggle: () => amb.toggle('beat'),
          }, [
            React.createElement(AmbSlider, {
              key: 'p', label: t('ambPower'), value: st.beatPower, min: 0, max: 100,
              onChange: (v) => amb.apply({ beatPower: v }),
            }),
          ]),
        ]),
        // 诊断脚注：只读、每秒钟刷一次。写得克制（小字、次要色），但必须常驻 ——
        // "点了不跳"这种只在别人机器上出现的问题，靠它才能把现场带回来。
        React.createElement('div', { key: 'dg', className: 'wyy-amb-diag' },
          t('ambDiag') + '：' + diag),
      ])
    }

    /** 左栏底部的两个快捷开关 + 设置入口（用户点名要的"2 个按钮 + 一个总设置按钮"）。 */
    function RailAmbient({ open, onOpenSettings }) {
      const st = useAmbient()
      const btn = (key, on, label, Ico, click) => React.createElement('button', {
        key, type: 'button', className: 'wyy-rail-amb-btn' + (on ? ' on' : ''),
        title: label, 'aria-label': label, 'aria-pressed': on ? 'true' : 'false', onClick: click,
        'data-amb-toggle': key,
      }, React.createElement(Ico, { size: 17 }))
      return React.createElement('div', { className: 'wyy-rail-ambient', 'data-amb-on': st.on ? 'on' : 'off' }, [
        btn('bg', st.on && st.bg, t('ambBg'), IconAura, () => {
          // 快捷开关的语义：点了就是要看到效果 —— 总开关没开时顺手把它打开
          if (!st.on) amb.apply({ on: true, bg: true })
          else amb.toggle('bg')
        }),
        btn('bar', st.on && st.bar, t('ambBar'), IconBars, () => {
          if (!st.on) amb.apply({ on: true, bar: true })
          else amb.toggle('bar')
        }),
        btn('set', open, t('ambOpen'), IconGear, onOpenSettings),
      ])
    }

    // =================================================================
    // 通用小组件
    // =================================================================

    function StateLine({ children }) {
      return React.createElement('div', { className: 'wyy-state' }, children)
    }

    /** 区块头右槽：原型里这个位置是 .wyy-sec-head a（计时/排序/计数都用它，fs-meta/700/字距/三级灰）。
        传 onClick 就是真控件，不传就是静态注解 —— 原型那 6 处全是无 href 的死链，实物不抄死链。 */
    function SecNote({ children, onClick }) {
      if (children === null || children === undefined || children === '') return null
      return onClick
        ? React.createElement('button', { className: 'wyy-h3-sub act', onClick }, children)
        : React.createElement('span', { className: 'wyy-h3-sub' }, children)
    }

    /** Spotify 式歌曲行：悬停时序号位置浮出播放键，正在播放的行标题变强调色 + 音柱。 */
    function SongList({ songs, onPlay, onPlayNext, activeId, activePlaying = false, showAlbum = true, showIndex = true }) {
      if (!Array.isArray(songs) || songs.length === 0) return React.createElement(StateLine, null, t('emptySongs'))
      // 不显示专辑的场合（队列抽屉）走紧凑栅格：专辑那一轨换成 1fr 全部让给标题
      const rowCls = 'wyy-row' + (showAlbum ? '' : ' compact')
      return React.createElement('div', { className: 'wyy-songs' },
        songs.map((s, i) => {
          const active = activeId !== undefined && s.id === activeId
          const play = () => onPlay(songs, i)
          return React.createElement('div', {
            key: s.id + '-' + i,
            className: rowCls + (active ? ' active' : ''),
            // data-raw = 上游数据（曲名/歌手/专辑/分类/昵称/歌词）：i18n 校验要把"数据"与"文案"分开 ——
            // 文案整串出现在英文档里就是漏翻，要报红；数据本来就不翻（翻了反而搜不到），
            // 但两者可能撞串（网易云的分类里就有「榜单」，和我们榜单眉题的文案同字）。
            // 校验探针约定跳过 [data-raw] 子树；只标纯数据节点，混排的（如正在播放态）留给文案侧查。
            'data-raw': '1',
            role: 'button',
            tabIndex: 0,
            title: s.title + (s.album ? ' — ' + s.album : ''),
            onClick: play,
            onKeyDown: (e) => {
              // 行尾的「下一首播放」不进 Tab 序（整行已经是 role=button），键盘走 Shift+Enter
              if (e.key === 'Enter' && e.shiftKey && onPlayNext) { e.preventDefault(); onPlayNext(s); return }
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play() }
            },
          }, [
            showIndex
              ? React.createElement('span', { key: 'i', className: 'wyy-row-idx' }, [
                React.createElement('span', { key: 'n', className: 'wyy-row-idx-num' }, active ? null : String(i + 1)),
                React.createElement('span', { key: 'p', className: 'wyy-row-idx-play' },
                  active && activePlaying ? React.createElement(Equalizer, { playing: true }) : React.createElement(IconPlay, { size: 13 })),
              ])
              : null,
            // 第 2 轨 = 封面 + 标题 + 歌手（原型的 .tt）：封面是扫列表的视觉锚点，
            // 单独占轨会让"标题:专辑 = 3:2"的比例落空，所以跟文字同处一格。
            React.createElement('div', { key: 'm', className: 'wyy-row-main' }, [
              s.cover
                ? React.createElement('img', { key: 'c', className: 'wyy-row-cover', src: s.cover, alt: '', loading: 'lazy' })
                : React.createElement('span', { key: 'c', className: 'wyy-row-cover ph' }, React.createElement(IconNote, { size: 16 })),
              React.createElement('div', { key: 'i', className: 'wyy-row-info' }, [
                React.createElement('div', { key: 'h', className: 'wyy-row-head' }, [
                  React.createElement('span', { key: 't', className: 'wyy-row-title' }, s.title),
                  s.fee === 1 || s.fee === 4 ? React.createElement('span', { key: 'v', className: 'wyy-badge vip' }, 'VIP') : null,
                  s.freeTrialInfo !== undefined && s.freeTrialInfo !== null ? React.createElement('span', { key: 'tr', className: 'wyy-badge' }, t('trial')) : null,
                ]),
                React.createElement('div', { key: 'a', className: 'wyy-row-sub' }, artistLine(s)),
              ]),
            ]),
            // 专辑独立成列（原型 5 轨布局的第 3 轨）：塞进副标题会把"歌手"和"专辑"两条
            // 不同性质的信息挤成一行，英文档下尤其容易整条被省略号吃掉。
            // 空专辑也占位：栅格按轨道排，缺一格会把后面的时长顶到专辑那一轨上去。
            showAlbum
              ? React.createElement('div', { key: 'al', className: 'wyy-row-album', title: s.album || '' }, s.album || '')
              : null,
            React.createElement('span', { key: 'd', className: 'wyy-row-dur' }, fmtTime(s.interval)),
            // 第 5 轨在原设计里是红心（收藏单曲）。插件没有官方"喜欢"接口，画个按不动的
            // 红心比不画更差 —— 这一轨改放真能用的「下一首播放」，宽度形状与原型一致。
            React.createElement('div', { key: 'e', className: 'wyy-row-end' },
              onPlayNext
                ? React.createElement('button', {
                  key: 'x', className: 'wyy-icon-btn small wyy-row-next', tabIndex: -1,
                  title: t('playNext'), 'aria-label': t('playNext'),
                  onClick: (e) => { e.stopPropagation(); onPlayNext(s) },
                }, React.createElement(IconPlayNext, { size: 15 }))
                : null),
          ])
        }))
    }

    /**
     * Spotify 式卡片：封面 + 标题 + 副标题，悬停时右下沉入一个圆形播放键。
     * 点卡片 = 进歌单；点圆形键 = 直接开播（Spotify 的手感），正在播该歌单时变暂停键。
     */
    function PlaylistGrid({ items, onOpen, onPlayItem, source, playing, empty }) {
      if (!Array.isArray(items) || items.length === 0) return React.createElement(StateLine, null, empty || t('emptyPl'))
      return React.createElement('div', { className: 'wyy-grid' },
        items.map((p) => {
          const isSource = source !== null && source !== undefined && source.id === p.id
          const sub = isSource ? t('nowPlaying')
            : (p.playCount ? tf('plays', { n: fmtCount(p.playCount) }) : (p.creator || ''))
          return React.createElement('div', {
            key: p.id,
            className: 'wyy-card',
            role: 'button',
            tabIndex: 0,
            title: p.name,
            onClick: () => onOpen(p),
            onKeyDown: (e) => { if (e.key === 'Enter') onOpen(p) },
          }, [
            React.createElement('div', { key: 'c', className: 'wyy-card-cover' }, [
              p.cover
                ? React.createElement('img', { key: 'i', src: p.cover, alt: '', loading: 'lazy' })
                : React.createElement('div', { key: 'i', className: 'wyy-card-ph' }, React.createElement(IconNote, { size: 26 })),
              onPlayItem
                ? React.createElement('button', {
                  key: 'b',
                  className: 'wyy-card-play',
                  'aria-label': isSource && playing ? t('pause') : tf('playName', { x: p.name }),
                  onClick: (e) => { e.stopPropagation(); onPlayItem(p) },
                }, isSource && playing ? React.createElement(IconPause, { size: 16 }) : React.createElement(IconPlay, { size: 16 }))
                : null,
            ]),
            React.createElement('div', { key: 'n', className: 'wyy-card-name', 'data-raw': '1' }, p.name),
            // 没话说的副行不占版位：空 div 顶着 4px 上边距把卡片撑出半行空白。
            // 谁会没话说：只存了 id/name/cover 的旧历史条目，以及匿名档拿不到播放量的歌单。
            sub === '' ? null
              : React.createElement('div', { key: 'm', className: 'wyy-card-sub', 'data-raw': isSource ? undefined : '1' }, sub),
          ])
        }))
    }

    // =================================================================
    // 登录
    // =================================================================

    function LoginDialog({ onClose, onChanged }) {
      const [tab, setTab] = useState('qr')
      const [qr, setQr] = useState(null)
      const [status, setStatus] = useState('')
      const [err, setErr] = useState('')
      const [busy, setBusy] = useState(false)
      const keyRef = useRef('')

      const loadQr = useCallback(async () => {
        setErr(''); setStatus(t('qrLoading')); setQr(null)
        try {
          const r = await api('/qr')
          setQr(r); keyRef.current = r.key; setStatus(t('qrScan'))
        } catch (e) { setErr(e.message); setStatus('') }
      }, [])

      useEffect(() => { if (tab === 'qr') loadQr() }, [tab, loadQr])

      // 轮询扫码结果；803 成功后刷新登录态并关闭
      useEffect(() => {
        if (tab !== 'qr' || qr === null) return undefined
        let stop = false
        const timer = setInterval(async () => {
          if (stop || keyRef.current === '') return
          try {
            const r = await api('/qr/check?key=' + encodeURIComponent(keyRef.current))
            if (stop) return
            if (r.status === 'success') {
              setStatus(t('loginOk'))
              clearInterval(timer)
              onChanged()
              setTimeout(onClose, 500)
            } else if (r.status === 'expired') {
              setStatus(t('qrExpired'))
              clearInterval(timer)
              loadQr()
            } else setStatus(r.message || t('qrWaiting'))
          } catch { /* 轮询失败不打断，下一轮再试 */ }
        }, 2000)
        return () => { stop = true; clearInterval(timer) }
      }, [tab, qr, onChanged, onClose, loadQr])

      const doImport = async () => {
        setBusy(true); setErr(''); setStatus('')
        try {
          await api('/import-musicfox', { method: 'POST' })
          setStatus(t('mfImported'))
          onChanged()
          setTimeout(onClose, 500)
        } catch (e) { setErr(e.message) } finally { setBusy(false) }
      }

      return React.createElement('div', { className: 'wyy-modal-mask', onClick: onClose }, [
        React.createElement('div', {
          key: 'm', className: 'wyy-modal', ref: (el) => applyOrigin(el), onClick: (e) => e.stopPropagation(),
        }, [
          React.createElement('div', { key: 'h', className: 'wyy-modal-head' }, [
            React.createElement('span', { key: 't' }, t('loginBtn')),
            React.createElement('button', { key: 'x', className: 'wyy-icon-btn', onClick: onClose, 'aria-label': t('close') }, '✕'),
          ]),
          React.createElement('div', { key: 'tabs', className: 'wyy-chips' }, [
            React.createElement('button', { key: 'qr', className: 'wyy-chip' + (tab === 'qr' ? ' on' : ''), onClick: () => setTab('qr') }, t('tabQr')),
            React.createElement('button', { key: 'mf', className: 'wyy-chip' + (tab === 'mf' ? ' on' : ''), onClick: () => setTab('mf') }, t('tabMf')),
          ]),
          tab === 'qr'
            ? React.createElement('div', { key: 'body', className: 'wyy-modal-body' }, [
              qr !== null
                ? React.createElement('img', { key: 'img', className: 'wyy-qr', src: qr.imageDataUrl, alt: t('qrAlt') })
                : React.createElement('div', { key: 'ph', className: 'wyy-qr-ph' }, busy ? '…' : t('qrPh')),
              React.createElement('div', { key: 's', className: 'wyy-modal-status' }, status),
              React.createElement('button', { key: 'r', className: 'wyy-btn ghost', onClick: loadQr }, t('qrRefresh')),
            ])
            : React.createElement('div', { key: 'body', className: 'wyy-modal-body' }, [
              React.createElement('p', { key: 'p', className: 'wyy-modal-text' },
                t('mfExplain')),
              React.createElement('button', { key: 'b', className: 'wyy-btn', disabled: busy, onClick: doImport }, busy ? t('importing') : t('mfImport')),
              React.createElement('div', { key: 's', className: 'wyy-modal-status' }, status),
            ]),
          err !== '' ? React.createElement('div', { key: 'e', className: 'wyy-modal-err' }, err) : null,
        ]),
      ])
    }

    // =================================================================
    // 全屏 Now Playing（大屏歌词）
    // =================================================================

    /**
     * 一行歌词能跳到第几秒以内、点了也没意义。
     * 片头那几行（作词/作曲/编曲/制作人）在 LRC 里就是 `[00:00.000]`，**不是歌的一部分**：
     * 点它等于跳回曲首。实测点第 0 行后 `t=0.00`、走时从 0 重新爬 —— 用户报的"点歌词跳回曲首"
     * 就是这个（一首歌常常有 2~4 行这种，随机点一下命中率不低）。
     */
    const LINE_SEEK_MIN = 0.05

    /** 一行歌词：逐字（或整行）按进度做渐变填充 = 卡拉OK。**纯展示**，点不点由整行决定。 */
    function LyricText({ line, now, big }) {
      const words = Array.isArray(line.words) && line.words.length > 0 ? line.words : null
      if (words === null) {
        return React.createElement('div', { className: 'wyy-ly-main' },
          React.createElement('span', { className: 'wyy-ly-plain' }, line.text))
      }
      return React.createElement('div', { className: 'wyy-ly-main' },
        words.map((w, wi) => {
          const span = Math.max(0.001, w.end - w.t)
          const p = now <= w.t ? 0 : (now >= w.end ? 100 : ((now - w.t) / span) * 100)
          return React.createElement('span', {
            key: wi,
            className: 'wyy-word' + (big ? ' big' : ''),
            style: {
              backgroundImage: 'linear-gradient(90deg, var(--wyy-ly-on) ' + p + '%, var(--wyy-ly-off) ' + p + '%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            },
          }, w.text)
        }))
    }

    /**
     * 队列抽屉。原型排行榜色带上那个 queue 图标在这里落地：数据全在本地
     * （player.state.queue），不额外打上游，点某行 = 跳到那一首。
     */
    function QueuePanel({ onClose }) {
      const s = usePlayer()
      const activeId = s.idx >= 0 && s.idx < s.queue.length ? s.queue[s.idx].id : ''
      useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose() }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [onClose])
      return React.createElement('div', { className: 'wyy-queue', ref: (el) => applyOrigin(el) }, [
        React.createElement('div', { key: 'h', className: 'wyy-queue-head' }, [
          React.createElement('div', { key: 't', className: 'wyy-queue-title' }, [
            React.createElement('span', { key: 'k', className: 'wyy-queue-kicker' }, t('queue')),
            React.createElement('span', { key: 'n', className: 'wyy-queue-sub' },
              s.source && s.source.name ? s.source.name : tf('totalTracks', { n: s.queue.length })),
          ]),
          React.createElement('button', {
            key: 'x', className: 'wyy-icon-btn small', title: t('close'), 'aria-label': t('close'),
            onClick: onClose,
          }, '✕'),
        ]),
        React.createElement('div', { key: 'b', className: 'wyy-queue-body' },
          s.queue.length === 0
            ? React.createElement(StateLine, null, t('emptyQueue'))
            : React.createElement(SongList, {
              songs: s.queue, activeId, activePlaying: s.playing, showAlbum: false,
              onPlay: (list, i) => playAt(i),
              onPlayNext: (song) => playNext(song),
            })),
      ])
    }

    function NowPlaying({ song, playing, closing, origin, onClose, onOpenQueue }) {
      const now = useSmoothTime(playing && song !== null)
      const { data, err } = useLyric(song === null ? '' : song.id)
      const boxRef = useRef(null)
      const activeRef = useRef(null)
      const artRef = useRef(null)
      const flewRef = useRef(false)
      const lines = data === null ? [] : data.lines
      const active = activeLineIndex(lines, now)

      // 封面从播放条那张小封面**飞**过来，而不是凭空出现在大屏上。
      // 这是整块全屏唯一的"接续"：用户按的是播放条/小封面，那么被按的那个东西本身就该长大成
      // 全屏的封面 —— 同源、连续、看得见因果。凭空淡入再淡出（=两张互斥画面）无论多顺都是换片。
      // 做法是 FLIP：先量出小封面与大封面各自的框，把大封面**倒置**到小封面的位置和尺寸，
      // 强制一次样式解析，再撤掉倒置 —— 浏览器从倒置值过渡回原位，看起来就是从那儿长出来的。
      // 行程 852px，所以走 --t-art(1s) + --ease-glide：320ms 配 --ease 时实测 687px/帧，
      // 那是"跳一下再滑过去"。封面全程 opacity 1 —— 它此刻**就是**播放条那张（同一张图、同一个框），
      // 透明度和接续没关系，只负责让它看起来是实物而不是影子。
      useLayoutEffect(() => {
        const el = artRef.current
        if (el === null) return
        const from = document.querySelector('.wyy-bar-cover')
        if (from === null) return
        const a = from.getBoundingClientRect()
        const b = el.getBoundingClientRect()
        if (a.width < 6 || b.width < 6) return
        const k = a.width / b.width
        el.style.transformOrigin = 'top left'
        el.style.transition = 'none'
        el.style.transform = 'translate(' + (a.left - b.left) + 'px,' + (a.top - b.top) + 'px) scale(' + k + ')'
        void el.offsetWidth
        el.style.transition = ''
        el.style.transform = ''
      }, [])

      useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose() }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [onClose])

      // 收起：封面**飞回**播放条那张小封面 —— 打开那趟的逆。两个方向的边界都"有东西活下来"，
      // 中间不是一次硬切。这里只写目标值，动由 .wyy-np-art 上那条 --t-art(1s) 的过渡负责；
      // 地板/歌词那一批 320ms 就淡完了，封面还在路上 —— 所以它是结实的，不是鬼影。
      useEffect(() => {
        const el = artRef.current
        if (el === null) return
        // 收到一半又被打开（连点播放条）：把倒置撤掉，封面飞回自己的槽，不然它会卡在播放条那儿。
        // 判据必须是"**真的飞过**"（closedRef），不能用 closing 的当前值：这个 effect 挂载时也会跑一次，
        // 那一刻开场那趟飞的倒置正在播 —— 顺手把 transform-origin 一起清掉，会把它从 top left 重新锚回
        // 中心，整趟飞的起手点就偏出 (1-k)·(w/2,h/2)（实测 385px，正是 .9135×半宽/半高）。
        if (closing !== true) {
          if (flewRef.current) { el.style.transform = ''; el.style.transformOrigin = ''; flewRef.current = false }
          return
        }
        const to = document.querySelector('.wyy-bar-cover')
        if (to === null) return
        const a = to.getBoundingClientRect()
        const b = el.getBoundingClientRect()
        if (a.width < 6 || b.width < 6) return
        const k = a.width / b.width
        el.style.transformOrigin = 'top left'
        el.style.transform = 'translate(' + (a.left - b.left) + 'px,' + (a.top - b.top) + 'px) scale(' + k + ')'
        flewRef.current = true
      }, [closing])

      // 当前行居中，但**让位给用户**：指针在歌词里、或刚点过一句之后的这一小段时间，
      // 自动滚动一律闭嘴（"画面永远在动"是错的，静止才衬得出动作）。指针离开后补一次居中。
      const holdRef = useRef(0)
      const inRef = useRef(false)
      const [recenter, setRecenter] = useState(0)
      const holdScroll = useCallback((ms = 2600) => {
        holdRef.current = Date.now() + ms
        stopScroll()
      }, [])

      useEffect(() => {
        const el = activeRef.current
        const box = boxRef.current
        if (el === null || box === null) return undefined
        if (inRef.current || Date.now() < holdRef.current) return undefined
        const target = Math.max(0, el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2)
        tweenScroll(box, target, tokenMs(box, '--t-slow', 320))
        return stopScroll
      }, [active, song === null ? '' : song.id, recenter])

      const s = player.state
      const cover = song !== null && song.cover ? song.cover : ''
      const dur = trackDur(song, s)
      const npct = dur > 0 ? Math.min(100, (now / dur) * 100) : 0

      // 换歌时封面的底光要"溶"过去而不是"跳"过去。艺术色那几层靠 @property 注册成了可插值的
      // <color>，图片层注册不了（background-image 不参与过渡），所以只能叠两层：
      // 新封面直接铺在下面，旧封面盖在它上面用 animation 淡出 —— 用 animation 而不是 transition，
      // 是因为 transition 需要"先以旧值挂载、下一帧再改值"，多一次渲染就多一次闪烁。
      const [prevCover, setPrevCover] = useState('')
      const lastCover = useRef(cover)
      useEffect(() => {
        if (lastCover.current === cover) return undefined
        const old = lastCover.current
        lastCover.current = cover
        setPrevCover(old)
        const tm = setTimeout(() => setPrevCover(''), 640)
        return () => clearTimeout(tm)
      }, [cover])

      return React.createElement('div', {
        className: 'wyy-np' + (closing ? ' out' : ''),
        style: { '--np-ox': origin.x + '%', '--np-oy': origin.y + '%' },
      }, [
        // 地板（底色 + 渐变 + 压暗的模糊封面）合起来是一层：收起时它整层淡出，而封面在它**外面** ——
        // 这一层是绝对定位的，不是栅格子项，所以列布局一点没动。
        React.createElement('div', { key: 'g', className: 'wyy-np-ground' }, [
          cover !== ''
            ? React.createElement('div', { key: 'bg', className: 'wyy-np-bg', style: { backgroundImage: 'url("' + cover + '")' } })
            : null,
          prevCover !== '' && prevCover !== cover
            ? React.createElement('div', {
              key: 'bgprev', className: 'wyy-np-bg prev', style: { backgroundImage: 'url("' + prevCover + '")' },
            })
            : null,
        ]),
        // 左列：眉题 + 收起钮同一行（原型是这么排的，顶部不再单独占一条横栏 ——
        // 那条横栏会把封面挤矮，44% 的列宽也起不来）
        React.createElement('div', { key: 'l', className: 'wyy-np-left' }, [
          React.createElement('div', { key: 'top', className: 'wyy-np-lyrow' }, [
            React.createElement('div', { key: 'k', className: 'wyy-np-head-kicker' }, t('nowPlaying')),
            React.createElement('button', {
              key: 'c', className: 'wyy-np-collapse', onClick: onClose, title: t('npCollapse'), 'aria-label': t('npCollapseAria'),
            }, React.createElement(IconChevronDown, { size: 22 })),
          ]),
          song === null
            ? React.createElement('div', { key: 'empty', className: 'wyy-np-empty' }, t('npEmpty'))
            : [
              cover !== ''
                ? React.createElement('img', { key: 'a', ref: artRef, className: 'wyy-np-art', src: cover, alt: '' })
                : React.createElement('div', { key: 'a', ref: artRef, className: 'wyy-np-art ph' }, React.createElement(IconNote, { size: 48 })),
              React.createElement('div', { key: 'm', className: 'wyy-np-meta' }, [
                React.createElement('div', { key: 't', className: 'wyy-np-title', 'data-raw': '1' }, song.title),
                // 歌手和专辑排一行（原型 .t2 "July · To Heaven"）：分成两行会在
                // 封面下方堆出四层文字，越往下越没人读
                React.createElement('div', { key: 'ar', className: 'wyy-np-artist', 'data-raw': '1' },
                  artistLine(song) + (song.album ? ' · ' + song.album : '')),
              ]),
              React.createElement('div', { key: 'prog', className: 'wyy-np-prog' }, [
                React.createElement('span', { key: 't', className: 'wyy-np-time' }, fmtTime(now)),
                React.createElement('div', {
                  key: 'tr', className: 'wyy-np-track', role: 'slider', tabIndex: 0, 'aria-label': t('progress'),
                  'aria-valuenow': Math.round(now), 'aria-valuemin': 0, 'aria-valuemax': Math.round(dur),
                  'aria-valuetext': fmtTime(now) + ' / ' + fmtTime(dur),
                  ...scrubProps(() => dur, () => now, seekTo),
                  onClick: (e) => {
                    if (dur <= 0) return
                    const box = e.currentTarget.getBoundingClientRect()
                    const r = Math.max(0, Math.min(1, (e.clientX - box.left) / (box.width || 1)))
                    seekTo(r * dur, r)
                  },
                }, React.createElement('div', { className: 'wyy-np-track-fill', style: { width: npct + '%' } })),
                React.createElement('span', { key: 'd', className: 'wyy-np-time' }, fmtTime(dur)),
              ]),
              // 大屏也要能控播放，不然看着歌词想暂停还得收起面板。
              // 两簇：左簇走播放控制（含随机/循环），右簇是队列和音量（原型的两簇结构）。
              React.createElement('div', { key: 'ctl', className: 'wyy-np-ctrl' }, [
                React.createElement('div', { key: 'm', className: 'wyy-np-ctl-main' }, [
                  React.createElement('button', {
                    key: 'sh', className: 'wyy-icon-btn' + (s.shuffle ? ' on' : ''), title: t('shuffle'),
                    'aria-label': t('shuffle'), onClick: () => player.set({ shuffle: !s.shuffle }),
                  }, React.createElement(IconShuffle, { size: 20 })),
                  React.createElement('button', {
                    key: 'p', className: 'wyy-icon-btn', title: t('prev'), 'aria-label': t('prev'), onClick: prevTrack,
                  }, React.createElement(IconPrev, { size: 20 })),
                  React.createElement('button', {
                    key: 't', className: 'wyy-icon-btn play big', title: playing ? t('pause') : t('play'),
                    'aria-label': playing ? t('pause') : t('play'), onClick: togglePlay,
                  }, playing ? React.createElement(IconPause, { size: 22 }) : React.createElement(IconPlay, { size: 22 })),
                  React.createElement('button', {
                    key: 'n', className: 'wyy-icon-btn', title: t('next'), 'aria-label': t('next'), onClick: () => nextTrack(false),
                  }, React.createElement(IconNext, { size: 20 })),
                  React.createElement('button', {
                    key: 'rp', className: 'wyy-icon-btn' + (s.repeat !== 'off' ? ' on' : ''), title: t('repeat'),
                    'aria-label': t('repeat'),
                    onClick: () => player.set({ repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off' }),
                  }, React.createElement(IconRepeat, { size: 20 })),
                ]),
                React.createElement('div', { key: 's', className: 'wyy-np-ctl-side' }, [
                  React.createElement('button', {
                    key: 'q', className: 'wyy-icon-btn', title: t('queue'), 'aria-label': t('queue'),
                    onClick: onOpenQueue,
                  }, React.createElement(IconQueue, { size: 20 })),
                  React.createElement('input', {
                    key: 'v', className: 'wyy-np-vol', type: 'range', min: 0, max: 1, step: 0.01,
                    value: s.volume, 'aria-label': t('volume'), onChange: (e) => setVolume(Number(e.target.value)),
                  }),
                ]),
              ]),
            ],
        ]),
        React.createElement('div', { key: 'r', className: 'wyy-np-lyric-box' }, [
          React.createElement('div', { key: 'k', className: 'wyy-np-head-kicker' }, t('lyrics')),
          song === null
            ? null
            : err !== ''
              ? React.createElement('div', { key: 'e', className: 'wyy-np-hint' }, err)
              : data === null
                ? React.createElement('div', { key: 'l', className: 'wyy-np-hint' }, t('lyLoading'))
                : lines.length === 0
                  ? React.createElement('div', { key: 'n', className: 'wyy-np-hint' }, t('lyNone'))
                  : React.createElement('div', {
                    key: 'sc', className: 'wyy-np-lyric', 'data-raw': '1', ref: boxRef,
                    onPointerEnter: () => { inRef.current = true; stopScroll() },
                    onPointerLeave: () => { inRef.current = false; setRecenter((x) => x + 1) },
                  },
                    lines.map((l, i) => {
                      const isActive = i === active
                      // 点击挂在**整行**上（译文也算），不是挂在文字块上：文字块只有字那么宽，
                      // 而译文那一行原本压根没有 handler —— 点上去没反应会让人以为"点不准"。
                      const canSeek = l.t > LINE_SEEK_MIN
                      // 也带一份"这句在整首里的相对位置"：万一点下去那一刻正好在换歌，
                      // 新曲按同样的相对位置落，而不是把上一首的绝对时刻硬套上去。
                      // 总时长未知时给 null（不能用 1 —— 新语义里 1 是"整首的最后一成"）
                      const lyRatio = dur > 0 ? l.t / dur : null
                      const hit = canSeek
                        ? {
                          role: 'button',
                          tabIndex: 0,
                          title: t('lySeek'),
                          onClick: () => { holdScroll(); seekTo(l.t, lyRatio) },
                          onKeyDown: (e) => {
                            if (e.key !== 'Enter' && e.key !== ' ') return
                            e.preventDefault()
                            holdScroll()
                            seekTo(l.t, lyRatio)
                          },
                        }
                        : null
                      return React.createElement('div', Object.assign({
                        key: i,
                        ref: isActive ? activeRef : null,
                        className: 'wyy-np-ly' + (isActive ? ' on' : '') + (i < active ? ' past' : '') + (canSeek ? '' : ' plain'),
                      }, hit), [
                        React.createElement(LyricText, { key: 'm', line: l, now: isActive ? now : 0, big: true }),
                        l.sub ? React.createElement('div', { key: 's', className: 'wyy-np-ly-sub' }, l.sub) : null,
                      ])
                    })),
        ]),
      ])
    }

    // =================================================================
    // 视图
    // =================================================================

    /** 一次点击就把歌单变成队列（Spotify 卡片上的圆形播放键）。 */
    function usePlayPlaylist() {
      return useCallback(async (p, sourceKind) => {
        const cur = player.state
        if (cur.source !== null && cur.source !== undefined && cur.source.id === p.id && cur.idx >= 0) {
          togglePlay()
          return
        }
        try {
          const r = await api('/playlist?id=' + encodeURIComponent(p.id))
          const songs = (r.playlist && r.playlist.songs) || []
          if (songs.length === 0) { player.set({ error: t('eEmptyPl') }); return }
          playFrom(songs, 0, { kind: sourceKind || 'playlist', id: p.id, name: p.name, cover: p.cover || '',
            playCount: r.playlist && r.playlist.playCount, creator: r.playlist && r.playlist.creator })
        } catch (e) { player.set({ error: tf('eOpenPl', { m: e.message }) }) }
      }, [])
    }

    /**
     * 歌单收藏态。初始值由接口给（发现页的推荐列表不带 subscribed，按未收藏渲染）；
     * 点击乐观翻转、失败回滚；未登录不当错误，交给上层的登录弹窗。
     */
    function useCollect(playlistId, initial, onNeedLogin) {
      const [sub, setSub] = useState(initial === true)
      const [busy, setBusy] = useState(false)
      useEffect(() => { setSub(initial === true); setBusy(false) }, [playlistId, initial])
      const toggle = useCallback(async () => {
        setBusy(true)
        const next = !sub
        setSub(next)
        try {
          await api('/playlist/subscribe', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: playlistId, action: next ? 'collect' : 'uncollect' }),
          })
        } catch (e) {
          setSub(!next)
          if (e.needLogin === true) { if (onNeedLogin) onNeedLogin() } else player.set({ error: tf('eCollect', { m: e.message }) })
        } finally { setBusy(false) }
      }, [playlistId, sub, onNeedLogin])
      return { sub, busy, toggle }
    }

    /**
     * 色带 —— L3 取色的主要对外形状：把一张封面的取色铺成"从色带色渐到页面底色"的纵向渐变，
     * 承载封面 + 标题 + 统计 + 主按钮。机制抄的是 Spotify 的主推大图：饱和色不是画上去的装饰，
     * 是从封面里量出来的，而且**每个着色面自带一个在这块面上达标的前景色**。
     *
     * 渐变每一档都只往 --wyy-bg 方向混，绝不混 vivid/deep：混向页面底色只会让对比度更高，
     * 混向 vivid/deep 会把 --art-on 的 4.5:1 直接作废（原型里那版就是这么写的，没量过）。
     */
    function ArtBand({ cover, eyebrow, title, sub, meta, actions }) {
      const { style, state } = useArt(cover)
      return React.createElement('div', { className: 'wyy-band wyy-art', style: style, 'data-art': state }, [
        React.createElement('div', { key: 'h', className: 'wyy-band-head' }, [
          cover
            ? React.createElement('img', { key: 'a', className: 'wyy-band-art', src: cover, alt: '', loading: 'lazy' })
            : React.createElement('div', { key: 'a', className: 'wyy-band-art ph' }, React.createElement(IconNote, { size: 44 })),
          React.createElement('div', { key: 't', className: 'wyy-band-txt' }, [
            eyebrow ? React.createElement('div', { key: 'k', className: 'wyy-band-kicker' }, eyebrow) : null,
            React.createElement('h1', { key: 'n', className: 'wyy-band-title', 'data-raw': '1' }, title),
            sub ? React.createElement('div', { key: 's', className: 'wyy-band-sub' }, sub) : null,
            meta && meta.filter(Boolean).length
              ? React.createElement('div', { key: 'm', className: 'wyy-band-meta', 'data-raw': '1' },
                meta.filter(Boolean).reduce((acc, m, i) => {
                  if (i > 0) acc.push(React.createElement('i', { key: 'sep' + i, className: 'sep' }))
                  acc.push(React.createElement('span', { key: 'm' + i }, m))
                  return acc
                }, []))
              : null,
          ]),
        ]),
        actions && actions.filter(Boolean).length
          ? React.createElement('div', { key: 'tools', className: 'wyy-band-tools' }, actions.filter(Boolean))
          : null,
      ])
    }

    /** 快选磁贴：96px 的饱和色块，底色与字色来自同一张封面的取色，右下角斜插一张缩略图。 */
    function ArtTile({ item, onOpen }) {
      const { style, state } = useArt(item.cover)
      return React.createElement('button', {
        className: 'wyy-tile wyy-art', style: style, title: item.name, onClick: () => onOpen(item),
        'data-art': state,
      }, [
        React.createElement('span', { key: 'n', className: 'wyy-tile-name', 'data-raw': '1' }, item.name),
        item.cover
          ? React.createElement('img', { key: 'i', className: 'wyy-tile-art', src: item.cover, alt: '', loading: 'lazy' })
          : null,
      ])
    }

    function DiscoverView({ onOpenPlaylist, onOpenCategory, onNeedLogin }) {
      const [rec, setRec] = useState(null)
      const [cats, setCats] = useState(null)
      const [err, setErr] = useState('')
      const s = usePlayer()
      const playPlaylist = usePlayPlaylist()
      // 「为白天/夜晚准备」跟的是宿主主题：白天推荐早间歌单、夜晚推深夜向，原型就是这么分档的
      const dark = useDsDark()
      // 主推色带取第一张推荐封面 —— 发现页一进来就该是一整块饱和色，而不是一列灰卡片。
      const hero = rec !== null && rec.length > 0 ? rec[0] : null
      const heroPlaying = hero !== null && s.source !== null && s.source !== undefined
        && s.source.id === hero.id && s.playing
      // 推荐列表不带 subscribed，收藏态只能从"未收藏"起算，点一下才知道
      const collect = useCollect(hero === null ? '' : hero.id, false, onNeedLogin)

      useEffect(() => {
        let cancelled = false
        Promise.all([api('/recommend'), api('/categories')]).then(([r, c]) => {
          if (cancelled) return
          setRec(r.playlists); setCats(c.categories)
        }).catch((e) => { if (!cancelled) setErr(e.message) })
        return () => { cancelled = true }
      }, [])

      if (err !== '') return React.createElement(StateLine, null, err)

      const groups = {}
      for (const c of (cats || [])) {
        const g = c.group || t('other')
        if (groups[g] === undefined) groups[g] = []
        groups[g].push(c)
      }

      // 磁贴数量对齐原型（6 块）：块数多于 6 时 grid-auto-columns 的 1fr 摊不开，
      // 整条会退化到 148px 最小值并横向滚动，密度跟设计就不是一回事了。
      const strip = rec === null ? [] : rec.slice(1, 7)
      // 最近播放只放面板里真的点开过的（宿主 prefs 持久化），空则整段不出现
      const recentItems = ui.recent.slice(0, 6)

      return React.createElement('div', { className: 'wyy-view' }, [
        hero === null ? null : React.createElement(ArtBand, {
          key: 'band',
          cover: hero.cover,
          eyebrow: t('kickerWeek'),
          title: hero.name,
          // 副标题与元信息按原型的三件套：样本描述（带播放量）/ 歌单 · 由网易云编辑推荐 · 共 N 首。
          // 之前副标题是句静态文案、播放量混在第 3 条元信息里，读起来和原型不是一回事。
          sub: hero.playCount ? tf('discSubN', { n: fmtCount(hero.playCount) }) : t('discSub'),
          meta: [t('kickerPl'), t('editedBy'), hero.trackCount ? tf('totalTracks', { n: hero.trackCount }) : ''],
          actions: [
            React.createElement('button', {
              key: 'p', className: 'wyy-round-btn big',
              title: heroPlaying ? t('pause') : tf('playName', { x: hero.name }),
              'aria-label': heroPlaying ? t('pause') : tf('playName', { x: hero.name }),
              onClick: () => playPlaylist(hero, 'playlist'),
            }, heroPlaying ? React.createElement(IconPause, { size: 20 }) : React.createElement(IconPlay, { size: 20 })),
            React.createElement('button', {
              key: 'sh', className: 'wyy-icon-btn on-band' + (s.shuffle ? ' on' : ''), title: t('shuffle'),
              'aria-label': t('shuffle'),
              onClick: () => player.set({ shuffle: !s.shuffle }),
            }, React.createElement(IconShuffle, null)),
            React.createElement('button', {
              key: 'c', className: 'wyy-icon-btn on-band', disabled: collect.busy,
              title: collect.sub ? t('collected') : (collect.busy ? t('collecting') : t('collect')),
              'aria-label': collect.sub ? t('collected') : (collect.busy ? t('collecting') : t('collect')),
              'aria-pressed': collect.sub,
              onClick: collect.toggle,
            }, collect.sub ? React.createElement(IconHeartFill, null) : React.createElement(IconHeart, null)),
          ],
        }),
        // 原型把「最近播放」放在发现页第一段：回头听比探索更常用
        recentItems.length === 0 ? null : React.createElement('div', { key: 'recent', className: 'wyy-section' }, [
          React.createElement('div', { key: 'h', className: 'wyy-sec-head' }, [
            React.createElement('h3', { key: 't', className: 'wyy-h3' }, t('recent')),
            React.createElement(SecNote, { key: 's' }, tf('totalItems', { n: recentItems.length })),
          ]),
          React.createElement(PlaylistGrid, {
            key: 'g', items: recentItems, onOpen: onOpenPlaylist, onPlayItem: playPlaylist,
            source: s.source, playing: s.playing,
          }),
        ]),
        strip.length === 0 ? null : React.createElement('div', { key: 'tiles', className: 'wyy-section' }, [
          React.createElement('div', { key: 'h', className: 'wyy-sec-head' }, [
            React.createElement('h3', { key: 't', className: 'wyy-h3' }, t(dark ? 'madeForNight' : 'madeForDay')),
            React.createElement(SecNote, { key: 's' }, tf('totalItems', { n: strip.length })),
          ]),
          React.createElement('div', { key: 's', className: 'wyy-strip' },
            strip.map((p) => React.createElement(ArtTile, { key: p.id, item: p, onOpen: onOpenPlaylist }))),
        ]),
        React.createElement('div', { key: 'rec', className: 'wyy-section' }, [
          React.createElement('div', { key: 'h', className: 'wyy-sec-head' }, [
            React.createElement('h3', { key: 't', className: 'wyy-h3' }, t('recTitle')),
            React.createElement(SecNote, { key: 's' }, rec === null ? null : tf('totalItems', { n: rec.length })),
          ]),
          rec === null
            ? React.createElement(StateLine, { key: 'l' }, t('loading'))
            : React.createElement(PlaylistGrid, {
              key: 'g', items: rec, onOpen: onOpenPlaylist, onPlayItem: playPlaylist,
              source: s.source, playing: s.playing,
            }),
        ]),
        React.createElement('div', { key: 'cat', className: 'wyy-section' }, [
          React.createElement('div', { key: 'h', className: 'wyy-sec-head' }, [
            React.createElement('h3', { key: 't', className: 'wyy-h3' }, t('catTitle')),
            React.createElement(SecNote, { key: 's' }, cats === null ? null : tf('totalItems', {
              n: Object.keys(groups).reduce((acc, g) => acc + groups[g].length, 0),
            })),
          ]),
          cats === null
            ? React.createElement(StateLine, { key: 'l' }, t('loading'))
            : React.createElement('div', { key: 'g', className: 'wyy-cats' },
              Object.keys(groups).map((g) => React.createElement('div', { key: g, className: 'wyy-cat-group', 'data-raw': '1' }, [
                React.createElement('span', { key: 'l', className: 'wyy-cat-label' }, g),
                React.createElement('div', { key: 'c', className: 'wyy-chips' },
                  groups[g].map((c) => React.createElement('button', {
                    key: c.id, className: 'wyy-chip', onClick: () => onOpenCategory(c.name),
                  }, c.name))),
              ])))
        ]),
      ])
    }

    function ToplistView({ onOpenPlaylist, onOpenQueue }) {
      const [groups, setGroups] = useState(null)
      const [songs, setSongs] = useState(null)
      const [total, setTotal] = useState(0)
      const [err, setErr] = useState('')
      const s = usePlayer()
      const playPlaylist = usePlayPlaylist()
      useEffect(() => {
        let cancelled = false
        api('/toplists').then((r) => {
          if (cancelled) return
          setGroups(r.groups)
          const list = (r.groups[0] && r.groups[0].toplists) || []
          if (list.length === 0) { setSongs([]); return }
          // 只给"本期主推"这一张榜拉一次完整列表（30 首）；卡片墙里的榜点进去才拉。
          // 旧写法是每张卡片各拉 5 首预览 —— 一次进榜页 30+ 次上游请求，风控眼里就是刷子。
          api('/toplist/songs?id=' + encodeURIComponent(list[0].id) + '&num=30').then((r2) => {
            if (cancelled) return
            setSongs(r2.songs || []); setTotal(Number(r2.total) || (r2.songs || []).length)
          }).catch(() => { if (!cancelled) setSongs([]) })
        }).catch((e) => { if (!cancelled) setErr(e.message) })
        return () => { cancelled = true }
      }, [])
      if (err !== '') return React.createElement(StateLine, null, err)
      if (groups === null) return React.createElement(StateLine, null, t('loading'))
      const first = groups[0] && groups[0].toplists && groups[0].toplists.length ? groups[0].toplists[0] : null
      const heroPlaying = first !== null && s.source !== null && s.source !== undefined
        && s.source.id === first.id && s.playing
      const all = groups.reduce((acc, g) => acc.concat(g.toplists || []), [])
      const others = all.filter((tl) => !(first !== null && tl.id === first.id))
      const activeId = s.idx >= 0 && s.idx < s.queue.length ? s.queue[s.idx].id : ''
      return React.createElement('div', { className: 'wyy-view' }, [
        first === null ? null : React.createElement(ArtBand, {
          key: 'band',
          cover: first.cover,
          eyebrow: t('kickerRank'),
          title: first.name,
          sub: t('rankSub'),
          meta: [t('official'), songs !== null && total > 0 ? tf('tracks', { n: total }) : ''],
          actions: [
            React.createElement('button', {
              key: 'p', className: 'wyy-round-btn big',
              title: heroPlaying ? t('pause') : tf('playName', { x: first.name }),
              'aria-label': heroPlaying ? t('pause') : tf('playName', { x: first.name }),
              disabled: songs === null || songs.length === 0,
              onClick: () => playPlaylist({ id: first.id, name: first.name, cover: first.cover }, 'toplist'),
            }, heroPlaying ? React.createElement(IconPause, { size: 20 }) : React.createElement(IconPlay, { size: 20 })),
            React.createElement('button', {
              key: 'q', className: 'wyy-icon-btn on-band', title: t('queue'), 'aria-label': t('queue'),
              onClick: onOpenQueue,
            }, React.createElement(IconQueue, null)),
          ],
        }),
        React.createElement('div', { key: 'list', className: 'wyy-section' },
          songs === null ? React.createElement(StateLine, { key: 'l' }, t('loading'))
            : React.createElement(SongList, {
              key: 's', songs, activeId, activePlaying: s.playing,
              onPlay: (list, i) => playFrom(list, i, { kind: 'toplist', id: first.id, name: first.name, cover: first.cover, playCount: first.playCount, creator: first.creator }),
              onPlayNext: (song) => playNext(song),
            })),
        React.createElement('div', { key: 'all', className: 'wyy-section' }, [
          React.createElement('div', { key: 'h', className: 'wyy-sec-head' }, [
            React.createElement('h3', { key: 't', className: 'wyy-h3' }, t('allCharts')),
          ]),
          React.createElement(PlaylistGrid, {
            key: 'g', items: others, onOpen: onOpenPlaylist, onPlayItem: playPlaylist,
            source: s.source, playing: s.playing,
          }),
        ]),
      ])
    }

    function PlaylistView({ pl, onBack, onNeedLogin, onOpenPlaylist }) {
      const [songs, setSongs] = useState(null)
      const [meta, setMeta] = useState(null)
      const [err, setErr] = useState('')
      const [simi, setSimi] = useState(null)
      // 排序只改"看到的顺序"：队列顺序仍由点哪一行决定，避免"排了序结果播放顺序也变了"的错觉
      const [sort, setSort] = useState('default')
      // 收藏态：null = 还不知道（匿名请求拿不到），true/false = 已收藏/未收藏
      const [sub, setSub] = useState(null)
      useEffect(() => {
        let cancelled = false
        setSongs(null); setErr(''); setSub(null); setSimi(null); setSort('default')
        api('/playlist?id=' + encodeURIComponent(pl.id)).then((r) => {
          if (cancelled) return
          const list = r.playlist.songs || []
          setSongs(list)
          setMeta(r.playlist)
          setSub(r.playlist.subscribed === true)
          // 相似歌单的种子是本歌单首曲（见 netease.js getSimiPlaylists 的实测注记）：
          // 必须等详情回来才知道首曲是谁，不能和上面的请求并发
          if (list.length === 0) { setSimi([]); return }
          api('/simiplaylist?songid=' + encodeURIComponent(list[0].id) + '&limit=6').then((r2) => {
            if (!cancelled) setSimi(r2.playlists || [])
          }).catch(() => { if (!cancelled) setSimi([]) })
        }).catch((e) => { if (!cancelled) setErr(e.message) })
        return () => { cancelled = true }
      }, [pl.id])

      const s = usePlayer()
      const activeId = s.idx >= 0 && s.idx < s.queue.length ? s.queue[s.idx].id : ''
      const playPlaylist = usePlayPlaylist()
      const cover = (meta && meta.cover) || pl.cover
      const isSource = s.source !== null && s.source !== undefined && s.source.id === pl.id
      const name = (meta && meta.name) || pl.name || t('playlist')
      const collect = useCollect(pl.id, sub === true, onNeedLogin)
      const SORTS = ['default', 'dur', 'title']
      const sortLabel = { default: t('sortDefault'), dur: t('sortDur'), title: t('sortName') }[sort]
      const shown = songs === null || sort === 'default' ? songs : songs.slice().sort((a, b) => (
        sort === 'dur' ? (a.interval || 0) - (b.interval || 0)
          : String(a.title || '').localeCompare(String(b.title || ''), 'zh')
      ))

      return React.createElement('div', { className: 'wyy-view' }, [
        React.createElement(ArtBand, {
          key: 'band',
          cover: cover,
          eyebrow: t('kickerPl'),
          title: name,
          // 原型把简介放进色带副标题（三行截断），单独一条灰块会把色带的收尾切断
          sub: (meta && meta.description) || pl.description || '',
          // 元信息顺序照原型：首数 · 播放量 · 作者。作者原本排第一，把前两位顶掉了，
          // 于是「共 N 首」这类一眼要看的量级信息反而落在最后。
          meta: [meta ? tf('tracks', { n: meta.trackCount }) : '',
            meta && meta.playCount ? tf('playsBare', { n: fmtCount(meta.playCount) }) : '',
            meta && meta.creator ? meta.creator : ''],
          actions: [
            React.createElement('button', {
              key: 'p', className: 'wyy-round-btn big',
              title: isSource && s.playing ? t('pause') : t('playAll'),
              'aria-label': isSource && s.playing ? t('pause') : t('playAll'),
              disabled: songs === null || songs.length === 0,
              onClick: () => {
                if (isSource && s.idx >= 0) togglePlay()
                else playFrom(songs, 0, { kind: 'playlist', id: pl.id, name, playCount: meta && meta.playCount, creator: meta && meta.creator })
              },
            }, isSource && s.playing ? React.createElement(IconPause, { size: 20 }) : React.createElement(IconPlay, { size: 20 })),
            React.createElement('button', {
              key: 'sh', className: 'wyy-icon-btn on-band' + (s.shuffle ? ' on' : ''), title: t('shuffle'),
              'aria-label': t('shuffle'),
              onClick: () => player.set({ shuffle: !s.shuffle }),
            }, React.createElement(IconShuffle, null)),
            React.createElement('button', {
              key: 'c', className: 'wyy-icon-btn on-band', disabled: sub === null || collect.busy,
              title: collect.sub ? t('collected') : (collect.busy ? t('collecting') : t('collect')),
              'aria-label': collect.sub ? t('collected') : (collect.busy ? t('collecting') : t('collect')),
              'aria-pressed': collect.sub,
              onClick: collect.toggle,
            // 收藏态用"实心/空心"两个形状表示，不用颜色：色带上保证对比度的是 --art-on，
            // 把 --wyy-brand 压上来在深色封面上会掉到 3:1 以下
            }, collect.sub ? React.createElement(IconHeartFill, null) : React.createElement(IconHeart, null)),
            React.createElement('button', { key: 'b', className: 'wyy-btn ghost on-band', onClick: onBack }, t('back')),
          ],
        }),
        err !== '' ? React.createElement(StateLine, { key: 'e' }, err)
          : songs === null ? React.createElement(StateLine, { key: 'l' }, t('loading'))
            : React.createElement('div', { key: 'sec', className: 'wyy-section' }, [
              React.createElement('div', { key: 'h', className: 'wyy-sec-head' }, [
                React.createElement('h3', { key: 't', className: 'wyy-h3' }, t('tracksHead')),
                React.createElement(SecNote, {
                  key: 's', onClick: () => setSort(SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length]),
                }, tf('sortBy', { x: sortLabel })),
              ]),
              React.createElement(SongList, {
                key: 's', songs: shown, activeId, activePlaying: s.playing,
                onPlay: (list, i) => playFrom(list, i, { kind: 'playlist', id: pl.id, name, playCount: meta && meta.playCount, creator: meta && meta.creator }),
                onPlayNext: (song) => playNext(song),
              }),
            ]),
        // 相似歌单：原型歌单详情页的第二段。此前实物没有（拉不到 /simi/playlist），
        // 于是详情页到底就完了 —— 原型给的"从这张歌单继续走"的出口断在半路。
        simi === null || simi.length === 0 ? null : React.createElement('div', { key: 'simi', className: 'wyy-section' }, [
          React.createElement('div', { key: 'h', className: 'wyy-sec-head' }, [
            React.createElement('h3', { key: 't', className: 'wyy-h3' }, t('simiTitle')),
          ]),
          React.createElement(PlaylistGrid, {
            key: 'g', items: simi, onOpen: onOpenPlaylist, onPlayItem: playPlaylist,
            source: s.source, playing: s.playing,
          }),
        ]),
      ])
    }

    function CategoryView({ name, onOpenPlaylist, onBack }) {
      const [items, setItems] = useState(null)
      const [page, setPage] = useState(1)
      const [more, setMore] = useState(false)
      const [err, setErr] = useState('')
      const s = usePlayer()
      const playPlaylist = usePlayPlaylist()

      useEffect(() => { setItems(null); setPage(1); setErr('') }, [name])

      useEffect(() => {
        let cancelled = false
        api('/category/playlists?cat=' + encodeURIComponent(name) + '&limit=30&page=' + page).then((r) => {
          if (cancelled) return
          setItems((prev) => (page === 1 ? r.playlists : (prev || []).concat(r.playlists)))
          setMore((r.playlists || []).length >= 30)
        }).catch((e) => { if (!cancelled) setErr(e.message) }).finally(() => { if (!cancelled) setMore(false) })
        return () => { cancelled = true }
      }, [name, page])

      return React.createElement('div', { className: 'wyy-view' }, [
        React.createElement('div', { key: 'h', className: 'wyy-view-head' }, [
          React.createElement('h3', { key: 't', className: 'wyy-h3' }, name),
          React.createElement('button', { key: 'b', className: 'wyy-btn ghost small', onClick: onBack }, t('back')),
        ]),
        err !== '' ? React.createElement(StateLine, { key: 'e' }, err)
          : items === null ? React.createElement(StateLine, { key: 'l' }, t('loading'))
            : React.createElement(PlaylistGrid, {
              key: 'g', items, onOpen: onOpenPlaylist, onPlayItem: playPlaylist,
              source: s.source, playing: s.playing,
            }),
        items !== null
          ? React.createElement('div', { key: 'm', className: 'wyy-more' },
            React.createElement('button', { className: 'wyy-btn ghost', disabled: more, onClick: () => setPage((p) => p + 1) }, more ? t('loading') : t('loadMore')))
          : null,
      ])
    }

    function MineView({ status, onNeedLogin, onOpenPlaylist }) {
      const [items, setItems] = useState(null)
      const [err, setErr] = useState('')
      const [ownSort, setOwnSort] = useState('default')
      const s = usePlayer()
      const playPlaylist = usePlayPlaylist()

      useEffect(() => {
        if (!status.loggedIn) { setItems([]); return undefined }
        let cancelled = false
        setErr('')
        api('/myplaylists').then((r) => { if (!cancelled) setItems(r.playlists) })
          .catch((e) => { if (!cancelled) setErr(e.message) })
        return () => { cancelled = true }
      }, [status.loggedIn, status.userId])

      if (!status.loggedIn) {
        // 未登录也走色带骨架（灰底占位 + 唯一一个红色主按钮），而不是一页空白加一行小字：
        // 账号页的第一屏是"我的音乐"这块招牌，登录只是它上面唯一可点的东西。
        return React.createElement('div', { className: 'wyy-view' }, [
          React.createElement(ArtBand, {
            key: 'band',
            cover: '',
            eyebrow: t('kickerAccount'),
            title: t('mineTitle'),
            sub: t('mineSub'),
            meta: [t('notLoggedIn')],
            actions: [
              React.createElement('button', {
                key: 'l', className: 'wyy-btn on-band', onClick: onNeedLogin,
              }, t('loginBtn')),
            ],
          }),
          React.createElement(StateLine, { key: 'e' }, t('loginToSee')),
        ])
      }
      if (err !== '') return React.createElement(StateLine, null, err)
      if (items === null) return React.createElement(StateLine, null, t('loading'))
      // 色带取第一个歌单的封面：个人库也要有一块"属于我"的颜色，而不是一列同色灰卡。
      const first = items.length > 0 ? items[0] : null
      // 原型把我的页拆成"创建的歌单 / 订阅的歌单"两段 —— 网易云自己的账号页也是这么分的，
      // 一个 500 首的订阅歌单和一个 3 首的自建歌单混在一格里，找东西得靠滚。
      const created = items.filter((p) => p.kind === 'default' || p.kind === 'own')
      const collected = items.filter((p) => p.kind === 'collect')
      return React.createElement('div', { className: 'wyy-view' }, [
        React.createElement(ArtBand, {
          key: 'band',
          cover: first === null ? '' : first.cover,
          eyebrow: t('kickerAccount'),
          title: t('mineTitle'),
          sub: t('mineSub'),
          // 元信息照原型就两条（歌单数 · 账号）：VIP 是同一件事的补充说明，并进账号那条，
          // 不单独占一格把原型的 2 格撑成 3 格
          meta: [tf('plCount', { n: items.length }), (status.nickname || '') + (status.vipType > 0 ? ' · VIP' : '')],
          actions: first === null ? [] : [
            React.createElement('button', {
              key: 'p', className: 'wyy-round-btn big',
              title: tf('playName', { x: first.name }), 'aria-label': tf('playName', { x: first.name }),
              onClick: () => playPlaylist(first, 'playlist'),
            }, React.createElement(IconPlay, { size: 20 })),
          ],
        }),
        React.createElement('div', { key: 'own', className: 'wyy-section' }, [
          React.createElement('div', { key: 'h', className: 'wyy-sec-head' }, [
            React.createElement('h3', { key: 't', className: 'wyy-h3' }, t('mineCreated')),
            React.createElement(SecNote, {
              key: 's', onClick: () => setOwnSort((v) => (v === 'default' ? 'name' : 'default')),
            }, tf('sortBy', { x: ownSort === 'default' ? t('sortDefault') : t('sortName') })),
          ]),
          React.createElement(PlaylistGrid, {
            key: 'g', items: ownSort === 'default' ? created : created.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh')),
            onOpen: onOpenPlaylist, onPlayItem: playPlaylist,
            source: s.source, playing: s.playing, empty: t('noPl'),
          }),
        ]),
        React.createElement('div', { key: 'sub', className: 'wyy-section' }, [
          React.createElement('div', { key: 'h', className: 'wyy-sec-head' }, [
            React.createElement('h3', { key: 't', className: 'wyy-h3' }, t('mineSubscribed')),
            React.createElement(SecNote, { key: 's' }, tf('totalItems', { n: collected.length })),
          ]),
          React.createElement(PlaylistGrid, {
            key: 'g', items: collected, onOpen: onOpenPlaylist, onPlayItem: playPlaylist,
            source: s.source, playing: s.playing, empty: t('noPl'),
          }),
        ]),
      ])
    }

    function SearchView({ q, onOpenPlaylist, onPick }) {
      const [type, setType] = useState('song')
      const [res, setRes] = useState(null)
      // 原型搜索页是「单曲 + 歌单」两块一起给：默认档（单曲）下再补一块歌单，
      // 只多一次上游请求，换来的是"一屏看完两类结果"，而不是逼用户先切 chip 再看。
      const [plRes, setPlRes] = useState(null)
      const [err, setErr] = useState('')
      const [page, setPage] = useState(1)
      const s = usePlayer()
      const playPlaylist = usePlayPlaylist()

      useEffect(() => { setRes(null); setPlRes(null); setPage(1); setErr('') }, [q, type])

      useEffect(() => {
        if (q === '') { setRes({ results: [], total: 0 }); return undefined }
        let cancelled = false
        api('/search?q=' + encodeURIComponent(q) + '&type=' + type + '&page=' + page).then((r) => {
          if (cancelled) return
          setRes((prev) => (page === 1 || prev === null ? r : { results: prev.results.concat(r.results), total: r.total }))
        }).catch((e) => { if (!cancelled) setErr(e.message) })
        return () => { cancelled = true }
      }, [q, type, page])

      useEffect(() => {
        if (q === '' || type !== 'song') { setPlRes(null); return undefined }
        let cancelled = false
        api('/search?q=' + encodeURIComponent(q) + '&type=playlist&page=1').then((r) => {
          if (!cancelled) setPlRes(r)
        }).catch(() => { if (!cancelled) setPlRes({ results: [], total: 0 }) })
        return () => { cancelled = true }
      }, [q, type])

      const activeId = s.idx >= 0 && s.idx < s.queue.length ? s.queue[s.idx].id : ''
      // 关键词行照原型给的 6 个高频词（这是数据不是文案，不进 i18n 表）
      const HOT = ['晚安', 'Lo-Fi', '通勤', '民谣', '钢琴', '现场']
      // 类型行照原型：原型排了 9 枚（单曲/歌单/歌手/专辑/排行榜/歌单关键词/MV/歌词/用户）。
      // 其中"排行榜/歌单关键词/用户"不是搜索型（上游没有对应编号：实测 type=1002 空；
      // 而它们的语义在插件里各有真入口 —— 排行榜=左栏导航、歌单关键词=我的音乐页的分类 chip），
      // 所以不摆成搜索型。其余 6 枚逐一实测过有结果：1/1000/100/10 有数据（歌手/专辑此前
      // 因为抽取只取 songs 而恒空，已修），MV=1004 有 mvs，歌词=1006 按词句搜歌。
      const TYPES = [['song', 'typeSong'], ['playlist', 'playlist'], ['artist', 'typeArtist'], ['album', 'typeAlbum'], ['mv', 'typeMv'], ['lyric', 'typeLyric']]
      const typeHead = { song: 'typeSong', playlist: 'playlist', artist: 'typeArtist', album: 'typeAlbum', mv: 'typeMv', lyric: 'typeLyric' }[type]
      const total = res === null ? 0 : res.total
      // 歌词档上游返回的也是歌曲对象（按词句命中），照样走 SongList —— 交给 simpleRows
      // 会渲染成没有点播能力的假行。
      const isSongType = type === 'song' || type === 'lyric'
      const list = res === null || res.results.length === 0 ? null
        : isSongType
          ? React.createElement(SongList, {
            key: 's', songs: res.results, activeId, activePlaying: s.playing,
            onPlay: (lst, i) => playFrom(lst, i, { kind: 'search', id: q, name: t('searchPrefix') + q }),
            onPlayNext: (song) => playNext(song),
          })
          : type === 'playlist'
            ? React.createElement(PlaylistGrid, {
              key: 'g', items: res.results, onOpen: onOpenPlaylist, onPlayItem: playPlaylist,
              source: s.source, playing: s.playing,
            })
            : React.createElement('div', { key: 'o', className: 'wyy-simple' },
              res.results.map((x) => React.createElement('div', { key: x.id, className: 'wyy-simple-row', 'data-raw': '1' }, [
                React.createElement('span', { key: 'n', className: 'wyy-simple-name' }, x.title || x.name),
                // 歌手/专辑/MV 三档的副行由 netease.js 抽成 x.sub（别名串/歌手名/MV 歌手），
                // 歌曲档若混进来才回落到 artists/album。
                React.createElement('span', { key: 's', className: 'wyy-simple-sub' }, x.sub || (x.artists ? x.artists.join(' / ') : (x.album || ''))),
              ])))

      return React.createElement('div', { className: 'wyy-view' }, [
        React.createElement('div', { key: 'h', className: 'wyy-search-head' }, [
          React.createElement('h2', { key: 't', className: 'wyy-search-title' }, t('navSearch')),
        ]),
        React.createElement('div', { key: 't', className: 'wyy-chips' },
          TYPES.map(([k, typeKey]) => React.createElement('button', {
            key: k, className: 'wyy-chip' + (type === k ? ' on' : ''), onClick: () => setType(k),
            'aria-selected': type === k ? 'true' : 'false',
          }, t(typeKey)))),
        // 关键词行（原型第二行 chip）：点一下就把词填进搜索框，省得手打
        React.createElement('div', { key: 'kw', className: 'wyy-chips' },
          HOT.map((kw) => React.createElement('button', {
            key: kw, className: 'wyy-chip', onClick: () => onPick(kw),
          }, kw))),
        err !== '' ? React.createElement(StateLine, { key: 'e' }, err)
          : res === null ? React.createElement(StateLine, { key: 'l' }, t('searching'))
            : React.createElement('div', { key: 'sec', className: 'wyy-section' }, [
              React.createElement('div', { key: 'h', className: 'wyy-sec-head' }, [
                React.createElement('h3', { key: 't', className: 'wyy-h3' }, t(typeHead)),
                React.createElement(SecNote, { key: 's' }, total > 0
                  ? (isSongType ? tf('totalTracks', { n: total }) : tf('totalItems', { n: total })) : null),
              ]),
              list === null
                ? React.createElement(StateLine, { key: 'n' }, q === '' ? t('searchStart') : t('searchEmpty'))
                : list,
            ]),
        // 单曲档下补歌单块（原型就是这么排的）；已经切到歌单档时主区块本身就是歌单网格，不再重复
        type === 'song' && plRes !== null && plRes.results.length > 0
          ? React.createElement('div', { key: 'plsec', className: 'wyy-section' }, [
            React.createElement('div', { key: 'h', className: 'wyy-sec-head' }, [
              React.createElement('h3', { key: 't', className: 'wyy-h3' }, t('playlist')),
            ]),
            React.createElement(PlaylistGrid, {
              key: 'g', items: plRes.results.slice(0, 6), onOpen: onOpenPlaylist, onPlayItem: playPlaylist,
              source: s.source, playing: s.playing,
            }),
          ])
          : null,
        res !== null && res.results.length > 0 && res.results.length < res.total
          ? React.createElement('div', { key: 'm', className: 'wyy-more' },
            React.createElement('button', { className: 'wyy-btn ghost', onClick: () => setPage((p) => p + 1) }, t('loadMore')))
          : null,
      ])
    }

    // =================================================================
    // 播放条（Spotify 三区：曲目 / 控制 + 进度 / 右侧开关）
    // =================================================================

    function PlayerBar({ onOpenNowPlaying, npOpen, queueOpen, onToggleQueue }) {
      const s = usePlayer()
      const time = usePlayerTime()
      const song = s.idx >= 0 && s.idx < s.queue.length ? s.queue[s.idx] : null
      // 总长走 trackDur：元数据没到位时用列表里的 interval 兜底，进度条与点击窗口立刻可用
      const dur = trackDur(song, s)
      const pct = dur > 0 ? Math.min(100, (time / dur) * 100) : 0
      // 走 qualityLabel 而不是直取 take.quality：后者是宿主从网易云透传的中文（"无损"），
      // 直取等于把上游文案当成插件文案渲染 —— 英文档下它就是满屏中文里多出来的那一个。
      const quality = qualityLabel(s.take)

      return React.createElement('div', { className: 'wyy-bar' }, [
        // 左：曲目（点了就展开全屏 Now Playing，同 Spotify）
        React.createElement('div', { key: 'info', className: 'wyy-bar-info' }, [
          React.createElement('button', {
            key: 'c', className: 'wyy-bar-cover-btn', onClick: onOpenNowPlaying, title: t('npOpen'), 'aria-label': t('npOpen'),
          }, song && song.cover
            ? React.createElement('img', { key: 'i', className: 'wyy-bar-cover', src: song.cover, alt: '' })
            : React.createElement('span', { key: 'i', className: 'wyy-bar-cover ph' }, React.createElement(IconNote, { size: 18 }))),
          React.createElement('div', { key: 'm', className: 'wyy-bar-meta' }, [
            React.createElement('button', { key: 't', className: 'wyy-bar-title', 'data-raw': song ? '1' : undefined, title: song ? song.title : '', onClick: onOpenNowPlaying },
              song ? song.title : t('notPlaying')),
            React.createElement('div', { key: 's', className: 'wyy-bar-sub', 'data-raw': s.error === '' && song ? '1' : undefined },
              s.error !== '' ? s.error : (song ? artistLine(song) : t('barEmpty'))),
          ]),
          quality !== '' ? React.createElement('span', { key: 'q', className: 'wyy-badge q' }, quality) : null,
        ]),
        // 中：控制 + 进度
        React.createElement('div', { key: 'center', className: 'wyy-bar-center' }, [
          React.createElement('div', { key: 'ctrl', className: 'wyy-bar-ctrl' }, [
            React.createElement('button', {
              key: 'sh', className: 'wyy-icon-btn' + (s.shuffle ? ' on' : ''), title: t('shuffle'),
              onClick: () => player.set({ shuffle: !s.shuffle }),
            }, React.createElement(IconShuffle, null)),
            React.createElement('button', { key: 'pv', className: 'wyy-icon-btn', title: t('prev'), onClick: prevTrack }, React.createElement(IconPrev, null)),
            React.createElement('button', {
              key: 'pp', className: 'wyy-icon-btn play', title: s.playing ? t('pause') : t('play'),
              onClick: togglePlay, disabled: s.queue.length === 0,
            }, s.playing ? React.createElement(IconPause, { size: 17 }) : React.createElement(IconPlay, { size: 17 })),
            React.createElement('button', { key: 'nx', className: 'wyy-icon-btn', title: t('next'), onClick: () => nextTrack(false) }, React.createElement(IconNext, null)),
            React.createElement('button', {
              key: 'rp', className: 'wyy-icon-btn' + (s.repeat !== 'off' ? ' on' : ''), title: t('repeat'),
              onClick: () => player.set({ repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off' }),
            }, React.createElement(IconRepeat, null)),
            s.repeat === 'one' ? React.createElement('span', { key: 'r1', className: 'wyy-badge r1' }, '1') : null,
          ]),
          React.createElement('div', { key: 'prog', className: 'wyy-bar-prog' }, [
            React.createElement('span', { key: 't', className: 'wyy-time' }, fmtTime(time)),
            React.createElement('div', {
              key: 'tr', className: 'wyy-track', role: 'slider', tabIndex: 0,
              'aria-label': t('progress'), 'aria-valuenow': Math.round(pct),
              'aria-valuemin': 0, 'aria-valuemax': Math.round(dur),
              'aria-valuetext': fmtTime(time) + ' / ' + fmtTime(dur),
              ...scrubProps(() => dur, () => time, seekTo),
              onClick: (e) => {
                if (dur <= 0) return
                const box = e.currentTarget.getBoundingClientRect()
                const r = Math.max(0, Math.min(1, (e.clientX - box.left) / (box.width || 1)))
                seekTo(r * dur, r)
              },
            }, React.createElement('div', { className: 'wyy-track-fill', style: { width: pct + '%' } }, React.createElement('span', { className: 'wyy-track-knob' }))),
            React.createElement('span', { key: 'd', className: 'wyy-time' }, fmtTime(dur)),
          ]),
        ]),
        // 右：队列 + 音量 + 全屏（原型右簇的三个东西，全屏那个是带字按钮而不是图标）
        React.createElement('div', { key: 'right', className: 'wyy-bar-right' }, [
          React.createElement('button', {
            key: 'q', className: 'wyy-icon-btn' + (queueOpen ? ' on' : ''), title: t('queue'), 'aria-label': t('queue'),
            onClick: onToggleQueue,
          }, React.createElement(IconQueue, { size: 16 })),
          React.createElement('div', { key: 'v', className: 'wyy-vol-box' }, [
            React.createElement(IconVolume, { key: 'i', size: 15 }),
            React.createElement('input', {
              key: 'r', className: 'wyy-vol', type: 'range', min: 0, max: 1, step: 0.01,
              value: s.volume, 'aria-label': t('volume'),
              onChange: (e) => setVolume(Number(e.target.value)),
            }),
          ]),
          React.createElement('button', {
            key: 'f', className: 'wyy-btn ghost small' + (npOpen ? ' on' : ''), title: t('fullscreen'),
            'aria-label': t('fullscreen'), onClick: onOpenNowPlaying,
          }, t('fullscreen')),
        ]),
      ])
    }

    // =================================================================
    // 主面板
    // =================================================================

    const NAV = [
      { key: 'discover', label: 'navDiscover', icon: IconHome },
      { key: 'toplist', label: 'navToplist', icon: IconChart },
      { key: 'mine', label: 'navMine', icon: IconLibrary },
      { key: 'search', label: 'navSearch', icon: IconSearch },
    ]

    function WyyPage() {
      // 订阅播放器：切歌时才能把新曲目传给全屏歌词、并刷新列表里的高亮行
      const s = usePlayer()
      const [status, setStatus] = useState({ loggedIn: false, nickname: '', vipType: 0, musicfoxJar: false })
      const [loginOpen, setLoginOpen] = useState(false)
      const [view, setView] = useState({ kind: 'discover' })
      const [qInput, setQInput] = useState('')
      const [q, setQ] = useState('')
      const [nav, setNav] = useState('discover')
      const [npOpen, setNpOpen] = useState(false)
      const [npClosing, setNpClosing] = useState(false)
      const [queueOpen, setQueueOpen] = useState(false)
      const [ambOpen, setAmbOpen] = useState(false)
      const npTimer = useRef(0)
      // 舞台的开合原点：按播放条那张封面在**视口里的百分比**记下来，交给 .wyy-np 做 clip 圆心。
      // 每次开屏前现量 —— 侧栏收放/窗口改尺寸都会让那个位置变。
      const npOrigin = useRef({ x: 50, y: 104 })
      const openNp = useCallback(() => {
        const c = document.querySelector('.wyy-bar-cover')
        if (c !== null) {
          const r = c.getBoundingClientRect()
          if (r.width > 8) {
            npOrigin.current = {
              x: Math.round((r.left + r.width / 2) / Math.max(1, window.innerWidth) * 1000) / 10,
              y: Math.round((r.top + r.height / 2) / Math.max(1, window.innerHeight) * 1000) / 10,
            }
          }
        }
        if (npTimer.current !== 0) { window.clearTimeout(npTimer.current); npTimer.current = 0 }
        setNpClosing(false)
        setNpOpen(true)
      }, [])
      const closeNp = useCallback(() => {
        if (npTimer.current !== 0) return // 已经在收
        setNpOpen(false)
        setNpClosing(true)
        // 卸载要等封面飞完那一趟（--t-art = 1s），不是等地板淡完那 320ms：
        // 地板早就没了，封面还在路上，提前卸载等于让接续断在最后一帧。
        // 播放条那一侧不受影响 —— 它一直在，封面落上去正好重合。
        npTimer.current = window.setTimeout(() => {
          npTimer.current = 0
          setNpClosing(false)
        }, Math.round(tokenMs(document.body, '--t-art', 1000)) + 20)
      }, [])
      useEffect(() => () => window.clearTimeout(npTimer.current), [])

      // 语言是模块级 store，不走 props：文案散在十几个子组件里，逐层透传不如让根节点重画一次。
      const [, bumpLang] = useState(0)
      useEffect(() => {
        const off = ui.subscribe(() => bumpLang((v) => v + 1))
        ui.load()
        return off
      }, [])
      const toggleLang = () => ui.setLang(ui.lang === 'zh' ? 'en' : 'zh')

      const refreshStatus = useCallback(async () => {
        try { setStatus(await api('/status')) } catch { /* 宿主未就绪时保持默认 */ }
      }, [])
      useEffect(() => { refreshStatus() }, [refreshStatus])

      const openPlaylist = useCallback((p) => setView({ kind: 'playlist', pl: p }), [])
      const openCategory = useCallback((name) => { setNav('discover'); setView({ kind: 'category', name }) }, [])

      const curSong = s.idx >= 0 && s.idx < s.queue.length ? s.queue[s.idx] : null
      const curId = curSong === null ? '' : curSong.id

      // L3：整个面板的艺术色跟着当前播放的封面走（Spotify 的全局强调色就是这么来的）
      const art = useArt(curSong === null ? '' : curSong.cover)

      // 侧栏"我的歌单"列表：与 MineView 同源（/myplaylists），只取前 7 条
      const [library, setLibrary] = useState([])
      useEffect(() => {
        if (!status.loggedIn) { setLibrary([]); return undefined }
        let cancelled = false
        api('/myplaylists').then((r) => { if (!cancelled) setLibrary((r.playlists || []).slice(0, 7)) })
          .catch(() => { if (!cancelled) setLibrary([]) })
        return () => { cancelled = true }
      }, [status.loggedIn, status.userId])

      // 预取歌词：点开全屏时立刻有内容，而不是看"加载中"
      useEffect(() => { if (curId !== '') fetchLyric(curId).catch(() => {}) }, [curId])

      // 搜索防抖：输入 350ms 后才打上游，避免逐字请求触发风控
      useEffect(() => {
        const timer = setTimeout(() => { setQ(qInput.trim()); if (qInput.trim() !== '') { setNav('search'); setView({ kind: 'search' }) } }, 350)
        return () => clearTimeout(timer)
      }, [qInput])

      // 关键词 chip 走这条：填框 + 立刻搜（不必等 350ms 防抖）
      const pickQuery = useCallback((kw) => {
        setQInput(kw)
        setQ(kw)
        setNav('search')
        setView({ kind: 'search' })
      }, [])

      const goNav = (k) => {
        setNav(k)
        setQueueOpen(false)
        if (k === 'discover') setView({ kind: 'discover' })
        else if (k === 'toplist') setView({ kind: 'toplist' })
        else if (k === 'mine') setView({ kind: 'mine' })
        else if (k === 'search') setView({ kind: 'search' })
      }

      const body = (() => {
        if (view.kind === 'discover') return React.createElement(DiscoverView, { onOpenPlaylist: openPlaylist, onOpenCategory: openCategory, onNeedLogin: () => setLoginOpen(true) })
        if (view.kind === 'toplist') return React.createElement(ToplistView, { onOpenPlaylist: openPlaylist, onOpenQueue: () => setQueueOpen(true) })
        if (view.kind === 'mine') return React.createElement(MineView, { status, onNeedLogin: () => setLoginOpen(true), onOpenPlaylist: openPlaylist })
        if (view.kind === 'playlist') return React.createElement(PlaylistView, { pl: view.pl, onBack: () => goNav('discover'), onNeedLogin: () => setLoginOpen(true), onOpenPlaylist: openPlaylist })
        if (view.kind === 'category') return React.createElement(CategoryView, { name: view.name, onOpenPlaylist: openPlaylist, onBack: () => goNav('discover') })
        if (view.kind === 'search') return React.createElement(SearchView, { q, onOpenPlaylist: openPlaylist, onPick: pickQuery })
        return null
      })()

      return React.createElement('div', {
        className: 'wyy-page',
        'data-lang': ui.lang,
        style: art.style,
        'data-art': art.state,
        'data-art-diag': JSON.stringify(artDiag),
      }, [
        React.createElement('nav', { key: 'rail', className: 'wyy-rail' }, [
          React.createElement('div', { key: 'brand', className: 'wyy-brandline' }, [
            React.createElement('span', { key: 'd', className: 'dot' }, 'D'),
            // rail 宽 clamp(176px,17vw,232px)：减去 rail 与品牌行两级内边距后，留给"品牌名 + 三个控制钮"
            // 的只有 ~200px，而"DSH · 网易云音乐"整条 ≈130px —— 一起放会把**名字本身**截成"DSH · 网…"。
            // 所以只渲染名字（宿主前缀挪进 title 提示），名字再放不下时由容器查询整个退场。
            React.createElement('b', { key: 't', title: t('brand') },
              t('brand').indexOf(' · ') > 0 ? t('brand').slice(t('brand').indexOf(' · ') + 3) : t('brand')),
            // 品牌行右边的三连：上一首 / 停·播 / 下一首（用户点名要的"三个小按钮"）。
            // 播放条在面板里，但切到别的视图就看不见了 —— 这一排在 rail 顶上常驻。
            React.createElement('div', { key: 'ctl', className: 'wyy-brand-ctl' }, [
              React.createElement('button', {
                key: 'prev', type: 'button', className: 'wyy-brand-btn', title: t('prev'), 'aria-label': t('prev'),
                'data-brand-ctl': 'prev', disabled: s.queue.length === 0, onClick: prevTrack,
              }, React.createElement(IconPrev, { size: 15 })),
              React.createElement('button', {
                key: 'toggle', type: 'button', className: 'wyy-brand-btn', 'data-brand-ctl': 'toggle',
                title: s.playing ? t('pause') : t('play'), 'aria-label': s.playing ? t('pause') : t('play'),
                disabled: s.queue.length === 0, onClick: togglePlay,
              }, React.createElement(s.playing ? IconPause : IconPlay, { size: 15 })),
              React.createElement('button', {
                key: 'next', type: 'button', className: 'wyy-brand-btn', title: t('next'), 'aria-label': t('next'),
                'data-brand-ctl': 'next', disabled: s.queue.length === 0, onClick: () => nextTrack(false),
              }, React.createElement(IconNext, { size: 15 })),
            ]),
          ]),
          React.createElement('div', { key: 'nav', className: 'wyy-rail-nav' },
            NAV.map(({ key, label: navKey, icon: Ico }) => {
              const on = nav === key
              // NAV 是模块级 const，加载时只求值一次：文案必须在这里现取，否则切了语言侧栏不动
              const label = t(navKey)
              return React.createElement('button', {
                key, className: 'wyy-rail-item' + (on ? ' on' : ''), onClick: () => goNav(key), title: label,
                'aria-current': on ? 'true' : 'false',
              }, [
                React.createElement('span', { key: 'b', className: 'bar' }),
                React.createElement('span', { key: 'i', className: 'wyy-rail-icon' }, React.createElement(Ico, { size: 18 })),
                React.createElement('span', { key: 'l', className: 'wyy-rail-label' }, label),
              ])
            })),
          status.loggedIn && library.length > 0
            ? React.createElement('div', { key: 'lib', className: 'wyy-lib' }, [
              React.createElement('div', { key: 'e', className: 'wyy-lib-title' }, t('libTitle')),
              library.map((p) => React.createElement('button', {
                key: p.id, onClick: () => openPlaylist(p), title: p.name,
              }, [
                p.cover
                  ? React.createElement('img', { key: 'c', src: artSampleUrl(p.cover), alt: '' })
                  : React.createElement('span', { key: 'c', className: 'wyy-lib-ph' }, React.createElement(IconNote, { size: 16 })),
                React.createElement('span', { key: 't', className: 't', 'data-raw': '1' }, p.name),
              ])),
            ])
            : null,
          curSong !== null
            ? React.createElement('button', {
              key: 'np', className: 'wyy-rail-nowplaying', onClick: openNp, title: t('openNp'),
            }, [
              curSong.cover
                ? React.createElement('img', { key: 'c', className: 'wyy-rail-np-cover', src: curSong.cover, alt: '' })
                : React.createElement('span', { key: 'c', className: 'wyy-rail-np-cover ph' }, React.createElement(IconNote, { size: 14 })),
              React.createElement('span', { key: 'm', className: 'wyy-rail-np-meta' }, [
                React.createElement('span', { key: 't', className: 'wyy-rail-np-title' }, curSong.title),
                React.createElement('span', { key: 'a', className: 'wyy-rail-np-artist' }, artistLine(curSong)),
              ]),
              React.createElement(Equalizer, { key: 'e', playing: s.playing }),
            ])
            : null,
          // 氛围控制：左栏**下栏**（现在播放卡之下）。两个快捷开关 + 一个总设置入口，
          // 与上面的导航/歌单是两回事，所以单独一个分区，不混进 wyy-rail-nav
          React.createElement(RailAmbient, {
            key: 'amb', open: ambOpen, onOpenSettings: () => setAmbOpen((v) => !v),
          }),
        ]),
        React.createElement('div', { key: 'mid', className: 'wyy-mid' }, [
          React.createElement('div', { key: 'top', className: 'wyy-top' }, [
            React.createElement('div', { key: 'search', className: 'wyy-search' }, [
              React.createElement('span', { key: 'i', className: 'wyy-search-icon' }, React.createElement(IconSearch, null)),
              React.createElement('input', {
                key: 'in', className: 'wyy-search-input', value: qInput, placeholder: t('searchPh'),
                onChange: (e) => setQInput(e.target.value),
                onKeyDown: (e) => { if (e.key === 'Enter') setQ(qInput.trim()) },
              }),
              qInput !== '' ? React.createElement('button', {
                key: 'x', className: 'wyy-icon-btn small', 'aria-label': t('clear'),
                onClick: () => { setQInput(''); setQ(''); goNav('discover') },
              }, '✕') : null,
            ]),
            React.createElement('div', { key: 'user', className: 'wyy-user' }, [
              React.createElement('button', {
                key: 'g', className: 'wyy-lang' + (ui.lang === 'en' ? ' en' : ''),
                onClick: toggleLang, title: t('langTip'), 'aria-label': t('langTip'),
                'aria-pressed': ui.lang === 'en',
              }, ui.lang === 'zh' ? t('langNextEn') : t('langNextZh')),
              status.loggedIn
                ? [
                  React.createElement('span', { key: 'n', className: 'wyy-user-name', title: status.userId },
                    status.nickname + (status.vipType > 0 ? ' · VIP' : '')),
                  React.createElement('button', {
                    key: 'o', className: 'wyy-btn ghost small',
                    onClick: async () => { await api('/logout', { method: 'POST' }).catch(() => {}); refreshStatus(); setNav('discover'); setView({ kind: 'discover' }) },
                  }, t('logout')),
                ]
                : React.createElement('button', { key: 'l', className: 'wyy-btn small', onClick: () => setLoginOpen(true) }, t('login')),
            ]),
          ]),
          React.createElement('main', { key: 'main', className: 'wyy-content' }, body),
          React.createElement(PlayerBar, {
            key: 'bar', npOpen, queueOpen,
            onOpenNowPlaying: () => { if (npOpen) closeNp(); else openNp() },
            onToggleQueue: () => setQueueOpen((v) => !v),
          }),
        ]),
        // 全屏歌词与队列抽屉挂在 .wyy-page 下，而不是挂在 .wyy-mid 里。
        // 差别的实测：挂在 mid 时 NP 的 rect 从 x=512 起（左栏占到 512），"全屏"其实只是一块
        // 铺满右侧主体卡片的大面板，发现/排行榜/我的 那一条还露在外头 —— 用户看到的正是这个。
        // closing 这一档是为了"收得起"：直接 unmount 是一次硬切（画面凭空消失）。
        // 关的时候让封面先飞回播放条、地板同时淡掉，340ms 后才真卸 —— 开与关两个边界都"有东西活下来"。
        npOpen || npClosing ? React.createElement(NowPlaying, {
          key: 'np',
          song: curSong,
          playing: s.playing,
          closing: npClosing,
          origin: npOrigin.current,
          onClose: closeNp,
          onOpenQueue: () => setQueueOpen(true),
        }) : null,
        // 队列抽屉压在色带/全屏歌词之上：从全屏里点队列，抽屉要能盖住歌词列
        queueOpen ? React.createElement(QueuePanel, { key: 'queue', onClose: () => setQueueOpen(false) }) : null,
        loginOpen ? React.createElement(LoginDialog, {
          key: 'login',
          onClose: () => setLoginOpen(false),
          onChanged: () => { refreshStatus(); setNav('mine'); setView({ kind: 'mine' }) },
        }) : null,
        ambOpen ? React.createElement(AmbientSettings, { key: 'ambset', onClose: () => setAmbOpen(false) }) : null,
      ])
    }

    // =================================================================
    // CSS —— 浅色=网易云（白底 + 品牌红）；暗色=Spotify 色阶（钩子 body[data-ds-dark-theme]）
    // =================================================================

    const CSS = [
      // ---- L3 令牌注册：换歌时"渐变过去"，不是"瞬间跳色" ----
      // 未注册的自定义属性不参与插值：--art-band 从 #a9c6c9 变成 #d1a08a 是一帧到位的跳变
      // （§3.4 写了 320ms 换色，但那对普通自定义属性根本不生效）。注册成 <color> 之后它才是
      // 一个可插值的颜色，配合下面 .wyy-page 的 transition，色带/播放条/全屏底光随换曲连续渐变。
      // 注册的是**源令牌**（-l/-d，见 .wyy-page 的 transition 表）；活跃令牌是 var() 引用，
      // 本身不进过渡表 —— 于是"换曲滑行 1s"与"换主题同帧翻"同时成立。
      // 注册带来的副作用要留意：var() 的第二个兜底参数从此永不触发（属性总有值=initial-value），
      // 所以这里的 initial-value 一律取样式表里那一档兜底色，和样式表里写的保持一致。
      '@property --art-band-l{syntax:"<color>";inherits:true;initial-value:#f6d6d6}',
      '@property --art-band-d{syntax:"<color>";inherits:true;initial-value:#2a2a2e}',
      '@property --art-vivid-l{syntax:"<color>";inherits:true;initial-value:#f6d6d6}',
      '@property --art-vivid-d{syntax:"<color>";inherits:true;initial-value:#2a2a2e}',
      '@property --art-deep-l{syntax:"<color>";inherits:true;initial-value:#efe2e2}',
      '@property --art-deep-d{syntax:"<color>";inherits:true;initial-value:#17171a}',
      '@property --art-wash-l{syntax:"<color>";inherits:true;initial-value:#f7eaea}',
      '@property --art-wash-d{syntax:"<color>";inherits:true;initial-value:#201f26}',
      '@property --art-tint-l{syntax:"<color>";inherits:true;initial-value:#f7f4f4}',
      '@property --art-tint-d{syntax:"<color>";inherits:true;initial-value:#161618}',
      '@property --art-highlight-l{syntax:"<color>";inherits:true;initial-value:#d9a5a5}',
      '@property --art-highlight-d{syntax:"<color>";inherits:true;initial-value:#7f7f84}',
      '@property --art-on-l{syntax:"<color>";inherits:true;initial-value:#181818}',
      '@property --art-on-d{syntax:"<color>";inherits:true;initial-value:#f5f5f5}',
      '@property --art-tile-l{syntax:"<color>";inherits:true;initial-value:#efe2e2}',
      '@property --art-tile-d{syntax:"<color>";inherits:true;initial-value:#17171a}',
      '@property --art-on-tile-l{syntax:"<color>";inherits:true;initial-value:#181818}',
      '@property --art-on-tile-d{syntax:"<color>";inherits:true;initial-value:#f5f5f5}',
      '@property --np-floor-l{syntax:"<color>";inherits:true;initial-value:#241d20}',
      '@property --np-floor-d{syntax:"<color>";inherits:true;initial-value:#1a1416}',
      // 氛围层的 8 个取色源令牌也要注册：未注册的自定义属性不参与插值，换歌时对话背景的色
      // 就是**一帧硬切**（carry 腿会红）。注册成 <color> 后，下面 .wyy-amb 上那条 transition
      // 才能让背景跟着面板色带一起迁移。
      '@property --amb-c1-l{syntax:"<color>";inherits:true;initial-value:#c9a0a0}',
      '@property --amb-c1-d{syntax:"<color>";inherits:true;initial-value:#7a8aa0}',
      '@property --amb-c2-l{syntax:"<color>";inherits:true;initial-value:#e0c0a8}',
      '@property --amb-c2-d{syntax:"<color>";inherits:true;initial-value:#a08a7a}',
      '@property --amb-c3-l{syntax:"<color>";inherits:true;initial-value:#a8c8d8}',
      '@property --amb-c3-d{syntax:"<color>";inherits:true;initial-value:#7a96a8}',
      '@property --amb-c4-l{syntax:"<color>";inherits:true;initial-value:#d8c8c8}',
      '@property --amb-c4-d{syntax:"<color>";inherits:true;initial-value:#6a6a72}',
      // 地板底色（= 全屏歌词的 --np-floor）也注册：换歌时它和取色一起迁移
      '@property --amb-floor-l{syntax:"<color>";inherits:true;initial-value:#f4f2f6}',
      '@property --amb-floor-d{syntax:"<color>";inherits:true;initial-value:#1b1b1f}',
      '@property --art-band{syntax:"<color>";inherits:true;initial-value:#f6d6d6}',
      '@property --art-vivid{syntax:"<color>";inherits:true;initial-value:#f6d6d6}',
      '@property --art-deep{syntax:"<color>";inherits:true;initial-value:#efe2e2}',
      '@property --art-wash{syntax:"<color>";inherits:true;initial-value:#f7eaea}',
      '@property --art-tint{syntax:"<color>";inherits:true;initial-value:#f7f4f4}',
      '@property --art-highlight{syntax:"<color>";inherits:true;initial-value:#d9a5a5}',
      '@property --art-on{syntax:"<color>";inherits:true;initial-value:#181818}',
      '@property --np-wash-a{syntax:"<color>";inherits:true;initial-value:rgba(247,234,234,.62)}',
      '@property --np-wash-b{syntax:"<color>";inherits:true;initial-value:rgba(246,214,214,.3)}',
      '@property --np-floor{syntax:"<color>";inherits:true;initial-value:#241d20}',
      '@property --wyy-bar-bg{syntax:"<color>";inherits:true;initial-value:#f8f6f6}',
      // ---- L1 品牌 + L2 表面 · 浅色（网易云气质：白底 + 极浅灰阶分层，层级不靠阴影）----
      // L3 艺术色（--art-*）在取到封面像素前，兜底为品牌红的极淡染色，绝不留灰块。
      '.wyy-page{'
      // L1：品牌红只出现在交互控件与"正在播放"指示上。带白字的红钮用 brand-fill
      //（#ec4141+白=3.91:1，12–14px 文字不达 4.5:1；#d73535+白=4.68:1）。
      // brand-ink 是"红_when it is 字"的那一支：品牌红当正文色在白底只有 3.89:1，
      // 压在最坏 14% 艺术色罩层上只有 2.99:1，所以文字必须走加深版（#b32a2a：白底 6.40 / 最坏罩层 5.36）。
      + '--wyy-brand:#ec4141;--wyy-brand-hover:#d73535;--wyy-brand-fill:#d73535;--wyy-brand-fill-hover:#c02c2c;--wyy-brand-ink:#b32a2a;'
      + '--wyy-brand-soft:rgba(236,65,65,.08);--wyy-on-brand:#fff;'
      // L2：表面阶梯
      + '--wyy-bg:#ffffff;--wyy-bg-rail:#f6f6f7;--wyy-elev:#ffffff;'
      + '--wyy-surface-1:#f7f7f8;--wyy-surface-2:#efeff0;--wyy-surface-hover:#ebebec;--wyy-surface-press:#e2e2e4;'
      // fg-3 要能在"白底 / 最坏 art-tint 表面(#eaeaf6) / 最坏 14% 艺术罩层(#e0e0f4)"三种底上都过 4.5:1，
      // #86868e 只有 3.61/2.78/2.78 —— 这三档全不达标，所以整体压深一档。
      + '--wyy-fg:#181818;--wyy-fg-2:#5f5f66;--wyy-fg-3:#64646b;'
      + '--wyy-border:rgba(18,18,20,.08);--wyy-track:#dcdcdf;--wyy-track-hover:#c2c2c8;'
      // 歌词三级：大字 38px 只需 3:1，但"最暗的一档"也必须过 3。地板从纯白换成 9% 艺术色之后
      // #8d8d95 实测只剩 2.98（判据红），所以整档压深到 #82828a —— 最坏的地板上也留 3.1 以上。
      + '--wyy-ly-off:#6b6b72;--wyy-ly-past:#82828a;--wyy-ly-sub:#6b6b72;--wyy-ly-on:#181818;'
      + '--wyy-veil:rgba(255,255,255,.72);--wyy-veil-hover:rgba(255,255,255,.88);'
      + '--wyy-shadow:0 18px 40px -18px rgba(18,18,20,.34);--wyy-shadow-sm:0 2px 8px rgba(18,18,20,.14);'
      // L3 兜底 + 由 L3 派生的播放条 / 全屏底光
      // **两套调色盘**：取色层一次像素扫描就把浅/深两套都算出来，分别写到 --art-*-l / --art-*-d；
      // 这里只声明"没取到色"时的兜底，并把**活跃令牌**指向当前主题那一套。
      // 为什么不按主题各取一次色：宿主换主题时页面底色是**一帧到位**的，而按主题取色要等一次
      // 网络 + 解码（实测 0.4–1.1s）。那段时间里播放条/选中行会拿旧主题的 tint 去混新主题的底
      // （ink 腿实测掉到 4.13:1，判据红），色带也会在已经变黑/变白的页面上继续挂一秒旧色。
      // 两套都在手，换主题就只是级联里换一次引用 —— 零延迟、同帧、不经过任何 JS。
      + '--art-band-l:#f6d6d6;--art-vivid-l:#f6d6d6;--art-deep-l:#efe2e2;--art-wash-l:#f7eaea;'
      + '--art-tint-l:#f7f4f4;--art-highlight-l:#d9a5a5;--art-on-l:#181818;'
      + '--art-tile-l:#efe2e2;--art-on-tile-l:#181818;--np-floor-l:#241d20;'
      // 深色那一套的兜底也在这里声明（主题块只换引用）：两条规则各管一套会漏掉"没取到色"的那一支
      + '--art-band-d:#2a2a2e;--art-vivid-d:#2a2a2e;--art-deep-d:#17171a;--art-wash-d:#201f26;'
      + '--art-tint-d:#161618;--art-highlight-d:#7f7f84;--art-on-d:#f5f5f5;'
      + '--art-tile-d:#17171a;--art-on-tile-d:#f5f5f5;--np-floor-d:#1a1416;'
      // 播放条的艺术色占比 18%：绑定墨是 --wyy-fg-2。这一条不只看稳态 —— 切主题后到新调色盘
      // 落值之间若还要等网络，18% 的旧 tint 会把这条不透明的底拖出安全区（实测 4.13:1）。
      // 两套调色盘同时在场之后这个窗口没有了，18% 只是"看得见的艺术色 / 读得出的灰字"的取值。
      + '--wyy-bar-bg:color-mix(in oklab,var(--art-tint) 18%,var(--wyy-bg));'
      // 全屏歌词的地板：**自带**一块够暗的艺术色，不跟随主题的 L2。
      // 兜底值取的是"取色失败"那一档（暖灰偏暗），白字在上面仍有 15:1 以上。
      + '--np-ink:#f5f5f5;'
      // 底光的两道径向。方向必须和当前主题下的字色相反：浅色态的字是深灰，
      // 底光就往**亮**里混（wash 系，l .5–.78），深色态的字是白的，底光就压暗（vivid 系）。
      // 直接照搬原型那个"vivid 打左上"的写法，浅色态等于把深灰字往深色上放。
      // 它们是活跃令牌的派生物，跟着 --art-*-l/-d 的插值走，所以**不进**过渡表。
      + '--np-wash-a:color-mix(in oklab,var(--art-wash) 62%,transparent);'
      + '--np-wash-b:color-mix(in oklab,var(--art-band) 30%,transparent);'
      // 外壳是"通高左栏 + 浮起的主体卡片"：底必须是 rail 色，卡片自己刷 --wyy-bg，
      // 这样卡片左右两侧（栏右 8px 与窗口右缘）露出来的都是 rail 色。
      + 'box-sizing:border-box;position:relative;height:100%;display:flex;flex-direction:row;overflow:hidden;'
      // 换曲 = 换色：被插值的是**两套调色盘的源令牌**（-l / -d），活跃令牌是 var() 引用，
      // 每帧跟随，不单独插值。于是"换歌滑行 1s"和"换主题一帧到位"各自成立，互不干扰：
      // 换歌时 -l/-d 都在动（活跃那套在画面上滑行）；换主题时 -l/-d 一个都没动，
      // 只是活跃令牌换了引用 —— 没有过渡可跑，底和墨（--art-on*-l/-d 也不插值）同一帧翻。
      // 这条替代了早先那版"--art-on 押后 0.42×--t-art"：押哪个刻都躲不开"底在窗口里、墨还没翻"
      // 的那段（实测 3.29 / 3.89，窗口约 100ms；两支墨在底 Y≈0.18 处对比度相等，上限只有 4.17:1）。
      + 'transition:--art-band-l var(--t-art) var(--ease-art),--art-band-d var(--t-art) var(--ease-art),'
      + '--art-vivid-l var(--t-art) var(--ease-art),--art-vivid-d var(--t-art) var(--ease-art),'
      + '--art-deep-l var(--t-art) var(--ease-art),--art-deep-d var(--t-art) var(--ease-art),'
      + '--art-wash-l var(--t-art) var(--ease-art),--art-wash-d var(--t-art) var(--ease-art),'
      + '--art-tint-l var(--t-art) var(--ease-art),--art-tint-d var(--t-art) var(--ease-art),'
      + '--art-highlight-l var(--t-art) var(--ease-art),--art-highlight-d var(--t-art) var(--ease-art),'
      + '--art-tile-l var(--t-art) var(--ease-art),--art-tile-d var(--t-art) var(--ease-art),'
      + '--np-floor-l var(--t-art) var(--ease-art),--np-floor-d var(--t-art) var(--ease-art);'
      + 'background:var(--wyy-bg-rail);color:var(--wyy-fg)}',
      // ---- 活跃令牌 = "指向当前主题那一套"这一件事，单独成规则 ----
      // 凡是**自带** -l/-d 的元素（.wyy-page 自己、以及各自贴自己封面取色的 .wyy-band / .wyy-tile）
      // 都得就地换引用，否则色带/磁贴会继承页面的调色盘（那是"正在播放"那首歌的封面，不是它自己的）。
      '.wyy-page,.wyy-art{--art-band:var(--art-band-l);--art-vivid:var(--art-vivid-l);'
      + '--art-deep:var(--art-deep-l);--art-wash:var(--art-wash-l);--art-tint:var(--art-tint-l);'
      + '--art-highlight:var(--art-highlight-l);--art-on:var(--art-on-l);--art-tile:var(--art-tile-l);'
      + '--art-on-tile:var(--art-on-tile-l);--np-floor:var(--np-floor-l)}',
      'body[data-ds-dark-theme] .wyy-page,body[data-ds-dark-theme] .wyy-art{'
      + '--art-band:var(--art-band-d);--art-vivid:var(--art-vivid-d);--art-deep:var(--art-deep-d);'
      + '--art-wash:var(--art-wash-d);--art-tint:var(--art-tint-d);--art-highlight:var(--art-highlight-d);'
      + '--art-on:var(--art-on-d);--art-tile:var(--art-tile-d);--art-on-tile:var(--art-on-tile-d);'
      + '--np-floor:var(--np-floor-d)}',
      // ---- L2 表面 · 深色（Spotify Encore 实测灰阶）----
      // 钩子是宿主写入的 body[data-ds-dark-theme]；插件不自带主题开关。
      'body[data-ds-dark-theme] .wyy-page{'
      + '--wyy-brand:#ec4141;--wyy-brand-hover:#ff5a5a;--wyy-brand-ink:#ff6b6b;'
      + '--wyy-brand-soft:rgba(236,65,65,.16);'
      + '--wyy-bg:#121212;--wyy-bg-rail:#000000;--wyy-elev:#282828;'
      + '--wyy-surface-1:#181818;--wyy-surface-2:#1f1f1f;--wyy-surface-hover:#232323;--wyy-surface-press:#2a2a2a;'
      + '--wyy-fg:#f5f5f5;--wyy-fg-2:#b3b3b3;--wyy-fg-3:#8c8c90;'
      + '--wyy-border:rgba(255,255,255,.09);--wyy-track:#4d4d4d;--wyy-track-hover:#6a6a6a;'
      // 暗态最坏底是 14% 亮艺术色 over #121212（实测约 #241b1b），#ec4141 在上面只有 4.33:1，
      // 所以红字走提亮版 #ff6b6b（同底 6.07:1）。歌词灰阶同理：#5a5a5e 未唱行 2.73:1 不读。
      // ly-past 从 #62626a 提到 #63636b：地板换成不透明 #121212 后实测 2.93:1，差一点点读不出。
      + '--wyy-ly-off:#75757b;--wyy-ly-past:#63636b;--wyy-ly-sub:#86868d;--wyy-ly-on:#f5f5f5;'
      + '--wyy-veil:rgba(0,0,0,.54);--wyy-veil-hover:rgba(0,0,0,.68);'
      + '--wyy-shadow:0 18px 40px -18px rgba(0,0,0,.7);--wyy-shadow-sm:0 2px 8px rgba(0,0,0,.5);'
      // 深色主题只是**换引用**：活跃令牌指向 -d 那一套（见下面那条共用规则）。--art-*-d 的值由
      // 取色层一次写清，所以切换是级联里的引用替换（同帧、无网络），不是"再取一次色"。
      // 播放条占比同样 18%（绑定墨是 --wyy-fg-2 #b3b3b3）：稳态色差 ≈ 3/255，切主题也不再有窗口。
      + '--wyy-bar-bg:color-mix(in oklab,var(--art-deep) 18%,var(--wyy-bg));'
      + '--np-ink:#f5f5f5;'
      + '--np-wash-a:color-mix(in oklab,var(--art-vivid) 80%,transparent);'
      + '--np-wash-b:color-mix(in oklab,var(--art-wash) 70%,transparent)}',
      // ---- 排印系统（中文优先，不加载任何 web font）----
      '.wyy-page,.wyy-page *{font-family:"Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI","Microsoft YaHei",'
      + '"PingFang SC","Hiragino Sans GB","Noto Sans CJK SC","Source Han Sans SC",system-ui,-apple-system,sans-serif}',
      '.wyy-page{'
      // 字号/行高刻度：最小 12px（Windows 可读下限），正文行高 ≥1.5
      + '--fs-meta:12px;--lh-meta:16px;--fs-sm:13px;--lh-sm:20px;--fs-body:14px;--lh-body:22px;'
      + '--fs-sub:16px;--lh-sub:24px;--fs-card:17px;--lh-card:24px;--fs-sec:20px;--lh-sec:28px;'
      + '--fs-title:26px;--lh-title:34px;--fs-head:34px;--lh-head:42px;'
      + '--fs-hero:clamp(24px,3.2vw,34px);--fs-lyr:clamp(24px,3.4vw,38px);'
      // 中文一律不做负字距；只有全大写拉丁 eyebrow 用正字距
      + '--ls-eyebrow:.08em;'
      + '--s-1:4px;--s-2:8px;--s-3:12px;--s-4:16px;--s-5:20px;--s-6:24px;--s-8:32px;--s-10:40px;--s-12:48px;--s-16:64px;'
      + '--r-xs:4px;--r-sm:6px;--r-md:8px;--r-lg:12px;--r-pill:999px;'
      + '--t-fast:100ms;--t:200ms;--t-slow:320ms;--ease:cubic-bezier(.3,0,0,1);'
      // 缓动按**角色**分，不按手感随手挑。同一条柔和 S 曲线铺满全场的结果是每个动作都一个味
      // —— 快慢不同、味道相同，看着就"软件感"。分成三条：
      //   --ease-snap   easeOutExpo，t80≈.22：起步就吃掉大部分距离。**反馈**（悬停/按压/换色）用它，
      //                 手按下去到看见变化之间的延迟才是"跟手"的来源；
      //   --ease-spring back-out 回弹：**入场**用它（全屏、抽屉、弹窗），落点有一下收束；
      //   --ease        柔和 S：留给**位移/布局**这类不该抢戏的变化。
      // 三条曲线的 t80 相差 2 倍以上，节拍才立得住。
      + '--ease-snap:cubic-bezier(.19,1,.22,1);--ease-spring:cubic-bezier(.34,1.4,.5,1);'
      // 换曲的"染色"单独一档：320ms 是**状态反馈**的尺度，而整屏底色跟着跳会让人察觉是"换了"
      // 而不是"溶过去"。1s + 对称缓动才够柔，且和封面图层的交叉淡入同长（两边不同步会露馅）。
      // 也是全场唯一的"长镜头"：100ms 的反馈与 1s 的染色差 10×，节奏才有起伏。
      + '--t-art:1000ms;--ease-art:cubic-bezier(.4,0,.2,1);'
      // --ease-glide 是**长行程**专用的另一条：封面从播放条飞到全屏槽是 852px，属于"重物滑过去"。
      // 为什么不用 --ease / --ease-snap：实测峰值斜率分别 4.04 / 5.26，852px 配 320ms 就是
      // 687px/帧（41000px/s）—— 不是移动，是"跳一下再滑过去"。这条峰值 2.29、t80=.50（匀），
      // 1s 走完 852px 实测峰值 1950px/s，按 onetake 的口径（80px/帧 @30fps = 2400px/s）留了 19% 余量。
      + '--ease-glide:cubic-bezier(.25,.1,.25,1);'
      + '--row-h:44px;--bar-h:84px;'
      // 正文左右内边距单独成令牌：色带要"全出血"就得按同一个值取负外边距，
      // 两处各写一遍 clamp() 迟早对不上，那就会露出 2px 的白边。
      + '--wyy-pad-x:clamp(16px,2.4vw,32px);'
      + 'font-size:var(--fs-body);line-height:var(--lh-body);letter-spacing:0;'
      + '-webkit-font-smoothing:antialiased}',
      '.wyy-page *{box-sizing:border-box}',
      // :where() 把重置的选择器特异性压到 0，否则 `.wyy-page button`(0,1,1) 会盖掉
      // 后面所有 `.wyy-round-btn`(0,1,0) 之类的单类规则，彩色按钮全变透明。
      ':where(.wyy-page button){font:inherit;color:inherit;background:none;border:none;padding:0}',
      // ---- 顶栏（在主体卡片内，只放搜索与用户区；品牌已移到左栏）----
      '.wyy-top{flex:none;display:flex;align-items:center;gap:var(--s-4);height:calc(var(--dsh-frame-top-clearance,0px) + 64px);'
      + 'padding:var(--dsh-frame-top-clearance,0px) var(--wyy-pad-x) 0;background:var(--wyy-bg)}',
      // 搜索盒按原型定宽 320px：flex-basis 而不是 width，窄面板下还能收缩，不会把用户区挤出去
      '.wyy-search{flex:0 1 320px;max-width:320px;min-width:120px;display:flex;align-items:center;gap:var(--s-2);padding:0 var(--s-4);height:40px;border-radius:var(--r-pill);'
      + 'background:var(--wyy-surface-2);border:1px solid transparent;transition:background var(--t) var(--ease),border-color var(--t) var(--ease)}',
      '.wyy-search:hover{background:var(--wyy-surface-press)}',
      '.wyy-search:focus-within{outline:2px solid var(--wyy-brand);outline-offset:-2px}',
      '.wyy-search-icon{display:inline-flex;color:var(--wyy-fg-2)}',
      '.wyy-search-input{flex:1;min-width:0;border:none;background:transparent;outline:none;font-size:var(--fs-body);color:inherit}',
      '.wyy-search-input::placeholder{color:var(--wyy-fg-3)}',
      '.wyy-user{margin-left:auto;display:flex;align-items:center;gap:var(--s-2);flex:none}',
      '.wyy-user-name{font-size:var(--fs-meta);line-height:var(--lh-meta);color:var(--wyy-fg-2);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      // 语言档只改标题，控件本身要跟着变长（中文 2 字 → 英文 12 字符），所以给它一条最小宽度而不是挤按钮组。
      '.wyy-page[data-lang="en"] .wyy-lang{min-width:56px}',
      // 语言切换：L2 表面 + 描边，不带品牌红 —— 它是"设置类"控件，不该抢播放的注意力。
      '.wyy-lang{display:inline-flex;align-items:center;justify-content:center;flex:none;height:28px;min-width:42px;'
      + 'padding:0 10px;border-radius:var(--r-pill);border:1px solid var(--wyy-border);'
      + 'background:var(--wyy-surface-1);color:var(--wyy-fg-2);cursor:pointer;'
      + 'font-size:var(--fs-meta);font-weight:700;line-height:1;letter-spacing:.02em;'
      + 'transition:background var(--t-fast) var(--ease-snap),color var(--t-fast) var(--ease-snap),border-color var(--t-fast) var(--ease-snap)}',
      '.wyy-lang:hover{background:var(--wyy-surface-hover);color:var(--wyy-fg)}',
      '.wyy-lang.en{border-color:var(--wyy-brand-ink);color:var(--wyy-brand-ink)}',
      // ---- 侧栏（通高 rail，对齐原型 .wyy-rail）+ 主体卡片（对齐原型 .wyy-main）----
      // rail 通高、贴左边、靠 border-right 与主体分界；主体是圆角卡片浮在 rail 色底上。
      '.wyy-rail{flex:none;width:clamp(176px,17vw,232px);min-height:0;display:flex;flex-direction:column;gap:var(--s-2);'
      + 'padding:calc(var(--dsh-frame-top-clearance,0px) + var(--s-4)) var(--s-2) var(--s-3);'
      + 'background:var(--wyy-bg-rail);border-right:1px solid var(--wyy-border);overflow:hidden}',
      '.wyy-mid{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;background:var(--wyy-bg);'
      // 容器查询的锚点：面板宽度是被宿主拖出来的，跟视口宽度不是一回事，
      // 所以窄面板的降级规则只能挂在 .wyy-mid 的容器尺寸上（挂视口的 @media 永远不触发）。
      + 'container-type:inline-size;'
      + 'border-radius:var(--r-lg);margin:var(--s-2) var(--s-2) var(--s-2) 0;overflow:hidden;position:relative}',
      '.wyy-brandline{display:flex;align-items:center;gap:var(--s-2);padding:0 var(--s-2) var(--s-3);flex:none}',
      // 带白字的红底必须走 brand-fill：原型这里是 --wyy-brand，白字实测 3.89:1 不达 4.5
      '.wyy-brandline .dot{width:26px;height:26px;border-radius:var(--r-sm);background:var(--wyy-brand-fill);display:grid;place-items:center;'
      + 'color:var(--wyy-on-brand);font-weight:700;font-size:13px;line-height:1;flex:none}',
      // 英文标题比中文长两三倍：必须显式 min-width:0 才肯收缩，省略号才有地方出现
      '.wyy-brandline b{font-size:var(--fs-sub);font-weight:700;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      // 品牌行右侧的三连（上一首/停·播/下一首）：24px 方钮，跟 rail 里的图标钮同款语言
      '.wyy-brand-ctl{margin-left:auto;display:flex;align-items:center;gap:2px;flex:none}',
      // rail 最窄只有 176px（clamp(176px,17vw,232px)）：三段（品牌点 + 名字 + 三连）在窄档放不下，
      // 名字先让位（让它自己退场，而不是被截成"网易云…"）。名字只在 rail ≥ 200px 时才出现。
      '.wyy-rail{container-type:inline-size}',
      '@container (max-width: 199px){.wyy-brandline b{display:none}}',
      '.wyy-brand-btn{width:24px;height:24px;border-radius:var(--r-xs);display:grid;place-items:center;cursor:pointer;'
      + 'color:var(--wyy-fg-2);transition:background var(--t-fast) var(--ease-snap),color var(--t-fast) var(--ease-snap)}',
      '.wyy-brand-btn:hover:not(:disabled){background:var(--wyy-surface-2);color:var(--wyy-fg)}',
      '.wyy-brand-btn:disabled{opacity:.38;cursor:default}',
      '.wyy-rail-nav{display:flex;flex-direction:column;gap:2px;flex:none}',
      '.wyy-rail-item{display:flex;align-items:center;gap:var(--s-3);height:40px;padding:0 var(--s-3);border-radius:var(--r-sm);cursor:pointer;'
      + 'color:var(--wyy-fg-2);font-size:var(--fs-body);font-weight:500;transition:background var(--t-fast) var(--ease-snap),color var(--t-fast) var(--ease-snap);text-align:left}',
      '.wyy-rail-item:hover{color:var(--wyy-fg);background:var(--wyy-surface-2)}',
      '.wyy-rail-item.on{background:var(--wyy-surface-2);color:var(--wyy-fg);font-weight:700}',
      // 选中指示条：3px 红柱压在行首、负右外边距吃掉 gap，视觉上贴住行左缘（原型 .wyy-nav .bar）
      '.wyy-rail-item .bar{flex:none;width:3px;height:18px;border-radius:var(--r-pill);background:var(--wyy-brand);'
      + 'margin-right:-6px;opacity:0;transition:opacity var(--t-fast) var(--ease-snap)}',
      '.wyy-rail-item.on .bar{opacity:1}',
      '.wyy-rail-icon{display:inline-flex;flex:none}',
      '.wyy-rail-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      // 我的歌单：rail 的下半段，横向分割线 + 可滚列表；行高与原型一致（40px 封面 + 8px 上下内边距）
      '.wyy-lib{margin-top:var(--s-3);padding:var(--s-3) var(--s-3) 0;border-top:1px solid var(--wyy-border);'
      + 'display:flex;flex-direction:column;min-height:0;overflow:auto;scrollbar-width:thin}',
      '.wyy-lib-title{flex:none;font-size:var(--fs-meta);line-height:var(--lh-meta);font-weight:700;letter-spacing:var(--ls-eyebrow);'
      + 'text-transform:uppercase;color:var(--wyy-fg-3);padding:0 var(--s-2) var(--s-2)}',
      '.wyy-lib button{display:flex;align-items:center;gap:var(--s-3);padding:var(--s-2);border-radius:var(--r-xs);'
      + 'flex:none;cursor:pointer;text-align:left;min-width:0;color:var(--wyy-fg-2);font-size:var(--fs-sm);'
      + 'transition:background var(--t-fast) var(--ease-snap),color var(--t-fast) var(--ease-snap)}',
      '.wyy-lib button:hover{background:var(--wyy-surface-2);color:var(--wyy-fg)}',
      '.wyy-lib img{width:40px;height:40px;border-radius:var(--r-xs);object-fit:cover;flex:none}',
      '.wyy-lib-ph{width:40px;height:40px;border-radius:var(--r-xs);background:var(--wyy-surface-2);color:var(--wyy-fg-2);'
      + 'display:flex;align-items:center;justify-content:center;flex:none}',
      '.wyy-lib .t{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.wyy-rail-nowplaying{margin-top:auto;display:flex;align-items:center;gap:var(--s-2);padding:var(--s-2);border-radius:var(--r-sm);'
      + 'background:var(--wyy-surface-1);cursor:pointer;text-align:left;min-width:0;transition:background var(--t) var(--ease)}',
      '.wyy-rail-nowplaying:hover{background:var(--wyy-surface-hover)}',
      '.wyy-rail-np-cover{width:40px;height:40px;border-radius:var(--r-xs);object-fit:cover;flex:none}',
      '.wyy-rail-np-cover.ph{display:flex;align-items:center;justify-content:center;background:var(--wyy-surface-2);color:var(--wyy-fg-2)}',
      '.wyy-rail-np-meta{display:flex;flex-direction:column;min-width:0;flex:1}',
      '.wyy-rail-np-title{font-size:var(--fs-sm);line-height:var(--lh-sm);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.wyy-rail-np-artist{font-size:var(--fs-meta);line-height:var(--lh-meta);color:var(--wyy-fg-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.wyy-content{flex:1;min-width:0;overflow:auto;background:var(--wyy-bg);'
      + 'padding:var(--s-6) var(--wyy-pad-x) var(--s-8);scrollbar-width:thin}',
      // ---- 色带（L3 的核心形状）----
      // 全出血：按 --wyy-pad-x 取负外边距，把 .wyy-content 的内边距顶回去，色带成为面板的顶盖。
      // 渐变每一档都只和 --wyy-bg 混：混向页面底色只会让 --art-on 的对比度更高，
      // 绝不会像原型那样把 vivid 直接怼进渐变里（那会把 4.5:1 的保证作废）。
      '.wyy-band{position:relative;margin:calc(-1*var(--s-6)) calc(-1*var(--wyy-pad-x)) 0;'
      + 'padding:var(--s-8) var(--wyy-pad-x) var(--s-6);'
      + 'background:'
      + 'radial-gradient(126% 92% at 10% -34%,color-mix(in oklab,var(--art-band) 56%,var(--wyy-bg)) 0,transparent 62%),'
      + 'linear-gradient(180deg,var(--art-band) 0,color-mix(in oklab,var(--art-band) 68%,var(--wyy-bg)) 42%,'
      + 'color-mix(in oklab,var(--art-band) 26%,var(--wyy-bg)) 74%,var(--wyy-bg) 100%);'
      // 这条颜色永远看不见（下面那层 linear-gradient 全不透明），单独写它只为 DOM 侧的
      // "沿祖先链找不透明底"扫描仪：以前 background 简写把 background-color 打成 transparent，
      // 扫描仪只能越过色带走到 .wyy-page 的白底，把色带上的字按 19:1 报了个假绿。
      + 'background-color:var(--art-band);'
      + 'transition:background var(--t-slow) var(--ease)}',
      '.wyy-band::after{content:"";position:absolute;inset:0;pointer-events:none;'
      + 'background:linear-gradient(180deg,transparent 58%,var(--wyy-bg))}',
      '.wyy-band > *{position:relative;z-index:1}',
      '.wyy-band-head{display:flex;align-items:flex-end;gap:clamp(16px,2.2vw,32px);flex-wrap:wrap}',
      '.wyy-band-art{width:clamp(120px,13vw,168px);height:clamp(120px,13vw,168px);border-radius:var(--r-md);object-fit:cover;flex:none;'
      + 'box-shadow:0 20px 48px -14px color-mix(in oklab,var(--art-deep) 70%,transparent)}',
      '.wyy-band-art.ph{display:flex;align-items:center;justify-content:center;background:var(--wyy-surface-1);color:var(--wyy-fg-2)}',
      '.wyy-band-txt{flex:1;min-width:0;padding-bottom:var(--s-1)}',
      // 色带上的字全部走 --art-on，层级只靠字号/字重 —— 半透明版本实测会把保证作废。
      '.wyy-band-kicker{font-size:var(--fs-meta);line-height:var(--lh-meta);font-weight:700;'
      + 'letter-spacing:var(--ls-eyebrow);text-transform:uppercase;color:var(--art-on);margin-bottom:var(--s-2)}',
      '.wyy-band-title{margin:0;font-size:var(--fs-head);line-height:var(--lh-head);font-weight:800;letter-spacing:0;'
      + 'color:var(--art-on);text-wrap:balance;overflow-wrap:anywhere}',
      '.wyy-band-sub{margin-top:var(--s-3);font-size:var(--fs-sm);line-height:var(--lh-sm);color:var(--art-on);'
      + 'max-width:66ch;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}',
      '.wyy-band-meta{display:flex;align-items:center;gap:var(--s-3);margin-top:var(--s-3);'
      + 'font-size:var(--fs-sm);color:var(--art-on);flex-wrap:wrap}',
      '.wyy-band-meta .sep{width:3px;height:3px;border-radius:50%;background:currentColor;opacity:.6;flex:none}',
      '.wyy-band-tools{display:flex;align-items:center;gap:var(--s-5);margin-top:var(--s-2);flex-wrap:wrap}',
      // 色带主钮跟原型一致走品牌红（白字形 4.68:1）；art-on 那套留给色带上的图标与 ghost ——
      // 它们没有自己的底色，读的是底下任意一块艺术色，只能靠取色层给的 art-on 保证。
      // （原来 on-band 这个类名写在 JSX 里、CSS 里根本没有规则，图标就一直用页面灰 --wyy-fg-2。）
      '.wyy-icon-btn.on-band{color:var(--art-on)}',
      '.wyy-icon-btn.on-band:hover{background:color-mix(in oklab,var(--art-on) 14%,transparent);color:var(--art-on)}',
      '.wyy-btn.ghost.on-band{border-color:var(--art-on);color:var(--art-on)}',
      '.wyy-btn.ghost.on-band:hover{background:color-mix(in oklab,var(--art-on) 14%,transparent);'
      + 'border-color:var(--art-on);color:var(--art-on)}',
      // 快选磁贴：底色/字色成对来自同一张封面；hover 只做位移不做 filter ——
      // filter 会改掉实际渲染色，等于把取色层的达标判定绕过去。
      '.wyy-strip{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(148px,1fr);gap:var(--s-3);'
      + 'overflow-x:auto;padding-bottom:var(--s-2);scrollbar-width:thin}',
      '.wyy-tile{position:relative;height:96px;border-radius:var(--r-md);overflow:hidden;'
      + 'padding:var(--s-3);text-align:left;cursor:pointer;'
      // 取色失败时 --art-tile 谁都没设，退回 L2 中性面；两个色永远成对取，
      // 不会出现"底色是新的、字色是旧的"这种把对比度交出去的混搭。
      + 'background:var(--art-tile,var(--wyy-surface-1));color:var(--art-on-tile,var(--wyy-fg));'
      + 'transition:transform var(--t) var(--ease),box-shadow var(--t) var(--ease)}',
      '.wyy-tile:hover{transform:translateY(-2px);box-shadow:0 10px 24px -12px rgba(0,0,0,.5)}',
      // 字区与封面**互不相交**是硬不变量：封面是照片，像素颜色不由取色层决定，只要有一个字
      // 压在它上面，"--art-on-tile 对 --art-tile 的 4.5:1" 当场作废（实测 76% 字宽时两框重叠
      // 33px，第二行尾巴正好落在照片上）；守卫里有一条几何断言盯住这个不变量。
      '.wyy-tile-name{position:relative;z-index:1;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;'
      // 预留列宽实测取值（158px 磁贴、名字最长 18 字、两行 clamp、封面 rotate(22deg) 76px）：
      //   布局口径：名字盒右缘 87 < 封面布局左缘 94 → 7px 恒定净空（offsetLeft/offsetWidth，与 transform 无关）
      //   实体口径（分离轴判定，把旋转四角与被 clamp 掉的行盒都算进去）：6/6 磁贴零相交，最近净空 4.18px
      // 旧注释那句"墨迹留 2.05~2.07px 净空"是拿旋转后的**外接矩形**当边界的：外接矩形含旋转空角，
      // 既偏保守、又随实时数据漂移。约束的实质是"预留列必须真的空出来"，盒宽由 CSS 定死、不随字体漂移。
      + 'overflow:hidden;font-size:var(--fs-sub);line-height:var(--lh-sub);font-weight:700;max-width:56%}',
      '.wyy-tile-art{position:absolute;right:-12px;bottom:-10px;width:76px;height:76px;border-radius:var(--r-sm);'
      + 'transform:rotate(22deg);opacity:.9;box-shadow:0 8px 20px -8px rgba(0,0,0,.5)}',
      // ---- 音柱 ----
      '.wyy-eq{display:inline-flex;align-items:flex-end;gap:2px;height:12px;flex:none}',
      '.wyy-eq i{width:2px;height:30%;background:var(--wyy-brand);border-radius:1px}',
      '.wyy-eq.on i{animation:wyy-eq .9s var(--ease) infinite}',
      '.wyy-eq.on i:nth-child(2){animation-delay:.18s}',
      '.wyy-eq.on i:nth-child(3){animation-delay:.38s}',
      '@keyframes wyy-eq{0%,100%{height:30%}50%{height:100%}}',
      // ---- 歌曲行 ----
      '.wyy-view{display:flex;flex-direction:column;gap:var(--s-10)}',
      '.wyy-view-head{display:flex;align-items:center;gap:var(--s-3)}',
      '.wyy-sec-head{display:flex;align-items:baseline;justify-content:space-between;gap:var(--s-4)}',
      '.wyy-h3{margin:0;font-size:var(--fs-sec);line-height:var(--lh-sec);font-weight:700;letter-spacing:0}',
      // 区块头右槽：原型那里是 .wyy-sec-head a（fs-meta / 700 / .08em / fg-3）。实物放的是计数注解，
      // 排印重量照抄，但不下画"全部/更多/排序"这种没有 href 的死链接。
      '.wyy-h3-sub{font-size:var(--fs-meta);line-height:var(--lh-meta);font-weight:700;letter-spacing:var(--ls-eyebrow);color:var(--wyy-fg-3)}',
      // 右槽里是真控件时（排序）要抹掉 button 的 UA 壳，但保留原型那套字（无 href 的死链不抄）
      '.wyy-h3-sub.act{font-family:inherit;background:none;border:0;padding:0;cursor:pointer}',
      '.wyy-h3-sub.act:hover{color:var(--wyy-fg)}',
      '.wyy-section{display:flex;flex-direction:column;gap:var(--s-3)}',
      '.wyy-songs{display:flex;flex-direction:column;gap:2px}',
      // 原型是 5 轨栅格：序号 / （封面+标题+歌手）/ 专辑 / 时长 / 红心。插件没有红心列
      // （没有官方"喜欢"接口，画个按不动的红心比不画更差），那一轨改放「下一首播放」，
      // 宽度与形状照原型的 44px 走；窄容器下先牺牲专辑列。
      '.wyy-row{display:grid;grid-template-columns:32px minmax(0,3fr) minmax(0,2fr) 64px 44px;align-items:center;'
      + 'gap:var(--s-4);height:var(--row-h);padding:0 var(--s-3);border-radius:var(--r-xs);'
      + 'cursor:pointer;transition:background var(--t-fast) var(--ease-snap)}',
      '.wyy-row.compact{grid-template-columns:32px minmax(0,1fr) 64px 44px}',
      '.wyy-row:hover{background:var(--wyy-surface-2)}',
      // 正在播放行：底色只留 8% 的艺术 tint。原来写 70%，理由（"l 固定 .94 只吃掉 0.9 个等级"）
      // 只对**稳态**成立：切主题那 1 秒里页底原子跳到另一侧，70% 的旧 tint 还盖在上面，这一格变成
      // 一块中灰，红字掉到 1.2:1（ink 腿实测）—— 稳态的账没错，过渡期的账没算。
      // 8% 之后底由原子的页底说话，稳态色差 ≈ 5/255（浅色态 70% 与 8% 都是"近白 + 一丝色相"）。
      // 左侧 3px 红"播放头"是图形（3:1 就够），文字层级交给 brand-ink + 700 字重。
      '.wyy-row.active{background-color:color-mix(in oklab,var(--art-tint) 8%,transparent);'
      + 'background-image:linear-gradient(90deg,var(--wyy-brand),var(--wyy-brand));'
      + 'background-size:3px 56%;background-position:left center;background-repeat:no-repeat}',
      '.wyy-row.active .wyy-row-title{color:var(--wyy-brand-ink);font-weight:700}',
      '.wyy-row.active .wyy-row-idx{color:var(--wyy-brand)}',
      '.wyy-row.active .wyy-row-idx-num{opacity:0}',
      '.wyy-row-idx{flex:none;width:28px;text-align:right;font-size:var(--fs-sm);color:var(--wyy-fg-3);'
      + 'display:inline-flex;justify-content:flex-end;align-items:center;font-variant-numeric:tabular-nums}',
      '.wyy-row-idx-num{display:inline}',
      '.wyy-row-idx-play{display:none;color:var(--wyy-fg);align-items:center;justify-content:center}',
      '.wyy-row:hover .wyy-row-idx-num{display:none}',
      '.wyy-row:hover .wyy-row-idx-play{display:inline-flex}',
      '.wyy-row.active .wyy-row-idx-play{display:inline-flex}',
      // 封面与文字同处一格（原型的 .tt）：封面是扫列表的视觉锚点，但单独占一轨会把
      // "标题:专辑 = 3:2"的比例落空。无封面时用同尺寸占位，不让标题在行间左右跳。
      '.wyy-row-main{display:flex;align-items:center;gap:var(--s-3);min-width:0}',
      '.wyy-row-info{flex:1;min-width:0}',
      '.wyy-row-head{display:flex;align-items:center;gap:var(--s-2);min-width:0}',
      '.wyy-row-cover{flex:none;width:36px;height:36px;border-radius:var(--r-xs);object-fit:cover;display:block}',
      '.wyy-row-cover.ph{background:var(--wyy-surface-3);display:inline-flex;align-items:center;justify-content:center;'
      + 'color:var(--wyy-fg-3)}',
      // 专辑列：可压缩、必省略；窄容器下先让位给标题列。
      '.wyy-row-album{min-width:0;font-size:var(--fs-sm);line-height:var(--lh-sm);color:var(--wyy-fg-3);'
      + 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.wyy-row-end{display:flex;align-items:center;justify-content:flex-end;min-width:0}',
      // 行尾的「下一首播放」跟序号位的播放键同一套手法：悬停/键盘聚焦才浮出来
      '.wyy-row-next{opacity:0;color:var(--wyy-fg-2)}',
      '.wyy-row:hover .wyy-row-next,.wyy-row:focus-within .wyy-row-next,.wyy-row:focus .wyy-row-next{opacity:1}',
      '.wyy-row-title{flex:0 1 auto;min-width:0;font-size:var(--fs-body);line-height:var(--lh-body);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.wyy-row-sub{font-size:var(--fs-sm);line-height:var(--lh-sm);color:var(--wyy-fg-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.wyy-row-dur{font-size:var(--fs-sm);color:var(--wyy-fg-3);text-align:right;font-variant-numeric:tabular-nums;'
      + 'overflow:hidden;white-space:nowrap}',
      // ---- 徽标 / 按钮 ----
      '.wyy-badge{flex:none;font-size:var(--fs-meta);line-height:1.2;padding:2px 5px;border-radius:var(--r-xs);'
      + 'border:1px solid color-mix(in srgb,var(--wyy-brand) 55%,transparent);color:var(--wyy-brand-ink)}',
      '.wyy-badge.q{border-color:var(--wyy-border);color:var(--wyy-fg-2);text-transform:uppercase;letter-spacing:var(--ls-eyebrow)}',
      '.wyy-badge.r1{border-color:var(--wyy-brand);color:var(--wyy-brand-ink);padding:1px 4px}',
      // 带白字的红钮走 brand-fill（#d73535+白=4.68:1），纯图标钮走 brand（字形属图形，3:1 即可）
      '.wyy-btn{border-radius:var(--r-pill);padding:8px 20px;font-size:var(--fs-sm);line-height:var(--lh-sm);font-weight:700;'
      // 按钮里的字不许折行：播放条那个「全屏播放」在窄面板下被挤成两行，
      // 28px 的盒子里塞 40px 的文字，第二行直接画到按钮外面去（截图里一眼能看到）。
      + 'white-space:nowrap;'
      + 'cursor:pointer;background:var(--wyy-brand-fill);color:var(--wyy-on-brand);'
      + 'transition:transform var(--t-fast) var(--ease-snap),background var(--t-fast) var(--ease-snap)}',
      '.wyy-btn:hover{background:var(--wyy-brand-fill-hover);transform:scale(1.03)}',
      '.wyy-btn:active{transform:scale(.98)}',
      '.wyy-btn:disabled{opacity:.5;cursor:default;transform:none}',
      '.wyy-btn.small{padding:5px 14px;font-size:var(--fs-meta)}',
      // 原型的 ghost 是定高 36px 的胶囊（不是靠 padding 撑）：色带工具条上三个键的顶底对齐靠它
      '.wyy-btn.ghost{height:36px;padding:0 var(--s-4);font-weight:600;background:transparent;border:1px solid var(--wyy-border);color:var(--wyy-fg-2)}',
      '.wyy-btn.ghost.small{height:28px;padding:0 var(--s-3);font-weight:700}',
      '.wyy-btn.ghost:hover{background:var(--wyy-surface-2);border-color:transparent;color:var(--wyy-fg)}',
      // Spotify 的大圆形播放键
      '.wyy-round-btn{flex:none;width:48px;height:48px;border-radius:var(--r-pill);background:var(--wyy-brand-fill);color:var(--wyy-on-brand);'
      + 'display:inline-flex;align-items:center;justify-content:center;cursor:pointer;'
      + 'box-shadow:0 8px 22px -8px color-mix(in oklab,var(--wyy-brand-fill) 70%,transparent);'
      + 'transition:transform var(--t-fast) var(--ease-snap),background var(--t-fast) var(--ease-snap)}',
      '.wyy-round-btn:hover{background:var(--wyy-brand-fill-hover);transform:scale(1.04)}',
      '.wyy-round-btn:active{transform:scale(.97)}',
      '.wyy-round-btn:disabled{opacity:.5;cursor:default;transform:none}',
      '.wyy-round-btn.big{width:56px;height:56px}',
      // 尺寸对齐原型 .wyy-icon：36px 圆钮。之前是「16px 图标 + 4px 内边距 + 6px 圆角」的 24px 小方块，
      // 实测比原型的 36×999px 小一圈、且是方的 —— 色带工具行和播放条控制排一起就露馅。
      '.wyy-icon-btn{display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;cursor:pointer;'
      + 'width:36px;height:36px;padding:0;border-radius:var(--r-pill);flex:none;'
      + 'color:var(--wyy-fg-2);line-height:1;'
      + 'transition:color var(--t-fast) var(--ease-snap),background var(--t-fast) var(--ease-snap),transform var(--t-fast) var(--ease-snap)}',
      '.wyy-icon-btn:hover{color:var(--wyy-fg);background:var(--wyy-surface-2)}',
      // 按压必须**当场**看得见：hover 是"将要发生"，:active 才是"发生了"。0.94 一档、100ms 的
      // snap 曲线 —— 走同一帧就能看到，松开回弹也在 100ms 内收干净，不拖泥带水。
      '.wyy-icon-btn:active{transform:scale(.94)}',
      '.wyy-icon-btn.on{color:var(--wyy-brand);position:relative}',
      '.wyy-icon-btn.on::after{content:"";position:absolute;bottom:-1px;left:50%;transform:translateX(-50%);width:4px;height:4px;border-radius:50%;background:var(--wyy-brand)}',
      '.wyy-icon-btn:disabled{opacity:.4;cursor:default}',
      '.wyy-icon-btn.play{width:38px;height:38px;border-radius:var(--r-pill);background:var(--wyy-fg);color:var(--wyy-bg)}',
      '.wyy-icon-btn.play.big{width:56px;height:56px}',
      '.wyy-icon-btn.play:hover{background:var(--wyy-fg);color:var(--wyy-bg);transform:scale(1.06)}',
      '.wyy-icon-btn.play:disabled{transform:none;opacity:.4}',
      '.wyy-icon-btn.small{font-size:var(--fs-meta);width:28px;height:28px}',
      // ---- 卡片网格 ----
      '.wyy-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:var(--s-5)}',
      '.wyy-card{position:relative;cursor:pointer;min-width:0;'
      + 'padding:var(--s-4);border-radius:var(--r-md);background:var(--wyy-surface-1);transition:background var(--t) var(--ease)}',
      '.wyy-card:hover{background:var(--wyy-surface-hover)}',
      // 12%（原 16%）：和播放条/选中行同一类账 —— 卡面是浅底 + 灰字小字，
      // --art-vivid 占比一大就把 --wyy-fg-3 拖进读不出的中间灰。vivid 在换曲那 1 秒里是
      // 滑行的中间值，占比越高、经过的中间亮度就越久地压在灰字上。
      // 12% 在浅色态只是粉淡一点（#f4e4e8 → #f8ecef），深色态本来就几乎看不出。
      '.wyy-card.playing{background:color-mix(in oklab,var(--art-vivid) 12%,var(--wyy-surface-1))}',
      '.wyy-card-cover{position:relative;width:100%;aspect-ratio:1/1;margin-bottom:var(--s-3);border-radius:var(--r-sm);overflow:hidden;background:var(--wyy-surface-2)}',
      '.wyy-card-cover img{width:100%;height:100%;object-fit:cover;display:block;box-shadow:0 10px 26px -14px rgba(0,0,0,.45)}',
      '.wyy-card-ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--wyy-fg-2)}',
      // 浮在封面上的键：Spotify 用玻璃遮罩而不是品牌红，保证任何封面图上都看得清
      '.wyy-card-play{position:absolute;right:var(--s-2);bottom:var(--s-2);width:44px;height:44px;border-radius:var(--r-pill);'
      + 'background:var(--wyy-veil);color:var(--wyy-fg);display:flex;align-items:center;justify-content:center;'
      + 'box-shadow:0 8px 20px -8px rgba(0,0,0,.5);opacity:0;transform:translateY(6px);cursor:pointer;'
      + 'transition:opacity var(--t) var(--ease),transform var(--t) var(--ease),background var(--t-fast) var(--ease-snap)}',
      '.wyy-card:hover .wyy-card-play,.wyy-card:focus-within .wyy-card-play{opacity:1;transform:none}',
      '.wyy-card-play:hover{background:var(--wyy-veil-hover);transform:translateY(0) scale(1.06)}',
      '.wyy-card-name{font-size:var(--fs-card);line-height:var(--lh-card);font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.wyy-card.playing .wyy-card-name{color:var(--wyy-brand)}',
      '.wyy-card-sub{margin-top:var(--s-1);font-size:var(--fs-sm);line-height:var(--lh-sm);color:var(--wyy-fg-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      // ---- 分类 chips ----
      '.wyy-cats{display:flex;flex-direction:column;gap:var(--s-3)}',
      '.wyy-cat-group{display:flex;gap:var(--s-3);align-items:flex-start}',
      '.wyy-cat-label{flex:none;width:56px;font-size:var(--fs-meta);line-height:var(--lh-meta);color:var(--wyy-fg-3);padding-top:9px}',
      '.wyy-chips{display:flex;flex-wrap:wrap;gap:var(--s-2)}',
      '.wyy-chip{height:32px;padding:0 var(--s-4);border-radius:var(--r-pill);font-size:var(--fs-sm);'
      + 'font-weight:600;cursor:pointer;background:var(--wyy-surface-2);color:var(--wyy-fg-2);'
      + 'transition:background var(--t-fast) var(--ease-snap),color var(--t-fast) var(--ease-snap)}',
      '.wyy-chip:hover{background:var(--wyy-surface-press);color:var(--wyy-fg)}',
      '.wyy-chip.on{background:var(--wyy-brand);color:var(--wyy-on-brand)}',
      // ---- 状态 ----
      '.wyy-state{padding:var(--s-4) 2px;font-size:var(--fs-sm);line-height:var(--lh-sm);color:var(--wyy-fg-2)}',
      '.wyy-more{display:flex;justify-content:center;padding:var(--s-2) 0}',
      '.wyy-simple{display:flex;flex-direction:column;gap:2px}',
      '.wyy-simple-row{display:flex;gap:var(--s-4);height:var(--row-h);align-items:center;padding:0 var(--s-3);border-radius:var(--r-xs);transition:background var(--t-fast) var(--ease-snap)}',
      '.wyy-simple-row:hover{background:var(--wyy-surface-2)}',
      '.wyy-simple-name{flex:none;min-width:150px;font-size:var(--fs-body);line-height:var(--lh-body)}',
      '.wyy-simple-sub{font-size:var(--fs-sm);line-height:var(--lh-sm);color:var(--wyy-fg-2)}',
      // ---- 播放条（Spotify 三区）----
      // 播放条不再浮成一张小卡：它停在主体卡片底边、与正文以 1px 线分界（原型 .wyy-bar 也是贴底的）
      '.wyy-bar{flex:none;display:flex;align-items:center;gap:var(--s-6);padding:0 var(--s-4);'
      + 'border-top:1px solid var(--wyy-border);background:var(--wyy-bar-bg);min-height:var(--bar-h)}',
      '.wyy-bar-info{flex:1 1 0;display:flex;align-items:center;gap:var(--s-3);min-width:0;max-width:30%}',
      '.wyy-bar-cover-btn{flex:none;display:inline-flex;cursor:pointer;border-radius:var(--r-xs);overflow:hidden}',
      '.wyy-bar-cover{width:56px;height:56px;border-radius:var(--r-xs);object-fit:cover;display:block}',
      '.wyy-bar-cover.ph{display:flex;align-items:center;justify-content:center;background:var(--wyy-surface-2);color:var(--wyy-fg-2)}',
      '.wyy-bar-meta{min-width:0;flex:1;display:flex;flex-direction:column}',
      '.wyy-bar-title{text-align:left;font-size:var(--fs-body);line-height:var(--lh-body);font-weight:600;cursor:pointer;'
      + 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.wyy-bar-title:hover{text-decoration:underline}',
      '.wyy-bar-sub{font-size:var(--fs-sm);line-height:var(--lh-sm);color:var(--wyy-fg-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.wyy-bar-center{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;gap:var(--s-2);min-width:0;max-width:560px}',
      '.wyy-bar-ctrl{display:flex;align-items:center;gap:var(--s-5)}',
      '.wyy-bar-prog{width:100%;display:flex;align-items:center;gap:var(--s-3)}',
      '.wyy-time{flex:none;font-size:var(--fs-meta);line-height:var(--lh-meta);color:var(--wyy-fg-3);font-variant-numeric:tabular-nums;width:38px;text-align:center}',
      '.wyy-track{flex:1;height:4px;border-radius:var(--r-pill);background:var(--wyy-track);cursor:pointer;position:relative}',
      // 命中区撑到 22px 高（可见条仍是 4px —— 那是设计刻度的一档，不该为了好点改粗）。
      // 伪元素算宿主元素的命中范围，所以只加一层透明的 ::before 就能点中，不必改结构。
      '.wyy-track::before{content:"";position:absolute;left:-4px;right:-4px;top:-9px;bottom:-9px}',
      '.wyy-track:focus-visible{outline:2px solid var(--wyy-brand);outline-offset:6px;border-radius:var(--r-pill)}',
      '.wyy-track:hover{background:var(--wyy-track-hover)}',
      // 进度：静止时用文字色，悬停才亮品牌红——红色是稀缺信号，不常驻
      '.wyy-track-fill{position:absolute;left:0;top:0;bottom:0;border-radius:var(--r-pill);background:var(--wyy-fg);'
      + 'transition:background var(--t-fast) var(--ease-snap)}',
      '.wyy-track:hover .wyy-track-fill{background:var(--wyy-brand)}',
      '.wyy-track-knob{position:absolute;right:-6px;top:50%;width:12px;height:12px;margin-top:-6px;border-radius:50%;'
      + 'background:var(--wyy-fg);box-shadow:0 1px 4px rgba(0,0,0,.4);opacity:0;transition:opacity var(--t-fast)}',
      '.wyy-track:hover .wyy-track-knob{opacity:1}',
      '.wyy-bar-right{flex:1 1 0;display:flex;align-items:center;justify-content:flex-end;gap:var(--s-3);min-width:0}',
      '.wyy-vol-box{display:flex;align-items:center;gap:var(--s-2);color:var(--wyy-fg-2)}',
      '.wyy-vol{width:86px;accent-color:var(--wyy-brand);cursor:pointer}',
      // ---- 全屏 Now Playing（大屏歌词）----
      // 挂在 .wyy-page 下，但定位用 **fixed**：absolute 的覆盖面对象是插件面板自己，
      // 于是宿主左侧那条（deepseek / 新会话 / 网易云音乐 / 插件）还露在外头 —— 用户说的
      // "不是真全屏，还留着左边栏"指的就是它。插件 DOM 本来就在宿主文档里，fixed 之后
      // 覆盖对象变成视口，才真的盖得住。
      // z-index 60：低于登录弹窗（.wyy-modal-mask 1000），高于队列抽屉（改成 70 反过来，
      // 因为从全屏里点队列，抽屉必须浮在歌词上面）。
      '.wyy-np{position:fixed;inset:0;z-index:60;overflow:hidden;'
      // 这块面**自带**一套 on-dark 令牌，不再跟主题的 L2 走 —— 沉浸式的语义就是"离开应用表面"。
      // 关键是把 --wyy-bg 一起换掉：.wyy-icon-btn.play 是 background:--wyy-fg + color:--wyy-bg，
      // 只翻 fg 不翻 bg，浅色主题下主播放键就成了"白圆 + 白图标"，等于消失。
      + '--wyy-bg:var(--np-floor);--wyy-fg:var(--np-ink);--wyy-fg-2:rgba(245,245,245,.76);--wyy-fg-3:rgba(245,245,245,.60);'
      + '--wyy-ly-on:var(--np-ink);--wyy-ly-off:rgba(245,245,245,.64);--wyy-ly-past:rgba(245,245,245,.46);--wyy-ly-sub:rgba(245,245,245,.68);'
      + '--wyy-track:rgba(255,255,255,.24);--wyy-track-hover:rgba(255,255,255,.40);'
      + '--wyy-surface-1:rgba(255,255,255,.10);--wyy-surface-2:rgba(255,255,255,.18);--wyy-border:rgba(255,255,255,.18);'
      // 原型是两列栅格 minmax(340px,44%) 1fr，gap/padding 走 s-12 / s-16：
      // 左列占 44% 的可用宽度，封面就跟着列宽走（1600 视口下原型量到 528×528）。
      + 'display:grid;grid-template-columns:minmax(340px,44%) 1fr;gap:var(--s-12);'
      // 纵向也走 s-12（原型的 48px）；顶部再叠宿主的浮框让位（实测该值为 0 时上下都是 48）。
      + 'padding:calc(var(--dsh-frame-top-clearance,0px) + var(--s-12)) var(--s-16) var(--s-12)}',
      // 地板单独一层，**不是**挂在 .wyy-np 上：收起那趟封面要飞 900ms 回播放条，地板 320ms 就该没了。
      // 两者绑在同一个元素上只剩两个坏解 —— 要么一起淡（封面成了鬼影，接续散架），要么地板赖着不走
      // （落点在它身后，用户看不见封面去哪儿了）。分层之后各走各的刻度，封面全程结实。
      // 底：取色层压暗过的艺术地板（白字 ≥8:1 由 buildArtTokens 保证），左上提一道 vivid 做纵深，
      // 右下压暗。浅色主题下这里**不再有任何一块白** —— 用户三次反馈的"歌词在纯白背景上太突兀"。
      // 必须写成 background-color + background-image 两条：只写 background 简写会把 background-color
      // 打成 transparent，DOM 侧那套"沿祖先链找不透明底色"的扫描就定不出底（实测判"扫不出来"）。
      '.wyy-np-ground{position:absolute;inset:0;z-index:0;'
      + 'background-color:var(--np-floor);'
      // 舞台从**播放条那张封面**的位置长出来：渐变锚在 --np-ox/--np-oy（开屏前量的那颗点），
      // 配合下面 wyy-np-open 的圆形 clip 一起展开 —— onetake 的 carry：开场那个东西
      // 必须是上一屏的实物，而不是"整屏一起浮现"。
      + 'background-image:radial-gradient(150% 130% at var(--np-ox,50%) var(--np-oy,104%),'
      + 'color-mix(in oklab,var(--art-vivid) 34%,var(--np-floor)) 0,'
      + 'var(--np-floor) 46%,color-mix(in oklab,#000000 38%,var(--np-floor)) 100%)}',
      // 入场：地板/眉题/歌词/控件淡进来（snap，快），封面另有自己那趟 900ms 的飞 —— 一快一慢叠起来
      // 才像"地先铺开、东西再就位"，而不是整屏一起浮现。
      // **封面不在这个名单里**（:not(.wyy-np-art)）：它是被携带的那个实物，两个方向的边界都得自始至终
      // 结实 —— 让父层替它淡，等于把接续做成鬼影。
      '.wyy-np::after,.wyy-np-left>*:not(.wyy-np-art),.wyy-np-lyric-box{animation-name:wyy-fade}',
      // 入场错峰：眉题（含收起键）先落，然后元信息/进度/控件依次就位，歌词列最后。40~70ms 一档，
      // "一件件落"而不是整屏同时淡进来（后者就是 onetake 说的幻灯片感）。封面不在此列 —— 它自己飞。
      '.wyy-np-left>*:not(.wyy-np-art),.wyy-np-lyric-box{animation-duration:var(--t);animation-timing-function:var(--ease-snap);'
      + 'animation-delay:var(--np-d,0ms);animation-fill-mode:backwards}',
      '.wyy-np-left .wyy-np-lyrow{--np-d:60ms}',
      '.wyy-np-left .wyy-np-meta{--np-d:200ms}',
      '.wyy-np-left .wyy-np-prog{--np-d:260ms}',
      '.wyy-np-left .wyy-np-ctrl{--np-d:320ms}',
      '.wyy-np-lyric-box{--np-d:300ms}',
      // 舞台开合：圆形 clip 从封面那颗点铺开 / 收回。--ease-snap 铺开（快出去），
      // 收起用 --ease-art（与封面飞回播放条同一条刻度），两边读起来是同一个动作的往返。
      '@keyframes wyy-np-open{from{clip-path:circle(0% at var(--np-ox,50%) var(--np-oy,104%))}'
      + 'to{clip-path:circle(150% at var(--np-ox,50%) var(--np-oy,104%))}}',
      '@keyframes wyy-np-close{from{clip-path:circle(150% at var(--np-ox,50%) var(--np-oy,104%))}'
      + 'to{clip-path:circle(0% at var(--np-ox,50%) var(--np-oy,104%))}}',
      '.wyy-np-ground,.wyy-np::after{animation:wyy-np-open var(--t-art) var(--ease-snap) both}',
      // 收起：真给元素挂上 .out（这一档以前**从没被用上** —— 渲染时没人加类，于是地板/歌词/控件
      // 一直不淡，等到 1s 后整块硬切。用户复报的"退出动效不对"就有这一份）。
      '.wyy-np.out{pointer-events:none}',
      '.wyy-np.out .wyy-np-ground,.wyy-np.out::after{animation:wyy-np-close var(--t-art) var(--ease-art) both}',
      // 退出错峰走**反序**：控件先退、歌词随后、眉题最后，然后舞台才收 —— "最后进来的最先走"
      '.wyy-np.out .wyy-np-left>*:not(.wyy-np-art),.wyy-np.out .wyy-np-lyric-box'
      + '{opacity:0;transition:opacity var(--t-slow) var(--ease) var(--np-xd,0ms)}',
      '.wyy-np.out .wyy-np-ctrl{--np-xd:0ms}',
      '.wyy-np.out .wyy-np-prog{--np-xd:40ms}',
      '.wyy-np.out .wyy-np-lyric-box{--np-xd:80ms}',
      '.wyy-np.out .wyy-np-meta{--np-xd:120ms}',
      '.wyy-np.out .wyy-np-lyrow{--np-xd:160ms}',
      '.wyy-np-bg{position:absolute;inset:-10%;background-size:cover;background-position:center;filter:blur(70px) saturate(1.6);opacity:.55;pointer-events:none}',
      // 换封面的那一层旧底光：盖在新底光上面淡出，两层叠在一起就是交叉溶解。
      // 用 animation 而不是 transition：transition 要"先以旧值挂载、下一帧再改值"，多一帧就多一次闪烁。
      // 时长与令牌插值同长（--t-art），两边不同步会露馅。
      '@keyframes wyy-bgfade{from{opacity:.55}to{opacity:0}}',
      '.wyy-np-bg.prev{animation:wyy-bgfade var(--t-art) var(--ease-art) forwards}',
      // 顶部条带用 vivid（饱和的那一支）而不是 --np-top（浅主题是粉彩化的 pastel）：
      // 地板已经压暗了，再铺一层粉彩等于在深色上刷白粉。
      // 条带 34% 之后收敛到 88% 不透明的地板 —— 留 12% 给模糊封面透出来做一点点起伏；
      // 这一档在白字上是安全的（地板本身 ≥8:1，透 12% 只把它拉到 7:1 量级），
      // 但浅色主题那版同样的 12% 透底曾把 38px 已唱行拖到 2.98:1 —— 因为那时字是**深色**的。
      '.wyy-np::after{content:"";position:absolute;inset:0;pointer-events:none;'
      + 'background:'
      + 'linear-gradient(180deg,color-mix(in oklab,var(--art-vivid) 34%,transparent) 0,color-mix(in oklab,var(--np-floor) 88%,transparent) 34%),'
      + 'radial-gradient(88% 66% at 6% -14%,var(--np-wash-a) 0,transparent 72%),'
      + 'radial-gradient(70% 54% at 98% -6%,var(--np-wash-b) 0,transparent 70%)}',
      '.wyy-np-collapse{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:var(--r-pill);'
      + 'cursor:pointer;color:var(--wyy-fg);transition:background var(--t) var(--ease);flex:none}',
      '.wyy-np-collapse:hover{background:var(--wyy-surface-2)}',
      // 顶部条带是唯一还透着艺术色的地方，它的字必须走 --art-on（取色层保证 ≥4.5:1），
      // 层级交给字号/字重，而不是 --art-on 的 alpha —— 半透明会把保证作废。
      // 眉题不再吃 --art-on：那是"色带上该用哪支墨"的答案（浅色主题=深墨），
      // 而全屏歌词的地板现在是暗的，深墨在上面直接读不出（实测 1.4:1）。这块面的墨只有 --np-ink。
      '.wyy-np-head-kicker{font-size:var(--fs-meta);line-height:var(--lh-meta);font-weight:700;letter-spacing:var(--ls-eyebrow);text-transform:uppercase;color:var(--np-ink)}',
      '.wyy-np-empty{position:relative;z-index:1;margin:auto;display:flex;align-items:center;justify-content:center;color:var(--wyy-fg-2)}',
      // 这里原来铺着一层 `linear-gradient(transparent 0, --np-ly-floor 14%)` 给自己当地板；
      // 全屏换成沉浸式暗地板之后，整块面就是地板，再铺一层只会盖掉封面透出来的那 12% 起伏。
      '.wyy-np-lyric-box{position:relative;z-index:1;min-width:0;min-height:0;display:flex;flex-direction:column;gap:var(--s-4)}',
      '.wyy-np-left{position:relative;z-index:1;min-width:0;min-height:0;display:flex;flex-direction:column;gap:var(--s-6)}',
      // 眉题 + 收起钮同一行（原型第一行就是这个形状），顶部留白交给 .wyy-np 的内边距
      '.wyy-np-lyrow{flex:none;display:flex;align-items:center;justify-content:space-between;gap:var(--s-4)}',
      // 封面吃满列宽（44% 栅格）。flex:0 1 auto + min-height:0：面板压得很矮时让封面
      // 收缩成裁切而不是把下面的控制簇顶出可视区（原型那版 528 高的封面在 900 高的
      // 视口里就直接溢出被裁掉了，量到的左列高 2098px —— 这个错不该抄）。
      // 封面那趟飞：两个方向都走 --t-art（1s）+ --ease-glide。时长不是审美选的，是**行程除以速度上限**：
      // 播放条小封面 → 大屏封面槽 = 852px（实测），"不闪"的上限（onetake 的 curves 腿：80px/帧 @30fps
      // 无快门即频闪 → 2400px/s）给出下限 852 ÷ 2400 = 355ms，再乘 --ease-glide 的峰值斜率 2.29 ≈ 813ms；
      // 取 1s 留 19% 余量（实测峰值 1950px/s）。320ms 配 --ease 时实测 687px/帧，那是"跳一下再滑过去"。
      '.wyy-np-art{width:100%;aspect-ratio:1/1;flex:0 1 auto;min-height:0;border-radius:var(--r-lg);object-fit:cover;'
      + 'box-shadow:0 32px 72px -24px rgba(0,0,0,.6);will-change:transform;'
      + 'transition:transform var(--t-art) var(--ease-glide)}',
      '.wyy-np-art.ph{display:flex;align-items:center;justify-content:center;background:var(--wyy-surface-1);color:var(--wyy-fg-2)}',
      // 标题在 30% 之后的不透明底上，但仍在顶部条带的延伸区，继续用 --art-on；
      //艺人/专辑是小字，落在不透明区，走固定灰阶（alpha 版本实测 4.25:1，不达标）
      // 标题以前吃 --art-on，那是"**色带**上该用哪支墨"的答案（浅色主题=深墨 #101012）。
      // 全屏现在是暗地板，深墨在上面只有 1.21:1（像素判据抓到的），这块面的墨只有 --np-ink。
      '.wyy-np-title{font-size:var(--fs-title);line-height:var(--lh-title);font-weight:800;letter-spacing:0;text-wrap:balance;color:var(--np-ink)}',
      '.wyy-np-artist{font-size:var(--fs-sub);line-height:var(--lh-sub);color:var(--wyy-fg-2);margin-top:var(--s-1)}',
      '.wyy-np-prog{display:flex;align-items:center;gap:var(--s-3)}',
      '.wyy-np-time{flex:none;font-size:var(--fs-meta);line-height:var(--lh-meta);color:var(--wyy-fg-3);font-variant-numeric:tabular-nums}',
      '.wyy-np-track{flex:1;height:4px;border-radius:var(--r-pill);background:var(--wyy-track);cursor:pointer;position:relative}',
      // 全屏里的进度条同一条规矩：可见 4px，命中区 24px（这块面离鼠标最远，最容易点不中）。
      + '::before{content:"";position:absolute;left:-6px;right:-6px;top:-10px;bottom:-10px}',
      '.wyy-np-track:focus-visible{outline:2px solid var(--wyy-brand);outline-offset:6px}',
      '.wyy-np-track:hover{background:var(--wyy-track-hover)}',
      '.wyy-np-track-fill{position:absolute;left:0;top:0;bottom:0;border-radius:var(--r-pill);background:var(--wyy-fg)}',
      '.wyy-np-track:hover .wyy-np-track-fill{background:var(--wyy-brand)}',
      // 两簇：左簇五个播放控制，右簇队列 + 音量（原型 8 个钮的两簇结构；插件没有「喜欢」接口，
// 少一个桃心，音量给的是真滑杆而不是一个画出来的喇叭图标）
      '.wyy-np-ctrl{display:flex;align-items:center;justify-content:space-between;gap:var(--s-6);flex-wrap:wrap}',
      '.wyy-np-ctl-main{display:flex;align-items:center;gap:var(--s-5)}',
      '.wyy-np-ctl-side{display:flex;align-items:center;gap:var(--s-4);color:var(--wyy-fg-2)}',
      '.wyy-np-vol{width:96px;accent-color:var(--wyy-brand)}',
      '.wyy-np-hint{margin:auto;color:var(--wyy-fg-2);font-size:var(--fs-body)}',
      // 这里**不能**留 scroll-behavior:smooth：它会让 JS 写的每一次 scrollTop 也被浏览器再平滑一次，
      // 于是 rAF 补间被套上一层滞后，指针悬停时也停不下来。滚动改由 tweenScroll 自己走曲线。
      '.wyy-np-lyric{flex:1;min-height:0;overflow:auto;padding:14vh 0 40%;'
      + 'mask-image:linear-gradient(180deg,transparent 0,#000 22%,#000 84%,transparent 100%);'
      + '-webkit-mask-image:linear-gradient(180deg,transparent 0,#000 22%,#000 84%,transparent 100%)}',
      '.wyy-np-ly{padding:var(--s-2) 0;cursor:pointer;transform-origin:left center;'
      + 'transition:color var(--t-slow) var(--ease),transform var(--t-slow) var(--ease)}',
      '.wyy-np-ly .wyy-ly-main{font-size:var(--fs-lyr);font-weight:700;letter-spacing:0;line-height:1.28;'
      + 'color:var(--wyy-ly-off)}',
      '.wyy-np-ly:hover .wyy-ly-main{color:var(--wyy-fg)}',
      '.wyy-np-ly.on .wyy-ly-main{color:var(--wyy-ly-on)}',
      '.wyy-np-ly.on{transform:scale(1.02)}',
      '.wyy-np-ly.past .wyy-ly-main{color:var(--wyy-ly-past)}',
      // 片头署名行（t≈0）不可点：鼠标形状也不该说"能点"。它们不是歌的一部分，点了只会跳回曲首。
      '.wyy-np-ly.plain{cursor:default}',
      '.wyy-np-ly.plain:hover .wyy-ly-main{color:var(--wyy-ly-off)}',
      '.wyy-np-ly-sub{margin-top:var(--s-1);font-size:var(--fs-sub);line-height:var(--lh-sub);font-weight:500;'
      + 'color:var(--wyy-ly-sub)}',
      '.wyy-word{display:inline-block;white-space:pre-wrap}',
      '.wyy-ly-main{display:block}',
      '.wyy-ly-plain{display:inline}',
      // ---- 弹窗 ----
      // 两个弹层的入场：**从按下那一点长出来**（transform-origin 由 applyOrigin 按实测坐标写），
      // 曲线走 --ease-spring（落点有一下收束），不是凭空 opacity 渐显 ——
      // 凭空渐显无论多柔都是"换了张片"，接不上因果。
      '@keyframes wyy-pop{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:none}}',
      '@keyframes wyy-fade{from{opacity:0}to{opacity:1}}',
      '.wyy-modal-mask{position:fixed;inset:0;z-index:1000;background:color-mix(in oklab,#000000 55%,transparent);'
      + 'display:flex;align-items:center;justify-content:center;animation:wyy-fade var(--t) var(--ease-snap)}',
      '.wyy-modal{width:360px;max-width:92vw;border-radius:var(--r-lg);padding:var(--s-5);background:var(--wyy-elev);'
      + 'border:1px solid var(--wyy-border);box-shadow:var(--wyy-shadow);color:var(--wyy-fg);'
      + 'animation:wyy-pop var(--t) var(--ease-spring)}',
      '.wyy-modal-head{display:flex;align-items:center;justify-content:space-between;font-size:var(--fs-sub);line-height:var(--lh-sub);font-weight:700;margin-bottom:var(--s-4)}',
      '.wyy-modal-body{display:flex;flex-direction:column;align-items:center;gap:var(--s-3);padding:var(--s-2) 0 2px}',
      '.wyy-modal-text{margin:0;font-size:var(--fs-sm);line-height:var(--lh-sm);color:var(--wyy-fg-2)}',
      // 二维码必须黑码白底才可扫，这里的 #fff 是功能色，不是主题色
      '.wyy-qr{width:184px;height:184px;border-radius:var(--r-md);background:#fff;padding:6px}',
      '.wyy-qr-ph{width:184px;height:184px;display:flex;align-items:center;justify-content:center;border-radius:var(--r-md);'
      + 'background:var(--wyy-surface-1);font-size:var(--fs-meta);color:var(--wyy-fg-2)}',
      '.wyy-modal-status{font-size:var(--fs-meta);line-height:var(--lh-meta);color:var(--wyy-fg-2);min-height:16px;text-align:center}',
      '.wyy-modal-err{font-size:var(--fs-meta);line-height:var(--lh-meta);color:var(--wyy-brand);margin-top:var(--s-2);text-align:center}',
      // ---- 队列抽屉（原型排行榜色带上那个 queue 图标落地成的真抽屉）----
      '.wyy-queue{position:absolute;z-index:70;right:var(--s-4);bottom:calc(var(--bar-h) + var(--s-3));'
      + 'width:clamp(280px,36%,420px);max-height:60%;display:flex;flex-direction:column;'
      + 'background:var(--wyy-elev);border:1px solid var(--wyy-border);border-radius:var(--r-lg);'
      + 'box-shadow:var(--wyy-shadow);overflow:hidden;animation:wyy-pop var(--t) var(--ease-spring)}',
      '.wyy-queue-head{flex:none;display:flex;align-items:center;justify-content:space-between;gap:var(--s-3);'
      + 'padding:var(--s-4) var(--s-4) var(--s-3)}',
      '.wyy-queue-title{display:flex;flex-direction:column;min-width:0}',
      '.wyy-queue-kicker{font-size:var(--fs-meta);line-height:var(--lh-meta);font-weight:700;'
      + 'letter-spacing:var(--ls-eyebrow);text-transform:uppercase;color:var(--wyy-fg-3)}',
      '.wyy-queue-sub{font-size:var(--fs-sm);line-height:var(--lh-sm);color:var(--wyy-fg-2);'
      + 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.wyy-queue-body{flex:1;min-height:0;overflow:auto;padding:0 var(--s-2) var(--s-3);scrollbar-width:thin}',
      // ---- 搜索页头（原型：34px/800 的「搜索」+ 类型 chip 行）----
      '.wyy-search-head{display:flex;align-items:flex-end;gap:var(--s-4)}',
      '.wyy-search-title{margin:0;font-size:var(--fs-head);line-height:var(--lh-head);font-weight:800;letter-spacing:0}',
      // ---- 窄面板（DSH 侧栏展开时主区可能很窄）----
      // 门槛是算出来的：两栏要成立得同时满足「封面 ≥200px」和「歌词栏 ≥320px」——
      // 左栏 44%W ≥ 200 → W ≥ 455；右栏 56%W ≥ 320 → W ≥ 571。取 640 留出余量。
      // 别按视口断点：面板宽度是宿主拖出来的，跟视口无关，所以必须走容器查询。
      '@container (max-width: 640px){.wyy-np{grid-template-columns:1fr;gap:var(--s-8);padding:var(--s-6) var(--s-6) var(--s-8)}'
      + '.wyy-np-art{max-width:320px}.wyy-np-lyric{max-height:38vh}}',

      // ---- 氛围层（app 级）----
      // 它活在宿主 layout 的 shell.overlay 里，**对话界面下没有 .wyy-page 这个祖先**，
      // 所以这一段的色值只有两个来源：内联发下来的 --amb-c*（当前封面）与这里写死的克制常量。
      // 用 var(--s-*) / var(--wyy-*) 会在对话界面里整段失效（那些令牌挂在 .wyy-page 上）。
      //
      // 层级关键：mix-blend-mode 只与"同一个层叠上下文里的内容"混合，所以 .wyy-amb 这一层
      // 不能加 opacity/transform/filter/isolation（加了就成组，光柱只能跟自家兄弟混、宿主界面看不见）。
      // 光柱的 <i> 自己带 mix-blend-mode：它在 overlay 这层（z-index:20）里直接对着下面整棵树混。
      // （背景层是另一回事：它在 frame 底部、普通合成、整层 60% 不透明度，不参与混合。）
      '.wyy-amb{position:absolute;inset:0;'
      + '--amb-c1:var(--amb-c1-l,#8aa0ff);--amb-c2:var(--amb-c2-l,#ffd0a8);--amb-c3:var(--amb-c3-l,#a8e0ff);--amb-c4:var(--amb-c4-l,#ffb0d0)}',
      'body[data-ds-dark-theme] .wyy-amb{'
      + '--amb-c1:var(--amb-c1-d,#8aa0ff);--amb-c2:var(--amb-c2-d,#ffd0a8);--amb-c3:var(--amb-c3-d,#a8e0ff);--amb-c4:var(--amb-c4-d,#ffb0d0)}',
      '.wyy-amb-bg-root{position:absolute;inset:0;pointer-events:none;overflow:hidden;'
      + 'left:var(--amb-left,0px);right:var(--amb-right,0px);'
      // 整层默认 60% 不透明度（用户点名："调一个 60 的不透明度，塞在整个底下"）。
      // 强度滑杆直接乘在上面：0 → 看不见，100 → 满幅。
      + 'opacity:var(--amb-strength,0.6);'
      // 换歌时取色跟着迁移（与面板色带同刻度）；封面本身走背景图的交叉溶解
      + 'transition:--amb-c1-l var(--t-art,1000ms) var(--ease-art,cubic-bezier(.4,0,.2,1)),'
      + '--amb-c1-d var(--t-art,1000ms) var(--ease-art,cubic-bezier(.4,0,.2,1)),'
      + '--amb-c2-l var(--t-art,1000ms) var(--ease-art,cubic-bezier(.4,0,.2,1)),'
      + '--amb-c2-d var(--t-art,1000ms) var(--ease-art,cubic-bezier(.4,0,.2,1)),'
      + '--amb-c3-l var(--t-art,1000ms) var(--ease-art,cubic-bezier(.4,0,.2,1)),'
      + '--amb-c3-d var(--t-art,1000ms) var(--ease-art,cubic-bezier(.4,0,.2,1)),'
      + '--amb-c4-l var(--t-art,1000ms) var(--ease-art,cubic-bezier(.4,0,.2,1)),'
      + '--amb-c4-d var(--t-art,1000ms) var(--ease-art,cubic-bezier(.4,0,.2,1)),'
      + '--amb-floor-l var(--t-art,1000ms) var(--ease-art,cubic-bezier(.4,0,.2,1)),'
      + '--amb-floor-d var(--t-art,1000ms) var(--ease-art,cubic-bezier(.4,0,.2,1))}',
      'body[data-ds-dark-theme] .wyy-amb-bg-root{'
      + '--amb-c1:var(--amb-c1-d,#8aa0ff);--amb-c2:var(--amb-c2-d,#ffd0a8);--amb-c3:var(--amb-c3-d,#a8e0ff);--amb-c4:var(--amb-c4-d,#ffb0d0);'
      + '--amb-floor:var(--amb-floor-d,#1b1b1f)}',
      '.wyy-amb-bg-root{--amb-c1:var(--amb-c1-l,#8aa0ff);--amb-c2:var(--amb-c2-l,#ffd0a8);'
      + '--amb-c3:var(--amb-c3-l,#a8e0ff);--amb-c4:var(--amb-c4-l,#ffb0d0);--amb-floor:var(--amb-floor-l,#f4f2f6)}',
      // 地板：**不透明底色**（= 全屏歌词的 --np-floor）+ 一道 vivid 提亮 + 右下压暗，整张铺满。
      // 上一版把渐变收敛成 transparent，结果只有上半截看得出颜色（用户复报"只在最上方中间栏"）——
      // 背景层的第一要务是**铺满**，气氛可以淡，但不能缺。
      // 地板：底色（浅色 band / 暗色 npFloor）+ **平铺**的取色薄纱。
      // 原来那条 168° 渐变会把底部化向白（用户两次说"渐变为白/下方还是不行"）——
      // 现在整页一个色，不再有纵向过渡。
      '.wyy-amb-floor{position:absolute;inset:0;background-color:var(--amb-floor,transparent);'
      + 'background-image:var(--amb-veil,linear-gradient(rgba(0,0,0,0),rgba(0,0,0,0))),'
      + 'linear-gradient(color-mix(in oklab,var(--amb-c1) 18%,transparent),color-mix(in oklab,var(--amb-c1) 18%,transparent))}',
      'body:not([data-ds-dark-theme]) .wyy-amb-floor{--amb-veil:linear-gradient(rgba(255,255,255,.34),rgba(255,255,255,.34))}',
      // 模糊封面（照抄 .wyy-np-bg：blur 70px + saturate 1.6 + 0.55 不透明度）；inset 取负值再放大，
      // 这样"位置迁移"漂出去也不会露边。只有 transform 在动（缩放/平移都在这一个属性上）。
      '.wyy-amb-cover{position:absolute;inset:-12%;background-size:cover;background-position:center;'
      + 'filter:blur(70px) saturate(1.6);opacity:.42;will-change:transform;transform:translate3d(0,0,0) scale(1.14)}',
      // 暗色底本来就压得住，封面可以吃满（与全屏歌词同档）
      'body[data-ds-dark-theme] .wyy-amb-cover{opacity:.55}',
      // 暗色下的**黑纱**：浅色主题的底色 + 34% 白纱把"最坏封面"兜住了（封面再黑也还是浅底），
      // 暗色主题没有天然等价物 —— 封面一白，整片氛围就被抬到中灰，正文（近白）对比度掉到 4.5 以下。
      // 实测：同一首歌两次运行，35% 处采样 [101,122,121] → 对比度 4.36（线 4.5，这次真的红了）。
      // 0.26 那版是按"近黑地板"反推的（封面满幅 0.55 + 暗底 ≈ 155 → 要压到 ≤119 才够 4.5，即 ≥0.235）；
      // 地板换成**可带色**的 npFloor 之后这笔账不成立 —— 纯白封面反证里《偷心》那轮 35% 点只有 4.14。
      // 修法是两处一起改：地板先在 ambBackdropPaintColors 里压一半，黑纱 .26 → .34。复测（同一反证点法）：
      // 真实地板最坏点 5.31 / 6.14（两轮），连"比可达上限还亮的灰"压暗后都有 5.34；而一张**不压暗**的
      // 亮地板只有 4.13 —— 两颗旋钮是配套的：黑纱兜住封面的白，地板压暗兜住底色本身带色。
      // 盖在封面上、地板下不变（盖子在地板之上、律动条之外）。
      'body[data-ds-dark-theme] .wyy-amb-bg-root::after{content:"";position:absolute;inset:0;'
      + 'background:rgba(0,0,0,.34)}',
      // 律动条：贴窗口最下沿的一条频谱。柱子高度全部走 scaleY，不写 height（不触发布局）。
      // 高度默认 40px、48 根：26px/40 根在实机上"没啥感觉"（用户复报过），
      // 所以抬高行程、加密柱子，并把柱顶调亮 —— 跳动得看得出才叫律动条。
      '.wyy-amb-bar{position:absolute;bottom:0;height:var(--amb-bar-h,56px);display:flex;align-items:flex-end;gap:2px;'
      + 'padding:0 12px;left:var(--amb-left,0px);right:var(--amb-right,0px);transform-origin:bottom;'
      // 顶边羽化：柱子顶端直接切在背景上太突兀（用户报"屏幕下方的过渡生硬"）。
      // 用沿纵向的 mask 让柱顶"化开"，而底部那条亮线保持清晰。
      + 'mask-image:linear-gradient(to top,rgba(0,0,0,1) 0%,rgba(0,0,0,1) 46%,rgba(0,0,0,0) 100%);'
      + '-webkit-mask-image:linear-gradient(to top,rgba(0,0,0,1) 0%,rgba(0,0,0,1) 46%,rgba(0,0,0,0) 100%);'
      + 'animation:wyy-amb-in var(--t-slow,320ms) var(--ease-snap,cubic-bezier(.19,1,.22,1))}',
      '.wyy-amb-bar.frame{left:0;right:0}',
      '.wyy-amb-bar i{flex:1 1 0;min-width:2px;height:100%;transform:scaleY(0.05);transform-origin:bottom;'
      + 'border-radius:2px 2px 0 0;will-change:transform;opacity:0.86;'
      + 'background:linear-gradient(to top,var(--amb-c1) 0%,var(--amb-c1) 52%,var(--amb-c2) 100%)}',
      // 节拍闪光：底沿那根 2px 亮线（--amb-beat 由 rAF 写在条上，0..1）
      '.wyy-amb-bar::after{content:"";position:absolute;left:0;right:0;bottom:0;height:3px;background:var(--amb-c3);'
      + 'opacity:calc(0.3 + var(--amb-beat,0) * 0.7);border-radius:var(--r-pill,3px)}',
      '.wyy-amb-notes{position:absolute;inset:0}',
      // 音符用 fixed + 视口坐标：它挂在我们自己的层里，但位置是按光标的 clientRect 量的
      '.wyy-amb-note{position:fixed;pointer-events:none;line-height:1;color:var(--amb-c1);'
      + 'text-shadow:0 1px 4px rgba(0,0,0,0.35);'
      // 入场用 snap（easeOutExpo，t80≈.22 —— 仓库反馈档那条），落点用 spring 收束，
      // 出场交给默认 --ease。一个动画里三种角色，不是一条 smootherstep 套到底。
      + 'animation:wyy-amb-note 760ms var(--ease-snap,cubic-bezier(.19,1,.22,1)) forwards}',
      '.wyy-amb-note.n1{color:var(--amb-c2)}.wyy-amb-note.n2{color:var(--amb-c3)}.wyy-amb-note.n3{color:var(--amb-c4)}',
      '@keyframes wyy-amb-note{'
      + '0%{opacity:0;transform:translateY(5px) scale(.4) rotate(var(--amb-note-rot,0deg));animation-timing-function:var(--ease-snap,cubic-bezier(.19,1,.22,1))}'
      + '20%{opacity:1;transform:translateY(-3px) scale(1.18,.84) rotate(var(--amb-note-rot,0deg));animation-timing-function:var(--ease-spring,cubic-bezier(.34,1.4,.5,1))}'
      + '46%{opacity:1;transform:translateY(-11px) scale(.96,1.08) rotate(var(--amb-note-rot,0deg));animation-timing-function:var(--ease,cubic-bezier(.3,0,0,1))}'
      + '100%{opacity:0;transform:translateY(-30px) scale(.9) rotate(var(--amb-note-rot,0deg))}}',
      // 入场淡入（条子用同一族曲线）：一个 from 关键帧的动画，终点取元素自己的计算值
      '@keyframes wyy-amb-in{from{opacity:0}}',
      // 系统级"减少动态效果"：装饰性动效整体让路（JS 那边已经停掉背景漂移与音符，
      // 这里是样式侧的兜底，防止任何一条路径漏过去）
      '@media (prefers-reduced-motion: reduce){.wyy-amb-bar{animation:none}'
      + '.wyy-amb-note{animation-duration:1ms}.wyy-amb-bar::after{opacity:0.22}'
      // 全屏歌词的舞台开合与错峰也一起让路（原地出现/消失，不做 clip 展开与逐件落位）
      + '.wyy-np-ground,.wyy-np::after{animation:none}'
      + '.wyy-np-left>*:not(.wyy-np-art),.wyy-np-lyric-box{animation:none}}',
      '.wyy-amb-toast{position:absolute;left:50%;bottom:calc(var(--amb-bar-h,56px) + 10px);transform:translateX(-50%);'
      + 'font-size:12px;line-height:1.5;color:#fff;background:rgba(20,20,24,0.8);padding:6px 10px;border-radius:8px}',
      // ---- 聚光灯：**丁达尔光柱**（用户要的是"渐大光束"，不是一团光晕）----
      // 每盏灯一个元素：束身用 conic-gradient 在灯头处切出一个很窄的角度窗 —— 往下自然渐宽，
      // 这正是丁达尔的样子；纵向用 mask 做"亮→透"的沿程衰减；::after 是更窄更亮的**亮芯**。
      // 芯 + 束两层叠起来才有体积光的芯晕关系。位置与摆动只走 transform（整层 pointer-events:none）。
      '.wyy-amb-spot{position:absolute;top:0;height:88%;overflow:hidden;left:var(--amb-left,0px);right:var(--amb-right,0px)}',
      '.wyy-amb-spot.frame{left:0;right:0}',
      '.wyy-amb-spot i{position:absolute;top:0;left:0;width:100%;height:100%;'
      + 'transform-origin:var(--amb-spot-ox,26%) 0;'
      + 'background:conic-gradient(from 172deg at var(--amb-spot-ox,26%) 0%,transparent 0deg,'
      + 'var(--amb-beam) 5.5deg,var(--amb-beam) 10.5deg,transparent 16deg);'
      + 'mask-image:linear-gradient(to bottom,rgba(0,0,0,.92) 0%,rgba(0,0,0,.5) 46%,transparent 86%);'
      + '-webkit-mask-image:linear-gradient(to bottom,rgba(0,0,0,.92) 0%,rgba(0,0,0,.5) 46%,transparent 86%);'
      // 浅色底上 screen 等于冲白（看不见）→ 束身走 multiply 做"有色光"；暗色底下画布换成 screen
      + 'mix-blend-mode:multiply;opacity:calc(var(--amb-spot-a,0.4) * .9)}',
      '.wyy-amb-spot i::after{content:"";position:absolute;inset:0;'
      + 'background:conic-gradient(from 174.75deg at var(--amb-spot-ox,26%) 0%,transparent 0deg,'
      + 'var(--amb-c3) 1.9deg,var(--amb-c3) 3.6deg,transparent 6.5deg);'
      + 'mask-image:linear-gradient(to bottom,rgba(0,0,0,.95) 0%,transparent 70%);'
      + '-webkit-mask-image:linear-gradient(to bottom,rgba(0,0,0,.95) 0%,transparent 70%);'
      + 'mix-blend-mode:screen;opacity:.8}',
      '.wyy-amb-spot i::before{content:"";position:absolute;left:var(--amb-spot-ox,26%);top:2px;width:64px;height:15px;'
      + 'transform:translateX(-50%);border-radius:50%;background:var(--amb-c3);'
      + 'box-shadow:0 0 26px 10px var(--amb-c2);opacity:.9}',
      '.wyy-amb-spot i.l{--amb-spot-ox:3%}',
      '.wyy-amb-spot i.r{--amb-spot-ox:97%}',
      'body[data-ds-dark-theme] .wyy-amb-spot i{mix-blend-mode:screen;opacity:var(--amb-spot-a,0.4)}',
      // 浅色主题的取色本身很浅，multiply 上去几乎压不动（实测 246→243，等于看不见）：
      // 束身混入深色，才是"有色玻璃"那种能看见的光柱；暗色那边保持原样的取色（screen 发光）。
      '.wyy-amb-spot i{--amb-beam:var(--amb-c2)}',
      'body:not([data-ds-dark-theme]) .wyy-amb-spot i{--amb-beam:color-mix(in oklab,var(--amb-c2) 42%,#241f2b)}',
      // reduced：不给光束任何摆动（JS 那边已经停循环），静态光柱留着
      '@media (prefers-reduced-motion: reduce){.wyy-amb-spot i{transform:none}.wyy-amb-spot i::after{opacity:.5}}',

      // ---- 氛围控制（插件页内：左栏下栏 + 设置面板，这两个在 .wyy-page 里，令牌可用）----
      '.wyy-rail-ambient{flex:none;margin-top:var(--s-2);padding-top:var(--s-3);border-top:1px solid var(--wyy-border);display:flex;gap:var(--s-2)}',
      '.wyy-rail-amb-btn{flex:1;height:34px;display:flex;align-items:center;justify-content:center;border-radius:var(--r-sm);'
      + 'color:var(--wyy-fg-2);background:var(--wyy-surface-2);cursor:pointer;'
      + 'transition:color var(--t) var(--ease),background var(--t) var(--ease)}',
      '.wyy-rail-amb-btn:hover{color:var(--wyy-fg);background:var(--wyy-surface-hover)}',
      '.wyy-rail-amb-btn.on{color:#fff;background:var(--wyy-brand)}',
      '.wyy-amb-panel{position:absolute;z-index:80;right:var(--s-4);bottom:calc(var(--bar-h) + var(--s-3));'
      + 'width:clamp(300px,34%,380px);max-height:66%;display:flex;flex-direction:column;background:var(--wyy-elev);'
      + 'border:1px solid var(--wyy-border);border-radius:var(--r-lg);box-shadow:var(--wyy-shadow);overflow:hidden;'
      + 'animation:wyy-pop var(--t) var(--ease-spring)}',
      '.wyy-amb-panel-head{flex:none;display:flex;align-items:center;justify-content:space-between;gap:var(--s-3);'
      + 'padding:var(--s-4) var(--s-4) var(--s-3)}',
      '.wyy-amb-master{flex:none;display:flex;align-items:center;justify-content:space-between;gap:var(--s-3);'
      + 'padding:0 var(--s-4) var(--s-3)}',
      '.wyy-amb-master-title{font-size:var(--fs-sub);line-height:var(--lh-sub);font-weight:700}',
      '.wyy-amb-panel-body{flex:1;min-height:0;overflow:auto;padding:0 var(--s-4) var(--s-4);scrollbar-width:thin;'
      + 'display:flex;flex-direction:column;gap:var(--s-2)}',
      '.wyy-amb-row{border:1px solid var(--wyy-border);border-radius:var(--r-md);padding:var(--s-3);background:var(--wyy-surface-1)}',
      '.wyy-amb-row-head{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--s-3)}',
      '.wyy-amb-row-text{display:flex;flex-direction:column;min-width:0}',
      '.wyy-amb-row-title{font-size:var(--fs-sm);line-height:var(--lh-sm);font-weight:700}',
      '.wyy-amb-row-sub{font-size:var(--fs-meta);line-height:var(--lh-meta);color:var(--wyy-fg-2)}',
      '.wyy-amb-row-body{display:flex;flex-direction:column;gap:var(--s-2);margin-top:var(--s-3)}',
      // 功能 3：设置面板里的开关随节拍左右晃动（滑块 translateX）+ 闪光（外圈 box-shadow）
      '.wyy-amb-switch{flex:none;width:40px;height:22px;border-radius:999px;background:var(--wyy-surface-2);'
      + 'border:1px solid var(--wyy-border);position:relative;cursor:pointer;'
      + 'transition:background var(--t) var(--ease),box-shadow 90ms linear}',
      '.wyy-amb-switch .knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;'
      + 'box-shadow:0 1px 2px rgba(0,0,0,0.25);transition:left var(--t) var(--ease-spring)}',
      '.wyy-amb-switch.on{background:var(--wyy-brand);border-color:transparent}',
      '.wyy-amb-switch.on .knob{left:20px}',
      '.wyy-amb-panel.beat .wyy-amb-switch{box-shadow:0 0 calc(2px + var(--amb-beat,0) * 11px) rgba(255,110,130,calc(var(--amb-beat,0) * 0.85))}',
      '.wyy-amb-panel.beat .wyy-amb-switch .knob{transform:translateX(calc(var(--amb-beat,0) * var(--amb-beat-amp,4px)))}',
      '.wyy-amb-slider{display:flex;align-items:center;gap:var(--s-2);font-size:var(--fs-meta);color:var(--wyy-fg-2)}',
      '.wyy-amb-slider .lab{flex:none;width:52px}',
      '.wyy-amb-slider input[type=range]{flex:1;min-width:0;accent-color:var(--wyy-brand)}',
      '.wyy-amb-slider .val{flex:none;width:28px;text-align:right;font-variant-numeric:tabular-nums}',
      '.wyy-amb-scope{display:flex;align-items:center;gap:var(--s-2);font-size:var(--fs-meta);color:var(--wyy-fg-2)}',
      '.wyy-amb-scope .lab{flex:none;width:52px}',
      '.wyy-amb-seg{flex:1;height:26px;border-radius:var(--r-pill);background:var(--wyy-surface-2);color:var(--wyy-fg-2);'
      + 'cursor:pointer;font-size:var(--fs-meta);transition:color var(--t) var(--ease),background var(--t) var(--ease)}',
      '.wyy-amb-seg.on{background:var(--wyy-brand);color:#fff}',
      // 被标为"融入"的宿主表面（消息气泡 / 变量名·文件名芯片）：半透明而不是透明 —— 用户要的是融入
      'body:not([data-ds-dark-theme]) [data-wyy-amb-blend="1"]{background-color:color-mix(in oklab,#ffffff 46%,transparent) !important}',
      'body[data-ds-dark-theme] [data-wyy-amb-blend="1"]{background-color:color-mix(in oklab,#ffffff 9%,transparent) !important}',
      // 代码表面（行内芯片 / 代码块）：宿主的底色全部来自这几个令牌（--dsl-code-block-background 是
      // .md-code-block 自己在模块样式里定义的、--dsw-alias-* 是主题令牌、粘性 banner 走 bg-base），
      // 所以改令牌而不是改颜色 —— shiki 那条 `background: var(--dsl-code-block-background) !important`
      // 也在这条链上，跟着一起透。!important 是必须的：令牌常常被内联样式或模块类声明在同一元素上。
      'body:not([data-ds-dark-theme]) [data-wyy-amb-blend="2"]{'
      + '--dsl-code-block-background:color-mix(in oklab,#ffffff 52%,transparent) !important;'
      + '--dsw-alias-markdown-code-block:color-mix(in oklab,#ffffff 52%,transparent) !important;'
      + '--dsw-alias-markdown-inline-code:color-mix(in oklab,#ffffff 52%,transparent) !important;'
      + '--dsw-alias-markdown-code-block-banner:color-mix(in oklab,#ffffff 52%,transparent) !important;'
      + '--dsw-alias-bg-base:color-mix(in oklab,#ffffff 52%,transparent) !important}',
      'body[data-ds-dark-theme] [data-wyy-amb-blend="2"]{'
      + '--dsl-code-block-background:color-mix(in oklab,#000000 30%,transparent) !important;'
      + '--dsw-alias-markdown-code-block:color-mix(in oklab,#000000 30%,transparent) !important;'
      + '--dsw-alias-markdown-inline-code:color-mix(in oklab,#000000 30%,transparent) !important;'
      + '--dsw-alias-markdown-code-block-banner:color-mix(in oklab,#000000 30%,transparent) !important;'
      + '--dsw-alias-bg-base:color-mix(in oklab,#000000 30%,transparent) !important}',
      // 输入框卡片：不走上面的体检（它可能被附件/队列撑高），认宿主标记直接给同一档半透明
      'body:not([data-ds-dark-theme]) [data-wyy-amb-blend="3"]{background-color:color-mix(in oklab,#ffffff 46%,transparent) !important}',
      'body[data-ds-dark-theme] [data-wyy-amb-blend="3"]{background-color:color-mix(in oklab,#ffffff 9%,transparent) !important}',
      // 输入框底下的那条渐变底板：形状照旧（顶边透明 → 36px 处压住），只把它渐过去的颜色换成半透明
      'body:not([data-ds-dark-theme]) [data-wyy-amb-blend="4"]{background-image:'
      + 'linear-gradient(180deg,rgba(255,255,255,0) 0px,color-mix(in oklab,#ffffff 58%,transparent) 36px) !important}',
      'body[data-ds-dark-theme] [data-wyy-amb-blend="4"]{background-image:'
      + 'linear-gradient(180deg,rgba(0,0,0,0) 0px,color-mix(in oklab,#000000 46%,transparent) 36px) !important}',
      '.wyy-amb-diag{flex:none;padding:var(--s-2) var(--s-4) var(--s-3);font-size:11px;line-height:1.6;'
      + 'color:var(--wyy-fg-3);border-top:1px solid var(--wyy-border);word-break:break-all}',
    ].join('\n')

    // =================================================================
    // 插件入口
    // =================================================================

    const inject = ['slots']

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return

      ctx.effect(() => {
        const el = document.createElement('style')
        el.setAttribute('data-plugin', 'dsh-wyymusic')
        el.textContent = CSS
        document.head.appendChild(el)
        return () => { if (el.parentNode !== null) el.parentNode.removeChild(el) }
      }, 'dsh-wyymusic: styles')

      // 播放在面板卸载后继续：audio 单例在模块作用域创建，不随 React 树销毁。
      ctx.effect(() => {
        ensureAudio()
        return () => { /* 插件卸载时不强制停播，保持与官方播放条一致的体感 */ }
      }, 'dsh-wyymusic: audio singleton')

      // 弹层入场的原点（见 applyOrigin）：按下的那一刻记坐标，弹层从那儿长出来
      ctx.effect(() => installPressOrigin(), 'dsh-wyymusic: press origin')

      // ③ 氛围层：注册进宿主 layout 的全窗 overlay（绝对定位、z-index 20、自身 pointer-events:none）。
      //    这是"突破窗口"的关键一步 —— 它**不属于 main 槽**，所以切到对话界面之后照样在，
      //    而 main 槽的面板一被卸载，挂在面板里的任何东西都会跟着消失。
      //    list 槽要 id；order 用 0（官方提示条也在这层，别去抢它们的位置）。
      ctx.effect(() => slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: PANEL_ID + '-ambient', order: 0 },
        AmbientLayer,
      )), 'dsh-wyymusic: ambient layer')

      // ④ 氛围的两条常驻总线：换歌取色 + 播放态同步（都与面板是否挂载无关）
      ctx.effect(() => {
        startAmbArt()
        const off = player.subscribe(() => ambLoopSync())
        return () => { off(); stopAmbArt(); ambLoopSync() }
      }, 'dsh-wyymusic: ambient buses')

      // ⑤ 宿主 prefs 里的氛围设置：插件装上就取一次（面板没打开也要生效）
      ctx.effect(() => { ui.load(); return () => {} }, 'dsh-wyymusic: prefs load')

      // ④ 背景层：挂在 frame **最底下**（不在 overlay 里，也不在插件面板里）。
      //    与设置/换歌/播放态联动，关掉即整个移除。
      ctx.effect(() => {
        ambBackdropSync()
        const offAmb = amb.subscribe(() => ambBackdropSync())
        const offArt = ambArt.subscribe(() => ambBackdropPaintColors())
        return () => { offAmb(); offArt(); ambBackdropUnmount() }
      }, 'dsh-wyymusic: ambient backdrop')

      // ① 侧栏入口：order=-1 → 排在「插件」(=0) 之上
      ctx.effect(() => slots.inject('sidebar.panellist', () => slots.register(
        { name: 'sidebar.panellist', id: PANEL_ID, order: -1, label: '网易云音乐' },
        IconMusic,
      )), 'dsh-wyymusic: sidebar entry')

      // ② 主区域全屏面板：key 与侧栏 id 同名，点图标即 selectPanel(PANEL_ID)
      ctx.effect(() => slots.inject('main', () => slots.register(
        { name: 'main', key: PANEL_ID },
        WyyPage,
      )), 'dsh-wyymusic: main panel')
    }

    exports.apply = apply
    exports.inject = inject
    exports.PANEL_ID = PANEL_ID

    return module.exports
  },
})
