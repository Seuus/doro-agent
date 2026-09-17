// 对话门面：mock/本地 agent 分流、会话管理（多会话切换）、统一事件出口
// 大脑在主进程内：对话经 doro/loop.mjs 直连模型 API，工具在本地执行，不再依赖任何外部服务
// 会话持久化：activeConversation 落盘 userData/conversations/，重开应用开新会话，旧会话可切回
//
// 核心不变量（改动前先想清楚，破坏它会静默损坏用户数据）：
//   1. conversation 变量只在 switch/new/delete/reset 时整体替换；
//   2. run() 启动时捕获 conv 引用，保存一律绑定 (conv.id, conv.messages)——
//      这样僵尸 run（dororun 可跑几十分钟，不吃 abort）晚到的保存只会写回它自己的会话文件
//      （切走瞬间的部分回答得以保留），绝不会污染切换后的新会话；
//   3. 删除/清空的会话会进墓碑，保存自动跳过，防止僵尸把已删文件写回来。
import { randomUUID } from 'node:crypto'
import { readSettings } from '../store/settings.mjs'
import * as convStore from '../store/conversations.mjs'
import { runAgent } from './loop.mjs'
import { initTools } from '../tools/index.mjs'
import { streamChat as streamMock } from './mock.mjs'

const SAVE_THROTTLE_MS = 2000
const SWITCH_ABORT_WAIT_MS = 600

let emitEvent = () => {}
let conversation = { id: convStore.newConversationId(), createdAt: Date.now(), messages: [] }
let active = null // { requestId, controller, promise }
let switching = null // 切换操作的串行链，send 等操作需先排队
let openingStatement = null

// 历史 → 模型消息：展开 assistant 轮次的 toolCalls 与对应 tool 响应（OpenAI 协议要求成对）
function historyToMessages() {
  const out = []
  for (const m of conversation.messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.text })
    } else if (m.role === 'assistant' && (m.text || m.toolCalls?.length)) {
      out.push({ role: 'assistant', content: m.text || null, toolCalls: m.toolCalls || undefined })
      for (const t of m.toolResults || []) {
        if (t.toolCallId) out.push({ role: 'tool', toolCallId: t.toolCallId, content: t.content || '' })
      }
    }
  }
  return out
}

export function initChatService(onEvent, { appPath } = {}) {
  emitEvent = onEvent
  initTools({ appPath })
  if (appPath) convStore.setConversationsDir(appPath)
}

export function getHistory() {
  return conversation.messages
}

export function hasConversation() {
  return conversation.messages.length > 0
}

export function getCurrentConversationId() {
  return conversation.id
}

export function getOpeningStatement() {
  if (openingStatement === null) openingStatement = DEFAULT_OPENING
  return openingStatement
}

const DEFAULT_OPENING = 'doro？'

export function invalidateOpeningStatement() {
  openingStatement = null
}

// --- 会话管理 ---

export async function listConversations() {
  return convStore.listConversations()
}

// 切到目标会话：abort → 有界等待 → 强制保存当前 → 读盘 → 整体替换
export async function switchConversation(id) {
  const run = async () => {
    if (id === conversation.id) {
      return { ok: true, conversationId: conversation.id, messages: conversation.messages }
    }
    if (active) {
      const a = active
      a.controller.abort()
      await Promise.race([a.promise.catch(() => {}), new Promise((r) => setTimeout(r, SWITCH_ABORT_WAIT_MS))])
    }
    await convStore.flushSaves()
    await convStore.saveConversation(conversation.id, conversation.messages, { createdAt: conversation.createdAt })
    const file = await convStore.loadConversation(id)
    const from = conversation.id
    if (file) {
      conversation = { id: file.id, createdAt: file.createdAt, messages: file.messages }
    } else {
      conversation = { id, createdAt: Date.now(), messages: [] } // 目标文件不存在：按新空会话处理
    }
    console.log(`[会话] ${from} → ${conversation.id}`)
    return { ok: true, conversationId: conversation.id, messages: conversation.messages }
  }
  switching = (switching || Promise.resolve()).then(run, run)
  return switching
}

export async function newConversation() {
  if (active) {
    const a = active
    a.controller.abort()
    await Promise.race([a.promise.catch(() => {}), new Promise((r) => setTimeout(r, SWITCH_ABORT_WAIT_MS))])
  }
  await convStore.saveConversation(conversation.id, conversation.messages, { createdAt: conversation.createdAt })
  conversation = { id: convStore.newConversationId(), createdAt: Date.now(), messages: [] }
  return { ok: true, conversationId: conversation.id, messages: conversation.messages }
}

