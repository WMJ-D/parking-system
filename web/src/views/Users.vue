<template>
  <div class="page-card">
    <div class="toolbar">
      <div class="grow" />
      <el-button type="primary" @click="openAdd">新增用户</el-button>
    </div>
    <el-table :data="list" stripe>
      <el-table-column prop="username" label="账号" width="150" />
      <el-table-column prop="name" label="姓名" width="150" />
      <el-table-column label="角色" width="120">
        <template #default="{ row }">
          <el-tag :type="row.role === 'admin' ? 'danger' : 'primary'" size="small" effect="light">
            {{ row.role === 'admin' ? '管理员' : '操作员' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" min-width="160" />
      <el-table-column label="操作" width="160">
        <template #default="{ row }">
          <el-button link type="primary" @click="openReset(row)">重置密码</el-button>
          <el-button link type="danger" :disabled="row.id === store.user?.id" @click="del(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination class="pager" layout="total, sizes, prev, pager, next" :total="total"
      :page-sizes="[10, 20, 50, 100]"
      v-model:page-size="query.size" v-model:current-page="query.page"
      @size-change="onSizeChange" @current-change="load" />
  </div>

  <el-dialog v-model="resetVisible" append-to-body title="重置密码" width="400px">
    <el-form label-width="90px">
      <el-form-item label="用户">
        <span>{{ resetUser.name }}（{{ resetUser.username }}）</span>
      </el-form-item>
      <el-form-item label="新密码">
        <el-input v-model="resetPwd" type="password" show-password placeholder="至少6位" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="resetVisible = false">取消</el-button>
      <el-button type="primary" @click="doReset">确认重置</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="dlgVisible" append-to-body title="新增用户" width="440px">
    <el-form label-width="80px">
      <el-form-item label="账号"><el-input v-model="form.username" /></el-form-item>
      <el-form-item label="密码"><el-input v-model="form.password" type="password" show-password /></el-form-item>
      <el-form-item label="姓名"><el-input v-model="form.name" /></el-form-item>
      <el-form-item label="角色">
        <el-radio-group v-model="form.role">
          <el-radio value="operator">操作员</el-radio>
          <el-radio value="admin">管理员</el-radio>
        </el-radio-group>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dlgVisible = false">取消</el-button>
      <el-button type="primary" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'
import { useUserStore } from '../store/user'

const store = useUserStore()
const list = ref([])
const total = ref(0)
const query = reactive({ page: 1, size: 10 })
const dlgVisible = ref(false)
const resetVisible = ref(false)
const resetUser = ref({})
const resetPwd = ref('')
const form = reactive({ username: '', password: '', name: '', role: 'operator' })

// 切换每页条数：回到第一页重新加载
function onSizeChange() { query.page = 1; load() }

async function load() {
  const res = await api.get('/users', { params: query })
  list.value = res.data.list
  total.value = res.data.total
}
function openAdd() {
  Object.assign(form, { username: '', password: '', name: '', role: 'operator' })
  dlgVisible.value = true
}
async function save() {
  if (!form.username || !form.password || !form.name) return ElMessage.warning('请填写完整信息')
  const res = await api.post('/users', form)
  if (res.code !== 0) return ElMessage.error(res.msg)
  ElMessage.success('用户已创建')
  dlgVisible.value = false
  query.page = 1
  load()
}
async function del(row) {
  await ElMessageBox.confirm(`确定删除用户 ${row.name} 吗？`, '提示', { type: 'warning' })
  const res = await api.delete(`/users/${row.id}`)
  if (res.code !== 0) return ElMessage.error(res.msg)
  ElMessage.success('已删除')
  load()
}

function openReset(row) {
  resetUser.value = row
  resetPwd.value = ''
  resetVisible.value = true
}
async function doReset() {
  if (!resetPwd.value || resetPwd.value.length < 6) return ElMessage.warning('新密码至少6位')
  const res = await api.put(`/users/${resetUser.value.id}/password`, { newPassword: resetPwd.value })
  if (res.code !== 0) return ElMessage.error(res.msg)
  ElMessage.success('密码已重置')
  resetVisible.value = false
}

onMounted(load)
</script>

<style scoped>
.pager { margin-top: 14px; justify-content: flex-end; }
</style>
