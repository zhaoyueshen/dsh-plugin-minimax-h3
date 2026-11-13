# dsh-minimax-image

DeepSeek Harness 的侧边栏出图插件：在「出图」页面里写提示词，调用 MiniMax 图像 API 生成图片，结果直接落在本机磁盘上。

默认模型是 **`MiniMax-H3-Image`**，支持两条能力：

- **文生图** `POST /v1/images/generations`
- **图片编辑** `POST /v1/images/edits`（1–16 张参考图，用「图1」「图2」指代）

同时兼容上一代的 `image-01`（`POST /v1/image_generation`，仅文生图）——两套接口结构不同，插件内部按模型分派。

同时注册了 agent 工具 `minimax_image`（`images` 参数接收本机图片路径即走编辑），所以对话里说「把这张图改成……」也能走同一条链路。

## 界面

- 左侧菜单「出图」（`sidebar.panellist`，order 30，排在「备份」上方）
- 主区域面板（`main`，key 与侧边栏 id 一致：`dsh-minimax-image`）

面板包含：**文生图 / 图片编辑** 两个模式、提示词输入（Ctrl+Enter 生成）、示例提示词、参考图（拖拽 / 选择 / Ctrl+V 粘贴，最多 16 张，缩略图标注「图N」可单独移除）、比例选择（带比例预览方块）、清晰度档位（H3 专属：1K / 2K / 4K）、张数 1–10（步进器，H3 上限 10、上一代 9）、**构图护栏**开关、模型选择、生成进度、结果网格（点开大图 / 逐张「接着改」/ 复制路径 / 下载）、部分失败的警告条、最近生成历史（可编辑图片 / 复用提示词 / 删除）、设置面板（API key、站点、保存位置）。

### 构图护栏

打开后提交时会在提示词末尾追加一句正面构图指令：

> 构图要求：主体完整，四周留出适当留白，画面边缘不要切断主体。

它专治「主体/盘子贴边被裁掉」。**用户自己写的字不会被改写**：面板和历史里留的都是原话，后缀只在发请求时拼上，历史条目带 `guard` 标记（列表里显示「· 护栏」）。开关存在 `settings.json` 的 `guard` 字段，单独保存，不会连带改掉比例/张数。

单次请求也能覆盖：`/generate`、`/edit` 的请求体里带 `guard: true|false` 即可；agent 工具 `minimax_image` 也接受 `guard` 参数（不传就跟面板开关）。

为什么是正面指令而不是「盘子还是不完整」：抱怨式描述会被模型当成画面内容画出来，详见 `scripts/diagnose-plate.mjs` 的对照实验。

大图查看层右下角依次是 **保存图片**、**编辑图片**、**打开文件夹**、**关闭**：

- 保存图片：优先弹系统「另存为」对话框（`showSaveFilePicker`），运行时不支持则退回浏览器下载
- 打开文件夹：打开这张图**所在的目录**（`/open` 收到文件路径时自动取父目录），不是保存根目录
- 参考图自己的大图里只有「保存图片」——它还没落盘，没有目录可开

结果卡右上角有 **继续编辑**，大图里和历史记录里也有 **编辑图片**：点击后**先清空原有参考图**，再把这张读成 data URI 作为图1，并自动切到图片编辑模式，改完直接再提交就能迭代。参考图自己的大图里不显示这两个入口（它已经在框里了）。

多张结果时，每张小图的文件名右侧还有一个 ✦ 按钮（`把这张设为图1接着改`），直接挑任意一张接着改；标题栏的「继续编辑」固定取第 1 张。

编辑模式下比例与清晰度不显示：输出尺寸由参考图决定（实测 2720×1536 输入得到 5440×3072 输出）。

## 工作方式

| 层 | 文件 | 职责 |
|---|---|---|
| host | `index.js` + `lib/*` | 持有 key、调 MiniMax、写盘、注册路由与工具 |
| client | `client.js` | 只是表单和展示，通过 `fetch('/dsh-minimax-image/*')` 与 host 通信 |

浏览器端不碰 key，也不直接请求 MiniMax（因此不受 CORS 与混合内容限制）。

### 路由

| 方法与路径 | 说明 |
|---|---|
| `GET /dsh-minimax-image/diag` | 自检：版本、注册状态、脱敏设置、路径 |
| `GET /dsh-minimax-image/settings` | 脱敏设置 + 可选模型/比例/站点 |
| `POST /dsh-minimax-image/settings` | 保存 `apiKey` / `region` / `model` / `aspectRatio` / `area` / `n` / `guard` / `outputDir`（`clearKey: true` 清空 key） |
| `POST /dsh-minimax-image/generate` | 文生图：生成并写盘，返回相对路径与可直接展示的 URL；可带 `guard` 覆盖开关 |
| `POST /dsh-minimax-image/edit` | 图片编辑：`images` 传 base64 data URI 数组（1–16 张），请求体上限 72 MB；可带 `guard` |
| `GET /dsh-minimax-image/history` | 最近生成记录 |
| `POST /dsh-minimax-image/history/delete` | 删除一条记录（连同它的图片文件） |
| `GET /dsh-minimax-image/file?name=<rel>` | 回读图片（限制在保存目录内，防路径穿越） |
| `POST /dsh-minimax-image/open` | 在文件管理器中打开保存目录 |

## 数据位置

- 设置与 key：`~/.dsh/minimax-image/settings.json`（明文，仅本机）
- 图片：默认 `~/.dsh/minimax-image/out/<YYYY-MM-DD>/<YYYYMMDD-HHmmss>-N.<jpeg|png|webp>`，可在面板里改（扩展名跟随接口返回的 `output_format`）
- 历史：`~/.dsh/minimax-image/history.json`（上限 40 条）
- 日志：`~/.dsh/logs/dsh-minimax-image.log`

