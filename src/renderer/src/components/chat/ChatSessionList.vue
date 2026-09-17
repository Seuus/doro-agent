<!-- 会话列表：新建对话 + 历史会话（点击切换，两段式确认删除） -->
<script setup>
import { ref } from 'vue'

defineProps({
  busy: { type: Boolean, default: false },
  conversations: { type: Array, default: () => [] },
  activeId: { type: String, default: null }
})

const emit = defineEmits(['select', 'create'])

const confirmingId = ref(null) // 两段式删除：第一次点变「确认删除?」，再点才真删
let confirmTimer = null

function onRemove(id) {
  if (confirmingId.value !== id) {
    confirmingId.value = id
    clearTimeout(confirmTimer)
    confirmTimer = setTimeout(() => (confirmingId.value = null), 3000)
    return
  }
  clearTimeout(confirmTimer)
  confirmingId.value = null
  emit('select', { id, remove: true })
}

function onMouseLeave(id) {
  if (confirmingId.value === id) {
    clearTimeout(confirmTimer)
    confirmingId.value = null
  }
}

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ts >= dayStart) return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (ts >= dayStart - 86400000) return '昨天'
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
</script>

<template>
  <aside class="session-list">
    <button class="new-btn" :disabled="busy" @click="emit('create')">＋ 新建对话</button>
    <ul class="sessions">
      <li
        v-for="c in conversations"
        :key="c.id"
        class="session-item"
        :class="{ active: c.id === activeId, disabled: busy }"
        @click="!busy && emit('select', { id: c.id })"
        @mouseleave="onMouseLeave(c.id)"
      >
        <span class="session-title" :title="c.title">{{ c.title }}</span>
        <span class="session-time">{{ formatTime(c.updatedAt) }}</span>
        <button class="session-del" :class="{ confirming: confirmingId === c.id }" @click.stop="onRemove(c.id)">
          {{ confirmingId === c.id ? '确认删除?' : '×' }}
        </button>
      </li>
    </ul>
    <p v-if="!conversations.length" class="empty">还没有历史会话</p>
  </aside>
</template>

<style scoped>
.session-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.new-btn {
  flex: none;
  margin-bottom: var(--doro-space-2);
  padding: var(--doro-space-2) var(--doro-space-3);
  color: var(--doro-primary);
  font-size: var(--doro-font-sm);
  background: var(--doro-primary-soft);
  border-radius: var(--doro-radius-md);
  transition: background var(--doro-transition);
}

.new-btn:hover {
  background: var(--doro-bg-hover);
}

.new-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.sessions {
  flex: 1;
  overflow-y: auto;
  list-style: none;
}

.session-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--doro-space-2);
  padding: var(--doro-space-2) var(--doro-space-3);
  border-radius: var(--doro-radius-md);
  cursor: pointer;
  transition: background var(--doro-transition);
}

.session-item:hover {
  background: var(--doro-bg-hover);
}

.session-item.active {
  background: var(--doro-primary-soft);
}

.session-item.disabled {
  pointer-events: none;
  opacity: 0.7;
}

.session-title {
  flex: 1;
  overflow: hidden;
  font-size: var(--doro-font-sm);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.session-item.active .session-title {
  font-weight: 600;
}

.session-time {
  flex: none;
  color: var(--doro-text-tertiary);
  font-size: var(--doro-font-xs);
}

.session-del {
  position: absolute;
  right: var(--doro-space-2);
  display: none;
  padding: 2px var(--doro-space-2);
  color: var(--doro-text-tertiary);
  font-size: var(--doro-font-xs);
  background: var(--doro-bg-card);
  border-radius: var(--doro-radius-sm);
}

.session-item:hover .session-del {
  display: block;
}

.session-del:hover {
  color: var(--doro-danger);
}

.session-del.confirming {
  color: var(--doro-danger);
  background: var(--doro-danger-soft);
}

.empty {
  padding: var(--doro-space-3);
  color: var(--doro-text-tertiary);
  font-size: var(--doro-font-xs);
  text-align: center;
}
</style>
