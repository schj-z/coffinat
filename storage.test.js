'use strict'

// Unit tests for the CSV export / import / reset logic in js/storage.js. Pure data transforms —
// no DOM, no real localStorage (clearAll's storage removal is best-effort and swallowed here).
// Run: `node --test`

import test from 'node:test'
import assert from 'node:assert/strict'

import * as storage from './js/storage.js'

let idc = 0
const uid = () => 'x' + idc++

function sampleState() {
  return {
    version: 2,
    profile: { massKg: 80, halfLifeH: 6, tolerance: 'strong' },
    sleep: { thresholdMgL: 2, time: '22:30' },
    plan: { presetId: 'filter', label: 'Filter', mg: 95, time: '20:00', enabled: true, brew: null },
    days: {
      '2026-08-10': {
        log: [
          { id: 'a', presetId: 'filter', label: 'Filter coffee (240 ml)', mg: 95, time: '08:00', hidden: false, brew: null },
          { id: 'b', presetId: 'custom', label: 'Custom', mg: 200, time: '13:00', hidden: true, brew: null },
        ],
      },
      '2026-08-11': {
        log: [
          { id: 'c', presetId: 'homebrew', label: 'French press', mg: 180, time: '07:30', hidden: false, brew: { method: 'frenchpress', bean: 'arabica', groundsG: 18, waterMl: 250, timeMin: 4, servingMl: 200 } },
        ],
      },
    },
    selectedDate: '2026-08-11',
  }
}

const flat = (s) =>
  Object.keys(s.days)
    .sort()
    .flatMap((d) => s.days[d].log.map((e) => ({ d, time: e.time, mg: e.mg, hidden: e.hidden, presetId: e.presetId, method: e.brew && e.brew.method })))

test('exportCsv → importCsv round-trips the whole drink log', () => {
  const src = sampleState()
  const csv = storage.exportCsv(src)
  const dst = { days: {} }
  const res = storage.importCsv(dst, csv, { mode: 'replace', uid })
  assert.equal(res.added, 3)
  assert.equal(res.skipped, 0)
  assert.equal(res.dates, 2)
  assert.deepEqual(flat(dst), flat(src))
  // brew details survive
  assert.deepEqual(dst.days['2026-08-11'].log[0].brew, src.days['2026-08-11'].log[0].brew)
})

test('exportCsv escapes commas/quotes in custom names and importCsv restores them', () => {
  const s = { days: { '2026-01-01': { log: [{ presetId: 'custom', label: 'Weird, "name"', mg: 50, time: '09:00', hidden: false, brew: null }] } } }
  const csv = storage.exportCsv(s)
  assert.match(csv, /"Weird, ""name"""/)
  const dst = { days: {} }
  storage.importCsv(dst, csv, { mode: 'replace', uid })
  assert.equal(dst.days['2026-01-01'].log[0].label, 'Weird, "name"')
})

test('importCsv merge appends, replace wipes first', () => {
  const csv = 'date,time,product,caffeine_mg,hidden,preset_id\n2026-08-10,09:00,Filter,95,false,filter\n'
  const base = () => ({ days: { '2026-08-10': { log: [{ id: 'z', presetId: 'filter', label: 'x', mg: 10, time: '06:00', hidden: false, brew: null }] } } })

  const merged = base()
  storage.importCsv(merged, csv, { mode: 'merge', uid })
  assert.equal(merged.days['2026-08-10'].log.length, 2)

  const replaced = base()
  storage.importCsv(replaced, csv, { mode: 'replace', uid })
  assert.equal(replaced.days['2026-08-10'].log.length, 1)
})

test('importCsv skips malformed rows, reports them, and never throws', () => {
  const csv = ['date,time,product,caffeine_mg', '2026-08-10,08:00,Coffee,95', 'not-a-date,08:00,Coffee,95', '2026-08-10,99:99,Coffee,95', '2026-08-10,08:00,Coffee,-5', '2026-08-10,08:00,Coffee,abc'].join('\n')
  const dst = { days: {} }
  const res = storage.importCsv(dst, csv, { mode: 'replace', uid })
  assert.equal(res.added, 1)
  assert.equal(res.skipped, 4)
  assert.equal(res.errors.length, 4)
})

test('importCsv rejects a file missing required columns', () => {
  const res = storage.importCsv({ days: {} }, 'foo,bar\n1,2\n', { mode: 'replace', uid })
  assert.equal(res.added, 0)
  assert.ok(res.errors.length >= 1)
})

test('importCsv tolerates reordered/extra columns (maps by header name)', () => {
  const csv = 'caffeine_mg,extra,time,date\n120,junk,10:15,2026-08-10\n'
  const dst = { days: {} }
  const res = storage.importCsv(dst, csv, { mode: 'replace', uid })
  assert.equal(res.added, 1)
  const e = dst.days['2026-08-10'].log[0]
  assert.equal(e.mg, 120)
  assert.equal(e.time, '10:15')
})

test('clearAll resets state in place to defaults', () => {
  const s = sampleState()
  storage.clearAll(s)
  assert.deepEqual(s.days, {})
  assert.equal(s.profile.massKg, 70)
  assert.equal(s.profile.halfLifeH, 5)
  assert.equal(s.profile.tolerance, 'moderate')
  assert.equal(s.plan.enabled, false)
  assert.equal(s.sleep.thresholdMgL, 1.5)
})
