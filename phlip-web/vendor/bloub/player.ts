import { NOTIF_BLUE } from './bot/decor'
import { BotEngine, type BotFrame } from './bot/engine'
import { EXPRESSION_BY_ID, type ExpressionId } from './bot/expressions'
import { clamp, easings } from './bot/math'
import { RAYON } from './bot/repere'
import { COLOR_BY_ID, SHAPE_BY_ID, mixHex } from './bot/skins'
import { STATE_BY_ID, type StateId } from './bot/states'
import { offsetOf, type Block } from './bot/cycles'
import { lookTarget, TURN_TIME } from './gaze'

declare global {
  interface Window {
    Phlippy: PhlippyApi
  }
}

export interface PhlippyApi {
  mount: (target?: HTMLElement | null) => SVGSVGElement
  wake: () => void
  sleep: () => void
  lookAt: (target: LookAtTarget) => void
  express: (id?: string | null) => void
  play: (stateId: string, onDone?: () => void) => void
  syncTheme: () => void
  host: SVGSVGElement | null
}

export type LookAnchor = 'center' | 'top-center'

export type LookAtTarget =
  | Element
  | { x: number; y: number }
  | { el: Element; at?: LookAnchor }
  | null

/** Looping idle (blink + gaze). Body is always squircle. */
const IDLE_CYCLE: Block[] = [{ state: 'idle', duration: 60, expression: 'neutre' }]
const SHAPE_ID = 'squircle'
const INK_FALLBACK = COLOR_BY_ID.get('encre')?.hex ?? '#0a0a0c'
const PAPER_WHITE = '#ffffff'
/** Axis-aligned half-size of the idle squircle (cardinal r ≈ 0.96×RAYON).
 *  116 was the diagonal, which left a ~9px page ring around a 43px face. */
const VIEW = 96
const HOST_ID = 'fab-phlippy'

const uid = 'phlippy'

let svg: SVGSVGElement | null = null
let engine: BotEngine | null = null
let raf = 0
let last = 0
let clock = 0
let blockIndex = 0
let blockStart = 0
let nextAt = Infinity
let pointer: { x: number; y: number } | null = null
let explicit: Exclude<LookAtTarget, null> | null = null
let aiming = false
let turnSince = 0
let paper = PAPER_WHITE
let ink = INK_FALLBACK
let listenersBound = false
let hiddenBound = false
let looping = false
let holdCycle = false
let playGen = 0
let playUntil = Infinity
let playDone: (() => void) | null = null

function prefersReducedMotion(): boolean {
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  } catch {
    return false
  }
}

function cssColorToHex(c: string): string {
  if (!c) return INK_FALLBACK
  if (c[0] === '#') return c.length === 4
    ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`
    : c
  const m = c.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  if (!m) return INK_FALLBACK
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`
}

function resolvePaper(): string {
  return PAPER_WHITE
}

function resolveInk(): string {
  try {
    const token = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim()
    if (token) return cssColorToHex(token)
  } catch {}
  return INK_FALLBACK
}

function squircleRadii(): number[] {
  return SHAPE_BY_ID.get(SHAPE_ID)!.radii
}

function expressionOf(block: Block | undefined): ExpressionId {
  return (block?.expression as ExpressionId) || 'neutre'
}

function applyBlock(i: number, from = 0) {
  const cycle = IDLE_CYCLE
  const b = cycle[i]
  if (!b || !engine) {
    nextAt = Infinity
    return
  }
  blockIndex = i
  blockStart = clock - from
  engine.setState(b.state, clock)
  const expr = EXPRESSION_BY_ID.get(expressionOf(b)) ?? EXPRESSION_BY_ID.get('neutre')
  engine.setExpression(expr ?? null, clock)
  nextAt = blockStart + b.duration
}

function advanceCycle() {
  if (holdCycle) {
    if (playUntil < Infinity && clock >= playUntil) finishPlay()
    return
  }
  const cycle = IDLE_CYCLE
  if (!cycle.length) return
  if (clock < nextAt) return
  const next = (blockIndex + 1) % cycle.length
  if (next < blockIndex) {
    const b = cycle[next]!
    engine?.reset(b.state, offsetOf(cycle, next))
    blockIndex = next
    blockStart = clock
    engine?.setExpression(
      EXPRESSION_BY_ID.get(expressionOf(b)) ?? EXPRESSION_BY_ID.get('neutre') ?? null,
      clock
    )
    nextAt = blockStart + b.duration
    return
  }
  applyBlock(next)
}

