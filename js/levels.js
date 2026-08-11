/* Coffinat — the caffeine-level "traffic light": a ladder of effect bands (most intense at the top
   → settled at the bottom) that marks where you are NOW, your ACTUAL peak, and (with the forecast
   on) your PREDICTED peak. Marker colours match the chart: amber = actual, teal = forecast. The
   bands, thresholds and tolerance live in model.js. */
import { EFFECT_LEVELS, effectLevel, minutesToClock } from '../model.js'

let ladderEl = null
let peakEl = null

function el(tag, cls, text) {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}

export function init() {
  ladderEl = document.getElementById('levels-ladder')
  peakEl = document.getElementById('levels-peak')
}

/**
 * ctx: {
 *   nowVal:   number | null,            // current actual level (today only)
 *   factor:   number,                   // tolerance multiplier
 *   actual:   { val, min },             // actual peak (from what's logged)
 *   predicted:{ val, min } | null,      // peak with the planned drink (forecast on), else null
 * }
 */
export function update(ctx) {
  const nowLvl = ctx.nowVal != null ? effectLevel(ctx.nowVal, ctx.factor) : null
  const actualLvl = effectLevel(ctx.actual.val, ctx.factor)
  const predictedLvl = ctx.predicted ? effectLevel(ctx.predicted.val, ctx.factor) : null

  // Header: actual peak, and the predicted peak when a forecast drink is on.
  peakEl.textContent = ''
  peakEl.appendChild(document.createTextNode('Peak '))
  peakEl.appendChild(el('strong', 'levels__peak-actual', ctx.actual.val > 0 ? ctx.actual.val.toFixed(2) + ' mg/L' : '—'))
  if (ctx.actual.val > 0 && ctx.actual.min != null) {
    peakEl.appendChild(document.createTextNode(' · around ' + minutesToClock(ctx.actual.min)))
  }
  if (ctx.predicted) {
    peakEl.appendChild(document.createTextNode(' · predicted '))
    peakEl.appendChild(el('strong', 'levels__peak-predicted', ctx.predicted.val.toFixed(2) + ' mg/L'))
  }

  // Ladder, most intense band first.
  ladderEl.textContent = ''
  for (let i = EFFECT_LEVELS.length - 1; i >= 0; i--) {
    const lvl = EFFECT_LEVELS[i]
    const isNow = lvl === nowLvl
    const isActual = lvl === actualLvl
    const isPredicted = lvl === predictedLvl
    const active = isNow || isActual || isPredicted

    const row = el('div', 'lvl-row lvl-row--' + lvl.key + (active ? ' lvl-row--active' : ''))
    row.appendChild(el('span', 'lvl-row__bar'))

    const body = el('div', 'lvl-row__body')
    const head = el('div', 'lvl-row__head')
    head.appendChild(el('span', 'lvl-row__label', lvl.label))
    if (isNow) head.appendChild(el('span', 'lvl-badge lvl-badge--now', 'NOW'))
    if (isActual) head.appendChild(el('span', 'lvl-badge lvl-badge--actual', 'PEAK'))
    if (isPredicted) head.appendChild(el('span', 'lvl-badge lvl-badge--predicted', 'PREDICTED'))
    body.appendChild(head)
    if (active) body.appendChild(el('p', 'lvl-row__sym', lvl.symptoms))
    row.appendChild(body)

    ladderEl.appendChild(row)
  }
}
