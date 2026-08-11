/* Coffinat — day picker. A compact ◀ day ▶ navigation row (always visible); a button pops up a
   month grid that dots the days with data so you can jump to one. Switching day changes which
   day's log the rest of the app shows. */
import * as util from './util.js'
import { hasData } from './storage.js'

let api = null
let view = { year: 0, month: 0 } // the month shown in the popup grid
let open = false
let root = null
let els = null

function el(tag, cls, text) {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}

function setOpen(v) {
  open = v
  els.picker.hidden = !open
  els.toggle.setAttribute('aria-expanded', open ? 'true' : 'false')
  if (open) renderGrid()
}

function selectDay(key) {
  const d = util.parseYmd(key)
  view = { year: d.getFullYear(), month: d.getMonth() }
  setOpen(false)
  api.selectDate(key)
}

function stepDay(delta) {
  selectDay(util.addDays(api.state.selectedDate, delta))
}

function stepMonth(delta) {
  const d = new Date(view.year, view.month + delta, 1)
  view = { year: d.getFullYear(), month: d.getMonth() }
  renderGrid()
}

function renderGrid() {
  const state = api.state
  els.monthLabel.textContent = util.MONTHS[view.month] + ' ' + view.year
  els.grid.textContent = ''
  const first = new Date(view.year, view.month, 1)
  const lead = (first.getDay() + 6) % 7 // week starts Monday
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate()
  const today = util.todayKey()
  for (let i = 0; i < lead; i++) els.grid.appendChild(el('div', 'cal-cell cal-cell--blank'))
  for (let d = 1; d <= daysInMonth; d++) {
    const key = util.ymd(new Date(view.year, view.month, d))
    const btn = el('button', 'cal-cell', String(d))
    btn.type = 'button'
    if (key === state.selectedDate) btn.classList.add('cal-cell--selected')
    if (key === today) btn.classList.add('cal-cell--today')
    if (hasData(state, key)) btn.classList.add('cal-cell--data')
    btn.addEventListener('click', () => selectDay(key))
    els.grid.appendChild(btn)
  }
}

export function render() {
  els.label.textContent = util.formatLong(api.state.selectedDate)
  if (open) renderGrid()
}

export function init(theApi) {
  api = theApi
  const sel = util.parseYmd(api.state.selectedDate)
  view = { year: sel.getFullYear(), month: sel.getMonth() }

  root = document.getElementById('calendar')
  root.textContent = ''
  root.classList.add('calendar')

  // ── compact day-navigation row ──
  const nav = el('div', 'daynav')
  const prev = el('button', 'daynav__step', '‹')
  prev.type = 'button'
  prev.title = 'Previous day'
  prev.addEventListener('click', () => stepDay(-1))

  els = {}
  els.toggle = el('button', 'daynav__label')
  els.toggle.type = 'button'
  els.toggle.setAttribute('aria-haspopup', 'true')
  els.toggle.setAttribute('aria-expanded', 'false')
  els.toggle.title = 'Pick a day'
  els.label = el('span', null, util.formatLong(api.state.selectedDate))
  els.toggle.append(els.label, el('span', 'daynav__caret', '▾'))
  els.toggle.addEventListener('click', () => setOpen(!open))

  const next = el('button', 'daynav__step', '›')
  next.type = 'button'
  next.title = 'Next day'
  next.addEventListener('click', () => stepDay(1))

  const today = el('button', 'button button--quiet button--small', 'Today')
  today.type = 'button'
  today.addEventListener('click', () => selectDay(util.todayKey()))

  nav.append(prev, els.toggle, next, today)

  // ── pop-up month grid (hidden until the label is clicked) ──
  els.picker = el('div', 'daypicker')
  els.picker.hidden = true
  const head = el('div', 'cal-month__head')
  const pm = el('button', 'daynav__step', '‹')
  pm.type = 'button'
  pm.title = 'Previous month'
  pm.addEventListener('click', () => stepMonth(-1))
  els.monthLabel = el('span', 'cal-month__label')
  const nm = el('button', 'daynav__step', '›')
  nm.type = 'button'
  nm.title = 'Next month'
  nm.addEventListener('click', () => stepMonth(1))
  head.append(pm, els.monthLabel, nm)

  const weekhead = el('div', 'cal-grid cal-grid--head')
  for (const w of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) weekhead.appendChild(el('div', 'cal-weekday', w))

  els.grid = el('div', 'cal-grid')
  els.picker.append(head, weekhead, els.grid)

  root.append(nav, els.picker)

  // Light dismiss: click outside or press Escape.
  document.addEventListener('click', (e) => {
    if (open && !root.contains(e.target)) setOpen(false)
  })
  document.addEventListener('keydown', (e) => {
    if (open && e.key === 'Escape') setOpen(false)
  })

  render()
}
