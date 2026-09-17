// IPC 通道名常量：主进程与预加载共用，统一 doro: 前缀避免与 Electron 内部通道冲突
export const CH = {
  GAMES_SCAN: 'doro:games:scan',
  GAMES_ADD_MANUAL: 'doro:games:add-manual',
  GAMES_UPDATE_MANUAL: 'doro:games:update-manual',
  GAMES_REMOVE_MANUAL: 'doro:games:remove-manual',
  GAMES_SET_HIDDEN: 'doro:games:set-hidden',
  CHAT_SEND: 'doro:chat:send',
  CHAT_STOP: 'doro:chat:stop',
  CHAT_HISTORY: 'doro:chat:history',
  CHAT_RESET: 'doro:chat:reset',
  CHAT_PARAMETERS: 'doro:chat:parameters',
  CHAT_EVENT: 'doro:chat:event',
  CHAT_CONV_LIST: 'doro:chat:conv-list',
  CHAT_CONV_SWITCH: 'doro:chat:conv-switch',
  CHAT_CONV_NEW: 'doro:chat:conv-new',
  CHAT_CONV_DELETE: 'doro:chat:conv-delete',
  APP_INFO: 'doro:app:info',
  APP_OPEN_DATA_DIR: 'doro:app:open-data-dir',
  APP_OPEN_EXTERNAL: 'doro:app:open-external',
  APP_PICK_FILE: 'doro:app:pick-file',
  APP_UPDATE_MODEL: 'doro:app:update-model',
  APP_TEST_MODEL: 'doro:app:test-model'
}
