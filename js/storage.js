/* Nutrimat — persistence. State lives in localStorage. The drink LOG is per calendar day; the
   profile, forecast plan and sleep goal are global. Nothing leaves the browser. */
import * as M from '../model.js'
import { todayKey } from './util.js'

export const KEY = 'nutrimat.v2'
const OLD_KEY = 'nutrimat.v1' // single-day layout shipped in the first version

function defaults() {
  return {
    version: 2,
    profile: { massKg: 70, halfLifeH: M.PK.DEFAULT_HALFLIFE_H, tolerance: 'moderate' },
    sleep: { thresholdMgL: 1.5, time: '23:00' },
    plan: { presetId: 'filter', label: 'Filter coffee (240 ml)', mg: 95, time: '20:00', enabled: false, brew: null },
    days: {}, // 'YYYY-MM-DD' -> { log: [ entries ] }
    selectedDate: todayKey(),
  }
}

/** Fold the old single-log v1 blob into today's day so nothing is lost on upgrade. */
function migrateV1(old) {
  const d = defaults()
  if (old.profile) Object.assign(d.profile, old.profile)
  if (old.plan) Object.assign(d.plan, old.plan)
  if (old.sleep) Object.assign(d.sleep, old.sleep)
  if (Array.isArray(old.log) && old.log.length) d.days[d.selectedDate] = { log: old.log }
  return d
}

function coerce(parsed) {
  const d = defaults()
  return {
    version: 2,
    profile: Object.assign(d.profile, parsed.profile),
    sleep: Object.assign(d.sleep, parsed.sleep),
    plan: Object.assign(d.plan, parsed.plan),
    days: parsed.days && typeof parsed.days === 'object' ? parsed.days : {},
    selectedDate: parsed.selectedDate || d.selectedDate,
  }
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return coerce(JSON.parse(raw))
    const oldRaw = localStorage.getItem(OLD_KEY)
    if (oldRaw) {
      const migrated = migrateV1(JSON.parse(oldRaw))
      save(migrated) // write forward under the new key; leave v1 in place as a backup
      return migrated
    }
    return defaults()
  } catch (err) {
    // A corrupt value must not brick the app.
    console.warn('Nutrimat: could not read saved state, starting fresh.', err)
    return defaults()
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch (err) {
    console.warn('Nutrimat: could not save state.', err)
  }
}

export function getDay(state, key) {
  if (!state.days[key]) state.days[key] = { log: [] }
  if (!Array.isArray(state.days[key].log)) state.days[key].log = []
  return state.days[key]
}

export function hasData(state, key) {
  const day = state.days[key]
  return !!(day && Array.isArray(day.log) && day.log.length > 0)
}

/** Drop empty day objects so the calendar dots and storage stay honest. */
export function pruneEmpty(state) {
  for (const key of Object.keys(state.days)) {
    const day = state.days[key]
    if (!day || !Array.isArray(day.log) || day.log.length === 0) delete state.days[key]
  }
}
