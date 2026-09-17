<!-- 游戏日志监控区：列表 / 空态 / 加载态 / 错误态；标题栏可添加游戏卡片 -->
<script setup>
import { computed, onMounted } from 'vue'
import { useGames } from '../../composables/useGames.js'
import { openGameEditor } from '../../composables/useGameEditor.js'
import { formatClock } from '../../utils/time-format.js'
import PanelSection from '../common/PanelSection.vue'
import GameCard from './GameCard.vue'

const { games, scannedAt, loading, error, scan, removeManual, setHidden } = useGames()

// 隐藏的条目留在数据里（设置面板可恢复），只在面板上不显示
const visibleGames = computed(() => games.value.filter((g) => !g.hidden))

onMounted(scan)

function onRemove(game) {
  removeManual(game.id)
}

function onHide(game) {
  setHidden(game.id, true)
}
</script>

<template>
  <PanelSection title="游戏日志监控" :loading="loading">
    <template #actions>
      <button class="head-btn accent" @click="openGameEditor()">添加</button>
      <button class="head-btn" :disabled="loading" @click="scan">
        {{ loading ? '扫描中…' : '刷新' }}
      </button>
    </template>

    <p v-if="error" class="hint hint-error">{{ error }}</p>

    <div v-else-if="!loading && visibleGames.length === 0" class="hint">
      {{ games.length > 0 ? '游戏已全部隐藏' : '未发现可识别的游戏日志' }}
      <span class="hint-sub">
        {{ games.length > 0 ? '可在「设置 → 游戏卡片管理」中恢复显示' : '打开游戏并登录一次后，这里会自动出现记录' }}
      </span>
    </div>

    <template v-else>
      <GameCard
        v-for="game in visibleGames"
        :key="game.id"
        :game="game"
        @edit="openGameEditor(game)"
        @remove="onRemove(game)"
        @hide="onHide(game)"
      />
      <p v-if="scannedAt && !loading" class="scanned-at">上次扫描 {{ formatClock(scannedAt) }}</p>
    </template>
  </PanelSection>
</template>

<style scoped>
.head-btn {
  padding: 2px 10px;
  color: var(--doro-text-secondary);
  font-size: var(--doro-font-sm);
  background: var(--doro-bg-card);
  border-radius: var(--doro-radius-pill);
  transition: all var(--doro-transition);
}

.head-btn:hover:not(:disabled) {
  color: var(--doro-text);
  background: var(--doro-bg-hover);
}

.head-btn:disabled {
  color: var(--doro-text-tertiary);
}

.head-btn.accent {
  color: var(--doro-primary);
  background: var(--doro-primary-soft);
}

.head-btn.accent:hover {
  color: var(--doro-text-inverse);
  background: var(--doro-primary);
}

.hint {
  display: flex;
  flex-direction: column;
  gap: var(--doro-space-1);
  padding: var(--doro-space-4) var(--doro-space-3);
  color: var(--doro-text-secondary);
  font-size: var(--doro-font-sm);
  text-align: center;
  background: var(--doro-bg-card);
  border-radius: var(--doro-radius-md);
}

.hint-sub {
  color: var(--doro-text-tertiary);
  font-size: var(--doro-font-xs);
}

.hint-error {
  color: var(--doro-danger);
  background: var(--doro-danger-soft);
}

.scanned-at {
  color: var(--doro-text-tertiary);
  font-size: var(--doro-font-xs);
  text-align: right;
}
</style>
