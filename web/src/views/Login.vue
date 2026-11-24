<template>
  <div class="login-page">
    <div class="bg-layer"></div>
    <div class="bg-mask"></div>

    <div class="login-shell">
      <section class="brand-side">
        <div class="brand-badge">
          <span class="badge-dot"></span>SMART PARKING SYSTEM
        </div>
        <h1>让每一次停放<br />都井然有序<span class="accent">.</span></h1>
        <p class="brand-desc">
          小区停车全流程数字化管理，车位调度、进出计费、月卡续费与收益报表，一屏掌握。
        </p>
        <ul class="feature-list">
          <li>
            <span class="fi"><el-icon><Grid /></el-icon></span>
            <span>车位分区管理，固定 / 临时车位状态一目了然</span>
          </li>
          <li>
            <span class="fi"><el-icon><Switch /></el-icon></span>
            <span>入场自动分配车位，出场自动计费结算</span>
          </li>
          <li>
            <span class="fi"><el-icon><TrendCharts /></el-icon></span>
            <span>收费趋势看板与收益报表实时呈现</span>
          </li>
        </ul>
      </section>

      <section class="login-card">
        <div class="logo">
          <div class="logo-icon"><img src="/logo.svg" alt="智泊停车" /></div>
          <div class="logo-text">
            <h2>智泊停车</h2>
            <p>小区智慧停车管理系统</p>
          </div>
        </div>

        <el-form @keyup.enter="doLogin">
          <el-form-item>
            <el-input v-model="form.username" size="large" placeholder="请输入账号">
              <template #prefix><el-icon><User /></el-icon></template>
            </el-input>
          </el-form-item>
          <el-form-item>
            <el-input v-model="form.password" size="large" type="password" show-password placeholder="请输入密码">
              <template #prefix><el-icon><Lock /></el-icon></template>
            </el-input>
          </el-form-item>
          <el-button size="large" class="login-btn" :loading="loading" @click="doLogin">登 录</el-button>
        </el-form>

        <div class="tip">默认账号 admin / 123456 · 操作员 zhangsan / 123456</div>
        <div class="secure-tip">
          <el-icon><Lock /></el-icon>
          <span>登录状态自动续期，7 天内活跃使用无需重复登录</span>
        </div>
      </section>
    </div>

    <div class="page-foot">© 2026 智泊停车 · 小区智慧停车管理系统</div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import api from '../api'
import { useUserStore } from '../store/user'

const router = useRouter()
const route = useRoute()
const store = useUserStore()
const form = reactive({ username: 'admin', password: '' })
const loading = ref(false)

function safeRedirect() {
  const r = route.query.redirect
  if (typeof r === 'string' && r.startsWith('/') && !r.startsWith('//')) return r
  return '/'
}

async function doLogin() {
  if (!form.username || !form.password) return ElMessage.warning('请输入账号和密码')
  loading.value = true
  try {
    const res = await api.post('/auth/login', form)
    if (res.code !== 0) return ElMessage.error(res.msg)
    store.setUser(res.data.token, res.data.user, res.data.refreshToken)
    ElMessage.success('欢迎回来，' + res.data.user.name)
    router.replace(safeRedirect())
  } catch (e) {
    // 401 等异常由请求拦截器统一提示
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  position: relative;
  min-height: 100vh;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-base);
}

/* 背景：glass 主题是实景图，其余主题为主题渐变 */
.bg-layer {
  position: absolute;
  inset: 0;
  background: var(--login-bg);
  background-color: var(--bg-base);
  animation: slowZoom 26s ease-in-out infinite alternate;
}
@keyframes slowZoom {
  from { transform: scale(1); }
  to { transform: scale(1.06); }
}

/* 遮罩：各主题自带，glass 主题靠右下暗角压掉图片水印 */
.bg-mask {
  position: absolute;
  inset: 0;
  background: var(--login-overlay);
}

.login-shell {
  position: relative;
  z-index: 2;
  width: 100%;
  max-width: 1200px;
  padding: 40px 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 48px;
}

