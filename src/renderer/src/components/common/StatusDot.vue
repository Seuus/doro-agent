<!-- 状态小圆点：左栏游戏条目与对话头部共用 -->
<script setup>
defineProps({
  tone: { type: String, default: 'neutral' }, // success | warning | danger | neutral
  pulse: { type: Boolean, default: false }
})
</script>

<template>
  <span class="status-dot" :class="[`tone-${tone}`, { pulse }]"></span>
</template>

<style scoped>
.status-dot {
  display: inline-block;
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.tone-success {
  background: var(--doro-success);
}

.tone-warning {
  background: var(--doro-warning);
}

.tone-danger {
  background: var(--doro-danger);
}

.tone-neutral {
  background: var(--doro-neutral);
}

.pulse {
  animation: doro-pulse 1.4s ease-in-out infinite;
}

@keyframes doro-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.45;
    transform: scale(0.8);
  }
}
</style>
