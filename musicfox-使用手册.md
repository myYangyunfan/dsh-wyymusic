# musicfox 使用手册（本机实测版）

> 命令行版网易云音乐（go-musicfox）。本文档基于本机实际安装的版本从源码提取，非网络转载。
>
> - **版本**：`v5.0.0-dev.12169a71098f`
> - **可执行文件**：`C:\Users\delinger\go\bin\musicfox.exe`
> - **源码树**：`C:\Users\delinger\go\src\go-musicfox`（可重新编译）
> - **构建参数**：`-tags "enable_global_hotkey,purego"`，入口 `./cmd`

---

## 一、安装与运行环境

| 项 | 值 |
|---|---|
| 调用命令 | `musicfox`（已在 PATH 中） |
| 编译工具链 | Go 1.26.5 + MinGW-W64 gcc 13.2.0（CGO 启用） |
| 播放引擎 | `win_media`（Windows Media Foundation，**系统原生**） |
| 外部依赖 | **无需 mpv / ffmpeg**（默认引擎是系统自带的） |

### 终端要求（重要）

- **不要用 CMD（命令提示符）**，上游明确不对其做兼容。推荐 **Windows Terminal**。
- 必须使用**等宽字体**，否则双列排版会乱；或把 `doubleColumn` 设为 `false`。
- 若出现莫名其妙的光标移动、切歌、暂停，把 `enableMouseEvent` 设为 `false`。

---

## 二、文件与目录

本机实际路径（由 XDG 规范解析，已实测）：

| 用途 | 路径 |
|---|---|
| 配置 | `%LOCALAPPDATA%\go-musicfox\config.toml` |
| **登录 Cookie** | `%LOCALAPPDATA%\go-musicfox\cookie` |
| 数据库（歌单/播放状态） | `%LOCALAPPDATA%\go-musicfox\db\musicfox.db` |
| 日志 | `%LOCALAPPDATA%\go-musicfox\log\musicfox.log` |
| 自定义主题 | `%LOCALAPPDATA%\go-musicfox\themes\*.toml` |

> 注意：上游 README 写的是 `%AppData%\go-musicfox\`，**本机实测是 `%LOCALAPPDATA%`**。以实测为准。

### 环境变量

| 变量 | 作用 |
|---|---|
| `MUSICFOX_ROOT` | 重设根目录，下载默认变为 `$MUSICFOX_ROOT/download`，缓存变 `$MUSICFOX_ROOT/cache` |
| `MUSICFOX_COOKIE` | **直接传入 Cookie 字符串**（如 `MUSIC_U=xxx; __csrf=yyy`），免扫码登录 |
| `MUSICFOX_INTERNAL_CHILD` | 内部使用（崩溃恢复的子进程标记），不要手动设置 |

**登录优先级**：已有 cookie 文件 → `MUSICFOX_COOKIE` 环境变量 → `config.toml` 的 `neteaseCookie` → 交互式登录。

---

## 三、命令行调用方式

### 全局选项

```
musicfox [全局选项] {子命令} [--选项] [参数]
```

| 选项 | 简写 | 说明 |
|---|---|---|
| `--debug` | | 开启 debug 日志级别 |
| `--help` | `-h` | 显示帮助 |
| `--no-color` | | 关闭彩色输出 |
| `--no-interactive` | | 关闭交互式确认操作 |
| `--no-progress` | | 关闭进度显示 |
| `--pprof` | `-p` | 开启 PProf 性能分析（端口见 `main.pprof.port`，默认 9876） |
| `--pure` | | 用临时目录中的默认配置启动（不读用户配置，适合排障） |
| `--verbose` | | 错误报告级别 quiet 0 - 4 debug，默认 1 |
| `--version` | `-V` | 显示版本 |

### 子命令

| 子命令 | 说明 | 参数 |
|---|---|---|
| `netease` | **主命令**：启动 TUI 播放器 | 无 |
| `config` | 打印配置信息 | 无 |
| `reset` | 清除所有缓存文件（默认不含配置文件） | `--with-config-file` 连 `config.toml` 一起删 |
| `upgrade-config` | 把新版内置配置项追加进现有配置文件 | 无 |
| `notify` | 发送测试通知（**仅 macOS**） | 无 |
| `help` | 显示帮助 | 无 |

### 实例

```bash
# 启动播放器（日常用法）
musicfox

