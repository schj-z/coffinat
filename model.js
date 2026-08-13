/*
 * Coffinat — core logic (PURE). No DOM, no localStorage, no clock (Date.now()).
 * Numbers in, numbers out. This is the whole "business logic", kept here so it can be
 * unit-tested (model.test.js, `node --test`) and reasoned about in one place.
 *
 * ── Pharmacokinetics ──────────────────────────────────────────────────────────────────────
 * One-compartment oral model with first-order absorption and elimination — the Bateman function,
 * the exact analytic solution of  gut --ka--> central --ke--> out.  For a single dose D (mg) taken
 * at t0, with τ = t − t0 (hours, τ ≥ 0):
 *
 *     C(τ) = F·D·ka / (Vd·(ka − ke)) · ( e^(−ke·τ) − e^(−ka·τ) )        ka ≠ ke
 *     C(τ) = F·D·ke / Vd · τ · e^(−ke·τ)                                ka = ke   (the limit)
 *
 * The `−e^(−ka·τ)` term is what makes absorption GRADUAL: C starts at 0 at intake and climbs to a
 * peak at t_max = ln(ka/ke)/(ka−ke) (~45 min at the default half-life) before elimination wins.
 * Total concentration = Σ C over all doses. Output is total plasma concentration in mg/L (= µg/mL).
 *
 * Constants (population averages — cited; individual metabolism varies widely):
 *   F  = 1.0        ~99–100% oral bioavailability, ~99% absorbed within 45 min, no first-pass.
 *   Vd = 0.6 L/kg   representative adult; literature reports ~0.5–0.8, often ~0.6–0.7. 0.6 sits at
 *                   the lower end, so it does not understate concentration. Scaled by mass → mg/L scale.
 *   ke = ln2/t½     t½ default 5 h (healthy-adult range ~2–8 h); dominant driver of the decline.
 *   ka = 4.9 /h     a CALIBRATED effective absorption constant (not a measured physiological rate):
 *                   chosen so t_max ≈ 45 min at t½ = 5 h (stays 39–50 min over the 3–8 h range),
 *                   compensating for gastric-emptying/formulation effects the 1-compartment model
 *                   omits. NOT the sometimes-cited 0.33/min ≈ 19.8/h, which would misplace the peak
 *                   at ~15 min against an observed t_max of 30–60 min.
 * Sources: StatPearls "Caffeine" (NBK519490); Alsabri et al., J. Caffeine Res. 2018; EFSA caffeine
 * PK dossier; Pharmacology of Caffeine (NCBI NBK223808).
 *
 * ── Home-brew extraction ──────────────────────────────────────────────────────────────────
 *   extracted(mg) = grounds(g) · poolPerGram(mg/g) · efficiency
 *   efficiency    = E_max(method) · (1 − e^(−k·t))          k is PER-METHOD (fast for hot immersion/
 *                                                           drip, seconds for espresso, very slow for
 *                                                           cold brew — otherwise a 12 h steep would
 *                                                           look identical to a 2 min one)
 *   beverage(ml)  = water(ml) − retention·grounds           retention ≈2 ml/g for filter/immersion;
 *                                                           0 for espresso (enter the cup yield, not
 *                                                           the boiler water — filter retention does
 *                                                           not transfer to a pressurised puck)
 *   dose(mg)      = extracted / beverage · serving(ml)
 * Pools: Arabica ≈ 12–15 mg/g (1.2–1.5% by wt), Robusta ≈ 22–27 mg/g (2.2–2.7%). E_max: immersion
 * ≈0.95, drip/pour-over ≈0.85, espresso ≈0.80. Hot water assumed near-optimal (~93–96 °C); cold brew
 * uses a much slower k instead. These are REPRESENTATIVE values calibrated to typical brewed-coffee
 * ranges, and the extraction-over-time curve is a modelling choice — NOT laboratory measurements, so
 * the app surfaces a rough ±band (BREW_UNCERTAINTY_FRAC). Real yields vary with grind, dose,
 * agitation, temperature, pressure and contact time.
 * Sources (practical brewing references, not analytical studies): Simon & Bearns roasters (Arabica
 * vs Robusta & by method); Dabov (brew method vs caffeine); Equipoise (French-press caffeine).
 *
 * ── Uncertainty & validity ─────────────────────────────────────────────────────────────────
 * concentrationBandSeriesMgL returns a plausible-range ENVELOPE {center, low, high} — a deterministic
 * scenario band (NOT a probability/CI) from plausible spreads in Vd, half-life, absorption and dose
 * content (PK_UNCERTAINTY, DOSE_UNCERTAINTY). The half-life spread makes it widen over the day.
 * pkForecastReliable(mgL) is false in the toxic range (≥ TOXIC_THRESHOLD_MGL): there the linear
 * constant-half-life model breaks down (saturable kinetics, lengthening half-life), so the UI warns
 * and withholds recovery-time claims rather than showing false precision. No overdose model is attempted.
 *
 * This is an ES module: imported by the browser (js/*.js via <script type="module">) and by the
 * Node test runner (model.test.js).
 */

