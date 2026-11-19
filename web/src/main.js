import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import './styles/themes.css'
import './style.css'
import * as Icons from '@element-plus/icons-vue'
import App from './App.vue'
import router from './router'
import { setUnauthorizedHandler } from './api'
import { useUserStore } from './store/user'
import { initTheme } from './composables/useTheme'

const pinia = createPinia()
const app = createApp(App)

// 早于挂载应用主题，避免首屏闪烁
initTheme()

app.use(pinia)
// token 失效时，让请求层能同步清空 pinia 状态（否则路由守卫会把人又弹回首页）
setUnauthorizedHandler(() => useUserStore(pinia).reset())
app.use(router)
app.use(ElementPlus, { locale: zhCn })
for (const [name, comp] of Object.entries(Icons)) app.component(name, comp)
app.mount('#app')
