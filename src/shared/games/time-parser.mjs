// 日志时间戳解析，按优先级依次尝试三种格式：
// 1) 方括号格式（游戏 SDK / 启动器日志），实测同一文件内会出现三种形态：
//    [2026-09-14 18:53:06.589]  有年 + 点号毫秒（新 SDK / hg 日志全程）
//    [2026-09-01 21:26:45:181]  有年 + 冒号毫秒（旧版 SDK 2.29.2.0）
//    [09-02 20:35:51.533]       无年 + 点号毫秒（新 SDK 2.30.3.0 起、启动器日志）
// 2) ISO 格式：timestamp = 2026-09-15T20:20:23.7725964+08:00（NIKKE 等 Unity 日志）
// 3) 斜杠格式：RequestCheckPingAsync Begin:2026/9/15 20:20:51（NIKKE 等 Unity 日志，月/日可能一位数）
const BRACKET_RE = /\[(\d{4}-)?(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})[.:](\d{3})\]/
const ISO_RE = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/
const SLASH_RE = /(\d{4})\/(\d{1,2})\/(\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})/

function fromParts([, y, mo, d, h, mi, s]) {
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)).getTime()
}

// anchorMs 传所在文件的 mtime：无年份时用它推断年份，比用系统当前时间更稳，能正确处理跨年旧日志
export function parseLogTimestamp(line, anchorMs) {
  let m = BRACKET_RE.exec(line)
  if (m) {
    const [, yearPart, month, day, hour, minute, second, ms] = m

    let year
    if (yearPart) {
      year = Number(yearPart.slice(0, 4))
    } else {
      const anchor = new Date(anchorMs)
      year = anchor.getFullYear()
      // 日志里的月份比文件修改月份还大 → 该行是去年的旧日志
      if (Number(month) > anchor.getMonth() + 1) year -= 1
    }

    return new Date(
      year, Number(month) - 1, Number(day),
      Number(hour), Number(minute), Number(second), Number(ms)
    ).getTime()
  }

  m = ISO_RE.exec(line)
  if (m) return fromParts(m)

  m = SLASH_RE.exec(line)
  if (m) return fromParts(m)

  return null
}
