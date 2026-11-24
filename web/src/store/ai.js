import { defineStore } from 'pinia'
import api, { ensureFreshToken, forceLogout, downloadFile } from '../api'

export const useAiStore = defineStore('ai', {
  state: () => ({
    open: false,
    sending: false,
    conversationId: null,
    conversations: [],
    messages: [],
    config: null,
    abortController: null
  }),
  getters: {
    configured: s => !!(s.config && s.config.configured && s.config.enabled)
  },
  actions: {
    togglePanel(v) {
      this.open = v === undefined ? !this.open : !!v
      if (this.open && !this.config) this.loadConfig().catch(() => {})
    },
    async loadConfig() {
      const res = await api.get('/ai/config')
      if (res.code === 0) this.config = res.data
      return this.config
    },
    async saveConfig(payload) {
      const res = await api.put('/ai/config', payload)
      if (res.code !== 0) throw new Error(res.msg || '保存失败')
      await this.loadConfig()
      return res.data
    },
    async testConfig(payload) {
      const res = await api.post('/ai/config/test', payload, { timeout: 70000 })
      if (res.code !== 0) throw new Error(res.msg || '连接失败')
      return res.data
    },
    async loadConversations() {
      const res = await api.get('/ai/conversations')
      if (res.code === 0) this.conversations = res.data
      return this.conversations
    },
    async openConversation(id) {
      const res = await api.get(`/ai/conversations/${id}`)
      if (res.code !== 0) throw new Error(res.msg || '加载会话失败')
      this.conversationId = id
      this.messages = res.data.messages.map(m => ({
        role: m.role,
        content: m.content,
        error: false,
        streaming: false,
        trace: (m.meta && m.meta.trace) || [],
        navigate: (m.meta && m.meta.navigate) || [],
        downloads: (m.meta && m.meta.downloads) || []
      }))
    },
    newConversation() {
      this.conversationId = null
      this.messages = []
    },
    async removeConversation(id) {
      const res = await api.delete(`/ai/conversations/${id}`)
      if (res.code !== 0) throw new Error(res.msg || '删除失败')
      if (this.conversationId === id) this.newConversation()
      await this.loadConversations()
    },

    /* ---------- 流式对话（SSE） ---------- */
    async send(text) {
      const content = String(text || '').trim()
      if (!content || this.sending) return null

      this.messages.push({ role: 'user', content })
      this.messages.push({
        role: 'assistant', content: '', error: false, streaming: true, trace: [], navigate: [], downloads: []
      })
      const msg = this.messages[this.messages.length - 1]
      const controller = new AbortController()
      this.abortController = controller
      this.sending = true
      let ended = false

      try {
        await ensureFreshToken()
        const token = localStorage.getItem('token') || ''
        const res = await fetch('/api/ai/chat/stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ message: content, conversationId: this.conversationId }),
          signal: controller.signal
        })

        if (res.status === 401) {
          forceLogout('登录已过期，请重新登录')
          return null
        }

        if (!res.ok || !(res.headers.get('content-type') || '').includes('text/event-stream')) {
          let errMsg = `请求失败（HTTP ${res.status}）`
          try {
            const j = await res.json()
            errMsg = j.msg || errMsg
            if (j.data && j.data.needConfig) await this.loadConfig().catch(() => {})
          } catch (e) { /* 非 JSON 响应 */ }
          msg.error = true
          msg.content = errMsg
          return null
        }

        await this.consumeStream(res, msg)
        ended = true
        this.loadConversations().catch(() => {})
        return { code: 0, data: { navigate: msg.navigate, downloads: msg.downloads } }
      } catch (e) {
        if (e.name === 'AbortError') {
          msg.content += (msg.content ? '\n\n' : '') + '（已停止生成）'
        } else {
          msg.error = true
          msg.content = msg.content || e.message || '网络异常，请稍后重试'
        }
        return null
      } finally {
        msg.streaming = false
        this.sending = false
        this.abortController = null
        if (ended) this.loadConversations().catch(() => {})
      }
    },

    async consumeStream(res, msg) {
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let eventName = 'message'

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let nl
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).replace(/\r$/, '')
          buffer = buffer.slice(nl + 1)
          if (!line) continue
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim()
            continue
          }
          if (!line.startsWith('data:')) continue

          let data = null
          try { data = JSON.parse(line.slice(5).trim()) } catch (e) { continue }
          this.applyStreamEvent(eventName, msg, data)
          eventName = 'message'
        }
      }
    },

    applyStreamEvent(event, msg, data) {
      if (!data) return
      if (event === 'meta') {
        if (data.conversationId) this.conversationId = data.conversationId
      } else if (event === 'delta') {
        msg.content += data.content || ''
      } else if (event === 'tool') {
        if (data.name && !msg.trace.some(t => t.name === data.name && t.summary === data.summary)) {
          msg.trace.push(data)
        }
      } else if (event === 'navigate') {
        if (data.path) msg.navigate.push(data)
      } else if (event === 'download') {
        if (data.url && !msg.downloads.some(d => d.url === data.url)) {
          msg.downloads.push(data)
          downloadFile(data.url).catch(() => {})
        }
      } else if (event === 'done') {
        if (data.reply) msg.content = data.reply
        if (Array.isArray(data.trace)) msg.trace = data.trace
        if (Array.isArray(data.navigate)) msg.navigate = data.navigate
        if (Array.isArray(data.downloads)) msg.downloads = data.downloads
      } else if (event === 'error') {
        msg.error = true
        msg.content = data.message || 'AI 服务异常'
      }
    },

    stop() {
      if (this.abortController) this.abortController.abort()
    }
  }
})