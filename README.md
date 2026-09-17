# doro-agent

Windows 桌面 AI 管家：左侧为本地功能面板（游戏日志监控、会话列表、设置），右侧为 AI Agent 对话区，窗口固定 1200x800。

对话在主进程内直连任意 OpenAI 兼容 API（DeepSeek / OpenAI / Ollama 等），Agent 工具全部在本地进程内执行，无常驻服务、无运行时依赖。

## 技术栈

- Electron + Vue 3 + Vite（electron-vite），纯 JavaScript，无 UI 组件库
- Node.js ≥ 22.12

## 运行与构建

```bash
npm install
npm run dev        # 开发模式，模型接口在「设置」里配置
npm run dev:mock   # 离线 mock，不联网，用于调界面
npm run build      # 构建到 out/
npm run dist:dir   # 免安装目录 release/win-unpacked
npm run dist       # NSIS 安装包
```

打包卡在下载 Electron 时，先设置镜像环境变量：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
```

## 目录结构

```
src/main/      主进程：窗口、IPC、Agent 循环、工具、存储
  doro/        大脑：loop.mjs（循环 + 人设提示词）、client.mjs（模型流式客户端）、
               service.mjs（对话门面：会话管理、流式分条）、mock.mjs（离线 mock）
  tools/       Agent 工具实现与注册表
  store/       落盘：settings.mjs、conversations.mjs
  ipc.mjs      全部 IPC handler
src/preload/   window.doro 契约（渲染进程唯一入口，不接触 API Key 与文件系统）
src/shared/    主进程/渲染进程共用：游戏扫描、时间解析、IPC 通道常量
src/renderer/  Vue 3 界面（组件 / composables / utils，Vite 打包）
scripts/       命令行验证与调试脚本，直接 node 运行，不依赖 Electron
```

## 核心机制

- **Agent 循环**（src/main/doro/loop.mjs）：调模型 → 收 tool_calls → 本地执行 → 回灌 → 再调，最多 12 轮；流式产出归一化事件（delta / thought / end / error）。
- **工具集**：`dorosearch`（全盘文件检索，归一化 + 容错打分）、`dororead`（按行读文件）、`dorogrep`（目录内内容搜索）、`dorogame`（游戏今日登录状态）、`dorolist` / `dororun`（脚本动作）。注册表在 tools/index.mjs。
- **人设与行为规则**：`SYSTEM_PROMPT` 在 src/main/doro/loop.mjs 顶部，开场白在 doro/service.mjs；改动后需重新打包生效。
- **回复分条**：模型按提示词用空行分段，主进程在空行处把流式回答切成多条气泡（一轮最多 6 条）；切分与归一化实现见 doro/service.mjs 顶部注释。
- **会话**：多会话持久化到数据目录，可随时切换、删除（两段式确认）；重开应用开新会话。切换/删除的安全性约定见 store/conversations.mjs 与 doro/service.mjs 顶部注释。
- **游戏日志扫描**（src/shared/games/）：配置表驱动，game-configs.mjs 声明候选目录、日志文件名与登录行正则；未登记的游戏走通用登录判定（generic-login.mjs）；今日状态按日常凌晨 4 点刷新；扫描时提取游戏本体图标（纯 JS 解析 PE 资源，无第三方依赖）。
- **脚本动作**：数据目录 actions.json 登记，kind=command 直接启动命令，kind=keys 聚焦窗口发按键；完成判定支持日志正则、进程退出、超时兜底。

## 验证与调试

```bash
npm run agent:e2e      # 假模型驱动完整 Agent 循环，不联网
npm run agent:conv     # 会话生命周期（落盘 / 切换 / 清理）
npm run agent:action   # 脚本动作执行链路
npm run agent:smoke    # 搜索打分引擎冒烟
npm run games:debug    # 日志扫描调试，子命令 scan / login / icon
npm run index:perf     # 全盘索引构建耗时与查询效果
```

## 代码约定

- 非渲染层（main / preload / shared / scripts）统一 kebab-case 文件名 + `.mjs`；渲染层保持 `.js` + 组件 PascalCase。
- 工具 ID 用 doro 前缀连写（dorosearch、dororead…）；新增工具在 tools/index.mjs 的 TOOL_DEFS 注册，并在 doro/loop.mjs 的 TOOL_LABELS 补中文标签。

## 数据目录

`%APPDATA%\doro-agent`：设置、会话（conversations/）、脚本动作（actions.json）、图标缓存（icons/）。
