/* Nutrimat — the per-day drink list: add, edit mg/time, hide (exclude without deleting), remove. */
import * as util from './util.js'
import * as presets from './presets.js'
import { summaryText } from './brew.js'

let api = null
let listEl = null
let titleEl = null

function makeEntryRow(entry) {
  const row = document.createElement('div')
  row.className = 'entry' + (entry.hidden ? ' entry--hidden' : '')

  const sel = presets.makeSelect(entry.presetId, !!entry.brew)
  sel.setAttribute('aria-label', 'Product')
  sel.addEventListener('change', () => {
    if (sel.value === presets.HOMEBREW) {
      api.openBrew({ kind: 'entry', id: entry.id })
      sel.value = entry.brew ? presets.HOMEBREW : entry.presetId // revert until the dialog confirms
      return
    }
    entry.brew = null
    entry.presetId = sel.value
    if (sel.value !== presets.CUSTOM) {
      const p = presets.byId(sel.value)
      if (p) {
        entry.mg = p.mg
        entry.label = p.label
      }
    } else {
      entry.label = 'Custom'
    }
    api.commit()
  })
  row.appendChild(sel)

  const time = document.createElement('input')
  time.type = 'time'
  time.value = entry.time
  time.setAttribute('aria-label', 'Time')
  time.addEventListener('change', () => {
    entry.time = time.value
    api.commit()
  })
  row.appendChild(time)

  const mgWrap = document.createElement('div')
  mgWrap.className = 'entry__mg'
  const mg = document.createElement('input')
  mg.type = 'number'
  mg.min = '0'
  mg.step = '1'
  mg.value = Math.round(util.num(entry.mg))
  mg.setAttribute('aria-label', 'Caffeine in mg')
  mg.addEventListener('change', () => {
    entry.mg = Math.max(util.num(mg.value), 0)
    api.commit()
  })
  mgWrap.appendChild(mg)
  row.appendChild(mgWrap)

  // Hide / show: keep the drink but exclude it from the calculation.
  const hide = document.createElement('button')
  hide.type = 'button'
  hide.className = 'icon-button'
  hide.title = entry.hidden ? 'Show in calculation' : 'Hide from calculation'
  hide.setAttribute('aria-label', hide.title)
  hide.setAttribute('aria-pressed', entry.hidden ? 'true' : 'false')
  hide.textContent = entry.hidden ? '🙈' : '👁'
  hide.addEventListener('click', () => {
    entry.hidden = !entry.hidden
    api.commit()
  })
  row.appendChild(hide)

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'icon-button'
  remove.title = 'Remove'
  remove.setAttribute('aria-label', 'Remove drink')
  remove.textContent = '✕'
  remove.addEventListener('click', () => {
    const day = api.currentDay()
    day.log = day.log.filter((e) => e.id !== entry.id)
    api.commit()
  })
  row.appendChild(remove)

  if (entry.brew) {
    const tag = document.createElement('div')
    tag.className = 'entry__brewtag'
    tag.appendChild(document.createTextNode(summaryText(entry.brew) + ' · '))
    const edit = document.createElement('button')
    edit.type = 'button'
    edit.textContent = 'edit'
    edit.addEventListener('click', () => api.openBrew({ kind: 'entry', id: entry.id }))
    tag.appendChild(edit)
    row.appendChild(tag)
  }

  return row
}

export function render() {
  const state = api.state
  const day = api.currentDay()
  if (titleEl) {
    titleEl.textContent =
      state.selectedDate === util.todayKey() ? "Today's caffeine" : 'Caffeine on ' + util.formatLong(state.selectedDate)
  }
  listEl.textContent = ''
  if (day.log.length === 0) {
    const p = document.createElement('p')
    p.className = 'log-empty'
    p.textContent = 'No drinks logged for this day. Add what you had.'
    listEl.appendChild(p)
    return
  }
  for (const entry of day.log) listEl.appendChild(makeEntryRow(entry))
}

export function init(theApi) {
  api = theApi
  listEl = document.getElementById('log-list')
  titleEl = document.getElementById('log-title')
  document.getElementById('add-entry').addEventListener('click', () => {
    const isToday = api.state.selectedDate === util.todayKey()
    api.currentDay().log.push({
      id: util.uid(),
      presetId: 'filter',
      label: 'Filter coffee (240 ml)',
      mg: 95,
      time: isToday ? util.nowClock() : '08:00',
      brew: null,
      hidden: false,
    })
    api.commit()
  })
}
