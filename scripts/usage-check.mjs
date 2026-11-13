/**
 * Offline check: the H3 response's `usage` block must survive into meta.
 *
 * The panel's cost badge is computed from those token counts, so dropping the
 * block silently turns every new row into a table estimate. Mocks fetch — no
 * network, no spend.
 */

import { generateImages } from '../lib/minimax.js'

const USAGE = {
  generated_images: 1,
  total_tokens: 7254,
  input_tokens: 3174,
  output_tokens: 4080,
  input_tokens_details: { text_tokens: 3174, image_tokens: 0 },
  output_tokens_details: { image_tokens: 4080 },
}

const realFetch = globalThis.fetch
globalThis.fetch = async (url) => {
  const target = String(url)
  if (target.endsWith('/v1/images/generations')) {
    return new Response(JSON.stringify({
      created: 1792308678,
      data: [{ url: 'https://example.test/img.png', size: '1024x1024' }],
      output_format: 'jpeg',
      usage: USAGE,
      request_id: 'req-test',
    }), { status: 200 })
  }
  return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200 })
}

try {
  const result = await generateImages({ apiKey: 'test-key', prompt: 'test', model: 'MiniMax-H3-Image' })
  const usage = result.meta?.usage
  if (!usage) throw new Error('meta.usage is missing')
  if (usage.total_tokens !== 7254) throw new Error(`total_tokens lost: ${usage.total_tokens}`)
  if (usage.input_tokens_details?.text_tokens !== 3174) throw new Error('text token detail lost')
  if (usage.output_tokens_details?.image_tokens !== 4080) throw new Error('output image token detail lost')
  if (result.images.length !== 1) throw new Error(`expected 1 image, got ${result.images.length}`)
  console.log('usage-check: meta.usage keeps generated_images / total / text / image tokens')
} finally {
  globalThis.fetch = realFetch
}
