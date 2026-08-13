/* Coffinat — the ECharts line chart. Given precomputed series it draws them; it owns the sampling
   resolution and the styling only. */
import * as M from '../model.js'
import { cssVar } from './util.js'

// 1-minute sampling (1441 points): fine enough that the curve reads as a smooth line rather than
// a chain of visible segments. Combined with a very light `smooth`, this removes the jaggedness
// without rounding away the real kinks at each intake enough to mislead.
const STEP_MIN = 1
export const XS = (function () {
  const xs = []
  for (let x = M.WINDOW_START_MIN; x <= M.WINDOW_START_MIN + M.WINDOW_MINUTES; x += STEP_MIN) xs.push(x)
  return xs
})()

let chart = null
let apiRef = null
const round2 = (v) => Math.round(v * 100) / 100

export function init(el, api) {
  apiRef = api
  chart = window.echarts.init(el)
  window.addEventListener('resize', () => chart && chart.resize())
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  if (mq.addEventListener) mq.addEventListener('change', () => apiRef && apiRef.render())
}

function markLines(ctx) {
  const lines = []
  if (ctx.threshold > 0) {
    lines.push({
      yAxis: ctx.threshold,
      lineStyle: { color: cssVar('--danger'), type: 'dashed', width: 1.5 },
      label: { formatter: 'sleep limit', color: cssVar('--danger'), position: 'insideEndTop' },
    })
  }
  if (ctx.bedAbs != null) {
    lines.push({
      xAxis: ctx.bedAbs,
      lineStyle: { color: cssVar('--text-muted'), type: 'dashed', width: 1.5 },
      label: { formatter: 'bed', color: cssVar('--text-muted'), position: 'insideStartTop' },
    })
  }
  if (ctx.nowAbs != null) {
    lines.push({
      xAxis: ctx.nowAbs,
      lineStyle: { color: cssVar('--accent'), type: 'dotted', width: 1.5 },
      label: { formatter: 'now', color: cssVar('--accent'), position: 'insideEndBottom' },
    })
  }
  return lines
}

function build(ctx) {
  const accent = cssVar('--accent')
  const forecast = cssVar('--forecast')
  const muted = cssVar('--text-muted')
  const border = cssVar('--border')
  const surface = cssVar('--surface')
  const text = cssVar('--text')

  const series = [
    {
      name: 'Estimate',
      type: 'line',
      z: 4,
      showSymbol: false,
      smooth: 0.3,
      lineStyle: { color: accent, width: 2.5, cap: 'round' },
      areaStyle: { color: accent, opacity: 0.06 },
      data: ctx.actual.map((y, i) => [XS[i], round2(y)]),
      markLine: { symbol: 'none', animation: false, data: markLines(ctx), emphasis: { disabled: true } },
    },
  ]

  // Plausible-range envelope: two stacked lines (invisible low baseline + high−low fill) draw a
  // translucent band between low and high, kept visually subordinate to the solid centre line. Faint
  // edge strokes give a non-colour cue so the band reads without relying on the fill colour alone. The
  // same helper draws the logged-drink band (solid edges) and, when a drink is planned, the forecast
  // band (dashed edges, matching the dashed forecast line and a touch fainter to stay secondary).
  function bandSeries(low, high, color, stackName, fillOpacity, edgeDashed) {
    return [
      {
        name: '__' + stackName + '_low',
        type: 'line', stack: stackName, z: 1, silent: true, showSymbol: false, smooth: 0.3,
        lineStyle: { color: color, width: 1, opacity: 0.3, type: edgeDashed ? 'dashed' : 'solid' },
        areaStyle: { opacity: 0 },
        data: low.map((y, i) => [XS[i], round2(y)]),
      },
      {
        name: '__' + stackName + '_fill',
        type: 'line', stack: stackName, z: 1, silent: true, showSymbol: false, smooth: 0.3,
        lineStyle: { color: color, width: 1, opacity: 0.3, type: edgeDashed ? 'dashed' : 'solid' },
        areaStyle: { color: color, opacity: fillOpacity },
        data: high.map((y, i) => [XS[i], round2(Math.max(0, y - low[i]))]),
      },
    ]
  }

  if (ctx.actualLow && ctx.actualHigh) {
    series.unshift(...bandSeries(ctx.actualLow, ctx.actualHigh, accent, 'band', 0.14, false))
  }

  if (ctx.forecast) {
    if (ctx.forecastLow && ctx.forecastHigh) {
      series.push(...bandSeries(ctx.forecastLow, ctx.forecastHigh, forecast, 'fcband', 0.1, true))
    }
    series.push({
      name: 'Forecast',
      type: 'line',
      z: 2,
      showSymbol: false,
      smooth: 0.3,
      lineStyle: { color: forecast, width: 2, type: 'dashed', cap: 'round' },
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
        const i = params[0].dataIndex
        let s = '<strong>' + M.minutesToClock(params[0].value[0]) + '</strong>'
        for (const p of params) {
          if (p.seriesName && p.seriesName.indexOf('__') === 0) continue // skip the band helper series
          s += '<br>' + p.marker + p.seriesName + ': ' + p.value[1].toFixed(2) + ' mg/L'
          // Each real line carries its own plausible range beneath it.
          let lo = null
          let hi = null
          if (p.seriesName === 'Estimate' && ctx.actualLow) {
            lo = ctx.actualLow[i]
            hi = ctx.actualHigh[i]
          } else if (p.seriesName === 'Forecast' && ctx.forecastLow) {
            lo = ctx.forecastLow[i]
            hi = ctx.forecastHigh[i]
          }
          if (lo != null && hi != null) {
            s += '<br><span style="opacity:.7">&nbsp;&nbsp;plausible ' + lo.toFixed(2) + '–' + hi.toFixed(2) + ' mg/L</span>'
          }
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

export function update(ctx) {
  if (chart) chart.setOption(build(ctx), { notMerge: true })
}
