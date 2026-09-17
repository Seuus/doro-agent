// 对话状态：消息列表 + 会话切换 + 流式状态 + 发送/停止（模块级单例）
import { ref } from 'vue'

const messages = ref([]) // { id, role, text, status, thoughts, createdAt }
const chatStatus = ref('idle') // idle | thinking | error
const currentThought = ref(null) // 最近一条 thought，供 ThinkingIndicator 展示
const conversationId = ref(null) // 当前会话 id（驱动 MessageList 的 :key 重挂载）
const conversations = ref([]) // 侧栏列表：{ id, title, createdAt, updatedAt, messageCount }
const switching = ref(false) // 会话切换中，禁用列表点击
const listVersion = ref(0) // 每次"落盘状态可能变化"时自增，列表组件 watch 它刷新

let requestId = null
let unsubscribe = null

function lastAssistant() {
  for (let i = messages.value.length - 1; i >= 0; i--) {
    if (messages.value[i].role === 'assistant') return messages.value[i]
  }
  return null
}

function handleEvent(ev) {
  // 丢弃过期请求的迟到事件：停止或切换会话后再收事件，不能写进当前气泡
  if (ev.requestId !== requestId) return

  const target = lastAssistant()
  if (!target) return

  switch (ev.type) {
    case 'start':
      chatStatus.value = 'thinking'
      break
    case 'thought':
      target.thoughts.push(ev)
      currentThought.value = ev
      break
    case 'split':
      // 主进程在空行处把回答切成多条：追加新气泡，后续 delta 写进它
      messages.value.push({ id: `a-split-${Date.now()}`, role: 'assistant', text: '', status: 'streaming', thoughts: [] })
      break
    case 'delta':
      target.text += ev.text
      chatStatus.value = 'thinking'
      break
    case 'end':
      target.status = ev.aborted ? 'aborted' : 'done'
      if (ev.aborted && !target.text) target.text = '（已停止生成）'
      chatStatus.value = 'idle'
      currentThought.value = null
      listVersion.value++
      break
    case 'error':
      target.status = 'error'
      target.text = ev.message || '出错了，请重试'
      chatStatus.value = 'error'
      currentThought.value = null
      listVersion.value++
      break
  }
}

// 整体替换消息数组（恢复/切换唯一入口）+ 归一化，绝不增量混入
function applyMessages(list) {
  messages.value = (list || []).map((m) => ({
    ...m,
    thoughts: m.thoughts || [],
    status: m.status && m.status !== 'streaming' ? m.status : 'done'
  }))
}

// 空会话时铺开场白（伪消息，不入主进程历史、不落盘）
async function ensureGreeting() {
  if (messages.value.length > 0) return
  const params = await window.doro.chat.parameters()
  const greeting = params?.openingStatement
  if (greeting && messages.value.length === 0) {
    messages.value = [{ id: 'greeting', role: 'assistant', text: greeting, status: 'done', thoughts: [] }]
  }
}

async function send(text) {
  const query = text.trim()
  if (!query || chatStatus.value === 'thinking' || switching.value) return

  messages.value.push({ id: `u-${Date.now()}`, role: 'user', text: query, status: 'done', thoughts: [] })
  messages.value.push({ id: `a-${Date.now()}`, role: 'assistant', text: '', status: 'streaming', thoughts: [] })
  currentThought.value = null
  chatStatus.value = 'thinking'

  const res = await window.doro.chat.send(query)
  requestId = res?.requestId || null
  if (!res?.ok || !requestId) {
    const target = lastAssistant()
    if (target) {
      target.status = 'error'
      target.text = res?.message || '消息发送失败'
    }
    chatStatus.value = 'error'
  }
}

async function stop() {
  if (!requestId) return
  await window.doro.chat.stop(requestId)
}

async function refreshConversations() {
  const res = await window.doro.chat.conversations()
  if (res?.ok) conversations.value = res.conversations || []
}

async function init() {
  if (!unsubscribe) unsubscribe = window.doro.chat.onEvent(handleEvent)
  await refreshConversations() // 启动即加载历史会话列表（不等 listVersion 变化）
  if (messages.value.length > 0) return

  // 热更新后渲染进程状态会丢失，从主进程内存历史里恢复
  const res = await window.doro.chat.history()
  if (res?.ok) {
    conversationId.value = res.conversationId || null
    if (res.messages?.length) {
      applyMessages(res.messages)
      return
    }
  }
  await ensureGreeting()
}

async function switchConversation(id) {
  if (!id || id === conversationId.value || switching.value) return
  switching.value = true
  // 先同步切断旧会话的事件入口，再发起切换（等待期间旧事件的迟到到达全部丢弃）
  requestId = null
  chatStatus.value = 'idle'
  currentThought.value = null
  try {
    const res = await window.doro.chat.switchConversation(id)
    if (!res?.ok) return
    if (res.conversationId !== id) return // 陈旧回包（链内被判同 id 等情形）
    conversationId.value = res.conversationId
    applyMessages(res.messages)
    await ensureGreeting()
    listVersion.value++
  } finally {
    switching.value = false
  }
}

async function newConversation() {
  if (switching.value) return
  if (!messages.value.length) return // 当前已是空会话，不增殖空 id
  switching.value = true
  requestId = null
  chatStatus.value = 'idle'
  currentThought.value = null
  try {
    const res = await window.doro.chat.newConversation()
    if (!res?.ok) return
    conversationId.value = res.conversationId
    applyMessages(res.messages)
    await ensureGreeting()
    listVersion.value++
  } finally {
    switching.value = false
  }
}

async function deleteConversation(id) {
  if (!id || switching.value) return
  switching.value = true
  requestId = null
  chatStatus.value = 'idle'
  currentThought.value = null
  try {
    const res = await window.doro.chat.deleteConversation(id)
    if (!res?.ok) return
    // 删除的是当前会话 → 主进程已换新 id 返回空消息；删的是别的会话 → 消息不变
    if (res.conversationId !== conversationId.value) {
      conversationId.value = res.conversationId
      applyMessages(res.messages)
      await ensureGreeting()
    }
    listVersion.value++
  } finally {
    switching.value = false
  }
}

// 清空当前会话（设置面板用）：删掉当前会话文件并回到新会话
async function reset() {
  requestId = null
  chatStatus.value = 'idle'
  currentThought.value = null
  await window.doro.chat.reset()
  messages.value = []
  conversationId.value = null
  listVersion.value++
  const res = await window.doro.chat.history()
  if (res?.ok) conversationId.value = res.conversationId || null
  await ensureGreeting()
}

export function useChat() {
  return {
    messages,
    chatStatus,
    currentThought,
    conversationId,
    conversations,
    switching,
    listVersion,
    send,
    stop,
    init,
    reset,
    refreshConversations,
    switchConversation,
    newConversation,
    deleteConversation
  }
}
