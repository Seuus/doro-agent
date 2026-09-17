// 工具注册表：schema（给模型看）与 handler（本地执行）的唯一来源
// 全部在 Electron 主进程进程内执行，没有常驻服务、没有外部依赖
import { buildSnapshot, formatSearchResult, getSnapshot, searchIndex, stats, invalidate } from './file-index.mjs'
import { grepTool, readFileTool } from './file-ops.mjs'
import { initTools, listActionsTool, runActionTool } from './actions.mjs'
import { scanAllGames } from '../../shared/games/scanner.mjs'
import { readSettings } from '../store/settings.mjs'

export { initTools }

export const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'dorosearch',
      description:
        '按名称/路径关键词搜索本机文件（D盘、E盘全盘索引），返回最可能的文件或目录路径。' +
        '用户问「文件在哪」「找一下 XX」时优先用它。关键词建议用「文件名核心词」，英文文件名就用英文（如 endfield、maafw），中文目录用中文。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词，自然语言短语也可以（如「终末地的日志文件」「maafw.log」）' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'dororead',
      description:
        '读取文本文件的内容（按行，带行号）。先用 dorosearch 拿到路径再用它。' +
        '单次最多 2000 行、单行超 2000 字符会截断；读不完时结果里会给出继续读的 start 参数。二进制文件会被拒绝。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件的完整路径' },
          start: { type: 'integer', description: '从第几行开始读（1 起，默认 1）' },
          limit: { type: 'integer', description: '最多读多少行（默认 2000，上限 5000）' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'dorogrep',
      description:
        '在目录内按内容搜索（正则，忽略大小写）。用于「日志里报了什么错」「某段内容在哪个文件」这类问题。' +
        '先用 dorosearch 拿到文件所在目录，再用 dir 传入。mode 默认只返回命中文件列表；要直接看命中行内容时传 content。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '搜索模式（正则或普通文本）' },
          dir: { type: 'string', description: '要搜索的目录，如某个游戏的日志目录' },
          glob: { type: 'string', description: '文件名过滤，如 *.log（默认全部）' },
          mode: { type: 'string', enum: ['files', 'content'], description: 'files=只返回文件列表（省 token），content=返回命中行（默认 files）' },
          maxResults: { type: 'integer', description: '最多返回多少个命中文件（默认 50）' }
        },
        required: ['pattern', 'dir']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'dorogame',
      description:
        '查询游戏今日登录/日常状态（扫描本机游戏日志得出，和左栏卡片同源）。不传 game 时返回所有已识别游戏；' +
        '注意 today 是「凌晨 4 点后是否登录过」的近似判断，只能说明上过号，不能证明日常跑完。',
      parameters: {
        type: 'object',
        properties: {
          game: { type: 'string', description: '游戏名（模糊匹配），不传则查全部' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'dorolist',
      description: '列出本机登记好的脚本动作（可让 AI 代执行的任务，如「终末地日常」）',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'dororun',
      description:
        '执行一个已登记的脚本动作并等待完成判定（可能耗时几十分钟）。用户明确要求执行某个动作时用它；' +
        '不确定动作名时先 dorolist。执行前应让用户确认。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: '动作名（与 dorolist 里的一致）' }
        },
        required: ['action']
      }
    }
  }
]

function fmtTime(ms) {
  if (!ms) return null
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 游戏状态工具：复用 shared/games 纯逻辑（与左栏卡片同一套扫描），返回精简摘要给模型
async function gameStatusTool({ game } = {}) {
  const settings = await readSettings()
  const hidden = new Set(settings.hiddenGames || [])
  const { games, scannedAt } = await scanAllGames(new Date(), settings.manualGames || [])
  const visible = games.filter((g) => !hidden.has(g.id))

  const query = String(game || '').trim().toLowerCase()
  const picked = query ? visible.filter((g) => g.name.toLowerCase().includes(query)) : visible

  if (picked.length === 0) {
    return {
      status: 'no_match',
      scannedAt: fmtTime(scannedAt),
      requested: game || null,
      note: `没有匹配「${game || ''}」的游戏。已识别的游戏：${visible.map((g) => g.name).join('、') || '（无）'}`,
      games: []
    }
  }

  return {
    status: 'ok',
    scannedAt: fmtTime(scannedAt),
    // 今日状态为「登录时间启发式」：≥ 今日凌晨 4 点视为已完成（日常 4 点刷新）
    games: picked.map((g) => ({
      name: g.name,
      today: g.status === 'done' ? '已完成' : g.status === 'todo' ? '未完成' : '未知',
      lastLoginAt: fmtTime(g.lastLoginAt),
      logPath: g.logPath
    })),
    note: '今日状态按「凌晨 4 点后是否登录过」判断，只是近似；要确认日常是否真的跑完需读日志'
  }
}

const HANDLERS = {
  dorosearch: async ({ query }) => {
    const snap = getSnapshot() || (await buildSnapshot())
    return formatSearchResult(searchIndex(snap, query))
  },
  dororead: readFileTool,
  dorogrep: grepTool,
  dorogame: gameStatusTool,
  dorolist: listActionsTool,
  dororun: runActionTool
}

export async function executeTool(name, args) {
  const handler = HANDLERS[name]
  if (!handler) return { error: `未知工具：${name}` }
  try {
    const result = await handler(args || {})
    return result ?? { ok: true }
  } catch (err) {
    return { error: `${name} 执行出错：${err.message}` }
  }
}

export { buildSnapshot, invalidate, stats }
