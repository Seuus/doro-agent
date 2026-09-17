// 本地登记的脚本动作（通用脚本启动器）：登记卡数据驱动，动作在用户目录 actions.json 里增删
// 两种启动机制（与 butler 服务同款设计，这里去掉 HTTP 层）：
//   command —— 直接启动命令；done.log+done.regex 命中即完成，否则等进程退出
//   keys    —— 聚焦窗口发按键（如 F10 开始 / F11 停止）；done.log 必填，超时兜底
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_ACTIONS = {
  actions: [
    {
      name: '终末地日常',
      kind: 'keys',
      keys: 'F10',
      stopKeys: 'F11',
      proc: 'MaaEnd',
      done: {
        log: 'E:\\MaaEnd-win-x86_64-v2.27.0\\debug\\maafw.log',
        regex: 'Tasker::run_task.*leave',
        timeoutMin: 90
      },
      note: 'MaaEnd 小助手：聚焦窗口后按 F10 启动当前激活预设，F11 停止；完成以 maafw.log 任务结束标记判定'
    }
  ]
}

let dataDir = null

export function initTools({ appPath } = {}) {
  dataDir = appPath
}

function actionsPath() {
  return join(dataDir || process.cwd(), 'actions.json')
}

let cache = null

export async function loadActions() {
  if (cache) return cache
  const p = actionsPath()
  try {
    cache = JSON.parse(await fs.readFile(p, 'utf8'))
  } catch {
    cache = structuredClone(DEFAULT_ACTIONS)
    try {
      await fs.writeFile(p, JSON.stringify(cache, null, 2), 'utf8')
    } catch {
      // 写不进去只是下次还要重建，不影响本次运行
    }
  }
  return cache
}

// ---------------- PowerShell 助手（唯一需要命令行的地方，参数全部由登记卡数据给出） ----------------

function runPsFile(scriptPath) {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      windowsHide: true
    })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('error', (err) => resolve({ code: -1, out: err.message }))
    child.on('close', (code) => resolve({ code, out }))
  })
}

async function psFile(name, content) {
  const p = join(tmpdir(), name)
  await fs.writeFile(p, content, 'utf8')
  return runPsFile(p)
}

const VK = { F10: 0x79, F11: 0x7A, F12: 0x7B, ENTER: 0x0D, ESC: 0x1B, SPACE: 0x20, TAB: 0x09 }

function vkOf(key) {
  const k = String(key).trim().toUpperCase()
  if (VK[k]) return VK[k]
  if (/^F\d{1,2}$/.test(k)) return 0x70 + Number(k.slice(1)) - 1 // F1=0x70
  if (/^[A-Z0-9]$/.test(k)) return k.charCodeAt(0)
  return null
}

function psQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`
}

async function sendKeys(name, key, focus, proc) {
  const vk = vkOf(key)
  if (!vk) return { code: -1, out: `不支持的按键：${key}` }
  const lines = [
    ...[...String(proc)].map((ch) => `$proc += [char]${ch.charCodeAt(0)}`),
    `$vk = ${vk}`,
    `$focus = ${focus ? '$true' : '$false'}`,
    'Add-Type -Namespace W -Name U -MemberDefinition @"',
    '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);',
    '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);',
    '[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte sc, int flags, int extra);',
    '"@',
    '$p = Get-Process -Name $proc -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1',
    'if (-not $p) { Write-Output "NO_WINDOW"; exit 2 }',
    'if ($focus) { [void][W.U]::ShowWindow($p.MainWindowHandle, 9); [void][W.U]::SetForegroundWindow($p.MainWindowHandle); Start-Sleep -Milliseconds 600 }',
    '[W.U]::keybd_event($vk, 0, 0, 0); Start-Sleep -Milliseconds 60; [W.U]::keybd_event($vk, 0, 2, 0)',
    'Write-Output "OK"'
  ]
  return psFile(`${name}.ps1`, lines.join('\r\n'))
}

async function findProcId(name) {
  const { out } = await psFile(
    `doro-pid-${Date.now()}.ps1`,
    `$p = Get-Process -Name ${psQuote(name)} -ErrorAction SilentlyContinue | Select-Object -First 1; if ($p) { $p.Id }`
  )
  const id = Number(String(out).trim())
  return Number.isFinite(id) && id > 0 ? id : null
}

async function processAlive(pid) {
  if (!pid) return false
  // 本进程直接 spawn 的：exitCode 一旦有值说明已退出，精确且零开销
  const child = spawned.get(pid)
  if (child) return child.exitCode === null && !child.killed
  // keys 档（MaaEnd 等外部 GUI 进程）：查进程与窗口
  const { out } = await psFile(
    `doro-alive-${Date.now()}.ps1`,
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue\r\n` +
      `if ($p) { if ($p.MainWindowHandle -ne 0) { 'YES' } elseif ($p.ProcessName -eq 'cmd') { 'WRAPPER' } else { 'NOWINDOW' } } else { 'NO' }`
  )
  const s = String(out)
  return s.includes('YES') || s.includes('WRAPPER') // 无窗口且非 cmd 包装的进程不参与完成判定
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 完成判定：done.log+regex 命中（增量读，只看新内容）优先，fallback 为进程消失
async function watchDone(done, pid, timeoutMin) {
  const deadline = Date.now() + timeoutMin * 60 * 1000
  let re = null
  if (done?.regex) {
    try {
      re = new RegExp(done.regex)
    } catch {
      re = null
    }
  }
  let offset = 0
  if (done?.log) {
    try {
      offset = (await fs.stat(done.log)).size
    } catch {
      offset = 0
    }
  }

  for (;;) {
    if (Date.now() > deadline) return { status: 'timeout', note: `超过 ${timeoutMin} 分钟仍未完成` }

    if (done?.log && re) {
      try {
        const size = (await fs.stat(done.log)).size
        if (size > offset) {
          const fd = await fs.open(done.log, 'r')
          const len = Math.min(size - offset, 8 * 1024 * 1024)
          const buf = Buffer.alloc(len)
          await fd.read(buf, 0, len, offset)
          await fd.close()
          offset += len
          if (re.test(buf.toString('utf8'))) return { status: 'done' }
        }
      } catch {
        // 日志被轮转/删除时忽略，继续等
      }
    }

    if (pid && !(await processAlive(pid))) return { status: 'done', note: '进程已退出' }
    await sleep(5000)
  }
}

