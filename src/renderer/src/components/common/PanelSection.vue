<!-- 左栏分区外壳：标题 + 右侧动作槽 + 内容槽 -->
<script setup>
defineProps({
  title: { type: String, required: true },
  loading: { type: Boolean, default: false }
})
</script>

<template>
  <section class="panel-section">
    <header class="section-head">
      <h2 class="section-title">{{ title }}</h2>
      <div class="section-actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="section-body" :class="{ 'is-loading': loading }">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.panel-section {
  display: flex;
  flex-direction: column;
  gap: var(--doro-space-3);
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 22px;
}

.section-actions {
  display: flex;
  gap: var(--doro-space-2);
  align-items: center;
}

.section-title {
  font-size: var(--doro-font-base);
  font-weight: 600;
  color: var(--doro-text);
}

.section-body {
  display: flex;
  flex-direction: column;
  gap: var(--doro-space-2);
  transition: opacity var(--doro-transition);
}

.section-body.is-loading {
  opacity: 0.55;
}
</style>