export async function deleteConversation(id) {
  const wasCurrent = id === conversation.id
  if (wasCurrent && active) {
    const a = active
    a.controller.abort()
    await Promise.race([a.promise.catch(() => {}), new Promise((r) => setTimeout(r, SWITCH_ABORT_WAIT_MS))])
  }
  await convStore.deleteConversation(id)
  if (!wasCurrent) return { ok: true, conversationId: conversation.id, messages: conversation.messages }
  // 删除当前会话：换新 id（绝不复用旧 id，否则墓碑会永久静默同名保存）
  conversation = { id: convStore.newConversationId(), createdAt: Date.now(), messages: [] }
  return { ok: true, conversationId: conversation.id, messages: conversation.messages }
}

export async function reset() {
  // 语义：清空当前会话（删其文件），界面回到新会话
  const res = await deleteConversation(conversation.id)
  return res
}

// 退出兜底：同步落盘当前会话（before-quit 用）
export function flushChatSync() {
  if (conversation.messages.length) {
    convStore.saveSync(conversation.id, conversation.messages, { createdAt: conversation.createdAt })
  }
}

// --- 对话 ---

export async function send(query) {
  if (switching) await switching // 切换进行中先排队，避免消息 push 进将要被替换的会话
  if (active) await stop(active.requestId)

  const requestId = randomUUID()
  const controller = new AbortController()
  const settings = await readSettings()
  const useMock = process.env.DORO_MOCK === '1' || settings.useMock === true

  conversation.messages.push({ id: `u-${requestId}`, role: 'user', text: query, createdAt: Date.now() })
  const promise = run({ requestId, controller, query, useMock })
  active = { requestId, controller, promise }

  emitEvent({ requestId, type: 'start' })
  return requestId
}

// 段落分界哨兵：空行在归一化时被替换成它（U+E000 私有区，正常文本不会出现）
// 哨兵只是处理中间态：只活在 raw 缓冲里，绝不允许进入 assistant.text / 落盘 / 渲染事件
const SPLIT_MARK = '\uE000'

// 气泡可见文本 = raw 的最近一个哨兵之后的部分（前面的段已切走）
// 清掉残留哨兵（多个空行连用时哨兵会叠加）、折叠空白（含单个换行→空格）
function maskToBubbleText(raw) {
  const idx = raw.lastIndexOf(SPLIT_MARK)
  return raw
    .slice(idx + 1)
    .split(SPLIT_MARK)
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/^ /, '')
}

// 末尾单个 \n 先扣留：等下个增量确认它是「\n\n 段落分界」还是普通换行
function extractPending(t) {
  if (!t.endsWith('\n') || t.endsWith('\n\n')) return { text: t, pending: '' }
  return { text: t.slice(0, -1), pending: '\n' }
}

