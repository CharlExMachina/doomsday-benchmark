// One configurable chart for a scenario's runs: the total or any category
// score against estimated cost, run time or tokens. A frontier line joins the
// runs that nothing cheaper, faster or leaner beats.

import { escape, formatDuration, formatPoints, formatTokens, formatUsd, shortName } from './format.js'

/** What a score can be plotted against. Less is better for all of them. */
const MEASURES = [
  {
    label: 'Estimated cost',
    value: (run) => run.usage?.costUsd ?? null,
    describe: (run) => formatUsd(run.usage.costUsd),
    tick: usdTick,
    zeroLabel: 'Free',
    linearStep: (top, count) => niceStep(top, count),
    logTicks: numericLogTicks,
    frontier: 'No cheaper run scores higher',
    missing: 'no cost reported',
    note: "Costs are each harness's estimate at list prices, not what a subscription bills.",
  },
  {
    label: 'Run time',
    value: (run) => run.duration?.seconds ?? null,
    describe: (run) => formatDuration(run.duration.seconds),
    tick: durationTick,
    zeroLabel: '0',
    linearStep: (top, count) => [60, 120, 300, 600, 900, 1800, 3600, 7200, 14400].find((step) => top / step <= count) ?? niceStep(top, count),
    logTicks: (lo, hi, count) => {
      const ticks = [60, 120, 300, 600, 1800, 3600, 7200, 14400, 28800].filter((v) => v >= lo && v <= hi)
      return ticks.length >= 2 ? ticks : numericLogTicks(lo, hi, count)
    },
    frontier: 'No faster run scores higher',
    missing: 'no run time recorded',
    note: 'Run time is launch to exit; setup and grading are excluded.',
  },
  {
    label: 'Tokens',
    value: (run) => run.usage?.tokens.total ?? null,
    describe: (run) => `${run.usage.tokens.output === null ? '≥ ' : ''}${formatTokens(run.usage.tokens.total)}`,
    tick: tokenTick,
    zeroLabel: '0',
    linearStep: (top, count) => niceStep(top, count),
    logTicks: numericLogTicks,
    frontier: 'No run using fewer tokens scores higher',
    missing: 'no tokens reported',
    note: 'Tokens include cache reads, which make up most of every run.',
  },
]

const MARGIN = { top: 14, right: 14, bottom: 34, left: 44 }
/** Width of the column that holds zero values on a log scale, which can't place them. */
const ZERO_COLUMN = 48
/** Steps the score axis can use; ones that divide the category's maximum make the top a labelled tick. */
const SCORE_STEPS = [0.5, 1, 2, 2.5, 5, 10, 20, 25]
/** Roughly how much room each x tick needs; the axis gets as many as fit. */
const TICK_SPACING = 64
const LABEL_FONT = '500 12px'
const TICK_FONT = '11px'
/** Where a point's label may go, tried in order: [dx, dy, which part of the label sits at dx]. */
const LABEL_SPOTS = [
  [11, 4, 'start'],
  [-11, 4, 'end'],
  [0, -12, 'middle'],
  [0, 20, 'middle'],
  [9, -10, 'start'],
  [9, 18, 'start'],
  [-9, -10, 'end'],
  [-9, 18, 'end'],
]