# 用临时配置启动，排查配置问题
musicfox --pure netease

# 看版本
musicfox --version

# 清缓存但保留配置
musicfox reset

# 升级配置：软件更新后把新增配置项补进 config.toml
musicfox upgrade-config

# 免扫码登录（先用别的方式抓到 cookie 字符串）
MUSICFOX_COOKIE="MUSIC_U=xxx; __csrf=yyy" musicfox netease
```

---

## 四、主菜单功能结构

启动 `musicfox` 后进入 TUI，主菜单 16 项：

| # | 菜单项 | 说明 |
|---|---|---|
| 1 | 每日推荐歌曲 | 按账号推荐 |
| 2 | 每日推荐歌单 | |
| 3 | 我的歌单 | 含创建/收藏的歌单 |
| 4 | 我的收藏 | 专辑 / 歌手 / 歌单订阅 |
| 5 | 私人 FM | |
| 6 | 专辑列表 | 含新碟、分类、榜单 |
| 7 | 搜索 | 单曲 / 专辑 / 歌手 / 歌单 / 电台等分类搜索 |
| 8 | 排行榜 | |
| 9 | 精选歌单 | |
| 10 | 热门歌手 | |
| 11 | 最近播放歌曲 | |
| 12 | 云盘 | |
| 13 | 主播电台 | 分类、榜单、推荐、订阅 |
| 14 | LastFM | 需自备 API key |
| 15 | 帮助 | 弹窗显示帮助 |
| 16 | 检查更新 | 异步检查并 TUI 提示 |

菜单标题右侧会显示 `[未登录]` 或 `[你的昵称]`。

---

## 五、快捷键大全

### 5.1 内置操作（**不可自定义**，由 foxful-cli 管理）

| 按键 | 功能 |
|---|---|
| `j` `J` `↓` | 下 |
| `k` `K` `↑` | 上 |
| `h` `H` `←` | 左 |
| `l` `L` `→` | 右 |
| `g` | 移到顶部 |
| `G` | 移到底部 |
| `n` `N` `Enter` | 进入 |
| `b` `B` `Esc` | 返回上一级 |
| `/` `／` `、` | 搜索当前列表 |
| `q` `Q` | 退出 |
| `r` `R` | 重新渲染 UI |

### 5.2 可自定义操作（下表为默认绑定）

**播放控制**

| 功能名 | 默认按键 | 说明 |
|---|---|---|
| `playOrToggle` | `空格` | 播放/暂停 |
| `toggle` | *（未绑定）* | 切换播放状态 |
| `previous` | `[` `【` | 上一首 |
| `next` | `]` `】` | 下一首 |
| `backwardFiveSec` | `X` | 快退 5 秒 |
| `backwardOneSec` | `x` | 快退 1 秒 |
| `forwardFiveSec` | `v` | 快进 5 秒 |
| `forwardTenSec` | `V` | 快进 10 秒 |
| `downVolume` | `-` `−` `ー` | 减小音量 |
| `upVolume` | `=` `＝` | 加大音量 |
| `switchPlayMode` | `p` | 切换播放模式 |
| `intelligence` | `P` | 心动模式 |

**界面**

| 功能名 | 默认按键 | 说明 |
|---|---|---|
| `help` | `?` `？` | 帮助信息 |
| `pageUp` | `Ctrl+u` `PageUp` | 上一页 |
| `pageDown` | `Ctrl+d` `PageDown` | 下一页 |
| `curPlaylist` | `c` `C` | 显示当前播放列表 |
| `switchTheme` | *（未绑定）* | 切换主题样式 |
| `toggleSortOrder` | `\|` | 切换排序顺序 |
| `clearSongCache` | `u` `U` | 清除音乐缓存 |
| `logout` | `W` | 注销并退出 |

**对「正在播放」的歌曲操作**

| 功能名 | 默认按键 | 说明 |
|---|---|---|
| `likePlayingSong` | `,` `，` | 喜欢 |
| `dislikePlayingSong` | `.` `。` | 取消喜欢 |
| `trashPlayingSong` | `t` | 标记为不喜欢 |
| `addPlayingSongToUserPlaylist` | `` ` `` | 加入歌单 |
| `removePlayingSongFromUserPlaylist` | `~` `～` | 从歌单中删除 |
| `downloadPlayingSong` | `d` | 下载歌曲 |
| `downloadPlayingSongLrc` | `Ctrl+l` | 下载歌词 |
| `openAlbumOfPlayingSong` | `a` | 所属专辑 |
| `openArtistOfPlayingSong` | `s` | 所属歌手 |
| `openPlayingSongInWeb` | `o` | 网页打开 |
| `simiSongsOfPlayingSong` | `f` | 相似歌曲 |
| `sharePlayingItem` | *（未绑定）* | 分享当前播放 |
| `actionOfPlayingSong` | `M` | 打开操作菜单 |

