<!-- 添加 / 编辑游戏弹窗：面板「添加」、卡片「编辑」、设置面板共用同一套表单 -->
<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useGames } from '../../composables/useGames.js'

const props = defineProps({
  game: { type: Object, default: null } // 传入条目 = 编辑模式；null = 添加模式
})

const emit = defineEmits(['close'])

const { addManual, updateManual } = useGames()

const isEdit = computed(() => !!props.game)
const hasIcon = computed(() => !!props.game?.iconDataUrl)

const form = ref({
  name: props.game?.name || '',
  vendor: props.game?.vendor || '',
  filePath: props.game?.logPath || '',
  iconPath: '' // 编辑模式下留空 = 保留原有图标
})
const clearIcon = ref(false) // 编辑模式：显式移除原有图标
const status = ref('')
const saving = ref(false)

const iconText = computed(() => {
  if (form.value.iconPath) return form.value.iconPath
  if (isEdit.value && hasIcon.value && !clearIcon.value) return '已设置（选择可替换）'
  return '未选择（用名称首字）'
})

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

function onKeydown(e) {
  if (e.key === 'Escape') emit('close')
}

async function pickLogFile() {
  const res = await window.doro.app.pickFile('log')
  if (res?.ok && res.path) form.value.filePath = res.path
}

async function pickIconFile() {
  const res = await window.doro.app.pickFile('image')
  if (res?.ok && res.path) {
    form.value.iconPath = res.path
    clearIcon.value = false
  }
}

function clearIconNow() {
  clearIcon.value = true
  form.value.iconPath = ''
}

async function save() {
  if (saving.value) return
  saving.value = true
  status.value = ''
  try {
    const res = isEdit.value
      ? await updateManual({ id: props.game.id, ...form.value, clearIcon: clearIcon.value })
      : await addManual({ ...form.value })
    if (!res?.ok) {
      status.value = res?.message || '保存失败'
      return
    }
    emit('close')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="dialog-mask mask-top" @click.self="emit('close')">
    <div class="dialog">
      <header class="dialog-head">
        <span class="dialog-title">{{ isEdit ? '编辑游戏' : '添加游戏' }}</span>
        <button class="close-btn" title="关闭" @click="emit('close')">×</button>
      </header>

      <div class="dialog-body">
        <section class="card">
          <p class="card-desc">指定游戏的日志文件，按通用登录特征自动判定，无需为该游戏写适配</p>
          <div class="field-row">
            <label class="field">
              <span class="field-label">名称</span>
              <input v-model="form.name" class="field-input" placeholder="游戏名称" />
            </label>
            <label class="field">
              <span class="field-label">厂商</span>
              <input v-model="form.vendor" class="field-input" placeholder="选填" />
            </label>
          </div>
          <div class="field">
            <span class="field-label">日志文件</span>
            <span class="file-wrap">
              <span class="file-path" :title="form.filePath">{{ form.filePath || '未选择' }}</span>
              <button class="card-btn ghost" @click="pickLogFile">选择…</button>
            </span>
          </div>
          <div class="field">
            <span class="field-label">图标</span>
            <span class="file-wrap">
              <span class="file-path" :title="iconText">{{ iconText }}</span>
              <button class="card-btn ghost" @click="pickIconFile">选择…</button>
              <button
                v-if="isEdit && hasIcon && !clearIcon && !form.iconPath"
                class="card-btn ghost"
                @click="clearIconNow"
              >
                清除
              </button>
            </span>
          </div>
          <div class="card-actions">
            <span class="status" :title="status">{{ status }}</span>
            <button class="card-btn" :disabled="saving" @click="save">{{ isEdit ? '保存' : '添加' }}</button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 编辑从设置面板里唤起时,不能被设置面板盖住 */
.mask-top {
  z-index: 110;
}
</style>
