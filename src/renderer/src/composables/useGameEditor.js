// 添加/编辑游戏弹窗状态（模块级单例）：任意位置调 openGameEditor，SidePanel 里渲染唯一实例
import { ref } from 'vue'

const visible = ref(false)
const editing = ref(null) // null = 添加模式；对象 = 编辑该条目

export function openGameEditor(game = null) {
  editing.value = game
  visible.value = true
}

export function closeGameEditor() {
  visible.value = false
  editing.value = null
}

export function useGameEditor() {
  return { visible, editing, openGameEditor, closeGameEditor }
}
