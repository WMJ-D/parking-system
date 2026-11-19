import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '../store/user'

const routes = [
  { path: '/login', component: () => import('../views/Login.vue') },
  {
    path: '/',
    component: () => import('../views/Layout.vue'),
    redirect: '/dashboard',
    children: [
      { path: 'dashboard', component: () => import('../views/Dashboard.vue'), meta: { title: '数据看板' } },
      { path: 'spots', component: () => import('../views/Spots.vue'), meta: { title: '车位管理' } },
      { path: 'vehicles', component: () => import('../views/Vehicles.vue'), meta: { title: '车辆管理' } },
      { path: 'records', component: () => import('../views/Records.vue'), meta: { title: '进出管理' } },
      { path: 'payments', component: () => import('../views/Payments.vue'), meta: { title: '月卡缴费' } },
      { path: 'debts', component: () => import('../views/Debts.vue'), meta: { title: '欠费管理' } },
      { path: 'reports', component: () => import('../views/Reports.vue'), meta: { title: '报表中心' } },
      { path: 'rules', component: () => import('../views/Rules.vue'), meta: { title: '收费规则' } },
      { path: 'users', component: () => import('../views/Users.vue'), meta: { title: '系统用户', admin: true } },
      { path: 'logs', component: () => import('../views/Logs.vue'), meta: { title: '操作日志' } }
    ]
  },
  { path: '/:pathMatch(.*)*', redirect: '/' }
]

const router = createRouter({ history: createWebHistory(), routes })

router.beforeEach(to => {
  const store = useUserStore()

  // 已登录还去登录页 → 回首页
  if (to.path === '/login') {
    return store.isLoggedIn ? { path: '/dashboard' } : true
  }

  // 未登录（或 refresh token 都没了）→ 去登录页，并记住原地址
  if (!store.isLoggedIn) {
    const redirect = to.fullPath && to.fullPath !== '/' ? to.fullPath : undefined
    return { path: '/login', query: redirect ? { redirect } : {} }
  }

  // 管理员页面权限
  if (to.meta && to.meta.admin && !store.isAdmin) {
    return { path: '/dashboard' }
  }

  return true
})

export default router
