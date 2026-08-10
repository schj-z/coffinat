/* Nutrimat — the global controls: body profile (mass + half-life slider), the forecast plan, and
   the sleep goal. These are not per-day; they persist across the calendar. */
import * as util from './util.js'
import * as presets from './presets.js'

let api = null
let els = null
let planProduct = null

const q = (id) => document.getElementById(id)

function updateHalfLifeLabel(v) {
  els.halflifeValue.textContent = Number(v).toFixed(1)
}

export function init(theApi) {
  api = theApi
  const state = api.state
  els = {
    mass: q('mass'),
    halflife: q('halflife'),
    halflifeValue: q('halflife-value'),
    planTime: q('plan-time'),
    planMg: q('plan-mg'),
    planEnabled: q('plan-enabled'),
    sleepThreshold: q('sleep-threshold'),
    sleepTime: q('sleep-time'),
  }

  els.mass.addEventListener('change', () => {
    const v = util.num(els.mass.value)
    state.profile.massKg = v
    els.mass.setAttribute('aria-invalid', v > 0 ? 'false' : 'true')
    api.commit()
  })

  // Half-life as a slider with a live readout.
  els.halflife.addEventListener('input', () => {
    const v = util.num(els.halflife.value)
    state.profile.halfLifeH = v
    updateHalfLifeLabel(v)
    api.commit()
  })

  // Plan product select (shares the preset list); replace the markup placeholder.
  planProduct = presets.makeSelect(state.plan.presetId, !!state.plan.brew)
  planProduct.id = 'plan-product'
  planProduct.setAttribute('aria-label', 'Planned product')
  q('plan-product').replaceWith(planProduct)
  planProduct.addEventListener('change', () => {
    if (planProduct.value === presets.HOMEBREW) {
      api.openBrew({ kind: 'plan' })
      planProduct.value = state.plan.brew ? presets.HOMEBREW : state.plan.presetId
      return
    }
    state.plan.brew = null
    state.plan.presetId = planProduct.value
    if (planProduct.value !== presets.CUSTOM) {
      const p = presets.byId(planProduct.value)
      if (p) {
        state.plan.mg = p.mg
        state.plan.label = p.label
        els.planMg.value = p.mg
      }
    }
    api.commit()
  })

  els.planTime.addEventListener('change', () => {
    state.plan.time = els.planTime.value
    api.commit()
  })
  els.planMg.addEventListener('change', () => {
    state.plan.mg = Math.max(util.num(els.planMg.value), 0)
    api.commit()
  })
  els.planEnabled.addEventListener('change', () => {
    state.plan.enabled = els.planEnabled.checked
    api.commit()
  })

  els.sleepThreshold.addEventListener('change', () => {
    state.sleep.thresholdMgL = Math.max(util.num(els.sleepThreshold.value), 0)
    api.commit()
  })
  els.sleepTime.addEventListener('change', () => {
    state.sleep.time = els.sleepTime.value
    api.commit()
  })

  sync()
}

/** Push state values into the (global) inputs. Called once at startup. */
export function sync() {
  const state = api.state
  els.mass.value = state.profile.massKg
  els.halflife.value = state.profile.halfLifeH
  updateHalfLifeLabel(state.profile.halfLifeH)
  els.planTime.value = state.plan.time
  els.planMg.value = Math.round(util.num(state.plan.mg))
  els.planEnabled.checked = state.plan.enabled
  if (planProduct) planProduct.value = state.plan.brew ? presets.HOMEBREW : state.plan.presetId
  els.sleepThreshold.value = state.sleep.thresholdMgL
  els.sleepTime.value = state.sleep.time
}
