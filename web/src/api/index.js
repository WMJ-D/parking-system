import axios from 'axios'
import { ElMessage } from 'element-plus'
import router from '../router'

const AT_KEY = 'token'
const RT_KEY = 'refreshToken'
const USER_KEY = 'user'

// access token 剩余不足该秒数时，请求前主动静默续期，避免请求白跑
const PRE_REFRESH_SEC = 300

const api = axios.create({ baseURL: '/api', timeout: 15000 })

/* ---------- 与 pinia store 的桥接（避免模块循环依赖） ---------- */
let unauthorizedHandler = () => {}
export function setUnauthorizedHandler(fn) { unauthorizedHandler = fn }

/* ---------- 状态 ---------- */
let refreshPromise = null   // 进行中的刷新请求（并发请求共用）
let kicking = false         // 防止重复踢出

const getAccess = () => localStorage.getItem(AT_KEY) || ''
const getRefresh = () => localStorage.getItem(RT_KEY) || ''

/* ---------- 工具 ---------- */
function readExp(token) {
  try {
    const part = token.split('.')[1]
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const bytes = Uint8Array.from(atob(pad), c => c.charCodeAt(0))
    const payload = JSON.parse(new TextDecoder().decode(bytes))
    return payload.exp ? payload.exp * 1000 : 0
  } catch (e) {
    return 0
  }
}

function isExpiringSoon(token, sec = PRE_REFRESH_SEC) {
  const exp = readExp(token)
  if (!exp) return false          // 解析失败就不预判，交给服务端
  return exp - Date.now() < sec * 1000
}

function isAuthEndpoint(url = '') {
  return /\/auth\/(login|refresh|logout)/.test(url)
}

/* ---------- 静默刷新（并发合并） ---------- */
function doRefresh() {
  if (refreshPromise) return refreshPromise
  const rt = getRefresh()
  if (!rt) return Promise.reject(new Error('NO_REFRESH_TOKEN'))

  // 用裸 axios，避免再次进入拦截器造成递归
  refreshPromise = axios
    .post('/api/auth/refresh', { refreshToken: rt })
    .then(res => {
      const d = res.data
      if (!d || d.code !== 0 || !d.data || !d.data.token) {
        throw new Error((d && d.msg) || 'REFRESH_FAILED')
      }
      localStorage.setItem(AT_KEY, d.data.token)
      localStorage.setItem(RT_KEY, d.data.refreshToken)
      if (d.data.user) localStorage.setItem(USER_KEY, JSON.stringify(d.data.user))
      return d.data.token
    })
    .finally(() => { refreshPromise = null })

  return refreshPromise
}

/* ---------- 统一踢回登录页 ---------- */
export function forceLogout(message = '登录已过期，请重新登录') {
  if (kicking) return
  kicking = true
  const rt = getRefresh()

  localStorage.removeItem(AT_KEY)
  localStorage.removeItem(RT_KEY)
  localStorage.removeItem(USER_KEY)
  // 同步清空 pinia，否则路由守卫读到的还是旧 token，会把人又弹回首页
  try { unauthorizedHandler() } catch (e) { /* ignore */ }

  // 通知服务端撤销刷新令牌（静默，不阻塞跳转）
  if (rt) axios.post('/api/auth/logout', { refreshToken: rt }).catch(() => {})

  const cur = router.currentRoute.value
  if (cur.path !== '/login') {
    if (message) ElMessage.warning(message)
    const redirect = cur.fullPath && cur.fullPath !== '/' ? cur.fullPath : undefined
    router.replace({ path: '/login', query: redirect ? { redirect } : {} })
  }
  setTimeout(() => { kicking = false }, 1000)
}

/* ---------- 请求拦截器 ---------- */
api.interceptors.request.use(async cfg => {
  if (isAuthEndpoint(cfg.url)) return cfg

  let token = getAccess()
  // access token 快到期或已过期：先静默续期
  if (token && isExpiringSoon(token)) {
    try {
      token = await doRefresh()
    } catch (e) {
      // 刷新失败不立刻踢人：仍用旧 token 试一次，由服务端给出最终判定
      token = getAccess()
    }
  }
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

/* ---------- 重放请求 ---------- */
async function retryWithRefresh(config) {
  const token = await doRefresh()
  config.headers = config.headers || {}
  config.headers.Authorization = `Bearer ${token}`
  return api(config)
}

/* ---------- 响应拦截器 ---------- */
api.interceptors.response.use(
  res => {
    const d = res.data
    // 业务层 401 兜底（正常情况下后端返回的是 HTTP 401）
    if (d && d.code === 401) {
      const cfg = res.config
      if (cfg._retried) {
        forceLogout(d.msg)
        return Promise.reject(d)
      }
      cfg._retried = true
      return retryWithRefresh(cfg).catch(() => {
        forceLogout(d.msg)
        return Promise.reject(d)
      })
    }
    return d
  },
  async err => {
    const cfg = err.config || {}
    const status = err.response && err.response.status

    if (status === 401) {
      // 登录/刷新/登出接口自身 401：凭证彻底失效
      if (isAuthEndpoint(cfg.url)) {
        if (!/\/auth\/login/.test(cfg.url)) forceLogout()
        return Promise.reject(err)
      }
      // 业务接口 401：静默刷新后重放一次
      if (cfg._retried) {
        forceLogout()
        return Promise.reject(err)
      }
      cfg._retried = true
      try {
        return await retryWithRefresh(cfg)
      } catch (e) {
        forceLogout()
        return Promise.reject(err)
      }
    }

    if (status === 403) {
      ElMessage.error((err.response && err.response.data && err.response.data.msg) || '没有操作权限')
      return Promise.reject(err)
    }

    if (!err.response) {
      ElMessage.error('网络异常，请确认后端服务已启动')
      return Promise.reject(err)
    }

    ElMessage.error((err.response.data && err.response.data.msg) || '请求失败')
    return Promise.reject(err)
  }
)

/* ---------- 主动续期（供页面挂载时调用，可选） ---------- */
export function ensureFreshToken() {
  const token = getAccess()
  const rt = getRefresh()
  if (!rt) return Promise.resolve(null)
  if (!token || isExpiringSoon(token, 600)) {
    return doRefresh().catch(() => null)
  }
  return Promise.resolve(token)
}

export default api
