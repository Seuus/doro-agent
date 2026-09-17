// 全部 IPC 处理：游戏扫描与卡片管理（含自动图标解析）、对话、应用信息与设置
// 渲染进程只能通过 preload 的 window.doro 走这些通道，接触不到 API Key 与文件系统
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs/promises'
import { join } from 'node:path'
import { CH } from '../shared/ipc-channels.mjs'
import { scanAllGames, IMAGE_MIME } from '../shared/games/scanner.mjs'
import { findGameExe } from '../shared/games/exe-finder.mjs'
import { extractExeIconPng } from '../shared/games/exe-icon.mjs'
import * as chatService from './doro/service.mjs'
import { resolveModelConfig, testModelConnection } from './doro/client.mjs'
import { readSettings, updateSettings } from './store/settings.mjs'

// ---------------- 游戏图标（自动扫描条目） ----------------
// 缓存优先 → 自动查找游戏本体 exe 提取 → Electron 原生图标兜底。
// 缓存落 userData/icons/<游戏id>.png；找不到时落 <游戏id>.nofind 标记（记当时的日志路径，
// 日志路径变了说明游戏重装过，才重新搜索），避免每次扫描都白跑一遍全盘查找。

function iconsDir() {
  return join(app.getPath('userData'), 'icons')
}

function toDataUrl(buf) {
  return `data:image/png;base64,${buf.toString('base64')}`
}

async function markMiss(missPath, logPath) {
  try {
    await fs.mkdir(iconsDir(), { recursive: true })
    await fs.writeFile(missPath, String(logPath || ''), 'utf8')
  } catch {
    // 标记写不进去只是下次多搜一遍，不影响功能
  }
}

async function getAutoGameIconDataUrl(game) {
  const pngPath = join(iconsDir(), `${game.id}.png`)
  try {
    return toDataUrl(await fs.readFile(pngPath)) // 缓存命中
  } catch {
    // 无缓存，继续查找
  }

  const missPath = join(iconsDir(), `${game.id}.nofind`)
  try {
    const prev = await fs.readFile(missPath, 'utf8')
    if (prev === String(game.logPath || '')) return null // 同一条日志曾找不到，不重复搜
  } catch {
    // 没有标记，正常流程
  }

  const exePath = await findGameExe({ name: game.name, logPath: game.logPath })
  if (!exePath) {
    await markMiss(missPath, game.logPath)
    return null
  }

  let png = null
  try {
    png = extractExeIconPng(exePath)?.png || null
  } catch {
    png = null
  }
  if (!png) {
    // 纯 JS 提取失败（罕见图标格式）时，退回 Electron 原生文件图标（Windows 下为 32px）
    try {
      png = (await app.getFileIcon(exePath, { size: 'large' })).toPNG()
    } catch {
      png = null
    }
  }
  if (!png) {
    await markMiss(missPath, game.logPath)
    return null
  }

  try {
    await fs.mkdir(iconsDir(), { recursive: true })
    await fs.writeFile(pngPath, png)
  } catch {
    // 缓存写失败不影响本次返回
  }
  console.log(`[图标] ${game.name} ← ${exePath}`)
  return toDataUrl(png)
}

// ---------------- 游戏扫描与卡片管理 ----------------

// 手动条目的自定义图标统一存在 userData/icons 下，settings 里只存文件名，路径迁移后不失效
function resolveIconPaths(entries) {
  return entries.map((e) => ({
    ...e,
    iconAbsPath: e.iconFile ? join(iconsDir(), e.iconFile) : null
  }))
}

// 校验手动条目的名称与日志文件路径（添加/编辑共用）
async function validateManualInput(payload) {
  const name = String(payload?.name || '').trim()
  const vendor = String(payload?.vendor || '').trim()
  const filePath = String(payload?.filePath || '').trim()
  if (!name) return { error: '请填写游戏名称' }
  if (!filePath) return { error: '请先选择日志文件' }
  try {
    const stat = await fs.stat(filePath)
    if (!stat.isFile()) return { error: '指定路径不是文件' }
  } catch {
    return { error: '日志文件不存在或无法访问' }
  }
  return { value: { name, vendor, filePath } }
}

// 复制用户选择的图标进 userData/icons；失败返回 null，不阻断保存（卡片退回名称首字）
async function copyIcon(sourcePath, id) {
  const ext = String(sourcePath).split('.').pop().toLowerCase()
  if (!IMAGE_MIME[ext]) return null
  try {
    await fs.mkdir(iconsDir(), { recursive: true })
    const iconFile = `${id}.${ext}`
    await fs.copyFile(sourcePath, join(iconsDir(), iconFile))
    return iconFile
  } catch (err) {
    console.warn(`[games] 图标复制失败：${err.message}`)
    return null
  }
}

