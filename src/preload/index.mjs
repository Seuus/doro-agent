// 预加载脚本：contextBridge 暴露 window.doro，这是渲染进程与主进程的唯一契约
// sandbox: true 下只能 require('electron')，不能引 fs/path
import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '../shared/ipc-channels.mjs'

const api = {
  games: {
    scan: () => ipcRenderer.invoke(CH.GAMES_SCAN),
    addManual: (payload) => ipcRenderer.invoke(CH.GAMES_ADD_MANUAL, payload),
    updateManual: (payload) => ipcRenderer.invoke(CH.GAMES_UPDATE_MANUAL, payload),
    removeManual: (id) => ipcRenderer.invoke(CH.GAMES_REMOVE_MANUAL, { id }),
    setHidden: (id, hidden) => ipcRenderer.invoke(CH.GAMES_SET_HIDDEN, { id, hidden })
  },
  chat: {
    send: (query) => ipcRenderer.invoke(CH.CHAT_SEND, { query }),
    stop: (requestId) => ipcRenderer.invoke(CH.CHAT_STOP, { requestId }),
    history: () => ipcRenderer.invoke(CH.CHAT_HISTORY),
    reset: () => ipcRenderer.invoke(CH.CHAT_RESET),
    parameters: () => ipcRenderer.invoke(CH.CHAT_PARAMETERS),
    conversations: () => ipcRenderer.invoke(CH.CHAT_CONV_LIST),
    switchConversation: (id) => ipcRenderer.invoke(CH.CHAT_CONV_SWITCH, { id }),
    newConversation: () => ipcRenderer.invoke(CH.CHAT_CONV_NEW),
    deleteConversation: (id) => ipcRenderer.invoke(CH.CHAT_CONV_DELETE, { id }),
    // 返回退订函数，供组件卸载时调用，避免热更新时监听器堆积
    onEvent: (callback) => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(CH.CHAT_EVENT, listener)
      return () => ipcRenderer.removeListener(CH.CHAT_EVENT, listener)
    }
  },
  app: {
    info: () => ipcRenderer.invoke(CH.APP_INFO),
    openDataDir: () => ipcRenderer.invoke(CH.APP_OPEN_DATA_DIR),
    openExternal: (url) => ipcRenderer.invoke(CH.APP_OPEN_EXTERNAL, { url }),
    pickFile: (kind) => ipcRenderer.invoke(CH.APP_PICK_FILE, { kind }),
    updateModel: (payload) => ipcRenderer.invoke(CH.APP_UPDATE_MODEL, payload),
    testModel: (payload) => ipcRenderer.invoke(CH.APP_TEST_MODEL, payload)
  }
}

contextBridge.exposeInMainWorld('doro', api)
