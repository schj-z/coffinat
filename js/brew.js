/* Nutrimat — the home-brew calculator dialog. Turns grounds + water + method + time + serving into
   a dose in mg (via the pure model) and writes it onto the target entry or the forecast plan. */
import * as M from '../model.js'
import { num } from './util.js'
import { HOMEBREW } from './presets.js'

let api = null
let target = null // { kind: 'entry', id } | { kind: 'plan' }
let els = null

const q = (id) => document.getElementById(id)

function populateSelectors() {
  for (const key of Object.keys(M.BREW_METHODS)) {
    const o = document.createElement('option')
    o.value = key
    o.textContent = M.BREW_METHODS[key].label
    els.method.appendChild(o)
  }
  for (const bean of ['arabica', 'robusta', 'blend']) {
    const o = document.createElement('option')
    o.value = bean
    o.textContent = bean.charAt(0).toUpperCase() + bean.slice(1)
    els.bean.appendChild(o)
  }
}

function readInputs() {
  return {
    method: els.method.value,
    bean: els.bean.value,
    groundsG: num(els.grounds.value),
    waterMl: num(els.water.value),
    timeMin: num(els.time.value),
    servingMl: num(els.serving.value),
  }
}

function refreshPreview() {
  const r = M.brewCaffeine(readInputs())
  els.result.textContent = ''
  const strong = document.createElement('strong')
  strong.textContent = Math.round(r.doseMg) + ' mg'
  els.result.appendChild(document.createTextNode('This serving ≈ '))
  els.result.appendChild(strong)
  els.result.appendChild(
    document.createTextNode(
      ' caffeine. Brew makes ~' +
        Math.round(r.extractedMg) +
        ' mg in ~' +
        Math.round(r.beverageMl) +
        ' ml (' +
        r.concentrationMgPerMl.toFixed(2) +
        ' mg/ml).',
    ),
  )
}

function existingBrew() {
  if (target.kind === 'plan') return api.state.plan.brew
  const entry = api.currentDay().log.find((e) => e.id === target.id)
  return entry ? entry.brew : null
}

export function open(theApi, theTarget) {
  api = theApi
  target = theTarget
  const b = existingBrew() || { method: 'frenchpress', bean: 'arabica', groundsG: 18, waterMl: 250, timeMin: 4, servingMl: 200 }
  els.method.value = b.method
  els.bean.value = b.bean
  els.grounds.value = b.groundsG
  els.water.value = b.waterMl
  els.time.value = b.timeMin
  els.serving.value = b.servingMl
  refreshPreview()
  if (typeof els.dialog.showModal === 'function') els.dialog.showModal()
  else els.dialog.setAttribute('open', '')
}

function close() {
  if (typeof els.dialog.close === 'function') els.dialog.close()
  else els.dialog.removeAttribute('open')
  target = null
}

function apply() {
  const input = readInputs()
  const r = M.brewCaffeine(input)
  const brew = {
    method: input.method,
    bean: input.bean,
    groundsG: input.groundsG,
    waterMl: input.waterMl,
    timeMin: input.timeMin,
    servingMl: input.servingMl,
  }
  const mg = Math.round(r.doseMg)
  const label = (M.BREW_METHODS[input.method] || {}).label || 'Home-brew'
  if (target.kind === 'plan') {
    Object.assign(api.state.plan, { brew, mg, label, presetId: HOMEBREW })
  } else {
    const entry = api.currentDay().log.find((e) => e.id === target.id)
    if (entry) Object.assign(entry, { brew, mg, label, presetId: HOMEBREW })
  }
  close()
  api.commit()
}

/** A one-line description of a stored brew, for the log row's tag. */
export function summaryText(brew) {
  const method = M.BREW_METHODS[brew.method]
  const bean = brew.bean.charAt(0).toUpperCase() + brew.bean.slice(1)
  return '☕ ' + brew.groundsG + ' g ' + bean + ' · ' + (method ? method.label : brew.method) + ' ' + brew.timeMin + ' min · ' + brew.servingMl + ' ml serving'
}

export function init(theApi) {
  api = theApi
  els = {
    dialog: q('brew-dialog'),
    method: q('brew-method'),
    bean: q('brew-bean'),
    grounds: q('brew-grounds'),
    water: q('brew-water'),
    time: q('brew-time'),
    serving: q('brew-serving'),
    result: q('brew-result'),
  }
  populateSelectors()
  for (const k of ['method', 'bean', 'grounds', 'water', 'time', 'serving']) {
    els[k].addEventListener('input', refreshPreview)
  }
  q('brew-use').addEventListener('click', apply)
  q('brew-cancel').addEventListener('click', close)
  els.dialog.addEventListener('cancel', (e) => {
    e.preventDefault()
    close()
  })
}
