/**
 * Small dependency-free helpers for dsh-minimax-image.
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

export const WIN = process.platform === 'win32'

/** Stable path identity across slash style, case, and trailing separators. */
export function pathKey(value) {
  let text = resolve(String(value ?? ''))
  if (WIN) text = text.toLowerCase()
  text = text.replace(/[\\/]+$/, '')
  return text || (WIN ? 'c:' : '/')
}

/** True when `child` is `parent` or lives below it. */
export function isInside(child, parent) {
  const c = pathKey(child)
  const p = pathKey(parent)
  if (c === p) return true
  return c.startsWith(p.endsWith(sep) ? p : p + sep)
}

export async function ensureDir(path) {
  await mkdir(path, { recursive: true })
}

/** Atomic UTF-8 JSON write (rename with a unlink fallback on Windows). */
export async function writeJsonAtomic(file, value) {
  await ensureDir(dirname(file))
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  try {
    await rename(temp, file)
  } catch {
    try {
      await unlink(file)
    } catch {
      /* absent */
    }
    await rename(temp, file)
  }
}

/** Read JSON, returning `fallback` for a missing or corrupt file. */
export async function readJsonFile(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

/** Best-effort append-only diagnostic log. */
export function makeLogger(file) {
  return function log(message) {
    try {
      mkdirSync(dirname(file), { recursive: true })
      appendFileSync(file, `[${new Date().toISOString()}] ${message}\n`, 'utf8')
    } catch {
      /* diagnostics must never break the feature */
    }
  }
}

const two = (n) => String(n).padStart(2, '0')

/** `YYYYMMDD-HHmmss`, safe on NTFS and sortable. */
export function stamp(date = new Date()) {
  return [
    date.getFullYear(),
    two(date.getMonth() + 1),
    two(date.getDate()),
    '-',
    two(date.getHours()),
    two(date.getMinutes()),
    two(date.getSeconds()),
  ].join('')
}

/** `YYYY-MM-DD`, used as the per-day output folder. */
export function dayStamp(date = new Date()) {
  return [date.getFullYear(), two(date.getMonth() + 1), two(date.getDate())].join('-')
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB']
  let size = value / 1024
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size >= 100 ? size.toFixed(0) : size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[unit]}`
}

/** Show only the head and tail of a secret. */
export function maskKey(value) {
  const text = String(value ?? '')
  if (!text) return ''
  if (text.length <= 14) return `${text.slice(0, 4)}…`
  return `${text.slice(0, 7)}…${text.slice(-4)}`
}

/** Clamp a requested image count to the API's practical range. */
export function clampCount(value, min = 1, max = 9) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}
