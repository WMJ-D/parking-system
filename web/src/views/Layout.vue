<template>
  <el-container class="layout">
    <el-aside :width="isCollapse ? '72px' : '220px'" class="aside" :class="{ 'is-collapsed': isCollapse }">
      <div class="brand">
        <div class="brand-icon"><el-icon :size="20"><Van /></el-icon></div>
        <span v-show="!isCollapse" class="brand-text">智泊停车</span>
      </div>
      <el-menu
        :default-active="$route.path"
        router
        class="menu"
        :collapse="isCollapse"
        :collapse-transition="false"
      >
        <el-menu-item v-for="m in menus" :key="m.path" :index="m.path">
          <el-icon><component :is="m.icon" /></el-icon>
          <template #title><span>{{ m.title }}</span></template>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <div class="header-left">
          <button class="collapse-btn" :title="isCollapse ? '展开菜单' : '收起菜单'" @click="toggleCollapse">
            <el-icon :size="18"><component :is="isCollapse ? 'Expand' : 'Fold'" /></el-icon>
          </button>
          <div class="title">{{ $route.meta.title }}</div>
        </div>
        <div class="header-right">
          <ThemeSwitcher />
          <el-dropdown @command="onCommand">
            <span class="user">
              <el-avatar :size="32" class="avatar">{{ store.user?.name?.[0] }}</el-avatar>
              <span class="uname">{{ store.user?.name }}</span>
              <el-tag size="small" effect="light" round>{{ store.user?.role === 'admin' ? '管理员' : '操作员' }}</el-tag>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="password">修改密码</el-dropdown-item>
                <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>
      <el-main ref="mainRef" class="main">
        <transition name="page-switch" mode="out-in">
          <div :key="$route.path" class="page-wrap">
            <router-view />
          </div>
        </transition>
      </el-main>
    </el-container>

    <el-dialog v-model="pwdVisible" title="修改密码" width="420px">
      <el-form label-width="90px">
        <el-form-item label="原密码">
          <el-input v-model="pwdForm.oldPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="pwdForm.newPassword" type="password" show-password placeholder="至少6位" />
        </el-form-item>
        <el-form-item label="确认新密码">
          <el-input v-model="pwdForm.confirm" type="password" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pwdVisible = false">取消</el-button>
        <el-button type="primary" @click="changePwd">保存</el-button>
      </template>
    </el-dialog>
  </el-container>
</template>

<script setup>
import { ref, reactive, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useUserStore } from '../store/user'
import ThemeSwitcher from '../components/ThemeSwitcher.vue'
import api from '../api'

const router = useRouter()
const route = useRoute()

// 切换页面时把内容区滚回顶部，配合过渡动画
const mainRef = ref(null)
watch(() => route.path, () => {
  const el = mainRef.value && mainRef.value.$el
  if (el) el.scrollTop = 0
})
const store = useUserStore()

// 菜单收缩状态，记住用户偏好
const isCollapse = ref(localStorage.getItem('menuCollapse') === '1')
function toggleCollapse() {
  isCollapse.value = !isCollapse.value
  localStorage.setItem('menuCollapse', isCollapse.value ? '1' : '0')
}

const allMenus = [
  { path: '/dashboard', title: '数据看板', icon: 'Odometer' },
  { path: '/spots', title: '车位管理', icon: 'Grid' },
  { path: '/vehicles', title: '车辆管理', icon: 'Van' },
  { path: '/records', title: '进出管理', icon: 'Switch' },
  { path: '/payments', title: '月卡缴费', icon: 'CreditCard' },
  { path: '/debts', title: '欠费管理', icon: 'Warning' },
  { path: '/reports', title: '报表中心', icon: 'TrendCharts' },
  { path: '/rules', title: '收费规则', icon: 'Coin' },
  { path: '/users', title: '系统用户', icon: 'UserFilled', admin: true },
  { path: '/logs', title: '操作日志', icon: 'Document' }
]
const menus = allMenus.filter(m => !m.admin || store.user?.role === 'admin')

const pwdVisible = ref(false)
const pwdForm = reactive({ oldPassword: '', newPassword: '', confirm: '' })

function onCommand(cmd) {
  if (cmd === 'logout') {
    const rt = store.logout()
    // 通知服务端撤销刷新令牌，避免旧凭证被复用
    if (rt) api.post('/auth/logout', { refreshToken: rt }).catch(() => {})
    router.replace('/login')
  }
  if (cmd === 'password') {
    Object.assign(pwdForm, { oldPassword: '', newPassword: '', confirm: '' })
    pwdVisible.value = true
  }
}
async function changePwd() {
  if (!pwdForm.oldPassword || !pwdForm.newPassword) return ElMessage.warning('请填写完整')
  if (pwdForm.newPassword !== pwdForm.confirm) return ElMessage.warning('两次输入的新密码不一致')
  const res = await api.put('/auth/password', pwdForm)
  if (res.code !== 0) return ElMessage.error(res.msg)
  ElMessage.success('密码修改成功，请重新登录')
  pwdVisible.value = false
  // 服务端已撤销该账号全部刷新令牌
  store.logout()
  router.replace('/login')
}
</script>