/* ---------- 左侧品牌区 ---------- */
.brand-side { color: var(--login-text); max-width: 520px; }
.brand-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  letter-spacing: 2px;
  color: var(--login-muted);
  background: color-mix(in srgb, var(--login-text) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--login-text) 20%, transparent);
  backdrop-filter: var(--blur-sm);
  padding: 7px 14px;
  border-radius: 999px;
  margin-bottom: 26px;
}
.badge-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--primary);
  box-shadow: 0 0 10px var(--primary);
}
.brand-side h1 {
  margin: 0 0 18px;
  font-size: 46px;
  line-height: 1.24;
  font-weight: 800;
  letter-spacing: 1px;
  color: var(--login-text);
}
.brand-side h1 .accent { color: var(--primary); }
.brand-desc {
  margin: 0 0 32px;
  font-size: 15px;
  line-height: 1.85;
  color: var(--login-muted);
}
.feature-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
.feature-list li {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  color: var(--login-muted);
}
.fi {
  width: 34px; height: 34px;
  flex: none;
  border-radius: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--login-text) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--login-text) 20%, transparent);
  backdrop-filter: var(--blur-sm);
  color: var(--login-text);
}

/* ---------- 右侧登录卡片 ---------- */
.login-card {
  width: 400px;
  flex: none;
  padding: 40px 36px 28px;
  border-radius: calc(var(--radius) + 8px);
  background: var(--login-card);
  backdrop-filter: var(--blur);
  -webkit-backdrop-filter: var(--blur);
  border: 1px solid var(--login-card-border);
  box-shadow: var(--shadow-hover);
  color: var(--login-text);
  transition: background-color .3s ease, border-color .3s ease, color .3s ease;
}

.logo { display: flex; align-items: center; gap: 14px; margin-bottom: 30px; }
.logo-icon {
  width: 52px; height: 52px; border-radius: 16px;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
  box-shadow: 0 10px 24px color-mix(in srgb, var(--primary) 38%, transparent);
}
.logo-icon img { width: 100%; height: 100%; display: block; }
.logo-text h2 {
  margin: 0;
  font-size: 21px;
  font-weight: 700;
  color: var(--login-text);
  letter-spacing: .5px;
}
.logo-text p {
  margin: 3px 0 0;
  font-size: 12.5px;
  color: var(--login-muted);
}

/* 输入框：跟随主题的登录配色 */
.login-card :deep(.el-form-item) { margin-bottom: 18px; }
.login-card :deep(.el-input__wrapper) {
  background: var(--login-input-bg) !important;
  box-shadow: 0 0 0 1px var(--login-input-border) inset !important;
  border-radius: var(--radius-sm) !important;
  backdrop-filter: var(--blur-sm);
  transition: box-shadow .2s, background-color .2s;
}
.login-card :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--login-text) 32%, transparent) inset !important;
}
.login-card :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px var(--primary) inset, 0 0 0 4px var(--primary-weak) !important;
}
.login-card :deep(.el-input__inner) {
  color: var(--login-text) !important;
  height: 46px;
}
.login-card :deep(.el-input__inner::placeholder) { color: var(--login-muted); }
.login-card :deep(.el-input__prefix),
.login-card :deep(.el-input__suffix) { color: var(--login-muted); }

.login-btn {
  width: 100%;
  height: 46px;
  margin-top: 6px;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 4px;
  color: var(--primary-text);
  background: var(--primary-grad);
  box-shadow: 0 12px 28px color-mix(in srgb, var(--primary) 34%, transparent);
  transition: transform .16s, box-shadow .16s, filter .16s;
}
.login-btn:hover {
  transform: translateY(-1px);
  filter: brightness(1.07);
  color: var(--primary-text);
}
.login-btn:active { transform: translateY(0); }

.tip {
  text-align: center;
  font-size: 12px;
  color: var(--login-muted);
  margin-top: 20px;
}
.secure-tip {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 12px;
  padding-top: 14px;
  border-top: 1px solid color-mix(in srgb, var(--login-text) 14%, transparent);
  font-size: 11.5px;
  color: color-mix(in srgb, var(--login-muted) 85%, transparent);
}

.page-foot {
  position: absolute;
  z-index: 2;
  bottom: 20px;
  left: 0; right: 0;
  text-align: center;
  font-size: 12px;
  color: var(--login-muted);
  opacity: .8;
}

@media (max-width: 1080px) {
  .brand-side { display: none; }
  .login-shell { justify-content: center; padding: 24px; }
  .login-card { width: 100%; max-width: 400px; }
}
</style>
