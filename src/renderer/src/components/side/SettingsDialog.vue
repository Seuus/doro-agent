<!-- 设置面板：对话模型接口、游戏卡片管理、对话记忆、数据目录 -->
<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useChat } from '../../composables/useChat.js'
import { useGames } from '../../composables/useGames.js'
import { openGameEditor } from '../../composables/useGameEditor.js'

const emit = defineEmits(['close'])

const { reset, messages } = useChat()
const { games, scan, removeManual, setHidden } = useGames()

const scanning = ref(false)

async function scanGames() {
  if (scanning.value) return
  scanning.value = true
  cardStatus.value = '正在扫描…'
  try {
    await scan()
    cardStatus.value = '扫描完成'
  } finally {
    scanning.value = false
  }
}

const dataDir = ref('')
const clearing = ref(false)
const confirmingClear = ref(false) // 两段式确认，防误点删掉当前会话
let clearTimer = null

// 对话模型接口表单
const modelBaseUrl = ref('')
const modelApiKey = ref('')
const modelName = ref('')
const showKey = ref(false)
const modelStatus = ref('')
const modelBusy = ref(false)

// 卡片管理
const cardStatus = ref('')

const manualGames = computed(() => games.value.filter((g) => g.manual))
const hiddenGames = computed(() => games.value.filter((g) => g.hidden))

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  const res = await window.doro.app.info()
  if (res?.ok) {
    dataDir.value = res.dataDir
    modelBaseUrl.value = res.model?.baseUrl || ''
    modelApiKey.value = res.model?.apiKey || ''
    modelName.value = res.model?.model || ''
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  clearTimeout(clearTimer)
})

function onKeydown(e) {
  if (e.key === 'Escape') emit('close')
}

function clearMemory() {
  if (clearing.value) return
  if (!confirmingClear.value) {
    confirmingClear.value = true
    clearTimer = setTimeout(() => (confirmingClear.value = false), 3000)
    return
  }
  clearTimeout(clearTimer)
  confirmingClear.value = false
  clearing.value = true
  reset().finally(() => (clearing.value = false))
}

function openDataDir() {
  window.doro.app.openDataDir()
}

function toggleKey() {
  showKey.value = !showKey.value
}

async function saveModel() {
  if (modelBusy.value) return
  modelBusy.value = true
  modelStatus.value = ''
  try {
    const res = await window.doro.app.updateModel({
      baseUrl: modelBaseUrl.value,
      apiKey: modelApiKey.value,
      model: modelName.value
    })
    if (!res?.ok) {
      modelStatus.value = res?.message || '保存失败'
      return
    }
    modelStatus.value = res.changed ? '已保存（旧会话保留，可续聊）' : '已保存（内容无变化）'
  } finally {
    modelBusy.value = false
  }
}

async function testModel() {
  if (modelBusy.value) return
  modelBusy.value = true
  modelStatus.value = '正在测试连接…'
  try {
    const res = await window.doro.app.testModel({
      baseUrl: modelBaseUrl.value,
      apiKey: modelApiKey.value,
      model: modelName.value
    })
    modelStatus.value = res?.message || '连接失败'
  } finally {
    modelBusy.value = false
  }
}

async function onRemoveManual(id) {
  const res = await removeManual(id)
  if (!res?.ok) cardStatus.value = res?.message || '移除失败'
}

async function onRestore(id) {
  const res = await setHidden(id, false)
  if (!res?.ok) cardStatus.value = res?.message || '恢复失败'
}
</script>

