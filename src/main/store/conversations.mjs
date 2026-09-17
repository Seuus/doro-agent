// 会话持久化：userData/conversations/<id>.json，每会话一文件（不依赖 Electron，可被脚本驱动）
// 关键防护：写队列串行化 + tmp/rename 原子写；删除用墓碑防止僵尸 run 把已删文件写回来
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import { join } from 'node:path'

const TITLE_MAX = 20
const TOOL_CONTENT_MAX = 8192

let baseDir = process.cwd()
// 写队列：所有保存/删除串行执行，动作（含序列化）在队列内跑，保证总是写最新内容
let chain = Promise.resolve()
// 墓碑：被删除的会话 id，晚到的保存直接跳过（防复活）
const tombstones = new Set()

export function setConversationsDir(dir) {
  baseDir = join(dir, 'conversations')
}

function filePath(id) {
  return join(baseDir, `${id}.json`)
}

export function newConversationId() {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

// 标题派生：首条用户消息，空白归一后截断（存盘，列表渲染零成本）
function deriveTitle(messages) {
  const first = messages.find((m) => m.role === 'user' && String(m.text || '').trim())
  if (!first) return '新对话'
  const text = String(first.text).replace(/\s+/g, ' ').trim()
  return text.length > TITLE_MAX ? text.slice(0, TITLE_MAX) + '…' : text
}

// 落盘用的消息清洗：丢空占位、status 不留 streaming、tool 结果带 toolCallId 可回放
function cleanMessages(messages) {
  return messages
    .filter((m) => {
      if (m.role === 'user') return true
      // 有正文/轨迹/工具结果才落盘；只有 toolCalls 的空壳（工具执行中）不落
      return Boolean(m.text || m.thoughts?.length || m.toolResults?.length)
    })
    .map((m) => {
      if (m.role === 'user') return { id: m.id, role: 'user', text: m.text, createdAt: m.createdAt }
      const out = {
        id: m.id,
        role: 'assistant',
        text: m.text || '',
        status: m.status && m.status !== 'streaming' ? m.status : 'done',
        createdAt: m.createdAt
      }
      if (m.toolCalls?.length) out.toolCalls = m.toolCalls
      if (m.thoughts?.length) out.thoughts = m.thoughts
      if (m.toolResults?.length) out.toolResults = m.toolResults
      return out
    })
}

function enqueue(task) {
  const next = chain.then(task, task) // 前序失败不阻断后续
  chain = next.catch(() => {})
  return next
}

async function writeFileAtomic(path, content) {
  const tmp = `${path}.tmp`
  try {
    await fs.writeFile(tmp, content, 'utf8')
    await fs.rename(tmp, path)
  } catch {
    // 杀毒软件偶发占用 tmp/rename 时降级直接写（极小概率部分写，可接受）
    await fs.writeFile(path, content, 'utf8').catch(() => {})
    await fs.unlink(tmp).catch(() => {})
  }
}

export function listConversations() {
  return (async () => {
    let names
    try {
      names = await fs.readdir(baseDir)
    } catch {
      return [] // 目录尚未创建，属正常路径
    }
    const out = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      try {
        const raw = await fs.readFile(join(baseDir, name), 'utf8')
        const data = JSON.parse(raw)
        out.push({
          id: data.id,
          title: data.title || '新对话',
          createdAt: data.createdAt || 0,
          updatedAt: data.updatedAt || data.createdAt || 0,
          messageCount: data.messages?.length || 0
        })
      } catch {
        // 单个文件损坏不影响整体列表
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt)
  })()
}

export async function loadConversation(id) {
  try {
    const raw = await fs.readFile(filePath(id), 'utf8')
    const data = JSON.parse(raw)
    return { id: data.id, createdAt: data.createdAt || Date.now(), messages: data.messages || [] }
  } catch {
    return null
  }
}

// 保存：队列内序列化（总是写调用时刻的最新内容）；墓碑 id 跳过；空内容不落盘
export function saveConversation(id, messages, { createdAt } = {}) {
  if (tombstones.has(id)) return Promise.resolve()
  const snapshot = [...messages] // 数组引用复制，内部对象后续原地更新也能带进队列
  return enqueue(async () => {
    if (tombstones.has(id)) return
    const cleaned = cleanMessages(snapshot)
    if (!cleaned.length) return // 空会话不落盘
    const data = {
      version: 1,
      id,
      title: deriveTitle(snapshot),
      createdAt: createdAt || Date.now(),
      updatedAt: Date.now(),
      messages: cleaned
    }
    await fs.mkdir(baseDir, { recursive: true }).catch(() => {})
    await writeFileAtomic(filePath(id), JSON.stringify(data))
  })
}

export function deleteConversation(id) {
  tombstones.add(id)
  return enqueue(() => fs.unlink(filePath(id)).catch(() => {}))
}

// 切换/读盘前调用：等所有挂起保存落完
export function flushSaves() {
  return chain.catch(() => {})
}

// 退出兜底（before-quit 里同步调用，进程不等 Promise）
export function saveSync(id, messages, { createdAt } = {}) {
  if (!id || tombstones.has(id)) return
  try {
    const cleaned = cleanMessages([...messages])
    if (!cleaned.length) return
    const data = {
      version: 1,
      id,
      title: deriveTitle(messages),
      createdAt: createdAt || Date.now(),
      updatedAt: Date.now(),
      messages: cleaned
    }
    fsSync.mkdirSync(baseDir, { recursive: true })
    fsSync.writeFileSync(filePath(id), JSON.stringify(data), 'utf8')
  } catch {
    // 退出兜底尽力而为
  }
}
