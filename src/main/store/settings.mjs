// 轻量设置读写核心：不依赖 Electron，路径由入口注入（便于脚本/测试直接驱动）
import fs from 'node:fs/promises'
import { join } from 'node:path'

const DEFAULTS = {
  useMock: false,
  model: { baseUrl: 'https://api.deepseek.com/v1', apiKey: '', model: 'deepseek-chat' },
  manualGames: [],
  hiddenGames: []
}

let baseDir = process.cwd()
let cache = null

export function setStoreDir(dir) {
  baseDir = dir
  cache = null
}

function filePath() {
  return join(baseDir, 'settings.json')
}

export async function readSettings() {
  if (cache) return cache
  try {
    const raw = await fs.readFile(filePath(), 'utf8')
    cache = { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    cache = { ...DEFAULTS } // 首次运行没有文件，属正常路径
  }
  return cache
}

export async function updateSettings(patch) {
  const next = { ...(await readSettings()), ...patch }
  cache = next
  await fs.writeFile(filePath(), JSON.stringify(next, null, 2), 'utf8')
  return next
}