// ──────────────────────────────────────────────────────────── pharmacokinetics

export const PK = {
  F: 1.0, // bioavailability (dimensionless)
  VD_PER_KG: 0.6, // L/kg
  KA_PER_H: 4.9, // absorption rate constant, /h
  DEFAULT_HALFLIFE_H: 5,
}

export const DAILY_LIMIT_MG = 400 // EFSA: habitual adult intake up to 400 mg/day is not a safety concern
export const SINGLE_DOSE_CAUTION_MG = 200 // EFSA: single doses up to 200 mg raise no concern

/** Elimination rate constant (/h) from an elimination half-life in hours. */
export function keFromHalfLife(halfLifeH) {
  if (!(halfLifeH > 0)) return NaN
  return Math.LN2 / halfLifeH
}

/** Time of peak concentration (hours after intake). */
export function tMaxHours(kaPerH, keH) {
  if (!(kaPerH > 0) || !(keH > 0)) return NaN
  // At ka = ke the concentration is ∝ τ·e^(−ke·τ), whose maximum is at τ = 1/ke — a finite peak,
  // not undefined. (The general formula is a 0/0 limit here.)
  if (Math.abs(kaPerH - keH) < 1e-9) return 1 / keH
  return Math.log(kaPerH / keH) / (kaPerH - keH)
}

/**
 * Plasma concentration (mg/L) contributed by ONE dose, τ hours after it was taken.
 * Returns 0 for τ ≤ 0 (a dose contributes nothing before it is taken) or nonsensical inputs.
 * The ka ≈ ke branch is the mathematical limit and avoids a divide-by-zero.
 */
export function doseConcentrationMgL(doseMg, tauH, vdL, keH, kaPerH) {
  if (kaPerH === undefined) kaPerH = PK.KA_PER_H
  if (!(doseMg > 0) || !(tauH > 0) || !(vdL > 0) || !(keH > 0) || !(kaPerH > 0)) return 0
  const decayElim = Math.exp(-keH * tauH)
  if (Math.abs(kaPerH - keH) < 1e-6) {
    return ((PK.F * doseMg * keH) / vdL) * tauH * decayElim
  }
  const decayAbs = Math.exp(-kaPerH * tauH)
  return ((PK.F * doseMg * kaPerH) / (vdL * (kaPerH - keH))) * (decayElim - decayAbs)
}

/** Volume of distribution (L) for a body mass in kg. */
export function volumeOfDistributionL(massKg) {
  return PK.VD_PER_KG * massKg
}

/**
 * Total concentration (mg/L) at absolute time `xMin` (minutes) from a set of doses.
 * doses: [{ mg, absMin }]. profile: { massKg, halfLifeH }.
 */
export function concentrationAtMgL(doses, xMin, profile) {
  const vdL = volumeOfDistributionL(profile.massKg)
  const keH = keFromHalfLife(profile.halfLifeH)
  if (!(vdL > 0) || !(keH > 0)) return 0
  let total = 0
  for (const d of doses) {
    const tauH = (xMin - d.absMin) / 60
    if (tauH > 0) total += doseConcentrationMgL(d.mg, tauH, vdL, keH)
  }
  return total
}

