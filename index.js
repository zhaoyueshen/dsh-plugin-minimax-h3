/**
 * dsh-minimax-image — host half.
 *
 * Owns everything that touches the network and the disk:
 *   - POST /dsh-minimax-image/generate        -> text-to-image, saves the files
 *   - POST /dsh-minimax-image/edit            -> image edit (1..16 references)
 *   - GET  /dsh-minimax-image/file            -> serves a saved image to the page
 *   - GET  /dsh-minimax-image/settings        -> masked settings + model/ratio/area/region lists
 *   - POST /dsh-minimax-image/settings        -> persists key / region / model / ratio / area / n / guard / outputDir
 *   - GET  /dsh-minimax-image/history         -> recent generations
 *   - POST /dsh-minimax-image/history/delete  -> drops one entry and its files
 *   - POST /dsh-minimax-image/open            -> reveals a file's folder (or the output root)
 *   - GET  /dsh-minimax-image/diag            -> self check: version, registrations, paths
 *
 * It also registers the agent tool `minimax_image` so chat and the panel share
 * one code path.
 */

import { spawn } from 'node:child_process'
import { readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import { AREAS, ASPECTS, MODELS, MODEL_IDS, REGIONS, editImages, generateImages, modelDef } from './lib/minimax.js'
import {
  clampCount,
  dayStamp,
  ensureDir,
  isInside,
  makeLogger,
  maskKey,
  readJsonFile,
  stamp,
  writeJsonAtomic,
} from './lib/util.js'

export const name = 'dsh-minimax-image'
export const inject = []

const VERSION = '0.2.0'
const ROUTE_PREFIX = '/dsh-minimax-image'
const TOOL_NAME = 'minimax_image'
/** The edits API accepts 1..16 references with a 64 MiB body; leave room for JSON. */
const MAX_BODY_BYTES = 72 * 1024 * 1024

/**
 * Appended to the prompt when 构图护栏 is on.
 *
 * A complaint-style prompt ("盘子还是不完整") is read as scene description and gets
 * painted, so the guard has to be a positive composition instruction.
 */
const GUARD_SUFFIX = '\n\n构图要求：主体完整，四周留出适当留白，画面边缘不要切断主体。'

const DEFAULTS = {
  dshHome: process.env.DSH_HOME || join(homedir(), '.dsh'),
  timeoutMs: 300000,
  historyLimit: 40,
}

const MODEL_IDS_SET = new Set(MODEL_IDS)

function mergeConfig(defaults, raw) {
  const out = { ...defaults }
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.trim() === '') continue
    out[key] = value
  }
  return out
}

function normalizeCount(value, fallback = 1, max = 10) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return clampCount(n, 1, max)
}

/** H3 tops out at 10 images per request; the legacy endpoint stops at 9. */
function maxCountFor(modelId) {
  return modelDef(modelId).family === 'h3' ? 10 : 9
}

