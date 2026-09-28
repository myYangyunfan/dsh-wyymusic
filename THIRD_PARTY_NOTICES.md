# 第三方代码声明

本项目为个人学习用途的 DeepSeek Harness 插件，其中「网易云 API 访问层」的若干文件
**直接移植**自开源项目，仍遵循其原始 MIT 许可。以下逐项列出出处与改动。

## 0. 本项目自身的许可

本项目自身代码（`lib/index.js`、`lib/client.js`、`scripts/`、`design/` 等）以
**Apache License 2.0** 开源：全文见根目录 `LICENSE`，版权归属见根目录 `NOTICE`。

Apache-2.0 允许在同一分发包中收录 MIT 代码，且**收录不改变被收录文件自身的许可**。
下表所列的移植文件不随本项目整体换证 —— 它们的 MIT 许可与版权声明原样保留
（`LICENSE.dsh-music-player.txt`、`lib/vendor/qrcode.mjs` 文件头的许可注释），
这些文件里也不含本项目新增的 Apache-2.0 授权声明。

---

## 1. dsh-music-player

- 来源：`dsh-music-player@1.0.3`（npm）
- 上游仓库：https://github.com/kendu76/dsh-music-player
- 许可证：MIT License，Copyright (c) 2026 kendu76
- 许可全文：见本目录 `LICENSE.dsh-music-player.txt`
- 移植时被下游产物改写的上游文件（`package/lib/**`）：

| 本项目文件 | 上游文件 | 说明 |
| --- | --- | --- |
| `lib/netease.js` | `lib/netease.js` | 原样移植，**未改动**逻辑 |
| `lib/yrc.js` | `lib/yrc.js` | 原样移植，**未改动**逻辑 |
| `lib/fetch-limit.js` | `lib/fetch-limit.js` | 原样移植，**未改动**逻辑 |
| `lib/vendor/qrcode.mjs` | `lib/vendor/qrcode.mjs` | 原样移植，**未改动** |

上游被**有意舍弃**未移植的部分（本插件不需要）：`lib/qq.js`、`lib/kugou.js`、
`lib/qrc.js`、`lib/krc.js`、`lib/lyric.js`、`lib/calendar.js`、`lib/hls.js`、
`lib/news-core.js`、`lib/radio.js`、`lib/whatsnew.js`、`lib/index.js`、`lib/client.js`。

本项目的宿主半边（`lib/index.js`）与客户端半边（`lib/client.js`）**为新写**，
未复制上游同名文件（两者同名但内容不同：上游是音乐播放器 + 小说 + TTS 的复合体，
本项目是聚焦网易云音乐的独立 GUI）。

---

## 2. qrcode-generator（经上上游）

`lib/vendor/qrcode.mjs` 本身是 dsh-music-player 内嵌的第三方库：

- QR Code Generator for JavaScript
- Copyright (c) 2009 Kazuhiko Arase
- URL: http://www.d-project.com/
- 许可证：MIT License

「QR Code」是 DENSO WAVE INCORPORATED 的注册商标。

---

## 合规提示

- Apache-2.0 只覆盖**本项目的代码**，不覆盖经本插件访问的音乐、歌词、封面等内容 ——
  那些内容的权利仍属原权利人，换证不构成对它们的任何授权。
- 本项目调用的均为网易云音乐**非官方接口**，且播放内容受著作权保护，
  仅供个人试听 / 学习使用。使用行为可能违反平台服务条款，风险由使用者自行承担。
- **严禁**使用本项目进行「解灰」或任何绕过版权限制的操作。
- 登录态 Cookie 为敏感凭据，本插件将其保存在本机 `$DSH_HOME/wyymusic/cookie.json`
  （默认 `~/.dsh/`，文件 mode `0600`）下，不会上传到任何第三方服务。
