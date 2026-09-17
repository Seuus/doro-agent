// 主进程入口：应用生命周期、注册 IPC、创建窗口
import { app } from 'electron'
import { CH } from '../shared/ipc-channels.mjs'
import { createMainWindow } from './window.mjs'
import { registerIpcHandlers } from './ipc.mjs'
import { initChatService, flushChatSync } from './doro/service.mjs'
import { buildSnapshot, invalidate } from './tools/index.mjs'
import { setStoreDir } from './store/settings.mjs'

// 设置读写落 userData；脚本/测试环境在自己的入口里注入别的目录
setStoreDir(app.getPath('userData'))

app.whenReady().then(async () => {
  const win = createMainWindow()

  // 对话事件唯一出口：主进程 → 渲染进程单向推送
  await initChatService(
    (event) => {
      if (!win.isDestroyed()) win.webContents.send(CH.CHAT_EVENT, event)
    },
    { appPath: app.getPath('userData') }
  )

  registerIpcHandlers()

  // 启动后台全盘索引（不阻塞启动）；窗口关闭前退出进程即可，无需清理
  invalidate()
  buildSnapshot().catch((err) => console.warn(`[文件索引] 构建失败：${err.message}`))
})

app.on('window-all-closed', () => {
  app.quit()
})

// 退出兜底：进程退出不等异步写盘，同步保存当前会话最后一段内容
app.on('before-quit', () => {
  flushChatSync()
})
