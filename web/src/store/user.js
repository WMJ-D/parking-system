import { defineStore } from 'pinia'

const AT_KEY = 'token'
const RT_KEY = 'refreshToken'
const USER_KEY = 'user'

function readUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null')
  } catch (e) {
    return null
  }
}

export const useUserStore = defineStore('user', {
  state: () => ({
    token: localStorage.getItem(AT_KEY) || '',
    refreshToken: localStorage.getItem(RT_KEY) || '',
    user: readUser()
  }),
  getters: {
    // 必须同时持有 access + refresh 才算登录态：
    // access 过期可由 refresh 续，但 refresh 没了就等于彻底掉线
    isLoggedIn: s => !!(s.token && s.refreshToken),
    isAdmin: s => s.user?.role === 'admin',
    displayName: s => s.user?.name || s.user?.username || ''
  },
  actions: {
    setUser(token, user, refreshToken) {
      this.token = token || ''
      this.user = user || null
      if (refreshToken) this.refreshToken = refreshToken
      if (token) localStorage.setItem(AT_KEY, token)
      if (refreshToken) localStorage.setItem(RT_KEY, refreshToken)
      if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
    },
    setTokens(token, refreshToken) {
      if (token) { this.token = token; localStorage.setItem(AT_KEY, token) }
      if (refreshToken) { this.refreshToken = refreshToken; localStorage.setItem(RT_KEY, refreshToken) }
    },
    // 只清状态，不调接口（供拦截器同步调用）
    reset() {
      this.token = ''
      this.refreshToken = ''
      this.user = null
      localStorage.removeItem(AT_KEY)
      localStorage.removeItem(RT_KEY)
      localStorage.removeItem(USER_KEY)
    },
    // 用户主动退出：返回 refreshToken 供调用方通知服务端撤销
    logout() {
      const rt = this.refreshToken
      this.reset()
      return rt
    }
  }
})
