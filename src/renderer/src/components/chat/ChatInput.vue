<!-- 多行输入框：Enter 发送 / Shift+Enter 换行，生成中显示停止按钮 -->
<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  disabled: { type: Boolean, default: false },
  streaming: { type: Boolean, default: false }
})

const emit = defineEmits(['send', 'stop'])

const text = ref('')
const inputEl = ref(null)
const canSend = computed(() => text.value.trim().length > 0 && !props.disabled)

function resize() {
  const el = inputEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`
}

function submit() {
  if (!canSend.value) return
  emit('send', text.value)
  text.value = ''
  resize()
}

function onKeydown(event) {
  if (event.key !== 'Enter') return
  // 中文输入法组词中，回车用于确认候选词，必须交还给输入法，否则会「选词即发送」
  if (event.isComposing || event.keyCode === 229) return
  if (event.shiftKey) return // Shift+Enter 换行
  event.preventDefault()
  submit()
}
</script>

<template>
  <footer class="chat-input">
    <div class="input-box">
      <textarea
        ref="inputEl"
        v-model="text"
        class="input-area"
        rows="1"
        placeholder="说点什么…"
        @input="resize"
        @keydown="onKeydown"
      ></textarea>

      <button v-if="streaming" class="action-btn stop" @click="emit('stop')">停止</button>
      <button v-else class="action-btn send" :disabled="!canSend" @click="submit">发送</button>
    </div>
    <p class="tip">Enter 发送 · Shift + Enter 换行</p>
  </footer>
</template>

<style scoped>
.chat-input {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: var(--doro-space-2);
  padding: var(--doro-space-4) var(--doro-space-6) var(--doro-space-3);
  background: var(--doro-bg);
  border-top: 1px solid var(--doro-border);
}

.input-box {
  display: flex;
  gap: var(--doro-space-3);
  align-items: flex-end;
  padding: var(--doro-space-2) var(--doro-space-2) var(--doro-space-2) var(--doro-space-4);
  background: var(--doro-bg-input);
  border: 1px solid var(--doro-border);
  border-radius: var(--doro-radius-lg);
  transition: border-color var(--doro-transition);
}

.input-box:focus-within {
  border-color: var(--doro-primary);
}

.input-area {
  flex: 1;
  min-height: 26px;
  max-height: 120px;
  padding: var(--doro-space-1) 0;
  line-height: 1.5;
  background: none;
  border: none;
  outline: none;
  resize: none;
}

.input-area::placeholder {
  color: var(--doro-text-tertiary);
}

.action-btn {
  flex: none;
  padding: 6px 16px;
  border-radius: var(--doro-radius-md);
  transition: all var(--doro-transition);
}

.action-btn.send {
  color: var(--doro-text-inverse);
  background: var(--doro-primary);
}

.action-btn.send:hover:not(:disabled) {
  background: var(--doro-primary-hover);
}

.action-btn.send:disabled {
  color: var(--doro-text-tertiary);
  background: var(--doro-bg-hover);
}

.action-btn.stop {
  color: var(--doro-danger);
  background: var(--doro-danger-soft);
}

.action-btn.stop:hover {
  background: #fbdcd9;
}

.tip {
  color: var(--doro-text-tertiary);
  font-size: var(--doro-font-xs);
  text-align: right;
}
</style>
