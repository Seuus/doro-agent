<!-- AI 回复的 Markdown 渲染，链接点击转交主进程用系统浏览器打开 -->
<script setup>
import { computed } from 'vue'
import { renderMarkdown } from '../../utils/markdown.js'

const props = defineProps({
  content: { type: String, default: '' }
})

const html = computed(() => renderMarkdown(props.content))

// 事件委托：不在窗口内导航，也不给 file:// 等协议留口子（协议白名单在主进程里）
function onClick(event) {
  const link = event.target.closest('a[href]')
  if (!link) return
  event.preventDefault()
  window.doro.app.openExternal(link.getAttribute('href'))
}
</script>

<template>
  <div class="markdown-body" v-html="html" @click="onClick"></div>
</template>
