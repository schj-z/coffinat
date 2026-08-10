'use strict'

// Unit tests for the pure core logic. Run: `node --test`
// These are written to FAIL if the pharmacology or the extraction math is wrong — each asserts an
// observable property (peak location, half-life decay, additivity, degenerate-case finiteness,
// scale), not merely "it returned a number".

const test = require('node:test')
const assert = require('node:assert/strict')

const M = require('./model.js')

const PROFILE = { massKg: 70, halfLifeH: 5 } // 70 kg adult, 5 h half-life
const VD = M.volumeOfDistributionL(70) // 42 L
const KE = M.keFromHalfLife(5) // ln2/5

// ────────────────────────────────────────────────────────────── pharmacokinetics

test('keFromHalfLife: 5 h → ln2/5 ≈ 0.13863 /h', () => {
  assert.ok(Math.abs(M.keFromHalfLife(5) - 0.138629) < 1e-5)
  assert.ok(Number.isNaN(M.keFromHalfLife(0)))
})

test('a dose contributes nothing at or before intake (τ ≤ 0)', () => {
  assert.equal(M.doseConcentrationMgL(100, 0, VD, KE), 0)
  assert.equal(M.doseConcentrationMgL(100, -1, VD, KE), 0)
})

test('absorption is gradual: concentration RISES from ~0 at intake to a peak, then falls', () => {
  const early = M.doseConcentrationMgL(100, 1 / 60, VD, KE) // 1 min in
  const peakish = M.doseConcentrationMgL(100, 0.75, VD, KE) // ~45 min in
  const later = M.doseConcentrationMgL(100, 4, VD, KE) // 4 h in
  assert.ok(early < peakish, 'must climb after intake, not jump')
  assert.ok(later < peakish, 'must fall after the peak')
  assert.ok(early < 0.3, 'barely any caffeine one minute after intake')
})

test('numeric peak matches the analytic t_max = ln(ka/ke)/(ka−ke)', () => {
  const analytic = M.tMaxHours(M.PK.KA_PER_H, KE) // ≈ 0.749 h
  let best = 0
  let bestTau = 0
  for (let tau = 0; tau <= 3; tau += 0.001) {
    const c = M.doseConcentrationMgL(100, tau, VD, KE)
    if (c > best) {
      best = c
      bestTau = tau
    }
  }
  assert.ok(Math.abs(bestTau - analytic) < 0.02, `peak τ≈${bestTau.toFixed(3)} vs analytic ${analytic.toFixed(3)}`)
  assert.ok(analytic > 0.6 && analytic < 0.85, 't_max should be ~45 min at the default half-life')
})

test('late-time decay halves over exactly one elimination half-life', () => {
  // Once absorption is essentially complete, C(t+t½)/C(t) → e^(−ke·t½) = 0.5.
  const c10 = M.doseConcentrationMgL(200, 10, VD, KE)
  const c15 = M.doseConcentrationMgL(200, 15, VD, KE)
  assert.ok(Math.abs(c15 / c10 - 0.5) < 1e-3, `ratio ${(c15 / c10).toFixed(4)} should be ~0.5`)
})

test('C_max scale sanity: 100 mg in a 70 kg adult peaks around 2 mg/L', () => {
  let best = 0
  for (let tau = 0; tau <= 3; tau += 0.005) best = Math.max(best, M.doseConcentrationMgL(100, tau, VD, KE))
  assert.ok(best > 1.8 && best < 2.4, `C_max ≈ ${best.toFixed(2)} mg/L (expected ~2)`)
})

test('doses are additive: total = sum of the individual contributions', () => {
  const doses = [
    { mg: 95, absMin: 8 * 60 },
    { mg: 63, absMin: 13 * 60 },
  ]
  const at = 15 * 60
  const combined = M.concentrationAtMgL(doses, at, PROFILE)
  const a = M.concentrationAtMgL([doses[0]], at, PROFILE)
  const b = M.concentrationAtMgL([doses[1]], at, PROFILE)
  assert.ok(Math.abs(combined - (a + b)) < 1e-9)
})

