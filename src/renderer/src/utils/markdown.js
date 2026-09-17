// AI 回复 Markdown 渲染。安全前提：html:false 会转义源文本中的所有原始 HTML，
// 且 markdown-it 内置 validateLink 已拦截 javascript: 等危险协议。
// 若将来打开 html:true 或引入会输出原始 HTML 的插件，必须同时引入 DOMPurify 做净化。
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({
  html: false, // 关键安全开关，不要改
  linkify: false, // 不自动识别裸链接，避免误伤中文文本
  breaks: true // 单换行即 <br>，符合聊天场景预期
})

export function renderMarkdown(source) {
  return md.render(source || '')
}