**对「选中项」的操作**

| 功能名 | 默认按键 | 说明 |
|---|---|---|
| `likeSelectedSong` | `<` `〈` `＜` `《` `«` | 喜欢 |
| `dislikeSelectedSong` | `>` `〉` `＞` `》` `»` | 取消喜欢 |
| `trashSelectedSong` | `T` | 标记为不喜欢 |
| `addSelectedSongToUserPlaylist` | `Tab` | 加入歌单 |
| `removeSelectedSongFromUserPlaylist` | `Shift+Tab` | 从歌单中删除 |
| `downloadSelectedSong` | `D` | 下载歌曲 |
| `downloadSelectedSongLrc` | *（未绑定）* | 下载歌词 |
| `openAlbumOfSelectedSong` | `A` | 所属专辑 |
| `openArtistOfSelectedSong` | `S` | 所属歌手 |
| `openSelectedItemInWeb` | `O` | 网页打开 |
| `simiSongsOfSelectedSong` | `F` | 相似歌曲 |
| `shareSelectItem` | *（未绑定）* | 分享当前选中 |
| `actionOfSelected` | `m` | 打开操作菜单 |

**播放列表管理**

| 功能名 | 默认按键 | 说明 |
|---|---|---|
| `appendSongsToNext` | `e` | 添加为下一曲播放 |
| `appendSongsAfterCurPlaylist` | `E` | 添加到播放列表末尾 |
| `delSongFromCurPlaylist` | `\` `、` | 从播放列表删除选中歌曲 |

**歌单 / 专辑 / 歌手收藏**

| 功能名 | 默认按键 | 说明 |
|---|---|---|
| `collectSelectedPlaylist` | `;` `:` `：` `；` | 收藏选中歌单 |
| `discollectSelectedPlaylist` | `'` `"` | 取消收藏选中歌单 |
| `subscribeAlbumOfPlayingSong` | *（未绑定）* | 收藏播放中歌曲的专辑 |
| `unsubscribeAlbumOfPlayingSong` | *（未绑定）* | 取消收藏 |
| `subscribeArtistOfPlayingSong` | *（未绑定）* | 收藏播放中歌曲的歌手 |
| `unsubscribeArtistOfPlayingSong` | *（未绑定）* | 取消收藏 |
| `subscribeAlbumOfSelectedSong` | *（未绑定）* | 收藏选中歌曲的专辑 |
| `unsubscribeAlbumOfSelectedSong` | *（未绑定）* | 取消收藏 |
| `subscribeArtistOfSelectedSong` | *（未绑定）* | 收藏选中歌曲的歌手 |
| `unsubscribeArtistOfSelectedSong` | *（未绑定）* | 取消收藏 |

> 中文全角标点在快捷键映射里大多有对应（如 `，`→`,`、`《`→`<`），方便中文输入法下直接按。

### 5.3 自定义快捷键

配置文件 `[keybindings]` 段：

