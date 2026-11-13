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
<仓库根目录>\
├── index.js            # 服务端：路由、设置、落盘、agent 工具
├── client.js           # 浏览器端：面板 UI（手写 React.createElement，无构建步骤）
├── lib\minimax.js      # 两代接口的客户端（generateImages / editImages）
├── lib\billing.js      # 官方账单：GET /account/amount 的汇总（近 7 天实付）
├── lib\util.js         # 路径、JSON 原子写、日志、时间戳
├── package.json        # dsh.bundle.patch + dsh.client 声明（platform: web, immediately）
├── cordis.patch.yml    # bundle 挂载声明（insert id/name = 包名）
├── README.md           # 面向使用的文档（功能、路由、模型实测、排障）
└── scripts\            # 测试脚本，见第 7 节
```

挂载方式（bundle，自 v0.2.1 起）：

```
profile 的 package.json  dependencies: "dsh-minimax-image": "link:<本机克隆目录>"
profile 的 package.json  dsh.profile.bundles 含 "dsh-minimax-image"
profile 的 cordis.patch.yml 不再需要手写 insert 块——bundle 层会插
```

安装/卸载走 plugin manager：

```
dsh plugin --profile desktop add link:D:\projects\dsh-minimax-image
dsh plugin --profile desktop remove dsh-minimax-image
```

旧的「手工 junction + patch 块」仍可用，但不要和 bundle 同时启用（同一 id 会冲突）。

---

## 3. 数据位置

| 内容 | 路径 |
|---|---|
| 设置与 API key（明文） | `~/.dsh/minimax-image/settings.json` |
| 图片 | `~/.dsh/minimax-image/out/<YYYY-MM-DD>/<YYYYMMDD-HHmmss>-N.<jpeg\|png\|webp>` |
| 历史（上限 40 条，含 `usage` / `region`） | `~/.dsh/minimax-image/history.json` |
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
- 历史记录：**单次费用**（编辑图片左边，`约 ¥0.14`，金额加粗，悬停看 token 明细）/ **编辑图片 / 复用 / 删除**；点缩略图放大；带护栏的条目显示「· 护栏」
- **官方账单卡**：近 7 天账户实付（`GET /account/amount`，服务端缓存 5 分钟，可手动刷新）+ 最新账单时间 + 「消费明细」外链；与单条费用并列，但明确标注按小时汇总、含整个账户
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
8. **费用不是接口返回的**。H3 只返回 `usage`（`input_tokens_details.text_tokens` / `image_tokens`、`output_tokens_details.image_tokens`），金额是 `client.js` 里 `PRICE_BOOKS` 按官方单价算的；`history.json` 存原始 `usage`、`region` 和 `currency`，老记录没有 `usage` 就退回官方单张参考价表。改价只改 `PRICE_BOOKS`（cny + usd 两套）。**货币按 `REGIONS[].currency`**：现在 `intl`（`api.minimax.chat`）和 `cn`（`api.minimaxi.com`）都是 `CNY`，因为这个 key 在 `api.minimax.io` 上是 invalid api key，控制台账单里的 8160 输出 token 记 ¥0.2040（正好 ¥25/百万）。4K 限时 5 折的条件是**单张交付图 ≥ 1660 万像素**，按 `images[].size` 判断，别按 `area` 判断；截止 2026-11-17 16:00 UTC（北京时间 11-18 00:00）。
9. **控制台消费明细不能按条对齐**。`https://platform.minimax.cn/console/consumption-detail` 背后是 `GET /account/amount`（`page` / `limit` / `start_date` / `end_date` / `aggregate`），**API key 就能调**（不用 cookie）；但 `charge_records` 是按“小时 + 计费项（输出/文本/参考图）”聚合的，同一小时的多次出图合并成几行，没有 `request_id`，所以只能拿来对账/看总额，不能算单条精确金额。面板的「官方账单」卡就是用它，`lib/billing.js` 只取 `consume_cash_after_voucher_sum` / `consume_token_sum` / `total_cnt` / 最新 `consume_time`；`/bill` 路由缓存 5 分钟，`?refresh=1` 强制重查。账单有延迟（实测今天 12:43 的出图还没出现），且包含体验中心等全账户调用。

