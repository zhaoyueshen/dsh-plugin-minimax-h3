/**
 * Structural harness for client.js — runs the browser half outside a browser.
 *
 * Phase 1 mounts the page with its real initial state.
 * Phase 2 injects a fabricated `result` into the component's initial state (by
 * rewriting that one line of source) so the results card and its buttons are
 * exercised too.
 *
 * It cannot prove the UI looks right, but it proves the bundle loads, the slots
 * register, and both render paths resolve without referencing anything undefined.
 */

import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

function makeLoader() {
  let loaded = null
  const window = { __ModuleLoader__: { load(value) { loaded = value } } }
  return { window, get loaded() { return loaded } }
}

function createElement(type, props, ...children) {
  const flat = children.flat(Infinity).filter((item) => item !== undefined)
  const merged = { ...(props ?? {}) }
  if (flat.length) merged.children = flat.length === 1 ? flat[0] : flat
  return { type, props: merged }
}

const React = {
  createElement,
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => (typeof fn === 'function' ? fn() : fn),
  useRef: (initial) => ({ current: initial ?? null }),
}

const requireStub = (id) => {
  if (id === 'react') return React
  throw new Error(`unexpected require: ${id}`)
}

/** Resolve function components the way React would, collecting real elements. */
function render(code) {
  const loader = makeLoader()
  new Function('window', 'require', code)(loader.window, requireStub)
  if (!loader.loaded) throw new Error('client.js never called window.__ModuleLoader__.load')
  const plugin = loader.loaded.factory(requireStub)

  const registered = []
  const ctx = {
    effect: (fn) => fn(),
    slots: {
      inject: (name, fn) => fn(),
      register: (options, component) => {
        registered.push({ name: options.name, options, component })
        return { dispose() {} }
      },
    },
  }
  plugin.apply(ctx)

  const elements = []
  function resolve(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return null
    if (typeof node === 'string' || typeof node === 'number') return node
    if (Array.isArray(node)) return node.map(resolve)
    if (typeof node.type === 'function') return resolve(node.type(node.props))
    const children = resolve(node.props.children)
    elements.push({ type: node.type })
    return { type: node.type, props: node.props, children }
  }

  const main = registered.find((entry) => entry.name === 'main')
  const sidebar = registered.find((entry) => entry.name === 'sidebar.panellist')
  const tree = resolve(createElement(main.component, {}))
  return { registered, elements, tree, main, sidebar }
}

// --- phase 1: the real initial state --------------------------------------
const first = render(source)
if (!first.main || !first.sidebar) throw new Error('slots are not registered')
if (first.sidebar.options.label !== '出图') throw new Error(`unexpected sidebar label: ${first.sidebar.options.label}`)
if (first.main.options.key !== 'dsh-minimax-image') throw new Error('main slot key does not match the sidebar id')

const count = (elements, type) => elements.filter((element) => element.type === type).length
console.log(`phase 1: ${first.elements.length} elements (svg=${count(first.elements, 'svg')}, button=${count(first.elements, 'button')}, textarea=${count(first.elements, 'textarea')}, select=${count(first.elements, 'select')})`)
if (count(first.elements, 'textarea') !== 1) throw new Error('composer textarea is missing')
if (count(first.elements, 'select') < 3) throw new Error('ratio / area / model selects are missing')
if (count(first.elements, 'button') < 8) throw new Error('expected mode pills, examples and the submit button')

// --- phase 2: a finished result is on screen ------------------------------
const fakeResult = {
  kind: 'edit',
  prompt: '把图1的猫换成柯基',
  model: 'MiniMax-H3-Image',
  aspectRatio: 'auto',
  area: '',
  refs: 1,
  n: 1,
  ms: 19100,
  directory: 'C:/tmp/out',
  warnings: [],
  images: [{
    rel: '2026-11-12/a.jpeg',
    name: 'a.jpeg',
    path: 'C:/tmp/out/a.jpeg',
    bytes: 1024,
    size: '5440x3072',
    url: '/dsh-minimax-image/file?name=2026-11-12%2Fa.jpeg',
  }],
}

const marker = 'const [result, setResult] = useState(null)'
if (!source.includes(marker)) throw new Error('could not find the result state to inject')
const patched = source.replace(marker, `const [result, setResult] = useState(${JSON.stringify(fakeResult)})`)

const second = render(patched)
const flat = JSON.stringify(second.tree)
for (const label of ['本次结果', '继续编辑', '打开文件夹', '编辑 · 1 张参考图']) {
  if (!flat.includes(label)) throw new Error(`results card is missing "${label}"`)
}
console.log(`phase 2: ${second.elements.length} elements; results card renders 继续编辑 + 打开文件夹`)

