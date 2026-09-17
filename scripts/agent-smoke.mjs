// 本地 agent 引擎冒烟：v3 搜索打分与结果格式（纯逻辑，不依赖 Electron）
// 用法：node scripts/agent-smoke.mjs
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { formatSearchResult, searchIndex } from '../src/main/tools/file-index.mjs'
import { analyzeQuery, editDistance, normalize } from '../src/main/tools/text-util.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

console.log('== 归一化/拆词 ==')
const cases = [
  // 「的日志」是 Java v3 原版行为：去噪只剥首尾，中间的「的」不拆
  ['帮我找找 终末地 的日志文件在哪里', ['终末地', '的日志']],
  ['maafw.log 在哪儿', ['maafw.log']],
  ['北极星 文件', ['北极星']]
]
for (const [q, want] of cases) {
  const terms = analyzeQuery(q)
  console.log(q, '→', JSON.stringify(terms))
  if (JSON.stringify(terms) !== JSON.stringify(want)) console.log(`  ✗ 期望 ${JSON.stringify(want)}`)
}

console.log('== 编辑距离 ==')
console.log('北极星 vs 北极屋 d1 =', editDistance('北极星', '北极屋', 1), '（期望 1）')
console.log('abcdefg vs abcdefg d1 =', editDistance('abcdefg', 'abcdefg', 1), '（期望 0）')

// 构造一棵假文件树：与真实盘符路径结构一致
const snap = {
  entries: [
    { path: 'E:\\MaaEnd-win-x86_64-v2.27.0\\debug\\maafw.log' },
    { path: 'E:\\MaaEnd-win-x86_64-v2.27.0\\MaaEnd.exe' },
    { path: 'D:\\Hypergryph Launcher\\games\\Arknights Endfield\\Endfield.exe' },
    { path: 'E:\\docs\\index.tsv' },
    { path: 'E:\\KuGou\\lyrics\\螺旋.txt' },
    { path: 'C:\\Windows\\System32\\screenshot.dll' }
  ]
}

console.log('\n== 搜索用例 ==')
const run = (q) => {
  const res = formatSearchResult(searchIndex(snap, q))
  console.log(`「${q}」→`, JSON.stringify(res))
  return res
}
run('终末地') // 期望 none：假树里没有该名字的文件（防止乱给）
run('maafw.log') // 期望 direct → maafw.log
run('maafw 日志') // 期望 none：多关键词必须全命中，"日志" 不在路径里（防外行命中，v3 原版设计）
run('Endfield') // 期望 direct → Endfield.exe
run('kugou 歌词') // 期望 none：同上，"歌词" 不在路径里
run('螺旋 9lana') // 期望 none（多关键词不全命中）
run('柊魔地') // 期望 none（3 字 CJK 不做容错）
run('Maafwb') // 期望 fuzzy：拉丁 ≥5 词允许 d≤1（名近 maafw.log）
run('maafw.log 在哪') // 期望 direct
run('随机截图') // 期望 none，不给 screenshot.dll
console.log('\n（提示：真实全盘索引由应用启动时构建，此处只验证打分与格式）')