async function deleteIconFile(iconFile) {
  if (!iconFile) return
  await fs.unlink(join(iconsDir(), iconFile)).catch(() => {}) // 图标删不掉不影响主流程
}

function registerGamesHandlers() {
  ipcMain.handle(CH.GAMES_SCAN, async () => {
    try {
      const settings = await readSettings()
      const { games, scannedAt } = await scanAllGames(new Date(), resolveIconPaths(settings.manualGames || []))
      const hidden = new Set(settings.hiddenGames || [])

      // 自动条目补图标：缓存优先，首次扫描时自动查找游戏本体 exe 提取（隐藏的条目跳过，省一次查找）
      const withIcons = await Promise.all(
        games.map(async (g) => {
          const marked = hidden.has(g.id) ? { ...g, hidden: true } : g
          if (marked.manual || marked.hidden || marked.iconDataUrl) return marked
          const iconDataUrl = await getAutoGameIconDataUrl(marked)
          return iconDataUrl ? { ...marked, iconDataUrl } : marked
        })
      )
      return { ok: true, scannedAt, games: withIcons }
    } catch (err) {
      return { ok: false, scannedAt: Date.now(), games: [], message: err.message }
    }
  })

  ipcMain.handle(CH.GAMES_ADD_MANUAL, async (_event, payload) => {
    const { error, value } = await validateManualInput(payload)
    if (error) return { ok: false, message: error }

    const id = `manual-${Date.now().toString(36)}`
    const iconFile = payload?.iconPath ? await copyIcon(payload.iconPath, id) : null

    const settings = await readSettings()
    await updateSettings({
      manualGames: [...(settings.manualGames || []), { id, ...value, iconFile }]
    })
    return { ok: true, id }
  })

  ipcMain.handle(CH.GAMES_UPDATE_MANUAL, async (_event, payload) => {
    const settings = await readSettings()
    const entry = (settings.manualGames || []).find((e) => e.id === payload?.id)
    if (!entry) return { ok: false, message: '条目不存在' }

    const { error, value } = await validateManualInput(payload)
    if (error) return { ok: false, message: error }

    let iconFile = entry.iconFile
    if (payload?.iconPath) {
      await deleteIconFile(entry.iconFile) // 扩展名可能变化，先删旧再拷新
      iconFile = await copyIcon(payload.iconPath, entry.id)
    } else if (payload?.clearIcon) {
      await deleteIconFile(entry.iconFile)
      iconFile = null
    }

    const next = (settings.manualGames || []).map((e) => (e.id === entry.id ? { ...e, ...value, iconFile } : e))
    await updateSettings({ manualGames: next })
    return { ok: true }
  })

  ipcMain.handle(CH.GAMES_REMOVE_MANUAL, async (_event, { id }) => {
    const settings = await readSettings()
    const entry = (settings.manualGames || []).find((e) => e.id === id)
    if (!entry) return { ok: false, message: '条目不存在' }

    await updateSettings({ manualGames: (settings.manualGames || []).filter((e) => e.id !== id) })
    await deleteIconFile(entry.iconFile)
    return { ok: true }
  })

  // 自动扫描的卡片删不掉（配置表驱动，下次扫描仍会出现），以「隐藏」实现：只记 id，扫描时标记给渲染层过滤
  ipcMain.handle(CH.GAMES_SET_HIDDEN, async (_event, { id, hidden }) => {
    if (typeof id !== 'string' || !id) return { ok: false, message: '缺少游戏 id' }

    const settings = await readSettings()
    const next = new Set(settings.hiddenGames || [])
    if (hidden) next.add(id)
    else next.delete(id)
    await updateSettings({ hiddenGames: [...next] })
    return { ok: true }
  })
}

// ---------------- 对话 ----------------

