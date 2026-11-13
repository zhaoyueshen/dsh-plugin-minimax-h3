# 交接文档 · dsh-minimax-image

> 给新会话用：开场说一句「读 HANDOFF.md，继续改出图插件」即可。
> 本文件是插件开发的唯一入口摘要，比翻会话历史快得多。

最后更新：2026-11-13

---

## 1. 这是什么

DeepSeek Harness 的侧边栏插件「出图」：在面板里写提示词调 MiniMax 生成图片，结果落本机；同时注册 agent 工具 `minimax_image`，对话里也能出图。

支持两条能力：

| 能力 | 接口 | 模型 |
|---|---|---|
| 文生图 | `POST /v1/images/generations` | `MiniMax-H3-Image`（默认）、Highspeed |
| 图片编辑（1–16 张参考图） | `POST /v1/images/edits` | 同上 |
| 上一代兼容 | `POST /v1/image_generation` | `image-01`、`image-01-live`（不支持编辑） |

---

## 2. 文件在哪

```
D:\projects\dsh-minimax-image\
├── index.js            # 服务端：路由、设置、落盘、agent 工具
├── client.js           # 浏览器端：面板 UI（手写 React.createElement，无构建步骤）
├── lib\minimax.js      # 两代接口的客户端（generateImages / editImages）
├── lib\util.js         # 路径、JSON 原子写、日志、时间戳
├── package.json        # dsh.client 声明（platform: web, immediately）
├── cordis.patch.yml    # bundle 安装用（本机用 profile patch，不用它）
├── README.md           # 面向使用的文档（功能、路由、模型实测、排障）
└── scripts\            # 测试脚本，见第 7 节
```

挂载方式（本机 profile，不是 bundle）：

```
C:\Users\yuesh\.dsh\profiles\desktop\node_modules\dsh-minimax-image  →  junction 指向上面目录
profile 的 package.json  dependencies: "dsh-minimax-image": "link:D:/projects/dsh-minimax-image"
profile 的 cordis.patch.yml 末尾:
    - insert:
        - id: dsh-minimax-image
          name: './node_modules/dsh-minimax-image/index.js'
```

---

## 3. 数据位置

| 内容 | 路径 |
|---|---|
| 设置与 API key（明文） | `~/.dsh/minimax-image/settings.json` |
| 图片 | `~/.dsh/minimax-image/out/<YYYY-MM-DD>/<YYYYMMDD-HHmmss>-N.<jpeg\|png\|webp>` |
| 历史（上限 40 条） | `~/.dsh/minimax-image/history.json` |
| 日志 | `~/.dsh/logs/dsh-minimax-image.log` |

---

## 4. 面板现有功能

- 模式切换：**文生图 / 图片编辑**
- 提示词（Ctrl+Enter 提交）、示例提示词（两种模式各三条）
- 参考图：拖拽 / 选择 / Ctrl+V 粘贴，最多 16 张，缩略图带「图N」编号，可单删；**点缩略图可放大**
- 比例（带预览方块）、清晰度档位 1K/2K/4K（仅 H3）、**张数 1–10 步进器**（H3 上限 10，旧模型 9，切模型时自动回落）、模型下拉
- **构图护栏开关**：开着就自动在提示词末尾追加「主体完整、四周留白、不裁切主体」；单独保存（`guard` 字段），只在发请求时拼，历史存原话
- 结果网格：点开大图 / **每张小图单独「接着改」**（✦ 按钮）/ 复制路径 / 下载；部分失败有黄色警告条
- 结果卡右上：**继续编辑**（清空参考图→放入第 1 张→切编辑模式）+ 打开文件夹
- 大图底部：**保存图片 / 编辑图片 / 打开文件夹 / 关闭**（参考图的大图只有「保存图片」）
- 历史记录：**编辑图片 / 复用 / 删除**；点缩略图放大；带护栏的条目显示「· 护栏」
- 设置面板：API key（脱敏）、站点、保存位置
- 页面自带滚动条（根容器 `height:100%; overflowY:auto`）

服务端路由（前缀 `/dsh-minimax-image`）：`diag`、`settings` GET/POST、`generate`、`edit`、`history`、`history/delete`、`file`、`open`。`generate`/`edit` 的请求体可带 `guard: true|false` 覆盖面板开关。

---

## 5. 已知的坑（别再踩一遍）

