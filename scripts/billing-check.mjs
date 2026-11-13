/**
 * Offline check for the official-bill client: no network, no spend.
 *
 * Mocks the console `GET /account/amount` response and asserts that the summary
 * fields the panel shows survive parsing.
 */

import { fetchBill } from '../lib/billing.js'

const realFetch = globalThis.fetch
let requested = ''
globalThis.fetch = async (url) => {
  requested = String(url)
  return new Response(JSON.stringify({
    charge_records: [
      {
        method: 'image-generation',
        model: 'MiniMax-H3-Image',
        consume_cash: '2.0400',
        consume_cash_after_voucher: '2.0400',
        consume_output_token: '81600',
        consume_time: '2026-11-12 20:00-21:00',
        created_at: 1794484800,
      },
      {
        method: 'image-generation',
        model: 'MiniMax-H3-Image-text-input',
        consume_cash: '1.4880',
        consume_cash_after_voucher: '1.4880',
        consume_input_token: '99200',
        consume_time: '2026-11-12 18:00-19:00',
        created_at: 1794477600,
      },
    ],
    total_cnt: 17,
    consume_cash_sum: '6.5792',
    consume_cash_after_voucher_sum: '6.5792',
    consume_token_sum: '527887',
    base_resp: { status_code: 0, status_msg: 'success' },
  }), { status: 200 })
}

try {
  const bill = await fetchBill({ apiKey: 'test-key', base: 'https://api.example.test', days: 7, currency: 'CNY' })
  if (!requested.includes('/account/amount?')) throw new Error('wrong endpoint')
  if (!requested.includes('aggregate=true')) throw new Error('aggregate not requested')
  if (!requested.includes('limit=100')) throw new Error('limit not requested')
  if (bill.total !== 6.5792) throw new Error(`total lost: ${bill.total}`)
  if (bill.tokens !== 527887) throw new Error(`tokens lost: ${bill.tokens}`)
  if (bill.records !== 17) throw new Error(`record count lost: ${bill.records}`)
  if (bill.latest !== '2026-11-12 20:00-21:00') throw new Error(`latest lost: ${bill.latest}`)
  if (bill.currency !== 'CNY') throw new Error(`currency lost: ${bill.currency}`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bill.since) || !/^\d{4}-\d{2}-\d{2}$/.test(bill.until)) {
    throw new Error('date range malformed')
  }
  console.log(`billing-check: ${bill.since}..${bill.until} total=${bill.total} ${bill.currency} latest=${bill.latest}`)
} finally {
  globalThis.fetch = realFetch
}