/** Concentration series (mg/L) over an array of absolute-minute sample points. */
export function concentrationSeriesMgL(doses, profile, xsMin) {
  const vdL = volumeOfDistributionL(profile.massKg)
  const keH = keFromHalfLife(profile.halfLifeH)
  if (!(vdL > 0) || !(keH > 0)) return xsMin.map(() => 0)
  return xsMin.map((xMin) => {
    let total = 0
    for (const d of doses) {
      const tauH = (xMin - d.absMin) / 60
      if (tauH > 0) total += doseConcentrationMgL(d.mg, tauH, vdL, keH)
    }
    return total
  })
}

// ──────────────────────────────────────────────────────────── plausible-range envelope

// Inter-individual PK spread used to draw the plausible-range ENVELOPE. This is a deterministic
// SCENARIO band, NOT a probability distribution or a confidence interval. Vd and ka use the low/high
// ends of the population ranges in the literature; the half-life band is a deliberately CONSERVATIVE
// ±30 % around whatever half-life the user selected. Because elimination compounds over time, the
// half-life spread is what makes the band widen through the day — the honest signal that a forecast
// 8 h out is far less certain than one 1 h out.
export const PK_UNCERTAINTY = {
  vdLoPerKg: 0.5, // L/kg — raises concentration (population ~0.5–0.8, centre 0.6)
  vdHiPerKg: 0.7, // L/kg — lowers concentration
  halfLifeFracLo: 0.7, // × selected t½ → faster elimination (lower tail)
  halfLifeFracHi: 1.3, // × selected t½ → slower elimination (higher tail)
  kaLoPerH: 3.4, // absorption spread around 4.9/h (~±30 %): later, lower peak
  kaHiPerH: 6.4, // earlier, higher peak
}

// Dose selectors — a dose may carry `frac`, its caffeine-CONTENT uncertainty (0 = exactly known).
function mgCenter(d) {
  return d.mg > 0 ? d.mg : 0
}
function mgHigh(d) {
  return mgCenter(d) * (1 + (d.frac > 0 ? d.frac : 0))
}
function mgLow(d) {
  return mgCenter(d) * (1 - (d.frac > 0 ? d.frac : 0))
}

function scenarioSeries(doses, xsMin, vdL, keH, kaPerH, mgOf) {
  return xsMin.map((xMin) => {
    let total = 0
    for (const d of doses) {
      const tauH = (xMin - d.absMin) / 60
      if (tauH > 0) total += doseConcentrationMgL(mgOf(d), tauH, vdL, keH, kaPerH)
    }
    return total
  })
}

/**
 * Plausible-range envelope for the concentration curve: { center, low, high } arrays over xsMin.
 *
 * `center` is the best estimate (identical to concentrationSeriesMgL). `high`/`low` are the pointwise
 * max/min over a small set of parameter scenarios that vary volume of distribution, elimination
 * half-life and absorption timing (PK_UNCERTAINTY), combined with each dose's own content uncertainty
 * (`dose.frac`). Taking the max/min AT EACH TIME POINT — rather than one fixed "high person" and one
 * "low person" — lets the band widen over the day as plausible half-lives diverge, and near the peak
 * as absorption timing varies. By construction the band always contains `center` (the centre scenario
 * is included in both sets, and content-high ≥ centre ≥ content-low). Deterministic; no simulation.
 */
