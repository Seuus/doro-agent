// 时间展示格式化：今天 18:53 / 昨天 18:53 / 09-13 18:36
const pad = (n) => String(n).padStart(2, '0')

export function formatTime(ms, now = new Date()) {
  if (!ms) return '—'
  const d = new Date(ms)
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ms >= todayStart) return `今天 ${clock}`
  if (ms >= todayStart - 24 * 3600 * 1000) return `昨天 ${clock}`
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock}`
}

// 只取时钟部分，用于「上次扫描 14:32」这类场景
export function formatClock(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
