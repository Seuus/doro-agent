// 在本机查找游戏本体 exe（纯逻辑、可 node 直跑）：给自动扫描的游戏补图标用。
// 思路：从游戏名与日志路径里提取线索词，在每块盘符的浅层目录里找名字含线索词的目录，
// 目录内优先取名字含线索词的 exe，取不到就取排除卸载/崩溃处理后的最大 exe。
import fs from 'node:fs/promises'
import { join } from 'node:path'

// 相对盘符根的目录模式，按置信度从高到低：厂商启动器 > WeGame > Steam > Program Files > 通用两层
const SEARCH_PATTERNS = [
  ['*', 'games', '*'],
  ['Games', '*'],
  ['*', 'rail_apps', '*'],
  ['*', 'steamapps', 'common', '*'],
  ['Program Files', '*', '*'],
  ['Program Files (x86)', '*', '*'],
  ['*', '*']
]

const SKIP_TOP = new Set(['windows', 'programdata', '$recycle.bin', 'system volume information', 'recovery', 'perflogs'])

// 太通用的目录名不能当线索词，否则会误匹配大量无关目录
const TOKEN_STOP = new Set([
  'locallow', 'local', 'roaming', 'appdata', 'userprofile', 'users',
  'logs', 'log', 'sdklogs', 'cache', 'saved', 'saved games', 'userdata', 'temp',
  'com.tencent', 'com_tencent', 'unity'
])

// 明显不是游戏本体的 exe（卸载器、崩溃处理器、运行库…）
const BAD_EXE_RE = /unins|卸载|crashhandler|redist|setup|vcredist|dxsetup|report/i

function isCjk(text) {
  return /[一-鿿]/.test(text)
}

// 线索词：游戏名的分词 + 日志路径上的目录名（中文 2 字即可，英文至少 3 字防误匹配）
export function deriveTokens(name, logPath) {
  const tokens = new Set()
  const add = (raw) => {
    const t = String(raw || '').trim().toLowerCase()
    if (!t || TOKEN_STOP.has(t)) return
    if (t.length < (isCjk(t) ? 2 : 3)) return
    tokens.add(t)
  }
  for (const part of String(name || '').split(/[：:、,，/|（）()【】\[\]\s·—-]+/)) add(part)
  if (logPath) {
    for (const part of String(logPath).split(/[\\/]/).slice(0, -1)) add(part) // 去掉文件名
  }
  return [...tokens]
}

async function listDirs(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

async function listFixedDrives() {
  const drives = []
  for (let c = 0x43; c <= 0x5a; c++) {
    const root = `${String.fromCharCode(c)}:\\`
    try {
      await fs.access(root)
      drives.push(root)
    } catch {
      // 不存在的盘符直接跳过
    }
  }
  return drives
}

// 把 [盘符, 段, 段…] 模式展开成具体目录列表；'*' 只匹配一层，不做递归
async function expandPattern(driveRoot, segments) {
  let dirs = [driveRoot]
  for (const seg of segments) {
    const next = []
    for (const d of dirs) {
      const names = await listDirs(d)
      if (seg === '*') {
        for (const n of names) {
          if (d === driveRoot && SKIP_TOP.has(n.toLowerCase())) continue
          next.push(join(d, n))
        }
      } else {
        const hit = names.find((n) => n.toLowerCase() === seg.toLowerCase())
        if (hit) next.push(join(d, hit))
      }
    }
    dirs = next
    if (!dirs.length) return []
  }
  return dirs
}

// 目录内挑游戏本体 exe：先排除明显不是的，再优先名字含线索词的，最后取最大的
async function pickExe(dirPath, tokens) {
  let entries
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true })
  } catch {
    return null
  }
  const usable = []
  for (const e of entries) {
    if (!e.isFile() || !e.name.toLowerCase().endsWith('.exe')) continue
    if (BAD_EXE_RE.test(e.name)) continue
    try {
      const stat = await fs.stat(join(dirPath, e.name))
      usable.push({ name: e.name, path: join(dirPath, e.name), size: stat.size })
    } catch {
      // 读不到大小的跳过
    }
  }
  if (!usable.length) return null

  const named = usable.filter((e) => tokens.some((t) => e.name.toLowerCase().includes(t)))
  const pool = named.length ? named : usable
  pool.sort((a, b) => b.size - a.size)
  return pool[0].path
}

// 找到返回 exe 绝对路径，找不到返回 null
export async function findGameExe({ name, logPath }) {
  const tokens = deriveTokens(name, logPath)
  if (!tokens.length) return null

  for (const drive of await listFixedDrives()) {
    for (const pattern of SEARCH_PATTERNS) {
      for (const dir of await expandPattern(drive, pattern)) {
        const dirName = dir.split(/[\\/]/).pop().toLowerCase()
        if (!tokens.some((t) => dirName.includes(t))) continue
        const exe = await pickExe(dir, tokens)
        if (exe) return exe
      }
    }
  }
  return null
}