/** Fills `container` with the chart's controls, plot and key for `runs`, which share a scenario and version. */
export function renderChart(container, runs) {
  const scores = [
    { label: 'Total score', value: (run) => run.score.total, max: runs[0].score.max },
    ...runs[0].score.lines.map((line, i) => ({ label: shortName(line.area), value: (run) => run.score.lines[i].points, max: line.max })),
  ]
  const options = (items) => items.map((item, i) => `<option value="${i}">${escape(item.label)}</option>`).join('')
  container.innerHTML = `
    <div class="chart-controls">
      <label>Plot <select data-control="score">${options(scores)}</select></label>
      <label>against <select data-control="measure">${options(MEASURES)}</select></label>
      <label class="chart-check"><input type="checkbox" data-control="log" checked /> Log scale</label>
    </div>
    <div class="chart-plot">
      <svg></svg>
      <div class="chart-tip" role="tooltip" hidden></div>
    </div>
    <div class="chart-key"></div>`

  const plot = container.querySelector('.chart-plot')
  const tip = container.querySelector('.chart-tip')
  const control = (name) => container.querySelector(`[data-control="${name}"]`)
  let points = []
  let tipPoint = null
  let lastPointer = 'mouse'

  const showTip = (point, hint) => {
    tipPoint = point
    tip.innerHTML = `
      <strong>${escape(point.run.model)}</strong>
      <span>${escape([point.run.harness, point.run.variant].filter(Boolean).join(' · '))}</span>
      <span>${escape(point.scoreText)}</span>
      <span>${escape(point.measureText)}</span>
      ${hint ? `<em>${escape(hint)}</em>` : ''}`
    tip.hidden = false
    const flip = point.x + 16 + tip.offsetWidth > plot.clientWidth
    tip.style.left = `${flip ? Math.max(0, point.x - 16 - tip.offsetWidth) : point.x + 16}px`
    tip.style.top = `${Math.max(0, point.y - tip.offsetHeight / 2)}px`
  }
  const hideTip = () => {
    tipPoint = null
    tip.hidden = true
  }
  const pointAt = (event) => points[event.target.closest('.point')?.dataset.index]

  const draw = () => {
    const width = plot.clientWidth
    // The leaderboard is hidden while a run is open; the resize observer draws it again when it's back.
    if (width === 0) return
    const score = scores[Number(control('score').value)]
    const measure = MEASURES[Number(control('measure').value)]
    const chart = layout({ runs, score, measure, log: control('log').checked, width })
    points = chart.points
    plot.querySelector('svg').outerHTML = chart.svg
    container.querySelector('.chart-key').innerHTML = keyHtml(chart, measure, runs)
    hideTip()
  }
  container.addEventListener('change', draw)
  new ResizeObserver(draw).observe(plot)

  // A mouse shows the tooltip on hover and the keyboard on focus. Not every point has room for a label on a
  // phone, so a tap shows the tooltip first and a second tap on the same point opens the run.
  plot.addEventListener('pointerdown', (event) => {
    lastPointer = event.pointerType
  })
  plot.addEventListener('pointerover', (event) => {
    if (event.pointerType !== 'touch' && pointAt(event)) showTip(pointAt(event))
  })
  plot.addEventListener('pointerout', (event) => {
    if (event.pointerType !== 'touch' && pointAt(event)) hideTip()
  })
  plot.addEventListener('focusin', (event) => {
    if (event.target.matches(':focus-visible') && pointAt(event)) showTip(pointAt(event))
  })
  plot.addEventListener('focusout', hideTip)
  plot.addEventListener('click', (event) => {
    if (lastPointer !== 'touch') return
    const point = pointAt(event)
    if (point && point === tipPoint) return
    event.preventDefault()
    if (point) showTip(point, 'Tap again to open the run.')
    else hideTip()
  })
}

