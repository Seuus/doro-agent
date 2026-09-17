// 文件读取与内容检索工具：全部带硬上限，只读
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import { join } from 'node:path'

export const READ_DEFAULT_LIMIT = 2000
export const READ_MAX_LIMIT = 5000
export const READ_MAX_LINE_LEN = 2000

function decodeText(buf) {
  return new TextDecoder('utf-8', { fatal: false }).decode(buf)
}

async function readSlice(filePath, start, end) {
  const out = []
  let lineNo = 0
  const stream = createReadStream(filePath, { encoding: 'utf8' })
  try {
    for await (const line of readLines(stream)) {
      lineNo++
      if (lineNo >= start && lineNo <= end) out.push(line)
      if (lineNo >= end) break
    }
  } finally {
    stream.destroy()
  }
  return { lines: out, lastLine: lineNo }
}

// 异步逐行迭代器：兼容 \n / \r\n，最后一行无换行也能吐出
async function* readLines(stream) {
  let buf = ''
  for await (const chunk of stream) {
    buf += chunk
    let idx
    while ((idx = buf.indexOf('\n')) !== -1) {
      let line = buf.slice(0, idx)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      yield line
      buf = buf.slice(idx + 1)
    }
  }
  if (buf) yield buf.endsWith('\r') ? buf.slice(0, -1) : buf
}

export async function readFileTool({ path, start = 1, limit }) {
  const filePath = String(path || '').trim()
  if (!filePath) return { error: '缺少 path 参数' }
  const from = Math.max(1, Number(start) || 1)
  const take = Math.min(Number(limit) || READ_DEFAULT_LIMIT, READ_MAX_LIMIT)

  let stat
  try {
    stat = await fs.stat(filePath)
  } catch (err) {
    return { error: `无法读取文件：${err.code === 'ENOENT' ? '文件不存在' : err.message}` }
  }
  if (!stat.isFile()) return { error: 'path 不是文件' }

  // 头 8KB 找 NUL 字节判定二进制（与常见 grep/编辑器策略一致）
  const headFd = await fs.open(filePath, 'r')
  const head = Buffer.alloc(Math.min(8192, stat.size))
  await headFd.read(head, 0, head.length, 0)
  await headFd.close()
  if (head.includes(0)) return { error: '这是二进制文件，无法按文本读取' }

  const { lines, lastLine } = await readSlice(filePath, from, from + take - 1)
  const truncatedLines = []
  let anyTruncated = false
  for (const line of lines) {
    if (line.length > READ_MAX_LINE_LEN) {
      truncatedLines.push(line.slice(0, READ_MAX_LINE_LEN))
      anyTruncated = true
    } else {
      truncatedLines.push(line)
    }
  }
  const hasMore = lastLine > from + take - 1 || lines.length === take
  return {
    path: filePath,
    totalBytes: stat.size,
    startLine: from,
    lines: truncatedLines.map((text, i) => `${from + i}\t${text}`).join('\n'),
    truncated: anyTruncated || hasMore,
    note: hasMore
      ? `已显示第 ${from}~${from + truncatedLines.length} 行（单行超 ${READ_MAX_LINE_LEN} 字符会截断）；需要后续内容用 start=${from + truncatedLines.length} 继续`
      : undefined
  }
}

// 极简 glob：** 跨目录、* 单层、? 单字符；不引入 glob 依赖
function globToRegex(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*'
      i++
    } else if (c === '*') {
      re += '[^\\\\/]*'
    } else if (c === '?') {
      re += '[^\\\\/]'
    } else if ('\\^$.|+()[]{}'.includes(c)) {
      re += '\\' + c
    } else {
      re += c
    }
  }
  return new RegExp(`^${re}$`, 'i')
}

async function collectFiles(dir, { glob, maxFiles }) {
  const matcher = glob ? globToRegex(glob) : null
  const baseName = String(dir).split(/[/\\]/).filter(Boolean).pop() || ''
  const out = []
  const queue = [dir]
  while (queue.length && out.length < maxFiles * 4) {
    const batch = queue.splice(0, 16)
    const results = await Promise.all(
      batch.map(async (d) => {
        try {
          return { d, items: await fs.readdir(d, { withFileTypes: true }) }
        } catch {
          return { d, items: [] }
        }
      })
    )
    for (const { d, items } of results) {
      for (const it of items) {
        const full = join(d, it.name)
        if (it.isDirectory()) {
          if (!it.name.startsWith('.') && it.name !== 'node_modules') queue.push(full)
        } else if (it.isFile()) {
          if (!matcher) {
            out.push(full)
          } else {
            // glob 相对 dir 匹配（去掉 dir 前缀），同时允许只匹配文件名
            const rel = full.slice(dir.length).replace(/^[/\\]/, '')
            if (matcher.test(rel) || matcher.test(it.name) || matcher.test(`${baseName}/${rel}`)) out.push(full)
          }
          if (out.length >= maxFiles * 4) return out
        }
      }
    }
  }
  return out
}

const CONTENT_MAX_LINES = 120
const CONTENT_MAX_LINE_LEN = 300

export async function grepTool({ pattern, dir, glob, mode = 'files', maxResults = 50 }) {
  const pat = String(pattern || '')
  if (!pat) return { error: '缺少 pattern 参数' }
  const root = String(dir || '').trim()
  if (!root) return { error: '缺少 dir 参数：请先用 dorosearch 找到文件所在目录' }

  let re
  try {
    re = new RegExp(pat, 'i')
  } catch {
    re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  }

  let files
  try {
    files = await collectFiles(root, { glob, maxFiles: Math.max(1, Number(maxResults) || 50) })
  } catch (err) {
    return { error: `扫描目录失败：${err.message}` }
  }

  const fileMatches = []
  const contentHits = []
  let truncatedFiles = false

  for (const f of files) {
    let stat
    try {
      stat = await fs.stat(f)
    } catch {
      continue
    }
    if (stat.size > 64 * 1024 * 1024) continue // 超大文件跳过，日志不会这么大

    let content
    try {
      const buf = await fs.readFile(f)
      if (buf.subarray(0, 8192).includes(0)) continue // 二进制跳过
      content = decodeText(buf)
    } catch {
      continue
    }

    const lines = content.split(/\r?\n/)
    let count = 0
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue
      count++
      if (mode === 'content' && contentHits.length < CONTENT_MAX_LINES) {
        const text = lines[i].length > CONTENT_MAX_LINE_LEN ? lines[i].slice(0, CONTENT_MAX_LINE_LEN) + '…' : lines[i]
        contentHits.push(`${f}:${i + 1}\t${text}`)
      }
    }
    if (count > 0) {
      if (fileMatches.length < Number(maxResults)) {
        fileMatches.push({ file: f, matches: count })
      } else {
        truncatedFiles = true
      }
    }
  }

  if (mode === 'content') {
    return {
      pattern: pat,
      root,
      filesMatched: fileMatches.length,
      hits: contentHits,
      truncated: contentHits.length >= CONTENT_MAX_LINES || truncatedFiles,
      note: contentHits.length >= CONTENT_MAX_LINES ? `命中过多，已截断到前 ${CONTENT_MAX_LINES} 行，请细化 pattern` : undefined
    }
  }
  return { pattern: pat, root, files: fileMatches, truncated: truncatedFiles }
}
