/**
 * Diagnosis: why does the plate keep getting cropped?
 *
 * Runs two controlled cases and prints the model's own `revised_prompt`, so we
 * can see what the text was actually turned into.
 *
 *   node scripts/diagnose-plate.mjs <reference.jpeg>
 */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'

import { editImages, generateImages } from '../lib/minimax.js'

const key = (process.env.MINIMAX_API_KEY || '').trim()
if (!key) {
  console.error('MINIMAX_API_KEY is not set')
  process.exit(2)
}

const ref = process.argv[2]
if (!ref) {
  console.error('usage: node scripts/diagnose-plate.mjs <reference.jpeg>')
  process.exit(2)
}

const outDir = await mkdtemp(join(tmpdir(), 'minimax-plate-'))
const MIME = { '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.webp': 'webp' }
const refBuffer = await readFile(ref)
const refUrl = `data:image/${MIME[extname(ref).toLowerCase()] || 'jpeg'};base64,${refBuffer.toString('base64')}`

async function save(tag, result) {
  for (const [index, image] of result.images.entries()) {
    const file = join(outDir, `${tag}-${index + 1}.${image.ext}`)
    await writeFile(file, image.buffer)
    console.log(`  saved ${file} (${image.size || '?'})`)
  }
  console.log(`  revised_prompt: ${result.images[0]?.revisedPrompt?.slice(0, 260) ?? '(none)'}…`)
  console.log(`  ms: ${result.ms}`)
}

// Case 1: their style of prompt (a complaint), same reference they kept re-editing.
const complaint = '盘子的最下方还是不完整，我要一个完整的盘子'
console.log(`case 1 (complaint prompt, editing the cropped reference): "${complaint}"`)
await save('1-complaint', await editImages({ apiKey: key, prompt: complaint, images: [refUrl], n: 1 }))

// Case 2: same reference, but phrased as a composition instruction with an
// explicit outcome and margins, no words describing the defect.
const instruction = '让整只盘子完整出现在画面里，盘子边缘不接触画面四边，盘子四周留出桌面空白，保持俯拍和现在的画风'
console.log(`\ncase 2 (instruction prompt, same reference): "${instruction}"`)
await save('2-instruction', await editImages({ apiKey: key, prompt: instruction, images: [refUrl], n: 1 }))

// Case 3: fresh generation, no reference, same instruction, square frame.
console.log('\ncase 3 (fresh generation, square, no reference inertia)')
await save('3-fresh', await generateImages({
  apiKey: key,
  prompt: instruction,
  aspectRatio: '1:1',
  area: '2K',
  n: 1,
}))

console.log(`\noutput dir: ${outDir}`)
