// 状态枚举：集中定义「状态 → 中文文案 → 颜色 tone」映射，避免魔法值散落各组件
export const GAME_STATUS_META = {
  done: { label: '已完成', tone: 'success' },
  todo: { label: '未完成', tone: 'warning' },
  unknown: { label: '未知', tone: 'neutral' }
}

export const CHAT_STATUS_META = {
  idle: { label: '在线', tone: 'success' },
  thinking: { label: '思考中', tone: 'warning', pulse: true },
  error: { label: '出错', tone: 'danger' }
}
