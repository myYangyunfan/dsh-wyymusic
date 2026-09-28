/* 原型逻辑：真实网易云数据 + 封面取色驱动的三层色彩 */
;(async function () {
  'use strict'

  var P = window.WyyPalette
  var DATA = await fetch('proto-data.json').then(function (r) { return r.json() })
  var shell = document.getElementById('shell')
  var main = document.getElementById('scroll')
  var state = { view: 'discover', pl: null, np: false, theme: 'light', play: false, lyricIdx: 0, cover: null, tune: false }
  var cache = {}

  /* ---------- 图标 ---------- */
  var svg = function (d, sw) {
    return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="' + (sw || 2) + '" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>'
  }
  var I = {
    home: svg('<path d="M3 10.5 12 3l9 7.5V21H3z"/>'),
    rank: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    lib: svg('<path d="M4 4h4v16H4zM11 4h3v16h-3zM17 5l3 1-3 14"/>'),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    play: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M7 5h3.2v14H7zM13.8 5H17v14h-3.2z"/></svg>',
    next: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 5.5v13L15 12zM17 5h2v14h-2z"/></svg>',
    prev: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M18 5.5v13L9 12zM5 5h2v14H5z"/></svg>',
    heart: svg('<path d="M12 20s-7-4.6-7-9.4A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.6C19 15.4 12 20 12 20Z"/>'),
    queue: svg('<path d="M4 7h11M4 12h11M4 17h7M18 10v8"/><circle cx="20" cy="18" r="2"/>'),
    expand: svg('<path d="M9 21H3v-6M21 9V3h-6"/>'),
    vol: svg('<path d="M4 9v6h3l5 4V5L7 9z"/><path d="M16 9.5a3.5 3.5 0 0 1 0 5"/>'),
    close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    shuffle: svg('<path d="M3 7h4l10 10h4M3 17h4l3-3M17 3l4 4-4 4"/>'),
    repeat: svg('<path d="M4 12a8 8 0 0 1 8-8h5M20 12a8 8 0 0 1-8 8H7"/><path d="m15 1 3 3-3 3M9 20l-3-3 3-3"/>'),
    sun: svg('<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>'),
    moon: svg('<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5Z"/>'),
  }

  /* ---------- 取色：加载封面 -> 提取 -> 写入 CSS 变量 ---------- */
  var failures = {}
  function loadCover(url, mode) {
    if (!url) return Promise.resolve(null)
    var key = url + '|' + mode
    if (key in cache) return Promise.resolve(cache[key])
    return new Promise(function (resolve) {
      var img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = function () {
        var sw = P.extract(img)
        var tk = sw ? P.buildTokens(sw, mode) : null
        if (!tk) failures[url] = '画布被污染 / 无像素数据'
        cache[key] = tk
        resolve(tk)
      }
      img.onerror = function () { // 取不到就退回 L2 中性表面，绝不让页面出现灰块
        failures[url] = '封面未加载'
        cache[key] = null
        resolve(null)
      }
      img.src = url
    })
  }

  function applyTokens(tk, el) {
    var node = el || shell
    var keys = ['band', 'vivid', 'deep', 'wash', 'tint', 'highlight', 'on']
    if (!tk) { keys.forEach(function (k) { node.style.removeProperty('--art-' + k) }); return }
    node.style.setProperty('--art-band', tk.band)
    node.style.setProperty('--art-vivid', tk.vivid)
    node.style.setProperty('--art-deep', tk.deep)
    node.style.setProperty('--art-wash', tk.wash)
    node.style.setProperty('--art-tint', tk.tint)
    node.style.setProperty('--art-highlight', tk.highlight)
    node.style.setProperty('--art-on', tk.onBand)
  }

  /* ---------- 自写占位歌词：只借用真实歌词的「每行字数分布」验证排版 ---------- */
  var SYL = '夜色漫过城市的窗台风把远山的雾吹散我把旋律折成一页纸写给还没醒来的明天星光落在空荡的街灯下每一条河流都记得名字而我只记得那一刻的心跳'
  function placeholderLyric() {
    var chars = (DATA.lyric && DATA.lyric.chars) || []
    var times = (DATA.lyric && DATA.lyric.times) || []
    if (!chars.length) return []
    var lines = []
    var cursor = 0
    for (var i = 0; i < Math.min(chars.length, 24); i++) {
      var n = Math.max(5, Math.min(14, Math.round(chars[i] * 0.28))) // 中文一行 5–14 字才接近真实歌词
      var s = ''
      for (var k = 0; k < n; k++) { s += SYL.charAt(cursor % SYL.length); cursor++ }
      lines.push({ t: times[i] || i * 4, text: s, trans: i % 5 === 0 ? '自写占位 · ' + (i + 1) : '' })
    }
    return lines
  }
  var LINES = placeholderLyric()

  /* ---------- 视图 ---------- */
  var songOf = (function () {
    var all = []
    Object.keys(DATA.details).forEach(function (id) { DATA.details[id].songs.forEach(function (s) { all.push(s) }) })
    return all
  })()

  function fmtPlay(n) {
    if (!n) return ''
    return n >= 1e8 ? (n / 1e8).toFixed(1) + ' 亿' : n >= 1e4 ? Math.round(n / 1e4) + ' 万' : String(n)
  }
  function dur(iv) {
    if (iv == null || iv === '') return '--:--'
    var sec
    if (typeof iv === 'number') sec = iv
    else if (/^\d+$/.test(iv)) sec = Number(iv)
    else { var m = String(iv).split(':'); sec = Number(m[0] || 0) * 60 + Number(m[1] || 0) }
    if (!isFinite(sec) || sec <= 0) return '--:--'
    return Math.floor(sec / 60) + ':' + String(Math.round(sec % 60)).padStart(2, '0')
  }
  function cur() {
    if (state.pl) return DATA.details[state.pl] || Object.values(DATA.details)[0]
    return null
  }

  function band(title, eyebrow, art, sub, meta, tools) {
    return '<section class="wyy-band">' +
      '<div class="wyy-band-head">' +
      '<img class="wyy-band-art" src="' + art + '" alt="" crossorigin="anonymous">' +
      '<div class="wyy-band-txt"><div class="eyebrow">' + eyebrow + '</div><h1>' + title + '</h1>' +
      (sub ? '<p class="sub">' + sub + '</p>' : '') +
      '<div class="wyy-band-meta">' + meta.join('<span class="sep"></span>') + '</div></div></div>' +
      '<div class="wyy-band-tools">' + tools + '</div>' +
      '</section>'
  }

  function card(p) {
    return '<div class="wyy-card" data-open="' + p.id + '">' +
      '<div class="cover-wrap"><img src="' + p.cover + '" alt="" loading="lazy" crossorigin="anonymous">' +
      '<button class="wyy-fab" data-open="' + p.id + '" title="播放">' + I.play + '</button></div>' +
      '<div class="name">' + p.name + '</div>' +
      '<div class="desc">' + (p.playCount ? fmtPlay(p.playCount) + '次播放' : p.creator || '') + '</div></div>'
  }

  function rows(songs) {
    return '<div class="wyy-rows">' + songs.map(function (s, i) {
      return '<div class="wyy-row" data-song="' + s.id + '">' +
        '<div class="idx"><span class="n">' + (i + 1) + '</span><span class="p">' + I.play + '</span></div>' +
        '<div class="tt"><img src="' + s.cover + '" alt="" crossorigin="anonymous"><div class="tn">' +
        '<div class="t1">' + s.title + '</div><div class="t2">' + (s.artists || []).join(' / ') + '</div></div></div>' +
        '<div class="al">' + (s.album || '') + '</div>' +
        '<div class="du">' + dur(s.interval) + '</div>' +
        '<div class="du">' + I.heart + '</div></div>'
    }).join('') + '</div>'
  }

  var views = {
    discover: function () {
      var hero = DATA.recommend[0]
      var tools = '<button class="wyy-round lg" data-open="' + hero.id + '">' + I.play + '</button>' +
        '<button class="wyy-icon">' + I.shuffle + '</button><button class="wyy-icon">' + I.heart + '</button>'
      var h = band(hero.name, '每日推荐 · 为你挑选', hero.cover, '本周的心情样本：' + (hero.playCount ? fmtPlay(hero.playCount) + ' 次播放' : ''),
        ['歌单', '由网易云编辑推荐', '共 30 首'], tools)
      h += '<div class="wyy-body">'
      h += '<section class="wyy-sec"><div class="wyy-sec-head"><h2>最近播放</h2><a>全部</a></div><div class="wyy-grid">' +
        DATA.mine.slice(0, 6).map(card).join('') + '</div></section>'
      h += '<section class="wyy-sec"><div class="wyy-sec-head"><h2>为 ' + (state.theme === 'dark' ? '夜晚' : '白天') + ' 准备</h2><a>更多</a></div>' +
        '<div class="wyy-strip">' + DATA.recommend.slice(4, 10).map(function (p) {
          return '<div class="wyy-tile" data-tint="' + p.cover + '" data-open="' + p.id + '">' + p.name.slice(0, 6) +
            '<img src="' + p.cover + '" alt="" crossorigin="anonymous"></div>'
        }).join('') + '</div></section>'
      h += '<section class="wyy-sec"><div class="wyy-sec-head"><h2>推荐歌单</h2><a>更多</a></div><div class="wyy-grid">' +
        DATA.recommend.map(card).join('') + '</div></section>'
      h += '</div>'
      return h
    },
    playlist: function () {
      var d = cur(); if (!d) return views.discover()
      var tools = '<button class="wyy-round lg">' + I.play + '</button>' +
        '<button class="wyy-icon">' + I.shuffle + '</button><button class="wyy-icon">' + I.heart + '</button>' +
        '<button class="wyy-ghost">+ 收藏</button><button class="wyy-ghost">下载</button>'
      var h = band(d.name, '歌单', d.cover, d.description || '', [d.trackCount + ' 首', fmtPlay(d.playCount) + ' 播放'], tools)
      h += '<div class="wyy-body"><section class="wyy-sec" style="margin-top:0">' +
        '<div class="wyy-sec-head"><h2>曲目</h2><a>排序：默认</a></div>' + rows(d.songs) + '</section>' +
        '<section class="wyy-sec"><div class="wyy-sec-head"><h2>相似歌单</h2></div><div class="wyy-grid">' +
        DATA.recommend.slice(1, 5).map(card).join('') + '</div></section></div>'
      return h
    },
    rank: function () {
      var t = DATA.toplists[0]
      var tools = '<button class="wyy-round lg">' + I.play + '</button><button class="wyy-icon">' + I.queue + '</button>'
      var h = band(t.name, '榜单', t.cover, '根据平台播放与互动数据每小时更新', ['网易云官方榜', t.songs.length + ' 首'], tools)
      h += '<div class="wyy-body"><section class="wyy-sec" style="margin-top:0">' + rows(t.songs) + '</section>'
      h += '<section class="wyy-sec"><div class="wyy-sec-head"><h2>全部榜单</h2></div><div class="wyy-grid">' +
        DATA.toplists.map(function (x) { return card({ id: x.id, name: x.name, cover: x.cover, playCount: 0, creator: (x.songs[0] && x.songs[0].title) || '' }) }).join('') +
        '</div></section></div>'
      return h
    },
    mine: function () {
      var first = DATA.mine[0]
      var tools = '<button class="wyy-round lg" data-open="' + first.id + '">' + I.play + '</button><button class="wyy-ghost">新建歌单</button>'
      var h = band('我的音乐', '账号', first.cover, '本地与云端收藏，登录后可同步创建的歌单', [DATA.mine.length + ' 个歌单', DATA.account], tools)
      h += '<div class="wyy-body"><section class="wyy-sec"><div class="wyy-sec-head"><h2>创建的歌单</h2><a>排序</a></div>' +
        '<div class="wyy-grid">' + DATA.mine.map(card).join('') + '</div></section>' +
        '<section class="wyy-sec"><div class="wyy-sec-head"><h2>订阅的歌单</h2></div><div class="wyy-grid">' +
        DATA.recommend.slice(6, 12).map(card).join('') + '</div></section></div>'
      return h
    },
    search: function () {
      var chips = ['单曲', '歌单', '歌手', '专辑', '排行榜', '歌单关键词', 'MV', '歌词', '用户']
      var qs = ['晚安', 'Lo-Fi', '通勤', '民谣', '钢琴', '现场']
      var h = '<div class="wyy-body" style="padding-top:var(--s-8)">' +
        '<div class="wyy-sec-head"><h2 style="font-size:var(--fs-head);line-height:var(--lh-head);font-weight:800">搜索</h2></div>' +
        '<div class="wyy-chips">' + chips.map(function (c, i) { return '<button class="wyy-chip" aria-selected="' + (i === 0) + '">' + c + '</button>' }).join('') + '</div>' +
        '<div class="wyy-chips">' + qs.map(function (c) { return '<button class="wyy-chip">' + c + '</button>' }).join('') + '</div>' +
        '<section class="wyy-sec"><div class="wyy-sec-head"><h2>单曲</h2><a>共 128 首</a></div>' + rows(songOf.slice(0, 8)) + '</section>' +
        '<section class="wyy-sec"><div class="wyy-sec-head"><h2>歌单</h2></div><div class="wyy-grid">' +
        DATA.recommend.slice(0, 6).map(card).join('') + '</div></section></div>'
      return h
    },
  }

  /* ---------- 播放条 ---------- */
  function barTrack() {
    var d = cur()
    var s = (d && d.songs[0]) || songOf[0]
    return s
  }
  function renderBar() {
    var s = barTrack()
    document.getElementById('bar').innerHTML =
      '<div class="now"><img src="' + s.cover + '" alt="" crossorigin="anonymous">' +
      '<div style="min-width:0"><div class="t1">' + s.title + '</div><div class="t2">' + (s.artists || []).join(' / ') + '</div></div>' +
      '<button class="wyy-icon liked">' + I.heart + '</button></div>' +
      '<div class="mid"><div class="ctl"><button class="wyy-icon">' + I.shuffle + '</button>' +
      '<button class="wyy-icon">' + I.prev + '</button>' +
      '<button class="play" id="bar-play">' + (state.play ? I.pause : I.play) + '</button>' +
      '<button class="wyy-icon">' + I.next + '</button><button class="wyy-icon">' + I.repeat + '</button></div>' +
      '<div class="wyy-prog"><span id="t-cur">1:12</span><span class="wyy-track" style="flex:1"><span class="wyy-fill" style="width:38%"></span><span class="wyy-knob" style="left:38%"></span></span><span>' + dur(s.interval) + '</span></div></div>' +
      '<div class="right"><button class="wyy-icon">' + I.queue + '</button><button class="wyy-icon">' + I.vol + '</button>' +
      '<button class="wyy-ghost" id="np-btn">全屏播放</button></div>'
  }

  /* ---------- 全屏歌词 ---------- */
  function renderNp() {
    var s = barTrack()
    var el = document.getElementById('np')
    if (!state.np) { el.innerHTML = ''; return }
    el.innerHTML = '<div class="wyy-np">' +
      '<div class="wyy-np-left">' +
      '<div style="display:flex;justify-content:space-between;align-items:center">' +
      '<div class="eyebrow" style="color:color-mix(in oklab,var(--art-on) 70%,transparent)">正在播放</div>' +
      '<button class="wyy-icon" id="np-close">' + I.close + '</button></div>' +
      '<img class="wyy-np-art" id="np-art" src="' + s.cover + '" alt="" crossorigin="anonymous">' +
      '<div class="wyy-np-meta"><div class="t1">' + s.title + '</div><div class="t2">' + (s.artists || []).join(' / ') + ' · ' + (s.album || '') + '</div></div>' +
      '<div class="wyy-prog" style="color:color-mix(in oklab,var(--art-on) 78%,transparent)"><span>1:12</span><span class="wyy-track" style="flex:1"><span class="wyy-fill" style="width:38%;background:var(--art-on)"></span></span><span>' + dur(s.interval) + '</span></div>' +
      '<div class="wyy-np-ctl" style="justify-content:space-between">' +
      '<div style="display:flex;gap:var(--s-5);align-items:center"><button class="wyy-icon" style="color:color-mix(in oklab,var(--art-on) 80%,transparent)">' + I.shuffle + '</button>' +
      '<button class="wyy-icon" style="color:var(--art-on)">' + I.prev + '</button>' +
      '<button class="play">' + (state.play ? I.pause : I.play) + '</button>' +
      '<button class="wyy-icon" style="color:var(--art-on)">' + I.next + '</button>' +
      '<button class="wyy-icon" style="color:color-mix(in oklab,var(--art-on) 80%,transparent)">' + I.repeat + '</button></div>' +
      '<div style="display:flex;gap:var(--s-4);align-items:center;color:color-mix(in oklab,var(--art-on) 80%,transparent)">' +
      '<button class="wyy-icon">' + I.heart + '</button><button class="wyy-icon">' + I.queue + '</button><button class="wyy-icon">' + I.vol + '</button></div>' +
      '</div></div>' +
      '<div class="wyy-np-right"><div class="eyebrow" style="margin-bottom:var(--s-4);color:color-mix(in oklab,var(--art-on) 70%,transparent)">歌词 · 自写占位文案</div>' +
      '<div class="wyy-ly" id="ly">' + LINES.map(function (l, i) {
        return '<div class="l' + (i === state.lyricIdx ? ' on' : i === state.lyricIdx + 1 ? ' next' : '') + '" data-i="' + i + '">' + l.text +
          (l.trans ? '<span class="tr">' + l.trans + '</span>' : '') + '</div>'
      }).join('') + '</div></div></div>'
    var box = document.getElementById('ly')
    var on = box.querySelector('.l.on')
    if (on) box.scrollTop = on.offsetTop - box.clientHeight * 0.34
  }

  /* ---------- 取色面板（评审用的实测证据） ---------- */
  async function renderTune() {
    var el = document.getElementById('tune')
    if (!state.tune) { el.innerHTML = ''; return }
    var list = DATA.recommend.slice(0, 6).concat(DATA.toplists.slice(0, 2).map(function (t) { return { name: t.name, cover: t.cover } }))
    var rows = []
    for (var i = 0; i < list.length; i++) {
      var it = list[i]
      var tk = await loadCover(it.cover, state.theme)
      rows.push('<div class="trow"><img src="' + it.cover + '" crossorigin="anonymous" alt="">' +
        '<div class="tn2">' + it.name.slice(0, 14) + '</div>' +
        '<div class="sws">' + ['band', 'vivid', 'wash', 'deep', 'highlight'].map(function (k) {
          return '<span class="sw" style="background:' + (tk ? tk[k] : '#000') + '" title="' + k + ' ' + (tk ? tk[k] : '') + '"></span>'
        }).join('') + '</div>' +
        '<div class="ct">' + (tk ? tk.band + ' · ' + tk.bandContrast + ':1' : (failures[it.cover] || '取色失败')) + '</div>' +
        '<div class="ct">' + (tk ? (tk.onBand === '#f5f5f5' ? '白字' : '黑字') : '—') + '</div></div>')
    }
    el.innerHTML = '<div class="tpanel"><div class="eyebrow" style="margin-bottom:var(--s-3)">L3 动态取色 · 实测（' + state.theme + '）</div>' + rows.join('') +
      '<div class="note">提取耗时 window 内 56×56 采样 · 每封面一次；横幅文字色由 WCAG 对比度决定，不写死。</div></div>'
  }

  /* ---------- 渲染 ---------- */
  async function render() {
    main.innerHTML = views[state.view]()
    main.scrollTop = 0
    document.querySelectorAll('.wyy-nav button[data-view]').forEach(function (b) {
      b.setAttribute('aria-current', String(b.dataset.view === state.view))
    })
    var art = main.querySelector('.wyy-band-art')
    var tk = await loadCover(art && art.src, state.theme)
    applyTokens(tk)
    /* 局部染色：每个磁贴用自己的封面（异步、逐个应用，不阻塞首屏） */
    Array.prototype.forEach.call(main.querySelectorAll('[data-tint]'), function (el) {
      loadCover(el.dataset.tint, state.theme).then(function (t) { if (t) applyTokens(t, el) })
    })
    renderBar()
    renderNp()
    if (state.tune) renderTune()
    document.getElementById('theme-btn').innerHTML = state.theme === 'dark' ? I.sun : I.moon
    document.getElementById('theme-btn').title = state.theme === 'dark' ? '切换浅色（网易云）' : '切换深色（Spotify）'
    shell.setAttribute('data-theme', state.theme)
  }

  /* ---------- 事件 ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target
    var nav = t.closest && t.closest('[data-view]')
    if (nav) { state.view = nav.dataset.view; state.pl = null; render(); return }
    var open = t.closest && t.closest('[data-open]')
    if (open) { state.view = 'playlist'; state.pl = open.dataset.open; render(); return }
    if (t.closest && t.closest('#bar-play')) { state.play = !state.play; renderBar(); var a = document.getElementById('np-art'); if (a) a.classList.toggle('paused', !state.play); return }
    if (t.closest && t.closest('#np-btn')) { state.np = true; renderNp(); return }
    if (t.closest && t.closest('#np-close')) { state.np = false; renderNp(); return }
    if (t.closest && t.closest('#theme-btn')) { state.theme = state.theme === 'dark' ? 'light' : 'dark'; document.body.toggleAttribute('data-ds-dark-theme', state.theme === 'dark'); render(); return }
    if (t.closest && t.closest('#tune-btn')) { state.tune = !state.tune; renderTune(); return }
    var chip = t.closest && t.closest('.wyy-chip')
    if (chip) { chip.setAttribute('aria-selected', String(chip.getAttribute('aria-selected') !== 'true')); return }
    var row = t.closest && t.closest('.wyy-row')
    if (row) {
      document.querySelectorAll('.wyy-row.on').forEach(function (r) { r.classList.remove('on') })
      row.classList.add('on'); state.play = true; state.lyricIdx = Math.floor(Math.random() * Math.max(1, LINES.length - 3)); renderBar(); renderNp(); return
    }
  })

  /* 播放条上点击曲目名 -> 全屏 */
  document.addEventListener('dblclick', function (e) {
    if (e.target.closest && e.target.closest('.wyy-bar .now')) { state.np = true; renderNp() }
  })

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.np) { state.np = false; renderNp() }
    if (e.key === ' ') { state.play = !state.play; renderBar(); e.preventDefault() }
  })

  /* 歌词滚动：模拟时间轴推进，验证大屏歌词的排版节奏 */
  setInterval(function () {
    if (!state.np || !LINES.length) return
    state.lyricIdx = (state.lyricIdx + 1) % LINES.length
    var box = document.getElementById('ly')
    if (!box) return
    Array.prototype.forEach.call(box.children, function (el, i) {
      el.classList.toggle('on', i === state.lyricIdx)
      el.classList.toggle('next', i === state.lyricIdx + 1)
    })
    var on = box.children[state.lyricIdx]
    if (on) box.scrollTo({ top: on.offsetTop - box.clientHeight * 0.34, behavior: 'smooth' })
  }, 2600)

  /* rail */
  document.getElementById('rail').innerHTML =
    '<div class="wyy-brandline"><span class="dot">D</span><b>DSH · 网易云音乐</b></div>' +
    '<nav class="wyy-nav">' +
    [['discover', '发现', I.home], ['rank', '排行榜', I.rank], ['mine', '我的音乐', I.lib], ['search', '搜索', I.search]]
      .map(function (n) { return '<button data-view="' + n[0] + '">' + '<span class="bar"></span>' + n[2] + '<span>' + n[1] + '</span></button>' }).join('') +
    '</nav>' +
    '<div class="wyy-lib"><div class="eyebrow">我的歌单</div>' +
    DATA.mine.slice(0, 7).map(function (p) { return '<button data-open="' + p.id + '"><img src="' + p.cover + '" alt="" crossorigin="anonymous"><span class="t">' + p.name + '</span></button>' }).join('') +
    '</div>'

  /* topbar */
  document.getElementById('topbar').innerHTML =
    '<div class="wyy-searchbox">' + I.search + '<input placeholder="搜索歌曲、歌单、歌手" aria-label="搜索"></div>' +
    '<span class="sp"></span>' +
    '<button class="wyy-ghost" id="tune-btn">取色面板</button>' +
    '<button class="wyy-icon" id="theme-btn" title="切换主题"></button>'

  /* 评审用的确定性入口：?theme=dark&view=playlist&np=1&pl=<id>
     避免靠点击链路复现状态（截图脚本里一次 MISS 就会让后续全错） */
  var Q = new URLSearchParams(location.search)
  if (Q.get('theme') === 'dark') {
    state.theme = 'dark'
    document.body.toggleAttribute('data-ds-dark-theme', true)
    shell.setAttribute('data-theme', 'dark')
  }
  if (Q.get('view') && views[Q.get('view')]) state.view = Q.get('view')
  if (Q.get('pl')) state.pl = Q.get('pl')
  if (Q.get('np') === '1') state.np = true
  if (Q.get('tune') === '1') state.tune = true
  if (Q.get('i')) state.lyricIdx = Number(Q.get('i')) || 0

  await render()
  if (Q.get('pl')) {
    var d = DATA.details[Q.get('pl')]
    if (d && d.songs[0]) state.play = true
    renderBar(); renderNp()
  }
  window.__protoReady = true
})()