function finishPlay() {
  const done = playDone
  playDone = null
  playUntil = Infinity
  holdCycle = false
  if (engine) {
    engine.setState('idle', clock)
    applyBlock(0)
  }
  done?.()
}

function pointOf(target: Exclude<LookAtTarget, null>): { x: number; y: number } | null {
  if ('el' in target && target.el && typeof (target.el as Element).getBoundingClientRect === 'function') {
    const box = target.el.getBoundingClientRect()
    if (!box.width && !box.height) return null
    if (target.at === 'top-center') {
      return { x: box.left + box.width / 2, y: box.top }
    }
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
  }
  if ('getBoundingClientRect' in target) {
    const box = target.getBoundingClientRect()
    if (!box.width && !box.height) return null
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
  }
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) return null
  return target
}

function releaseLook() {
  if (!aiming || !engine) return
  engine.setLook(null, clock, TURN_TIME)
  aiming = false
}

function aim() {
  if (!engine || !svg) return
  const state = engine.state as StateId
  if (!STATE_BY_ID.get(state)?.baseFace) {
    releaseLook()
    return
  }
  const box = svg.getBoundingClientRect()
  if (!box.width || !box.height) return

  let pos: { x: number; y: number } | null = null
  if (explicit) pos = pointOf(explicit)
  else pos = pointer

  if (!aiming) turnSince = clock
  const cx = box.left + box.width / 2
  const cy = box.top + box.height / 2
  const halfW = Math.max(1, window.innerWidth / 2)
  const halfH = Math.max(1, window.innerHeight / 2)
  const near = !!explicit
  const reachY = near ? 80 : halfH
  const has = pos !== null
  engine.setLook(
    lookTarget({
      nx: has ? clamp((pos!.x - cx) / halfW, -1, 1) : 0,
      ny: has ? clamp((pos!.y - cy) / reachY, -1, 1) : 0,
      tour: easings.easeOutQuint(clamp((clock - turnSince) / TURN_TIME)),
      pointer: has,
      near
    }),
    clock
  )
  aiming = true
}

function dotMarkup(dot: BotFrame['dots'][number]): string {
  const fill =
    dot.color ?? (dot.depth === undefined ? ink : mixHex(paper, ink, dot.depth))
  const op = dot.opacity
  if (dot.d) {
    const rot = dot.rot ?? 0
    return `<path d="${dot.d}" fill="${fill}" opacity="${op}" transform="translate(${dot.x} ${dot.y}) rotate(${rot}) scale(${RAYON})"></path>`
  }
  return `<circle cx="${dot.x}" cy="${dot.y}" r="${dot.r}" fill="${fill}" opacity="${op}"></circle>`
}

function paint(frame: BotFrame) {
  if (!svg) return
  const grads = frame.arcs
    .map(
      (arc) => {
        const last = Math.max(1, arc.grad.stops.length - 1)
        const stops = arc.grad.stops
          .map((c, i) => `<stop offset="${i / last}" stop-color="${c}"></stop>`)
          .join('')
        return `<linearGradient id="${uid}-${arc.id}" gradientUnits="userSpaceOnUse" x1="${arc.grad.x1}" y1="${arc.grad.y1}" x2="${arc.grad.x2}" y2="${arc.grad.y2}">${stops}</linearGradient>`
      }
    )
    .join('')
  const eyes = frame.eyes
    .map(
      (eye) =>
        `<path d="${eye.d}" transform="${eye.matrix}" opacity="${eye.alpha}" fill="${paper}"></path>`
    )
    .join('')
  const notch = frame.notch
    ? `<circle cx="${frame.notch.x}" cy="${frame.notch.y}" r="${frame.notch.r}" fill="${paper}"></circle>`
    : ''
  const backArcs = frame.arcs
    .map(
      (arc) =>
        `<path d="${arc.back}" stroke="url(#${uid}-${arc.id})" stroke-width="${arc.width}" opacity="${arc.opacity}"></path>`
    )
    .join('')
  const frontArcs = frame.arcs
    .map(
      (arc) =>
        `<path d="${arc.front}" stroke="url(#${uid}-${arc.id})" stroke-width="${arc.width}" opacity="${arc.opacity}"></path>`
    )
    .join('')
  const dots = frame.dots.map(dotMarkup).join('')
  const notif = frame.notif
    ? `<circle cx="${frame.notif.x}" cy="${frame.notif.y}" r="${frame.notif.r}" fill="${NOTIF_BLUE}"></circle>`
    : ''
  const dotsBehind = frame.dotsBehind ? `<g>${dots}</g>` : ''
  const dotsFront = frame.dotsBehind ? '' : `<g>${dots}</g>`

  svg.innerHTML =
    (grads ? `<defs>${grads}</defs>` : '') +
    `<g fill="none" stroke-linecap="round">${backArcs}</g>` +
    dotsBehind +
    `<g opacity="${frame.bodyAlpha}">` +
    `<path d="${frame.bodyPath}" fill="${ink}"></path>` +
    eyes +
    notch +
    `</g>` +
    dotsFront +
    notif +
    `<g fill="none" stroke-linecap="round">${frontArcs}</g>`
}

