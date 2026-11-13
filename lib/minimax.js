/**
 * MiniMax image client. Two API families live behind this module:
 *
 *   h3      POST /v1/images/generations  model: MiniMax-H3-Image
 *           OpenAI-shaped response: data[] with url | error, output_format, usage
 *   legacy  POST /v1/image_generation    model: image-01 / image-01-live
 *           proprietary response: data.image_urls + base_resp.status_code
 *
 * Verified live on 2026-11-12 (api.minimax.cn / api.minimaxi.com / api.minimax.chat):
 *   MiniMax-H3-Image               -> 200, 2720x1536 for 16:9 @ area 2K
 *   MiniMax-H3-Image-Highspeed     -> same parameters as MiniMax-H3-Image
 *   image-01 / image-01-live       -> 200 on the legacy endpoint
 *   image-01 on the H3 endpoint    -> unsupported model (families do not mix)
 */

import { clampCount } from './util.js'

export const REGIONS = {
  // Both hosts in use here are billed in CNY. api.minimax.chat is the
  // compatibility domain this CN key uses; api.minimax.io (USD) rejects it.
  intl: { id: 'intl', label: '国际站', base: 'https://api.minimax.chat', currency: 'CNY' },
  cn: { id: 'cn', label: '国内站', base: 'https://api.minimaxi.com', currency: 'CNY' },
}

export const MODELS = [
  { id: 'MiniMax-H3-Image', label: 'H3 标准（推荐）', family: 'h3', area: true },
  { id: 'MiniMax-H3-Image-Highspeed', label: 'H3 高速版', family: 'h3', area: true },
  { id: 'image-01', label: 'image-01（上一代）', family: 'legacy', area: false },
  { id: 'image-01-live', label: 'image-01-live（上一代·风格化）', family: 'legacy', area: false },
]

export const MODEL_IDS = MODELS.map((model) => model.id)

/** H3 area presets: 1K ≈ 1024², 2K ≈ 2048², 4K ≈ 4096² target pixels. */
export const AREAS = ['1K', '2K', '4K']

export const ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9']

const LEGACY_STATUS_TEXT = {
  1002: '请求过于频繁，触发限流，请稍后重试',
  1004: 'API key 无效或没有携带',
  1008: '账户余额不足',
  1013: '服务端内部错误，请稍后重试',
  2013: '参数不合法',
  2042: '并发超限，请稍后重试',
}

/** H3 side errors arrive as strings in data[].error.code / top-level error.code. */
const H3_STATUS_TEXT = {
  1004: 'API key 无效或没有携带',
  1008: '账户余额不足',
  1027: '输出图片未通过内容安全检查',
  2013: '参数不合法',
  2042: '并发超限，请稍后重试',
}

export function modelDef(id) {
  return MODELS.find((model) => model.id === id) ?? MODELS[0]
}

function networkMessage(error) {
  const name = error?.name ?? ''
  const text = String(error?.message ?? error)
  if (name === 'TimeoutError' || /timeout|timed out/i.test(text)) {
    return '请求超时：MiniMax 没有在限定时间内返回，稍后重试或降低张数/分辨率'
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(text)) return '域名解析失败，检查网络或代理设置'
  if (/ECONNREFUSED|ECONNRESET|socket hang up/i.test(text)) return '连接被中断，检查网络或代理设置'
  return `网络请求失败：${text}`
}

async function postJson(url, apiKey, payload, timeoutMs) {
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw new Error(networkMessage(error))
  }

  const bodyText = await response.text()
  let json
  try {
    json = JSON.parse(bodyText)
  } catch {
    throw new Error(`接口返回了非 JSON 响应（HTTP ${response.status}）：${bodyText.slice(0, 240)}`)
  }
  return { response, json, bodyText }
}

async function download(url, timeoutMs) {
  let fileResponse
  try {
    fileResponse = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    throw new Error(`图片下载失败：${networkMessage(error)}`)
  }
  if (!fileResponse.ok) throw new Error(`图片下载失败：HTTP ${fileResponse.status}`)
  return Buffer.from(await fileResponse.arrayBuffer())
}