function layout({ runs, score, measure, log, width }) {
  const height = width < 560 ? 340 : 380
  const box = { left: MARGIN.left, right: width - MARGIN.right, top: MARGIN.top, bottom: height - MARGIN.bottom }
  const plotted = runs.filter((run) => measure.value(run) !== null)
  const x = xAxis(measure, plotted.map(measure.value), log, box)
  const xTicks = spacedTicks(x, measure)
  const y = yAxis(plotted.map(score.value), score.max, box)
  const points = plotted.map((run, index) => ({
    run,
    index,
    x: x.at(measure.value(run)),
    y: y.at(score.value(run)),
    xValue: measure.value(run),
    yValue: score.value(run),
    label: run.model.split('/').at(-1),
    scoreText: `${score.label}: ${formatPoints(score.value(run))} / ${score.max}`,
    measureText: `${measure.label}: ${measure.describe(run)}`,
  }))
  const best = frontier(points)
  const labels = placeLabels(points, box)

  const grid = [
    ...y.ticks.map(
      (v) => `
        <line class="grid" x1="${box.left}" x2="${box.right}" y1="${y.at(v)}" y2="${y.at(v)}" />
        <text class="tick" x="${box.left - 8}" y="${y.at(v) + 4}" text-anchor="end">${formatPoints(v)}</text>`,
    ),
    ...xTicks.map(
      (v) => `
        <line class="grid" x1="${x.at(v)}" x2="${x.at(v)}" y1="${box.top}" y2="${box.bottom}" />
        <text class="tick" x="${x.at(v)}" y="${box.bottom + 20}" text-anchor="middle">${escape(measure.tick(v))}</text>`,
    ),
  ]
  if (x.zeroColumn) {
    grid.push(`
      <line class="axis-break" x1="${x.zeroColumn.edge}" x2="${x.zeroColumn.edge}" y1="${box.top}" y2="${box.bottom}" />
      <text class="tick" x="${x.at(0)}" y="${box.bottom + 20}" text-anchor="middle">${escape(measure.zeroLabel)}</text>`)
  }
  const frontierPath =
    best.length > 1 ? `<path class="frontier" d="M${best[0].x} ${best[0].y}${best.slice(1).map((p) => ` H${p.x} V${p.y}`).join('')}" />` : ''
  const dots = points.map(
    (p) => `
      <a class="point harness-${escape(p.run.harness ?? 'unknown')}" href="#run=${encodeURIComponent(p.run.id)}" data-index="${p.index}"
        aria-label="${escape(`${p.run.model}. ${p.scoreText}. ${p.measureText}.`)}">
        <circle cx="${p.x}" cy="${p.y}" r="6" />
      </a>`,
  )
  const texts = [...labels].map(([p, at]) => `<text class="chart-label" x="${at.x}" y="${at.y}">${escape(p.label)}</text>`)
  const title = `${score.label} against ${measure.label.toLowerCase()}`
  const svg = `
    <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="group" aria-label="${escape(title)}">
      ${grid.join('')}
      <line class="axis" x1="${box.left}" x2="${box.right}" y1="${box.bottom}" y2="${box.bottom}" />
      ${frontierPath}
      ${texts.join('')}
      ${dots.join('')}
    </svg>`
  return { svg, points, frontier: best, missing: runs.filter((run) => !plotted.includes(run)) }
}

function keyHtml(chart, measure, runs) {
  const harnesses = [...new Set(runs.map((run) => run.harness ?? 'unknown'))]
  const items = harnesses.map((harness) => `<li><span class="dot harness-${escape(harness)}"></span>${escape(harness)}</li>`)
  if (chart.frontier.length > 1) items.push(`<li><span class="dash"></span>${escape(measure.frontier)}</li>`)
  const missing = chart.missing.length
    ? `<p>Not plotted: ${chart.missing.map((run) => escape(run.model)).join(', ')} (${escape(measure.missing)}).</p>`
    : ''
  return `<ul>${items.join('')}</ul><p>${escape(measure.note)} Select a point to open its run.</p>${missing}`
}

/** The runs, cheapest (or fastest, or leanest) first, that score higher than every run before them. */
function frontier(points) {
  const best = []
  for (const point of [...points].sort((a, b) => a.xValue - b.xValue || b.yValue - a.yValue)) {
    if (best.length === 0 || point.yValue > best.at(-1).yValue) best.push(point)
  }
  return best
}

function xAxis(measure, values, log, box) {
  const positive = values.filter((v) => v > 0)
  if (log && positive.length > 0) {
    // Log scales have no zero, so free runs get a column of their own left of the axis.
    const edge = positive.length < values.length ? box.left + ZERO_COLUMN : box.left
    const lo = Math.min(...positive) / 1.6
    const hi = Math.max(...positive) * 1.6
    const at = (v) => (v === 0 ? box.left + ZERO_COLUMN / 2 : edge + (Math.log(v / lo) / Math.log(hi / lo)) * (box.right - edge))
    return { at, ticks: measure.logTicks(lo, hi, tickBudget(box.right - edge)), zeroColumn: edge > box.left ? { edge } : null }
  }
  const top = Math.max(0, ...values) || 1
  const step = measure.linearStep(top, tickBudget(box.right - box.left))
  const hi = Math.ceil(top / step) * step
  return { at: (v) => box.left + (v / hi) * (box.right - box.left), ticks: steps(0, hi, step), zeroColumn: null }
}

function tickBudget(width) {
  return Math.max(2, Math.floor(width / TICK_SPACING))
}

