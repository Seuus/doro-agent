// 端到端假模型驱动：不联网、不依赖 Electron，跑完整条 agent 循环（模型流 → 工具执行 → 回灌 → 最终回答）
// 用法：node scripts/agent-e2e.mjs
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { runAgent } from '../src/main/doro/loop.mjs'
import { initTools } from '../src/main/tools/index.mjs'
import { setStoreDir } from '../src/main/store/settings.mjs'

// 用户目录：给 settings.json / actions.json 一个真实的落点
const sandbox = join(os.tmpdir(), 'doro-agent-test')
fs.mkdirSync(sandbox, { recursive: true })
setStoreDir(sandbox)
initTools({ appPath: sandbox })

const emitTurn = (tc) => ({ type: 'turn', toolCalls: tc ? [tc] : [], usage: tc ? null : { total_tokens: 12 }, finishReason: tc ? 'tool_calls' : 'stop', empty: false })

let calls = 0
async function* mockModel({ messages }) {
  calls++
  const last = messages[messages.length - 1]

  if (calls === 1) {
    // 第 1 轮：先调用 dorosearch 找游戏目录
    yield { type: 'delta', text: '我先找一下游戏目录。\n' }
    const args = '{"query":"Endfield 游戏"}'
    yield emitTurn({ id: 'call_1', name: 'dorosearch', rawArgs: args })
    return
  }

  if (calls === 2) {
    // 验证工具结果确实回灌到了消息里
    const toolMsg = messages.find((m) => m.role === 'tool')
    console.log('[e2e] 模型侧看到工具结果：', String(toolMsg?.content).slice(0, 140), '…\n')
    const args = '{"game":"终末地"}'
    yield emitTurn({ id: 'call_2', name: 'dorogame', rawArgs: args })
    return
  }

  // 第 3 轮：产出最终回答（分片流式）
  const text = '我查到游戏安装在 `D:\\Hypergryph Launcher` 下。终末地今日状态见上方工具结果～'
  for (let i = 0; i < text.length; i += 4) {
    yield { type: 'delta', text: text.slice(i, i + 4) }
    await new Promise((r) => setTimeout(r, 10))
  }
  yield emitTurn(null)
}

console.log('用户：找一下终末地，看看今天日常做了没\n')
let sawEnd = false
for await (const ev of runAgent({ query: '找一下终末地，看看今天日常做了没', history: [], signal: undefined, modelStream: mockModel })) {
  if (ev.type === 'delta') process.stdout.write(ev.text)
  else if (ev.type === 'thought') console.log(`[事件 thought] ${ev.thought || '← ' + ev.observation}`)
  else if (ev.type === 'end') {
    sawEnd = true
    console.log('\n[事件 end]', JSON.stringify(ev))
  } else if (ev.type === 'error') console.log('\n[事件 error]', ev.message)
}

console.log(sawEnd ? '\n✓ 循环正常结束' : '\n✗ 没有收到 end 事件')