export function apply(ctx, config = {}) {
  const cfg = mergeConfig(DEFAULTS, config)
  const dataDir = join(cfg.dshHome, 'minimax-image')
  const settingsPath = join(dataDir, 'settings.json')
  const historyPath = join(dataDir, 'history.json')
  const logPath = join(cfg.dshHome, 'logs', 'dsh-minimax-image.log')
  const log = makeLogger(logPath)

  let settings = {
    apiKey: '',
    region: 'intl',
    model: MODEL_IDS[0],
    aspectRatio: '16:9',
    area: '2K',
    n: 1,
    guard: false,
    outputDir: join(dataDir, 'out'),
  }
  let history = []
  let cancelling = false

  const registrations = { routes: false, tool: false }
  const startedAt = Date.now()

  log(`module loaded; pid=${process.pid}; data=${dataDir}`)

  const settingsReady = (async () => {
    const raw = await readJsonFile(settingsPath, {})
    settings = normalizeSettings({ ...settings, ...raw })
    history = await loadHistory()
    log(`settings loaded; region=${settings.region}; key=${settings.apiKey ? 'set' : 'missing'}`)
    return settings
  })()

  function normalizeSettings(value) {
    const source = value ?? {}
    const outputDir = String(source.outputDir ?? '').trim() || join(dataDir, 'out')
    const model = MODEL_IDS_SET.has(source.model) ? source.model : MODEL_IDS[0]
    return {
      apiKey: typeof source.apiKey === 'string' ? source.apiKey.trim() : '',
      region: REGIONS[source.region] ? source.region : 'intl',
      model,
      aspectRatio: ASPECTS.includes(source.aspectRatio) ? source.aspectRatio : '16:9',
      area: AREAS.includes(source.area) ? source.area : '2K',
      n: normalizeCount(source.n, 1, maxCountFor(model)),
      guard: source.guard === true,
      outputDir,
    }
  }

  async function loadHistory() {
    const raw = await readJsonFile(historyPath, [])
    if (!Array.isArray(raw)) return []
    return raw.filter((row) => row && typeof row === 'object' && Array.isArray(row.images))
  }

  async function saveHistory() {
    history = history.slice(0, cfg.historyLimit)
    await writeJsonAtomic(historyPath, history)
  }

  function publicSettings() {
    const key = settings.apiKey
    return {
      hasKey: Boolean(key),
      keyMask: key ? maskKey(key) : '',
      region: settings.region,
      model: settings.model,
      aspectRatio: settings.aspectRatio,
      area: settings.area,
      n: settings.n,
      guard: settings.guard,
      outputDir: settings.outputDir,
    }
  }

  function whenReady(keys, label, fn) {
    try {
      ctx.inject(keys, (scoped) => {
        log(`ready: ${label} (${keys.join(',')})`)
        try {
          fn(scoped)
        } catch (error) {
          log(`${label} setup failed: ${error?.stack ?? error}`)
        }
      })
    } catch (error) {
      log(`${label} inject call failed: ${error?.stack ?? error}`)
    }
  }

  // --- the one code path shared by the panel and the agent tool -----------
  function currentApiKey() {
    const key = settings.apiKey || String(process.env.MINIMAX_API_KEY ?? '').trim()
    if (!key) {
      throw new Error('还没有配置 MiniMax API key：在侧边栏「出图」页面填入并保存即可')
    }
    return key
  }

  function currentRegion() {
    return REGIONS[settings.region] ? settings.region : 'intl'
  }

  /** A per-request `guard` wins; otherwise the panel's saved switch decides. */
  function resolveGuard(input) {
    return typeof input?.guard === 'boolean' ? input.guard : settings.guard === true
  }

  /** The stored history keeps the user's own words; only the wire gets the suffix. */
  function applyGuard(prompt, guard) {
    return guard ? `${prompt}${GUARD_SUFFIX}` : prompt
  }

  /** Write returned images to disk and record the run in history. */
  async function storeResult(result, extra) {
    const day = dayStamp()
    const directory = join(settings.outputDir, day)
    await ensureDir(directory)

    const base = stamp()
    const created = []
    for (let index = 0; index < result.images.length; index += 1) {
      const image = result.images[index]
      const fileName = `${base}-${index + 1}.${image.ext}`
      const absolute = join(directory, fileName)
      await writeFile(absolute, image.buffer)
      const rel = `${day}/${fileName}`
      created.push({
        rel,
        name: fileName,
        path: absolute,
        bytes: image.buffer.length,
        size: image.size || '',
        url: `${ROUTE_PREFIX}/file?name=${encodeURIComponent(rel)}`,
      })
    }

    const entry = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      kind: extra.kind,
      prompt: extra.prompt,
      model: extra.model,
      aspectRatio: extra.aspectRatio,
      area: extra.area ?? '',
      n: extra.n,
      refs: extra.refs ?? 0,
      guard: extra.guard === true,
      ms: result.ms,
      warnings: result.warnings ?? [],
      images: created.map((item) => ({ rel: item.rel, name: item.name, bytes: item.bytes, size: item.size })),
    }

    history.unshift(entry)
    await saveHistory()
    log(`${extra.kind} ok: ${created.length} image(s) in ${result.ms}ms -> ${directory}`)

    return {
      id: entry.id,
      kind: entry.kind,
      prompt: entry.prompt,
      model: entry.model,
      aspectRatio: entry.aspectRatio,
      area: entry.area,
      refs: entry.refs,
      n: entry.n,
      guard: entry.guard,
      ms: result.ms,
      images: created,
      warnings: entry.warnings,
      directory,
    }
  }

  async function runGenerate(input) {
    await settingsReady

    const prompt = String(input?.prompt ?? '').trim()
    if (!prompt) throw new Error('请先写画面描述')

    const apiKey = currentApiKey()

    const model = MODEL_IDS_SET.has(input?.model) ? input.model : settings.model
    const def = modelDef(model)
    const aspectRatio = ASPECTS.includes(input?.aspectRatio) ? input.aspectRatio : settings.aspectRatio
    const area = AREAS.includes(input?.area) ? input.area : settings.area
    const n = normalizeCount(input?.n, settings.n, maxCountFor(model))
    const region = currentRegion()
    const guard = resolveGuard(input)

    log(`generate: model=${model} family=${def.family} ratio=${aspectRatio} area=${area} n=${n} guard=${guard} region=${region} prompt=${prompt.slice(0, 60)}`)

    const result = await generateImages({
      apiKey,
      prompt: applyGuard(prompt, guard),
      model,
      aspectRatio,
      area,
      n,
      region,
      timeoutMs: cfg.timeoutMs,
    })

    return await storeResult(result, {
      kind: 'generate',
      prompt,
      model,
      aspectRatio,
      area: def.area ? area : '',
      n,
      guard,
    })
  }

  async function runEdit(input) {
    await settingsReady

    const prompt = String(input?.prompt ?? '').trim()
    if (!prompt) throw new Error('请先写编辑要求，例如「把图1的猫换成图2里的柴犬」')
    const apiKey = currentApiKey()

    const model = MODEL_IDS_SET.has(input?.model) ? input.model : settings.model
    const def = modelDef(model)
    if (def.family !== 'h3') {
      throw new Error('图片编辑只支持 H3 模型，请在面板里把模型切换成 MiniMax-H3-Image')
    }

    const refs = Array.isArray(input?.images) ? input.images : []
    const n = normalizeCount(input?.n, 1, maxCountFor(model))
    const region = currentRegion()
    const guard = resolveGuard(input)

    log(`edit: model=${model} refs=${refs.length} n=${n} guard=${guard} region=${region} prompt=${prompt.slice(0, 60)}`)

    const result = await editImages({
      apiKey,
      prompt: applyGuard(prompt, guard),
      images: refs,
      model,
      n,
      region,
      timeoutMs: cfg.timeoutMs,
    })

    return await storeResult(result, {
      kind: 'edit',
      prompt,
      model,
      aspectRatio: 'auto',
      area: '',
      n: result.images.length,
      refs: refs.length,
      guard,
    })
  }

  /** Spawn a detached GUI opener and resolve only once the OS confirms it started. */
  function spawnDetached(command, args) {
    return new Promise((resolvePromise, reject) => {
      let settled = false
      let child
      try {
        // windowsHide MUST stay false: on Windows the flag is inherited as the
        // GUI process's initial show state, and explorer.exe then opens its
        // window hidden (the folder simply never appears).
        child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: false })
      } catch (error) {
        reject(error)
        return
      }
      child.once('error', (error) => {
        if (settled) return
        settled = true
        reject(error)
      })
      child.once('spawn', () => {
        if (settled) return
        settled = true
        child.unref()
        resolvePromise(child.pid ?? null)
      })
    })
  }

  async function openPath(target) {
    if (!target) throw new Error('缺少路径')
    const absolute = expandUserPath(String(target))
    let info
    try {
      info = await stat(absolute)
    } catch {
      throw new Error(`路径不存在：${absolute}`)
    }
    // A file opens the folder that contains it; a folder opens itself.
    const directory = info.isDirectory() ? absolute : dirname(absolute)
    const candidates = process.platform === 'win32'
      ? [['explorer.exe', [directory]], ['cmd.exe', ['/c', 'start', '', directory]]]
      : process.platform === 'darwin'
        ? [['open', [directory]]]
        : [['xdg-open', [directory]]]

    let lastError = null
    for (const [command, args] of candidates) {
      try {
        const pid = await spawnDetached(command, args)
        log(`opened ${directory} via ${command} (pid=${pid ?? '?'})`)
        return { opened: directory, via: command, pid }
      } catch (error) {
        lastError = error
        log(`launch failed via ${command}: ${error?.message ?? error}`)
      }
    }
    throw new Error(`打开文件管理器失败：${lastError?.message ?? '未知原因'}`)
  }

  // --- routes -------------------------------------------------------------
  whenReady(['webServer'], 'webServer', (scoped) => {
    ctx.effect(
      () => scoped.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: (req, res) => handleRoute(req, res),
      }),
      'dsh-minimax-image: routes',
    )
    registrations.routes = true
    log(`routes registered at ${ROUTE_PREFIX}`)
  })

  async function handleRoute(req, res) {
    try {
      if (!isSameOrigin(req)) return writeJson(res, 403, { ok: false, error: 'forbidden' })
      const url = new URL(req.url ?? '/', 'http://dsh.internal')
      const action = url.pathname.slice(ROUTE_PREFIX.length).replace(/^\/+/, '')

      if (action === 'diag' && req.method === 'GET') {
        return writeJson(res, 200, {
          ok: true,
          version: VERSION,
          pid: process.pid,
          uptimeMs: Date.now() - startedAt,
          registrations,
          settings: publicSettings(),
          historyCount: history.length,
          paths: { dataDir, settings: settingsPath, log: logPath },
        })
      }

      if (action === 'settings' && req.method === 'GET') {
        await settingsReady
        return writeJson(res, 200, {
          ok: true,
          settings: publicSettings(),
          models: MODELS,
          aspects: ASPECTS,
          areas: AREAS,
          regions: Object.values(REGIONS).map((region) => ({ id: region.id, label: region.label })),
        })
      }

      if (action === 'settings' && req.method === 'POST') {
        await settingsReady
        const body = await readJsonBody(req)
        const next = { ...settings }

        if (typeof body?.apiKey === 'string' && body.apiKey.trim()) next.apiKey = body.apiKey.trim()
        if (body?.clearKey === true) next.apiKey = ''
        if (typeof body?.region === 'string' && REGIONS[body.region]) next.region = body.region
        if (typeof body?.model === 'string' && MODEL_IDS.includes(body.model)) next.model = body.model
        if (typeof body?.aspectRatio === 'string' && ASPECTS.includes(body.aspectRatio)) next.aspectRatio = body.aspectRatio
        if (typeof body?.area === 'string' && AREAS.includes(body.area)) next.area = body.area
        if (typeof body?.guard === 'boolean') next.guard = body.guard
        if (body?.n !== undefined) next.n = normalizeCount(body.n, settings.n, maxCountFor(next.model))
        if (typeof body?.outputDir === 'string' && body.outputDir.trim()) {
          next.outputDir = expandUserPath(body.outputDir.trim())
        }

        settings = normalizeSettings(next)
        await ensureDir(settings.outputDir)
        await writeJsonAtomic(settingsPath, settings)
        log(`settings saved; region=${settings.region}; key=${settings.apiKey ? 'set' : 'missing'}`)
        return writeJson(res, 200, { ok: true, settings: publicSettings() })
      }

      if (action === 'generate' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const result = await runGenerate(body)
        return writeJson(res, 200, { ok: true, ...result })
      }

      if (action === 'edit' && req.method === 'POST') {
        const body = await readJsonBody(req, MAX_BODY_BYTES)
        const result = await runEdit(body)
        return writeJson(res, 200, { ok: true, ...result })
      }

      if (action === 'history' && req.method === 'GET') {
        await settingsReady
        const limit = Math.max(1, Math.min(cfg.historyLimit, Number(url.searchParams.get('limit')) || 12))
        return writeJson(res, 200, {
          ok: true,
          history: history.slice(0, limit).map((entry) => ({
            ...entry,
            images: entry.images.map((image) => ({
              ...image,
              path: join(settings.outputDir, image.rel),
              url: `${ROUTE_PREFIX}/file?name=${encodeURIComponent(image.rel)}`,
            })),
          })),
        })
      }

      if (action === 'history/delete' && req.method === 'POST') {
        await settingsReady
        const body = await readJsonBody(req)
        const id = String(body?.id ?? '')
        if (!id) return writeJson(res, 400, { ok: false, error: '缺少 id' })
        const target = history.find((entry) => entry.id === id)
        if (!target) return writeJson(res, 404, { ok: false, error: '这条记录不存在' })
        history = history.filter((entry) => entry.id !== id)
        await saveHistory()
        let removed = 0
        for (const image of target.images) {
          const absolute = join(settings.outputDir, image.rel)
          if (!isInside(absolute, settings.outputDir)) continue
          try {
            await unlink(absolute)
            removed += 1
          } catch {
            /* already gone */
          }
        }
        log(`history deleted: ${id} (${removed} file(s))`)
        return writeJson(res, 200, { ok: true, id, removed })
      }

      if (action === 'file' && req.method === 'GET') {
        await settingsReady
        const rel = String(url.searchParams.get('name') ?? '')
        if (!rel) return writeJson(res, 400, { ok: false, error: '缺少 name' })
        const absolute = join(settings.outputDir, rel.replace(/^[\\/]+/, ''))
        if (!isInside(absolute, settings.outputDir)) {
          return writeJson(res, 403, { ok: false, error: '路径越界' })
        }
        let buffer
        try {
          buffer = await readFile(absolute)
        } catch {
          return writeJson(res, 404, { ok: false, error: '图片不存在或已被删除' })
        }
        res.statusCode = 200
        const suffix = absolute.toLowerCase().split('.').pop()
        res.setHeader('Content-Type', suffix === 'png' ? 'image/png' : suffix === 'webp' ? 'image/webp' : 'image/jpeg')
        res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
        res.end(buffer)
        return undefined
      }

      if (action === 'open' && req.method === 'POST') {
        await settingsReady
        const body = await readJsonBody(req)
        const target = typeof body?.path === 'string' && body.path.trim()
          ? expandUserPath(body.path.trim())
          : settings.outputDir
        const result = await openPath(target)
        return writeJson(res, 200, { ok: true, ...result })
      }

      return writeJson(res, 404, { ok: false, error: `unknown action: ${action}` })
    } catch (error) {
      log(`route error: ${error?.stack ?? error}`)
      return writeJson(res, 400, {
        ok: false,
        code: error?.statusCode ?? 'internal',
        error: error?.message ?? String(error),
      })
    }
  }

  // --- agent tool ---------------------------------------------------------
  whenReady(['tools'], 'tools', (scoped) => {
    ctx.effect(
      () => scoped.tools.register({
        name: TOOL_NAME,
        description:
          '调用 MiniMax H3 Image（MiniMax-H3-Image）生成图片并保存到本机（默认 ~/.dsh/minimax-image/out/<日期>/）。' +
          '用户说"出图""画一张""生成配图"时使用。prompt 只写画面内容（主体、场景、风格、光线），' +
          '不要写比例、张数或"用某模型画"这类指令，那些用独立参数表达。' +
          `比例可选 ${ASPECTS.join(' / ')}；H3 模型另有面积档位 area（1K/2K/4K，默认 2K），4K 更清晰但更慢更大。` +
          '返回保存路径，可直接用于文档配图。',
        parameters: {
          prompt: {
            type: 'string',
            description: '画面描述，只写画面本身：主体、动作、场景、风格、光线、构图。中文或英文均可。',
          },
          aspectRatio: {
            type: 'string',
            enum: ASPECTS,
            description: '画面比例，默认沿用面板里的设置（16:9）。',
          },
          area: {
            type: 'string',
            enum: AREAS,
            description: 'H3 模型的面积档位：1K≈1024²、2K≈2048²、4K≈4096² 目标像素。仅 H3 模型生效。',
          },
          n: {
            type: 'integer',
            description: '生成张数，1-10（H3 上限 10，旧模型上限 9），默认 1。',
          },
          model: {
            type: 'string',
            enum: MODEL_IDS,
            description: '出图模型，默认 MiniMax-H3-Image；Highspeed 更快，image-01 系列是上一代接口（不支持编辑）。',
          },
          guard: {
            type: 'boolean',
            description:
              '是否追加构图护栏（主体完整、四周留白、不裁切主体）。默认跟随面板里的开关；' +
              '要精确控制画幅或刻意拍特写时传 false。',
          },
          images: {
            type: 'array',
            items: { type: 'string' },
            description:
              '图片编辑用的参考图：本机绝对路径数组（1–16 张，jpg/png/webp/heic/heif）。' +
              '一旦传入就走编辑接口，prompt 描述要改什么，可用「图1」「图2」指代顺序。',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['summary', 'images'],
            properties: {
              summary: { type: 'string' },
              directory: { type: 'string' },
              images: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    path: { type: 'string' },
                    name: { type: 'string' },
                    bytes: { type: 'integer' },
                  },
                },
              },
            },
          },
          render: (_args, value) => [{
            type: 'text',
            text: `\`\`\`markdown\n${value?.summary ?? ''}\n\`\`\``,
          }],
        },
        async execute(args) {
          const refs = Array.isArray(args?.images)
            ? args.images.filter((value) => typeof value === 'string' && value.trim())
            : []
          const result = refs.length
            ? await runEdit({ ...args, images: await readReferenceImages(refs) })
            : await runGenerate(args)
          const lines = result.images.map((image) => `![${image.name}](${image.path})`).join('\n')
          const shape = [
            result.kind === 'edit' ? `编辑 ${result.refs} 张参考图` : result.model,
            result.kind === 'edit' ? result.model : result.aspectRatio,
            result.area || null,
            `${result.images[0]?.size || ''}`.trim() || null,
          ]
            .filter(Boolean)
            .join(' / ')
          const warn = result.warnings?.length ? `\n注意：${result.warnings.join('；')}` : ''
          return {
            summary: `已生成 ${result.images.length} 张（${shape}，${(result.ms / 1000).toFixed(1)}s）\n${lines}${warn}`,
            directory: result.directory,
            images: result.images.map((image) => ({
              path: image.path,
              name: image.name,
              bytes: image.bytes,
            })),
          }
        },
      }),
      'dsh-minimax-image: tool',
    )
    registrations.tool = true
    log('tool registered')
  })
}

