// 创建主窗口：固定 1200x800 内容区、不可缩放、白色底亮色系
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

export function createMainWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    useContentSize: true, // 让「内容区」正好 1200x800，左栏 320px 的账才算得准
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false, // 配合 ready-to-show 消除白屏闪烁
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    title: 'dororo',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())

  // ELECTRON_RENDERER_URL 由 electron-vite dev 注入
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