export function concentrationBandSeriesMgL(doses, profile, xsMin) {
  const massKg = profile.massKg
  const H = profile.halfLifeH
  const vd0 = volumeOfDistributionL(massKg)
  const ke0 = keFromHalfLife(H)
  const zeros = () => xsMin.map(() => 0)
  const center = scenarioSeries(doses, xsMin, vd0, ke0, PK.KA_PER_H, mgCenter)
  if (!(vd0 > 0) || !(ke0 > 0)) return { center: zeros(), low: zeros(), high: zeros() }

  const u = PK_UNCERTAINTY
  const vdLo = u.vdLoPerKg * massKg
  const vdHi = u.vdHiPerKg * massKg
  const keSlow = keFromHalfLife(H * u.halfLifeFracHi) // long t½ → small ke → high tail
  const keFast = keFromHalfLife(H * u.halfLifeFracLo) // short t½ → large ke → low tail

  // Upper edge: high scale (low Vd) + fast absorption, with both fast- and slow-elimination scenarios
  // so the max bounds the peak AND the tail; plus the centre scenario at content-high so the band is
  // guaranteed to enclose the centre. Lower edge mirrors it.
  const highSeries = [
    scenarioSeries(doses, xsMin, vdLo, keSlow, u.kaHiPerH, mgHigh),
    scenarioSeries(doses, xsMin, vdLo, keFast, u.kaHiPerH, mgHigh),
    scenarioSeries(doses, xsMin, vd0, ke0, PK.KA_PER_H, mgHigh),
  ]
  const lowSeries = [
    scenarioSeries(doses, xsMin, vdHi, keFast, u.kaLoPerH, mgLow),
    scenarioSeries(doses, xsMin, vdHi, keSlow, u.kaLoPerH, mgLow),
    scenarioSeries(doses, xsMin, vd0, ke0, PK.KA_PER_H, mgLow),
  ]
  const high = xsMin.map((_, i) => Math.max(highSeries[0][i], highSeries[1][i], highSeries[2][i]))
  const low = xsMin.map((_, i) => Math.min(lowSeries[0][i], lowSeries[1][i], lowSeries[2][i]))
  return { center, low, high }
}

// ──────────────────────────────────────────────────────────── effect levels (traffic light)

// Approximate associations between total plasma caffeine concentration and effects — a "DEFCON"
// escalation, NOT a clinical scale. Population-level and heavily tolerance-dependent (habitual
// users feel far less). The lower bands are ILLUSTRATIVE — subjective effects map poorly onto serum
// levels, so treat Settled/Alert/Energised/Overstimulated as a rough narrative, not a clinical scale.
// Only the high end is anchored to toxicology: toxicity (CNS/cardiac stimulation, seizures,
// arrhythmia) from ≈15 mg/L; ≈80–100 mg/L potentially lethal.
// Sources: Caffeine Toxicity, StatPearls (NBK532910); Pharmacology of Caffeine (NCBI NBK223808).
export const EFFECT_LEVELS = [
  { key: 'minimal', max: 1, label: 'Settled', symptoms: 'Little noticeable stimulation.' },
  { key: 'alert', max: 4, label: 'Alert', symptoms: 'A pleasant lift — sharper alertness, focus and mood.' },
  { key: 'wired', max: 8, label: 'Energised', symptoms: 'Strong stimulation. A faster heartbeat and some restlessness are common, and sleep suffers if this is near bedtime.' },
  { key: 'jittery', max: 15, label: 'Overstimulated', symptoms: 'Wired and edgy — anxiety, tremor, palpitations and stomach upset become likely.' },
  { key: 'toxic', max: 40, label: 'Excessive', symptoms: 'Into the toxicity range: marked anxiety, a racing or irregular heartbeat, nausea. Well beyond normal intake.' },
  { key: 'severe', max: Infinity, label: 'Hazardous', symptoms: 'Severe toxicity risk — arrhythmia and seizures; around 80 mg/L can be lethal. Seek medical help.' },
]

// At or above this concentration the effect is treated as physiological TOXICITY — a property of the
// blood level itself, not of habit. Tolerance must never soften it (see effectLevel). Matches the top
// of the 'jittery' band: ≈15 mg/L is where the toxicology literature puts the onset of concern.
export const TOXIC_THRESHOLD_MGL = 15

// A subjective tolerance from habitual intake. HEURISTIC, not measured: real tolerance is
// effect-specific (you may habituate to the cardiovascular response yet still lose sleep) and
// time-dependent, so these factors are a coarse "feels-like" dial, not biological constants. Tolerance
// changes only how strongly a sub-toxic concentration is FELT — never the pharmacokinetics, and never
// the toxicity bands.
export const TOLERANCE_LEVELS = [
  { key: 'none', label: 'None — I rarely have caffeine', factor: 1.0 },
  { key: 'little', label: 'Light — a cup now and then', factor: 1.3 },
  { key: 'moderate', label: 'Moderate — a few a day', factor: 1.7 },
  { key: 'strong', label: 'Strong — a heavy daily habit', factor: 2.3 },
]