function expandUserPath(value) {
  let text = String(value ?? '').trim()
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim()
  }
  text = text.replace(/%([^%]+)%/g, (match, name) => process.env[name] ?? match)
  if (text === '~') return homedir()
  if (/^~[\\/]/.test(text)) return join(homedir(), text.slice(2))
  return text
}

const REFERENCE_MIME = {
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.png': 'png',
  '.webp': 'webp',
  '.heic': 'heic',
  '.heif': 'heif',
}

/** Read local reference images as base64 data URIs for the edits endpoint. */
async function readReferenceImages(paths) {
  const out = []
  let total = 0
  for (const value of paths) {
    const absolute = expandUserPath(value)
    const ext = extname(absolute).toLowerCase()
    const mime = REFERENCE_MIME[ext]
    if (!mime) throw new Error(`不支持的参考图格式：${ext || '(没有扩展名)'}，支持 jpg/jpeg/png/webp/heic/heif`)
    let buffer
    try {
      buffer = await readFile(absolute)
    } catch {
      throw new Error(`读不到参考图：${absolute}`)
    }
    total += buffer.length
    if (total > 48 * 1024 * 1024) throw new Error('参考图合计超过 48 MB，请先压缩')
    out.push(`data:image/${mime};base64,${buffer.toString('base64')}`)
  }
  return out
}

function isSameOrigin(req) {
  const origin = req.headers?.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers?.host
  } catch {
    return false
  }
}

function writeJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(payload))
}

function readJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolvePromise, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error(`请求体过大（上限 ${Math.round(maxBytes / 1024 / 1024)} MB）`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (!text) return resolvePromise({})
      try {
        resolvePromise(JSON.parse(text))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}
