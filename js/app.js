/* Coffinat — the orchestrator. It owns the state, wires the modules together, and runs the single
   render() that recomputes the summary and redraws the chart. Modules mutate state then call
   api.commit() (save + render); they never reach into each other directly. No pharmacology here. */
import * as M from '../model.js'
import * as util from './util.js'
import * as storage from './storage.js'
import * as chart from './chart.js'
import * as brew from './brew.js'
import * as calendar from './calendar.js'
import * as log from './log.js'
import * as controls from './controls.js'
import * as levels from './levels.js'

let state = storage.load()

const els = {}

const api = {
  get state() {
    return state
  },
  currentDay() {
    return storage.getDay(state, state.selectedDate)
  },
  commit() {
    storage.save(state)
    render()
  },
  render() {
    render()
  },
  openBrew(target) {
    brew.open(api, target)
  },
  selectDate(key) {
    state.selectedDate = key
    api.commit()
  },
}

function setValue(el, value, unit, cls) {
  el.textContent = ''
  el.appendChild(document.createTextNode(value))
  if (unit) {
    const u = document.createElement('span')
    u.className = 'summary__unit'
    u.textContent = ' ' + unit
    el.appendChild(u)
  }
  el.classList.remove('summary__value--over', 'summary__value--ok')
  if (cls) el.classList.add(cls)
}

// How many previous days of caffeine to carry into the current day. Even at a long half-life,
// two days back is negligible (2 half-lives ≈ a quarter left per day), so this captures it all.
const CARRY_DAYS = 2

