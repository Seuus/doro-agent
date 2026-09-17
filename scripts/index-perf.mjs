// 全盘索引实测：构建耗时 + 真实查询效果（纯 Node，不依赖 Electron）
// 用法：node scripts/index-perf.mjs [查询1] [查询2] ...
import { buildSnapshot, formatSearchResult, searchIndex, stats } from '../src/main/tools/file-index.mjs'

const queries = process.argv.slice(2)
const list = queries.length ? queries : ['maafw.log', 'Endfield', '终末地', 'sdklogs', 'Arknights']

const t0 = Date.now()
const snap = await buildSnapshot()
console.log(`索引构建：${snap.entries.length} 个文件，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)

for (const q of list) {
  const t = Date.now()
  const res = formatSearchResult(searchIndex(snap, q))
  console.log(`\n「${q}」（${Date.now() - t}ms）`, JSON.stringify(res, null, 0))
}
console.log('\nstats:', JSON.stringify(stats()))
