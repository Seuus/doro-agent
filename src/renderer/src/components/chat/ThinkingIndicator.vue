<!-- 思考中指示器：三点动画 + 当前工具名或思考摘要 -->
<script setup>
import { computed } from 'vue'

const props = defineProps({
  thought: { type: Object, default: null } // 最近一条 agent_thought 事件
})

const label = computed(() => {
  const t = props.thought
  if (!t) return '思考中…'
  if (t.tool) return `正在调用 ${t.tool}`
  return t.thought || '思考中…'
})
</script>

<template>
  <div class="thinking">
    <span class="dots"><i></i><i></i><i></i></span>
    <span class="label">{{ label }}</span>
  </div>
</template>

<style scoped>
.thinking {
  display: flex;
  gap: var(--doro-space-3);
  align-items: center;
  padding: var(--doro-space-3) var(--doro-space-4);
  color: var(--doro-text-secondary);
  font-size: var(--doro-font-sm);
  background: var(--doro-bg);
  border: 1px solid var(--doro-border);
  border-radius: var(--doro-radius-lg);
  border-bottom-left-radius: var(--doro-radius-sm);
  box-shadow: var(--doro-shadow-sm);
}

.dots {
  display: inline-flex;
  gap: 3px;
}

.dots i {
  width: 5px;
  height: 5px;
  background: var(--doro-text-tertiary);
  border-radius: 50%;
  animation: doro-blink 1.2s ease-in-out infinite;
}

.dots i:nth-child(2) {
  animation-delay: 0.2s;
}

.dots i:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes doro-blink {
  0%,
  80%,
  100% {
    opacity: 0.25;
  }
  40% {
    opacity: 1;
  }
}
</style>