<style scoped>
.layout { height: 100vh; background: transparent; }

/* ---------- 侧边栏 ---------- */
.aside {
  background: var(--aside-bg);
  backdrop-filter: var(--blur);
  -webkit-backdrop-filter: var(--blur);
  border-right: 1px solid var(--border-soft);
  display: flex;
  flex-direction: column;
  box-shadow: inset -1px 0 0 var(--border-soft);
  transition: width .24s cubic-bezier(.4, 0, .2, 1), background-color .3s ease;
  overflow: hidden;
}
.brand {
  display: flex; align-items: center; gap: 10px;
  padding: 20px 22px; font-size: 18px; font-weight: 700;
  letter-spacing: .5px;
  color: var(--text);
  white-space: nowrap;
  transition: padding .24s cubic-bezier(.4, 0, .2, 1);
}
.brand-text { overflow: hidden; }

/* 收缩态：品牌区居中，仅留图标 */
.aside.is-collapsed .brand { justify-content: center; padding: 20px 0; }
.brand-icon {
  width: 36px; height: 36px; border-radius: 11px;
  background: var(--primary-grad); color: var(--primary-text);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 8px 20px color-mix(in srgb, var(--primary) 32%, transparent);
}

.menu {
  border-right: none;
  flex: 1;
  background: transparent;
  --el-menu-bg-color: transparent;
  --el-menu-text-color: var(--menu-text);
  --el-menu-hover-bg-color: var(--menu-hover-bg);
  --el-menu-active-color: var(--menu-active-text);
}
.menu :deep(.el-menu-item) {
  position: relative;
  border-radius: var(--radius-md); margin: 3px 10px; height: 44px;
  color: var(--menu-text);
  transition: background-color .18s, color .18s, box-shadow .18s;
}
.menu :deep(.el-menu-item:hover) {
  background: var(--menu-hover-bg);
  color: var(--primary);
}
.menu :deep(.el-menu-item.is-active) {
  background: var(--menu-active-bg);
  color: var(--menu-active-text);
  font-weight: 600;
  box-shadow: var(--menu-active-shadow);
}
.menu :deep(.el-menu-item.is-active)::before {
  content: '';
  position: absolute;
  left: 0; top: 50%;
  transform: translateY(-50%);
  width: 3px; height: 18px;
  border-radius: 0 3px 3px 0;
  background: var(--primary);
}

/* 收缩态：菜单占满侧栏宽度，图标居中，去掉文字段落间距 */
.aside.is-collapsed :deep(.el-menu--collapse) { width: 100%; }
.aside.is-collapsed :deep(.el-menu-item) {
  margin: 3px 9px;
  padding: 0 !important;
  justify-content: center;
}
/* 折叠时 Element 会在菜单项内套一层 tooltip 触发器，必须让它也居中，否则图标会偏左 */
.aside.is-collapsed :deep(.el-menu-tooltip__trigger) {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 0;
}
.aside.is-collapsed :deep(.el-menu-item .el-icon) { margin: 0; }
.aside.is-collapsed :deep(.el-menu-item.is-active)::before { display: none; }

/* ---------- Header ---------- */
.header {
  background: var(--header-bg);
  backdrop-filter: var(--blur);
  -webkit-backdrop-filter: var(--blur);
  border-bottom: 1px solid var(--border-soft);
  display: flex; align-items: center; justify-content: space-between;
  height: 60px;
  transition: background-color .3s ease;
}
.header-left { display: flex; align-items: center; gap: 10px; }
.header-right { display: flex; align-items: center; gap: 10px; }

.collapse-btn {
  width: 34px; height: 34px;
  padding: 0;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--input-bg);
  color: var(--text-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color .18s, color .18s, border-color .18s, box-shadow .18s, transform .18s;
}
.collapse-btn:hover {
  color: var(--primary);
  border-color: var(--primary);
  box-shadow: 0 6px 18px color-mix(in srgb, var(--primary) 20%, transparent);
}
.collapse-btn:active { transform: scale(0.94); }
.title {
  font-size: 17px; font-weight: 600;
  letter-spacing: .3px;
  color: var(--text);
}

.user {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 12px 5px 6px;
  border-radius: 999px;
  cursor: pointer;
  background: var(--input-bg);
  border: 1px solid var(--border);
  backdrop-filter: var(--blur-sm);
  transition: background-color .18s, box-shadow .18s, border-color .18s;
}
.user:hover {
  border-color: var(--primary);
  box-shadow: var(--shadow-sm);
}
.avatar {
  background: var(--primary-grad);
  color: var(--primary-text);
  font-weight: 600;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--primary) 30%, transparent);
}
.uname { font-size: 14px; color: var(--text); }

.main { padding: 20px; overflow: auto; background: transparent; }
</style>

