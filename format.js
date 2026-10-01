// Formatting shared by the leaderboard, the run details and the chart.

export function shortName(area) {
  return area.split(/[:,]| and /)[0].trim()
}

export function formatPoints(points) {
  return Number.isInteger(points) ? String(points) : points.toFixed(1)
}

export function formatDuration(totalSeconds) {
  const s = Math.round(totalSeconds)
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  return hours ? `${hours} h ${minutes} min` : `${minutes} min ${s % 60} s`
}

export function formatTokens(count) {
  if (count >= 1e6) return `${(count / 1e6).toFixed(1)}M`
  if (count >= 1e3) return `${Math.round(count / 1e3)}K`
  return String(count)
}

export function formatUsd(amount) {
  if (amount === 0) return '$0'
  return amount >= 1 ? `$${amount.toFixed(2)}` : `$${amount.toFixed(amount >= 0.01 ? 3 : 4)}`
}

export function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function escape(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
}