/** Multiplier for the effect thresholds from a tolerance key (defaults to 1 = no tolerance). */
export function toleranceFactor(key) {
  const t = TOLERANCE_LEVELS.find((x) => x.key === key)
  return t ? t.factor : 1.0
}

/**
 * The effect band a concentration (mg/L) falls in.
 *
 * Tolerance softens only the SUBJECTIVE bands: a habitual user feels a given sub-toxic level less, so
 * we divide by `factor` before classifying. It must NOT touch toxicity — a potentially lethal blood
 * level is lethal regardless of habit — so at or above TOXIC_THRESHOLD_MGL the raw concentration
 * governs and `factor` is ignored. (Without this guard a "strong"-tolerance user at 80 mg/L, a
 * potentially lethal level, would be scaled to 80/2.3 ≈ 35 mg/L and mislabelled two bands too low.)
 */
export function effectLevel(mgL, factor) {
  const c = mgL > 0 ? mgL : 0
  const f = c >= TOXIC_THRESHOLD_MGL || !(factor > 0) ? 1 : factor
  const v = c / f
  for (const lvl of EFFECT_LEVELS) if (v < lvl.max) return lvl
  return EFFECT_LEVELS[EFFECT_LEVELS.length - 1]
}

/**
 * Whether the ordinary linear, constant-half-life PK forecast can be trusted at concentration `mgL`.
 * Above the toxic threshold caffeine kinetics can become saturable/nonlinear and the half-life can
 * lengthen substantially, so this model may UNDER-estimate how long levels stay high. Returns false
 * there — the UI then warns about the model boundary and suppresses precise recovery-time claims,
 * rather than showing false precision. (Coffinat deliberately does NOT try to model overdose kinetics.)
 */
export function pkForecastReliable(mgL) {
  return !(mgL >= TOXIC_THRESHOLD_MGL)
}

// ──────────────────────────────────────────────────────────── home-brew extraction

export const BEAN_POOL_MG_PER_G = { arabica: 13, robusta: 24, blend: 16 }

// kPerMin: how fast extraction approaches E_max (a modelling rate, not measured). Hot immersion/drip
// are front-loaded (~95% in ~2 min); espresso is faster still under pressure; cold brew is far slower,
// so its 12 h steep is meaningfully different from a short one. retentionMlPerG: water held back by the
// bed — ~2 ml/g for filter/immersion, but 0 for espresso, where you enter the cup yield directly (the
// filter-retention rule does not transfer to a pressurised puck and would otherwise drive volume to 0).
export const BREW_METHODS = {
  frenchpress: { label: 'French press', emax: 0.95, defaultTimeMin: 4, kPerMin: 1.5, retentionMlPerG: 2 },
  pourover: { label: 'Pour-over', emax: 0.85, defaultTimeMin: 3, kPerMin: 1.5, retentionMlPerG: 2 },
  drip: { label: 'Drip machine', emax: 0.85, defaultTimeMin: 5, kPerMin: 1.5, retentionMlPerG: 2 },
  espresso: { label: 'Espresso', emax: 0.8, defaultTimeMin: 0.5, kPerMin: 5, retentionMlPerG: 0 },
  moka: { label: 'Moka pot', emax: 0.85, defaultTimeMin: 1.5, kPerMin: 2, retentionMlPerG: 2 },
  coldbrew: { label: 'Cold brew', emax: 0.85, defaultTimeMin: 720, kPerMin: 0.006, retentionMlPerG: 2 },
}

export const EXTRACTION_K_PER_MIN = 1.5 // fallback rate (hot immersion/drip); methods override via kPerMin
export const GROUNDS_RETENTION_ML_PER_G = 2 // default water soaked up by spent grounds (ml per g)