```toml
[keybindings]
# true = 以内置默认为基础；false = 只用你在下面定义的
useDefaultKeyBindings = true

# 全局快捷键：应用在后台也能响应
[keybindings.global]
"ctrl+shift+space" = "toggle"

# 应用内快捷键：功能名 = [按键...]，空数组 = 解绑
[keybindings.app]
switchTheme = ["t"]        # 给未绑定的功能加键
next = ["]", "】", "ctrl+n"]  # 覆盖默认
clearSongCache = []        # 解绑
```

规则：
- **内置操作**（`j/k/h/l/g/G/n/b//q/r` 那批，功能名 `moveUp`/`enter`/`goBack`/`search` 等）**不允许覆盖**，配了会被忽略并打 warning。
- 用户绑定与默认冲突时，**用户优先**，默认绑定里那个键会被移除，并记录一条 warning。
- 多字符键名统一小写（`PageUp`→`pgup`），空格写 `space`。

---

## 六、配置文件详解

完整路径：`%LOCALAPPDATA%\go-musicfox\config.toml`（TOML 格式，约 16 KB）。

### `[startup]` 启动页

| 项 | 默认 | 说明 |
|---|---|---|
| `enable` | `true` | 是否显示启动页 |
| `progressOutBounce` | `true` | 进度条回弹效果 |
| `loadingSeconds` | `2` | 启动页时长（秒） |
| `welcome` | `"musicfox"` | 欢迎语 |
| `animation` | `"sequence"` | 动画：`sequence` / `fade-in` / `rainbow-wave` / `typewriter` / `spinner` / `slide-in` / `glitch` / `matrix-rain` / `particle-burst` |
| `reducedMotion` | `false` | 停用动画 |
| `signIn` | `false` | 启动自动签到（**网易云有风控，建议保持关闭**） |
| `checkUpdate` | `true` | 启动检查更新 |

### `[main]` 主界面

| 项 | 默认 | 说明 |
|---|---|---|
| `altScreen` | `true` | 备用屏显示模式 |
| `enableMouseEvent` | `true` | 鼠标事件（乱跳就关掉） |
| `debug` | `false` | 封面写入等调试日志 |
| `frameRate` | `5` | UI 刷新帧率，调高更平滑但更耗 CPU |
| `locale` | `"zh"` | 界面语言 |

### `[main.visualizer]` 实时频谱

仅 `osx` / `beep` 引擎支持（**Windows 的 `win_media` 不支持**）。样式可选 `bar` / `line` / `mirror_bar` / `dot` / `oscilloscope` / `vectorscope` / `spectrogram`，还有一堆细粒度字符和后处理参数（`monstercat`、`waves`、`overshoot`、`spectrumLogScale` 等）。

### `[main.notification]` 通知

| 项 | 默认 | 说明 |
|---|---|---|
| `enable` | `true` | 桌面通知 |
| `icon` | `"logo.png"` | 默认通知图标 |
| `albumCover` | `false` | 用专辑封面当通知图标 |
| `inApp` | `true` | TUI 内原生 toast 通知 |
| `inAppTimeout` | `4` | toast 自动消失秒数 |

### `[main.lyric]` 歌词

| 项 | 默认 | 说明 |
|---|---|---|
| `show` | `true` | 显示歌词 |
| `showTranslation` | `true` | 显示翻译 |
| `offset` | `0` | 时间偏移（毫秒，正值提前） |
| `skipParseErr` | `false` | 忽略解析错误 |
| `renderMode` | `"smooth"` | 逐字歌词渲染：`simple` / `smooth` / `wave` / `glow` |

**`[main.lyric.cover]`** — 封面图，需 Kitty 图形协议终端（Kitty/WezTerm/Ghostty）：`show`、`widthRatio`、`cornerRadius`、`spin`、`spinFPS`、`spinDuration`、`tmuxPassthrough`。

**`[main.lyric.desktopLyrics]`** — 桌面歌词，**目前仅 macOS**。

### `[main.pprof]`

`port = 9876` — 配合 `--pprof` 使用。

### `[main.account]`

`neteaseCookie = ""` — 直接填 Cookie 字符串也能登录。

### `[theme]` 主题

