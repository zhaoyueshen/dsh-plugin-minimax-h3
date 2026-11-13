/**
 * dsh-minimax-image — browser half.
 *
 * A sidebar page (plus its matching `main` slot) for generating images with the
 * MiniMax image API. All network and disk work happens on the host plugin; this
 * file only renders the form and shows the saved results.
 */

window.__ModuleLoader__.load({
  id: 'dsh-minimax-image',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const BASE = '/dsh-minimax-image'
    const VERSION = '0.2.4'

    const C = {
      page: 'var(--dsw-alias-bg-base, #f6f7f9)',
      card: 'var(--dsw-alias-bg-layer-1, #ffffff)',
      soft: 'var(--dsw-alias-bg-layer-2, #f2f4f7)',
      border: 'var(--dsw-alias-border-l2, rgba(20, 24, 32, 0.10))',
      borderStrong: 'var(--dsw-alias-border-l3, rgba(20, 24, 32, 0.16))',
      text: 'var(--dsw-alias-label-primary, #1f2329)',
      muted: 'var(--dsw-alias-label-secondary, #5f6672)',
      faint: 'var(--dsw-alias-label-tertiary, #8b919b)',
      primary: 'var(--dsw-alias-button-primary-fill, #4d6bfe)',
      primaryHover: 'var(--dsw-alias-button-primary-hover, #3f5ae0)',
      primaryText: 'var(--dsw-alias-button-primary-label, #ffffff)',
      hover: 'var(--dsw-alias-interactive-bg-hover, rgba(20, 24, 32, 0.05))',
      success: 'var(--dsw-alias-state-success-primary, #16894a)',
      successSoft: 'var(--dsw-alias-state-success-tertiary, rgba(22, 137, 74, 0.10))',
      warn: 'var(--dsw-alias-state-warn-label, #a26512)',
      warnSoft: 'var(--dsw-alias-state-warn-tertiary, rgba(162, 101, 18, 0.10))',
      danger: 'var(--dsw-alias-state-error-primary, #c62f2f)',
      dangerSoft: 'var(--dsw-alias-state-error-tertiary, rgba(198, 47, 47, 0.09))',
    }

    const FONT = '13px/1.55 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif'

    const RATIO_LABEL = {
      '1:1': '正方形',
      '16:9': '横版宽幅',
      '9:16': '竖版长图',
      '4:3': '横版',
      '3:4': '竖版',
      '3:2': '横版偏宽',
      '2:3': '竖版偏高',
    }

    const EXAMPLES = [
      '一只橘猫趴在洒满阳光的窗台上，日系清新，浅景深',
      '极简主义产品海报，大面积留白，柔和渐变背景',
      '雨夜城市街道，霓虹灯倒影，电影感调色',
    ]

    const EDIT_EXAMPLES = [
      '把图1的猫换成一只柴犬，保留背景和光线',
      '把图1改成扁平矢量插画风格，构图不变',
      '把图2的配色方案套到图1上',
    ]

    async function api(path, init) {
      let response
      try {
        response = await fetch(BASE + path, {
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          ...init,
        })
      } catch (error) {
        throw new Error(`连不上出图服务：${error?.message ?? error}`)
      }
      let payload
      try {
        payload = await response.json()
      } catch {
        throw new Error(`出图服务返回了非 JSON 响应（HTTP ${response.status}）`)
      }
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error ?? `请求失败（HTTP ${response.status}）`)
      }
      return payload
    }

    function ratioValue(ratio) {
      const [w, ht] = String(ratio || '1:1').split(':').map((part) => Number(part) || 1)
      return w / ht
    }

    function formatBytes(bytes) {
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

    function timeLabel(iso) {
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return ''
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    // --- cost -------------------------------------------------------------
    // MiniMax returns usage, not money: H3 bills text input, reference-image
    // input and output images per million tokens, while the legacy image-01 API
    // bills per image. The host stores the raw `usage` block; rows written
    // before it did fall back to the official per-image example prices.
    //
    // Rates read 2026-11-13 from platform.minimax.io (USD, intl site) and
    // platform.minimax.cn (CNY, cn site). 4K output (any delivered image at
    // least 16.6 MP) is 50% off through 2026-11-17 16:00 UTC / 11-18 00:00 +08.
    const PRICE_AS_OF = '2026-11-13'
    const PROMO_ENDS_AT = Date.parse('2026-11-17T16:00:00Z')
    const PROMO_MIN_PIXELS = 16600000
    const PRICE_BOOKS = {
      usd: {
        currency: 'USD',
        symbol: '$',
        h3: {
          'MiniMax-H3-Image': { text: 2.3, imageIn: 1.5, imageOut: 3.8 },
          'MiniMax-H3-Image-Highspeed': { text: 2.3, imageIn: 3, imageOut: 7.6 },
        },
        legacy: { 'image-01': 0.0035, 'image-01-live': 0.0035 },
        // [text-to-image, 1 reference, 3 references], per image.
        table: {
          'MiniMax-H3-Image': {
            '1K': [0.02179, 0.02654, 0.03563],
            '2K': [0.02333, 0.02658, 0.04177],
            '4K': [0.06879, 0.07312, 0.07914],
          },
          'MiniMax-H3-Image-Highspeed': {
            '1K': [0.03529, 0.04525, 0.06037],
            '2K': [0.03622, 0.04576, 0.06069],
            '4K': [0.13001, 0.13673, 0.15407],
          },
        },
      },
      cny: {
        currency: 'CNY',
        symbol: '¥',
        h3: {
          'MiniMax-H3-Image': { text: 15, imageIn: 10, imageOut: 25 },
          'MiniMax-H3-Image-Highspeed': { text: 15, imageIn: 20, imageOut: 50 },
        },
        legacy: { 'image-01': 0.025, 'image-01-live': 0.025 },
        table: {
          'MiniMax-H3-Image': {
            '1K': [0.143, 0.1744, 0.2346],
            '2K': [0.1531, 0.1747, 0.2746],
            '4K': [0.4522, 0.4809, 0.5211],
          },
          'MiniMax-H3-Image-Highspeed': {
            '1K': [0.2319, 0.2978, 0.3982],
            '2K': [0.238, 0.3011, 0.4003],
            '4K': [0.855, 0.8998, 1.0146],
          },
        },
      },
    }

    function pixelCount(size) {
      const match = /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i.exec(String(size ?? ''))
      return match ? Number(match[1]) * Number(match[2]) : 0
    }

    /** Edits inherit their size from the references, so price by delivered pixels. */
    function priceArea(area, images) {
      if (area === '1K' || area === '2K' || area === '4K') return area
      let pixels = 0
      for (const image of images) pixels = Math.max(pixels, pixelCount(image?.size))
      if (pixels >= 8000000) return '4K'
      if (pixels >= 2500000) return '2K'
      return pixels ? '1K' : '2K'
    }

    function tablePrice(row, refs) {
      const count = Math.max(0, Math.round(Number(refs) || 0))
      if (count === 0) return row[0]
      if (count === 1) return row[1]
      if (count === 2) return (row[1] + row[2]) / 2
      return row[2] + (count - 3) * ((row[2] - row[1]) / 2)
    }

    function promoApplies(images, at) {
      const when = at instanceof Date ? at.getTime() : Date.parse(at ?? '')
      if (!Number.isFinite(when) || when >= PROMO_ENDS_AT) return false
      return images.some((image) => pixelCount(image?.size) >= PROMO_MIN_PIXELS)
    }

    function tokenLabel(tokens) {
      return `${Math.round(Number(tokens) || 0).toLocaleString('en-US')} tok`
    }

    /**
     * What one request cost. `usage` is what the API billed; `images` / `refs`
     * cover history rows that predate usage capture. `currency` follows the
     * account (CNY on the CN-billed hosts this panel uses).
     */
    function estimateCost(input, fallbackCurrency) {
      const record = input ?? {}
      const book = (record.currency || fallbackCurrency) === 'USD' ? PRICE_BOOKS.usd : PRICE_BOOKS.cny
      const images = Array.isArray(record.images) ? record.images : []
      const usage = record.usage && typeof record.usage === 'object' ? record.usage : null
      const count = images.length || Number(usage?.generated_images) || Number(record.n) || 1
      const rates = book.h3[record.model]
      const promo = promoApplies(images, record.at)

      if (rates && usage && (usage.total_tokens || usage.input_tokens || usage.output_tokens)) {
        const text = Number(usage.input_tokens_details?.text_tokens) || Number(usage.input_tokens) || 0
        const imageIn = Number(usage.input_tokens_details?.image_tokens) || 0
        const imageOut = Number(usage.output_tokens_details?.image_tokens) || Number(usage.output_tokens) || 0
        let amount = (text * rates.text + imageIn * rates.imageIn + imageOut * rates.imageOut) / 1000000
        if (promo) amount *= 0.5
        return {
          amount,
          currency: book.currency,
          symbol: book.symbol,
          method: 'usage',
          promo,
          note: `按 ${record.model} 的接口用量估算：文本 ${tokenLabel(text)}、参考图 ${tokenLabel(imageIn)}、输出 ${tokenLabel(imageOut)}`
            + `（${book.symbol}${rates.text} / ${book.symbol}${rates.imageIn} / ${book.symbol}${rates.imageOut} 每百万 tok）`
            + (promo ? '，已计入 4K 限时 5 折' : ''),
        }
      }

      if (book.legacy[record.model]) {
        const unit = book.legacy[record.model]
        return {
          amount: unit * count,
          currency: book.currency,
          symbol: book.symbol,
          method: 'per-image',
          promo: false,
          note: `${record.model} 按张计费：${book.symbol}${unit} × ${count} 张`,
        }
      }

      if (rates) {
        const level = priceArea(record.area, images)
        const unit = tablePrice(book.table[record.model][level], record.refs)
        let amount = unit * count
        if (promo) amount *= 0.5
        return {
          amount,
          currency: book.currency,
          symbol: book.symbol,
          method: 'table',
          promo,
          note: `这条 ${record.model} 记录没有 token 用量，按官方单张参考价估算（${level} · `
            + `${Number(record.refs) ? `${record.refs} 张参考图` : '文生图'} · ${count} 张）`
            + (promo ? '，已计入 4K 限时 5 折' : ''),
        }
      }

      return null
    }

    function formatCost(cost) {
      const amount = Number(cost?.amount)
      if (!cost || !Number.isFinite(amount) || amount <= 0) return ''
      // The row badge prefixes 约; keep every amount at two decimals.
      return `${cost.symbol || '$'}${amount.toFixed(2)}`
    }

    /** Official totals are shown at two decimals as well. */
    function formatMoney(amount, currency) {
      const value = Number(amount)
      if (!Number.isFinite(value)) return ''
      return `${currency === 'USD' ? '$' : '¥'}${value.toFixed(2)}`
    }

    function costTitle(cost) {
      const unit = cost.currency === 'USD' ? '美元' : '人民币'
      return `${cost.note ? `${cost.note}；` : ''}按 MiniMax 官方价目（${PRICE_AS_OF}，${unit}）估算，最终以账单为准。`
    }

    // --- icons ------------------------------------------------------------
    const ICONS = {
      spark: [
        ['path', { d: 'M12 3.2l1.85 5 5 1.85-5 1.85L12 16.9l-1.85-5-5-1.85 5-1.85z' }],
        ['path', { d: 'M18.4 15.1l.75 2.05 2.05.75-2.05.75-.75 2.05-.75-2.05-2.05-.75 2.05-.75z' }],
      ],
      gear: [
        ['circle', { cx: 12, cy: 12, r: 3.1 }],
        ['path', { d: 'M19.2 14.8a1.6 1.6 0 00.32 1.76l.06.06a1.9 1.9 0 11-2.69 2.69l-.06-.06a1.6 1.6 0 00-1.76-.32 1.6 1.6 0 00-.97 1.46V21a1.9 1.9 0 11-3.8 0v-.1a1.6 1.6 0 00-1.05-1.46 1.6 1.6 0 00-1.76.32l-.06.06a1.9 1.9 0 11-2.69-2.69l.06-.06a1.6 1.6 0 00.32-1.76 1.6 1.6 0 00-1.46-.97H3a1.9 1.9 0 110-3.8h.1a1.6 1.6 0 001.46-1.05 1.6 1.6 0 00-.32-1.76l-.06-.06a1.9 1.9 0 112.69-2.69l.06.06a1.6 1.6 0 001.76.32H9a1.6 1.6 0 00.97-1.46V3a1.9 1.9 0 113.8 0v.1a1.6 1.6 0 00.97 1.46 1.6 1.6 0 001.76-.32l.06-.06a1.9 1.9 0 112.69 2.69l-.06.06a1.6 1.6 0 00-.32 1.76V9a1.6 1.6 0 001.46.97H21a1.9 1.9 0 110 3.8h-.1a1.6 1.6 0 00-1.46.97z' }],
      ],
      folder: [
        ['path', { d: 'M3.5 8.2A2 2 0 015.5 6.2h3.4l1.7 2h8A2 2 0 0120.5 10v7.6a2 2 0 01-2 2h-13a2 2 0 01-2-2z' }],
      ],
      copy: [
        ['rect', { x: 9, y: 9, width: 11, height: 11, rx: 2 }],
        ['path', { d: 'M15 5.5A1.5 1.5 0 0013.5 4h-8A1.5 1.5 0 004 5.5v8A1.5 1.5 0 005.5 15' }],
      ],
      close: [
        ['path', { d: 'M6 6l12 12' }],
        ['path', { d: 'M18 6L6 18' }],
      ],
      download: [
        ['path', { d: 'M12 4v10' }],
        ['path', { d: 'M8 10.5l4 4 4-4' }],
        ['path', { d: 'M4.5 19.5h15' }],
      ],
      image: [
        ['rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2.2 }],
        ['circle', { cx: 9.2, cy: 10, r: 1.5 }],
        ['path', { d: 'M4.2 17.6l4.3-3.9 3.4 3 3-2.6 4.9 4.2' }],
      ],
      check: [
        ['path', { d: 'M5 12.8l4.2 4.2L19 7.4' }],
      ],
      alert: [
        ['path', { d: 'M12 4.6l8.4 14.6H3.6z' }],
        ['path', { d: 'M12 9.6v4' }],
        ['path', { d: 'M12 16.6h.01' }],
      ],
      key: [
        ['circle', { cx: 8.2, cy: 12, r: 3.6 }],
        ['path', { d: 'M11.8 12H21' }],
        ['path', { d: 'M17.6 12v3.2' }],
      ],
      dot: [
        ['circle', { cx: 12, cy: 12, r: 3.4 }],
      ],
    }

    function Icon({ name, size = 18, color = 'currentColor', style }) {
      const shapes = ICONS[name] || ICONS.dot
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: color,
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
        style,
      }, shapes.map(([tag, attrs], index) => h(tag, Object.assign({ key: index }, attrs))))
    }

    // --- primitives -------------------------------------------------------
    function Button({ children, onClick, disabled, kind = 'ghost', icon, style, title }) {
      const base = {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        height: 34,
        padding: kind === 'primary' ? '0 16px' : '0 11px',
        borderRadius: 9,
        border: `1px solid ${kind === 'primary' ? 'transparent' : C.border}`,
        background: kind === 'primary' ? C.primary : C.card,
        color: kind === 'primary' ? C.primaryText : C.text,
        font: FONT,
        fontWeight: kind === 'primary' ? 600 : 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        transition: 'background 120ms ease, border-color 120ms ease',
        whiteSpace: 'nowrap',
      }
      return h('button', {
        type: 'button',
        title,
        onClick: disabled ? undefined : onClick,
        disabled,
        style: Object.assign(base, style),
        onMouseEnter: (event) => {
          if (disabled) return
          event.currentTarget.style.background = kind === 'primary' ? C.primaryHover : C.hover
        },
        onMouseLeave: (event) => {
          if (disabled) return
          event.currentTarget.style.background = kind === 'primary' ? C.primary : C.card
        },
      }, icon ? h(Icon, { name: icon, size: 15 }) : null, children)
    }

    function Card({ children, style }) {
      return h('section', {
        style: Object.assign({
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: 18,
          boxShadow: '0 1px 2px rgba(20, 24, 32, 0.03)',
        }, style),
      }, children)
    }

    function FieldLabel({ children, hint }) {
      return h('div', {
        style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 7 },
      }, [
        h('span', { key: 'l', style: { font: FONT, fontWeight: 600, color: C.text } }, children),
        hint ? h('span', { key: 'h', style: { font: '11.5px/1.4 system-ui, sans-serif', color: C.faint } }, hint) : null,
      ])
    }

    function RatioBox({ ratio, size = 26 }) {
      const value = ratioValue(ratio)
      const width = value >= 1 ? size : Math.round(size * value)
      const height = value >= 1 ? Math.round(size / value) : size
      return h('span', {
        style: {
          display: 'inline-block',
          width,
          height,
          borderRadius: 3,
          border: `1.5px solid ${C.muted}`,
          boxSizing: 'border-box',
          flexShrink: 0,
        },
      })
    }

    // --- page -------------------------------------------------------------
    function MinimaxPage() {
      const [settings, setSettings] = useState(null)
      const [options, setOptions] = useState({ models: [], aspects: [], regions: [] })
      const [bootError, setBootError] = useState('')
      const [prompt, setPrompt] = useState('')
      const [ratio, setRatio] = useState('16:9')
      const [area, setArea] = useState('2K')
      const [count, setCount] = useState(1)
      const [model, setModel] = useState('MiniMax-H3-Image')
      const [running, setRunning] = useState(false)
      const [elapsed, setElapsed] = useState(0)
      const [error, setError] = useState('')
      const [result, setResult] = useState(null)
      const [history, setHistory] = useState([])
      const [bill, setBill] = useState(null)
      const [billError, setBillError] = useState('')
      const [billLoading, setBillLoading] = useState(false)
      const [lightbox, setLightbox] = useState(null)
      const [toast, setToast] = useState('')
      const [showSettings, setShowSettings] = useState(false)
      const [keyDraft, setKeyDraft] = useState('')
      const [outputDraft, setOutputDraft] = useState('')
      const [regionDraft, setRegionDraft] = useState('intl')
      const [saving, setSaving] = useState(false)
      const textareaRef = useRef(null)
      const toastTimer = useRef(null)
      const fileInputRef = useRef(null)
      const [mode, setMode] = useState('generate')
      const [refs, setRefs] = useState([])
      const [dragging, setDragging] = useState(false)
      const [guard, setGuard] = useState(false)

      const notify = useCallback((message) => {
        setToast(message)
        if (toastTimer.current) clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToast(''), 2600)
      }, [])

      const applySettings = useCallback((value) => {
        setSettings(value)
        if (value) {
          setRatio(value.aspectRatio || '16:9')
          setArea(value.area || '2K')
          setCount(value.n || 1)
          setModel(value.model || 'MiniMax-H3-Image')
          setGuard(value.guard === true)
          setOutputDraft(value.outputDir || '')
          setRegionDraft(value.region || 'intl')
        }
      }, [])

      const loadHistory = useCallback(async () => {
        try {
          const payload = await api('/history?limit=12')
          setHistory(payload.history ?? [])
        } catch {
          /* history is a nicety */
        }
      }, [])

      const loadBill = useCallback(async (refresh = false) => {
        setBillLoading(true)
        try {
          const payload = await api(`/bill?days=7${refresh ? '&refresh=1' : ''}`)
          setBill(payload.bill ?? null)
          setBillError('')
        } catch (err) {
          setBillError(err?.message ?? '账单查询失败')
        } finally {
          setBillLoading(false)
        }
      }, [])

      useEffect(() => {
        let alive = true
        ;(async () => {
          try {
            const payload = await api('/settings')
            if (!alive) return
            applySettings(payload.settings)
            setOptions({
              models: payload.models ?? [],
              aspects: payload.aspects ?? [],
              regions: payload.regions ?? [],
            })
            if (!payload.settings?.hasKey) setShowSettings(true)
          } catch (err) {
            if (alive) setBootError(err?.message ?? String(err))
          }
          if (alive) {
            loadHistory()
            loadBill()
          }
        })()
        return () => {
          alive = false
        }
      }, [applySettings, loadHistory, loadBill])

      useEffect(() => {
        if (!running) return undefined
        const startedAt = Date.now()
        setElapsed(0)
        const timer = setInterval(() => setElapsed(Date.now() - startedAt), 200)
        return () => clearInterval(timer)
      }, [running])

      useEffect(() => () => {
        if (toastTimer.current) clearTimeout(toastTimer.current)
      }, [])

      const submit = useCallback(async () => {
        const text = prompt.trim()
        const editing = mode === 'edit'
        if (!text) {
          setError(editing ? '先写清楚要改什么，例如「把图1的猫换成柴犬」' : '先写一句画面描述再出图')
          textareaRef.current?.focus()
          return
        }
        if (editing && !refs.length) {
          setError('图片编辑至少需要一张参考图：拖入、选择或粘贴图片')
          return
        }
        const h3Ids = (options.models ?? []).filter((item) => item.family === 'h3').map((item) => item.id)
        const editModel = h3Ids.includes(model) ? model : (h3Ids[0] ?? 'MiniMax-H3-Image')
        // H3 accepts 10 images per request, the legacy endpoint stops at 9.
        const family = (options.models ?? []).find((item) => item.id === (editing ? editModel : model))?.family
        const sendCount = Math.min(count, family === 'legacy' ? 9 : 10)

        setRunning(true)
        setError('')
        setResult(null)
        try {
          const payload = editing
            ? await api('/edit', {
              method: 'POST',
              body: JSON.stringify({ prompt: text, n: sendCount, model: editModel, guard, images: refs.map((ref) => ref.dataUrl) }),
            })
            : await api('/generate', {
              method: 'POST',
              body: JSON.stringify({ prompt: text, aspectRatio: ratio, n: sendCount, model, area, guard }),
            })
          setResult(payload)
          loadHistory()
          const cost = estimateCost(payload, settings?.currency)
          const message = `已生成 ${payload.images?.length ?? 0} 张，用时 ${((payload.ms ?? 0) / 1000).toFixed(1)}s`
          notify(cost
            ? h('span', { key: 'cost-toast' }, [
              message,
              '，本次',
              h('strong', { key: 'amount' }, `约 ${formatCost(cost)}`),
            ])
            : message)
        } catch (err) {
          setError(err?.message ?? String(err))
        } finally {
          setRunning(false)
        }
      }, [prompt, ratio, count, model, area, mode, refs, options.models, loadHistory, notify, guard, settings?.currency])

      const saveSettings = useCallback(async () => {
        setSaving(true)
        try {
          const body = { region: regionDraft }
          if (keyDraft.trim()) body.apiKey = keyDraft.trim()
          if (outputDraft.trim()) body.outputDir = outputDraft.trim()
          const payload = await api('/settings', { method: 'POST', body: JSON.stringify(body) })
          applySettings(payload.settings)
          setKeyDraft('')
          notify('设置已保存')
        } catch (err) {
          setError(err?.message ?? String(err))
        } finally {
          setSaving(false)
        }
      }, [keyDraft, outputDraft, regionDraft, applySettings, notify])

      /**
       * The guard switch persists on its own: it is a habit, not a per-run choice.
       * Only the `guard` field is adopted back, so a local ratio/count edit is not
       * silently reverted by the settings payload.
       */
      const toggleGuard = useCallback(async () => {
        const next = !guard
        setGuard(next)
        try {
          const payload = await api('/settings', { method: 'POST', body: JSON.stringify({ guard: next }) })
          setGuard(payload.settings?.guard === true)
          notify(next
            ? '已开启构图护栏：自动追加「主体完整、四周留白、不裁切主体」'
            : '已关闭构图护栏，提示词原样发送')
        } catch (err) {
          setGuard(!next)
          notify(err?.message ?? '保存护栏设置失败')
        }
      }, [guard, notify])

      const openFolder = useCallback(async (target) => {
        const location = target || settings?.outputDir || ''
        try {
          await api('/open', { method: 'POST', body: JSON.stringify({ path: target || '' }) })
          notify('已在文件管理器中打开')
        } catch (err) {
          // Never leave the button as a dead end: hand the user the path instead.
          let copied = false
          try {
            if (location) {
              await navigator.clipboard.writeText(location)
              copied = true
            }
          } catch {
            copied = false
          }
          notify(`${err?.message ?? '打开失败'}${copied ? '；路径已复制，粘到资源管理器地址栏即可' : ''}`)
        }
      }, [notify, settings])

      const copyPath = useCallback(async (value) => {
        try {
          await navigator.clipboard.writeText(value)
          notify('路径已复制')
        } catch {
          notify('复制失败，请手动选择')
        }
      }, [notify])

      const saveImage = useCallback(async (item) => {
        if (!item) return
        const name = item.name || 'minimax-image.jpeg'
        const dot = name.lastIndexOf('.')
        const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '.jpeg'
        const fallbackMime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
        try {
          const response = await fetch(item.url, { credentials: 'same-origin' })
          if (!response.ok) throw new Error(`读取图片失败（HTTP ${response.status}）`)
          const blob = await response.blob()

          // Chromium: let the user choose a real location instead of the download dir.
          if (typeof window.showSaveFilePicker === 'function') {
            try {
              const handle = await window.showSaveFilePicker({
                suggestedName: name,
                types: [{ description: '图片', accept: { [blob.type || fallbackMime]: [ext] } }],
              })
              const writable = await handle.createWritable()
              await writable.write(blob)
              await writable.close()
              notify(`已保存：${handle.name}`)
              return
            } catch (pickerError) {
              if (pickerError?.name === 'AbortError') return
              // Picker unavailable in this shell - fall back to a plain download.
            }
          }

          const objectUrl = URL.createObjectURL(blob)
          const anchor = document.createElement('a')
          anchor.href = objectUrl
          anchor.download = name
          document.body.appendChild(anchor)
          anchor.click()
          anchor.remove()
          setTimeout(() => URL.revokeObjectURL(objectUrl), 4000)
          notify('已保存到浏览器的下载目录')
        } catch (error) {
          if (error?.name === 'AbortError') return
          notify(error?.message ?? '保存失败')
        }
      }, [notify])

      const fetchAsDataUrl = useCallback(async (url) => {
        const response = await fetch(url, { credentials: 'same-origin' })
        if (!response.ok) throw new Error(`读取图片失败（HTTP ${response.status}）`)
        const blob = await response.blob()
        return await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result || ''))
          reader.onerror = () => reject(new Error('读取图片失败'))
          reader.readAsDataURL(blob)
        })
      }, [])

      /** Start over from this image: clear the strip, then make it 图1. */
      const continueEditing = useCallback(async (image) => {
        if (!image) return
        try {
          const dataUrl = await fetchAsDataUrl(image.url)
          const entry = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: image.name,
            size: image.bytes || 0,
            dataUrl,
          }
          setRefs([entry])
          setMode('edit')
          const h3 = (options.models ?? []).filter((item) => item.family === 'h3')
          if (h3.length && !h3.some((item) => item.id === model)) setModel(h3[0].id)
          notify('已清空参考图并放入这张（图1），改完点「开始编辑」')
          textareaRef.current?.focus()
        } catch (error) {
          notify(error?.message ?? '加入参考图失败')
        }
      }, [fetchAsDataUrl, notify, options.models, model])

      const deleteHistory = useCallback(async (id) => {
        try {
          const payload = await api('/history/delete', { method: 'POST', body: JSON.stringify({ id }) })
          setHistory((rows) => rows.filter((row) => row.id !== id))
          notify(payload.removed ? `已删除记录和 ${payload.removed} 张图片` : '已删除记录')
        } catch (err) {
          notify(err?.message ?? '删除失败')
        }
      }, [notify])

      const addFiles = useCallback(async (fileList) => {
        const files = Array.from(fileList ?? []).filter((file) => file && String(file.type || '').startsWith('image/'))
        if (!files.length) return
        const loaded = []
        for (const file of files) {
          if (loaded.length + refs.length >= 16) break
          if (file.size > 20 * 1024 * 1024) {
            notify(`${file.name} 超过 20 MB，已跳过`)
            continue
          }
          const dataUrl = await new Promise((resolve) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result || ''))
            reader.onerror = () => resolve('')
            reader.readAsDataURL(file)
          })
          if (!dataUrl) continue
          loaded.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: file.name,
            size: file.size,
            dataUrl,
          })
        }
        if (!loaded.length) return
        setRefs((rows) => [...rows, ...loaded].slice(0, 16))
        notify(`已加入 ${loaded.length} 张参考图`)
      }, [refs.length, notify])

      const removeRef = useCallback((id) => {
        setRefs((rows) => rows.filter((row) => row.id !== id))
      }, [])

      const switchMode = useCallback((next) => {
        setMode(next)
        setError('')
        if (next === 'edit') {
          const h3 = (options.models ?? []).filter((item) => item.family === 'h3')
          if (h3.length && !h3.some((item) => item.id === model)) setModel(h3[0].id)
        }
      }, [options.models, model])

      const hasKey = Boolean(settings?.hasKey)
      const ratioOptions = options.aspects?.length ? options.aspects : ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9']
      const areaOptions = options.areas?.length ? options.areas : ['1K', '2K', '4K']
      const modelOptions = options.models?.length
        ? options.models
        : [{ id: 'MiniMax-H3-Image', label: 'H3 标准（推荐）', area: true }]
      const activeModel = modelOptions.find((item) => item.id === model) ?? modelOptions[0]
      const modelHasArea = Boolean(activeModel?.area)
      /** H3 tops out at 10 images per request; the legacy endpoint stops at 9. */
      const maxCount = activeModel?.family === 'legacy' ? 9 : 10

      const selectStyle = {
        height: 34,
        padding: '0 9px',
        borderRadius: 9,
        border: `1px solid ${C.border}`,
        background: C.card,
        color: C.text,
        font: FONT,
        cursor: 'pointer',
        outline: 'none',
      }

      const countNudge = (label, next, disabled, title) => h('button', {
        key: `nudge-${label}`,
        type: 'button',
        title,
        disabled,
        onClick: () => setCount(next),
        style: {
          width: 30, height: 34, padding: 0, borderRadius: 9,
          cursor: disabled ? 'not-allowed' : 'pointer',
          border: `1px solid ${C.border}`, background: C.card,
          color: disabled ? C.faint : C.text, font: FONT, fontWeight: 600,
          opacity: disabled ? 0.55 : 1,
        },
      }, label)

      const header = h('div', {
        key: 'head',
        style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 },
      }, [
        h('div', {
          key: 'badge',
          style: {
            width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center',
            background: C.successSoft, color: C.primary, flexShrink: 0,
          },
        }, h(Icon, { name: 'spark', size: 21 })),
        h('div', { key: 'titles', style: { flex: 1, minWidth: 0 } }, [
          h('div', { key: 't', style: { font: '600 17px/1.3 system-ui, sans-serif', color: C.text } }, '出图'),
          h('div', {
            key: 's',
            style: { font: '12px/1.5 system-ui, sans-serif', color: C.muted, marginTop: 2 },
          }, `MiniMax ${model} · 结果保存在本机`),
        ]),
        h('span', {
          key: 'state',
          style: {
            display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 10px',
            borderRadius: 999, font: '11.5px/1 system-ui, sans-serif',
            background: hasKey ? C.successSoft : C.warnSoft,
            color: hasKey ? C.success : C.warn,
          },
        }, [
          h('span', {
            key: 'dot',
            style: { width: 6, height: 6, borderRadius: 999, background: hasKey ? C.success : C.warn },
          }),
          hasKey ? `已连接 ${settings.keyMask}` : '未配置 key',
        ]),
        h(Button, {
          key: 'gear',
          icon: 'gear',
          title: '设置',
          onClick: () => setShowSettings((value) => !value),
        }),
      ])

      const settingsCard = showSettings ? h(Card, { key: 'settings', style: { marginBottom: 14 } }, [
        h(FieldLabel, { key: 'k', hint: '只保存在本机 ~/.dsh/minimax-image/settings.json' }, 'API key'),
        h('div', { key: 'ki', style: { display: 'flex', gap: 8, marginBottom: 14 } }, [
          h('input', {
            key: 'in',
            type: 'password',
            value: keyDraft,
            placeholder: hasKey ? `已保存（${settings.keyMask}），留空则不修改` : '粘贴 MiniMax API key',
            onChange: (event) => setKeyDraft(event.target.value),
            style: {
              flex: 1, height: 34, padding: '0 11px', borderRadius: 9,
              border: `1px solid ${C.border}`, background: C.soft, color: C.text,
              font: FONT, outline: 'none',
            },
          }),
        ]),
        h('div', { key: 'row2', style: { display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, marginBottom: 14 } }, [
          h('div', { key: 'r' }, [
            h(FieldLabel, { key: 'l' }, '站点'),
            h('select', {
              key: 's',
              value: regionDraft,
              onChange: (event) => setRegionDraft(event.target.value),
              style: Object.assign({}, selectStyle, { width: '100%' }),
            }, (options.regions ?? []).map((region) => h('option', { key: region.id, value: region.id }, region.label))),
          ]),
          h('div', { key: 'o' }, [
            h(FieldLabel, { key: 'l' }, '保存位置'),
            h('input', {
              key: 'i',
              type: 'text',
              value: outputDraft,
              onChange: (event) => setOutputDraft(event.target.value),
              style: {
                width: '100%', height: 34, padding: '0 11px', borderRadius: 9, boxSizing: 'border-box',
                border: `1px solid ${C.border}`, background: C.soft, color: C.text,
                font: FONT, outline: 'none',
              },
            }),
          ]),
        ]),
        h('div', { key: 'act', style: { display: 'flex', gap: 8, alignItems: 'center' } }, [
          h(Button, {
            key: 'save',
            kind: 'primary',
            disabled: saving,
            onClick: saveSettings,
            icon: 'check',
          }, saving ? '保存中…' : '保存设置'),
          h(Button, {
            key: 'open',
            icon: 'folder',
            onClick: () => openFolder(''),
          }, '打开保存位置'),
          h('span', {
            key: 'note',
            style: { font: '11.5px/1.5 system-ui, sans-serif', color: C.faint, marginLeft: 'auto' },
          }, 'key 不会上传，只用于本机调用 MiniMax'),
        ]),
      ]) : null

      const modeButton = (value, label) => h('button', {
        key: `mode-${value}`,
        type: 'button',
        onClick: () => switchMode(value),
        style: {
          height: 28, padding: '0 13px', borderRadius: 999, cursor: 'pointer',
          border: `1px solid ${mode === value ? C.primary : C.border}`,
          background: mode === value ? C.primary : 'transparent',
          color: mode === value ? C.primaryText : C.muted,
          font: '12px/1 system-ui, sans-serif',
          fontWeight: mode === value ? 600 : 500,
        },
      }, label)

      const refStrip = mode === 'edit' ? h('div', { key: 'refs', style: { marginTop: 10 } }, [
        h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } }, [
          h('span', { key: 'l', style: { font: '11.5px/1.4 system-ui, sans-serif', color: C.muted } },
            `参考图 ${refs.length}/16`),
          h('button', {
            key: 'pick',
            type: 'button',
            onClick: () => fileInputRef.current?.click(),
            style: {
              border: `1px solid ${C.border}`, background: C.card, color: C.text,
              borderRadius: 8, height: 26, padding: '0 9px',
              font: '11.5px/1 system-ui, sans-serif', cursor: 'pointer',
            },
          }, '选择图片'),
          refs.length ? h('button', {
            key: 'clear',
            type: 'button',
            onClick: () => setRefs([]),
            style: {
              border: 'none', background: 'transparent', color: C.faint,
              font: '11.5px/1 system-ui, sans-serif', cursor: 'pointer', padding: 0,
            },
          }, '清空') : null,
        ]),
        h('input', {
          key: 'file',
          ref: fileInputRef,
          type: 'file',
          accept: 'image/*',
          multiple: true,
          onChange: (event) => {
            addFiles(event.target.files)
            event.target.value = ''
          },
          style: { display: 'none' },
        }),
        refs.length ? h('div', { key: 'thumbs', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
          refs.map((ref, index) => h('figure', {
            key: ref.id,
            onClick: () => setLightbox({ url: ref.dataUrl, name: ref.name, path: '', kind: 'ref' }),
            style: {
              position: 'relative', margin: 0, width: 72, height: 72, borderRadius: 10,
              overflow: 'hidden', border: `1px solid ${C.border}`, background: C.soft,
              cursor: 'zoom-in',
            },
          }, [
            h('img', { key: 'i', src: ref.dataUrl, alt: ref.name, style: { width: '100%', height: '100%', objectFit: 'cover', cursor: 'zoom-in' } }),
            h('span', {
              key: 'n',
              style: {
                position: 'absolute', left: 3, top: 3, padding: '1px 4px', borderRadius: 4,
                background: 'rgba(12,15,20,0.62)', color: '#fff', font: '10px/1.4 system-ui, sans-serif',
              },
            }, `图${index + 1}`),
            h('button', {
              key: 'x',
              type: 'button',
              title: '移除这张',
              onClick: (event) => {
                event.stopPropagation()
                removeRef(ref.id)
              },
              style: {
                position: 'absolute', right: 2, top: 2, width: 18, height: 18,
                borderRadius: 999, border: 'none', cursor: 'pointer',
                background: 'rgba(12,15,20,0.66)', color: '#fff',
                display: 'grid', placeItems: 'center', padding: 0,
              },
            }, h(Icon, { name: 'close', size: 11 })),
          ]))) : h('div', {
          key: 'empty',
          onClick: () => fileInputRef.current?.click(),
          style: {
            display: 'grid', placeItems: 'center', gap: 4, height: 92,
            borderRadius: 11, border: `1px dashed ${dragging ? C.primary : C.border}`,
            background: dragging ? C.hover : C.soft, cursor: 'pointer',
            color: C.muted, font: '12px/1.6 system-ui, sans-serif',
          },
        }, [
          h(Icon, { key: 'i', name: 'image', size: 20, color: C.faint }),
          h('span', { key: 't' }, '拖入图片、点击选择，或直接 Ctrl+V 粘贴'),
        ]),
      ]) : null

      const composer = h(Card, {
        key: 'composer',
        style: { marginBottom: 14 },
        onDragOver: (event) => {
          if (mode !== 'edit') return
          event.preventDefault()
          setDragging(true)
        },
        onDragLeave: () => setDragging(false),
        onDrop: (event) => {
          if (mode !== 'edit') return
          event.preventDefault()
          setDragging(false)
          addFiles(event.dataTransfer?.files)
        },
      }, [
        h('div', { key: 'modes', style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 } }, [
          modeButton('generate', '文生图'),
          modeButton('edit', '图片编辑'),
          h('span', {
            key: 'hint',
            style: { marginLeft: 'auto', font: '11.5px/1.4 system-ui, sans-serif', color: C.faint },
          }, mode === 'edit' ? '输出尺寸由参考图决定' : 'Ctrl + Enter 生成'),
        ]),
        h(FieldLabel, { key: 'l', hint: mode === 'edit' ? '用「图1」「图2」指代参考图' : '中文即可' },
          mode === 'edit' ? '编辑要求' : '画面描述'),
        h('textarea', {
          key: 'ta',
          ref: textareaRef,
          value: prompt,
          rows: 4,
          placeholder: mode === 'edit'
            ? '描述要改什么，例如：把图1里的猫换成一只柴犬，保留窗台和暖光构图'
            : '描述你想要的画面：主体、场景、风格、光线、构图。中文即可。',
          onChange: (event) => setPrompt(event.target.value),
          onPaste: (event) => {
            if (mode !== 'edit') return
            const items = event.clipboardData?.items
            const files = []
            if (items) {
              for (const item of items) {
                if (item.kind === 'file' && String(item.type || '').startsWith('image/')) {
                  const file = item.getAsFile()
                  if (file) files.push(file)
                }
              }
            }
            if (files.length) {
              event.preventDefault()
              addFiles(files)
            }
          },
          onKeyDown: (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault()
              if (!running) submit()
            }
          },
          style: {
            width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 92,
            padding: '11px 12px', borderRadius: 11, border: `1px solid ${C.border}`,
            background: C.soft, color: C.text, font: FONT, outline: 'none', lineHeight: 1.6,
          },
        }),
        refStrip,
        h('div', { key: 'ex', style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 } },
          (mode === 'edit' ? EDIT_EXAMPLES : EXAMPLES).map((example) => h('button', {
            key: example,
            type: 'button',
            onClick: () => {
              setPrompt(example)
              textareaRef.current?.focus()
            },
            style: {
              padding: '4px 9px', borderRadius: 999, border: `1px dashed ${C.border}`,
              background: 'transparent', color: C.muted,
              font: '11.5px/1.5 system-ui, sans-serif', cursor: 'pointer',
            },
          }, example))),
        h('div', {
          key: 'controls',
          style: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 10, marginTop: 14 },
        }, [
          mode === 'generate' ? h('div', { key: 'ratio', style: { display: 'flex', flexDirection: 'column', gap: 6 } }, [
            h('span', { key: 'l', style: { font: '11.5px/1.4 system-ui, sans-serif', color: C.muted } }, '比例'),
            h('div', { key: 'row', style: { display: 'flex', alignItems: 'center', gap: 8 } }, [
              h(RatioBox, { key: 'b', ratio }),
              h('select', {
                key: 's',
                value: ratio,
                onChange: (event) => setRatio(event.target.value),
                style: selectStyle,
              }, ratioOptions.map((value) => h('option', { key: value, value }, `${value} · ${RATIO_LABEL[value] ?? ''}`))),
            ]),
          ]) : null,
          (mode === 'generate' && modelHasArea) ? h('div', { key: 'area', style: { display: 'flex', flexDirection: 'column', gap: 6 } }, [
            h('span', { key: 'l', style: { font: '11.5px/1.4 system-ui, sans-serif', color: C.muted } }, '清晰度'),
            h('select', {
              key: 's',
              value: area,
              onChange: (event) => setArea(event.target.value),
              style: selectStyle,
            }, areaOptions.map((value) => h('option', { key: value, value }, value))),
          ]) : null,
          h('div', { key: 'count', style: { display: 'flex', flexDirection: 'column', gap: 6 } }, [
            h('span', {
              key: 'l',
              style: { font: '11.5px/1.4 system-ui, sans-serif', color: C.muted },
            }, `张数${count > 4 ? '（多张更慢）' : ''}`),
            h('div', { key: 'row', style: { display: 'flex', alignItems: 'center', gap: 4 } }, [
              countNudge('−', Math.max(1, count - 1), count <= 1, '少一张'),
              h('span', {
                key: 'v',
                style: {
                  minWidth: 26, textAlign: 'center', font: FONT, fontWeight: 600, color: C.text,
                  fontVariantNumeric: 'tabular-nums',
                },
              }, count),
              countNudge('+', Math.min(maxCount, count + 1), count >= maxCount, `多一张（上限 ${maxCount}）`),
            ]),
          ]),
          h('div', { key: 'guard', style: { display: 'flex', flexDirection: 'column', gap: 6 } }, [
            h('span', {
              key: 'l',
              style: { font: '11.5px/1.4 system-ui, sans-serif', color: C.muted },
            }, '构图护栏'),
            h('button', {
              key: 'b',
              type: 'button',
              role: 'switch',
              'aria-checked': guard,
              title: guard
                ? '已开启：提交时自动追加「主体完整、四周留白、不裁切主体」，点一下关闭'
                : '已关闭：提示词原样发送，点一下开启',
              onClick: toggleGuard,
              style: {
                display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 10px',
                borderRadius: 9, cursor: 'pointer',
                border: `1px solid ${guard ? C.primary : C.border}`,
                background: guard ? C.successSoft : C.card,
                color: guard ? C.primary : C.muted,
                font: '12px/1 system-ui, sans-serif', fontWeight: guard ? 600 : 500,
              },
            }, [
              h('span', {
                key: 'track',
                style: {
                  width: 26, height: 15, borderRadius: 999, flexShrink: 0,
                  background: guard ? C.primary : C.borderStrong,
                  display: 'flex', alignItems: 'center',
                  padding: 2, boxSizing: 'border-box',
                  justifyContent: guard ? 'flex-end' : 'flex-start',
                },
              }, h('span', {
                key: 'knob',
                style: { width: 11, height: 11, borderRadius: 999, background: '#fff', display: 'block' },
              })),
              guard ? '开' : '关',
            ]),
          ]),
          h('div', { key: 'model', style: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 190 } }, [
            h('span', { key: 'l', style: { font: '11.5px/1.4 system-ui, sans-serif', color: C.muted } }, '模型'),
            h('select', {
              key: 's',
              value: model,
              onChange: (event) => {
                const next = event.target.value
                setModel(next)
                const cap = modelOptions.find((item) => item.id === next)?.family === 'legacy' ? 9 : 10
                if (count > cap) setCount(cap)
              },
              style: Object.assign({}, selectStyle, { width: '100%' }),
            }, modelOptions.filter((item) => mode === 'generate' || item.family === 'h3').map((item) => h('option', { key: item.id, value: item.id }, item.label))),
          ]),
          h('div', { key: 'go', style: { marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' } }, [
            running ? h('span', {
              key: 'el',
              style: { font: '11.5px/1.4 system-ui, sans-serif', color: C.muted, fontVariantNumeric: 'tabular-nums' },
            }, `${(elapsed / 1000).toFixed(1)}s`) : null,
            h(Button, {
              key: 'btn',
              kind: 'primary',
              icon: 'spark',
              disabled: running || !hasKey,
              onClick: submit,
              style: { height: 38, padding: '0 20px' },
            }, running ? (mode === 'edit' ? '编辑中…' : '生成中…') : (mode === 'edit' ? '开始编辑' : '生成图片')),
          ]),
        ]),
      ])

      const errorBar = error ? h('div', {
        key: 'err',
        style: {
          display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 14,
          padding: '10px 12px', borderRadius: 11,
          background: C.dangerSoft, color: C.danger, font: '12.5px/1.6 system-ui, sans-serif',
        },
      }, [
        h(Icon, { key: 'i', name: 'alert', size: 15, style: { marginTop: 1, flexShrink: 0 } }),
        h('span', { key: 't', style: { flex: 1 } }, error),
        h('button', {
          key: 'x',
          type: 'button',
          onClick: () => setError(''),
          style: { border: 'none', background: 'transparent', color: C.danger, cursor: 'pointer', padding: 0 },
        }, h(Icon, { name: 'close', size: 14 })),
      ]) : null

      const runningCard = running ? h(Card, { key: 'run', style: { marginBottom: 14 } }, [
        h('div', { key: 'row', style: { display: 'grid', gridTemplateColumns: `repeat(${Math.min(count, 4)}, 1fr)`, gap: 10 } },
          Array.from({ length: Math.min(count, 4) }, (_, index) => h('div', {
            key: index,
            style: {
              aspectRatio: ratio,
              borderRadius: 11,
              background: `linear-gradient(100deg, ${C.soft} 30%, ${C.hover} 50%, ${C.soft} 70%)`,
              backgroundSize: '220% 100%',
              animation: 'dsh-minimax-shimmer 1.4s linear infinite',
              border: `1px solid ${C.border}`,
            },
          }))),
        h('div', {
          key: 't',
          style: { font: '12px/1.6 system-ui, sans-serif', color: C.muted, marginTop: 10, display: 'flex', gap: 6, alignItems: 'center' },
        }, [
          h(Icon, { key: 'i', name: 'spark', size: 14, color: C.primary }),
          `正在生成 ${count} 张，通常 5–20 秒；这张提示词越长越慢。`,
        ]),
      ]) : null

      const results = result?.images?.length ? h(Card, { key: 'res', style: { marginBottom: 14 } }, [
        h('div', {
          key: 'head',
          style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 },
        }, [
          h(Icon, { key: 'i', name: 'image', size: 16, color: C.muted }),
          h('span', { key: 't', style: { font: FONT, fontWeight: 600, color: C.text } }, '本次结果'),
          h('span', {
            key: 'm',
            style: { font: '11.5px/1.4 system-ui, sans-serif', color: C.faint },
          }, [
            result.kind === 'edit' ? `编辑 · ${result.refs} 张参考图` : result.model,
            result.aspectRatio && result.aspectRatio !== 'auto' ? result.aspectRatio : null,
            result.area || null,
            result.guard ? '构图护栏' : null,
            result.images?.[0]?.size || null,
            `${((result.ms ?? 0) / 1000).toFixed(1)}s`,
          ].filter(Boolean).join(' · ')),
          h('div', { key: 'sp', style: { flex: 1 } }),
          h('div', {
            key: 'acts',
            style: { display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch' },
          }, [
            h(Button, {
              key: 'edit',
              kind: 'primary',
              icon: 'spark',
              title: result.images.length > 1
                ? '清空参考图，放入第 1 张接着改'
                : '清空参考图，放入这张接着改',
              onClick: () => continueEditing(result.images[0]),
            }, '继续编辑'),
            h(Button, { key: 'o', icon: 'folder', onClick: () => openFolder(result.directory) }, '打开文件夹'),
          ]),
        ]),
        result.warnings?.length ? h('div', {
          key: 'warn',
          style: {
            display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10,
            padding: '8px 10px', borderRadius: 9,
            background: C.warnSoft, color: C.warn, font: '11.5px/1.6 system-ui, sans-serif',
          },
        }, [
          h(Icon, { key: 'i', name: 'alert', size: 14, style: { marginTop: 2, flexShrink: 0 } }),
          h('span', { key: 't' }, result.warnings.join('；')),
        ]) : null,
        h('div', {
          key: 'grid',
          style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 },
        }, result.images.map((image) => h('figure', {
          key: image.rel,
          style: { margin: 0, position: 'relative', borderRadius: 11, overflow: 'hidden', border: `1px solid ${C.border}`, background: C.soft },
        }, [
          h('img', {
            key: 'img',
            src: `${image.url}&t=${Date.now()}`,
            alt: result.prompt,
            loading: 'lazy',
            onClick: () => setLightbox({ url: image.url, name: image.name, path: image.path }),
            style: { display: 'block', width: '100%', height: 'auto', cursor: 'zoom-in' },
          }),
          h('figcaption', {
            key: 'cap',
            style: {
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px',
              background: C.card, borderTop: `1px solid ${C.border}`,
            },
          }, [
            h('span', {
              key: 'n',
              style: { font: '11px/1.4 ui-monospace, SFMono-Regular, monospace', color: C.muted, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
            }, image.name),
            h('button', {
              key: 'e',
              type: 'button',
              title: '把这张设为图1接着改',
              onClick: () => continueEditing(image),
              style: { border: 'none', background: 'transparent', color: C.primary, cursor: 'pointer', padding: 2, display: 'flex' },
            }, h(Icon, { name: 'spark', size: 14 })),
            h('button', {
              key: 'c',
              type: 'button',
              title: '复制路径',
              onClick: () => copyPath(image.path),
              style: { border: 'none', background: 'transparent', color: C.faint, cursor: 'pointer', padding: 2, display: 'flex' },
            }, h(Icon, { name: 'copy', size: 14 })),
            h('a', {
              key: 'd',
              href: image.url,
              download: image.name,
              title: '下载',
              style: { color: C.faint, padding: 2, display: 'flex' },
            }, h(Icon, { name: 'download', size: 14 })),
          ]),
        ]))),
      ]) : null

      const billUrl = settings?.currency === 'USD'
        ? 'https://platform.minimax.io/console/consumption-detail'
        : 'https://platform.minimax.cn/console/consumption-detail'

      const billAmount = bill ? formatMoney(bill.total, bill.currency) : ''
      const billCard = h(Card, { key: 'bill', style: { marginBottom: 14, padding: '13px 16px' } }, [
        h('div', { key: 'row', style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } }, [
          h('span', { key: 't', style: { font: FONT, fontWeight: 600, color: C.text } }, '官方账单'),
          h('span', {
            key: 'v',
            title: bill
              ? `近 ${bill.days} 天（${bill.since} ~ ${bill.until}）账户实际消费 ${billAmount}；含体验中心等全部调用，按小时汇总，可能有延迟。`
              : (billError || '正在查询 MiniMax 官方消费接口'),
            style: {
              font: '600 15px/1.2 system-ui, sans-serif', color: C.text,
              fontVariantNumeric: 'tabular-nums',
            },
          }, bill ? billAmount : billLoading ? '查询中…' : billError ? '暂不可用' : '查询中…'),
          h('span', {
            key: 'l',
            style: { font: '11.5px/1.4 system-ui, sans-serif', color: C.muted },
          }, bill ? `近 ${bill.days} 天账户实际消费` : '近 7 天账户实际消费'),
          h('div', { key: 'sp', style: { flex: 1 } }),
          h('button', {
            key: 'r',
            type: 'button',
            title: '重新查询官方账单（服务端缓存 5 分钟）',
            onClick: () => loadBill(true),
            disabled: billLoading,
            style: {
              height: 28, padding: '0 9px', borderRadius: 8, flexShrink: 0,
              border: `1px solid ${C.border}`, background: C.card, color: C.muted,
              font: '11.5px/1 system-ui, sans-serif', cursor: billLoading ? 'wait' : 'pointer',
              opacity: billLoading ? 0.6 : 1,
            },
          }, billLoading ? '刷新中…' : '刷新'),
          h('a', {
            key: 'o',
            href: billUrl,
            target: '_blank',
            rel: 'noreferrer',
            title: '打开 MiniMax 控制台的消费明细（官方页面）',
            style: {
              display: 'inline-flex', alignItems: 'center', height: 28, padding: '0 9px',
              borderRadius: 8, border: `1px solid ${C.border}`, background: C.card,
              color: C.text, font: '11.5px/1 system-ui, sans-serif',
              textDecoration: 'none', flexShrink: 0,
            },
          }, '消费明细 ↗'),
        ]),
        h('div', {
          key: 'note',
          style: { font: '11px/1.5 system-ui, sans-serif', color: C.faint, marginTop: 4 },
        }, billError
          ? '官方账单暂不可用，可先点右侧「消费明细」查看'
          : bill
            ? bill.records === 0
              ? `近 ${bill.days} 天暂无账单记录（账单可能有延迟）`
              : `截至 ${bill.latest || bill.until} · 按小时汇总，可能比出图晚几小时；含体验中心等全部调用`
            : '正在向 MiniMax 查询官方账单…'),
      ])

      const historyCard = history.length ? h(Card, { key: 'hist' }, [
        h('div', { key: 'h', style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 } }, [
          h('span', { key: 't', style: { font: FONT, fontWeight: 600, color: C.text } }, '最近生成'),
          h('span', { key: 'c', style: { font: '11.5px/1.4 system-ui, sans-serif', color: C.faint } }, `共 ${history.length} 条`),
        ]),
        h('div', { key: 'list', style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          history.slice(0, 8).map((entry) => {
            const cost = estimateCost(entry, settings?.currency)
            return h('div', {
              key: entry.id,
              style: {
                display: 'flex', alignItems: 'center', gap: 10, padding: '7px 9px',
                borderRadius: 10, border: `1px solid ${C.border}`, background: C.card,
              },
            }, [
              h('div', { key: 'thumbs', style: { display: 'flex', gap: 4, flexShrink: 0 } },
                entry.images.slice(0, 3).map((image) => h('img', {
                  key: image.rel,
                  src: `${image.url}&t=${encodeURIComponent(entry.at)}`,
                  alt: '',
                  loading: 'lazy',
                  onClick: () => setLightbox({ url: image.url, name: image.name, path: image.path || image.rel }),
                  style: { width: 34, height: 34, objectFit: 'cover', borderRadius: 6, cursor: 'zoom-in', border: `1px solid ${C.border}` },
                }))),
              h('div', { key: 'body', style: { flex: 1, minWidth: 0 } }, [
                h('div', {
                  key: 'p',
                  style: { font: '12.5px/1.5 system-ui, sans-serif', color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                  title: entry.prompt,
                }, entry.prompt),
                h('div', {
                  key: 'm',
                  style: { font: '11px/1.5 system-ui, sans-serif', color: C.faint, marginTop: 1 },
                }, `${entry.kind === 'edit' ? '编辑 · ' : ''}${timeLabel(entry.at)} · ${entry.images.length} 张 · ${entry.aspectRatio === 'auto' ? '原图尺寸' : entry.aspectRatio} · ${formatBytes(entry.images.reduce((sum, image) => sum + (image.bytes || 0), 0))}${entry.guard ? ' · 护栏' : ''}`),
              ]),
              cost ? h('span', {
                key: 'cost',
                title: costTitle(cost),
                style: {
                  display: 'inline-flex', alignItems: 'center', height: 24, padding: '0 7px',
                  borderRadius: 7, border: `1px solid ${C.border}`, background: C.soft,
                  color: C.muted, font: '600 11.5px/1 system-ui, sans-serif',
                  fontVariantNumeric: 'tabular-nums', flexShrink: 0, cursor: 'help',
                },
              }, `约 ${formatCost(cost)}`) : null,
              h('button', {
                key: 'edit',
                type: 'button',
                title: '清空参考图，放入这张接着改',
                onClick: () => {
                  const first = entry.images?.[0]
                  if (first) continueEditing({ url: first.url, name: first.name, bytes: first.bytes || 0 })
                },
                style: {
                  border: `1px solid ${C.border}`, background: C.card, color: C.text,
                  borderRadius: 8, height: 28, padding: '0 9px',
                  font: '11.5px/1 system-ui, sans-serif', cursor: 'pointer', flexShrink: 0,
                },
              }, '编辑图片'),
              h('button', {
                key: 're',
                type: 'button',
                onClick: () => {
                  setPrompt(entry.prompt)
                  setRatio(entry.aspectRatio)
                  if (entry.aspectRatio === 'auto' || entry.kind === 'edit') setMode('edit')
                  textareaRef.current?.focus()
                  notify('已把提示词填回输入框')
                },
                style: {
                  border: `1px solid ${C.border}`, background: C.card, color: C.muted,
                  borderRadius: 8, height: 28, padding: '0 9px',
                  font: '11.5px/1 system-ui, sans-serif', cursor: 'pointer', flexShrink: 0,
                },
              }, '复用'),
              h('button', {
                key: 'del',
                type: 'button',
                title: '删除这条记录和图片',
                onClick: () => deleteHistory(entry.id),
                style: {
                  border: 'none', background: 'transparent', color: C.faint,
                  cursor: 'pointer', padding: 4, display: 'flex', flexShrink: 0,
                },
              }, h(Icon, { name: 'close', size: 14 })),
            ])
          })),
      ]) : null

      const lightboxView = lightbox ? h('div', {
        key: 'lb',
        onClick: () => setLightbox(null),
        style: {
          position: 'fixed', inset: 0, background: 'rgba(12, 15, 20, 0.78)',
          display: 'grid', placeItems: 'center', padding: 28, zIndex: 60,
        },
      }, h('div', {
        onClick: (event) => event.stopPropagation(),
        style: {
          display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 'min(1100px, 92vw)',
          maxHeight: '90vh',
        },
      }, [
        h('img', {
          key: 'i',
          src: lightbox.url,
          alt: lightbox.name,
          style: { maxWidth: '100%', maxHeight: '78vh', objectFit: 'contain', borderRadius: 12, display: 'block' },
        }),
        h('div', { key: 'bar', style: { display: 'flex', alignItems: 'center', gap: 8 } }, [
          h('span', {
            key: 'n',
            style: { font: '11.5px/1.4 ui-monospace, monospace', color: 'rgba(255,255,255,0.72)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
          }, lightbox.path || lightbox.name),
          h('button', {
            key: 'save',
            type: 'button',
            onClick: () => saveImage(lightbox),
            style: {
              display: 'inline-flex', alignItems: 'center', gap: 5, height: 30, padding: '0 12px',
              borderRadius: 8, border: '1px solid rgba(255,255,255,0.78)', background: '#ffffff',
              color: '#1f2329', font: '11.5px/1 system-ui, sans-serif', fontWeight: 600, cursor: 'pointer',
            },
          }, [h(Icon, { key: 'i', name: 'download', size: 13 }), '保存图片']),
          lightbox.kind === 'ref' ? null : h('button', {
            key: 'ed',
            type: 'button',
            title: '进入图片编辑：清空参考图并放入这张',
            onClick: () => {
              const target = { url: lightbox.url, name: lightbox.name, bytes: 0 }
              setLightbox(null)
              continueEditing(target)
            },
            style: {
              display: 'inline-flex', alignItems: 'center', gap: 5, height: 30, padding: '0 12px',
              borderRadius: 8, border: '1px solid rgba(255,255,255,0.42)', background: 'rgba(255,255,255,0.16)',
              color: '#fff', font: '11.5px/1 system-ui, sans-serif', fontWeight: 600, cursor: 'pointer',
            },
          }, [h(Icon, { key: 'i', name: 'image', size: 13 }), '编辑图片']),
          lightbox.kind === 'ref' ? null : h('button', {
            key: 'open',
            type: 'button',
            title: '打开这张图所在的文件夹',
            onClick: () => openFolder(lightbox.path || ''),
            style: {
              display: 'inline-flex', alignItems: 'center', gap: 5, height: 30, padding: '0 11px',
              borderRadius: 8, border: '1px solid rgba(255,255,255,0.24)', background: 'rgba(255,255,255,0.10)',
              color: '#fff', font: '11.5px/1 system-ui, sans-serif', cursor: 'pointer',
            },
          }, [h(Icon, { key: 'i', name: 'folder', size: 13 }), '打开文件夹']),
          h('button', {
            key: 'x',
            type: 'button',
            onClick: () => setLightbox(null),
            style: {
              display: 'inline-flex', alignItems: 'center', gap: 5, height: 30, padding: '0 11px',
              borderRadius: 8, border: '1px solid rgba(255,255,255,0.24)', background: 'rgba(255,255,255,0.10)',
              color: '#fff', font: '11.5px/1 system-ui, sans-serif', cursor: 'pointer',
            },
          }, [h(Icon, { key: 'i', name: 'close', size: 13 }), '关闭']),
        ]),
      ])) : null

      const toastView = toast ? h('div', {
        key: 'toast',
        style: {
          position: 'fixed', left: '50%', bottom: 26, transform: 'translateX(-50%)',
          padding: '8px 14px', borderRadius: 999, background: 'rgba(28, 32, 40, 0.92)',
          color: '#fff', font: '12px/1.4 system-ui, sans-serif', zIndex: 70,
          boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
        },
      }, toast) : null

      if (bootError) {
        return h('div', {
          style: { padding: 28, font: FONT, color: C.text, background: C.page, height: '100%', overflowY: 'auto', boxSizing: 'border-box' },
        }, [
          h('div', {
            style: {
              maxWidth: 620, padding: 16, borderRadius: 12,
              background: C.dangerSoft, color: C.danger, font: '12.5px/1.7 system-ui, sans-serif',
            },
          }, [
            h('div', { key: 't', style: { fontWeight: 600, marginBottom: 4 } }, '出图服务没有响应'),
            h('div', { key: 'm' }, bootError),
            h('div', { key: 'h', style: { marginTop: 8, color: C.muted } },
              'host 端插件可能还没挂载成功：重启一次 DeepSeek Harness，或检查 ~/.dsh/logs/dsh-minimax-image.log。'),
          ]),
        ])
      }

      return h('div', {
        style: {
          height: '100%',
          overflowY: 'auto',
          overflowX: 'hidden',
          background: C.page,
          boxSizing: 'border-box',
        },
      }, [
        h('style', { key: 'kf' }, '@keyframes dsh-minimax-shimmer{0%{background-position:120% 0}100%{background-position:-40% 0}}'),
        h('div', { key: 'wrap', style: { maxWidth: 1000, margin: '0 auto', padding: '26px 28px 44px', boxSizing: 'border-box' } }, [
          header,
          settingsCard,
          errorBar,
          composer,
          runningCard,
          results,
          billCard,
          historyCard,
          h('footer', {
            key: 'foot',
            style: { color: C.faint, font: '11.5px/1.7 system-ui, sans-serif', marginTop: 18, textAlign: 'center' },
          }, [
            h('div', { key: 'a' }, `dsh-minimax-image v${VERSION} · 图片由 MiniMax ${model} 生成，保存在 ${settings?.outputDir ?? '本机'}。`),
            h('div', { key: 'b', style: { marginTop: 2 } }, '生成的内容请自行确认可用性；同一提示词多次生成结果不同属正常现象。'),
          ]),
        ]),
        lightboxView,
        toastView,
      ])
    }

    function MinimaxIcon() {
      return h(Icon, { name: 'spark', size: 20 })
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(
          () => ctx.slots.inject('main', () =>
            ctx.slots.register(
              { name: 'main', key: 'dsh-minimax-image' },
              MinimaxPage,
            )),
          'dsh-minimax-image: main panel',
        )
        ctx.effect(
          () => ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register(
              { name: 'sidebar.panellist', id: 'dsh-minimax-image', order: 30, label: '出图' },
              MinimaxIcon,
            )),
          'dsh-minimax-image: sidebar entry',
        )
      },
    }
  },
})
