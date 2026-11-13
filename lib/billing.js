/**
 * Official consumption summary behind the console's 消费明细 page.
 *
 * `platform.minimax.cn/console/consumption-detail` is a logged-in SPA, but the
 * endpoint it calls (`GET /account/amount`) accepts the API key directly. The
 * rows are aggregated by hour and billing item — there is no request_id and no
 * per-generation amount — so this is only good for account totals.
 *
 * Verified 2026-11-13 against api.minimax.chat / api.minimaxi.com:
 *   - 200 with `charge_records`, `consume_cash_after_voucher_sum`, `total_cnt`
 *   - `consume_time` looks like "2026-11-12 20:00-21:00" (Asia/Shanghai)
 */

import { dayStamp } from './util.js'

const BILL_LIMIT = 100

function toNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

/**
 * Fetch the account's billing rows for the last `days` days.
 *
 * @returns {Promise<{days:number, since:string, until:string, total:number,
 *   totalBeforeVoucher:number, tokens:number, records:number, latest:string,
 *   currency:string, fetchedAt:string}>}
 */
export async function fetchBill({ apiKey, base, days = 7, currency = 'CNY', timeoutMs = 12000 }) {
  const until = new Date()
  const since = new Date(until.getTime() - (days - 1) * 24 * 60 * 60 * 1000)
  const query = new URLSearchParams({
    page: '1',
    limit: String(BILL_LIMIT),
    aggregate: 'true',
    start_date: dayStamp(since),
    end_date: dayStamp(until),
  })

  let response
  try {
    response = await fetch(`${base}/account/amount?${query}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw new Error(`账单接口连不上：${error?.message ?? error}`)
  }

  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`账单接口返回了非 JSON 响应（HTTP ${response.status}）`)
  }

  const status = json?.base_resp?.status_code
  if (!response.ok || (status !== undefined && Number(status) !== 0)) {
    throw new Error(json?.base_resp?.status_msg || `账单接口返回 HTTP ${response.status}`)
  }

  const rows = Array.isArray(json?.charge_records) ? json.charge_records : []
  const latest = rows.reduce((best, row) => {
    const at = toNumber(row?.created_at)
    return at > best.at ? { at, label: String(row?.consume_time ?? '') } : best
  }, { at: 0, label: '' })

  return {
    days,
    since: dayStamp(since),
    until: dayStamp(until),
    // 实付（券/折扣之后）；没有这个字段时退回原价合计。
    total: toNumber(json?.consume_cash_after_voucher_sum ?? json?.consume_cash_sum),
    totalBeforeVoucher: toNumber(json?.consume_cash_sum),
    tokens: toNumber(json?.consume_token_sum),
    records: toNumber(json?.total_cnt) || rows.length,
    latest: latest.label,
    currency,
    fetchedAt: new Date().toISOString(),
  }
}
