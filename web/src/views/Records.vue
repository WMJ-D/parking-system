<template>
  <el-row :gutter="16">
    <el-col :span="10">
      <div class="page-card">
        <h3 class="card-title">车辆入场</h3>
        <el-input v-model="entryPlate" size="large" placeholder="请输入车牌号，如 京A12345">
          <template #prefix><el-icon><Van /></el-icon></template>
        </el-input>
        <el-button type="primary" size="large" class="entry-btn" @click="entry">确认入场</el-button>
        <div class="entry-tip">入场后系统自动分配车位：优先固定车位，其次同类型空闲车位</div>
      </div>
    </el-col>
    <el-col :span="14">
      <div class="page-card">
        <h3 class="card-title">场内车辆（{{ inList.length }}）</h3>
        <div class="in-grid">
          <div v-for="r in inList" :key="r.id" class="in-card" :class="{ 'in-long': hours(r.entry_time) > 24 }">
            <div class="in-top">
              <span class="in-plate">{{ r.plate_no }}</span>
              <el-tooltip v-if="hours(r.entry_time) > 24" content="已超24小时，请关注" placement="top">
                <el-tag size="small" type="danger" effect="dark">超24h</el-tag>
              </el-tooltip>
              <el-button type="primary" size="small" round class="in-btn" @click="openExit(r)">出场结算</el-button>
            </div>
            <div class="in-meta">
              <el-tag size="small" effect="plain" class="in-spot">{{ r.spot_no || '未分配' }}</el-tag>
              <span class="in-time"><el-icon><Clock /></el-icon>{{ fmt(r.entry_time) }}</span>
              <span class="in-dur">{{ dur(r.entry_time) }}</span>
            </div>
          </div>
          <el-empty v-if="!inList.length" description="暂无场内车辆" :image-size="70" style="grid-column: 1 / -1" />
        </div>
      </div>
    </el-col>
  </el-row>

  <div class="page-card" style="margin-top: 16px">
    <div class="toolbar">
      <el-input v-model="query.keyword" placeholder="车牌号" clearable style="width: 170px" @keyup.enter="load" />
      <el-select v-model="query.status" placeholder="状态" clearable style="width: 130px">
        <el-option label="在场" value="in" /><el-option label="已出场" value="out" />
      </el-select>
      <el-date-picker v-model="range" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始日期" end-placeholder="结束日期" style="width: 240px" />
      <el-button type="primary" @click="load">查询</el-button>
    </div>
    <el-table :data="list" stripe>
      <el-table-column prop="plate_no" label="车牌号" width="110" />
      <el-table-column prop="spot_no" label="车位" width="90">
        <template #default="{ row }">{{ row.spot_no || '—' }}</template>
      </el-table-column>
      <el-table-column prop="entry_time" label="入场时间" width="165" />
      <el-table-column prop="exit_time" label="出场时间" width="165">
        <template #default="{ row }">{{ row.exit_time || '—' }}</template>
      </el-table-column>
      <el-table-column label="费用" width="110">
        <template #default="{ row }">
          <span v-if="row.status === 'in'" style="color: var(--text-2)">未结算</span>
          <span v-else>¥{{ row.actual_fee ?? row.fee }}</span>
        </template>
      </el-table-column>
      <el-table-column label="缴费状态" width="100">
        <template #default="{ row }">
          <el-tag v-if="row.status === 'in'" type="warning" size="small">在场</el-tag>
          <el-tag v-else :type="{ paid: 'success', free: 'info', unpaid: 'danger' }[row.pay_status]" size="small">
            {{ { paid: '已缴', free: '免费', unpaid: '未缴' }[row.pay_status] }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="operator" label="操作员" width="110" />
      <el-table-column label="操作" min-width="120">
        <template #default="{ row }">
          <el-button v-if="row.status === 'in'" link type="primary" @click="openExit(row)">出场结算</el-button>
          <el-button v-if="row.status === 'in' && row.pay_status === 'unpaid'" link type="success" @click="prepay(row)">预缴费</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination class="pager" layout="total, sizes, prev, pager, next" :total="total"
      :page-sizes="[10, 20, 50, 100]"
      v-model:page-size="query.size" v-model:current-page="query.page"
      @size-change="onSizeChange" @current-change="load" />
  </div>

  <el-dialog v-model="regVisible" append-to-body title="车辆未登记，请先登记" width="460px">
    <el-alert type="warning" :closable="false" :title="`车牌 ${regForm.plate_no} 尚未登记，请补全车主信息后入场`" style="margin-bottom: 16px" />
    <el-form label-width="90px">
      <el-form-item label="车牌号"><el-input v-model="regForm.plate_no" disabled /></el-form-item>
      <el-form-item label="车主姓名"><el-input v-model="regForm.owner_name" placeholder="必填" /></el-form-item>
      <el-form-item label="电话"><el-input v-model="regForm.phone" /></el-form-item>
      <el-form-item label="房号"><el-input v-model="regForm.house_no" /></el-form-item>
      <el-form-item label="车辆类型">
        <el-radio-group v-model="regForm.vtype">
          <el-radio value="temp">临时车辆</el-radio>
          <el-radio value="resident">住户车辆</el-radio>
        </el-radio-group>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="regVisible = false">取消</el-button>
      <el-button type="primary" @click="registerAndEntry">登记并入场</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="exitVisible" append-to-body title="出场结算" width="430px">
    <template v-if="exitInfo">
      <div class="exit-plate">{{ exitRec?.plate_no }}</div>
      <el-descriptions :column="1" border>
        <el-descriptions-item label="入场时间">{{ exitRec?.entry_time }}</el-descriptions-item>
        <el-descriptions-item label="停车时长">{{ hoursText(exitInfo.hours) }}</el-descriptions-item>
        <el-descriptions-item label="计费规则">
          免费{{ exitInfo.rule.free_minutes }}分钟，{{ exitInfo.rule.price_per_hour }}元/小时，每日封顶{{ exitInfo.rule.daily_cap }}元
        </el-descriptions-item>
        <el-descriptions-item v-if="exitInfo.cardCoveredUntil" label="月卡跨期">
          <el-tag type="warning" size="small" effect="light">月卡覆盖至 {{ exitInfo.cardCoveredUntil }}，过期后时段按规则计费</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="应收金额">
          <span class="fee-num" :class="{ 'fee-free': exitInfo.free }">¥{{ exitInfo.fee }}</span>
          <el-tag v-if="exitInfo.free" type="success" size="small" style="margin-left: 8px">月卡有效，免费</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="收款方式">
          <el-radio-group v-model="exitPayChoice" :disabled="exitInfo.fee <= 0">
            <el-radio value="paid">已收款</el-radio>
            <el-radio value="unpaid">未缴放行（挂账）</el-radio>
          </el-radio-group>
        </el-descriptions-item>
      </el-descriptions>
    </template>
    <template #footer>
      <el-button @click="exitVisible = false">取消</el-button>
      <el-button type="primary" :loading="exiting" @click="confirmExit">确认收款并放行</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'

const entryPlate = ref('')
const inList = ref([])
const list = ref([])
const total = ref(0)
const range = ref([])
const query = reactive({ keyword: '', status: '', page: 1, size: 10 })
const exitVisible = ref(false)
const exitRec = ref(null)
const exitInfo = ref(null)
const exiting = ref(false)
const exitPayChoice = ref('paid')
const regVisible = ref(false)
const regForm = reactive({ plate_no: '', owner_name: '', phone: '', house_no: '', vtype: 'temp' })

const fmt = t => (t || '').slice(5, 16)
function hours(t) { return (Date.now() - new Date(t).getTime()) / 3600000 }
function hoursText(h) {
  if (h < 24) return `${h} 小时`
  const d = Math.floor(h / 24), rest = Math.round((h - d * 24) * 10) / 10
  return `${d} 天 ${rest} 小时`
}
function dur(t) {
  const h = hours(t)
  return h < 1 ? `${Math.round(h * 60)}分钟` : `${Math.floor(h)}小时${Math.round((h % 1) * 60)}分`
}

// 切换每页条数：回到第一页重新加载
function onSizeChange() { query.page = 1; load() }

async function load() {
  const params = { ...query }
  if (range.value && range.value.length === 2) { params.start = range.value[0]; params.end = range.value[1] }
  const res = await api.get('/records', { params })
  list.value = res.data.list
  total.value = res.data.total
}
async function loadIn() {
  const res = await api.get('/records', { params: { status: 'in', size: 100, page: 1 } })
  inList.value = res.data.list
}

async function entry() {
  if (!entryPlate.value) return ElMessage.warning('请输入车牌号')
  const plate = entryPlate.value.trim()
  const res = await api.post('/records/entry', { plate_no: plate })
  if (res.code === 1 && (res.data?.needRegister || (res.msg || '').includes('未登记'))) {
    // 未登记车辆：弹出登记框，确认后登记并入场
    Object.assign(regForm, { plate_no: plate, owner_name: '', phone: '', house_no: '', vtype: 'temp' })
    regVisible.value = true
    return
  }
  if (res.code !== 0) {
    if (res.data?.blocked) {
      ElMessageBox.alert(res.msg, '黑名单拦截', { type: 'error', confirmButtonText: '知道了' })
    } else {
      ElMessage.error(res.msg)
    }
    return
  }
  if (res.data.debt > 0) {
    ElMessage({ type: 'warning', duration: 6000,
      message: `入场成功，分配车位：${res.data.spotNo}。注意：该车有历史欠费 ¥${res.data.debt}` })
  } else {
    ElMessage.success(`入场成功，分配车位：${res.data.spotNo}`)
  }
  entryPlate.value = ''
  load(); loadIn()
}

async function registerAndEntry() {
  if (!regForm.owner_name) return ElMessage.warning('请填写车主姓名')
  const reg = await api.post('/vehicles', regForm)
  if (reg.code !== 0) return ElMessage.error(reg.msg)
  const res = await api.post('/records/entry', { plate_no: regForm.plate_no })
  if (res.code !== 0) return ElMessage.error(res.msg)
  ElMessage.success(`登记成功并入场，分配车位：${res.data.spotNo}`)
  regVisible.value = false
  entryPlate.value = ''
  load(); loadIn()
}

async function openExit(row) {
  exitRec.value = row
  exitPayChoice.value = 'paid'
  const res = await api.get(`/records/${row.id}/fee`)
  if (res.code !== 0) return ElMessage.error(res.msg)
  exitInfo.value = res.data
  exitVisible.value = true
}
async function confirmExit() {
  if (exiting.value) return
  exiting.value = true
  try {
    const res = await api.post(`/records/${exitRec.value.id}/exit`, { unpaid: exitPayChoice.value === 'unpaid' })
    if (res.code !== 0) return ElMessage.error(res.msg)
    ElMessage.success(exitPayChoice.value === 'unpaid'
      ? `已放行，¥${res.data.actual} 记入欠费`
      : `出场成功，实收 ¥${res.data.actual}`)
    exitVisible.value = false
    load(); loadIn()
  } finally {
    exiting.value = false
  }
}
async function prepay(row) {
  await ElMessageBox.confirm(`确认 ${row.plate_no} 已预缴停车费吗？`, '预缴费', { type: 'info' })
  const res = await api.post(`/records/${row.id}/pay`, { actual_fee: 0 })
  if (res.code !== 0) return ElMessage.error(res.msg)
  ElMessage.success('已标记预缴费')
  load()
}

watch(() => query.status, () => { query.page = 1; load() })
onMounted(() => { load(); loadIn() })
</script>

<style scoped>
.card-title { margin: 0 0 14px; font-size: 15px; }
.entry-btn { width: 100%; margin-top: 14px; background: var(--primary-grad); border: none; }
.entry-tip { color: var(--text-2); font-size: 12px; margin-top: 12px; text-align: center; }
.in-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 12px; max-height: 340px; overflow: auto; padding: 2px;
}
.in-card {
  border: 1px solid var(--border); border-radius: var(--radius-md); padding: 10px 12px;
  background: var(--surface-2);
  backdrop-filter: var(--blur-sm);
  display: flex; flex-direction: column; gap: 8px;
  transition: box-shadow .15s, transform .15s, border-color .15s;
}
.in-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-sm);
  border-color: var(--primary);
}
.in-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.in-plate {
  font-weight: 700; font-size: 15px; color: var(--primary);
  background: var(--primary-weak);
  border: 1px solid color-mix(in srgb, var(--primary) 30%, transparent);
  padding: 3px 10px; border-radius: 8px; letter-spacing: .5px; white-space: nowrap;
}
.in-meta { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-2); flex-wrap: wrap; }
.in-spot { color: var(--primary); }
.in-time { display: inline-flex; align-items: center; gap: 3px; }
.in-dur { color: #ff9440; font-weight: 600; white-space: nowrap; }
.in-btn { background: var(--primary-grad); border: none; padding-left: 16px; padding-right: 16px; flex: none; }
.in-long {
  border-color: color-mix(in srgb, #f56c6c 45%, transparent);
  background: color-mix(in srgb, #f56c6c 12%, var(--surface-solid));
}
.in-long:hover {
  border-color: color-mix(in srgb, #f56c6c 65%, transparent);
  box-shadow: 0 8px 22px color-mix(in srgb, #f56c6c 26%, transparent);
}
.pager { margin-top: 14px; justify-content: flex-end; }
.exit-plate { font-size: 20px; font-weight: 700; text-align: center; margin-bottom: 14px; color: var(--primary); }
.fee-num { font-size: 24px; font-weight: 700; color: #f56c6c; }
.fee-free { color: #2bb673; }
</style>