function registerChatHandlers() {
  ipcMain.handle(CH.CHAT_SEND, async (_event, { query }) => {
    // 立即返回 requestId，流在后台继续推事件，绝不 await 整个回复
    const requestId = await chatService.send(query)
    return { ok: true, requestId }
  })

  ipcMain.handle(CH.CHAT_STOP, (_event, { requestId }) => chatService.stop(requestId))

  ipcMain.handle(CH.CHAT_HISTORY, () => ({
    ok: true,
    conversationId: chatService.getCurrentConversationId(),
    messages: chatService.getHistory()
  }))

  ipcMain.handle(CH.CHAT_PARAMETERS, async () => ({
    ok: true,
    openingStatement: await chatService.getOpeningStatement()
  }))

  ipcMain.handle(CH.CHAT_RESET, async () => {
    await chatService.reset()
    return { ok: true }
  })

  ipcMain.handle(CH.CHAT_CONV_LIST, async () => {
    const conversations = await chatService.listConversations()
    return { ok: true, conversations, currentId: chatService.getCurrentConversationId() }
  })

  ipcMain.handle(CH.CHAT_CONV_SWITCH, (_event, { id }) => chatService.switchConversation(id))

  ipcMain.handle(CH.CHAT_CONV_NEW, () => chatService.newConversation())

  ipcMain.handle(CH.CHAT_CONV_DELETE, (_event, { id }) => chatService.deleteConversation(id))
}

// ---------------- 应用信息、设置与文件选择 ----------------

const PICK_FILTERS = {
  log: [{ name: '日志文件', extensions: ['log', 'txt'] }, { name: '全部文件', extensions: ['*'] }],
  image: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'ico', 'bmp'] }]
}

// 校验并归一化设置面板提交的模型接口参数
function normalizeModel({ baseUrl, apiKey, model } = {}) {
  const url = String(baseUrl || '').trim().replace(/\/+$/, '')
  const key = String(apiKey || '').trim()
  const name = String(model || '').trim()
  if (!url) return { error: '请填写服务地址' }
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { error: '服务地址必须是 http(s) 开头' }
  } catch {
    return { error: '服务地址不是合法的 URL' }
  }
  if (!name) return { error: '请填写模型名' }
  return { value: { baseUrl: url, apiKey: key, model: name } }
}

function registerAppHandlers() {
  // 设置面板所需信息：对话记忆状态、数据目录、当前生效的模型接口参数
  // （API Key 仅在打开设置面板时经此下发用于编辑，不进入渲染层构建产物）
  ipcMain.handle(CH.APP_INFO, async () => {
    const model = await resolveModelConfig()
    return {
      ok: true,
      hasConversation: chatService.hasConversation(),
      dataDir: app.getPath('userData'),
      model: { baseUrl: model.baseUrl, apiKey: model.apiKey, model: model.model }
    }
  })

  ipcMain.handle(CH.APP_OPEN_DATA_DIR, async () => {
    // shell.openPath 成功返回空串，失败返回错误描述
    const err = await shell.openPath(app.getPath('userData'))
    return err ? { ok: false, message: err } : { ok: true }
  })

  // 保存模型接口设置；换模型不清任何会话（用户 2026-09-17 明确：什么都不清，旧会话保留可续聊）
  ipcMain.handle(CH.APP_UPDATE_MODEL, async (_event, payload) => {
    const { error, value } = normalizeModel(payload)
    if (error) return { ok: false, message: error }

    const current = await resolveModelConfig()
    const changed =
      current.baseUrl !== value.baseUrl || current.apiKey !== value.apiKey || current.model !== value.model
    if (!changed) return { ok: true, changed: false }

    await updateSettings({ model: { ...value, temperature: current.temperature } })
    return { ok: true, changed: true }
  })

  // 测试连接：用表单里的地址/Key/模型名发一条最小请求
  ipcMain.handle(CH.APP_TEST_MODEL, async (_event, payload) => {
    const { error, value } = normalizeModel(payload)
    if (error) return { ok: false, message: error }
    return testModelConnection(value)
  })

  ipcMain.handle(CH.APP_PICK_FILE, async (_event, { kind }) => {
    const filters = PICK_FILTERS[kind]
    if (!filters) return { ok: false, message: '不支持的文件类型' }

    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const options = { properties: ['openFile'], filters }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths.length) return { ok: true, path: null }
    return { ok: true, path: result.filePaths[0] }
  })

  ipcMain.handle(CH.APP_OPEN_EXTERNAL, async (_event, { url }) => {
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      return { ok: false, message: '链接格式不合法' }
    }
    // 只放行 http/https，不给 file:// 等协议留口子
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, message: '只允许打开 http/https 链接' }
    }
    await shell.openExternal(url)
    return { ok: true }
  })
}

export function registerIpcHandlers() {
  registerGamesHandlers()
  registerChatHandlers()
  registerAppHandlers()
}
