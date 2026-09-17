// 扫描编排：遍历配置表 → 定位日志文件 → 取最后登录时间 → 判定今日状态；
// 另接手动添加的条目（用户指定日志文件，走通用登录判定）
import fs from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { GAME_CONFIGS } from './game-configs.mjs'
import { findLastLogin } from './tail-reader.mjs'
import { findLastLoginGeneric } from './generic-login.mjs'

// 手动条目图标的扩展名白名单（ipc.mjs 拷贝图标时也用它做校验）
export const IMAGE_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  ico: 'image/x-icon',
  bmp: 'image/bmp'
}

// 展开配置表里的 %USERPROFILE% / %LOCALAPPDATA% 占位符；未识别的原样保留，
// 后续存在性检查自然失败 → 该条静默跳过
const ENV_MAP = {
  USERPROFILE: process.env.USERPROFILE || homedir(),
  LOCALAPPDATA: process.env.LOCALAPPDATA || ''
}

export function expandEnvPlaceholders(path) {
  return path.replace(/%([^%]+)%/g, (raw, name) => ENV_MAP[name.toUpperCase()] || raw)
}

// 今日任务状态判定（纯函数）：只做登录时间启发式。
// 日常凌晨 4 点刷新：当前「日常日」= 最近一次凌晨 4 点起的 24 小时，
// 最后登录时间 >= 该起点即视为已完成；凌晨 4 点前仍算前一天，已完成的不会提前翻成未完成
const DAILY_RESET_HOUR = 4

export function judgeTodayStatus(lastLoginAt, now = new Date()) {
  if (!lastLoginAt) return 'unknown' // 日志存在但解析不出登录时间
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), DAILY_RESET_HOUR).getTime()
  const boundary = now.getTime() >= dayStart ? dayStart : dayStart - 24 * 60 * 60 * 1000
  return lastLoginAt >= boundary ? 'done' : 'todo'
}

async function isFile(path) {
  try {
    const stat = await fs.stat(path)
    return stat.isFile()
  } catch {
    return false
  }
}

// 单游戏内保持顺序（目录按序、文件名按序），命中即止；三层全走空则该游戏不产出条目
async function scanGame(config, now) {
  for (const rawDir of config.dirs) {
    const dir = expandEnvPlaceholders(rawDir)
    for (const file of config.files) {
      const logPath = join(dir, file)
      if (!(await isFile(logPath))) continue

      // useGeneric：该游戏的日志没有可靠的行内时间，走通用登录判定（找不到特征时以文件修改时间兜底）
      const hit = config.useGeneric
        ? await findLastLoginGeneric(logPath)
        : await findLastLogin(logPath, config.loginRegexes)
      if (!hit) continue

      return {
        id: config.id,
        name: config.name,
        vendor: config.vendor,
        status: judgeTodayStatus(hit.lastLoginAt, now),
        lastLoginAt: hit.lastLoginAt,
        logPath,
        matchedBy: hit.matchedBy
      }
    }
  }
  return null
}

// 手动条目：日志文件由用户指定，判定走通用规则；文件丢失时仍展示并标为未知，提醒用户修正
async function scanManualGame(entry, now) {
  let lastLoginAt = null
  let matchedBy = '文件不存在'
  try {
    const hit = await findLastLoginGeneric(entry.filePath)
    lastLoginAt = hit.lastLoginAt
    matchedBy = hit.matchedBy
  } catch (err) {
    if (err.code !== 'ENOENT') matchedBy = '读取失败'
    console.warn(`[scanner] 手动条目「${entry.name}」读取失败：${err.message}`)
  }

  return {
    id: entry.id,
    name: entry.name,
    vendor: entry.vendor || '手动添加',
    status: judgeTodayStatus(lastLoginAt, now),
    lastLoginAt,
    logPath: entry.filePath,
    matchedBy,
    manual: true,
    iconDataUrl: await readImageDataUrl(entry.iconAbsPath)
  }
}

// 自定义图标随扫描读成 data URL 下发：渲染进程处于沙箱中，无法直接读 userData 下的文件
async function readImageDataUrl(filePath) {
  if (!filePath) return null
  const mime = IMAGE_MIME[filePath.split('.').pop().toLowerCase()]
  if (!mime) return null
  try {
    const buf = await fs.readFile(filePath)
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null // 图标被删/损坏不影响卡片本身
  }
}

export async function scanAllGames(now = new Date(), manualGames = []) {
  // 各游戏并行；单个游戏出错只让它自己降级为不展示，绝不中断整体扫描
  const [autoResults, manualResults] = await Promise.all([
    Promise.all(
      GAME_CONFIGS.map(async (config) => {
        try {
          return await scanGame(config, now)
        } catch (err) {
          console.warn(`[scanner] ${config.name} 扫描失败：${err.message}`)
          return null
        }
      })
    ),
    Promise.all(manualGames.map((entry) => scanManualGame(entry, now)))
  ])

  return {
    scannedAt: Date.now(),
    games: [...autoResults.filter(Boolean), ...manualResults]
  }
}
