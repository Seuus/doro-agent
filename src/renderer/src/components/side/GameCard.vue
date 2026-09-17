<!-- 单个游戏条目：图标 + 名称、厂商、上次登录时间、今日状态徽标；悬停显示 编辑/删除（手动）或 隐藏（自动） -->
<script setup>
import { computed } from 'vue'
import { GAME_STATUS_META } from '@shared/enums.mjs'
import StatusDot from '../common/StatusDot.vue'
import { formatTime } from '../../utils/time-format.js'

const props = defineProps({
  game: { type: Object, required: true }
})

const emit = defineEmits(['edit', 'remove', 'hide'])

const meta = computed(() => GAME_STATUS_META[props.game.status] || GAME_STATUS_META.unknown)

// 图标约定：assets/games/<游戏id>.png（取自游戏本体 exe 的图标），
// glob 自动匹配，新增图标只需丢文件；手动添加的条目带 iconDataUrl（自定义图标）；
// 都没有时用游戏名首字兜底
const iconModules = import.meta.glob('../../assets/games/*.png', {
  eager: true,
  query: '?url',
  import: 'default'
})
const ICON_URLS = Object.fromEntries(
  Object.entries(iconModules).map(([path, url]) => [path.split('/').pop().replace('.png', ''), url])
)

const iconSrc = computed(() => props.game.iconDataUrl || ICON_URLS[props.game.id] || '')
const initial = computed(() => props.game.name.slice(0, 1))

// tooltip 暴露命中的日志与规则，排查「这个游戏状态为什么不对」时一眼可见
const tooltip = computed(() =>
  [
    `日志：${props.game.logPath || '未命中'}`,
    `规则：${props.game.matchedBy || '—'}`
  ].join('\n')
)
</script>

<template>
  <article class="game-card" :title="tooltip">
    <img v-if="iconSrc" class="game-icon" :src="iconSrc" :alt="game.name" />
    <span v-else class="game-icon icon-fallback">{{ initial }}</span>

    <div class="card-body">
      <div class="card-row">
        <span class="game-name">{{ game.name }}</span>
        <span class="badge" :class="`tone-${meta.tone}`">
          <StatusDot :tone="meta.tone" />
          {{ meta.label }}
        </span>
      </div>
      <div class="card-row sub">
        <span class="vendor">{{ game.vendor }}</span>
        <span class="login-time">上次登录 {{ formatTime(game.lastLoginAt) }}</span>
      </div>
    </div>

    <div class="card-ops">
      <template v-if="game.manual">
        <button class="card-ops-btn" @click.stop="emit('edit')">编辑</button>
        <button class="card-ops-btn danger" @click.stop="emit('remove')">删除</button>
      </template>
      <button v-else class="card-ops-btn" @click.stop="emit('hide')">隐藏</button>
    </div>
  </article>
</template>

<style scoped>
.game-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--doro-space-3);
  padding: var(--doro-space-3);
  background: var(--doro-bg-card);
  border: 1px solid transparent;
  border-radius: var(--doro-radius-md);
  transition: background var(--doro-transition);
}

.game-card:hover {
  background: var(--doro-bg-hover);
}

/* 操作按钮从右上角浮出；悬停时让出位置给状态徽标（占位保留,避免跳动） */
.card-ops {
  position: absolute;
  top: 6px;
  right: 6px;
  display: none;
  gap: 4px;
}

.game-card:hover .card-ops {
  display: flex;
}

.game-card:hover .badge {
  visibility: hidden;
}

.card-ops-btn {
  padding: 1px 8px;
  color: var(--doro-text-secondary);
  font-size: var(--doro-font-xs);
  background: var(--doro-bg);
  border-radius: var(--doro-radius-pill);
  box-shadow: var(--doro-shadow-sm);
  transition: all var(--doro-transition);
}

.card-ops-btn:hover {
  color: var(--doro-primary);
  background: var(--doro-primary-soft);
}

.card-ops-btn.danger:hover {
  color: var(--doro-danger);
  background: var(--doro-danger-soft);
}

.game-icon {
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  object-fit: cover;
}

.icon-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--doro-text-secondary);
  font-size: var(--doro-font-lg);
  font-weight: 600;
  background: var(--doro-bg-hover);
}

.card-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--doro-space-1);
  min-width: 0;
}

.card-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--doro-space-2);
}

.card-row.sub {
  color: var(--doro-text-tertiary);
  font-size: var(--doro-font-sm);
}

.game-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badge {
  display: inline-flex;
  flex: none;
  gap: var(--doro-space-1);
  align-items: center;
  padding: 1px 8px;
  font-size: var(--doro-font-xs);
  border-radius: var(--doro-radius-pill);
}

.badge.tone-success {
  color: var(--doro-success);
  background: var(--doro-success-soft);
}

.badge.tone-warning {
  color: var(--doro-warning);
  background: var(--doro-warning-soft);
}

.badge.tone-neutral {
  color: var(--doro-text-secondary);
  background: var(--doro-neutral-soft);
}
</style>
