// 脚本动作执行链路验证（纯 Node，不依赖 Electron）：
//   1) command 档 + 进程退出判定（cmd /c exit 0）
//   2) command 档 + 日志正则判定（后台延时写日志，命中 done.regex 即完成）
//   3) keys 档错误路径：目标未运行（没配 exe / exe 路径不存在）必须明确报错
//   4) keys 档自愈完整链路（自启 → 等窗口 → 聚焦按键）：会弹窗抢焦点，默认跳过；
//      置环境变量 DORO_ACTION_GUI=1 才运行，替身是现场用 csc 编译的最小 WinForms 程序
// 用法：node scripts/action-e2e.mjs
import fs from 'node:fs'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
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
    },
    // keys 档错误路径（进程名带 doro- 前缀，避免撞上真实进程）
    { name: '没配置自启的按键动作', kind: 'keys', proc: 'doro-test-not-running', keys: 'F10', done: { timeoutMin: 1 } },
    {
      name: '自启路径不存在的按键动作',
      kind: 'keys',
      proc: 'doro-test-not-running',
      keys: 'F10',
      exe: join(sandbox, 'no-such-app.exe'),
      done: { timeoutMin: 1 }
    }
  ]
}

// 替身 GUI 程序：无参启动、常驻、有主窗口（F10 打进去无副作用）
function buildGuiStub() {
  const csc = join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
  if (!fs.existsSync(csc)) return null
  const cs = join(sandbox, 'GuiStub.cs')
  const exe = join(sandbox, 'doro-test-window.exe')
  fs.writeFileSync(
    cs,
    'using System;\r\n' +
      'using System.Windows.Forms;\r\n' +
      'static class P {\r\n' +
      '  [STAThread] static void Main() { Application.Run(new Form { Text = "doro-test", Width = 320, Height = 220 }); }\r\n' +
      '}\r\n',
    'utf8'
  )
  try {
    execFileSync(csc, ['/nologo', '/target:winexe', `/out:${exe}`, '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', cs], { stdio: 'pipe' })
  } catch {
    return null
  }
  return fs.existsSync(exe) ? { exe, proc: 'doro-test-window' } : null
}

const wantGui = process.env.DORO_ACTION_GUI === '1'
const guiStub = wantGui ? buildGuiStub() : null
if (wantGui && !guiStub) console.log('（GUI 替身构建失败：缺 csc.exe，跳过自愈链路用例）')
if (guiStub) actions.actions.push({ name: '自启按键动作', kind: 'keys', proc: guiStub.proc, keys: 'F10', exe: guiStub.exe, done: { timeoutMin: 1 } })

fs.writeFileSync(join(sandbox, 'actions.json'), JSON.stringify(actions, null, 2), 'utf8')

const check = (label, cond, detail = '') => console.log(`${cond ? '✓' : '✗'} ${label}${detail ? `（${detail}）` : ''}`)

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

console.log('\n== 动作3：keys 档目标未运行且没配 exe → 明确报错 ==')
const r3 = await executeTool('dororun', { action: '没配置自启的按键动作' })
console.log(JSON.stringify(r3))
check('报错说明「未运行」和「没配 exe」', r3.error?.includes('未运行') && r3.error?.includes('exe'))

console.log('\n== 动作4：keys 档 exe 路径不存在 → 快速失败，不空等窗口 ==')
const t4 = Date.now()
const r4 = await executeTool('dororun', { action: '自启路径不存在的按键动作' })
const sec4 = (Date.now() - t4) / 1000
console.log(JSON.stringify(r4), `用时 ${sec4.toFixed(1)}s`)
check('报错是「启动失败」', String(r4.error || '').includes('启动'))
check('10 秒内失败（没有傻等窗口超时）', sec4 < 10)

if (guiStub) {
  console.log('\n== 动作5：keys 档自启完整链路（未运行 → 拉起 → 等窗口 → 聚焦按 F10） ==')
  const t5 = Date.now()
  const r5 = await executeTool('dororun', { action: '自启按键动作' })
  console.log(JSON.stringify(r5), `用时 ${((Date.now() - t5) / 1000).toFixed(1)}s`)
  check('自启后按键发送成功', r5.started === true && r5.status === 'unknown')
  check('拿到替身窗口的 pid', Number.isFinite(r5.pid) && r5.pid > 0, `pid=${r5.pid}`)
  if (r5.pid) {
    try {
      execFileSync('taskkill', ['/PID', String(r5.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {}
    console.log('（替身程序已清理）')
  }
} else if (wantGui) {
  console.log('\n== 动作5：跳过（替身构建失败） ==')
} else {
  console.log('\n== 动作5：跳过（置 DORO_ACTION_GUI=1 可运行「自启完整链路」，会弹窗抢焦点） ==')
}

console.log('\n== 未登记动作的错误路径 ==')
console.log(JSON.stringify(await executeTool('dororun', { action: '不存在的动作' })))
