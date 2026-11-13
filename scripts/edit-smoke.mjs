/**
 * Smoke test for lib.editImages (H3 image editing).
 *
 *   $env:MINIMAX_API_KEY = 'sk-api-...'
 *   node scripts/edit-smoke.mjs <image1> [image2] [prompt]
 */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'

import { editImages } from '../lib/minimax.js'

const key = (process.env.MINIMAX_API_KEY || '').trim()
if (!key) {
  console.error('MINIMAX_API_KEY is not set')
  process.exit(2)
}

const files = process.argv.slice(2, 4)
if (!files.length) {
  console.error('usage: node scripts/edit-smoke.mjs <image1> [image2] [prompt]')
  process.exit(2)
}
const prompt = process.argv[4] || '把图1的主色调改成冷蓝色调，构图不变'

const MIME = { '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.webp': 'webp', '.heic': 'heic', '.heif': 'heif' }
const refs = []
for (const file of files) {
  const buffer = await readFile(file)
  const mime = MIME[extname(file).toLowerCase()] || 'jpeg'
  refs.push(`data:image/${mime};base64,${buffer.toString('base64')}`)
}

const outDir = await mkdtemp(join(tmpdir(), 'minimax-edit-'))
const result = await editImages({ apiKey: key, prompt, images: refs, n: 1 })
console.log(`ok: ${result.images.length} image(s) in ${result.ms}ms`)
console.log(`meta: ${JSON.stringify(result.meta)}`)
console.log(`warnings: ${result.warnings.length ? result.warnings.join('；') : '(none)'}`)

for (const [index, image] of result.images.entries()) {
  const file = join(outDir, `edit-${index + 1}.${image.ext}`)
  await writeFile(file, image.buffer)
  console.log(`  ${file}  ${image.buffer.length} bytes  size=${image.size || '-'}`)
}
console.log(`revised_prompt: ${(result.images[0]?.revisedPrompt || '').slice(0, 160)}…`)
