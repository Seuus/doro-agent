// 游戏日志扫描调试合集（纯 Node，不依赖 Electron、不依赖 node_modules）：
//   scan                        跑一遍全部游戏扫描并打印结果
//   login <日志文件>            对指定日志文件跑通用登录判定，打印命中行与今日状态
//   icon <exe路径 或 日志文件> [游戏名]
//                               提取 exe 内嵌图标；给日志文件时先自动查找游戏本体 exe
// 用法：npm run games:debug -- <子命令> [参数]
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { judgeTodayStatus, scanAllGames } from '../src/shared/games/scanner.mjs'
import { findLastLoginGeneric } from '../src/shared/games/generic-login.mjs'
import { findGameExe } from '../src/shared/games/exe-finder.mjs'
import { extractExeIconPng } from '../src/shared/games/exe-icon.mjs'

const format = (ms) => (ms ? new Date(ms).toLocaleString('zh-CN', { hour12: false }) : '解析失败')
const cmd = process.argv[2]

if (cmd === 'scan') {
  const { games, scannedAt } = await scanAllGames()
  console.log(`扫描时间：${format(scannedAt)}`)
  console.log(`命中游戏：${games.length} 个\n`)

  for (const g of games) {
    console.log(`${g.name}（${g.vendor}）`)
    console.log(`  状态      ：${g.status}`)
    console.log(`  最后登录  ：${format(g.lastLoginAt)}`)
    console.log(`  命中日志  ：${g.logPath}`)
    console.log(`  命中规则  ：${g.matchedBy}`)
    console.log('')
  }
} else if (cmd === 'login') {
  const file = process.argv[3]
  if (!file) {
    console.log('用法: npm run games:debug -- login <日志文件路径>')
    process.exit(1)
  }

  const STATUS_LABEL = { done: '已完成', todo: '未完成', unknown: '未知' }
  try {
    const hit = await findLastLoginGeneric(file)
    console.log(`文件：${file}`)
    console.log(`命中规则：${hit.matchedBy}`)
    if (hit.line) console.log(`命中行：${hit.line}`)
    console.log(`最后登录：${hit.lastLoginAt ? new Date(hit.lastLoginAt).toLocaleString('zh-CN') : '—'}`)
    console.log(`今日状态：${STATUS_LABEL[judgeTodayStatus(hit.lastLoginAt)]}`)
  } catch (err) {
    console.error(`判定失败：${err.message}`)
    process.exit(1)
  }
} else if (cmd === 'icon') {
  const target = process.argv[3]
  const gameName = process.argv[4] || ''
  if (!target) {
    console.log('用法: npm run games:debug -- icon <exe路径 或 日志文件路径> [游戏名]')
    process.exit(1)
  }

  let exePath = target
  if (!/\.exe$/i.test(target)) {
    exePath = await findGameExe({ name: gameName, logPath: target })
    console.log(`自动查找 exe：${exePath || '未找到'}`)
    if (!exePath) process.exit(1)
  }

  const icon = extractExeIconPng(exePath)
  if (!icon) {
    console.log(`未从 exe 提取到图标资源：${exePath}`)
    process.exit(1)
  }

  const out = join(tmpdir(), 'doro-icon-debug.png')
  await fs.writeFile(out, icon.png)
  console.log(`提取成功：${icon.width}x${icon.height} → ${out}`)
} else {
  console.log('用法: npm run games:debug -- <scan|login|icon> [参数]')
  console.log('  scan                     扫描全部游戏日志')
  console.log('  login <日志文件>          通用登录判定验证')
  console.log('  icon <exe或日志> [游戏名]  图标提取验证')
  process.exit(cmd ? 1 : 0)
}
