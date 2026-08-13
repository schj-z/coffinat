'use strict'

// Unit tests for the pure core logic. Run: `node --test`
// These verify the mathematical IMPLEMENTATION and lock in the documented modelling assumptions
// (peak location, half-life decay, additivity, degenerate-case finiteness, scale, the uncertainty
// envelope, the toxicity guard). They assert observable properties, not merely "it returned a
// number" — but they do NOT independently validate those assumptions experimentally: the PK
// constants, tolerance factors and brew parameters are averages/heuristics documented in model.js,
// not measurements taken here.

import test from 'node:test'
import assert from 'node:assert/strict'

import * as M from './model.js'

const PROFILE = { massKg: 70, halfLifeH: 5 } // 70 kg adult, 5 h half-life
const VD = M.volumeOfDistributionL(70) // 42 L
const KE = M.keFromHalfLife(5) // ln2/5

// A coarse day timeline (5-min steps, midnight→midnight) for the envelope tests.
const XS_DAY = (function () {
  const xs = []
  for (let m = 0; m <= 1440; m += 5) xs.push(m)
  return xs
})()
const idxAt = (hours) => XS_DAY.indexOf(hours * 60)

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

test('tMaxHours at ka = ke is the finite 1/ke peak (τ·e^(−keτ)), not NaN', () => {
  const ke = M.keFromHalfLife(5)
  assert.ok(Math.abs(M.tMaxHours(ke, ke) - 1 / ke) < 1e-9, 'analytic equal-rate peak is 1/ke')
  // ...and it matches a numeric scan of the equal-rate limit branch.
  let best = 0
  let bestTau = 0
  for (let tau = 0; tau <= 20; tau += 0.001) {
    const c = M.doseConcentrationMgL(100, tau, VD, ke, ke)
    if (c > best) {
      best = c
      bestTau = tau
    }
  }
  assert.ok(Math.abs(bestTau - 1 / ke) < 0.02, `numeric peak ${bestTau.toFixed(3)} vs 1/ke ${(1 / ke).toFixed(3)}`)
  assert.ok(Number.isNaN(M.tMaxHours(0, ke)) && Number.isNaN(M.tMaxHours(ke, 0)), 'invalid rates → NaN')
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

// ────────────────────────────────────────────────────────────── effect levels

test('effectLevel maps concentrations to the right band, including boundaries', () => {
  assert.equal(M.effectLevel(0).key, 'minimal')
  assert.equal(M.effectLevel(0.5).key, 'minimal')
  assert.equal(M.effectLevel(1).key, 'alert') // band is [1, 4)
  assert.equal(M.effectLevel(2).key, 'alert')
  assert.equal(M.effectLevel(5).key, 'wired')
  assert.equal(M.effectLevel(8).key, 'jittery')
  assert.equal(M.effectLevel(20).key, 'toxic')
  assert.equal(M.effectLevel(100).key, 'severe')
})

test('tolerance softens the band a SUB-TOXIC concentration lands in', () => {
  assert.equal(M.effectLevel(8).key, 'jittery') // no tolerance: 8 mg/L is overstimulated
  const strong = M.toleranceFactor('strong') // 2.3 → 8/2.3 ≈ 3.5 mg/L equivalent
  assert.equal(M.effectLevel(8, strong).key, 'alert')
  assert.ok(strong > M.toleranceFactor('none'))
  assert.equal(M.toleranceFactor('nonsense'), 1.0) // unknown key → no tolerance
})

test('SAFETY: tolerance NEVER downgrades a toxic level — habit does not change lethality', () => {
  const strong = M.toleranceFactor('strong') // 2.3
  // 80 mg/L is potentially lethal; softening would put it two bands too low. It must not.
  assert.equal(M.effectLevel(80, strong).key, 'severe')
  // Anything at/above the toxic threshold ignores tolerance entirely.
  assert.equal(M.effectLevel(20, strong).key, 'toxic')
  assert.equal(M.effectLevel(M.TOXIC_THRESHOLD_MGL, strong).key, 'toxic')
  // ...but just below it, softening is still allowed (14 raw = jittery → wired for a strong habit).
  assert.equal(M.effectLevel(14).key, 'jittery')
  assert.equal(M.effectLevel(14, strong).key, 'wired')
})

test('effectLevel is total (never returns undefined) and monotonic in severity', () => {
  const order = M.EFFECT_LEVELS.map((l) => l.key)
  let last = -1
  for (const mgL of [0, 0.9, 3, 7, 14, 39, 500]) {
    const idx = order.indexOf(M.effectLevel(mgL).key)
    assert.ok(idx >= last, 'severity must not decrease as concentration rises')
    last = idx
  }
})

// ────────────────────────────────────────────────────────────── plausible-range envelope

test('envelope brackets the centre estimate and stays finite & non-negative', () => {
  const doses = [
    { mg: 100, absMin: 8 * 60, frac: 0.2 },
    { mg: 80, absMin: 13 * 60, frac: 0.35 },
  ]
  const b = M.concentrationBandSeriesMgL(doses, PROFILE, XS_DAY)
  assert.equal(b.low.length, XS_DAY.length)
  for (let i = 0; i < XS_DAY.length; i++) {
    assert.ok(Number.isFinite(b.low[i]) && Number.isFinite(b.center[i]) && Number.isFinite(b.high[i]))
    assert.ok(b.low[i] >= 0, `low never negative (got ${b.low[i]})`)
    assert.ok(b.low[i] <= b.center[i] + 1e-9, `low ${b.low[i]} ≤ center ${b.center[i]}`)
    assert.ok(b.center[i] <= b.high[i] + 1e-9, `center ${b.center[i]} ≤ high ${b.high[i]}`)
  }
})

test('envelope centre equals the plain concentration series (best estimate is unchanged)', () => {
  const doses = [{ mg: 100, absMin: 8 * 60, frac: 0.2 }]
  const b = M.concentrationBandSeriesMgL(doses, PROFILE, XS_DAY)
  const plain = M.concentrationSeriesMgL(doses, PROFILE, XS_DAY)
  for (let i = 0; i < XS_DAY.length; i++) assert.ok(Math.abs(b.center[i] - plain[i]) < 1e-9)
})

test('no dose / no body mass → a flat zero envelope (no phantom uncertainty)', () => {
  const empty = M.concentrationBandSeriesMgL([], PROFILE, XS_DAY)
  assert.ok(empty.low.every((v) => v === 0) && empty.center.every((v) => v === 0) && empty.high.every((v) => v === 0))
  const noMass = M.concentrationBandSeriesMgL([{ mg: 100, absMin: 0, frac: 0.2 }], { massKg: 0, halfLifeH: 5 }, XS_DAY)
  assert.ok(noMass.high.every((v) => v === 0))
})

test('half-life uncertainty widens the band LATER in the day, relative to the peak', () => {
  const doses = [{ mg: 200, absMin: 0, frac: 0 }] // frac 0 → physiology-only band
  const b = M.concentrationBandSeriesMgL(doses, PROFILE, XS_DAY)
  const peakI = idxAt(0.75) // ~45 min
  const lateI = idxAt(14)
  const relWidth = (i) => (b.high[i] - b.low[i]) / b.center[i]
  assert.ok(b.center[peakI] > 0 && b.center[lateI] > 0)
  assert.ok(relWidth(lateI) > relWidth(peakI), `late width ${relWidth(lateI).toFixed(2)} should exceed peak ${relWidth(peakI).toFixed(2)}`)
})

test('a home-brew dose (large content uncertainty) gives a WIDER band than a typed-in dose', () => {
  const i = idxAt(9) // ~1 h after an 08:00 intake
  const brew = M.concentrationBandSeriesMgL([{ mg: 100, absMin: 8 * 60, frac: M.doseUncertaintyFrac('brew') }], PROFILE, XS_DAY)
  const typed = M.concentrationBandSeriesMgL([{ mg: 100, absMin: 8 * 60, frac: M.doseUncertaintyFrac('manual') }], PROFILE, XS_DAY)
  assert.ok(brew.high[i] - brew.low[i] > typed.high[i] - typed.low[i], 'home-brew band should be wider')
})

test('legacy dose without a frac still works — band contains the centre, width from physiology alone', () => {
  const legacy = [{ mg: 100, absMin: 8 * 60 }] // old saved data: no frac field
  const b = M.concentrationBandSeriesMgL(legacy, PROFILE, XS_DAY)
  const i = idxAt(9)
  assert.ok(b.low[i] <= b.center[i] && b.center[i] <= b.high[i])
  assert.ok(b.high[i] > b.low[i], 'physiology uncertainty still gives a nonzero band')
  assert.ok(b.low.every(Number.isFinite) && b.high.every(Number.isFinite))
})

test('doseUncertaintyFrac orders brew > preset > manual, with a preset default', () => {
  assert.ok(M.doseUncertaintyFrac('brew') > M.doseUncertaintyFrac('preset'))
  assert.ok(M.doseUncertaintyFrac('preset') > M.doseUncertaintyFrac('manual'))
  assert.equal(M.doseUncertaintyFrac('nonsense'), M.doseUncertaintyFrac('preset'))
})

// ────────────────────────────────────────────────────────────── model-validity boundary

test('pkForecastReliable turns off in the toxic range (>= 15 mg/L)', () => {
  assert.equal(M.pkForecastReliable(5), true)
  assert.equal(M.pkForecastReliable(14.9), true)
  assert.equal(M.pkForecastReliable(M.TOXIC_THRESHOLD_MGL), false)
  assert.equal(M.pkForecastReliable(80), false)
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

// Parameter regression (not measured coffee science): locks in the front-loaded HOT-method curve.
test('hot immersion is front-loaded: past ~2 min more time barely changes the yield', () => {
  const base = { method: 'frenchpress', bean: 'arabica', groundsG: 18, waterMl: 250, servingMl: 200 }
  const t2 = M.brewCaffeine({ ...base, timeMin: 2 }).extractedMg
  const t10 = M.brewCaffeine({ ...base, timeMin: 10 }).extractedMg
  assert.ok(t2 / t10 > 0.95, `2 min is ${(100 * t2 / t10).toFixed(1)}% of 10 min`)
})

test('cold brew extracts SLOWLY: 1 h yields far less than 12 h (its long steep must matter)', () => {
  const base = { method: 'coldbrew', bean: 'arabica', groundsG: 60, waterMl: 500, servingMl: 200 }
  const h1 = M.brewCaffeine({ ...base, timeMin: 60 }).extractedMg
  const h12 = M.brewCaffeine({ ...base, timeMin: 720 }).extractedMg
  assert.ok(h1 / h12 < 0.6, `1 h should be well under 12 h; got ${(100 * (h1 / h12)).toFixed(0)}%`)
})

test('espresso uses the cup yield directly (no filter-style retention → no 1 ml "pot")', () => {
  // 18 g / 36 ml double shot: filter retention (2 ml/g) would give 36 − 36 = 0 → clamped to 1 ml.
  const r = M.brewCaffeine({ method: 'espresso', bean: 'arabica', groundsG: 18, waterMl: 36, timeMin: 0.5, servingMl: 36 })
  assert.ok(Math.abs(r.beverageMl - 36) < 1e-9, `beverage ${r.beverageMl} ml should equal the 36 ml yield, not ~1`)
  assert.ok(r.doseMg > 60 && r.doseMg < 200, `double-espresso dose ${r.doseMg.toFixed(0)} mg should be sane`)
})

test('brew estimate carries a ±band around the point dose (rough, not a CI)', () => {
  const r = M.brewCaffeine({ method: 'frenchpress', bean: 'arabica', groundsG: 18, waterMl: 250, timeMin: 4, servingMl: 200 })
  assert.ok(r.doseMgLow < r.doseMg && r.doseMg < r.doseMgHigh, 'the band brackets the point estimate')
  assert.ok(Math.abs(r.doseMgLow - r.doseMg * (1 - M.BREW_UNCERTAINTY_FRAC)) < 1e-9)
  assert.ok(Math.abs(r.doseMgHigh - r.doseMg * (1 + M.BREW_UNCERTAINTY_FRAC)) < 1e-9)
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

test('caffeine from an earlier day carries over (a dose at a negative minute still contributes)', () => {
  // Yesterday 22:00 is −120 min relative to today's midnight; at 07:00 (420) some remains.
  const carried = M.concentrationAtMgL([{ mg: 200, absMin: -120 }], 420, PROFILE)
  assert.ok(carried > 0, 'residual caffeine should carry into the morning')
  // ...but less than the same dose taken fresh this morning at 06:00.
  const fresh = M.concentrationAtMgL([{ mg: 200, absMin: 360 }], 420, PROFILE)
  assert.ok(carried < fresh, 'the older dose has decayed more than a fresh one')
})
