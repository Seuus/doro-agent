<!-- 左侧 320px 容器：游戏日志监控 + 会话列表 + 底部设置齿轮；渲染全应用唯一的添加/编辑游戏弹窗 -->
<script setup>
import { ref, watch } from 'vue'
import GameLogPanel from './GameLogPanel.vue'
import ChatSessionList from '../chat/ChatSessionList.vue'
import SettingsDialog from './SettingsDialog.vue'
import GameFormDialog from './GameFormDialog.vue'
import { useGameEditor } from '../../composables/useGameEditor.js'
import { useChat } from '../../composables/useChat.js'

const { visible, editing, closeGameEditor } = useGameEditor()
const {
  conversations,
  conversationId,
  switching,
  listVersion,
  refreshConversations,
  switchConversation,
  newConversation,
  deleteConversation
} = useChat()

const showSettings = ref(false)

function onSessionSelect({ id, remove }) {
  if (remove) deleteConversation(id)
  else switchConversation(id)
}

// listVersion 在 end/error/切换/新建/删除后自增；防抖刷新，避免流式期间列表在眼皮下重排
let refreshTimer = null
watch(listVersion, () => {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => refreshConversations(), 300)
})
</script>

<template>
  <aside class="side-panel">
    <div class="side-top">
      <GameLogPanel />
      <ChatSessionList
        :busy="switching"
        :conversations="conversations"
        :active-id="conversationId"
        @select="onSessionSelect"
        @create="newConversation"
      />
    </div>

    <button class="settings-btn" title="设置" @click="showSettings = true">⚙</button>

    <SettingsDialog v-if="showSettings" @close="showSettings = false" />
    <GameFormDialog v-if="visible" :game="editing" @close="closeGameEditor" />
  </aside>
</template>

<style scoped>
.side-panel {
  display: flex;
  flex-direction: column;
  flex: none;
  width: var(--doro-panel-width);
  height: 100%;
  padding: var(--doro-space-5) var(--doro-space-4);
  background: var(--doro-bg-panel);
  border-right: 1px solid var(--doro-border);
}

.side-top {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--doro-space-5);
  min-height: 0;
  overflow-y: auto;
}

.settings-btn {
  flex: none;
  align-self: flex-start;
  margin-top: var(--doro-space-3);
  padding: var(--doro-space-2);
  color: var(--doro-text-tertiary);
  font-size: 18px;
  line-height: 1;
  border-radius: var(--doro-radius-md);
  transition: all var(--doro-transition);
}

.settings-btn:hover {
  color: var(--doro-primary);
  background: var(--doro-bg-hover);
}
</style>
