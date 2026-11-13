/**
 * Exercise the plugin's own /edit route (the path the panel uses).
 *
 *   node scripts/route-edit.mjs <image> "<edit prompt>"
 */

import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

const [file, prompt = '把图1的主色调改成冷蓝色调，构图不变'] = process.argv.slice(2)
if (!file) {
  console.error('usage: node scripts/route-edit.mjs <image> "<prompt>"')
  process.exit(2)
}

const MIME = { '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.webp': 'webp' }
const buffer = await readFile(file)
const dataUrl = `data:image/${MIME[extname(file).toLowerCase()] || 'jpeg'};base64,${buffer.toString('base64')}`
console.log(`reference: ${file} (${(buffer.length / 1024 / 1024).toFixed(2)} MiB)`)

const started = Date.now()
const response = await fetch('http://127.0.0.1:49979/dsh-minimax-image/edit', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt, images: [dataUrl], n: 1 }),
})
const text = await response.text()
console.log(`HTTP ${response.status} in ${((Date.now() - started) / 1000).toFixed(1)}s`)

let json
try {
  json = JSON.parse(text)
} catch {
  console.log(text.slice(0, 600))
  process.exit(1)
}
if (!json.ok) {
  console.log(`error: ${json.error}`)
  process.exit(1)
}
console.log(`kind=${json.kind} refs=${json.refs} ms=${json.ms} dir=${json.directory}`)
for (const image of json.images) console.log(`  ${image.name} ${image.bytes} bytes ${image.size}`)
