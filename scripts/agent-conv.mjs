// 会话链路冒烟：stub electron 模块，直驱 doro/service.mjs 的多会话生命周期（mock 模式，不联网）
// 覆盖：落盘/标题派生/事件流/新建/切换/流式中切走（僵尸防护）/删除/墓碑/空会话不落盘
// 用法：node scripts/agent-conv.mjs（等价 npm run agent:conv；结束后自动清理 stub 与测试数据）

import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const stubRoot = join(process.env.TEMP, 'doro-electron-stub')
const dataDir = join(process.env.TEMP, 'doro-conv-e2e')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

fs.rmSync(stubRoot, { recursive: true, force: true })
fs.rmSync(dataDir, { recursive: true, force: true })
fs.mkdirSync(join(stubRoot, 'node_modules', 'electron'), { recursive: true })
fs.writeFileSync(
  join(stubRoot, 'node_modules', 'electron', 'index.js'),
  'module.exports = { app: { getPath: () => process.env.DORO_TEST_DIR } }'
)
fs.writeFileSync(
  join(stubRoot, 'node_modules', 'electron', 'package.json'),
  JSON.stringify({ name: 'electron', version: '0.0.0', main: 'index.js' })
)
fs.writeFileSync(join(stubRoot, 'package.json'), JSON.stringify({ name: 'stub', private: true }))

process.env.DORO_MOCK = '1'
process.env.DORO_TEST_DIR = dataDir

const svc = await import(pathToFileURL(join(root, 'src', 'main', 'doro', 'service.mjs')).href)

const events = []
svc.initChatService((ev) => events.push(ev), { appPath: dataDir })

let failed = 0
const check = (name, cond) => {
  if (!cond) failed++
  console.log(`${cond ? '✓' : '✗'} ${name}`)
}

// 等本轮对话的 end/error 事件（mock 全流约 3 秒）
async function waitTurn(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (events.some((e) => e.type === 'end' || e.type === 'error')) return
    await sleep(100)
  }
}

