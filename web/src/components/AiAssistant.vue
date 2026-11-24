<template>
  <aside class="ai-dock" :class="{ open: ai.open }">
    <section class="ai-panel">
        <!-- 头部 -->
        <header class="ai-head">
          <div class="ai-brand">
            <div class="ai-logo"><el-icon :size="18"><MagicStick /></el-icon></div>
            <div class="ai-brand-text">
              <div class="ai-name">智泊 AI 助手</div>
              <div class="ai-sub">数据查询 · 业务办理 · 智能导航</div>
            </div>
          </div>
          <div class="ai-head-actions">
            <button title="新建对话" @click="newChat"><el-icon :size="16"><Plus /></el-icon></button>
            <button title="历史对话" @click="openHistory"><el-icon :size="16"><Clock /></el-icon></button>
            <button v-if="userStore.isAdmin" title="大模型设置" @click="openSettings"><el-icon :size="16"><Setting /></el-icon></button>
            <button title="关闭" @click="ai.togglePanel(false)"><el-icon :size="16"><Close /></el-icon></button>
          </div>
        </header>

        <!-- 历史会话 -->
        <div v-if="showHistory" class="ai-history">
          <div class="ai-section-title">历史对话</div>
          <div v-if="!ai.conversations.length" class="ai-empty">暂无历史对话</div>
          <div
            v-for="c in ai.conversations" :key="c.id"
            class="ai-history-item" :class="{ active: c.id === ai.conversationId }"
            @click="openConv(c.id)"
          >
            <div class="ai-history-main">
              <div class="ai-history-title">{{ c.title }}</div>
              <div class="ai-history-time">{{ fmtDate(c.updated_at) }}</div>
            </div>
            <button class="ai-history-del" title="删除" @click.stop="delConv(c)">
              <el-icon :size="14"><Delete /></el-icon>
            </button>
          </div>
        </div>

        <!-- 大模型配置 -->
        <div v-else-if="showSettings" class="ai-settings">
          <div class="ai-section-title">大模型 API 配置</div>
          <el-form label-position="top" size="small" class="ai-form">
            <el-form-item label="API 地址">
              <el-input v-model="form.base_url" placeholder="https://api.deepseek.com/v1" />
            </el-form-item>
            <el-form-item label="API Key">
              <el-input v-model="form.api_key" type="password" show-password :placeholder="ai.config?.api_key_masked || 'sk-xxxxxxxx'" />
            </el-form-item>
            <el-form-item label="模型名称">
              <el-input v-model="form.model" placeholder="deepseek-chat / qwen-plus / gpt-4o-mini" />
            </el-form-item>
            <el-form-item :label="`温度：${Number(form.temperature).toFixed(1)}`">
              <el-slider v-model="form.temperature" :min="0" :max="1" :step="0.1" />
            </el-form-item>
            <el-form-item label="最大回复长度（tokens）">
              <el-input-number v-model="form.max_tokens" :min="64" :max="8192" :step="100" style="width: 100%" />
            </el-form-item>
          </el-form>
          <div class="ai-tips">
            支持 OpenAI 兼容接口（DeepSeek / 通义千问 / Moonshot / OpenAI 等）。地址填到 <code>/v1</code> 即可，系统会自动补全 <code>/chat/completions</code>。
          </div>
          <div class="ai-settings-actions">
            <el-button size="small" :loading="testing" @click="testConn">测试连接</el-button>
            <el-button size="small" type="primary" :loading="saving" @click="saveCfg">保存配置</el-button>
            <el-button size="small" text @click="showSettings = false">返回对话</el-button>
          </div>
        </div>

        <!-- 对话 -->
        <template v-else>
          <div ref="listRef" class="ai-messages">
            <div v-if="!ai.messages.length" class="ai-welcome">
              <div class="ai-welcome-icon"><el-icon :size="30"><MagicStick /></el-icon></div>
              <div class="ai-welcome-title">你好，我是智泊 AI 助手</div>
              <p class="ai-welcome-desc">可以帮你查询经营数据、办理业务、打开功能页面。试试这样问：</p>
              <div class="ai-quick">
                <button v-for="q in quickQuestions" :key="q" @click="ask(q)">{{ q }}</button>
              </div>
              <div v-if="ai.config && !ai.configured" class="ai-noconfig">
                <el-icon :size="14"><Warning /></el-icon>
                <span>尚未配置大模型</span>
                <el-button v-if="userStore.isAdmin" size="small" text type="primary" @click="openSettings">去配置</el-button>
                <span v-else class="ai-noconfig-tip">请联系管理员配置</span>
              </div>
            </div>

            <div v-for="(m, i) in ai.messages" :key="i" class="ai-msg" :class="m.role">
              <div v-if="m.role === 'assistant'" class="ai-avatar"><el-icon :size="15"><MagicStick /></el-icon></div>
              <div class="ai-bubble-wrap">
                <div v-if="m.role === 'user'" class="ai-bubble user-bubble">{{ m.content }}</div>
                <div v-else class="ai-bubble" :class="{ error: m.error }">
                  <template v-if="m.content">
                    <span v-html="format(m.content)" /><span v-if="m.streaming" class="ai-cursor">▍</span>
                  </template>
                  <span v-else-if="m.streaming" class="ai-dots"><i /><i /><i /></span>
                </div>
                <div v-if="m.trace && m.trace.length" class="ai-trace">
                  <span v-for="(t, j) in m.trace" :key="j" class="ai-trace-item" :class="{ bad: !t.ok }">
                    <el-icon :size="12"><component :is="t.ok ? 'CircleCheck' : 'CircleClose'" /></el-icon>
                    <b>{{ t.title }}</b><template v-if="t.summary"> · {{ t.summary }}</template>
                  </span>
                </div>
                <div v-if="m.navigate && m.navigate.length" class="ai-nav">
                  <el-button
                    v-for="(n, j) in m.navigate" :key="j"
                    size="small" type="primary" plain @click="go(n)"
                  >
                    <el-icon :size="13"><Position /></el-icon>前往 {{ pageName(n.path) }}
                  </el-button>
                </div>
                <div v-if="m.downloads && m.downloads.length" class="ai-downloads">
                  <el-button
                    v-for="(d, j) in m.downloads" :key="j"
                    size="small" type="success" plain @click="download(d)"
                  >
                    <el-icon :size="13"><Download /></el-icon>{{ d.filename || '下载文件' }}
                  </el-button>
                </div>
              </div>
            </div>

          </div>

          <footer class="ai-input">
            <el-input
              v-model="input"
              type="textarea"
              :autosize="{ minRows: 1, maxRows: 4 }"
              resize="none"
              placeholder="问我：今天营收多少？帮我登记一辆车…（Enter 发送，Shift+Enter 换行）"
              @keydown="onKeydown"
            />
            <el-button
              v-if="ai.sending"
              type="danger" circle class="send-btn" title="停止生成"
              @click="ai.stop()"
            >
              <el-icon :size="15"><VideoPause /></el-icon>
            </el-button>
            <el-button
              v-else
              type="primary" circle class="send-btn"
              :disabled="!input.trim()"
              @click="send"
            >
              <el-icon :size="17"><Promotion /></el-icon>
            </el-button>
          </footer>
        </template>
      </section>
  </aside>