1. **`windowsHide` 必须为 `false`**。`spawn('explorer.exe', [path], {windowsHide:true})` 会让 Windows 把「隐藏」当作 GUI 进程的初始显示状态，explorer 窗口创建出来就是不可见的：接口返回 ok、日志无报错、用户什么都看不到。诊断：`Shell.Application.Windows()` + `user32!IsWindowVisible`。
2. **服务端改代码不会热更新**。改 `index.js`/`lib/*` 后要用插件管理器 disable→enable（`plugin_manager`，target `include:dsh-minimax-image`），或重启应用。改 `client.js` 只需刷新页面。
3. **H3 不在老端点上**。`POST /v1/image_generation` 传 `MiniMax-H3-Image` 会返回 `unsupported model`；H3 走 `/v1/images/generations`。两代响应结构也不同：H3 是 OpenAI 形状（`data[].url|error`、`output_format`、`usage`），legacy 是 `data.image_urls` + `base_resp.status_code`。
4. **PowerShell 调接口必须显式 UTF-8**。直接 `ConvertTo-Json` 再 `-Body` 传字符串，中文会被编成 `????`，模型就会瞎画。要用 `[Text.Encoding]::UTF8.GetBytes($json)` + `charset=utf-8`。这是测试脚本的坑，不是插件的。
5. **`history.json` 不要用 PowerShell `Set-Content` 写**。PS 5.1 会加 BOM，`JSON.parse` 直接抛错，历史被当成空数组。用 Node 写。
6. **H3 编辑的 `size` 固定 `auto`**，画幅由参考图决定；链式「继续编辑」会把裁切误差一路放大。圆盘/主体贴边问题见 `scripts/diagnose-plate.mjs` 的结论：**抱怨式 prompt（"盘子还是不完整"）会被当成画面描述画出来**，必须写正面构图指令。面板的「构图护栏」就是把这条正面指令（`GUARD_SUFFIX`，在 `index.js` 顶部）自动加到请求里。
7. **护栏只在 wire 上生效**：`applyGuard()` 拼的提示词不进历史、不进面板输入框，历史条目存 `guard` 布尔值。要改护栏文案只改 `GUARD_SUFFIX` 一处；别把后缀写进 `prompt` 再存进历史，否则「复用」会把后缀又双击一次。

---

## 6. 迭代工作流

1. 改 `client.js`（UI）→ 刷新页面看效果。
2. 改 `index.js` / `lib/*`（服务端）→ `node --check` → 插件管理器 disable/enable → 打 `/diag` 确认 `routes=true tool=true`。
3. 每次改完必跑 `node scripts/client-harness.mjs`（无浏览器跑 client.js 的七个渲染阶段）。
4. 真实链路验证：`scripts/smoke.mjs`（文生图）、`scripts/edit-smoke.mjs`（编辑）、`scripts/route-edit.mjs`（走面板路由）、`scripts/route-guard.mjs`（护栏 + 张数上限）。

---

## 7. 测试脚本

```powershell
cd D:\projects\dsh-minimax-image
$env:MINIMAX_API_KEY = 'sk-api-...'

node --check index.js; node --check client.js
node scripts/client-harness.mjs          # 七阶段结构校验（不需网络）
node scripts/smoke.mjs                   # 文生图 + 坏 key 报错
node scripts/edit-smoke.mjs <图1> [图2]  # 图片编辑（库层）
node scripts/route-edit.mjs <图> "提示词" # 走插件自己的 /edit 路由
node scripts/route-guard.mjs             # 护栏 + 张数上限（走路由，花两次真实出图，跑完还原设置）
node scripts/diagnose-plate.mjs <图>     # 裁切问题的三组对照实验
```

`client-harness.mjs` 用「源码状态注入」的手法渲染结果卡、大图、历史行这几条分支——因为它们在初始状态下不渲染，直接 mount 测不到。阶段 6 用 `withTitle()` 遍历解析后的树来数「逐张接着改」按钮（直接数字符串会翻倍：每个节点带了两份 children）。

---

## 8. 实测数据（2026-11-12 / 11-13）

| 场景 | 耗时 | 输出 |
|---|---|---|
| 文生图 16:9 @2K | 8–10 秒/张 | 2720×1536 |
| 文生图 1:1 @2K | 约 8 秒 | 2048×2048 |
| 文生图 1:1 @1K | 7.8 秒 | 1024×1024 |
| 编辑 · 1 张参考图 | 17–21 秒 | 5440×3072 |
| 编辑 · 1 张 1024² 参考图 @2K 档 | 14.9 秒 | 4096×4096 |
| 编辑 · 2 张参考图 | 约 22 秒 | 5440×3072 |
| `image-01`（旧） | 25–110 秒 | 1280×720 |

三个域名都可用：`api.minimax.cn`、`api.minimaxi.com`、`api.minimax.chat`。

---

## 9. 还没做的（可选）

- **`mm_file://` 上传链路**：现在参考图是 base64 内联（再 base64 膨胀 4/3），同一张图反复编辑每次都要重传几 MB。官方支持先上传换 `file_id` 再引用，可顺手按内容哈希缓存。
- **流式输出**：官方支持 `stream: true` 逐张推送，现在是一次性等全部。
- **结果对比**：把两轮编辑结果并排看，现在的历史只能一张张点开。
- **批量删除**：历史一次只能删一条。

---

## 10. 当前状态

插件在跑（v0.2.0），`diag` 正常（`routes=true, tool=true`），22+ 条历史，key 已配置。

最近一次改动（2026-11-13，v0.2.0）：三处小改进——
1. **构图护栏**：面板开关 → `settings.guard` → `applyGuard()` 只在请求上拼 `GUARD_SUFFIX`；`/generate`/`/edit` 支持单次 `guard` 覆盖；agent 工具加了 `guard` 参数。
2. **张数 1–10**：面板换成步进器装不下就换模型自动回落；`maxCountFor()` 按 family 给 10 / 9。
3. **逐张接着改**：结果网格每张小图的 ✦ 按钮走同一个 `continueEditing()`。

验证：`route-guard.mjs` 18 项全过（真出图 + 真编辑），`client-harness.mjs` 七阶段全过。上一版改动是大图「复制路径」改「打开文件夹」、服务端 `/open` 增强为 file→父目录、失败退回 `cmd /c start`。
