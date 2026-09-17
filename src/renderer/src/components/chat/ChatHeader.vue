<!-- 对话区头部：Agent 名称 + 连接状态 -->
<script setup>
import { computed } from 'vue'
import { CHAT_STATUS_META } from '@shared/enums.mjs'
import StatusDot from '../common/StatusDot.vue'

const props = defineProps({
  status: { type: String, default: 'idle' } // idle | thinking | error
})

const meta = computed(() => CHAT_STATUS_META[props.status] || CHAT_STATUS_META.idle)
</script>

<template>
  <header class="chat-header">
    <div class="agent">
      <span class="avatar">d</span>
      <div class="agent-text">
        <span class="agent-name">dororo</span>
        <span class="agent-desc">你的游戏日常管家</span>
      </div>
    </div>
    <div class="status" :class="`tone-${meta.tone}`">
      <StatusDot :tone="meta.tone" :pulse="meta.pulse" />
      <span>{{ meta.label }}</span>
    </div>
  </header>
</template>

<style scoped>
.chat-header {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  height: var(--doro-header-height);
  padding: 0 var(--doro-space-6);
  background: var(--doro-bg);
  border-bottom: 1px solid var(--doro-border);
}

.agent {
  display: flex;
  gap: var(--doro-space-3);
  align-items: center;
}

.avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  color: var(--doro-text-inverse);
  font-weight: 600;
  background: var(--doro-primary);
  border-radius: var(--doro-radius-md);
}

.agent-text {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}

.agent-name {
  font-weight: 600;
}

.agent-desc {
  color: var(--doro-text-tertiary);
  font-size: var(--doro-font-xs);
}

.status {
  display: flex;
  gap: var(--doro-space-2);
  align-items: center;
  font-size: var(--doro-font-sm);
}

.status.tone-success {
  color: var(--doro-success);
}

.status.tone-warning {
  color: var(--doro-warning);
}

.status.tone-danger {
  color: var(--doro-danger);
}
</style>