| 项 | 默认 | 说明 |
|---|---|---|
| `activeTheme` | `"Default"` | 启动加载的主题名 |
| `showTitle` | `true` | 顶部标题 |
| `loadingText` | `"[加载中...]"` | 加载提示 |
| `doubleColumn` | `true` | 双列布局（需等宽字体） |
| `dynamicMenuRows` | `false` | 菜单行数随高度变化 |
| `maxTitleStartRow` | `12` | 标题区最大下移量，0 不限 |
| `centerEverything` | `false` | 全局居中（实验性） |
| `primaryColor` | `"#EA403F"` | 主色，可设 `"random"` |
| `statusBar` | `true` | 底部状态栏（面包屑+时间） |
| `accessibleMode` | `false` | 高对比度无障碍模式 |

**内置主题**：`Default`、`Transparent`、`Dark Transparent`、`Dracula`、`Nord`、`Gruvbox`

**自定义主题**：在 `%LOCALAPPDATA%\go-musicfox\themes\` 放 `.toml`，必须含 `name` 字段和 `[dark]` 或 `[light]` 表。

`[theme.progress]`：进度条渲染模式 `smooth`（默认）/ `wave` / `glow`，以及各段填充字符。

### `[storage]` 存储

| 项 | 默认 | 说明 |
|---|---|---|
| `downloadDir` | `""` | 下载目录（**绝对路径**），空则用系统下载目录下的 `go-musicfox` |
| `lyricDir` | `""` | 歌词目录，空则同 `downloadDir` |
| `downloadSongWithLyric` | `false` | 下载歌曲时一并下歌词 |
| `fileNameTpl` | *（注释掉）* | 文件名模板，字段见分享模板的 `song` 部分，`{{.FileExt}}` 为自适应后缀 |

**`[storage.cache]`**

| 项 | 默认 | 说明 |
|---|---|---|
| `dir` | `""` | 缓存目录 |
| `musicDir` | `"music_cache"` | 音乐缓存路径，相对 `dir` |
| `limit` | `0` | 总大小上限 MB。**`0` = 不用缓存，`-1` = 不限** |

### `[player]` 播放

| 项 | 默认 | 说明 |
|---|---|---|
| `engine` | `"auto"` | `beep` / `dlna` / `mpd` / `mpv` / `osx` / `win_media` / `auto`。**Mac 默认 `osx`，Windows 默认 `win_media`**，其他 `beep` |
| `maxPlayErrCount` | `3` | 最大连续失败重试 |
| `songLevel` | `"higher"` | 音质：`standard` / `exhigh` / `higher` / `lossless` / `hires` / `jyeffect`(高清环绕声) / `sky`(沉浸环绕声) / `jymaster`(超清母带) |
| `showAllSongsOfPlaylist` | `false` | 拉取歌单全部歌曲（默认前 1000 首，更耗内存和带宽） |
| `mouseVolumeStep` | `1` | Ctrl+滚轮单次音量步进（1-20） |

**`[player.beep]`**：`mp3Decoder`（`go-mp3` 稳 / `minimp3` 省 CPU）、`gapless`（无缝播放）、`gaplessPreloadSeconds`（默认 15）。
**`[player.mpd]`**：`bin`、`configFile`、`network`(`tcp`/`unix`)、`addr`、`autoStart`。
**`[player.mpv]`**：`bin`。
**`[player.dlna]`**：`deviceUrl`、`localIP`（投送到智能电视/音响等）。

### `[autoplay]` 启动自动播放

| 项 | 默认 | 说明 |
|---|---|---|
| `enable` | `false` | 启动后自动播放 |
| `playlist` | `"dailyReco"` | `dailyReco` / `like` / `no` / `name:歌单名`。`no` = 保持上次播放列表 |
| `offset` | `0` | 起始位置，`0` 第一首，`-1` 最后一首 |
| `mode` | `"last"` | `listLoop` / `order` / `singleLoop` / `random` / `intelligent` / `last` |

### `[unm]` 解锁灰色/无版权歌曲

基于 UnblockNeteaseMusic。

| 项 | 默认 | 说明 |
|---|---|---|
| `enable` | `false` | 是否启用 |
| `sources` | `["kuwo"]` | 音源：`kuwo` / `kugou` / `migu` / `qq`，可多个 |
| `searchLimit` | `0` | 搜索其他平台限制 0-3 |
| `enableLocalVip` | `true` | 解除会员限制 |
| `unlockSoundEffects` | `true` | 解除音质限制 |
| `qqCookieFile` | `""` | 获取 QQ 音源用的 Cookie 文件 |
| `skipInvalidTracks` | `false` | 遇到无效歌跳过（计入错误计数） |
| `proxyURL` | `""` | UNM 代理地址，配了会**禁用内置 unm** |

### `[reporter]` 播放状态上报

- `[reporter.netease]` `enable = false` — 上报「听歌排行」，**上游标注有风控风险**。
- `[reporter.lastfm]` — `enable`、`key`、`secret`（**本机构建未注入 key，此功能不可用**）、`scrobblePoint`（默认 50）、`onlyFirstArtist`、`skipDjRadio`。

### `[share]` 自定义分享模板

用 Go `text/template` 语法。字段分组：

| 分组 | 字段 |
|---|---|
| `Song` | `SongId` `SongName` `SongArtists` `SongUrl` |
| `Album` | `AlbumId` `AlbumName` `AlbumUrl` `AlbumArtists` |
| `Artist` | `ArtistId` `ArtistName` `ArtistUrl` |
| `Playlist` | `PlaylistId` `PlaylistName` `PlaylistUrl` |
| `User` | `UserID` `UserName` `UserUrl` |
| `DjRadio` | `DjRadioId` `DjRadioName` `DjRadioUrl` |
| `Episode` | `EpisodeId` `EpisodeName` `EpisodeUrl` |

播客节目同时拥有 `Episode`、`Song`、`Album` 三组的字段。

---

## 七、已知问题与本地补丁

### 本机构建打了 1 个上游补丁

**文件**：`internal/configs/theme_loader.go`

**问题**：上游在 Windows 上 6 个内置主题全部加载失败，每次启动刷 6 条 warning。根因是 `filepath.Join` 用于拼接 `embed.FS` 路径，在 Windows 生成反斜杠 `embed\themes\default.toml`，而 `io/fs` 规范要求正斜杠，导致查不到文件。

**修复**：`filepath.Join` → `path.Join`（1 行）。

**验证**：修复前每次启动 6 条 warning 加一条 fallback 提示；修复后新增 0 条，主题正常加载。

**注意**：官方 Windows 发行版同样有此 bug。想回到纯净上游，把这行改回来重新编译即可。

### Last.fm 不可用

官方发布版用 ldflags 注入 `LastfmKey`/`LastfmSecret`，本地构建未注入。启动时会记一条 error，不影响其他功能。要用需自备 Last.fm API key 并填入 `[reporter.lastfm]`。

### 其他

- `notify` 子命令**仅 macOS**，Windows 上无实际作用。
- 频谱可视化仅 `osx` / `beep` 引擎支持，**Windows 默认的 `win_media` 不支持**。
- 桌面歌词**仅 macOS**。
- `musicfox config` 需要真实 TTY 才能打印配置表格，重定向输出会得到终端查询序列。

---

## 八、重新编译

```bash
cd /c/Users/delinger/go/src/go-musicfox

GOPROXY="https://mirrors.cloud.tencent.com/go,direct" \
GOSUMDB="sum.golang.google.cn" \
go build -tags "enable_global_hotkey,purego" \
  -ldflags "-s -w -X github.com/go-musicfox/go-musicfox/internal/types.AppVersion=v5.0.0-dev.12169a71098f" \
  -o "$USERPROFILE/go/bin/musicfox.exe" ./cmd
```

- 用**腾讯云** Go 代理：阿里云 goproxy 对该模块返回的 zip 通不过官方 checksum 校验。
- 该模块 `go.mod` 含 `replace` 指令，**不能**用 `go install pkg@version`，必须当主模块编译。
- 源码树若重新从模块缓存复制，注意缓存文件只读，需 `chmod -R u+w`。
