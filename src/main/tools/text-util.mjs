// 查询归一化与匹配打分（从 FileSearchService.java v3 逐条移植，纯函数、零依赖）

export const LEAD_NOISE = [
  '帮我找找', '帮我找一下', '帮我搜索', '帮我查一下', '帮我搜一下', '帮我找', '帮我搜', '帮我查', '帮我',
  '请问一下', '我想找找', '我想找一下', '我想要找', '我要找', '我想找', '想要找', '想找', '我想要',
  '请你', '请', '搜一下', '查一下', '找找', '找一找', '搜索', '查找', '寻找', '搜', '查', '找'
]

export const TAIL_NOISE = [
  '在哪里啊', '在哪个位置', '在哪个目录', '在哪个文件夹', '在哪里', '在哪儿', '在哪个',
  '在哪', '哪儿', '哪里', '什么位置', '所在位置', '什么文件', '位置', '路径', '目录', '文件夹', '文件',
  '啊', '吧', '哦', '呀', '哈', '吗', '呢', '么', '了', '的'
]

export const DROP_TERMS = new Set([
  '游戏', '文件夹', '目录', '文件', '所在', '全部', '那个', '这个', '那个文件', '游戏文件',
  '软件', '程序', '应用', '电脑', '我的电脑', '这台电脑', '本地', '磁盘', '硬盘'
])

export const CJK_FILLER = new Set([
  '的', '了', '吗', '呢', '啊', '呀', '吧', '嘛', '哦', '哈', '哪', '里', '个', '些',
  '找', '查', '搜', '请', '我', '你', '他', '它', '在', '下', '用', '有', '是', '啥', '何'
])

const SPLIT_RE = /[\s,，、。;；:：!！?？"“”‘’()（）[\]【】{}<>《》/\\|_\-—–+*#@&…~`]+/
const UNIT_LATIN_RE = /^[a-z0-9]+$/

export function isLatinOrDigit(s) {
  return UNIT_LATIN_RE.test(s)
}

export function normalize(raw) {
  let s = String(raw ?? '').normalize('NFKC').toLowerCase().trim()
  let changed = true
  while (changed && s) {
    changed = false
    for (const n of LEAD_NOISE) {
      if (s.length > n.length && s.startsWith(n)) {
        s = s.slice(n.length).trim()
        changed = true
      }
    }
    for (const n of TAIL_NOISE) {
      if (s.length > n.length && s.endsWith(n)) {
        s = s.slice(0, s.length - n.length).trim()
        changed = true
      }
    }
  }
  return s
}

export function analyzeQuery(raw) {
  const s = normalize(raw)
  const kept = []
  if (s) {
    for (const part of s.split(SPLIT_RE)) {
      const p = part.trim()
      if (!p) continue
      if (DROP_TERMS.has(p)) continue
      if (p.length === 1 && CJK_FILLER.has(p)) continue
      if (isLatinOrDigit(p) && p.length < 2) continue
      if (!kept.includes(p)) kept.push(p)
    }
  }
  if (kept.length === 0 && s) kept.push(s)
  return kept
}

export function stemOf(lname) {
  const dot = lname.lastIndexOf('.')
  if (dot <= 0 || dot === lname.length - 1) return lname
  return lname.slice(0, dot)
}

export function dirsOf(lpath) {
  const segs = lpath.split(/[/\\]/)
  const dirs = []
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i]) dirs.push(segs[i])
  }
  return dirs
}

// 带界 Levenshtein：距离超过 limit 返回 -1（逐行移植 Java 版，含行最小值早退）
export function editDistance(a, b, limit) {
  const n = a.length
  const m = b.length
  if (Math.abs(n - m) > limit) return -1
  if (n === 0) return m <= limit ? m : -1
  if (m === 0) return n <= limit ? n : -1
  let prev = new Array(n + 1)
  let cur = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    let rowMin = Infinity
    for (let j = 1; j <= n; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1
      const v = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
      cur[j] = v
      if (v < rowMin) rowMin = v
    }
    if (rowMin > limit) return -1
    const t = prev
    prev = cur
    cur = t
  }
  return prev[n] <= limit ? prev[n] : -1
}
