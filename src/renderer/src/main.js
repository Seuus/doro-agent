// 渲染进程入口：挂载 Vue 应用
import { createApp } from 'vue'
import App from './App.vue'
import './assets/styles/variables.css'
import './assets/styles/base.css'
import './assets/styles/dialog.css'
import './assets/styles/markdown.css'

createApp(App).mount('#app')
