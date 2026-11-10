# B站观看统计

一个只看本机的浏览器扩展：记录你**今天 / 本周 / 本月**在 B 站网页端看了多少个视频、看了多久，并在工具栏图标上显示今日数量。

> 数据全部存在浏览器本地（`chrome.storage.local`），不联网、不上传、不需要登录。

## 功能

- **今日 / 本周 / 本月**视频数量与观看时长
- **最近 7 天**柱状图，今天高亮
- **今日片单**：按最近观看排序，显示每个视频的观看时长
- 工具栏角标实时显示今日个数
- 可选「重复观看也计数」：默认同一视频一天只算 1 个
- 一键清空数据

## 安装（Chrome / Edge 等 Chromium 浏览器）

1. 打开扩展管理页：
   - Chrome：地址栏输入 `chrome://extensions`
   - Edge：地址栏输入 `edge://extensions`
2. 打开右上角（Edge 在左下角）的「开发者模式 / 开发人员模式」
3. 点击「加载已解压的扩展程序 / 加载解压缩的扩展」
4. 选择本文件夹 `bilibili-watch-counter`
5. 建议把扩展固定到工具栏，方便查看今日数量

安装后**刷新已经打开的 B 站页面**（内容脚本只在新加载的页面里生效），然后随便看一个视频试试。

## 计数规则

| 规则 | 说明 |
| --- | --- |
| 什么算“看了一个视频” | 在视频页真正播放累计满 **5 秒**（可在 `background.js` 顶部调整默认阈值） |
| 哪些页面会统计 | `/video/BV…`、`/video/av…`、`/bangumi/play/…`、`/cheese/play/…`、`/list/…`、`/medialist/play/…`、`/festival/…` |
| 哪些页面不计 | 首页信息流、动态、空间、直播间、广告和预览小窗 |
| 同一视频重复看 | 默认同一天只计 1 次；打开「重复观看也计数」后每次观看都计 |
| 跨天 | 本地时间 0 点自动进入新的一天；同一视频第二天再看会重新计数 |
| 观看时长 | 只累计真正在播放的时间；暂停、拖动进度条不计，按倍速折算为真实时间 |
| 本周 | 周一 00:00 起算（不是最近 7 天）；「最近 7 天」图表才是滚动 7 天 |
| 数据保留 | 最近 500 天；60 天前的记录只保留数量与时长，不再保留视频标题 |

只有播放中的 `<video>` 才会被采样，页面里其他自动播放的广告/预览不会误计数。

## 数据与隐私

- 记录内容：日期、视频 ID（BV 号 / ep 号）、标题、每个视频的观看秒数
- 存储位置：浏览器扩展的 `chrome.storage.local`，仅本机可读
- 无网络请求、无账号、无第三方 SDK
- 清除方式：弹窗里的「清空数据」，或在扩展管理页移除扩展
- 无痕 / 隐私模式下默认不加载扩展

## 文件结构

```
bilibili-watch-counter/
├─ manifest.json      # Manifest V3 配置
├─ background.js      # Service Worker：唯一的数据写入方、角标刷新
├─ content.js         # 内容脚本：采样 <video> 播放进度并上报
├─ core.js            # 共享核心：日期汇总、计数、会话采样（可单测）
├─ popup.html/css/js  # 弹窗界面
├─ icons/             # 16/32/48/128 图标
└─ dev/               # 开发用：图标生成、预览、单元测试（打包时排除）
    ├─ make_icons.py
    ├─ make_preview.py
    ├─ mock-chrome.js
    ├─ core.test.js
    ├─ content.test.js
    ├─ background.test.js
    └─ popup.test.js
```

## 开发与测试

需要 Node.js 18+：

```bash
node dev/core.test.js        # 核心逻辑：20 条
node dev/content.test.js     # 内容脚本集成：8 条
node dev/background.test.js  # 后台消息与存储：11 条
node dev/popup.test.js       # 弹窗渲染与交互：8 条
python dev/make_icons.py     # 重新生成图标（需要 Pillow）
python dev/make_preview.py
```

`dev/popup-preview.html` 可以直接用浏览器打开，查看带示例数据的弹窗界面（注入了 `chrome` API 桩，不需要安装扩展）。

## 已知限制

- 只支持 Chromium 内核浏览器（Chrome、Edge、Brave、Arc 等）。Firefox 需要把 `background.service_worker` 改为事件页，未做适配。
- 只统计网页端，B 站手机 App、桌面客户端不计入。
- 暂停超过阈值后再继续播放，会继续累计同一会话的秒数，但不会重复计数。
- 浏览器清理“Cookie 及其他网站数据”时，扩展存储可能一并被清除。

## 自定义

- **改计数阈值**：`content.js` / `background.js` 的 `DEFAULT_SETTINGS.minSeconds`（默认 5 秒）
- **改保留天数**：`background.js` 的 `KEEP_DAYS`（默认 500）
- **改配色**：`popup.css` 顶部的 `--pink` / `--purple`