/** H3 family: /v1/images/generations. */
async function generateH3({ apiKey, prompt, model, aspectRatio, n, area, base, timeoutMs }) {
  const payload = {
    model,
    prompt,
    size: 'auto',
    aspect_ratio: aspectRatio,
    area,
    n: clampCount(n, 1, 10),
    response_format: 'url',
  }
  return callH3({ apiKey, url: `${base}/v1/images/generations`, payload, timeoutMs })
}

/** H3 family: /v1/images/edits — prompt + 1..16 reference images. */
async function editH3({ apiKey, prompt, images, model, aspectRatio, area, n, base, timeoutMs }) {
  const payload = {
    model,
    prompt,
    images: images.map((url) => ({ image_url: url })),
    size: 'auto',
    n: clampCount(n ?? 1, 1, 10),
    response_format: 'url',
  }
  // Edits keep the reference composition; only pin a ratio when explicitly asked.
  if (aspectRatio) payload.aspect_ratio = aspectRatio
  if (area) payload.area = area
  return callH3({ apiKey, url: `${base}/v1/images/edits`, payload, timeoutMs })
}

/** Shared H3 request/parse path (OpenAI-shaped: data[] with url | error). */
async function callH3({ apiKey, url, payload, timeoutMs }) {
  const { response, json } = await postJson(url, apiKey, payload, timeoutMs)
  const items = Array.isArray(json?.data) ? json.data : []

  // A total failure can still come back without usable data.
  if (!response.ok) {
    const firstError = items.find((item) => item?.error)?.error
    const code = firstError?.code ?? json?.error?.code ?? String(response.status)
    const detail = firstError?.message ?? json?.error?.message ?? `HTTP ${response.status}`
    const friendly = H3_STATUS_TEXT[Number(code)]
    throw new Error(friendly ? `${friendly}（${code}：${detail}）` : detail)
  }

  const rawFormat = String(json?.output_format ?? 'jpeg').toLowerCase()
  const ext = rawFormat === 'jpg' ? 'jpeg' : rawFormat
  const images = []
  const warnings = []

  for (const [index, item] of items.entries()) {
    if (item?.error) {
      const code = item.error.code
      const friendly = H3_STATUS_TEXT[Number(code)]
      warnings.push(`第 ${index + 1} 张失败：${friendly ?? item.error.message ?? code}`)
      continue
    }
    if (!item?.url) {
      warnings.push(`第 ${index + 1} 张没有返回地址`)
      continue
    }
    images.push({ buffer: await download(item.url, timeoutMs), ext, size: item.size ?? '', revisedPrompt: item.revised_prompt ?? '' })
  }

  if (!images.length) {
    throw new Error(warnings.length ? warnings.join('；') : '接口没有返回可用图片')
  }

  return {
    images,
    warnings,
    meta: {
      id: json?.request_id ?? '',
      requested: Number(payload.n ?? 1),
      success: Number(json?.usage?.generated_images ?? images.length),
      failed: warnings.length,
      // Billing usage (tokens per modality), kept verbatim so the panel can
      // turn it into money. The API returns no price itself.
      usage: json?.usage && typeof json.usage === 'object' ? json.usage : null,
    },
  }
}

/** Legacy family: /v1/image_generation. */
async function generateLegacy({ apiKey, prompt, model, aspectRatio, n, base, timeoutMs }) {
  const payload = {
    model,
    prompt,
    aspect_ratio: aspectRatio,
    n: clampCount(n, 1, 9),
    response_format: 'url',
    prompt_optimizer: true,
  }

  const { response, json, bodyText } = await postJson(`${base}/v1/image_generation`, apiKey, payload, timeoutMs)
  if (!response.ok) throw new Error(`HTTP ${response.status}：${bodyText.slice(0, 240)}`)

  const statusCode = json?.base_resp?.status_code
  if (statusCode !== 0) {
    const detail = json?.base_resp?.status_msg || '接口返回失败'
    const friendly = LEGACY_STATUS_TEXT[statusCode]
    throw new Error(friendly ? `${friendly}（${statusCode}：${detail}）` : `${detail}（${statusCode}）`)
  }

  const urls = Array.isArray(json?.data?.image_urls) ? json.data.image_urls : []
  if (!urls.length) throw new Error(`接口没有返回图片：${JSON.stringify(json).slice(0, 240)}`)

  const images = []
  for (const url of urls) images.push({ buffer: await download(url, timeoutMs), ext: 'jpeg', size: '', revisedPrompt: '' })

  return {
    images,
    warnings: [],
    meta: {
      id: json?.id ?? '',
      requested: payload.n,
      success: Number(json?.metadata?.success_count ?? images.length),
      failed: Number(json?.metadata?.failed_count ?? 0),
    },
  }
}

