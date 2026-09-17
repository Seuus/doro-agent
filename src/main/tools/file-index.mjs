// 本地文件索引与 v3 搜索引擎（从旧 filesearch 服务 v3 算法移植，行为保持不变）
// 检索/匹配/选「最可能结果」全部在确定性代码里完成，返回精简结构；
// 索引在 Electron 主进程内存里，按需重扫，无任何常驻服务
import fs from 'node:fs/promises'
import { join } from 'node:path'
import { analyzeQuery, dirsOf, editDistance, isLatinOrDigit, stemOf } from './text-util.mjs'

export const SCAN_ROOTS = ['D:/', 'E:/']
const SKIP_DIRS = new Set([
  'windows', 'system32', 'syswow64', 'system', 'appdata', 'temp', 'tmp',
  'cache', 'caches', 'logs', '$recycle.bin', 'system volume information',
  'programdata', 'node_modules', '.git', '__pycache__', '.cache',
  '.venv', 'venv', '.gradle', '.idea', '.vscode', 'recovery',
  'windowsapps', 'wpsystem', 'deliveryoptimization', 'wudownloadcache'
])
const MAX_FUZZY_TARGET_LEN = 48
const MAX_RESULTS = 4

let snapshot = null // { entries: [{path}], scannedAt }
let scannedAt = 0
let building = null
export const STALE_MS = 60 * 60 * 1000

export function stats() {
  return { files: snapshot ? snapshot.entries.length : 0, scannedAt }
}

function shouldSkipDir(name) {
  return SKIP_DIRS.has(name.toLowerCase()) || name.startsWith('$') || name.startsWith('.')
}

// 广度优先遍历：显式队列 + 批量并发，避免 readdir(recursive) 的不可控遍历顺序与内存峰值
async function walk(root) {
  const entries = []
  const queue = [root]
  while (queue.length) {
    const batch = queue.splice(0, 16)
    const results = await Promise.all(
      batch.map(async (dir) => {
        try {
          return { dir, items: await fs.readdir(dir, { withFileTypes: true }) }
        } catch {
          return { dir, items: [] } // 权限不足/目录消失都只是跳过
        }
      })
    )
    for (const { dir, items } of results) {
      for (const it of items) {
        const full = join(dir, it.name)
        if (it.isDirectory()) {
          if (!shouldSkipDir(it.name)) queue.push(full)
        } else if (it.isFile()) {
          entries.push({ path: full })
        }
      }
    }
  }
  return entries
}

export async function buildSnapshot({ force = false } = {}) {
  if (!force && snapshot && Date.now() - scannedAt < STALE_MS) return snapshot
  if (building) return building
  building = (async () => {
    const started = Date.now()
    const all = []
    for (const root of SCAN_ROOTS) {
      try {
        await fs.access(root)
      } catch {
        continue // 该盘不存在（如本机无 D:），跳过
      }
      all.push(...(await walk(root)))
    }
    snapshot = { entries: all }
    scannedAt = Date.now()
    console.log(`[文件索引] 扫描完成：${all.length} 个文件，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`)
    return snapshot
  })().finally(() => {
    building = null
  })
  return building
}

export function getSnapshot() {
  return snapshot
}

export function invalidate() {
  scannedAt = 0
}

// ---------------- 打分（与 Java v3 逐条对应） ----------------