</template>

<script setup>
import { ref, reactive, watch, nextTick, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAiStore } from '../store/ai'
import { useUserStore } from '../store/user'
import { downloadFile } from '../api'

const ai = useAiStore()
const userStore = useUserStore()
const router = useRouter()

const input = ref('')
const listRef = ref(null)
const showHistory = ref(false)
const showSettings = ref(false)
const saving = ref(false)
const testing = ref(false)

const form = reactive({
  base_url: '',
  api_key: '',
  model: '',
  temperature: 0.3,
  max_tokens: 1200
})

const quickQuestions = [
  '今天经营情况怎么样？',
  '现在有多少空闲车位？',
  '列出 30 天内到期的月卡',
  '哪些车辆有欠费？',
  '帮我登记车辆：京A12345，车主王小明，电话13800138000',
  '打开欠费管理页面'
]

const PAGE_TITLES = {
  '/dashboard': '数据看板',
  '/spots': '车位管理',
  '/vehicles': '车辆管理',
  '/records': '进出管理',
  '/payments': '月卡缴费',
  '/debts': '欠费管理',
  '/reports': '报表中心',
  '/rules': '收费规则',
  '/users': '系统用户',
  '/logs': '操作日志'
}
const pageName = path => PAGE_TITLES[path] || '页面'