async function waitExit(pid, timeoutMin) {
  const deadline = Date.now() + timeoutMin * 60 * 1000
  for (;;) {
    if (Date.now() > deadline) return { status: 'timeout', note: `超过 ${timeoutMin} 分钟进程仍未退出` }
    if (!(await processAlive(pid))) return { status: 'done', note: '进程已退出' }
    await sleep(5000)
  }
}

// ---------------- 对外接口 ----------------

export async function listActionsTool() {
  const { actions } = await loadActions()
  return {
    actions: actions.map((a) => ({ name: a.name, kind: a.kind, note: a.note || '' })),
    note: '用 dororun 执行；要新增/修改动作，编辑数据目录下的 actions.json'
  }
}

// 记录本次进程内启动的动作，以便用 exitCode 精确判断「退出码 → 完成」阶梯
const spawned = new Map()

export async function runActionTool({ action }) {
  const name = String(action || '').trim()
  if (!name) return { error: '缺少 action 参数' }
  const { actions } = await loadActions()
  const entry = actions.find((a) => a.name === name)
  if (!entry) {
    return {
      error: `没有登记叫「${name}」的动作`,
      available: actions.map((a) => a.name)
    }
  }

  const timeoutMin = entry.done?.timeoutMin || 30

  if (entry.kind === 'command') {
    if (!entry.command) return { error: `动作「${name}」缺少 command 字段` }
    // 命令按 cmd 命令行语义整体解析（&、>> 等生效）：先拼成单条命令再用 shell 启动。
    // 实测数组形式在 Windows 下会破坏 cmd /c 的引号与转义（& 之后的命令不执行）
    const exe = String(entry.command)
    const full = [/\s/.test(exe) ? `"${exe}"` : exe, ...(entry.args || []).map(String)].join(' ')
    let child
    try {
      child = spawn(full, {
        cwd: entry.cwd || undefined,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        shell: true
      })
    } catch (err) {
      return { error: `启动失败：${err.message}` }
    }
    const pid = child.pid || null
    if (pid) spawned.set(pid, child)
    child.unref()
    const watch = entry.done?.log ? await watchDone(entry.done, pid, timeoutMin) : await waitExit(pid, timeoutMin)
    if (pid) spawned.delete(pid)
    return { started: true, action: name, pid, ...watch }
  }

  if (entry.kind === 'keys') {
    if (!entry.proc) return { error: `动作「${name}」缺少 proc 字段（要聚焦的进程名）` }
    const before = await findProcId(entry.proc)
    const sent = await sendKeys(`doro-keys-${Date.now()}`, entry.keys || 'F10', entry.focus !== false, entry.proc)
    if (sent.code !== 0) {
      return { error: `发送按键失败（进程 ${entry.proc} 未运行？）：${sent.out.trim() || sent.code}` }
    }
    // 先等进程出现（游戏/小助手可能由本次按键拉起），再进入完成判定
    let pid = before
    if (!pid) {
      for (let i = 0; i < 12 && !pid; i++) {
        await sleep(2500)
        pid = await findProcId(entry.proc)
      }
    }
    const watch = entry.done?.log ? await watchDone(entry.done, pid, timeoutMin) : { status: 'unknown', note: '已发送按键，但没有配置完成判定' }
    return { started: true, action: name, key: entry.keys, pid, ...watch }
  }

  return { error: `动作「${name}」的 kind 不支持：${entry.kind}（支持 command / keys）` }
}