<template>
  <div class="dialog-mask" @click.self="emit('close')">
    <div class="dialog">
      <header class="dialog-head">
        <span class="dialog-title">设置</span>
        <button class="close-btn" title="关闭" @click="emit('close')">×</button>
      </header>

      <div class="dialog-body">
        <section class="card">
          <p class="card-name">对话模型接口</p>
          <label class="field">
            <span class="field-label">服务地址</span>
            <input v-model="modelBaseUrl" class="field-input" placeholder="https://api.deepseek.com/v1" spellcheck="false" />
          </label>
          <label class="field">
            <span class="field-label">API Key</span>
            <span class="key-wrap">
              <input
                v-model="modelApiKey"
                class="field-input"
                :type="showKey ? 'text' : 'password'"
                placeholder="sk-…（本地 Ollama 可留空）"
                spellcheck="false"
              />
              <button class="key-toggle" @click="toggleKey">{{ showKey ? '隐藏' : '显示' }}</button>
            </span>
          </label>
          <label class="field">
            <span class="field-label">模型名</span>
            <input v-model="modelName" class="field-input" placeholder="deepseek-chat" spellcheck="false" />
          </label>
          <div class="card-actions">
            <span class="status" :title="modelStatus">{{ modelStatus }}</span>
            <button class="card-btn ghost" :disabled="modelBusy" @click="testModel">测试连接</button>
            <button class="card-btn" :disabled="modelBusy" @click="saveModel">保存</button>
          </div>
        </section>

        <section class="card">
          <p class="card-name">游戏卡片管理</p>
          <p class="card-desc">不依赖自动扫描：自选日志文件手动添加；手动卡片可在卡片上编辑 / 删除，自动扫描的卡片可隐藏</p>
          <div class="card-actions">
            <span class="status" :title="cardStatus">{{ cardStatus }}</span>
            <button class="card-btn ghost" :disabled="scanning" @click="scanGames">
              {{ scanning ? '扫描中…' : '扫描本地文件' }}
            </button>
            <button class="card-btn" @click="openGameEditor()">添加游戏</button>
          </div>

          <ul v-if="manualGames.length" class="mini-list">
            <li v-for="g in manualGames" :key="g.id" class="mini-item">
              <img v-if="g.iconDataUrl" class="mini-icon" :src="g.iconDataUrl" alt="" />
              <span v-else class="mini-icon mini-initial">{{ g.name.slice(0, 1) }}</span>
              <span class="mini-name" :title="g.logPath">{{ g.name }}</span>
              <button class="mini-btn" @click="onRemoveManual(g.id)">移除</button>
            </li>
          </ul>

          <template v-if="hiddenGames.length">
            <p class="card-desc hidden-title">已隐藏的游戏</p>
            <ul class="mini-list">
              <li v-for="g in hiddenGames" :key="g.id" class="mini-item">
                <img v-if="g.iconDataUrl" class="mini-icon" :src="g.iconDataUrl" alt="" />
                <span v-else class="mini-icon mini-initial">{{ g.name.slice(0, 1) }}</span>
                <span class="mini-name" :title="g.logPath">{{ g.name }}</span>
                <button class="mini-btn" @click="onRestore(g.id)">恢复</button>
              </li>
            </ul>
          </template>
        </section>

        <section class="card">
          <p class="card-name">当前会话</p>
          <p class="card-desc">
            {{ messages.length ? 'AI 记得本会话的对话内容；历史会话都在对话区左侧列表里' : '本会话还是空的；历史会话都在对话区左侧列表里' }}
          </p>
          <button class="card-btn" :disabled="!messages.length || clearing" @click="clearMemory">
            {{ clearing ? '清空中…' : confirmingClear ? '确认清空?' : '清空当前会话' }}
          </button>
        </section>

        <section class="card">
          <p class="card-name">数据目录</p>
          <p class="card-desc path" :title="dataDir">{{ dataDir || '读取中…' }}</p>
          <button class="card-btn" @click="openDataDir">打开目录</button>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.key-wrap {
  display: flex;
  flex: 1;
  gap: var(--doro-space-2);
  min-width: 0;
}

.key-toggle {
  flex: none;
  color: var(--doro-text-tertiary);
  font-size: var(--doro-font-xs);
}

.key-toggle:hover {
  color: var(--doro-text);
}

.hidden-title {
  padding-top: var(--doro-space-2);
  border-top: 1px solid var(--doro-border);
}

.mini-list {
  display: flex;
  flex-direction: column;
  gap: var(--doro-space-1);
  list-style: none;
}

.mini-item {
  display: flex;
  gap: var(--doro-space-2);
  align-items: center;
}

.mini-icon {
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  object-fit: cover;
}

.mini-initial {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--doro-text-secondary);
  font-size: var(--doro-font-xs);
  background: var(--doro-bg-hover);
}

.mini-name {
  flex: 1;
  overflow: hidden;
  font-size: var(--doro-font-sm);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mini-btn {
  flex: none;
  color: var(--doro-text-tertiary);
  font-size: var(--doro-font-xs);
}

.mini-btn:hover {
  color: var(--doro-primary);
}
</style>
