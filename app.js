/*
 * Nutrimat — UI layer. State, localStorage, DOM rendering and the ECharts chart.
 * All the maths lives in model.js (NutrimatModel) and is unit-tested; this file only reads state,
 * calls the model, and draws. Keep it that way: no pharmacology here.
 */
;(function () {
  'use strict'

  const M = window.NutrimatModel
  const STORAGE_KEY = 'nutrimat.v1'

  // Product presets: average caffeine (mg). Editable per entry. Sources in README.
  const PRESETS = [
    { id: 'filter', label: 'Filter coffee (240 ml)', mg: 95 },
    { id: 'espresso', label: 'Espresso', mg: 63 },
    { id: 'double_espresso', label: 'Double espresso', mg: 125 },
    { id: 'instant', label: 'Instant coffee', mg: 60 },
    { id: 'latte', label: 'Cappuccino / Latte', mg: 75 },
    { id: 'black_tea', label: 'Black tea', mg: 47 },
    { id: 'green_tea', label: 'Green tea', mg: 28 },
    { id: 'energy', label: 'Energy drink (250 ml)', mg: 80 },
    { id: 'energy_shot', label: 'Energy shot', mg: 200 },
    { id: 'cola', label: 'Cola (330 ml)', mg: 34 },
    { id: 'dark_choc', label: 'Dark chocolate (50 g)', mg: 24 },
  ]
  const HOMEBREW = 'homebrew'
  const CUSTOM = 'custom'

  function presetById(id) {
    return PRESETS.find((p) => p.id === id) || null
  }

  // ─────────────────────────────────────────────────────────────── state

  function defaultState() {
    return {
      profile: { massKg: 70, halfLifeH: M.PK.DEFAULT_HALFLIFE_H },
      log: [],
      plan: { presetId: 'filter', label: 'Filter coffee (240 ml)', mg: 95, time: '20:00', enabled: false, brew: null },
      sleep: { thresholdMgL: 1.5, time: '23:00' },
    }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return defaultState()
      const parsed = JSON.parse(raw)
      const d = defaultState()
      // Shallow-merge each section so a partial or old blob can't leave holes.
      return {
        profile: Object.assign(d.profile, parsed.profile),
        log: Array.isArray(parsed.log) ? parsed.log : d.log,
        plan: Object.assign(d.plan, parsed.plan),
        sleep: Object.assign(d.sleep, parsed.sleep),
      }
    } catch (err) {
      // A corrupt value must not brick the app — start fresh.
      console.warn('Nutrimat: could not read saved state, starting fresh.', err)
      return defaultState()
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch (err) {
      console.warn('Nutrimat: could not save state.', err)
    }
  }

  const state = loadState()

  // ─────────────────────────────────────────────────────────────── small helpers

  const $ = (sel) => document.querySelector(sel)
  const num = (v) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  const uid = () => 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

  function nowMinutes() {
    const d = new Date()
    return d.getHours() * 60 + d.getMinutes()
  }
  function nowClock() {
    return M.minutesToClock(nowMinutes())
  }

  /** Build {mg, absMin} doses from a list of log/plan-shaped entries, dropping invalid ones. */
  function toDoses(entries) {
    const doses = []
    for (const e of entries) {
      const min = M.parseClockToMinutes(e.time)
      const mg = num(e.mg)
      if (min == null || !(mg > 0)) continue
      doses.push({ mg, absMin: M.clockToWindowAbs(min) })
    }
    return doses
  }

  // ─────────────────────────────────────────────────────────────── log rendering

  const logList = $('#log-list')

  function makeProductSelect(selectedId, hasBrew) {
    const sel = document.createElement('select')
    for (const p of PRESETS) {
      const o = document.createElement('option')
      o.value = p.id
      o.textContent = p.label
      sel.appendChild(o)
    }
    const brewOpt = document.createElement('option')
    brewOpt.value = HOMEBREW
    brewOpt.textContent = 'Home-brew…'
    sel.appendChild(brewOpt)
    const customOpt = document.createElement('option')
    customOpt.value = CUSTOM
    customOpt.textContent = 'Custom (mg)'
    sel.appendChild(customOpt)
    sel.value = hasBrew ? HOMEBREW : selectedId
    return sel
  }

  function brewSummaryText(brew) {
    const method = M.BREW_METHODS[brew.method]
    const beanLabel = brew.bean.charAt(0).toUpperCase() + brew.bean.slice(1)
    return (
      '☕ ' +
      brew.groundsG +
      ' g ' +
      beanLabel +
      ' · ' +
      (method ? method.label : brew.method) +
      ' ' +
      brew.timeMin +
      ' min · ' +
      brew.servingMl +
      ' ml serving'
    )
  }

  function renderLog() {
    logList.textContent = ''
    if (state.log.length === 0) {
      const p = document.createElement('p')
      p.className = 'log-empty'
      p.textContent = 'No drinks logged yet. Add what you have had today.'
      logList.appendChild(p)
      return
    }
    for (const entry of state.log) {
      logList.appendChild(renderEntry(entry))
    }
  }

  function renderEntry(entry) {
    const row = document.createElement('div')
    row.className = 'entry'

    const sel = makeProductSelect(entry.presetId, !!entry.brew)
    sel.setAttribute('aria-label', 'Product')
    sel.addEventListener('change', () => {
      if (sel.value === HOMEBREW) {
        openBrewDialog({ kind: 'entry', id: entry.id })
        // Revert the select until the dialog confirms, so a cancel leaves the row unchanged.
        sel.value = entry.brew ? HOMEBREW : entry.presetId
        return
      }
      entry.brew = null
      entry.presetId = sel.value
      if (sel.value !== CUSTOM) {
        const p = presetById(sel.value)
        if (p) {
          entry.mg = p.mg
          entry.label = p.label
        }
      } else {
        entry.label = 'Custom'
      }
      saveState()
      renderLog()
      render()
    })
    row.appendChild(sel)

    const time = document.createElement('input')
    time.type = 'time'
    time.value = entry.time
    time.setAttribute('aria-label', 'Time')
    time.addEventListener('change', () => {
      entry.time = time.value
      saveState()
      render()
    })
    row.appendChild(time)

    const mgWrap = document.createElement('div')
    mgWrap.className = 'entry__mg'
    const mg = document.createElement('input')
    mg.type = 'number'
    mg.min = '0'
    mg.step = '1'
    mg.value = Math.round(num(entry.mg))
    mg.setAttribute('aria-label', 'Caffeine in mg')
    mg.addEventListener('change', () => {
      entry.mg = Math.max(num(mg.value), 0)
      saveState()
      render()
    })
    mgWrap.appendChild(mg)
    row.appendChild(mgWrap)

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'icon-button'
    remove.title = 'Remove'
    remove.setAttribute('aria-label', 'Remove drink')
    remove.textContent = '✕'
    remove.addEventListener('click', () => {
      state.log = state.log.filter((e) => e.id !== entry.id)
      saveState()
      renderLog()
      render()
    })
    row.appendChild(remove)

    if (entry.brew) {
      const tag = document.createElement('div')
      tag.className = 'entry__brewtag'
      tag.appendChild(document.createTextNode(brewSummaryText(entry.brew) + ' · '))
      const edit = document.createElement('button')
      edit.type = 'button'
      edit.textContent = 'edit'
      edit.addEventListener('click', () => openBrewDialog({ kind: 'entry', id: entry.id }))
      tag.appendChild(edit)
      row.appendChild(tag)
    }

    return row
  }

  // ─────────────────────────────────────────────────────────────── brew dialog

  const dialog = $('#brew-dialog')
  const brewFields = {
    method: $('#brew-method'),
    bean: $('#brew-bean'),
    grounds: $('#brew-grounds'),
    water: $('#brew-water'),
    time: $('#brew-time'),
    serving: $('#brew-serving'),
  }
  const brewResult = $('#brew-result')
  let brewTarget = null

  function populateBrewSelectors() {
    for (const key of Object.keys(M.BREW_METHODS)) {
      const o = document.createElement('option')
      o.value = key
      o.textContent = M.BREW_METHODS[key].label
      brewFields.method.appendChild(o)
    }
    for (const bean of ['arabica', 'robusta', 'blend']) {
      const o = document.createElement('option')
      o.value = bean
      o.textContent = bean.charAt(0).toUpperCase() + bean.slice(1)
      brewFields.bean.appendChild(o)
    }
  }

  function readBrewInputs() {
    return {
      method: brewFields.method.value,
      bean: brewFields.bean.value,
      groundsG: num(brewFields.grounds.value),
      waterMl: num(brewFields.water.value),
      timeMin: num(brewFields.time.value),
      servingMl: num(brewFields.serving.value),
    }
  }

  function refreshBrewPreview() {
    const input = readBrewInputs()
    const r = M.brewCaffeine(input)
    brewResult.textContent = ''
    const strong = document.createElement('strong')
    strong.textContent = Math.round(r.doseMg) + ' mg'
    brewResult.appendChild(document.createTextNode('This serving ≈ '))
    brewResult.appendChild(strong)
    brewResult.appendChild(
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

  function openBrewDialog(target) {
    brewTarget = target
    const existing =
      target.kind === 'plan' ? state.plan.brew : (state.log.find((e) => e.id === target.id) || {}).brew
    const defaults = { method: 'frenchpress', bean: 'arabica', groundsG: 18, waterMl: 250, timeMin: 4, servingMl: 200 }
    const b = existing || defaults
    brewFields.method.value = b.method
    brewFields.bean.value = b.bean
    brewFields.grounds.value = b.groundsG
    brewFields.water.value = b.waterMl
    brewFields.time.value = b.timeMin
    brewFields.serving.value = b.servingMl
    refreshBrewPreview()
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '') // very old browsers: non-modal fallback
  }

  function applyBrew() {
    const input = readBrewInputs()
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
    if (brewTarget.kind === 'plan') {
      state.plan.brew = brew
      state.plan.mg = mg
      state.plan.label = label
      planFields.mg.value = mg
      planFields.product.value = HOMEBREW
    } else {
      const entry = state.log.find((e) => e.id === brewTarget.id)
      if (entry) {
        entry.brew = brew
        entry.mg = mg
        entry.presetId = HOMEBREW
        entry.label = label
      }
    }
    saveState()
    renderLog()
    render()
    closeBrewDialog()
  }

  function closeBrewDialog() {
    if (typeof dialog.close === 'function') dialog.close()
    else dialog.removeAttribute('open')
    brewTarget = null
  }

  // ─────────────────────────────────────────────────────────────── profile / plan / sleep inputs

  const profileFields = { mass: $('#mass'), halflife: $('#halflife') }
  const planFields = {
    product: $('#plan-product'),
    time: $('#plan-time'),
    mg: $('#plan-mg'),
    enabled: $('#plan-enabled'),
  }
  const sleepFields = { threshold: $('#sleep-threshold'), time: $('#sleep-time') }

  function wireStaticInputs() {
    profileFields.mass.value = state.profile.massKg
    profileFields.halflife.value = state.profile.halfLifeH
    profileFields.mass.addEventListener('change', () => {
      const v = num(profileFields.mass.value)
      state.profile.massKg = v
      profileFields.mass.setAttribute('aria-invalid', v > 0 ? 'false' : 'true')
      saveState()
      render()
    })
    profileFields.halflife.addEventListener('change', () => {
      const v = num(profileFields.halflife.value)
      state.profile.halfLifeH = v
      profileFields.halflife.setAttribute('aria-invalid', v > 0 ? 'false' : 'true')
      saveState()
      render()
    })

    // Plan product select shares the preset list.
    const planSel = makeProductSelect(state.plan.presetId, !!state.plan.brew)
    planSel.id = 'plan-product'
    planSel.setAttribute('aria-label', 'Planned product')
    planFields.product.replaceWith(planSel)
    planFields.product = planSel
    planSel.addEventListener('change', () => {
      if (planSel.value === HOMEBREW) {
        openBrewDialog({ kind: 'plan' })
        planSel.value = state.plan.brew ? HOMEBREW : state.plan.presetId
        return
      }
      state.plan.brew = null
      state.plan.presetId = planSel.value
      if (planSel.value !== CUSTOM) {
        const p = presetById(planSel.value)
        if (p) {
          state.plan.mg = p.mg
          state.plan.label = p.label
          planFields.mg.value = p.mg
        }
      }
      saveState()
      render()
    })

    planFields.time.value = state.plan.time
    planFields.mg.value = Math.round(num(state.plan.mg))
    planFields.enabled.checked = state.plan.enabled
    planFields.time.addEventListener('change', () => {
      state.plan.time = planFields.time.value
      saveState()
      render()
    })
    planFields.mg.addEventListener('change', () => {
      state.plan.mg = Math.max(num(planFields.mg.value), 0)
      saveState()
      render()
    })
    planFields.enabled.addEventListener('change', () => {
      state.plan.enabled = planFields.enabled.checked
      saveState()
      render()
    })

    sleepFields.threshold.value = state.sleep.thresholdMgL
    sleepFields.time.value = state.sleep.time
    sleepFields.threshold.addEventListener('change', () => {
      state.sleep.thresholdMgL = Math.max(num(sleepFields.threshold.value), 0)
      saveState()
      render()
    })
    sleepFields.time.addEventListener('change', () => {
      state.sleep.time = sleepFields.time.value
      saveState()
      render()
    })
  }

  // ─────────────────────────────────────────────────────────────── chart

  const XS = (function () {
    const xs = []
    for (let x = M.WINDOW_START_MIN; x <= M.WINDOW_START_MIN + M.WINDOW_MINUTES; x += 2) xs.push(x)
    return xs
  })()

  let chart = null

  function buildChartOption(ctx) {
    const accent = cssVar('--accent')
    const forecast = cssVar('--forecast')
    const muted = cssVar('--text-muted')
    const border = cssVar('--border')
    const surface = cssVar('--surface')
    const text = cssVar('--text')

    const series = [
      {
        name: 'Actual',
        type: 'line',
        showSymbol: false,
        smooth: false,
        lineStyle: { color: accent, width: 2.5 },
        areaStyle: { color: accent, opacity: 0.08 },
        data: ctx.actual.map((y, i) => [XS[i], round2(y)]),
        markLine: {
          symbol: 'none',
          animation: false,
          data: ctx.markLines,
          emphasis: { disabled: true },
        },
      },
    ]
    if (ctx.forecast) {
      series.push({
        name: 'Forecast',
        type: 'line',
        showSymbol: false,
        smooth: false,
        lineStyle: { color: forecast, width: 2, type: 'dashed' },
        data: ctx.forecast.map((y, i) => [XS[i], round2(y)]),
      })
    }

    return {
      animation: false,
      grid: { left: 46, right: 14, top: 14, bottom: 28 },
      textStyle: { color: text, fontFamily: getComputedStyle(document.body).fontFamily },
      tooltip: {
        trigger: 'axis',
        backgroundColor: surface,
        borderColor: border,
        textStyle: { color: text },
        formatter: function (params) {
          if (!params || !params.length) return ''
          const t = M.minutesToClock(params[0].value[0])
          let s = '<strong>' + t + '</strong>'
          for (const p of params) {
            s += '<br>' + p.marker + p.seriesName + ': ' + p.value[1].toFixed(2) + ' mg/L'
          }
          return s
        },
      },
      xAxis: {
        type: 'value',
        min: M.WINDOW_START_MIN,
        max: M.WINDOW_START_MIN + M.WINDOW_MINUTES,
        interval: 180,
        axisLabel: { color: muted, formatter: (v) => M.minutesToClock(v) },
        axisLine: { lineStyle: { color: border } },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0,
        name: 'mg/L',
        nameTextStyle: { color: muted, align: 'left' },
        axisLabel: { color: muted },
        splitLine: { lineStyle: { color: border, opacity: 0.6 } },
      },
      series: series,
    }
  }

  function round2(v) {
    return Math.round(v * 100) / 100
  }

  function markLinesFor(ctx) {
    const danger = cssVar('--danger')
    const muted = cssVar('--text-muted')
    const accent = cssVar('--accent')
    const lines = []
    if (ctx.threshold > 0) {
      lines.push({
        yAxis: ctx.threshold,
        lineStyle: { color: danger, type: 'dashed', width: 1.5 },
        label: { formatter: 'sleep limit', color: danger, position: 'insideEndTop' },
      })
    }
    if (ctx.bedAbs != null) {
      lines.push({
        xAxis: ctx.bedAbs,
        lineStyle: { color: muted, type: 'dashed', width: 1.5 },
        label: { formatter: 'bed', color: muted, position: 'insideStartTop' },
      })
    }
    if (ctx.nowAbs != null) {
      lines.push({
        xAxis: ctx.nowAbs,
        lineStyle: { color: accent, type: 'dotted', width: 1.5 },
        label: { formatter: 'now', color: accent, position: 'insideEndBottom' },
      })
    }
    return lines
  }

  // ─────────────────────────────────────────────────────────────── main render

  const els = {
    now: $('#now-value'),
    today: $('#today-value'),
    bed: $('#bed-value'),
    bedLabel: $('#bed-label'),
    todayNote: $('#today-note'),
    flag: $('#sleep-flag'),
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

  function render() {
    const profile = state.profile
    const actualDoses = toDoses(state.log)

    const planValid = state.plan.enabled && M.parseClockToMinutes(state.plan.time) != null && num(state.plan.mg) > 0
    const plannedDose = planValid
      ? { mg: num(state.plan.mg), absMin: M.clockToWindowAbs(M.parseClockToMinutes(state.plan.time)) }
      : null
    const effectiveDoses = plannedDose ? actualDoses.concat([plannedDose]) : actualDoses

    // Summary — "now" reflects what you have actually had; bedtime reflects the plotted curve.
    const nowAbsRaw = M.clockToWindowAbs(nowMinutes())
    const nowVal = M.concentrationAtMgL(actualDoses, nowAbsRaw, profile)
    setValue(els.now, nowVal.toFixed(2), 'mg/L')

    const todayTotal = state.log.reduce((s, e) => s + Math.max(num(e.mg), 0), 0)
    const overLimit = todayTotal > M.DAILY_LIMIT_MG
    setValue(els.today, Math.round(todayTotal), '/ ' + M.DAILY_LIMIT_MG + ' mg', overLimit ? 'summary__value--over' : null)
    els.todayNote.textContent = overLimit
      ? 'Above the ' + M.DAILY_LIMIT_MG + ' mg/day guideline.'
      : 'Guideline: up to ' + M.DAILY_LIMIT_MG + ' mg/day, ' + M.SINGLE_DOSE_CAUTION_MG + ' mg per dose.'

    const bedMin = M.parseClockToMinutes(state.sleep.time)
    const bedAbs = bedMin != null ? M.clockToWindowAbs(bedMin) : null
    const bedVal = bedAbs != null ? M.concentrationAtMgL(effectiveDoses, bedAbs, profile) : 0
    els.bedLabel.textContent = 'At bedtime (' + (state.sleep.time || '—') + ')'
    const bedOver = bedVal > state.sleep.thresholdMgL
    setValue(els.bed, bedVal.toFixed(2), 'mg/L', bedAbs == null ? null : bedOver ? 'summary__value--over' : 'summary__value--ok')

    // Sleep flag
    if (bedAbs == null) {
      els.flag.hidden = true
    } else {
      els.flag.hidden = false
      if (bedOver) {
        els.flag.dataset.state = 'over'
        els.flag.textContent =
          '⚠ Estimated ' +
          bedVal.toFixed(2) +
          ' mg/L at ' +
          state.sleep.time +
          ' — above your ' +
          state.sleep.thresholdMgL +
          ' mg/L limit. Consider skipping or moving a later drink earlier.'
      } else {
        els.flag.dataset.state = 'ok'
        els.flag.textContent =
          '✓ Estimated ' +
          bedVal.toFixed(2) +
          ' mg/L at ' +
          state.sleep.time +
          ' — at or below your ' +
          state.sleep.thresholdMgL +
          ' mg/L limit.'
      }
    }

    // Chart
    const nowInWindow = nowAbsRaw >= M.WINDOW_START_MIN && nowAbsRaw <= M.WINDOW_START_MIN + M.WINDOW_MINUTES
    const ctx = {
      actual: M.concentrationSeriesMgL(actualDoses, profile, XS),
      forecast: plannedDose ? M.concentrationSeriesMgL(effectiveDoses, profile, XS) : null,
      threshold: num(state.sleep.thresholdMgL),
      bedAbs: bedAbs,
      nowAbs: nowInWindow ? nowAbsRaw : null,
    }
    ctx.markLines = markLinesFor(ctx)
    if (chart) chart.setOption(buildChartOption(ctx), { notMerge: true })
  }

  // ─────────────────────────────────────────────────────────────── init

  function init() {
    populateBrewSelectors()
    wireStaticInputs()
    renderLog()

    $('#add-entry').addEventListener('click', () => {
      state.log.push({ id: uid(), presetId: 'filter', label: 'Filter coffee (240 ml)', mg: 95, time: nowClock(), brew: null })
      saveState()
      renderLog()
      render()
    })

    // Brew dialog wiring
    for (const key of Object.keys(brewFields)) brewFields[key].addEventListener('input', refreshBrewPreview)
    $('#brew-use').addEventListener('click', applyBrew)
    $('#brew-cancel').addEventListener('click', closeBrewDialog)
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault()
      closeBrewDialog()
    })

    chart = window.echarts.init($('#chart'))
    window.addEventListener('resize', () => chart && chart.resize())
    // Recolour the chart when the OS theme flips.
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    if (mq.addEventListener) mq.addEventListener('change', render)

    render()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
