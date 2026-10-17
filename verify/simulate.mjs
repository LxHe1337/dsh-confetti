/**
 * Headless verification for lib/client.js.
 *
 * Runs the real bundle inside a tiny DOM stub:
 *  - the canvas 2D context records every draw op, so a frame can be re-rendered
 *    elsewhere (see render-frame.ps1);
 *  - the fake clock drives requestAnimationFrame / setTimeout deterministically;
 *  - a fake Cordis context + sessions list checks the completion detection.
 *
 * Usage: node verify/simulate.mjs [out.json]
 */

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const bundlePath = path.join(here, '..', 'lib', 'client.js')
const outPath = process.argv[2] || path.join(here, 'frames.json')

const WIDTH = Number(process.argv[3]) || 1280
const HEIGHT = Number(process.argv[4]) || 800
const FRAME_MS = 1000 / 60

// ------------------------------------------------------------ fake clock

let clock = 0
let timerSeq = 1
let timers = []
let rafSeq = 1
let rafCallback = null
let canvasCreated = 0

function fakeSetTimeout(fn, ms) {
  const id = timerSeq++
  timers.push({ id, at: clock + (ms || 0), fn })
  return id
}
function fakeClearTimeout(id) {
  timers = timers.filter((timer) => timer.id !== id)
}
function fakeSetInterval() {
  return timerSeq++
}
function fakeClearInterval() {}

/** Advance the fake clock by `ms`, firing due timers in order. */
function advance(ms) {
  const target = clock + ms
  for (;;) {
    const due = timers
      .filter((timer) => timer.at <= target)
      .sort((a, b) => a.at - b.at)[0]
    if (!due) break
    timers = timers.filter((timer) => timer !== due)
    clock = due.at
    due.fn()
  }
  clock = target
}

/** Run the single pending animation frame at the current clock. */
function frame() {
  const cb = rafCallback
  if (!cb) return false
  rafCallback = null
  cb(clock)
  return true
}

// ------------------------------------------------------------ DOM stubs

function makeContext2D() {
  const state = { tx: 0, ty: 0, rot: 0, sy: 1 }
  const stack = []
  const ctx = {
    globalAlpha: 1,
    fillStyle: '',
    ops: [],
    setTransform() {
      state.tx = 0
      state.ty = 0
      state.rot = 0
      state.sy = 1
    },
    clearRect() {
      ctx.ops = []
    },
    save() {
      stack.push({ ...state })
    },
    restore() {
      const prev = stack.pop()
      if (prev) Object.assign(state, prev)
    },
    translate(x, y) {
      state.tx += x
      state.ty += y
    },
    rotate(rad) {
      state.rot += rad
    },
    scale(x, y) {
      state.sy *= y
    },
    beginPath() {},
    arc() {},
    fill() {},
    fillRect(x, y, w, h) {
      ctx.ops.push({
        kind: 'rect',
        x: state.tx,
        y: state.ty,
        rot: state.rot,
        sy: state.sy,
        w,
        h,
        color: ctx.fillStyle,
        alpha: ctx.globalAlpha,
      })
    },
  }
  return ctx
}

function makeCanvas() {
  canvasCreated += 1
  const context2D = makeContext2D()
  const canvas = {
    tagName: 'CANVAS',
    style: {},
    width: 0,
    height: 0,
    isConnected: true,
    parentNode: null,
    context2D,
    setAttribute() {},
    getContext(kind) {
      return kind === '2d' ? context2D : null
    },
    remove() {
      this.isConnected = false
      if (this.parentNode) this.parentNode.removeChild(this)
    },
  }
  return canvas
}

const body = {
  children: [],
  appendChild(node) {
    node.parentNode = body
    node.isConnected = true
    body.children.push(node)
    return node
  },
  removeChild(node) {
    node.isConnected = false
    body.children = body.children.filter((child) => child !== node)
    return node
  },
}

const documentStub = {
  body,
  documentElement: { clientWidth: WIDTH, clientHeight: HEIGHT },
  visibilityState: 'visible',
  createElement(tag) {
    if (tag !== 'canvas') throw new Error('unexpected element ' + tag)
    return makeCanvas()
  },
}

let loaded = null

/**
 * Just enough React to run the composer-button component without a reconciler:
 * elements are plain records, so the rendered tree can be inspected directly.
 */
const fakeReact = {
  Fragment: 'Fragment',
  createElement(type, props, ...children) {
    return { type, props: props || {}, children }
  },
}

