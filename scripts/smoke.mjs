/**
 * Smoke test for the host-side MiniMax client.
 *
 *   $env:MINIMAX_API_KEY = 'sk-api-...'
 *   node scripts/smoke.mjs
 *
 * Verifies a real generation (bytes on disk) and the error path for a bad key.
 */

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { generateImages } from '../lib/minimax.js'

const key = (process.env.MINIMAX_API_KEY || '').trim()
if (!key) {
  console.error('MINIMAX_API_KEY is not set')
  process.exit(2)
}

const outDir = await mkdtemp(join(tmpdir(), 'minimax-smoke-'))
console.log(`output: ${outDir}`)

const started = Date.now()
const result = await generateImages({
  apiKey: key,
  prompt: 'a single ripe peach on a wooden table, soft window light, minimal',
  aspectRatio: '1:1',
  n: 1,
  region: 'intl',
})
console.log(`ok: ${result.images.length} image(s) in ${result.ms}ms (wall ${Date.now() - started}ms)`)
console.log(`meta: ${JSON.stringify(result.meta)}`)

for (let index = 0; index < result.images.length; index += 1) {
  const image = result.images[index]
  const buffer = image.buffer
  const file = join(outDir, `smoke-${index + 1}.${image.ext ?? 'jpg'}`)
  await writeFile(file, buffer)
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8
  console.log(`  ${file}  ${buffer.length} bytes  size=${image.size || '-'}  jpeg=${isJpeg}`)
}

// Error path: an invalid key must surface a readable message, not a stack trace.
try {
  await generateImages({ apiKey: 'sk-api-invalid-key-for-test', prompt: 'x', region: 'intl' })
  console.log('UNEXPECTED: invalid key succeeded')
} catch (error) {
  console.log(`expected failure: ${error.message}`)
}
