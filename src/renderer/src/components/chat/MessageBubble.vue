<!-- 单条消息气泡：按 role 切样式；AI 消息附带工具调用过程（可折叠） -->
<script setup>
import { computed } from 'vue'
import MarkdownBlock from './MarkdownBlock.vue'

const props = defineProps({
  message: { type: Object, required: true }
})

// 把 thought 事件（调用 + 结果两条）整理成「动作 ← 结果」列表
const toolSteps = computed(() => {
  const steps = []
  for (const t of props.message.thoughts || []) {
    if (t.observation != null) {
      if (steps.length) steps[steps.length - 1].result = t.observation
      else steps.push({ title: '', result: t.observation })
    } else if (t.thought != null) {
      steps.push({ title: t.thought || t.tool || '调用工具', result: '' })
    }
  }
  return steps
})
</script>

<template>
  <div class="message-row" :class="`role-${message.role}`">
    <div class="bubble" :class="{ 'is-error': message.status === 'error' }">
      <details v-if="message.role === 'assistant' && toolSteps.length" class="tool-trace">
        <summary>工具调用过程（{{ toolSteps.length }} 步）</summary>
        <ul class="tool-list">
          <li v-for="(s, i) in toolSteps" :key="i">
            <span class="tool-title">{{ s.title }}</span>
            <span v-if="s.result" class="tool-result">← {{ s.result }}</span>
          </li>
        </ul>
      </details>
      <!-- 用户消息按纯文本渲染；AI 回复走 Markdown -->
      <p v-if="message.role === 'user'" class="plain-text">{{ message.text }}</p>
      <MarkdownBlock v-else :content="message.text" />
    </div>
  </div>
</template>

<style scoped>
.message-row {
  display: flex;
}

.message-row.role-user {
  justify-content: flex-end;
}

.bubble {
  max-width: 78%;
  padding: var(--doro-space-3) var(--doro-space-4);
  border-radius: var(--doro-radius-lg);
}

.role-user .bubble {
  color: var(--doro-text-inverse);
  background: var(--doro-primary);
  border-bottom-right-radius: var(--doro-radius-sm);
}

.role-assistant .bubble {
  background: var(--doro-bg);
  border: 1px solid var(--doro-border);
  border-bottom-left-radius: var(--doro-radius-sm);
  box-shadow: var(--doro-shadow-sm);
}

.role-assistant .bubble.is-error {
  color: var(--doro-danger);
  background: var(--doro-danger-soft);
  border-color: var(--doro-danger-soft);
}

.plain-text {
  white-space: pre-wrap;
  word-break: break-word;
}

.tool-trace {
  margin-bottom: var(--doro-space-2);
  font-size: var(--doro-font-xs);
  color: var(--doro-text-tertiary);
}

.tool-trace summary {
  cursor: pointer;
  user-select: none;
}

.tool-list {
  margin-top: var(--doro-space-1);
  padding-left: var(--doro-space-3);
  list-style: disc;
}

.tool-list li {
  margin: var(--doro-space-1) 0;
  word-break: break-all;
}

.tool-title {
  color: var(--doro-text-secondary);
}

.tool-result {
  color: var(--doro-text-tertiary);
}
</style>