const windowStub = {
  innerWidth: WIDTH,
  innerHeight: HEIGHT,
  devicePixelRatio: 1,
  setTimeout: fakeSetTimeout,
  clearTimeout: fakeClearTimeout,
  setInterval: fakeSetInterval,
  clearInterval: fakeClearInterval,
  requestAnimationFrame(fn) {
    rafCallback = fn
    return rafSeq++
  },
  cancelAnimationFrame() {
    rafCallback = null
  },
  addEventListener() {},
  removeEventListener() {},
  matchMedia() {
    return { matches: false }
  },
  __ModuleLoader__: {
    load(entry) {
      loaded = entry.factory((id) => {
        if (id === 'react') return fakeReact
        throw new Error('preview: no external module "' + id + '"')
      })
    },
  },
}

// ------------------------------------------------------------ boot bundle

const source = fs.readFileSync(bundlePath, 'utf8')
// The bundle's cooldown reads `Date.now()`; pin it to the fake clock so the
// cooldown cases below are time-travel, not wall-clock races.
const sandbox = { window: windowStub, document: documentStub, console, Date: { now: () => clock } }
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: bundlePath })

if (!loaded) throw new Error('bundle did not return a module')
if (typeof loaded.apply !== 'function') throw new Error('bundle has no apply()')

const api = windowStub.__dshConfetti
if (!api || typeof api.fire !== 'function') throw new Error('bundle did not publish __dshConfetti')
if (loaded.fire !== api.fire) throw new Error('module export fire is not the published trigger')

// -------------------------------------------------- A. visual frame capture

api.fire()

function stepFrames(count) {
  for (let i = 0; i < count; i += 1) {
    advance(FRAME_MS)
    if (!frame()) return false
  }
  return true
}

const capturePoints = [12, 24, 42, 78] // ≈0.20 s, 0.40 s, 0.70 s, 1.30 s
const frames = []
let stepped = 0
for (const point of capturePoints) {
  if (!stepFrames(point - stepped)) throw new Error('animation stopped before frame ' + point)
  stepped = point
  const canvas = body.children[body.children.length - 1]
  if (!canvas) throw new Error('no canvas mounted')
  frames.push({
    frame: point,
    timeSeconds: +(clock / 1000).toFixed(3),
    canvas: { width: canvas.width, height: canvas.height },
    ops: canvas.context2D.ops.map((op) => ({
      kind: op.kind,
      x: +op.x.toFixed(2),
      y: +op.y.toFixed(2),
      rot: +op.rot.toFixed(4),
      sy: +op.sy.toFixed(3),
      w: +op.w.toFixed(2),
      h: +op.h.toFixed(2),
      color: op.color,
      alpha: +op.alpha.toFixed(3),
    })),
  })
}

// Let the whole celebration drain, then confirm the loop stopped on its own.
let guard = 0
while (rafCallback && guard < 4000) {
  advance(FRAME_MS)
  frame()
  guard += 1
}
const finishedClean = rafCallback === null && body.children.length === 1

// ------------------------------------------------- B. detection behaviour

const listListeners = []
let snapshot = { byId: {} }
const sessionsService = {
  list: {
    getSnapshot: () => snapshot,
    subscribe(fn) {
      listListeners.push(fn)
      return () => {
        const index = listListeners.indexOf(fn)
        if (index >= 0) listListeners.splice(index, 1)
      }
    },
  },
}
const localeRegistrations = []
const translated = { button: '撒彩带', hint: '手动撒一把彩带' }
const localeService = {
  register(namespace, dictionaries) {
    localeRegistrations.push({ namespace, dictionaries })
    return () => {}
  },
  bind(namespace) {
    return (key) => (namespace === 'dsh-confetti' ? translated[key] || key : key)
  },
}

let injectedSlot = null
let packedRegistration = null
const slotsService = {
  inject(slotName, callback) {
    injectedSlot = slotName
    callback()
    return () => {}
  },
  register(options, component) {
    packedRegistration = { options, component }
    return () => {}
  },
}

const effectCleanups = []
const fakeCtx = {
  get(name) {
    if (name === 'sessions') return sessionsService
    if (name === 'locale') return localeService
    return undefined
  },
  effect(callback) {
    effectCleanups.push(callback())
  },
  slots: slotsService,
}

function publish(byId) {
  snapshot = { byId }
  for (const listener of listListeners.slice()) listener()
}

/** A celebration always needs a canvas; clearing between cases makes that the counter. */
function celebrations() {
  return canvasCreated
}

api.clear()
loaded.apply(fakeCtx, undefined)
const baseline = celebrations()

// 1. sessions that are already idle when the page loads stay quiet
publish({ old1: { id: 'old1', running: false }, old2: { id: 'old2' } })
const afterHistorical = celebrations()

// 2. a turn opens and closes: one celebration
publish({ old1: { id: 'old1', running: false }, live1: { id: 'live1', running: true } })
const afterStart = celebrations()
publish({ old1: { id: 'old1', running: false }, live1: { id: 'live1', running: false } })
const afterTopLevel = celebrations()
api.clear()

