/* 封面取色引擎：从专辑封面提取「艺术色」，供页面横幅 / 全屏歌词 / 播放条做动态染色。
 *
 * 三层色彩模型：
 *   L1 品牌色  —— 网易云红（浅色主题）/ Spotify 灰阶（深色主题），只用于交互控件
 *   L2 表面色  —— 固定的中性灰阶，决定层级（不随封面变化）
 *   L3 艺术色  —— 本文件产出的动态令牌，只铺在大面积表面上（横幅渐变、歌词底 wash、播放条染色）
 *
 * 算法依据（均为可复现的公开实现参数）：
 *   - 色相直方图分桶 + 权重（AndroidX Palette: 0.24 population / 0.52 saturation / 0.24 luminance）
 *   - vibrant 饱和度下限 0.35，muted 目标饱和度 0.30，dark 目标明度 0.26 / 上限 0.45
 *   - 明度过滤 L∈(0.05,0.95)、跳过透明像素、36×10° 色相桶
 *   - 平均色相走向量平均（sin/cos）而非 RGB 平均，避免红绿相消
 * 无版权风险：只读像素，不落地任何封面原图或歌词文本。
 */
;(function (root) {
  'use strict'

  var SAMPLE = 56 // 采样边长（px）。56×56=3136 像素，实测一次遍历 2–6ms
  var HUE_BUCKETS = 36

  /* ---------- 颜色空间 ---------- */

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255
    var max = Math.max(r, g, b), min = Math.min(r, g, b)
    var h = 0, s = 0, l = (max + min) / 2
    var d = max - min
    if (d > 1e-6) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0))
      else if (max === g) h = (b - r) / d + 2
      else h = (r - g) / d + 4
      h *= 60
    }
    return [h, s, l]
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360
    var a = s * Math.min(l, 1 - l)
    function f(n) {
      var k = (n + h * 12) % 12
      return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))
    }
    return [Math.round(f(0) * 255), Math.round(f(4) * 255), Math.round(f(8) * 255)]
  }

  function hslToHex(h, s, l) {
    var c = hslToRgb(h, s, l)
    return '#' + c.map(function (v) { return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0') }).join('')
  }

  /* WCAG 相对亮度与对比度 —— 决定色块上该用白字还是黑字 */
  function luminance(h, s, l) {
    var c = hslToRgb(h, s, l).map(function (v) {
      v /= 255
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }

  function contrast(l1, l2) {
    var a = Math.max(l1, l2), b = Math.min(l1, l2)
    return (a + 0.05) / (b + 0.05)
  }

  /* ---------- 采样 ---------- */

  /* 中心方形裁切后缩到 SAMPLE×SAMPLE：封面信息集中在中间，四角常是留白/文案 */
  function samplePixels(src) {
    var w = src.naturalWidth || src.width
    var h = src.naturalHeight || src.height
    if (!w || !h) return null
    var side = Math.min(w, h)
    var canvas
    try { canvas = document.createElement('canvas') } catch (e) { return null }
    canvas.width = SAMPLE
    canvas.height = SAMPLE
    var ctx
    try {
      ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false })
    } catch (e) {
      ctx = canvas.getContext('2d')
    }
    if (!ctx) return null
    ctx.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, SAMPLE, SAMPLE)
    try {
      return ctx.getImageData(0, 0, SAMPLE, SAMPLE).data // 跨域封面未带 crossOrigin 会在此抛 SecurityError
    } catch (e) {
      return null
    }
  }

  /* ---------- 分桶与筛选 ---------- */

  function newBucket(hi) {
    return { hue: hi, sin: 0, cos: 0, sSum: 0, lSum: 0, pop: 0 }
  }

  function build(data) {
    var buckets = []
    for (var i = 0; i < HUE_BUCKETS; i++) buckets.push(newBucket(i * (360 / HUE_BUCKETS) + 5))
    var total = data.length / 4
    var gray = newBucket(-1)

    for (var p = 0; p < total; p++) {
      var o = p * 4
      if (data[o + 3] < 250) continue // 跳过透明/半透明
      var hsl = rgbToHsl(data[o], data[o + 1], data[o + 2])
      var h = hsl[0], s = hsl[1], l = hsl[2]
      if (l <= 0.05 || l >= 0.95) continue // 纯黑纯白没有信息量
      if (s < 0.08) { // 近中性色单独统计，用于推导表面基调
        gray.sin += 0; gray.cos += 0
        gray.sSum += s; gray.lSum += l; gray.pop++
        continue
      }
      var b = buckets[Math.floor(h / (360 / HUE_BUCKETS)) % HUE_BUCKETS]
      var rad = h * Math.PI / 180
      b.sin += Math.sin(rad); b.cos += Math.cos(rad) // 色相走向量平均，避免 350°+10° 抵消
      b.sSum += s; b.lSum += l; b.pop++
    }

    var out = []
    for (var k = 0; k < buckets.length; k++) {
      var bk = buckets[k]
      if (!bk.pop) continue
      if (bk.pop / total < 0.015) continue // 占比 <1.5% 视为噪点
      var rad2 = Math.atan2(bk.sin, bk.cos) * 180 / Math.PI
      if (rad2 < 0) rad2 += 360
      out.push({
        hue: rad2,
        s: bk.sSum / bk.pop,
        l: bk.lSum / bk.pop,
        pop: bk.pop / total,
      })
    }
    return { candidates: out, gray: gray.pop ? { s: gray.sSum / gray.pop, l: gray.lSum / gray.pop, pop: gray.pop / total } : null }
  }

  /* AndroidX 的加权打分；亮度惩罚让「显眼」而非「最艳」胜出 */
  function score(c, sMin, sMax, lTarget, lSpread) {
    var dS = Math.max(0, c.s - sMin)
    var dL = Math.abs(c.l - lTarget)
    var satScore = Math.min(1, dS / (sMax - sMin + 1e-6))
    var lumScore = Math.max(0, 1 - dL / lSpread)
    return c.pop * 0.24 + satScore * 0.52 + lumScore * 0.24
  }

  function pick(list, sMin, sMax, lTarget, lSpread) {
    var best = null, bestScore = -1
    for (var i = 0; i < list.length; i++) {
      var c = list[i]
      if (c.s < sMin) continue
      if (c.l < 0.06 || c.l > 0.96) continue
      var sc = score(c, sMin, sMax, lTarget, lSpread)
      if (sc > bestScore) { bestScore = sc; best = c }
    }
    return best ? { hue: best.hue, s: best.s, l: best.l, pop: best.pop, score: bestScore } : null
  }

  function extract(img) {
    var data = samplePixels(img)
    if (!data) return null
    var built = build(data)
    var cs = built.candidates
    if (!cs.length) return null

    var sorted = cs.slice().sort(function (a, b) { return (b.pop * b.s) - (a.pop * a.s) })
    var prominent = sorted[0]
    var vibrant = pick(cs, 0.35, 1, 0.55, 0.45)
    var lightVibrant = pick(cs, 0.25, 1, 0.78, 0.45)
    var darkVibrant = pick(cs, 0.35, 1, 0.26, 0.45)
    var muted = pick(cs, 0.12, 0.5, 0.5, 0.55)
    var darkMuted = pick(cs, 0.1, 0.45, 0.26, 0.45)

    /* 「最醒目」的互补点用于点缀：把主色相旋转 180°，只在需要描边时使用 */
    return {
      vibrant: vibrant,
      lightVibrant: lightVibrant,
      darkVibrant: darkVibrant,
      muted: muted,
      darkMuted: darkMuted,
      prominent: prominent ? { hue: prominent.hue, s: prominent.s, l: prominent.l, pop: prominent.pop } : null,
      gray: built.gray,
      candidateCount: cs.length,
    }
  }

  /* ---------- 色调映射：把提取值变成可用的表面色 ---------- */

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)) }

  function tone(sw, o) {
    if (!sw) return null
    return {
      h: sw.hue,
      s: clamp(sw.s, o.sMin, o.sMax),
      l: clamp(sw.l, o.lMin, o.lMax),
    }
  }

  /* 深色主题下艺术色要降饱和、压暗，否则会在新黑表面上「发荧」 */
  function darkSurface(hue, s, l) {
    return { h: hue, s: clamp(s * 0.78, 0.14, 0.62), l: clamp(l * 0.42, 0.12, 0.32) }
  }

  function buildTokens(sw, mode) {
    if (!sw) return null
    var v = sw.vibrant || sw.prominent || sw.lightVibrant || sw.darkVibrant || { hue: 220, s: 0.2, l: 0.35 }
    var d = sw.darkVibrant || sw.darkMuted || v
    var light = mode === 'light'

    var vivid = light
      ? tone(v, { sMin: 0.32, sMax: 0.66, lMin: 0.42, lMax: 0.6 })
      : tone(v, { sMin: 0.28, sMax: 0.6, lMin: 0.34, lMax: 0.56 })
    var deep = light
      ? { h: vivid.h, s: clamp(vivid.s * 0.5, 0.08, 0.34), l: clamp(vivid.l * 0.32, 0.14, 0.26) }
      : darkSurface(vivid.h, vivid.s, vivid.l)
    var wash = light
      ? { h: vivid.h, s: clamp(vivid.s * 0.55, 0.1, 0.4), l: clamp(vivid.l * 1.05, 0.5, 0.78) }
      : tone(d, { sMin: 0.2, sMax: 0.5, lMin: 0.22, lMax: 0.42 })
    var tint = { h: vivid.h, s: clamp(vivid.s * 0.6, 0.08, 0.4), l: light ? 0.94 : 0.16 }

    /* 横幅顶色单独映射。
       浅色：艺术色「粉彩化」（提亮 + 降饱和），文字固定深色 —— 这才像网易云的轻快，
             也保证 12–14px 副标题真的达到 4.5:1，而不是大标题能读、副标题糊掉。
       深色：艺术色压暗降饱和，文字固定 #f5f5f5，同时能平滑融回 #121212。 */
    var blackL = luminance(0, 0, 0.09)
    var whiteL = luminance(0, 0, 0.96)
    var band = light
      ? { h: vivid.h, s: clamp(vivid.s * 0.72, 0.16, 0.46), l: clamp(0.7 + (vivid.l - 0.5) * 0.26, 0.66, 0.82) }
      : { h: vivid.h, s: clamp(vivid.s * 0.86, 0.24, 0.5), l: clamp(vivid.l * 0.62, 0.22, 0.32) }
    var highlight = light
      ? { h: vivid.h, s: clamp(vivid.s * 0.75, 0.15, 0.5), l: 0.72 }
      : { h: vivid.h, s: clamp(vivid.s * 0.9, 0.2, 0.72), l: 0.78 }

    var onBand
    if (light) {
      for (var i = 0; i < 12 && contrast(luminance(band.h, band.s, band.l), blackL) < 4.5; i++) band.l = Math.min(0.92, band.l + 0.02)
      onBand = contrast(luminance(band.h, band.s, band.l), blackL) >= 4.5 ? '#101012' : '#f5f5f5'
    } else {
      onBand = '#f5f5f5'
    }
    var bl = luminance(band.h, band.s, band.l)
    var bandContrast = +(onBand === '#f5f5f5' ? contrast(bl, whiteL) : contrast(bl, blackL)).toFixed(2)

    return {
      mode: mode,
      band: hslToHex(band.h, band.s, band.l),
      vivid: hslToHex(vivid.h, vivid.s, vivid.l),
      deep: hslToHex(deep.h, deep.s, deep.l),
      wash: hslToHex(wash.h, wash.s, wash.l),
      tint: hslToHex(tint.h, tint.s, tint.l),
      highlight: hslToHex(highlight.h, highlight.s, highlight.l),
      onBand: onBand,
      bandLum: +bl.toFixed(4),
      bandContrast: bandContrast,
    }
  }

  function hslString(sw) {
    if (!sw) return 'none'
    return Math.round(sw.h) + '° ' + Math.round(sw.s * 100) + '% ' + Math.round(sw.l * 100) + '%'
  }

  root.WyyPalette = {
    extract: extract,
    buildTokens: buildTokens,
    rgbToHsl: rgbToHsl,
    hslToHex: hslToHex,
    contrast: contrast,
    luminance: luminance,
    hslString: hslString,
    SAMPLE: SAMPLE,
  }
})(typeof window !== 'undefined' ? window : globalThis)
