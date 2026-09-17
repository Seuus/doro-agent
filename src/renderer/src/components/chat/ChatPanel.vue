<!-- 右侧对话区：头部 / 消息列表 / 输入框 三段式（会话列表在左侧面板） -->
<script setup>
import { onMounted } from 'vue'
import { useChat } from '../../composables/useChat.js'
import ChatHeader from './ChatHeader.vue'
import MessageList from './MessageList.vue'
import ChatInput from './ChatInput.vue'

const { messages, chatStatus, currentThought, conversationId, send, stop, init } = useChat()

onMounted(init)
</script>

<template>
  <main class="chat-panel">
    <ChatHeader :status="chatStatus" />
    <!-- :key 绑会话 id：切会话时重挂载，滚动跟随状态（follow）自动复位 -->
    <MessageList
      :key="conversationId || 'none'"
      :messages="messages"
      :thinking="chatStatus === 'thinking'"
      :thought="currentThought"
    />
    <ChatInput :streaming="chatStatus === 'thinking'" @send="send" @stop="stop" />
  </main>
</template>

<style scoped>
.chat-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  background: var(--doro-bg-subtle);
}
</style>