function render() {
  const day = storage.getDay(state, state.selectedDate)
  const viewActive = day.log.filter((e) => !e.hidden) // this day's own drinks (for the consumed total + log)
  // Doses driving the curve include the previous days' residual, anchored to this day's midnight.
  const actualDoses = util.dayDoses(state, state.selectedDate, CARRY_DAYS)

  const planValid = state.plan.enabled && M.parseClockToMinutes(state.plan.time) != null && util.num(state.plan.mg) > 0
  const plannedDose = planValid
    ? { mg: util.num(state.plan.mg), absMin: M.parseClockToMinutes(state.plan.time), frac: util.doseFrac(state.plan) }
    : null
  const effectiveDoses = plannedDose ? actualDoses.concat([plannedDose]) : actualDoses

  // The plausible-range envelope wraps the logged-drink curve AND (when a drink is planned) the
  // forecast curve; each centre IS that trajectory's best estimate.
  const actualBand = M.concentrationBandSeriesMgL(actualDoses, state.profile, chart.XS)
  const actualSeries = actualBand.center
  const forecastBand = plannedDose ? M.concentrationBandSeriesMgL(effectiveDoses, state.profile, chart.XS) : null
  const forecastSeries = forecastBand ? forecastBand.center : null

  // Peaks: the most you reach from what's actually logged, and — with the forecast on — the most
  // you'd reach if you also had the planned drink.
  const actualPeak = seriesPeak(actualSeries)
  const predictedPeak = forecastSeries ? seriesPeak(forecastSeries) : null

  const isToday = state.selectedDate === util.todayKey()
  const nowAbsRaw = util.nowMinutes()
  const nowInWindow = isToday && nowAbsRaw >= M.WINDOW_START_MIN && nowAbsRaw <= M.WINDOW_START_MIN + M.WINDOW_MINUTES
  const nowVal = isToday ? M.concentrationAtMgL(actualDoses, nowAbsRaw, state.profile) : null

  // Summary — "now" only makes sense for today; other days show the day's peak instead.
  if (isToday) {
    els.nowLabel.textContent = 'Caffeine in blood now'
    setValue(els.now, nowVal.toFixed(2), 'mg/L')
  } else {
    els.nowLabel.textContent = 'Peak this day'
    setValue(els.now, actualPeak.val.toFixed(2), 'mg/L')
  }

  const todayTotal = viewActive.reduce((s, e) => s + Math.max(util.num(e.mg), 0), 0)
  const overLimit = todayTotal > M.DAILY_LIMIT_MG
  setValue(els.today, Math.round(todayTotal), '/ ' + M.DAILY_LIMIT_MG + ' mg', overLimit ? 'summary__value--over' : null)
  els.todayNote.textContent = overLimit
    ? 'Above the ' + M.DAILY_LIMIT_MG + ' mg/day guideline.'
    : 'Guideline: up to ' + M.DAILY_LIMIT_MG + ' mg/day, ' + M.SINGLE_DOSE_CAUTION_MG + ' mg per dose.'

  // Model-validity: above the toxic threshold the constant-half-life PK model is unreliable (real
  // clearance can slow markedly). Two tiers, over BOTH the logged and planned trajectories, using RAW
  // concentration (tolerance never applies here): a strong warning if the centre estimate crosses the
  // threshold; a weaker caution if only the upper plausible bound does.
  const centerPeakMax = Math.max(actualPeak.val, predictedPeak ? predictedPeak.val : 0)
  const upperPeakMax = Math.max(maxOf(actualBand.high), forecastBand ? maxOf(forecastBand.high) : 0)
  const centerReliable = M.pkForecastReliable(centerPeakMax)
  const upperReliable = M.pkForecastReliable(upperPeakMax)
  if (!centerReliable) {
    els.modelWarning.hidden = false
    els.modelWarning.dataset.tier = 'strong'
    els.modelWarning.textContent =
      '⚠ Estimated levels reach the toxic range (≥ ' + M.TOXIC_THRESHOLD_MGL + ' mg/L). Above this, ' +
      'caffeine can be cleared far more slowly than this model assumes, so the curve here — and any ' +
      'time it shows you dropping back below a level — is unreliable and likely optimistic. Treat it ' +
      'as a warning, not a prediction; a real overdose needs medical advice.'
  } else if (!upperReliable) {
    els.modelWarning.hidden = false
    els.modelWarning.dataset.tier = 'caution'
    els.modelWarning.textContent =
      'Note: your central estimate stays below the toxic range, but some plausible scenarios reach it ' +
      '(≥ ' + M.TOXIC_THRESHOLD_MGL + ' mg/L), where this model stops being reliable. The true value ' +
      'is uncertain — treat high readings with caution.'
  } else {
    els.modelWarning.hidden = true
    els.modelWarning.dataset.tier = ''
    els.modelWarning.textContent = ''
  }

  const bedMin = M.parseClockToMinutes(state.sleep.time)
  const bedAbs = bedMin != null ? bedMin : null
  const bedVal = bedAbs != null ? M.concentrationAtMgL(effectiveDoses, bedAbs, state.profile) : 0
  els.bedLabel.textContent = 'At bedtime (' + (state.sleep.time || '—') + ')'
  const bedOver = bedVal > state.sleep.thresholdMgL
  setValue(els.bed, bedVal.toFixed(2), 'mg/L', bedAbs == null || !centerReliable ? null : bedOver ? 'summary__value--over' : 'summary__value--ok')

  if (bedAbs == null) {
    els.flag.hidden = true
  } else if (!centerReliable) {
    // The bedtime figure rides on the (unreliable) decay from a toxic peak — don't assert it.
    els.flag.hidden = false
    els.flag.dataset.state = 'over'
    els.flag.textContent =
      '⚠ Levels reach the toxic range today, so the bedtime estimate and how fast caffeine clears ' +
      'can’t be predicted reliably here — see the warning above.'
  } else {
    els.flag.hidden = false
    els.flag.dataset.state = bedOver ? 'over' : 'ok'
    els.flag.textContent = bedOver
      ? '⚠ Estimated ' + bedVal.toFixed(2) + ' mg/L at ' + state.sleep.time + ' — above your ' + state.sleep.thresholdMgL + ' mg/L limit. Consider skipping or moving a later drink earlier.'
      : '✓ Estimated ' + bedVal.toFixed(2) + ' mg/L at ' + state.sleep.time + ' — at or below your ' + state.sleep.thresholdMgL + ' mg/L limit.'
  }

  chart.update({
    actual: actualSeries,
    actualLow: actualBand.low,
    actualHigh: actualBand.high,
    forecast: forecastSeries,
    forecastLow: forecastBand ? forecastBand.low : null,
    forecastHigh: forecastBand ? forecastBand.high : null,
    threshold: util.num(state.sleep.thresholdMgL),
    bedAbs: bedAbs,
    nowAbs: nowInWindow ? nowAbsRaw : null,
  })
  levels.update({
    nowVal: nowVal,
    factor: M.toleranceFactor(state.profile.tolerance),
    actual: actualPeak,
    predicted: predictedPeak,
  })
  calendar.render(api)
  log.render(api)
}

/** The maximum value in an array (loop, not Math.max(...spread), to stay safe for long series). */
function maxOf(arr) {
  let m = 0
  for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i]
  return m
}

/** The maximum of a concentration series and the minute at which it occurs. */
function seriesPeak(series) {
  let val = 0
  let min = null
  for (let i = 0; i < series.length; i++) {
    if (series[i] > val) {
      val = series[i]
      min = chart.XS[i]
    }
  }
  return { val: val, min: min }
}

function init() {
  els.now = document.getElementById('now-value')
  els.nowLabel = document.getElementById('now-label')
  els.today = document.getElementById('today-value')
  els.todayNote = document.getElementById('today-note')
  els.bed = document.getElementById('bed-value')
  els.bedLabel = document.getElementById('bed-label')
  els.flag = document.getElementById('sleep-flag')
  els.modelWarning = document.getElementById('model-warning')

  chart.init(document.getElementById('chart'), api)
  controls.init(api)
  brew.init(api)
  calendar.init(api)
  log.init(api)
  levels.init()
  render()
}

// The module script is deferred, so the DOM is ready — but guard anyway.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
else init()

export { api } // exported for the headless smoke test
