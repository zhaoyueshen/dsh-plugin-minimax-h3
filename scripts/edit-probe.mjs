/**
 * Probe the H3 image-editing endpoint with local files as base64 data URIs.
 *
 *   node scripts/edit-probe.mjs <image1> <image2> [prompt]
 *
 * Prints the response shape and saves any returned images next to the script.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

const key = (process.env.MINIMAX_API_KEY || '').trim()
if (!key) {
  console.error('MINIMAX_API_KEY is not set')
  process.exit(2)
}

const files = process.argv.slice(2, 4)
if (files.length < 1) {
  console.error('usage: node scripts/edit-probe.mjs <image1> [image2] [prompt]')
  process.exit(2)
}
const prompt = process.argv[4] || '把图1的主色调改成冷蓝色调，保持构图不变'

const MIME = { '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.webp': 'webp', '.heic': 'heic', '.heif': 'heif', '.gif': 'gif' }

const images = []
for (const file of files) {
  const buffer = await readFile(file)
  const mime = MIME[extname(file).toLowerCase()] || 'jpeg'
  images.push({ image_url: `data:image/${mime};base64,${buffer.toString('base64')}` })
  console.log(`ref ${basename(file)}: ${buffer.length} bytes -> base64 ${Math.round(buffer.length * 4 / 3)}`)
}

const payload = {
  model: 'MiniMax-H3-Image',
  prompt,
  images,
  size: 'auto',
  n: 1,
  response_format: 'url',
}
const body = Buffer.byteLength(JSON.stringify(payload))
console.log(`request body: ${(body / 1024 / 1024).toFixed(2)} MiB`)

const started = Date.now()
const response = await fetch('https://api.minimax.cn/v1/images/edits', {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
  signal: AbortSignal.timeout(600000),
})
const text = await response.text()
console.log(`HTTP ${response.status} in ${((Date.now() - started) / 1000).toFixed(1)}s`)
console.log(text.slice(0, 1200))

let json
try {
  json = JSON.parse(text)
} catch {
  process.exit(1)
}

const items = Array.isArray(json.data) ? json.data : []
for (const [index, item] of items.entries()) {
  if (item.error) {
    console.log(`item ${index}: ERROR ${JSON.stringify(item.error)}`)
    continue
  }
  const url = item.url
  console.log(`item ${index}: size=${item.size} url=${url ? url.slice(0, 60) + '…' : 'none'}`)
  if (!url) continue
  const file = await fetch(url, { signal: AbortSignal.timeout(300000) })
  const buffer = Buffer.from(await file.arrayBuffer())
  const out = join(process.cwd(), `edit-result-${index}.${json.output_format ?? 'jpeg'}`)
  await writeFile(out, buffer)
  console.log(`  saved ${out} (${buffer.length} bytes)`)
}
