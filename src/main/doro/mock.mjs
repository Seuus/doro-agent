// 离线 mock 事件流：与 runAgent 同签名的 async generator，支持 signal 中断
// 用于完全不联网地调试流式拼接、思考动画、停止按钮

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        const err = new Error('Aborted')
        err.name = 'AbortError'
        reject(err)
      },
      { once: true }
    )
  })
}

export async function* streamChat({ query, signal }) {
  const taskId = `mock-task-${Date.now()}`

  await sleep(500, signal)
  yield {
    type: 'thought',
    thought: '正在翻你的游戏日志',
    tool: 'dorosearch',
    toolInput: '{"query":"终末地 今日任务"}',
    observation: '找到 1 个日志文件',
    taskId
  }
  await sleep(300, signal)

  const text =
    `收到～你说的是「${query}」。\n\n` +
    '这是 **mock** 回复，用于离线调试流式效果：\n\n' +
    '- 增量按 2~5 字切分\n' +
    '- 中途可以点停止\n\n' +
    '```js\nconsole.log(\'doro\')\n```'

  for (let i = 0; i < text.length; ) {
    const step = 2 + Math.floor(Math.random() * 4)
    yield { type: 'delta', text: text.slice(i, i + step), taskId }
    i += step
    await sleep(70, signal)
  }

  yield { type: 'end', usage: { total_tokens: 0 } }
}