try {
  // 1. 发消息 → 落盘出现会话文件
  const idA = svc.getCurrentConversationId()
  await svc.send('你好呀')
  await waitTurn()
  await sleep(300) // 等最后一批保存落盘
  const list1 = await svc.listConversations()
  check('发消息后出现会话文件', list1.length === 1 && list1[0].id === idA)
  check('标题派生正确', list1[0].title.includes('你好呀'))
  check('事件流含 delta 与 end', events.some((e) => e.type === 'delta') && events.some((e) => e.type === 'end'))

  // 2. 新会话 → 空消息 + 新 id，旧会话仍在列表
  events.length = 0
  const r2 = await svc.newConversation()
  check('新会话 id 不同且消息为空', r2.conversationId !== idA && r2.messages.length === 0)
  const idB = r2.conversationId
  await svc.send('第二个会话')
  await waitTurn()
  await sleep(300)
  const list2 = await svc.listConversations()
  check('两个会话都在列表', list2.length === 2)

  // 3. 切回旧会话 → 消息完整
  const r3 = await svc.switchConversation(idA)
  check('切回旧会话成功', r3.ok && r3.conversationId === idA)
  check('旧会话消息恢复', r3.messages.length >= 2 && r3.messages[0].text === '你好呀')
  check('恢复的消息状态无 streaming', r3.messages.every((m) => m.status !== 'streaming'))

  // 4. 流式中切走 → 新会话不被污染，旧会话保留部分回答（僵尸防护）
  events.length = 0
  await svc.send('第三个问题开始流式') // 不等待，立即切走
  await sleep(300)
  const r4 = await svc.switchConversation(idB)
  check('流式中切换成功', r4.ok && r4.conversationId === idB)
  check('新会话消息无污染', r4.messages.every((m) => !String(m.text).includes('第三个问题')))
  await sleep(3500) // 等被打断的 mock 流走完（其保存会写回自己会话文件）
  const fileA = JSON.parse(fs.readFileSync(join(dataDir, 'conversations', `${idA}.json`), 'utf8'))
  check('旧会话文件保留了被打断的回答', fileA.messages.some((m) => String(m.text).includes('第三个问题')))
  check('被打断的 assistant 状态非 streaming', fileA.messages.every((m) => m.status !== 'streaming'))

  // 5. 删除非当前会话
  await svc.deleteConversation(idA)
  const list3 = await svc.listConversations()
  check('删除后列表剩 1 个', list3.length === 1 && list3[0].id === idB)
  check('删除不影响当前会话', svc.getCurrentConversationId() === idB)

  // 6. 删除当前会话 → 换新 id
  const r6 = await svc.deleteConversation(idB)
  check('删除当前会话后换新 id', r6.conversationId !== idB && r6.messages.length === 0)
  const list4 = await svc.listConversations()
  check('列表为空', list4.length === 0)

  // 7. 空会话不落盘
  const convDir = join(dataDir, 'conversations')
  const files = fs.existsSync(convDir) ? fs.readdirSync(convDir) : []
  check('空会话不产生文件', files.length === 0)

  // 8. 空行切分：mock 回复含多个空行 → 应切成多条 assistant 气泡
  events.length = 0
  await svc.send('测试分条')
  await waitTurn()
  await sleep(300)
  check('收到 split 事件', events.some((e) => e.type === 'split'))
  const bubbles = svc.getHistory().filter((m) => m.role === 'assistant')
  check('切分为多条 assistant 气泡（≥2）', bubbles.length >= 2)
  check('气泡无前导空白与空文本', bubbles.every((m) => m.text === m.text.trimStart() && m.text.trim().length > 0))
  check('气泡无尾随换行（句号不漂移）', bubbles.every((m) => !/[\s\n]$/.test(m.text)))
  check('气泡内无残留换行', bubbles.every((m) => !m.text.includes('\n')))
  check('气泡不含哨兵字符', bubbles.every((m) => !m.text.includes(String.fromCharCode(0xe000))))
  const convIdNow = svc.getCurrentConversationId()
  const saved = JSON.parse(fs.readFileSync(join(dataDir, 'conversations', `${convIdNow}.json`), 'utf8'))
  check('多条气泡已落盘', saved.messages.filter((m) => m.role === 'assistant').length >= 2)
  check('落盘气泡不含哨兵字符', saved.messages.every((m) => !String(m.text || '').includes(String.fromCharCode(0xe000))))

  // 9. 同一会话的第二条消息也要能分条（回归：此前只有首条消息正常分条）
  events.length = 0
  const historyBefore = svc.getHistory().length
  await svc.send('测试第二条')
  await waitTurn()
  await sleep(300)
  const turn2 = svc.getHistory().slice(historyBefore).filter((m) => m.role === 'assistant')
  check('第二条消息也切分（≥2 条气泡）', turn2.length >= 2)
  check('第二条气泡无残留换行/哨兵', turn2.every((m) => !m.text.includes('\n') && !m.text.includes(String.fromCharCode(0xe000))))
  check('被封口气泡状态为 done', turn2.slice(0, -1).every((m) => m.status === 'done'))

  // 10. 切走再切回：气泡内容必须与切换前一致（泄漏/变形会在这里暴露）
  const before = svc.getHistory().map((m) => m.text)
  const other = await svc.newConversation()
  await svc.switchConversation(convIdNow)
  const after = svc.getHistory().map((m) => m.text)
  check('切走再切回后内容不变', JSON.stringify(before) === JSON.stringify(after))
  check('切回后仍无哨兵字符', !JSON.stringify(after).includes(String.fromCharCode(0xe000)))
  void other

  // 11. 重启语义：新实例启动时（新会话为空）列表仍能读到磁盘上的历史会话
  const fresh = await import(pathToFileURL(join(root, 'src', 'main', 'doro', 'service.mjs')).href + '?fresh=1')
  fresh.initChatService(() => {}, { appPath: dataDir })
  const freshList = await fresh.listConversations()
  check('重启后列表立即可用（无需先发消息）', freshList.length >= 1)
  check('重启后默认是全新空会话', fresh.getCurrentConversationId() !== convIdNow && fresh.getHistory().length === 0)
} finally {
  fs.rmSync(stubRoot, { recursive: true, force: true })
  fs.rmSync(dataDir, { recursive: true, force: true })
}

console.log(failed ? `\n${failed} 项未通过` : '\n全部通过')
process.exit(failed ? 1 : 0)