function sampleAndPaint() {
  if (!engine) return
  paint(engine.sample(clock))
}

function tick(ms: number) {
  if (!svg?.isConnected) {
    looping = false
    stopLoop()
    return
  }
  raf = requestAnimationFrame(tick)
  const dt = last ? Math.min((ms - last) / 1000, 0.064) : 0
  last = ms
  clock += dt
  advanceCycle()
  aim()
  sampleAndPaint()
}

function stopLoop() {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  last = 0
}

function startLoop() {
  if (!looping || prefersReducedMotion()) {
    sampleAndPaint()
    return
  }
  if (raf) return
  last = 0
  raf = requestAnimationFrame(tick)
}

function onPointerMove(event: PointerEvent) {
  if (event.pointerType === 'touch') return
  pointer = { x: event.clientX, y: event.clientY }
}

function onPointerLeave() {
  pointer = null
}

function bindListeners() {
  if (!listenersBound) {
    window.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerleave', onPointerLeave)
    listenersBound = true
  }
  if (hiddenBound) return
  document.addEventListener('visibilitychange', onVisibility)
  try {
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.addEventListener('change', onMotionPref)
  } catch {}
  hiddenBound = true
}

function onVisibility() {
  if (document.hidden) {
    stopLoop()
  } else if (looping) {
    startLoop()
  }
}

function onMotionPref() {
  if (prefersReducedMotion()) stopLoop()
  else if (looping) startLoop()
  sampleAndPaint()
}

function createSvg(): SVGSVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  el.id = HOST_ID
  el.setAttribute('class', 'tl-fab-phlippy')
  el.setAttribute('width', '52')
  el.setAttribute('height', '52')
  el.setAttribute('viewBox', `${-VIEW} ${-VIEW} ${VIEW * 2} ${VIEW * 2}`)
  el.setAttribute('role', 'img')
  el.setAttribute('aria-hidden', 'true')
  el.setAttribute('overflow', 'visible')
  return el
}

function ensureEngine() {
  if (engine) return
  const expr = EXPRESSION_BY_ID.get('neutre') ?? null
  engine = new BotEngine(RAYON, 'idle', squircleRadii(), expr)
  clock = 0
  applyBlock(0)
}

function mount(target?: HTMLElement | null): SVGSVGElement {
  ensureEngine()
  paper = resolvePaper()
  ink = resolveInk()
  if (!svg) svg = createSvg()
  if (target && svg.parentNode !== target) target.appendChild(svg)
  bindListeners()
  sampleAndPaint()
  syncApiHost()
  return svg
}

function wake() {
  if (prefersReducedMotion()) {
    looping = false
    stopLoop()
    sampleAndPaint()
    return
  }
  looping = true
  startLoop()
}

function sleep() {
  looping = false
  holdCycle = false
  playGen += 1
  playDone = null
  playUntil = Infinity
  stopLoop()
}

function lookAt(target: LookAtTarget) {
  explicit = target
  if (!target) {
    pointer = null
    releaseLook()
  }
}

function express(id?: string | null) {
  ensureEngine()
  if (!engine) return
  const expr = EXPRESSION_BY_ID.get(id || 'neutre') ?? EXPRESSION_BY_ID.get('neutre')
  engine.setExpression(expr ?? null, clock)
  holdCycle = true
  nextAt = Infinity
  sampleAndPaint()
}

function play(stateId: string, onDone?: () => void) {
  ensureEngine()
  const def = STATE_BY_ID.get(stateId as StateId)
  if (!engine || !def) {
    onDone?.()
    return
  }
  const gen = ++playGen
  holdCycle = true
  nextAt = Infinity
  playDone = function () {
    if (gen !== playGen) return
    onDone?.()
  }
  engine.setState(stateId as StateId, clock)
  playUntil = clock + def.duration
  wake()
}

function syncTheme() {
  paper = resolvePaper()
  ink = resolveInk()
  sampleAndPaint()
}

function syncApiHost() {
  api.host = svg
}

const api: PhlippyApi = {
  mount,
  wake,
  sleep,
  lookAt,
  express,
  play,
  syncTheme,
  host: null
}

window.Phlippy = api

export {}