function tierFor(ent, unit, out) {
  const lname = ent.lname
  const stem = ent.stem
  const dirs = ent.dirs
  const lpath = ent.lpath
  const lastDir = dirs.length ? dirs[dirs.length - 1] : ''
  const targets = [lname, stem, lastDir, lpath]
  const kinds = [
    ['名同', '名首', '名称'],
    ['名同', '名首', '名称'],
    ['目同', '目首', '目录含'],
    ['路径同', '路径首', '路径含']
  ]
  const eqTiers = [900, 860, 800, 750]
  const preTiers = [700, 660, 620, 560]
  const conTiers = [500, 460, 430, 300]
  let best = 0
  let bestKind = ''
  const shortLatin = isLatinOrDigit(unit) && unit.length < 3
  for (let i = 0; i < targets.length; i++) {
    const hay = targets[i]
    if (!hay || (i === 1 && hay === lname)) continue
    let t = 0
    let k = ''
    if (hay === unit) {
      t = eqTiers[i]
      k = kinds[i][0]
    } else if (hay.startsWith(unit)) {
      t = preTiers[i]
      k = kinds[i][1]
    } else if (!shortLatin && hay.includes(unit)) {
      t = conTiers[i]
      k = kinds[i][2]
    } else {
      continue
    }
    if (t > best) {
      best = t
      bestKind = k
    }
  }
  // 祖先目录段（除末级目录外的任意层）
  if (dirs.length > 1) {
    for (let i = 0; i < dirs.length - 1; i++) {
      const d = dirs[i]
      let t = 0
      let k = ''
      if (d === unit) {
        t = 560
        k = '目录段同'
      } else if (d.startsWith(unit)) {
        t = 480
        k = '目录段首'
      } else if (d.includes(unit)) {
        t = 380
        k = '目录段含'
      } else {
        continue
      }
      if (t > best) {
        best = t
        bestKind = k
      }
    }
  }
  // 错字容错：对 名/stem/父目录/祖父目录 做有界编辑距离
  if (unit.length >= 5 || (unit.length >= 4 && !isLatinOrDigit(unit))) {
    const limit = unit.length >= 7 ? 2 : 1
    const fuzzyTargets = [lname, stem, lastDir, dirs.length >= 2 ? dirs[dirs.length - 2] : '']
    const fuzzyKinds = ['名近', '名近', '目录近', '上层近']
    for (let i = 0; i < fuzzyTargets.length; i++) {
      const tgt = fuzzyTargets[i]
      if (!tgt || (i === 1 && tgt === lname) || tgt.length > MAX_FUZZY_TARGET_LEN) continue
      const d = editDistance(tgt, unit, limit)
      if (d < 0) continue
      const t = d === 1 ? (i <= 1 ? 460 : i === 2 ? 440 : 430) : (i <= 1 ? 380 : i === 2 ? 360 : 350)
      if (t > best) {
        best = t
        bestKind = fuzzyKinds[i]
      }
    }
  }
  if (best > 0) out.kind = bestKind
  return best
}

function prepared(ent) {
  const lpath = ent.path.toLowerCase()
  const idx = ent.path.lastIndexOf('\\')
  const name = idx >= 0 ? ent.path.slice(idx + 1) : ent.path
  const lname = name.toLowerCase()
  return { path: ent.path, lpath, lname, stem: stemOf(lname), dirs: dirsOf(lpath) }
}

function scoreEntry(ent, terms) {
  let total = 0
  let matched = 0
  let maxTier = 0
  let anyLiteral = false
  const via = []
  for (const t of terms) {
    const out = { kind: '' }
    const tier = tierFor(ent, t, out)
    if (tier <= 0) continue
    total += tier
    matched++
    if (tier > maxTier) maxTier = tier
    if (!out.kind.includes('近')) anyLiteral = true
    via.push(`${t}·${out.kind}`)
  }
  if (total <= 0) return null
  // 多关键词必须全部命中，否则单个强命中的无关文件会顶掉正确答案
  if (terms.length >= 2 && matched < terms.length) return null
  const accept = anyLiteral || maxTier >= 430 || (matched >= 2 && total >= 700)
  if (!accept) return null
  return { total, via: via.join('、'), fuzzyHit: !anyLiteral }
}

// ---------------- 检索入口 ----------------

export function searchIndex(snap, query) {
  const terms = analyzeQuery(query)
  const scored = []
  for (const raw of snap.entries) {
    const ent = prepared(raw)
    const s = scoreEntry(ent, terms)
    if (s) scored.push({ ...s, ent })
  }
  scored.sort((a, b) => b.total - a.total || a.ent.lname.length - b.ent.lname.length || (a.ent.path < b.ent.path ? -1 : 1))
  scored.length = Math.min(scored.length, MAX_RESULTS + 2)
  return { terms, hits: scored }
}

export function formatSearchResult({ terms, hits }) {
  const best = hits.length ? hits[0] : null
  const out = {
    status: !best ? 'none' : best.fuzzyHit ? 'fuzzy' : 'direct',
    keywords: terms,
    best: best ? { name: nameOf(best.ent), path: best.ent.path, score: best.total, via: best.via } : null,
    alternates: []
  }
  if (best) {
    const floor = best.total * 0.55
    for (let i = 1; i < hits.length && out.alternates.length < MAX_RESULTS - 1; i++) {
      const s = hits[i]
      if (s.total < floor || s.ent.path === best.ent.path) continue
      // 与 best 因完全相同理由命中的备选不提供额外信息
      if (s.via && s.via === best.via) continue
      out.alternates.push({ name: nameOf(s.ent), path: s.ent.path })
    }
  }
  return out
}

function nameOf(ent) {
  const idx = ent.path.lastIndexOf('\\')
  return idx >= 0 ? ent.path.slice(idx + 1) : ent.path
}