onMounted(() => {
  ai.loadConfig().catch(() => {})
})

watch(() => {
  const last = ai.messages[ai.messages.length - 1]
  return [
    ai.messages.length,
    ai.sending,
    last ? String(last.content || '').length : 0,
    last && last.trace ? last.trace.length : 0
  ]
}, scheduleScroll)

let scrollFrame = 0
function scheduleScroll() {
  if (scrollFrame) return
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0
    nextTick(scrollBottom)
  })
}

function scrollBottom() {
  const el = listRef.value
  if (el) el.scrollTop = el.scrollHeight
}

function onKeydown(e) {
  if (e.key !== 'Enter') return
  if (e.shiftKey || e.isComposing) return
  e.preventDefault()
  send()
}

function ask(q) {
  input.value = q
  send()
}

async function send() {
  const text = input.value.trim()
  if (!text || ai.sending) return
  input.value = ''
  const res = await ai.send(text)
  scrollBottom()
  if (res && res.code === 0 && Array.isArray(res.data?.navigate) && res.data.navigate.length) {
    go(res.data.navigate[0])
  }
}

function go(nav) {
  if (!nav || !nav.path) return
  router.push({ path: nav.path, query: nav.query || {} })
  ElMessage.success(`已打开${pageName(nav.path)}`)
}

function download(d) {
  if (!d || !d.url) return
  downloadFile(d.url).catch(e => ElMessage.error((e && e.message) || '下载失败'))
}

function newChat() {
  ai.newConversation()
  showHistory.value = false
  showSettings.value = false
  input.value = ''
  nextTick(() => {
    const el = document.querySelector('.ai-input textarea')
    if (el) el.focus()
  })
}

async function openHistory() {
  showSettings.value = false
  showHistory.value = !showHistory.value
  if (showHistory.value) {
    ai.loadConversations().catch(e => ElMessage.error(e.message))
  }
}

async function openConv(id) {
  try {
    await ai.openConversation(id)
    showHistory.value = false
    nextTick(scrollBottom)
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function delConv(c) {
  try {
    await ElMessageBox.confirm(`确定删除会话「${c.title}」？`, '删除对话', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消'
    })
  } catch (e) {
    return
  }
  try {
    await ai.removeConversation(c.id)
    ElMessage.success('已删除')
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function openSettings() {
  if (!userStore.isAdmin) return ElMessage.warning('仅管理员可以配置大模型')
  showHistory.value = false
  await ai.loadConfig().catch(() => {})
  const c = ai.config || {}
  Object.assign(form, {
    base_url: c.base_url || '',
    api_key: c.api_key_masked || '',
    model: c.model || '',
    temperature: Number(c.temperature ?? 0.3),
    max_tokens: Number(c.max_tokens ?? 1200)
  })
  showSettings.value = true
}

async function saveCfg() {
  if (!form.base_url || !form.model || !form.api_key) return ElMessage.warning('请填写 API 地址、API Key 和模型名称')
  saving.value = true
  try {
    await ai.saveConfig({ ...form, enabled: true })
    ElMessage.success('AI 配置已保存，可以开始对话了')
    showSettings.value = false
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}

async function testConn() {
  if (!form.base_url || !form.model) return ElMessage.warning('请先填写 API 地址和模型名称')
  testing.value = true
  try {
    const r = await ai.testConfig({ ...form })
    ElMessage.success(`连接成功，耗时 ${r.ms} ms`)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    testing.value = false
  }
}

function fmtDate(s) {
  return s ? String(s).slice(0, 16).replace('T', ' ') : ''
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]))
}

function format(text) {
  let html = escapeHtml(text)
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  return html
}
</script>

<style scoped>
/* 右侧停靠栏：作为 layout 的弹性子项，展开时挤压左侧主内容，而非遮挡 */
.ai-dock {
  flex: 0 0 auto;
  width: 0;
  height: 100vh;
  overflow: hidden;
  transition: width .3s cubic-bezier(.4, 0, .2, 1);
}
.ai-dock.open { width: min(440px, 46vw); }

.ai-panel {
  width: min(440px, 46vw);
  height: 100%;
  display: flex; flex-direction: column;
  background: var(--surface-solid);
  border-left: 1px solid var(--border);
  box-shadow: var(--shadow);
  backdrop-filter: var(--blur);
  -webkit-backdrop-filter: var(--blur);
  transform: translateX(28px);
  opacity: 0;
  transition: transform .3s cubic-bezier(.4, 0, .2, 1), opacity .22s ease;
}
.ai-dock.open .ai-panel { transform: translateX(0); opacity: 1; }

/* 头部 */
.ai-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 1px solid var(--border-soft);
  flex-shrink: 0;
}
.ai-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.ai-logo {
  width: 34px; height: 34px; border-radius: 10px; flex-shrink: 0;
  background: var(--primary-grad); color: var(--primary-text);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 6px 16px color-mix(in srgb, var(--primary) 32%, transparent);
}
.ai-name { font-size: 15px; font-weight: 700; color: var(--text); line-height: 1.3; }
.ai-sub { font-size: 11px; color: var(--text-3); margin-top: 1px; }
.ai-head-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.ai-head-actions button {
  width: 30px; height: 30px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--text-2); transition: background-color .15s, color .15s;
}
.ai-head-actions button:hover { background: var(--hover-bg, rgba(255,255,255,.08)); color: var(--primary); }

