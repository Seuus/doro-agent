// 游戏列表状态 + 扫描/卡片管理动作（模块级单例，全应用共享一份）
import { ref } from 'vue'

const games = ref([])
const scannedAt = ref(null)
const loading = ref(false)
const error = ref('')

async function scan() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const res = await window.doro.games.scan()
    if (!res?.ok) throw new Error(res?.message || '扫描失败')
    games.value = res.games
    scannedAt.value = res.scannedAt
  } catch (err) {
    error.value = `扫描失败：${err.message}`
  } finally {
    loading.value = false
  }
}

// 卡片管理动作：成功后统一重扫，左栏与设置面板的列表同步刷新
async function addManual(payload) {
  const res = await window.doro.games.addManual(payload)
  if (res?.ok) await scan()
  return res
}

async function updateManual(payload) {
  const res = await window.doro.games.updateManual(payload)
  if (res?.ok) await scan()
  return res
}

async function removeManual(id) {
  const res = await window.doro.games.removeManual(id)
  if (res?.ok) await scan()
  return res
}

async function setHidden(id, hidden) {
  const res = await window.doro.games.setHidden(id, hidden)
  if (res?.ok) await scan()
  return res
}

export function useGames() {
  return { games, scannedAt, loading, error, scan, addManual, updateManual, removeManual, setHidden }
}
