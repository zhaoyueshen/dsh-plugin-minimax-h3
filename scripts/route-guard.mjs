/**
 * Route-level check for 构图护栏 + the per-model count cap.
 *
 *   node scripts/route-guard.mjs
 *
 * Talks to the running plugin (no API key needed here — the host already has one)
 * and spends two real generations: one 1:1 @1K text-to-image, one edit of it.
 * Everything it changes is restored before it exits.
 */

import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

const BASE = (process.env.DSH_WEB_URL || 'http://127.0.0.1:58093') + '/dsh-minimax-image'

let failures = 0
const ok = (label) => console.log(`  PASS ${label}`)
const bad = (label, detail) => {
  failures += 1
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
}
const check = (condition, label, detail) => (condition ? ok(label) : bad(label, detail))

async function call(path, init) {
  const response = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.ok === false) {
    throw new Error(`${init?.method ?? 'GET'} ${path} -> ${response.status}: ${payload?.error ?? 'no error message'}`)
  }
  return payload
}

const post = (path, body) => call(path, { method: 'POST', body: JSON.stringify(body) })

const MIME = { '.jpeg': 'jpeg', '.jpg': 'jpeg', '.png': 'png', '.webp': 'webp' }

const before = (await call('/settings')).settings
console.log(`plugin: model=${before.model} n=${before.n} guard=${before.guard}`)

try {
  // --- 1. the count cap follows the model family (no API call) -------------
  console.log('\n[1] 张数上限')
  const legacy = (await post('/settings', { model: 'image-01', n: 10 })).settings
  check(legacy.n === 9, 'image-01 家族把 10 钳到 9', `got n=${legacy.n}`)
  const h3 = (await post('/settings', { model: 'MiniMax-H3-Image', n: 12 })).settings
  check(h3.n === 10, 'H3 家族把 12 钳到 10', `got n=${h3.n}`)
  check(h3.guard === before.guard, '保存张数不会顺手改掉护栏开关')

  // --- 2. guard on: text-to-image -----------------------------------------
  console.log('\n[2] 构图护栏 · 文生图')
  const prompt = '一只白瓷盘平放在浅色木桌上，俯拍，柔和自然光'
  const generated = await post('/generate', {
    prompt,
    aspectRatio: '1:1',
    area: '1K',
    n: 1,
    model: 'MiniMax-H3-Image',
    guard: true,
  })
  check(generated.guard === true, '响应回带 guard=true', JSON.stringify(generated.guard))
  check(generated.images?.length === 1, '落盘 1 张', `${generated.images?.length} 张`)
  check(generated.prompt === prompt, '响应里的提示词仍是原话（护栏不改写用户输入）')

  const image = generated.images?.[0]
  check(Boolean(image?.path), '返回本机绝对路径')
  let bytes = 0
  if (image?.path) {
    const buffer = await readFile(image.path)
    bytes = buffer.length
    check(buffer[0] === 0xff && buffer[1] === 0xd8, '文件是真正的 JPEG', `magic=${buffer.subarray(0, 2).toString('hex')}`)
  }
  console.log(`     ${image?.path}  ${bytes} bytes  ${image?.size ?? '-'}  ${((generated.ms ?? 0) / 1000).toFixed(1)}s`)

  // --- 3. history keeps the user's words plus the flag ---------------------
  console.log('\n[3] 历史记录')
  const history = await call('/history?limit=1')
  const entry = history.history?.[0]
  check(entry?.guard === true, '历史条目标了 guard=true')
  check(entry?.prompt === prompt, '历史里存的是原提示词，没有护栏后缀', entry?.prompt)
  check(!String(entry?.prompt ?? '').includes('构图要求'), '护栏后缀没有写进历史')

  // --- 4. guard on: edit the image we just made ---------------------------
  console.log('\n[4] 构图护栏 · 图片编辑')
  if (image?.path) {
    const buffer = await readFile(image.path)
    const mime = MIME[extname(image.path).toLowerCase()] ?? 'jpeg'
    const dataUrl = `data:image/${mime};base64,${buffer.toString('base64')}`
    const edited = await post('/edit', {
      prompt: '把白瓷盘换成深色粗陶盘，构图和光线保持不变',
      images: [dataUrl],
      n: 1,
      model: 'MiniMax-H3-Image',
      guard: true,
    })
    check(edited.guard === true, '编辑响应回带 guard=true')
    check(edited.kind === 'edit' && edited.refs === 1, '走的是编辑链路且 refs=1', `kind=${edited.kind} refs=${edited.refs}`)
    check(edited.images?.length === 1, '编辑落盘 1 张', `${edited.images?.length} 张`)
    console.log(`     ${edited.images?.[0]?.path}  ${edited.images?.[0]?.size ?? '-'}  ${((edited.ms ?? 0) / 1000).toFixed(1)}s`)
  }

  // --- 5. the switch is per-request overridable ---------------------------
  console.log('\n[5] 开关可被单次请求覆盖')
  const off = (await post('/settings', { guard: false })).settings
  check(off.guard === false, '面板开关能存成 false')
  const diag = await call('/diag')
  check(diag.settings.guard === false, 'diag 反映最新开关')
} catch (error) {
  failures += 1
  console.log(`\nFAIL ${error.message}`)
} finally {
  // Put the panel back the way the user left it.
  await post('/settings', {
    model: before.model,
    n: before.n,
    guard: before.guard,
    aspectRatio: before.aspectRatio,
    area: before.area,
  }).catch(() => {})
  console.log(`\nrestored: model=${before.model} n=${before.n} guard=${before.guard}`)
}

console.log(failures ? `\n${failures} check(s) failed` : '\nOK: guard + count cap verified end to end')
process.exit(failures ? 1 : 0)
