// 脚本动作执行链路验证（纯 Node，不依赖 Electron）：
//   1) command 档 + 进程退出判定（cmd /c exit 0）
//   2) command 档 + 日志正则判定（后台延时写日志，命中 done.regex 即完成）
// 用法：node scripts/action-e2e.mjs
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { initTools, executeTool } from '../src/main/tools/index.mjs'
import { setStoreDir } from '../src/main/store/settings.mjs'

const sandbox = join(os.tmpdir(), 'doro-agent-action-test')
fs.rmSync(sandbox, { recursive: true, force: true })
fs.mkdirSync(sandbox, { recursive: true })
setStoreDir(sandbox)
initTools({ appPath: sandbox })

const logFile = join(sandbox, 'done.log')
fs.writeFileSync(logFile, 'preexisting line\n', 'utf8')

const actions = {
  actions: [
    { name: '退出码动作', kind: 'command', command: 'cmd.exe', args: ['/c', 'exit', '0'], done: { timeoutMin: 2 } },
    {
      name: '日志判定动作',
      kind: 'command',
      command: 'cmd.exe',
      args: ['/c', `ping -n 3 127.0.0.1 >nul & echo TASK_DONE_OK >> "${logFile}"`],
      done: { log: logFile, regex: 'TASK_DONE_OK', timeoutMin: 2 }
    }
  ]
}
fs.writeFileSync(join(sandbox, 'actions.json'), JSON.stringify(actions, null, 2), 'utf8')

console.log('== dorolist ==')
console.log(JSON.stringify(await executeTool('dorolist', {}), null, 2))

console.log('\n== 动作1：退出码判定 ==')
const t1 = Date.now()
console.log(JSON.stringify(await executeTool('dororun', { action: '退出码动作' })), `用时 ${((Date.now() - t1) / 1000).toFixed(1)}s`)

console.log('\n== 动作2：日志正则判定（ping 约 2s 后写日志） ==')
const t2 = Date.now()
const r2 = await executeTool('dororun', { action: '日志判定动作' })
console.log(JSON.stringify(r2), `用时 ${((Date.now() - t2) / 1000).toFixed(1)}s`)
console.log('日志内容：', fs.readFileSync(logFile, 'utf8').trim().split('\n').join(' | '))

console.log('\n== 未登记动作的错误路径 ==')
console.log(JSON.stringify(await executeTool('dororun', { action: '不存在的动作' })))
