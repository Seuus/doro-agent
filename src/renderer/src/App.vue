<!-- 根布局：左侧固定宽度功能面板 + 右侧自适应对话区 -->
<script setup>
import SidePanel from './components/side/SidePanel.vue'
import ChatPanel from './components/chat/ChatPanel.vue'
</script>

<template>
  <div class="app-shell">
    <SidePanel />
    <ChatPanel />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  width: 100%;
  height: 100%;
  background: var(--doro-bg);
}
</style>
