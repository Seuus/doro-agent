// 反向分块读取日志尾部：从末尾向前扫，第一个命中的登录行即最后一次登录
import fs from 'node:fs/promises'
import { parseLogTimestamp } from './time-parser.mjs'

const CHUNK = 64 * 1024
const MAX_CHUNKS = 8 // 上限 512KB，避免在大文件上退化成整文件读入

// 从文件尾部向前分块遍历每一行（新 → 旧）。visit(line, stat) 返回 undefined 表示继续，
// 返回其它值（含 null）表示停止，并把该值原样作为 scanTailLines 的结果返回
export async function scanTailLines(filePath, visit) {
  const stat = await fs.stat(filePath)

  let end = stat.size
  let chunkIndex = 0
  const fh = await fs.open(filePath, 'r')
  try {
    while (end > 0 && chunkIndex < MAX_CHUNKS) {
      const start = Math.max(0, end - CHUNK)
      const len = end - start
      const buf = Buffer.allocUnsafe(len)
      await fh.read(buf, 0, len, start)

      // toString('utf8') 把非法字节替换为 U+FFFD 且永不抛错，日志里的 GBK 残留不影响 ASCII 结构判定
      const lines = buf.toString('utf8').split(/\r?\n/)
      if (start > 0) lines.shift() // 丢弃被截断的首行，避免半截行被误判

      for (let i = lines.length - 1; i >= 0; i--) {
        const result = visit(lines[i], stat)
        if (result !== undefined) return result
      }

      end = start
      chunkIndex++
    }
    return undefined
  } finally {
    await fh.close()
  }
}

export async function findLastLogin(filePath, loginRegexes) {
  let fallback = null // 命中了正则但行内没有可解析时间的兜底结果
  const hit = await scanTailLines(filePath, (line, stat) => {
    for (const re of loginRegexes) {
      if (!re.test(line)) continue
      const result = { lastLoginAt: parseLogTimestamp(line, stat.mtimeMs), matchedBy: re.source }
      if (result.lastLoginAt) return result // 最新一条带时间的命中即最后一次登录
      if (!fallback) fallback = result
      return undefined // 该行取不到时间，继续往前找带时间的命中
    }
    return undefined
  })
  return hit === undefined ? fallback : hit
}
