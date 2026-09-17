// OpenAI 兼容模型客户端 + 模型接口配置：任意 base_url + key（DeepSeek / OpenAI / Ollama / 本地代理都能用）
// 流式 /chat/completions，支持 tool_calls 增量累积；产出轻量事件给 doro/loop.mjs 消化
import { readSettings } from '../store/settings.mjs'

// 默认走 DeepSeek（用户主用），任何 OpenAI 兼容服务改 base_url + model 即可
export const DEFAULT_MODEL_CONFIG = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  temperature: 0.5
}

export async function resolveModelConfig() {
  const settings = await readSettings()
  return { ...DEFAULT_MODEL_CONFIG, ...(settings.model || {}) }
}

export function isLocalUrl(url) {
  return /127\.0\.0\.1|localhost|\[::1\]/.test(String(url))
}

async function readErrorMessage(res) {
  try {
    const body = await res.json()
    const msg = body?.error?.message || body?.message
    return msg || `请求失败（HTTP ${res.status}）`
  } catch {
    return `请求失败（HTTP ${res.status}）`
  }
}

function toApiMessages(messages) {
  return messages.map((m) => {
    if (m.role === 'user') return { role: 'user', content: m.content }
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
    const out = { role: 'assistant', content: m.content || null }
    if (m.toolCalls?.length) {
      out.tool_calls = m.toolCalls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: c.rawArgs }
      }))
    }
    return out
  })
}

export async function* streamModel({ messages, tools, signal }) {
  const { baseUrl, apiKey, model, temperature } = await resolveModelConfig()
  if (!apiKey && !isLocalUrl(baseUrl)) {
    yield { type: 'error', message: '还没有配置模型 API Key，请在「设置 → 对话模型接口」里填写' }
    return
  }

  const payload = { model, messages: toApiMessages(messages), stream: true, temperature }
  if (tools?.length) {
    payload.tools = tools
    payload.tool_choice = 'auto'
  }

  let res
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify(payload),
      signal
    })
  } catch (err) {
    if (signal?.aborted) return
    yield { type: 'error', message: `无法连接模型服务（${baseUrl}）：${err.message}` }
    return
  }

  if (!res.ok || !res.body) {
    yield { type: 'error', status: res.status, message: await readErrorMessage(res) }
    return
  }

  const state = { byIndex: new Map(), anyText: false, usage: null, finishReason: null }
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buf = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).replace(/\r$/, '')
        buf = buf.slice(idx + 1)
        if (!line.startsWith('data:')) continue
        const raw = line.slice(5).trim()
        if (!raw || raw === '[DONE]') continue
        let chunk
        try {
          chunk = JSON.parse(raw)
        } catch {
          continue // 半行/坏行跳过，绝不中断整条流
        }
        if (chunk.usage) state.usage = chunk.usage
        const choice = chunk.choices?.[0]
        if (!choice) continue
        if (choice.delta) {
          const d = choice.delta
          if (d.content) {
            state.anyText = true
            yield { type: 'delta', text: d.content }
          }
          for (const tc of d.tool_calls || []) {
            const i = tc.index ?? 0
            const prev = state.byIndex.get(i) || { id: null, name: null, rawArgs: '' }
            state.byIndex.set(i, {
              id: prev.id || tc.id,
              name: prev.name || tc.function?.name,
              rawArgs: prev.rawArgs + (tc.function?.arguments || '')
            })
            state.anyText = true // 有工具调用就不算「空回复」
          }
        }
        if (choice.finish_reason) state.finishReason = choice.finish_reason
      }
    }
  } catch (err) {
    if (signal?.aborted) return
    yield { type: 'error', message: `读取模型回复流失败：${err.message}` }
    return
  }

  const toolCalls = [...state.byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v)
    .filter((c) => c.name)
  yield {
    type: 'turn',
    toolCalls,
    usage: state.usage,
    finishReason: state.finishReason,
    empty: !state.anyText
  }
}

// 测试连接：发一条最小请求，验证地址/Key/模型名三者可用
export async function testModelConnection({ baseUrl, apiKey, model }) {
  const url = String(baseUrl || '').trim().replace(/\/+$/, '')
  try {
    const res = await fetch(`${url}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false }),
      signal: AbortSignal.timeout(12000)
    })
    if (!res.ok) {
      const msg = res.status === 401 ? 'API Key 无效' : await readErrorMessage(res)
      return { ok: false, message: `连接失败：${msg}` }
    }
    return { ok: true, message: '连接成功，模型可用' }
  } catch (err) {
    const msg = err.name === 'TimeoutError' ? '连接超时' : err.message
    return { ok: false, message: `连接失败：${msg}` }
  }
}
