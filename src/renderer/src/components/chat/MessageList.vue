<!-- 消息滚动区：自动滚动到底部，用户上滑后暂停跟随 -->
<script setup>
import { nextTick, onMounted, ref, watch } from 'vue'
import MessageBubble from './MessageBubble.vue'
import ThinkingIndicator from './ThinkingIndicator.vue'

const props = defineProps({
  messages: { type: Array, default: () => [] },
  thinking: { type: Boolean, default: false },
  thought: { type: Object, default: null }
})

const listEl = ref(null)
let follow = true // 用户上滑查看历史后暂停跟随

function onScroll() {
  const el = listEl.value
  if (!el) return
  follow = el.scrollHeight - el.scrollTop - el.clientHeight < 40
}

async function scrollToBottom() {
  if (!follow) return
  await nextTick()
  const el = listEl.value
  if (el) el.scrollTop = el.scrollHeight
}

// 只盯最后一条消息的文本长度与思考状态，避免流式追加时的高频重渲染
watch(
  () => [props.messages[props.messages.length - 1]?.text, props.thinking],
  scrollToBottom
)

watch(() => props.messages.length, scrollToBottom)

// 切会话时组件整体重挂载（:key=conversationId），watcher 不触发，需主动滚底
onMounted(scrollToBottom)
</script>

<template>
  <div ref="listEl" class="message-list" @scroll="onScroll">
    <div v-if="messages.length === 0" class="empty">
      <p class="empty-title">和 dororo 说点什么吧</p>
      <p class="empty-sub">可以问我今天的游戏日常做了没</p>
    </div>

    <MessageBubble v-for="message in messages" :key="message.id" :message="message" />

    <div v-if="thinking && messages[messages.length - 1]?.text === ''" class="message-row role-assistant">
      <ThinkingIndicator :thought="thought" />
    </div>
  </div>
</template>

<style scoped>
.message-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--doro-space-4);
  min-height: 0;
  padding: var(--doro-space-5) var(--doro-space-6);
  overflow-y: auto;
}

.message-row {
  display: flex;
}

.message-row.role-assistant {
  justify-content: flex-start;
}

.empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--doro-space-1);
  align-items: center;
  justify-content: center;
  color: var(--doro-text-secondary);
}

.empty-title {
  font-size: var(--doro-font-lg);
}

.empty-sub {
  color: var(--doro-text-tertiary);
  font-size: var(--doro-font-sm);
}
</style>