// The lightbox is a separate branch; inject it the same way.
const lightboxMarker = 'const [lightbox, setLightbox] = useState(null)'
if (!source.includes(lightboxMarker)) throw new Error('could not find the lightbox state to inject')
const withLightbox = source.replace(
  lightboxMarker,
  `const [lightbox, setLightbox] = useState(${JSON.stringify({
    url: '/dsh-minimax-image/file?name=2026-11-12%2Fa.jpeg',
    name: 'a.jpeg',
    path: 'C:/tmp/out/a.jpeg',
  })})`,
)
const third = render(withLightbox)
const lightboxText = JSON.stringify(third.tree)
for (const label of ['保存图片', '编辑图片', '打开文件夹', '关闭']) {
  if (!lightboxText.includes(label)) throw new Error(`lightbox is missing "${label}"`)
}
console.log('phase 3: lightbox renders 保存图片 + 编辑图片 + 打开文件夹 + 关闭')

// A reference-image lightbox has no on-disk path yet, so it must not offer 复制路径.
const refOnly = render(source.replace(
  lightboxMarker,
  `const [lightbox, setLightbox] = useState(${JSON.stringify({
    url: 'data:image/jpeg;base64,AAAA',
    name: 'ref.jpg',
    path: '',
    kind: 'ref',
  })})`,
))
const refText = JSON.stringify(refOnly.tree)
if (!refText.includes('保存图片')) throw new Error('reference lightbox is missing 保存图片')
if (refText.includes('打开文件夹')) throw new Error('reference lightbox should not offer 打开文件夹')
if (refText.includes('编辑图片')) throw new Error('reference lightbox should not offer 编辑图片 (already a reference)')
console.log('phase 4: reference lightbox renders 保存图片 only')

// History rows carry 编辑图片 + 复用 + delete, and a cost badge built from usage.
const historyMarker = 'const [history, setHistory] = useState([])'
if (!source.includes(historyMarker)) throw new Error('could not find the history state to inject')
const fakeHistory = [
  {
    id: 'abc',
    at: '2026-11-12T09:55:40.000Z',
    kind: 'edit',
    prompt: '盘子下方还是不完整',
    model: 'MiniMax-H3-Image',
    aspectRatio: 'auto',
    area: '',
    refs: 1,
    n: 1,
    region: 'intl',
    currency: 'USD',
    ms: 19100,
    usage: {
      generated_images: 1,
      total_tokens: 7254,
      input_tokens: 3174,
      output_tokens: 4080,
      input_tokens_details: { text_tokens: 3174, image_tokens: 0 },
      output_tokens_details: { image_tokens: 4080 },
    },
    warnings: [],
    images: [{ rel: '2026-11-12/b.jpeg', name: 'b.jpeg', bytes: 3922000, size: '1024x1024', url: '/dsh-minimax-image/file?name=x' }],
  },
  {
    // An older row: no usage, so the badge must fall back to the price table.
    id: 'old',
    at: '2026-11-12T06:00:00.000Z',
    kind: 'generate',
    prompt: '浅色木桌',
    model: 'MiniMax-H3-Image',
    aspectRatio: '1:1',
    area: '1K',
    refs: 0,
    n: 1,
    region: 'intl',
    currency: 'CNY',
    ms: 8000,
    warnings: [],
    images: [{ rel: '2026-11-12/c.jpeg', name: 'c.jpeg', bytes: 300000, size: '1024x1024', url: '/dsh-minimax-image/file?name=y' }],
  },
  {
    // CN site + 4K: ¥0.4522 reference price, halved by the 4K promo.
    id: 'cn4k',
    at: '2026-11-13T04:00:00.000Z',
    kind: 'generate',
    prompt: '白瓷盘',
    model: 'MiniMax-H3-Image',
    aspectRatio: '1:1',
    area: '4K',
    refs: 0,
    n: 1,
    region: 'cn',
    currency: 'CNY',
    ms: 9000,
    warnings: [],
    images: [{ rel: '2026-11-13/d.jpeg', name: 'd.jpeg', bytes: 700000, size: '4096x4096', url: '/dsh-minimax-image/file?name=z' }],
  },
]
const withHistory = render(source.replace(
  historyMarker,
  `const [history, setHistory] = useState(${JSON.stringify(fakeHistory)})`,
))
const historyText = JSON.stringify(withHistory.tree)
for (const label of ['编辑图片', '复用', '最近生成']) {
  if (!historyText.includes(label)) throw new Error(`history row is missing "${label}"`)
}
// 3174 text + 4080 output tokens at $2.30 / $3.80 per M → $0.0228 → $0.02 (USD row)
if (!historyText.includes('约 $0.02')) throw new Error('history row is missing the usage-based cost badge')
// No usage on the second row: 1K text-to-image reference price is ¥0.143 → ¥0.14.
if (!historyText.includes('约 ¥0.14')) throw new Error('history row is missing the table-based cost fallback')
// CN site + 4K: the 4K promo halves ¥0.4522 to ¥0.2261 → ¥0.23.
if (!historyText.includes('约 ¥0.23')) throw new Error('CN/4K cost should use CNY and the 4K promo')
if (!historyText.includes('最终以账单为准')) throw new Error('cost badge should explain that the amount is an estimate')
console.log('phase 5: history row renders 编辑图片 + 复用 + cost badge (usage, fallback, CN promo)')