.ai-section-title {
  font-size: 13px; font-weight: 600; color: var(--text);
  padding: 14px 16px 8px;
}

/* 历史会话 */
.ai-history { flex: 1; overflow: auto; padding: 0 8px 14px; }
.ai-history-item {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 10px; border-radius: var(--radius-sm);
  cursor: pointer; transition: background-color .15s;
}
.ai-history-item:hover { background: var(--input-bg); }
.ai-history-item.active { background: var(--primary-weak); }
.ai-history-main { flex: 1; min-width: 0; }
.ai-history-title {
  font-size: 13px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ai-history-time { font-size: 11px; color: var(--text-3); margin-top: 2px; }
.ai-history-del {
  width: 26px; height: 26px; border-radius: 6px; color: var(--text-3);
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  opacity: 0; transition: opacity .15s, color .15s, background-color .15s;
}
.ai-history-item:hover .ai-history-del { opacity: 1; }
.ai-history-del:hover { color: var(--el-color-danger); background: var(--input-bg); }
.ai-empty { padding: 30px 16px; text-align: center; font-size: 13px; color: var(--text-3); }

/* 设置 */
.ai-settings { flex: 1; overflow: auto; padding: 0 16px 20px; }
.ai-form { margin-top: 4px; }
.ai-tips {
  font-size: 12px; color: var(--text-3); line-height: 1.7;
  background: var(--input-bg); border-radius: var(--radius-sm); padding: 10px 12px;
}
.ai-tips code { color: var(--primary); }
.ai-settings-actions { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }

/* 消息区 */
.ai-messages {
  flex: 1; overflow-y: auto; padding: 16px;
  display: flex; flex-direction: column; gap: 14px;
}
.ai-welcome { text-align: center; padding: 26px 6px 10px; }
.ai-welcome-icon {
  width: 62px; height: 62px; margin: 0 auto 14px; border-radius: 20px;
  background: var(--primary-weak); color: var(--primary);
  display: flex; align-items: center; justify-content: center;
}
.ai-welcome-title { font-size: 16px; font-weight: 700; color: var(--text); }
.ai-welcome-desc { font-size: 12.5px; color: var(--text-2); line-height: 1.7; margin: 8px 0 16px; }
.ai-quick { display: flex; flex-direction: column; gap: 8px; }
.ai-quick button {
  text-align: left; font-size: 13px; color: var(--text-2);
  padding: 10px 14px; border-radius: var(--radius-sm);
  background: var(--input-bg); border: 1px solid var(--border);
  transition: border-color .15s, color .15s, background-color .15s;
}
.ai-quick button:hover { border-color: var(--primary); color: var(--primary); }
.ai-noconfig {
  margin-top: 18px; padding: 10px 14px; border-radius: var(--radius-sm);
  background: rgba(230, 162, 60, .12); border: 1px solid rgba(230, 162, 60, .3);
  font-size: 12.5px; color: var(--text-2);
  display: flex; align-items: center; justify-content: center; gap: 6px;
}
.ai-noconfig-tip { color: var(--text-3); }

.ai-msg { display: flex; gap: 8px; align-items: flex-start; }
.ai-msg.user { justify-content: flex-end; }
.ai-avatar {
  width: 28px; height: 28px; border-radius: 9px; flex-shrink: 0;
  background: var(--primary-grad); color: var(--primary-text);
  display: flex; align-items: center; justify-content: center;
  margin-top: 2px;
}
.ai-bubble-wrap { max-width: 84%; min-width: 0; }
.ai-msg.user .ai-bubble-wrap { max-width: 82%; }
.ai-bubble {
  padding: 10px 13px; border-radius: 12px;
  background: var(--input-bg); color: var(--text);
  font-size: 13.5px; line-height: 1.75; word-break: break-word;
  white-space: pre-wrap;
  border: 1px solid var(--border-soft);
}
.ai-bubble :deep(strong) { color: var(--text); font-weight: 700; }
.ai-bubble :deep(code) {
  font-size: 12.5px; padding: 1px 5px; border-radius: 4px;
  background: var(--primary-weak); color: var(--primary);
}
.user-bubble {
  background: var(--primary-grad); color: var(--primary-text);
  border: none; border-bottom-right-radius: 4px;
}
.ai-bubble.error {
  border-color: color-mix(in srgb, var(--el-color-danger) 45%, transparent);
  color: var(--el-color-danger);
  background: color-mix(in srgb, var(--el-color-danger) 8%, transparent);
}
.ai-trace { display: flex; flex-direction: column; gap: 5px; margin-top: 7px; }
.ai-trace-item {
  display: flex; align-items: flex-start; gap: 5px;
  font-size: 11.5px; color: var(--text-3); line-height: 1.5;
  padding: 4px 8px; border-radius: 6px; background: var(--input-bg);
}
.ai-trace-item b { color: var(--text-2); font-weight: 600; }
.ai-trace-item .el-icon { color: var(--el-color-success); margin-top: 2px; flex-shrink: 0; }
.ai-trace-item.bad .el-icon { color: var(--el-color-danger); }
.ai-nav { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.ai-downloads { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }

.ai-cursor {
  display: inline-block; width: 2px; height: 1em; margin-left: 3px;
  background: var(--primary); vertical-align: text-bottom;
  animation: aiBlink 1s steps(2, start) infinite;
}
@keyframes aiBlink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
}
.ai-dots { display: inline-flex; gap: 4px; padding: 4px 0; }
.ai-dots i {
  width: 6px; height: 6px; border-radius: 50%; background: var(--text-3);
  animation: aiDot 1.2s infinite ease-in-out;
}
.ai-dots i:nth-child(2) { animation-delay: .15s; }
.ai-dots i:nth-child(3) { animation-delay: .3s; }
@keyframes aiDot { 0%, 60%, 100% { opacity: .3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-4px); } }

/* 输入区 */
.ai-input {
  flex-shrink: 0; display: flex; align-items: flex-end; gap: 10px;
  padding: 12px 14px 14px; border-top: 1px solid var(--border-soft);
}
.ai-input :deep(.el-textarea__inner) {
  border-radius: var(--radius-sm);
  padding: 9px 12px; font-size: 13.5px; line-height: 1.5;
  min-height: 38px !important;
}
.send-btn { flex-shrink: 0; width: 38px; height: 38px; }

@media (max-width: 768px) {
  .ai-dock.open { width: 100vw; }
  .ai-panel { width: 100vw; }
}
</style>