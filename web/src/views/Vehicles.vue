<template>
  <div class="page-card">
    <div class="toolbar">
      <el-input v-model="query.keyword" placeholder="车牌/车主/电话/房号" clearable style="width: 200px" @keyup.enter="load" />
      <el-select v-model="query.vtype" placeholder="车辆类型" clearable style="width: 130px">
        <el-option label="住户车辆" value="resident" /><el-option label="临时车辆" value="temp" />
      </el-select>
      <el-select v-model="query.monthly" placeholder="月卡" clearable style="width: 110px">
        <el-option label="有月卡" :value="1" /><el-option label="无月卡" :value="0" />
      </el-select>
      <el-select v-model="query.blacklist" placeholder="黑名单" clearable style="width: 110px">
        <el-option label="黑名单" :value="1" /><el-option label="正常" :value="0" />
      </el-select>
      <el-button type="primary" @click="search">查询</el-button>
      <div class="grow" />
      <el-button type="primary" @click="openAdd">登记车辆</el-button>
    </div>

    <el-table :data="list" stripe>
      <el-table-column prop="plate_no" label="车牌号" width="120" />
      <el-table-column prop="owner_name" label="车主" width="110" />
      <el-table-column prop="phone" label="电话" width="130">
        <template #default="{ row }">{{ row.phone || '—' }}</template>
      </el-table-column>
      <el-table-column prop="house_no" label="房号" width="110">
        <template #default="{ row }">{{ row.house_no || '—' }}</template>
      </el-table-column>
      <el-table-column label="类型" width="100">
        <template #default="{ row }">
          <el-tag size="small" :type="row.vtype === 'resident' ? 'primary' : 'info'">
            {{ row.vtype === 'resident' ? '住户' : '临时' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="月卡" min-width="180">
        <template #default="{ row }">
          <template v-if="row.monthly_card">
            <el-tag size="small" :type="expired(row.card_expire) ? 'danger' : 'success'" effect="light">
              {{ expired(row.card_expire) ? '已到期' : '有效' }}
            </el-tag>
            <span style="margin-left: 6px">{{ row.card_expire }}</span>
          </template>
          <span v-else style="color: var(--text-2)">—</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag v-if="row.blacklist" size="small" type="danger" effect="dark">黑名单</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button v-if="!row.blacklist" link type="warning" @click="toggleBlack(row, true)">拉黑</el-button>
          <el-button v-else link type="success" @click="toggleBlack(row, false)">移出</el-button>
          <el-button link type="danger" @click="del(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination class="pager" layout="total, sizes, prev, pager, next" :total="total"
      :page-sizes="[10, 20, 50, 100]"
      v-model:page-size="query.size" v-model:current-page="query.page"
      @size-change="onSizeChange" @current-change="load" />
  </div>

  <el-dialog v-model="dlgVisible" append-to-body :title="form.id ? '编辑车辆' : '登记车辆'" width="480px">
    <el-form label-width="90px">
      <el-form-item label="车牌号"><el-input v-model="form.plate_no" placeholder="如 京A12345" /></el-form-item>
      <el-form-item label="车主姓名"><el-input v-model="form.owner_name" /></el-form-item>
      <el-form-item label="电话"><el-input v-model="form.phone" /></el-form-item>
      <el-form-item label="房号"><el-input v-model="form.house_no" /></el-form-item>
      <el-form-item label="车辆类型">
        <el-radio-group v-model="form.vtype">
          <el-radio value="resident">住户车辆</el-radio>
          <el-radio value="temp">临时车辆</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="月卡">
        <el-switch v-model="form.monthly_card" />
        <el-date-picker v-if="form.monthly_card" v-model="form.card_expire" type="date" value-format="YYYY-MM-DD"
          placeholder="月卡到期日" style="margin-left: 12px" />
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

const list = ref([])
const query = reactive({ keyword: '', vtype: '', monthly: '', blacklist: '', page: 1, size: 10 })
const total = ref(0)
const dlgVisible = ref(false)
const form = reactive({})

function expired(d) { return d && new Date(d + ' 23:59:59') < new Date() }

function search() { query.page = 1; load() }
// 切换每页条数：回到第一页重新加载
function onSizeChange() { query.page = 1; load() }

async function load() {
  const res = await api.get('/vehicles', { params: query })
  list.value = res.data.list
  total.value = res.data.total
}
function openAdd() {
  Object.assign(form, { id: null, plate_no: '', owner_name: '', phone: '', house_no: '', vtype: 'resident', monthly_card: false, card_expire: '' })
  dlgVisible.value = true
}
function openEdit(row) {
  Object.assign(form, { ...row, monthly_card: !!row.monthly_card })
  dlgVisible.value = true
}
async function save() {
  if (!form.plate_no || !form.owner_name) return ElMessage.warning('请填写车牌号和车主姓名')
  const res = form.id ? await api.put(`/vehicles/${form.id}`, form) : await api.post('/vehicles', form)
  if (res.code !== 0) return ElMessage.error(res.msg)
  ElMessage.success('保存成功')
  dlgVisible.value = false
  load()
}
async function del(row) {
  await ElMessageBox.confirm(`确定删除车辆 ${row.plate_no}（${row.owner_name}）吗？`, '提示', { type: 'warning' })
  const res = await api.delete(`/vehicles/${row.id}`)
  if (res.code !== 0) return ElMessage.error(res.msg)
  ElMessage.success('已删除')
  load()
}
async function toggleBlack(row, blacklist) {
  let reason = ''
  if (blacklist) {
    const { value } = await ElMessageBox.prompt(`将 ${row.plate_no}（${row.owner_name}）加入黑名单，该车将禁止入场`, '拉黑车辆', {
      inputPlaceholder: '拉黑原因（欠费、恶意逃费等）', type: 'warning',
      confirmButtonText: '确认拉黑', cancelButtonText: '取消'
    })
    reason = value || ''
  } else {
    await ElMessageBox.confirm(`确定将 ${row.plate_no} 移出黑名单吗？`, '提示', { type: 'success' })
  }
  const res = await api.put(`/vehicles/${row.id}/blacklist`, { blacklist, reason })
  if (res.code !== 0) return ElMessage.error(res.msg)
  ElMessage.success(blacklist ? '已拉黑' : '已移出黑名单')
  load()
}

onMounted(load)
</script>

<style scoped>
.pager { margin-top: 14px; justify-content: flex-end; }
</style>