test('degenerate ka ≈ ke is finite (no NaN) and continuous with the general formula', () => {
  const limit = M.doseConcentrationMgL(100, 1.0, VD, KE, KE) // ka === ke → limit branch
  assert.ok(Number.isFinite(limit) && limit > 0, 'limit branch must be finite and positive')
  const near = M.doseConcentrationMgL(100, 1.0, VD, KE, KE + 1e-7) // just off → general branch
  assert.ok(Math.abs(limit - near) < 1e-3, `limit ${limit} vs near ${near} should agree`)
})

test('no body mass → 0 (no volume of distribution), never NaN/Infinity', () => {
  const c = M.concentrationAtMgL([{ mg: 100, absMin: 0 }], 60, { massKg: 0, halfLifeH: 5 })
  assert.equal(c, 0)
})

test('concentrationSeries length matches the sample points and is all finite', () => {
  const xs = [8 * 60, 9 * 60, 10 * 60]
  const s = M.concentrationSeriesMgL([{ mg: 95, absMin: 8 * 60 }], PROFILE, xs)
  assert.equal(s.length, 3)
  assert.ok(s.every(Number.isFinite))
  assert.equal(s[0], 0) // exactly at intake, τ = 0
})

// ────────────────────────────────────────────────────────────── home-brew extraction

test('French-press sanity: 18 g Arabica, 250 ml, 4 min, 200 ml serving ≈ 200 mg', () => {
  const r = M.brewCaffeine({ method: 'frenchpress', bean: 'arabica', groundsG: 18, waterMl: 250, timeMin: 4, servingMl: 200 })
  assert.ok(r.extractedMg > 200 && r.extractedMg < 240, `extracted ${r.extractedMg.toFixed(0)} mg`)
  assert.ok(Math.abs(r.beverageMl - 214) < 1, `beverage ${r.beverageMl} ml`)
  assert.ok(r.doseMg > 180 && r.doseMg < 225, `dose ${r.doseMg.toFixed(0)} mg`)
})

test('Robusta yields roughly twice the caffeine of Arabica, same brew', () => {
  const base = { method: 'frenchpress', groundsG: 18, waterMl: 250, timeMin: 4, servingMl: 200 }
  const ara = M.brewCaffeine({ ...base, bean: 'arabica' }).extractedMg
  const rob = M.brewCaffeine({ ...base, bean: 'robusta' }).extractedMg
  assert.ok(Math.abs(rob / ara - 24 / 13) < 0.02, `ratio ${(rob / ara).toFixed(2)}`)
})

test('extraction saturates: past ~2 min more time barely changes the yield', () => {
  const base = { method: 'frenchpress', bean: 'arabica', groundsG: 18, waterMl: 250, servingMl: 200 }
  const t2 = M.brewCaffeine({ ...base, timeMin: 2 }).extractedMg
  const t10 = M.brewCaffeine({ ...base, timeMin: 10 }).extractedMg
  assert.ok(t2 / t10 > 0.95, `2 min is ${(100 * t2 / t10).toFixed(1)}% of 10 min`)
})

test('brew guards: zero grounds → zero dose; oversized serving is capped at the beverage', () => {
  assert.equal(M.brewCaffeine({ method: 'frenchpress', bean: 'arabica', groundsG: 0, waterMl: 250, timeMin: 4, servingMl: 200 }).doseMg, 0)
  const r = M.brewCaffeine({ method: 'frenchpress', bean: 'arabica', groundsG: 18, waterMl: 250, timeMin: 4, servingMl: 9999 })
  assert.ok(Math.abs(r.doseMg - r.extractedMg) < 1e-6, 'drinking the whole pot ≈ all extracted caffeine')
})

// ────────────────────────────────────────────────────────────── time helpers

test('clock parsing round-trips and rejects garbage', () => {
  assert.equal(M.parseClockToMinutes('23:00'), 1380)
  assert.equal(M.parseClockToMinutes('07:05'), 425)
  assert.equal(M.parseClockToMinutes('24:00'), null)
  assert.equal(M.parseClockToMinutes('nope'), null)
  assert.equal(M.minutesToClock(1380), '23:00')
  assert.equal(M.minutesToClock(1440 + 90), '01:30')
})

test('clockToWindowAbs places pre-04:00 times into the late hours of the window', () => {
  assert.equal(M.clockToWindowAbs(8 * 60), 8 * 60) // 08:00 stays
  assert.equal(M.clockToWindowAbs(2 * 60), 2 * 60 + 1440) // 02:00 → next early morning
})