// 在 SPLIT_MARK 处切分：找到第一个标记就切（空行 = 分条，无长度门槛）
// 前段保证干净（无哨兵、残留单换行折叠成空格、无尾随空白）；纯空白的前段（连续空行）跳过不切
// 剩余 raw 继续留给下轮扫描
function splitAtParagraph(raw) {
  const idx = raw.indexOf(SPLIT_MARK)
  if (idx < 0) return null
  const head = raw
    .slice(0, idx)
    .split(SPLIT_MARK)
    .join(' ')
    .replace(/\n/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
  if (!head) return null
  return [head, raw.slice(idx + SPLIT_MARK.length)]
}
const MAX_BUBBLES_PER_TURN = 6 // 一轮回答最多几条，防模型狂用空行时刷屏

async function run({ requestId, controller, query, useMock }) {
  const conv = conversation // 关键：捕获引用，后续所有保存都绑定这个会话
  const convId = conv.id
  const createdAt = conv.createdAt
  let seq = 0
  let pending = '' // 末尾扣留的换行（等待下个增量确认是否段落分界）
  let bubbleRaw = '' // 当前气泡的原始缓冲（可含哨兵标记）；assistant.text 始终是它的干净视图
  let assistant = { id: `a-${requestId}`, role: 'assistant', text: '', status: 'streaming', thoughts: [], createdAt: Date.now() }
  conv.messages.push(assistant)

  // 节流保存：定时器是 conv 私有的，切走时由 finally 清掉，不会污染下一个会话
  let saveTimer = null
  const scheduleSave = () => {
    if (saveTimer) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      convStore.saveConversation(convId, conv.messages, { createdAt })
    }, SAVE_THROTTLE_MS)
  }
  const flushSave = () => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    convStore.saveConversation(convId, conv.messages, { createdAt })
  }

  const emit = (ev) => emitEvent({ requestId, ...ev })
  // 落盘 + 镜像给渲染层（拆分即时入历史，切走/崩溃时部分回答已保真）
  const persistBubble = () => {
    emit({
      type: 'persist',
      message: {
        role: 'assistant',
        text: assistant.text,
        toolCalls: assistant.toolCalls || [],
        toolResults: assistant.toolResults || []
      }
    })
    flushSave()
  }

  try {
    const params = useMock
      ? { query, signal: controller.signal }
      : { query, history: historyToMessages().slice(0, -1), signal: controller.signal } // 去掉本轮空助手占位
    const streamFn = useMock ? streamMock : runAgent
    for await (const ev of streamFn(params)) {
      if (ev.type === 'delta') {
        // raw 缓冲只含哨兵标记（结构保证：追加后立刻把所有 \n\n 转标记）；
        // assistant.text 始终是它的干净视图（渲染/落盘共用）
        bubbleRaw = (bubbleRaw + pending + ev.text).replace(/\n\n/g, SPLIT_MARK)
        pending = ''
        const split = seq < MAX_BUBBLES_PER_TURN ? splitAtParagraph(bubbleRaw) : null
        if (split) {
          // 空行 → 封口当前气泡，开一条新气泡继续流（「一句一句发」的核心）
          seq++
          assistant.text = split[0]
          assistant.status = 'done' // 被封口的气泡已完结（与落盘清洗一致）
          persistBubble()
          emit({ type: 'split' }) // 先通知渲染端追加气泡，残余文本再写进新气泡
          assistant = { id: `a-${requestId}-${seq}`, role: 'assistant', text: '', status: 'streaming', thoughts: [], createdAt: Date.now() }
          conv.messages.push(assistant)
          bubbleRaw = split[1] // 残余里可能还有更多分界，下轮继续切
        }
        const rest = extractPending(bubbleRaw)
        bubbleRaw = rest.text
        pending = rest.pending
        assistant.text = maskToBubbleText(bubbleRaw)
        if (split) {
          if (assistant.text) emit({ type: 'delta', text: assistant.text })
        } else {
          if (ev.text) emit({ type: 'delta', text: ev.text })
          scheduleSave()
        }
      } else if (ev.type === 'persist') {
        const m = ev.message
        if (m.role === 'assistant') {
          assistant.toolCalls = (assistant.toolCalls || []).concat(m.toolCalls || [])
        } else if (m.role === 'tool') {
          assistant.toolResults = (assistant.toolResults || []).concat(m.toolResult ? [m.toolResult] : [])
        }
        persistBubble()
        continue // 内务事件不下发渲染进程
      } else {
        if (ev.type === 'thought') {
          // 镜像进内存历史：恢复会话时工具轨迹不丢（渲染端与磁盘共用同一结构）
          assistant.thoughts.push(ev)
        } else if (ev.type === 'end') {
          assistant.status = ev.aborted ? 'aborted' : 'done'
        } else if (ev.type === 'error') {
          assistant.status = 'error'
        }
        emit(ev)
      }
    }
  } catch (err) {
    // 用户主动中止不算错误（mock 链路 abort 会抛 AbortError，必须静默）
    if (!controller.signal.aborted) {
      assistant.status = 'error'
      emit({ type: 'error', message: err.message })
    }
  } finally {
    // 收尾折叠：流结束时残留的单换行/尾随空白归一（assistant.text 已是当前气泡的完整视图）
    assistant.text = assistant.text.replace(/\n/g, ' ').replace(/ {2,}/g, ' ').trim()
    pending = ''
    bubbleRaw = ''
    flushSave()
    if (active?.requestId === requestId) {
      const aborted = controller.signal.aborted
      active = null
      if (aborted) {
        assistant.status = 'aborted'
        emit({ type: 'end', aborted: true })
      }
    }
  }
}

export async function stop(requestId) {
  if (!active || active.requestId !== requestId) return { ok: true }
  active.controller.abort()
  return { ok: true }
}