/** The x ticks whose labels clear the one before them, and the zero column's label. */
function spacedTicks(x, measure) {
  const kept = []
  let lastRight = x.zeroColumn ? x.at(0) + textWidth(measure.zeroLabel, TICK_FONT) / 2 : -Infinity
  for (const v of x.ticks) {
    const half = textWidth(measure.tick(v), TICK_FONT) / 2
    if (x.at(v) - half < lastRight + 8) continue
    kept.push(v)
    lastRight = x.at(v) + half
  }
  return kept
}

/** Scores run from a little below the lowest one up to the category's maximum, in about seven ticks. */
function yAxis(values, max, box) {
  const floor = Math.max(0, Math.min(max, ...values) - max * 0.1)
  const dividing = SCORE_STEPS.filter((step) => Number.isInteger(round(max / step)))
  const tickCount = (step) => (max - Math.floor(floor / step) * step) / step + 1
  const step = (dividing.length ? dividing : SCORE_STEPS).reduce((a, b) => (Math.abs(tickCount(b) - 7) < Math.abs(tickCount(a) - 7) ? b : a))
  const lo = Math.floor(floor / step) * step
  return { at: (v) => box.bottom - ((v - lo) / (max - lo)) * (box.bottom - box.top), ticks: steps(lo, max, step) }
}

function placeLabels(points, box) {
  const taken = points.map((p) => ({ left: p.x - 7, right: p.x + 7, top: p.y - 7, bottom: p.y + 7 }))
  const placed = new Map()
  // Higher scores get the first pick of spots; a label with no free spot is left off, and its tooltip still names it.
  for (const point of [...points].sort((a, b) => b.yValue - a.yValue)) {
    const width = textWidth(point.label, LABEL_FONT)
    for (const [dx, dy, anchor] of LABEL_SPOTS) {
      let left = point.x + dx - { start: 0, middle: width / 2, end: width }[anchor]
      // A label straight above or below its point can slide sideways to stay in the plot and still sit over it.
      if (anchor === 'middle') left = Math.min(Math.max(left, box.left), box.right - width)
      const rect = { left, right: left + width, top: point.y + dy - 10, bottom: point.y + dy + 3 }
      const fits = rect.left >= box.left && rect.right <= box.right && rect.top >= 0 && rect.bottom <= box.bottom
      if (fits && !taken.some((other) => overlaps(other, rect))) {
        taken.push(rect)
        placed.set(point, { x: left, y: point.y + dy })
        break
      }
    }
  }
  return placed
}

function overlaps(a, b) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

let textContext
/** The width of `text` in the page's font, at a CSS font weight and size like `500 12px`. */
function textWidth(text, font) {
  textContext ??= document.createElement('canvas').getContext('2d')
  textContext.font = `${font} ${getComputedStyle(document.body).fontFamily}`
  return textContext.measureText(text).width
}

// Ticks

function niceStep(span, count) {
  const raw = span / count
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 5, 10].map((m) => m * magnitude).find((step) => step >= raw)
}

function steps(from, to, step) {
  const ticks = []
  for (let i = 0; from + i * step <= to + step * 1e-9; i++) ticks.push(round(from + i * step))
  return ticks
}

/** 1-2-5 ticks per decade, or 1-3, or only powers of ten, whichever first fits in `count`. */
function numericLogTicks(lo, hi, count) {
  const decades = (multiples) => {
    const ticks = []
    for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
      for (const m of multiples) ticks.push(round(m * 10 ** e))
    }
    return ticks.filter((v) => v >= lo && v <= hi)
  }
  return [[1, 2, 5], [1, 3]].map(decades).find((ticks) => ticks.length <= count) ?? decades([1])
}

function round(value) {
  return Number(value.toPrecision(12))
}

function usdTick(v) {
  if (v >= 1 || v === 0) return Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`
  return `$${v.toFixed(Math.max(2, -Math.floor(Math.log10(v))))}`
}

function durationTick(v) {
  return v < 3600 ? `${Math.round(v / 60)} min` : `${round(v / 3600)} h`
}

function tokenTick(v) {
  if (v >= 1e6) return `${round(v / 1e6)}M`
  if (v >= 1e3) return `${round(v / 1e3)}K`
  return String(v)
}