// The cost badge uses the same sans-serif family as the rest of the row.
const costNode = (function find(node) {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child)
      if (hit) return hit
    }
    return null
  }
  if (typeof node.props?.title === 'string' && node.props.title.includes('最终以账单为准')) return node
  return find(node.children)
})(withHistory.tree)
if (!costNode) throw new Error('cost badge node not found')
if (String(costNode.props.style?.font).includes('monospace')) throw new Error('cost badge should use the UI font')
if (!String(costNode.props.style?.font).includes('system-ui')) throw new Error('cost badge font is not system-ui')
if (!String(costNode.props.style?.font).includes('600')) throw new Error('cost badge should be bold')

// --- official bill summary ------------------------------------------------
const billMarker = 'const [bill, setBill] = useState(null)'
if (!source.includes(billMarker)) throw new Error('could not find the bill state to inject')
const fakeBill = {
  days: 7,
  since: '2026-11-07',
  until: '2026-11-13',
  total: 6.5792,
  totalBeforeVoucher: 6.5792,
  tokens: 527887,
  records: 17,
  latest: '2026-11-12 20:00-21:00',
  currency: 'CNY',
  fetchedAt: '2026-11-13T05:30:00.000Z',
}
const withBill = render(source.replace(
  billMarker,
  `const [bill, setBill] = useState(${JSON.stringify(fakeBill)})`,
))
const billText = JSON.stringify(withBill.tree)
for (const label of ['官方账单', '¥6.58', '消费明细', '截至 2026-11-12 20:00-21:00', 'platform.minimax.cn/console/consumption-detail']) {
  if (!billText.includes(label)) throw new Error(`official bill card is missing "${label}"`)
}
console.log('phase 5b: official bill card renders 近 7 天 ¥6.58 + 消费明细 link')

// --- phase 6: multi-image results expose a per-image "接着改" ---------------
const twoImages = {
  ...fakeResult,
  n: 2,
  images: [
    fakeResult.images[0],
    { ...fakeResult.images[0], rel: '2026-11-12/b.jpeg', name: 'b.jpeg', path: 'C:/tmp/out/b.jpeg' },
  ],
}
const multi = render(source.replace(marker, `const [result, setResult] = useState(${JSON.stringify(twoImages)})`))
const multiFlat = JSON.stringify(multi.tree)
// Counting by string would double up: each node carries its children twice
// (props.children plus the resolved children array), so walk the tree once.
const withTitle = (root, title) => {
  let found = 0
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (node.props?.title === title) found += 1
    walk(node.children)
  }
  walk(root)
  return found
}
const perImage = withTitle(multi.tree, '把这张设为图1接着改')
if (perImage !== 2) throw new Error(`expected one 接着改 entry per image (2), got ${perImage}`)
if (!multiFlat.includes('第 1 张接着改')) throw new Error('the header button should name the 1st image when several exist')
console.log(`phase 6: 2 张结果 → ${perImage} 个逐张「接着改」入口 + 标题栏继续编辑`)

// --- phase 7: the guard switch and the 1..10 count stepper -----------------
const composerText = JSON.stringify(first.tree)
if (!composerText.includes('构图护栏')) throw new Error('composer is missing the 构图护栏 switch')
if (!composerText.includes('提示词原样发送')) throw new Error('guard switch should describe its off state')
if (!composerText.includes('多一张（上限 10）')) throw new Error('count stepper should cap at 10 for H3')
console.log('phase 7: 构图护栏开关（默认关）+ 张数步进器（上限 10）')

console.log('OK: client bundle is structurally sound')