> **API key 不入库**：仓库里没有任何 key，只有面板/环境变量两种传入方式。key 只写在本机 `settings.json` 或运行时的 `MINIMAX_API_KEY` 环境变量里，`settings.json`、`history.json`、`*.log` 都已在 `.gitignore` 中排除。提交前可自查：`git grep -n -E "sk-[A-Za-z0-9_-]{16,}"`。

## 安装（本机 profile）

```powershell
$p = "$env:USERPROFILE\.dsh\profiles\desktop"
New-Item -ItemType Junction -Path "$p\node_modules\dsh-minimax-image" `
  -Target '<你克隆下来的插件目录>'
```

`package.json` 的 `dependencies` 增加 `"dsh-minimax-image": "link:<你克隆下来的插件目录>"`（如 `link:D:/projects/dsh-plugin-minimax-h3`），
并在 `cordis.patch.yml` 末尾追加：

```yaml
# >>> dsh-minimax-image (local plugin) >>>
- insert:
    - id: dsh-minimax-image
      name: './node_modules/dsh-minimax-image/index.js'
# <<< dsh-minimax-image <<<
```

host 端会热加载；浏览器端需要刷新一次页面（Ctrl+R）才会出现菜单项。

### 卸载

删掉 junction、`dependencies` 里那一行、以及 `cordis.patch.yml` 里的 patch 块即可（安装前的备份在 `~/.dsh/profiles/desktop/*.bak-*-before-minimax`）。

## 排障

**「打开文件夹」点了没反应**：`spawn('explorer.exe', [path])` 的 `windowsHide` 必须是 `false`。设成 `true` 时 Windows 会把这个「隐藏」状态传给被启动的 GUI 进程，explorer 的窗口就以隐藏状态创建——进程确实起来了、日志也没有报错，但用户什么都看不到。

诊断方法（能区分"没起来"和"起来了但被藏了"）：

```powershell
$shell = New-Object -ComObject Shell.Application
$shell.Windows() | ForEach-Object { "$($_.HWND) :: $($_.Document.Folder.Self.Path)" }
# 再对 HWND 调 user32!IsWindowVisible 看是不是 False
```

现在实现里 `windowsHide: false`，用 `spawn` 事件确认进程真的起来（失败会把错误返回给面板），explorer.exe 失败时退回 `cmd /c start`，两次都失败才报错，并顺手把路径复制到剪贴板。

## 模型说明

实测（2026-11-12 / 11-13）：

| 模型 | 接口 | 结果 |
|---|---|---|
| `MiniMax-H3-Image` | `POST /v1/images/generations` | 200，16:9 @ 2K → 2720×1536，约 8–10 秒/张 |
| `MiniMax-H3-Image` | `POST /v1/images/generations` | 200，1:1 @ 1K → 1024×1024，约 7.8 秒 |
| `MiniMax-H3-Image` | `POST /v1/images/edits` | 200，2 张参考图 → 5440×3072，约 18–23 秒 |
| `MiniMax-H3-Image` | `POST /v1/images/edits` | 200，1 张 1024² 参考图 → 4096×4096，约 14.9 秒 |
| `MiniMax-H3-Image-Highspeed` | 同上 | 参数一致，仅换 `model` |
| `image-01` | `POST /v1/image_generation` | 200，但慢得多（实测 25–110 秒），不支持编辑 |
| `image-01-live` | 同上 | 200，更偏风格化 |

H3 在三个域名上都可用：`api.minimax.cn`、`api.minimaxi.com`、`api.minimax.chat`。

**两套接口不能混用**：把 `image-01` 发到 H3 端点会返回 `unsupported model`；把 `MiniMax-H3-Image` 发到老端点同样报错。插件按模型的 `family` 字段分派。

H3 的响应是 OpenAI 结构：`data[]` 里每项要么有 `url`，要么有 `error`（部分失败仍返回 200），所以插件会收集失败项显示为黄色警告条，只在全部失败时抛错。

`size` 的处理：插件固定传 `size: "auto"` 并用 `aspect_ratio` + `area` 控制尺寸，避免两者冲突时返回 400。

海螺（Hailuo）是视频模型，走 `/v1/video_generation`，与本插件无关。

## 自测脚本

```powershell
$env:MINIMAX_API_KEY = '<你的 MiniMax API key>'   # 只在跑自测脚本时需要；面板里存的 key 不会被脚本读取
node scripts/smoke.mjs                       # 文生图：真调接口，落一张图，并验证坏 key 的报错
node scripts/edit-smoke.mjs <图1> [图2]       # 图片编辑：库层直连
node scripts/route-edit.mjs <图> "改成蓝色调"  # 走插件自己的 /edit 路由（面板用的那条）
node scripts/route-guard.mjs                 # 护栏 + 张数上限：走路由，花两次真实出图（1:1@1K + 编辑）
node scripts/client-harness.mjs              # 无浏览器跑一遍 client.js 的注册与渲染路径（7 个阶段）
```

`route-guard.mjs` 不需要在这里配 key（host 端已经有），跑完会把改过的设置还原；它验证的是 `guard` 真进了请求、历史存的是原话、以及 `image-01`/H3 的张数上限。

编辑接口的参考图限制（来自官方文档）：1–16 张，单文件 ≤ 64 MiB，宽高 128–8192，长宽比 ≤ 4:1，格式 jpg/jpeg/png/webp/heic/heif。面板对单张设了 20 MB 的软上限，超过会跳过并提示。

生成耗时实测：H3 约 8–10 秒/张（16:9 @ 2K）；上一代 `image-01` 为 25–110 秒。面板显示实时计时，超时上限 300 秒。