// 3. a delegated child closing is not the user's conversation
const beforeChild = celebrations()
publish({
  old1: { id: 'old1', running: false },
  live1: { id: 'live1', running: false },
  child1: { id: 'child1', running: true, origin: 'subagent', parentId: 'live1' },
})
publish({
  old1: { id: 'old1', running: false },
  live1: { id: 'live1', running: false },
  child1: { id: 'child1', running: false, origin: 'subagent', parentId: 'live1' },
})
const afterChild = celebrations()

// 4. a second top-level finish inside the cooldown stays quiet
publish({
  live1: { id: 'live1', running: true },
  child1: { id: 'child1', running: false, origin: 'subagent', parentId: 'live1' },
})
publish({
  live1: { id: 'live1', running: false },
  child1: { id: 'child1', running: false, origin: 'subagent', parentId: 'live1' },
})
const afterCooldownSuppressed = celebrations()

// 5. …and once the cooldown lapses it celebrates normally
advance(1200)
publish({ live1: { id: 'live1', running: true } })
publish({ live1: { id: 'live1', running: false } })
const afterCooldownLapsed = celebrations()
api.clear()

// 6. the composer button fires on demand — including inside the cooldown window
const beforeButton = celebrations()
const buttonTree = packedRegistration && packedRegistration.component()
const buttonElement = buttonTree && buttonTree.children[1]
const buttonClicked = !!(buttonElement && typeof buttonElement.props.onClick === 'function')
if (buttonClicked) buttonElement.props.onClick({ preventDefault() {}, stopPropagation() {} })
const afterButton = celebrations()

const buttonFacts = {
  slot: injectedSlot,
  registrationId: packedRegistration && packedRegistration.options && packedRegistration.options.id,
  order: packedRegistration && packedRegistration.options && packedRegistration.options.order,
  labelThunk: packedRegistration && packedRegistration.options && packedRegistration.options.label(),
  renderedTag: buttonElement && buttonElement.type,
  renderedClass: buttonElement && buttonElement.props && buttonElement.props.className,
  ariaLabel: buttonElement && buttonElement.props && buttonElement.props['aria-label'],
  title: buttonElement && buttonElement.props && buttonElement.props.title,
  styleElement: !!(buttonTree && buttonTree.children[0] && buttonTree.children[0].type === 'style'),
  localeNamespace: localeRegistrations[0] && localeRegistrations[0].namespace,
  localeLanguages: localeRegistrations[0] ? Object.keys(localeRegistrations[0].dictionaries).sort().join(',') : '',
}
api.clear()

// 7. `button: false` hides the seat without losing the automatic celebration
packedRegistration = null
injectedSlot = null
loaded.apply(
  {
    get() {
      return undefined
    },
    effect() {},
    slots: slotsService,
  },
  { button: false },
)
const hiddenWithConfig = packedRegistration === null && injectedSlot === null

// 8. disposal unwires the subscription and drops the canvas
const listenersBeforeDispose = listListeners.length
if (effectCleanups.length === 0) throw new Error('apply() registered no cleanup effects')
for (const cleanup of effectCleanups) {
  if (typeof cleanup === 'function') cleanup()
}
const listenersAfterDispose = listListeners.length
const canvasesLeftBehind = body.children.length

const report = {
  bundle: path.relative(process.cwd(), bundlePath),
  viewport: { width: WIDTH, height: HEIGHT },
  piecesAtCapture: frames.map((entry) => entry.ops.length),
  capturePoints,
  inRange: frames.every((entry) =>
    entry.ops.every((op) => Number.isFinite(op.x) && Number.isFinite(op.y) && op.alpha > 0 && op.alpha <= 1),
  ),
  finishedClean,
  distinctColors: [...new Set(frames[1].ops.map((op) => op.color))].length,
  detection: {
    historicalIdleSilent: afterHistorical === baseline,
    turnStartSilent: afterStart === baseline,
    topLevelFinishCelebrated: afterTopLevel === baseline + 1,
    subagentFinishSilent: afterChild === beforeChild,
    cooldownSuppressed: afterCooldownSuppressed === beforeChild,
    cooldownLapsedCelebrates: afterCooldownLapsed === afterChild + 1,
    subscriptionRemoved: listenersAfterDispose === 0,
    listenersBeforeDispose,
    canvasesLeftBehind,
  },
  button: {
    ...buttonFacts,
    firesOnClick: afterButton === beforeButton + 1,
    hiddenWithConfig,
  },
  frames,
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8')

console.log(
  JSON.stringify(
    {
      piecesAtCapture: report.piecesAtCapture,
      inRange: report.inRange,
      finishedClean: report.finishedClean,
      distinctColors: report.distinctColors,
      detection: report.detection,
      button: report.button,
    },
    null,
    2,
  ),
)
console.log('frames written to ' + outPath)