// Brew estimates carry large real-world uncertainty (grind, dose, agitation, temperature, pressure,
// contact time), so the app shows a rough ±band rather than a falsely precise single figure. Heuristic.
export const BREW_UNCERTAINTY_FRAC = 0.35

// How well we know a dose's caffeine content depends on where the number came from — a heuristic ±
// fraction (NOT a probability), fed into the plausible-range envelope as `dose.frac`. A hand-typed mg
// is fairly firm; an "average product" preset varies by brand/size; a home brew is least certain (it
// reuses the brew band above). Presets share one figure — a rough average, not a claim that every
// product varies equally.
export const DOSE_UNCERTAINTY = {
  manual: 0.1, // user typed a specific mg
  preset: 0.2, // average commercial product
  brew: BREW_UNCERTAINTY_FRAC, // home-brew estimate
}

/** Content-uncertainty fraction for a dose source ('manual' | 'preset' | 'brew'); default = preset. */
export function doseUncertaintyFrac(source) {
  return DOSE_UNCERTAINTY[source] != null ? DOSE_UNCERTAINTY[source] : DOSE_UNCERTAINTY.preset
}

/**
 * Caffeine produced by a home brew and the dose in one serving.
 * Returns { extractedMg, beverageMl, concentrationMgPerMl, doseMg, doseMgLow, doseMgHigh, efficiency }.
 * doseMgLow/doseMgHigh bracket doseMg by ±BREW_UNCERTAINTY_FRAC — a rough band, not a confidence interval.
 */
export function brewCaffeine(input) {
  const method = BREW_METHODS[input.method] || BREW_METHODS.frenchpress
  const pool = BEAN_POOL_MG_PER_G[input.bean] != null ? BEAN_POOL_MG_PER_G[input.bean] : BEAN_POOL_MG_PER_G.blend
  const grounds = Number(input.groundsG)
  const water = Number(input.waterMl)
  const timeMin = Math.max(Number(input.timeMin) || 0, 0)
  const serving = Number(input.servingMl)

  if (!(grounds > 0) || !(water > 0)) {
    return { extractedMg: 0, beverageMl: 0, concentrationMgPerMl: 0, doseMg: 0, doseMgLow: 0, doseMgHigh: 0, efficiency: 0 }
  }

  // Per-method extraction rate and bed retention (fall back to the hot-immersion defaults).
  const k = method.kPerMin > 0 ? method.kPerMin : EXTRACTION_K_PER_MIN
  const retention = method.retentionMlPerG >= 0 ? method.retentionMlPerG : GROUNDS_RETENTION_ML_PER_G

  const efficiency = method.emax * (1 - Math.exp(-k * timeMin))
  const extractedMg = grounds * pool * efficiency
  const beverageMl = Math.max(water - retention * grounds, 1)
  const concentrationMgPerMl = extractedMg / beverageMl
  // You cannot drink more than you brewed: cap the serving at the beverage volume.
  const drunkMl = serving > 0 ? Math.min(serving, beverageMl) : 0
  const doseMg = concentrationMgPerMl * drunkMl
  return {
    extractedMg,
    beverageMl,
    concentrationMgPerMl,
    doseMg,
    doseMgLow: doseMg * (1 - BREW_UNCERTAINTY_FRAC),
    doseMgHigh: doseMg * (1 + BREW_UNCERTAINTY_FRAC),
    efficiency,
  }
}

// ──────────────────────────────────────────────────────────── time / window helpers

// The chart shows one calendar day, midnight → midnight. Doses are placed on a timeline anchored at
// this day's 00:00, so a dose taken on an earlier day sits at a negative minute and its residual
// caffeine carries into this morning (the shell gathers the previous days — see util.dayDoses).
export const WINDOW_START_MIN = 0
export const WINDOW_MINUTES = 24 * 60

/** 'HH:MM' → minutes since midnight (0..1439), or null if malformed. */
export function parseClockToMinutes(str) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(str).trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return h * 60 + min
}

/** minutes → 'HH:MM' (wraps modulo 24 h). */
export function minutesToClock(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  const h = Math.floor(m / 60)
  const mm = m % 60
  return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0')
}
