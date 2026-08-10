/* Nutrimat — day picker. A day-navigation row plus a month grid that dots the days with data.
   Switching day changes which day's log the rest of the app shows. */
import * as util from './util.js'
import { hasData } from './storage.js'

let api = null
let view = { year: 0, month: 0 } // the month currently shown in the grid
let els = null

function el(tag, cls, text) {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text != null) n.textContent = text
  return n
}

function selectDay(key) {
  const d = util.parseYmd(key)
  view = { year: d.getFullYear(), month: d.getMonth() }
  api.selectDate(key)
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
  els.selected.textContent = util.formatLong(api.state.selectedDate)
  renderGrid()
}

export function init(theApi) {
  api = theApi
  const d = util.parseYmd(api.state.selectedDate)
  view = { year: d.getFullYear(), month: d.getMonth() }

  const root = document.getElementById('calendar')
  root.textContent = ''

  // Day navigation row
  const nav = el('div', 'cal-nav')
  const prevDay = el('button', 'icon-button', '‹')
  prevDay.type = 'button'
  prevDay.title = 'Previous day'
  prevDay.addEventListener('click', () => selectDay(util.addDays(api.state.selectedDate, -1)))
  els = { selected: el('span', 'cal-nav__date') }
  const nextDay = el('button', 'icon-button', '›')
  nextDay.type = 'button'
  nextDay.title = 'Next day'
  nextDay.addEventListener('click', () => selectDay(util.addDays(api.state.selectedDate, 1)))
  const today = el('button', 'button button--quiet button--small', 'Today')
  today.type = 'button'
  today.addEventListener('click', () => selectDay(util.todayKey()))
  nav.append(prevDay, els.selected, nextDay, today)

  // Month grid
  const month = el('div', 'cal-month')
  const head = el('div', 'cal-month__head')
  const prevMonth = el('button', 'icon-button', '‹')
  prevMonth.type = 'button'
  prevMonth.title = 'Previous month'
  prevMonth.addEventListener('click', () => stepMonth(-1))
  els.monthLabel = el('span', 'cal-month__label')
  const nextMonth = el('button', 'icon-button', '›')
  nextMonth.type = 'button'
  nextMonth.title = 'Next month'
  nextMonth.addEventListener('click', () => stepMonth(1))
  head.append(prevMonth, els.monthLabel, nextMonth)

  const weekhead = el('div', 'cal-grid cal-grid--head')
  for (const w of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) weekhead.appendChild(el('div', 'cal-weekday', w))

  els.grid = el('div', 'cal-grid')
  month.append(head, weekhead, els.grid)

  root.append(nav, month)
  render()
}