/**
 * Generate images and return their bytes.
 *
 * @returns {Promise<{images: Array<{buffer: Buffer, ext: string, size: string, revisedPrompt: string}>,
 *                    warnings: string[], meta: object, ms: number}>}
 */
export async function generateImages({
  apiKey,
  prompt,
  model = MODEL_IDS[0],
  aspectRatio = '1:1',
  n = 1,
  area = '2K',
  region = 'intl',
  timeoutMs = 300000,
}) {
  const key = String(apiKey ?? '').trim()
  if (!key) throw new Error('还没有配置 MiniMax API key，请先在面板里填入')
  const text = String(prompt ?? '').trim()
  if (!text) throw new Error('请先写画面描述')

  const def = modelDef(model)
  const base = (REGIONS[region] ?? REGIONS.intl).base
  const started = Date.now()
  const input = {
    apiKey: key,
    prompt: text,
    model: def.id,
    aspectRatio,
    n,
    area: AREAS.includes(area) ? area : '2K',
    base,
    timeoutMs,
  }

  const result = def.family === 'h3' ? await generateH3(input) : await generateLegacy(input)

  return {
    ...result,
    ms: Date.now() - started,
    meta: { ...result.meta, family: def.family, model: def.id },
  }
}

const DATA_URI = /^data:image\/[a-z0-9.+-]+;base64,/i

export const MAX_REFERENCES = 16

/**
 * Edit images: prompt + 1..16 reference images. H3 only.
 *
 * References may be `data:image/<fmt>;base64,…` URIs or public https URLs; the
 * caller decides how to obtain them (the panel reads local files, the agent tool
 * accepts local paths).
 */
export async function editImages({
  apiKey,
  prompt,
  images,
  model = MODEL_IDS[0],
  aspectRatio = '',
  area = '',
  n = 1,
  region = 'intl',
  timeoutMs = 300000,
}) {
  const key = String(apiKey ?? '').trim()
  if (!key) throw new Error('还没有配置 MiniMax API key，请先在面板里填入')
  const text = String(prompt ?? '').trim()
  if (!text) throw new Error('请先写编辑要求，例如「把图1的猫换成图2里的柴犬」')

  const refs = (Array.isArray(images) ? images : [])
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim())
  if (!refs.length) throw new Error('图片编辑至少需要 1 张参考图')
  if (refs.length > MAX_REFERENCES) throw new Error(`参考图最多 ${MAX_REFERENCES} 张`)
  for (const ref of refs) {
    if (!DATA_URI.test(ref) && !/^https?:\/\//i.test(ref)) {
      throw new Error('参考图必须是 base64 data URI 或公网 URL')
    }
  }

  const def = modelDef(model)
  if (def.family !== 'h3') throw new Error('图片编辑只支持 H3 模型')

  const base = (REGIONS[region] ?? REGIONS.intl).base
  const started = Date.now()
  const result = await editH3({
    apiKey: key,
    prompt: text,
    images: refs,
    model: def.id,
    aspectRatio,
    area: AREAS.includes(area) ? area : '',
    n,
    base,
    timeoutMs,
  })

  return {
    ...result,
    ms: Date.now() - started,
    meta: { ...result.meta, family: 'h3', model: def.id, references: refs.length },
  }
}
