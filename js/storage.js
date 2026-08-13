/* Coffinat — persistence. State lives in localStorage. The drink LOG is per calendar day; the
   profile, forecast plan and sleep goal are global. Nothing leaves the browser. */
import * as M from '../model.js'
import { todayKey, num } from './util.js'

export const KEY = 'coffinat.v2'
// Pre-rename keys, read once so a user's existing saved data survives the rename.
const LEGACY_V2 = 'nutrimat.v2' // same structure, previous name
const LEGACY_V1 = 'nutrimat.v1' // original single-day layout

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
    // Adopt data saved under the previous name, newest layout first. Left in place as a backup.
    const legacyV2 = localStorage.getItem(LEGACY_V2)
    if (legacyV2) {
      const s = coerce(JSON.parse(legacyV2))
      save(s)
      return s
    }
    const legacyV1 = localStorage.getItem(LEGACY_V1)
    if (legacyV1) {
      const migrated = migrateV1(JSON.parse(legacyV1))
      save(migrated)
      return migrated
    }
    return defaults()
  } catch (err) {
    // A corrupt value must not brick the app.
    console.warn('Coffinat: could not read saved state, starting fresh.', err)
    return defaults()
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch (err) {
    console.warn('Coffinat: could not save state.', err)
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

// ─────────────────────────────────────────────────────────── CSV export / import / reset
//
// The drink log (every day's drinks) is the bulk of "your data"; it exports to a plain, spreadsheet-
// friendly CSV. Profile / sleep goal / plan are single settings, not rows, so they are not part of the
// CSV (a reset restores them to defaults). These functions are pure data transforms (no DOM); the file
// download and picker live in js/data.js.

const CSV_COLUMNS = ['date', 'time', 'product', 'caffeine_mg', 'hidden', 'preset_id', 'brew_method', 'brew_bean', 'grounds_g', 'water_ml', 'brew_time_min', 'serving_ml']

function csvField(v) {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/** All logged drinks across all days as a CSV string (one row per drink, dates sorted). */
export function exportCsv(state) {
  const lines = [CSV_COLUMNS.join(',')]
  const days = (state && state.days) || {}
  for (const date of Object.keys(days).sort()) {
    const day = days[date]
    if (!day || !Array.isArray(day.log)) continue
    for (const e of day.log) {
      const b = e.brew || {}
      lines.push(
        [
          date, e.time || '', e.label || '', Math.round(num(e.mg)), e.hidden ? 'true' : 'false',
          e.presetId || '', b.method || '', b.bean || '',
          b.groundsG != null ? b.groundsG : '', b.waterMl != null ? b.waterMl : '',
          b.timeMin != null ? b.timeMin : '', b.servingMl != null ? b.servingMl : '',
        ]
          .map(csvField)
          .join(','),
      )
    }
  }
  return lines.join('\n') + '\n'
}

/** Split CSV text into rows of string fields (handles quoted fields, "" escapes, CRLF). */
function parseCsvRows(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  const s = String(text).replace(/\r\n?/g, '\n')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

function toNum(v, dflt) {
  const n = Number(String(v == null ? '' : v).trim())
  return Number.isFinite(n) ? n : dflt
}

/**
 * Import drinks from CSV text INTO `state` (mutated in place). `opts.mode` is 'merge' (append to what's
 * there, default) or 'replace' (wipe the whole log first). `opts.uid` supplies fresh entry ids. Bad
 * rows are skipped and reported, never thrown — the app must survive a malformed file.
 * Returns { added, skipped, dates, errors }.
 */
export function importCsv(state, text, opts) {
  opts = opts || {}
  const mode = opts.mode === 'replace' ? 'replace' : 'merge'
  let uidN = 0
  const uid = typeof opts.uid === 'function' ? opts.uid : () => 'imp-' + uidN++
  const rows = parseCsvRows(text)
  const errors = []
  if (!rows.length) return { added: 0, skipped: 0, dates: 0, errors: ['The file is empty.'] }

  const header = rows[0].map((h) => h.trim().toLowerCase())
  const col = (name) => header.indexOf(name)
  const ci = {
    date: col('date'), time: col('time'), product: col('product'), mg: col('caffeine_mg'), hidden: col('hidden'),
    preset: col('preset_id'), method: col('brew_method'), bean: col('brew_bean'),
    grounds: col('grounds_g'), water: col('water_ml'), btime: col('brew_time_min'), serving: col('serving_ml'),
  }
  if (ci.date < 0 || ci.time < 0 || ci.mg < 0) {
    return { added: 0, skipped: 0, dates: 0, errors: ['Missing required columns (need at least date, time, caffeine_mg).'] }
  }

  const parsed = {}
  let added = 0
  let skipped = 0
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (row.length === 1 && row[0].trim() === '') continue // blank line
    const cell = (i) => (i >= 0 && row[i] != null ? String(row[i]).trim() : '')
    const date = cell(ci.date)
    const time = cell(ci.time)
    const mg = Number(cell(ci.mg))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { errors.push('Row ' + (r + 1) + ': invalid date "' + date + '"'); skipped++; continue }
    if (M.parseClockToMinutes(time) == null) { errors.push('Row ' + (r + 1) + ': invalid time "' + time + '"'); skipped++; continue }
    if (!Number.isFinite(mg) || mg < 0) { errors.push('Row ' + (r + 1) + ': invalid caffeine_mg'); skipped++; continue }

    const presetId = cell(ci.preset)
    const method = cell(ci.method)
    const entry = {
      id: uid(),
      presetId: presetId || 'custom',
      label: cell(ci.product) || 'Custom',
      mg: mg,
      time: time,
      hidden: /^(true|1|yes)$/i.test(cell(ci.hidden)),
      brew: null,
    }
    if (method) {
      entry.presetId = 'homebrew'
      entry.brew = {
        method: method,
        bean: cell(ci.bean) || 'blend',
        groundsG: toNum(cell(ci.grounds), 0),
        waterMl: toNum(cell(ci.water), 0),
        timeMin: toNum(cell(ci.btime), 0),
        servingMl: toNum(cell(ci.serving), 0),
      }
    }
    if (!parsed[date]) parsed[date] = []
    parsed[date].push(entry)
    added++
  }

  if (mode === 'replace') state.days = {}
  for (const date of Object.keys(parsed)) {
    if (!state.days[date] || !Array.isArray(state.days[date].log)) state.days[date] = { log: [] }
    state.days[date].log = state.days[date].log.concat(parsed[date])
  }
  return { added: added, skipped: skipped, dates: Object.keys(parsed).length, errors: errors }
}

/** Wipe everything: reset `state` in place to defaults and remove all persisted keys. */
export function clearAll(state) {
  const d = defaults()
  state.version = d.version
  state.profile = d.profile
  state.sleep = d.sleep
  state.plan = d.plan
  state.days = {}
  state.selectedDate = d.selectedDate
  try {
    localStorage.removeItem(KEY)
    localStorage.removeItem(LEGACY_V2)
    localStorage.removeItem(LEGACY_V1)
  } catch (err) {
    /* nothing persisted / storage unavailable — the in-memory reset above is what matters */
  }
  return state
}
