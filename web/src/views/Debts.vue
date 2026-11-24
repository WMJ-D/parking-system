<template>
  <div class="page-card">
    <el-alert type="info" :closable="false" title="以下为出场时未缴费的历史欠费，按车牌汇总。结清后对应记录标记为已缴。" style="margin-bottom: 16px" />
    <el-table :data="list" stripe>
      <el-table-column prop="plate_no" label="车牌号" width="130">
        <template #default="{ row }"><b>{{ row.plate_no }}</b></template>
      </el-table-column>
      <el-table-column prop="cnt" label="欠费笔数" width="110" />
      <el-table-column label="欠费总额" width="130">
        <template #default="{ row }"><span class="debt-num">¥{{ row.total }}</span></template>
      </el-table-column>
      <el-table-column prop="last_time" label="最近欠费时间" min-width="165" />
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row)">查看明细</el-button>
          <el-button link type="success" @click="settle(row)">一键结清</el-button>
        </template>
      </el-table-column>
      <template #empty>太好了，当前没有任何欠费 🎉</template>
    </el-table>
  </div>

  <el-dialog v-model="detailVisible" append-to-body :title="`${detailPlate} 欠费明细`" width="640px">
    <el-table :data="detail" stripe max-height="380">
      <el-table-column prop="exit_time" label="出场时间" width="165" />
      <el-table-column prop="spot_no" label="车位" width="90">
        <template #default="{ row }">{{ row.spot_no || '—' }}</template>
      </el-table-column>
      <el-table-column prop="fee" label="欠费金额" width="100">
        <template #default="{ row }">¥{{ row.fee }}</template>
      </el-table-column>
      <el-table-column prop="operator" label="操作员" />
    </el-table>
    <template #footer>
      <el-button @click="detailVisible = false">关闭</el-button>
      <el-button type="primary" @click="settleFromDetail">结清全部 ¥{{ detailTotal }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'

const list = ref([])
const detailVisible = ref(false)
const detailPlate = ref('')
const detail = ref([])
const detailTotal = computed(() => detail.value.reduce((s, r) => s + Number(r.fee), 0).toFixed(2))

async function load() {
  const res = await api.get('/debts')
  list.value = res.data
}
async function openDetail(row) {
  detailPlate.value = row.plate_no
  const res = await api.get('/debts/detail', { params: { plate_no: row.plate_no } })
  detail.value = res.data
  detailVisible.value = true
}
async function settle(row) {
  await ElMessageBox.confirm(
    `确认收到 ${row.plate_no} 的全部欠费 ¥${row.total}（${row.cnt} 笔）吗？`, '结清欠费', { type: 'warning' })
  const res = await api.post('/debts/settle', { plate_no: row.plate_no })
  if (res.code !== 0) return ElMessage.error(res.msg)
  ElMessage.success(`已结清 ${res.data.cnt} 笔，共 ¥${res.data.total}`)
  detailVisible.value = false
  load()
}
function settleFromDetail() {
  const row = list.value.find(r => r.plate_no === detailPlate.value)
  if (row) settle(row)
}

onMounted(load)
</script>

<style scoped>
.debt-num { color: #f56c6c; font-weight: 700; font-size: 15px; }
</style>
