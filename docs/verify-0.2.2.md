# 0.2.2 真机验收（内核 0.2.1-rc.2 / Desktop 44.7.0，2026-10-19）

本文件是「适配最新内核」的**证据页**：每条结论都能用仓库里的脚本复跑，截图是内核自己吐出来的页面（不是原型图）。

## 怎么复跑

需要一份**解出来的内核树**（`DSH_KERNEL_DIR`，默认 `D:/workspace/_dsh_kernel/dsh`）：

```sh
# 1) 从已安装的 Desktop 解出内核（app.asar 是 Electron 归档，纯 node 读不了）
npx @electron/asar extract "<安装目录>/resources/app.asar" ./_dsh_kernel_raw
# 2) 把 resources/app.asar.unpacked/dsh/* 覆盖进去（原生模块 node-pty / @img / koffi …）
# 3) 跑三条腿
node scripts/probe-boot.mjs            # 浏览器半边（自建隔离 home + junction + 真 Edge）
node scripts/probe-host-routes.mjs http://127.0.0.1:55904 --search-param=q   # 宿主路由（需先起内核）
node scripts/i18n-check.mjs            # 静态守卫
```

> 桌面 profile 由 Electron 独占（CLI 会拒 `--profile desktop`），所以真机腿都用**同 bundle 列表的另一个 profile 名**跑，
> 隔离 `DSH_HOME`，不碰真实安装。

## 结果

| 腿 | 结果 | 关键证据 |
| --- | --- | --- |
| `probe-boot.mjs` | **7/7 PASS** | 启动图含 `dsh-wyymusic`；侧栏「网易云音乐」在「插件」之上；点击后 `.wyy-page` 接管 main 槽；console error / 未捕获异常 / 4xx·5xx 全 0 |
| `probe-host-routes.mjs` | **12/12 PASS** | 登录态、搜索、榜单 64 个、歌单 28 个、歌词、无损取链、`Range` 206（1024B / 56MB 总长）、prefs GET+POST、404 兜底 |
| `i18n-check.mjs` | 通过 | STR 152 条，表外中文字面量 0 |
| 桌面组合启动 | 通过 | `dsh-base`+web-app+agent-team+auto-review+voice-input+ds-bot+vibe-island+inspector+better-sidebar+cover-pipeline+`dsh-wyymusic` 同列表启动成功，`/wyymusic/api/status` 200 |

## 截图（真内核 + 真 Edge，登录态真实数据）

```
docs/shots/0.2.2-boot.png        加载完成：侧栏最上面就是「网易云音乐」，下面才是「插件」
docs/shots/0.2.2-panel.png       点击后：主区域被播放界面整块接管（发现 / 每日推荐 / 推荐歌单）
docs/shots/0.2.2-roundtrip.png   切到「插件」再切回来：面板重建、数据正常、不报错
```

![启动后侧栏入口](shots/0.2.2-boot.png)

![全屏接管主区域](shots/0.2.2-panel.png)

![往返切换后仍正常](shots/0.2.2-roundtrip.png)
