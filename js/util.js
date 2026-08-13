/* Coffinat — small shared helpers (impure side: DOM, clock, formatting). */
import * as M from '../model.js'
import { HOMEBREW, CUSTOM } from './presets.js'

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
export function uid() {
  return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
export function nowMinutes() {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}
export function nowClock() {
  return M.minutesToClock(nowMinutes())
}

// ── dates as plain 'YYYY-MM-DD' strings, in local time (never round-tripped through UTC) ──
function pad2(n) {
  return String(n).padStart(2, '0')
}
export function ymd(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}
export function parseYmd(key) {
  const parts = String(key).split('-').map(Number)
  return new Date(parts[0], parts[1] - 1, parts[2])
}
export function todayKey() {
  return ymd(new Date())
}
export function addDays(key, delta) {
  const d = parseYmd(key)
  d.setDate(d.getDate() + delta)
  return ymd(d)
}
export function formatLong(key) {
  const d = parseYmd(key)
  return WEEKDAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear()
}

/**
 * Which caffeine-content uncertainty applies to a log/plan entry, DERIVED from its existing fields
 * (no stored schema change → old localStorage data just works): a home brew is least certain, a
 * hand-entered "Custom (mg)" figure most certain, an average preset in between.
 */
export function doseFrac(e) {
  if (e.brew || e.presetId === HOMEBREW) return M.doseUncertaintyFrac('brew')
  if (e.presetId === CUSTOM) return M.doseUncertaintyFrac('manual')
  return M.doseUncertaintyFrac('preset')
}

/**
 * Turn log/plan-shaped entries into model doses {mg, absMin, frac}; drop hidden and invalid ones.
 * `frac` is the dose's content uncertainty, used only by the plausible-range envelope. `offsetMin`
 * shifts the whole day onto another day's midnight-anchored timeline (negative for a prior day),
 * which is how earlier-day caffeine carries over.
 */
export function toDoses(entries, offsetMin = 0) {
  const doses = []
  for (const e of entries) {
    if (e.hidden) continue
    const min = M.parseClockToMinutes(e.time)
    const mg = num(e.mg)
    if (min == null || !(mg > 0)) continue
    doses.push({ mg: mg, absMin: min + offsetMin, frac: doseFrac(e) })
  }
  return doses
}

/**
 * All doses that affect `dateKey`: that day plus the previous `carryDays` days, each shifted onto a
 * timeline anchored at `dateKey`'s midnight. Reads state.days directly so it never creates empty days.
 */
export function dayDoses(state, dateKey, carryDays) {
  let doses = []
  for (let back = carryDays; back >= 0; back--) {
    const key = addDays(dateKey, -back)
    const day = state.days[key]
    if (day && Array.isArray(day.log)) doses = doses.concat(toDoses(day.log, -back * 1440))
  }
  return doses
}