---

## 6. 迭代工作流

1. 改 `client.js`（UI）→ 刷新页面看效果。
2. 改 `index.js` / `lib/*`（服务端）→ `node --check` → 插件管理器 disable/enable → 打 `/diag` 确认 `routes=true tool=true`。
3. 每次改完必跑 `node scripts/client-harness.mjs`（无浏览器跑 client.js 的七个渲染阶段）。
4. 真实链路验证：`scripts/smoke.mjs`（文生图）、`scripts/edit-smoke.mjs`（编辑）、`scripts/route-edit.mjs`（走面板路由）、`scripts/route-guard.mjs`（护栏 + 张数上限）；改过 usage/费用/账单相关代码再跑 `scripts/usage-check.mjs` 和 `scripts/billing-check.mjs`（都离线、不花钱）。

---

## 7. 测试脚本

```powershell
cd <本机克隆目录>
$env:MINIMAX_API_KEY = '<你的 MiniMax API key>'

node --check index.js; node --check client.js
node scripts/client-harness.mjs          # 七阶段结构校验（不需网络）
node scripts/smoke.mjs                   # 文生图 + 坏 key 报错
node scripts/edit-smoke.mjs <图1> [图2]  # 图片编辑（库层）
node scripts/route-edit.mjs <图> "提示词" # 走插件自己的 /edit 路由
node scripts/route-guard.mjs             # 护栏 + 张数上限（走路由，花两次真实出图，跑完还原设置）
node scripts/usage-check.mjs             # 离线：H3 响应的 usage 块是否进了 meta（不联网）
node scripts/billing-check.mjs           # 离线：官方账单 /account/amount 的字段解析（不联网）
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

插件在跑（v0.2.4），`diag` 正常（`routes=true, tool=true`），24 条历史，key 已配置。

最近一次改动（2026-11-13，v0.2.4）：**单条费用 + 官方账单卡**——
1. `lib/minimax.js` 把 H3 响应的 `usage` 原样塞进 `meta.usage`；`index.js` 把它、`region` 和 `currency` 写进历史，并从 `/generate`、`/edit` 返回。
2. `client.js` 新增 `estimateCost()`：有 `usage` 就按 `PRICE_BOOKS` 的 token 单价算；老记录没 `usage` 就按官方单张参考价表估；4K 单图 ≥ 1660 万像素自动 5 折；货币按 `REGIONS[].currency`（当前两个站点都是 CNY）。「编辑图片」左边显示 `约 ¥0.14`（四舍五入到 2 位小数，「约」和金额加粗，system-ui，与按钮同字体），悬停看 token 明细。
3. 生成完成的 toast 也带本次费用；`scripts/usage-check.mjs` 离线校验 usage 不丢。
4. **币种纠正**：实测该 key 在 `api.minimax.io` 报 `invalid api key`，控制台 `account/amount` 返回的金额是人民币（8160 输出 token = ¥0.2040），所以 `intl`/`cn` 都标成 `CNY`，不再显示 `$`。
5. **官方账单卡**：新增 `lib/billing.js` + `GET /bill?days=7`，用 API key 调控制台同一个 `/account/amount`，展示近 7 天账户实付、最新账单时间和「消费明细」外链；缓存 5 分钟，可手动刷新。单条金额仍按 token 估，账单只做总额对账（按小时聚合、有延迟、含全账户调用）。

验证：`client-harness.mjs` 七阶段 + 账单卡、字体断言全过（含 USD usage 价、CNY 表估价、CN+4K 折扣三种费用分支），`usage-check.mjs` / `billing-check.mjs` 通过。上一版是 v0.2.0 的护栏 / 张数步进器 / 逐张接着改。
