// 通用登录判定：不依赖每游戏配置，用「登录特征词 + 否定词排除」的启发式找最新的登录行。
// 实测同一份规则可覆盖：终末地（enter LoginCallback / LoginStatus:2，行内带方括号时间）
// 与 NIKKE（[Rail] LoginResult / sdk Login Success，行内无时间 → 退回文件修改时间）。
import fs from 'node:fs/promises'
import { parseLogTimestamp } from './time-parser.mjs'
import { scanTailLines } from './tail-reader.mjs'

// 特征词覆盖常见中英日韩写法；否定词排除「未登录 / 登出 / 需要登录」这类反向噪音
const GENERIC_LOGIN_RE = /login|登录|登陆|ログイン|로그인/i
const GENERIC_NEGATIVE_RE = /not\s*log(in|ged)|log\s*(out|off)|sign\s*out|未登录|登录失败|登出|退出登录|needlogin/i

export async function findLastLoginGeneric(filePath) {
  const hit = await scanTailLines(filePath, (line, stat) => {
    if (!GENERIC_LOGIN_RE.test(line) || GENERIC_NEGATIVE_RE.test(line)) return undefined

    const ts = parseLogTimestamp(line, stat.mtimeMs)
    return {
      // 行内无时间戳时退回文件修改时间：对 NIKKE 这类 Unity 日志，mtime ≈ 本次会话结束时刻，
      // 仍能正确支撑「今天是否玩过」的判定，只是展示的「上次登录」会晚于真实登录几分钟
      lastLoginAt: ts ?? stat.mtimeMs,
      matchedBy: ts ? '通用登录特征' : '通用登录特征 / 时间取文件修改时间',
      line: line.trim().slice(0, 160)
    }
  })
  if (hit !== undefined) return hit

  const stat = await fs.stat(filePath) // 整段尾部都没有登录特征 → 用文件修改时间兜底
  return { lastLoginAt: stat.mtimeMs, matchedBy: '文件修改时间（未命中登录特征）' }
}
