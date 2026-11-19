<template>
  <el-row :gutter="16">
    <el-col :span="9">
      <div class="page-card">
        <h3 class="card-title">月卡续费</h3>
        <el-form label-width="90px">
          <el-form-item label="选择车辆">
            <el-select v-model="form.vehicle_id" filterable placeholder="输入车牌搜索" style="width: 100%">
              <el-option v-for="v in vehicles" :key="v.id" :label="`${v.plate_no} (${v.owner_name})`" :value="v.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="续费月数">
            <el-input-number v-model="form.months" :min="1" :max="24" />
            <span class="price-tip">¥{{ rule.monthly_price }}/月</span>
          </el-form-item>
          <el-form-item label="备注"><el-input v-model="form.remark" /></el-form-item>
          <el-button type="primary" size="large" class="pay-btn" @click="submit">
            确认缴费 ¥{{ totalFee }}
          </el-button>
        </el-form>
      </div>
    </el-col>
    <el-col :span="15">
      <div class="page-card">
        <h3 class="card-title">缴费记录</h3>
        <el-table :data="list" stripe max-height="400">
          <el-table-column prop="plate_no" label="车牌号" width="110" />
          <el-table-column prop="owner_name" label="车主" width="100" />
          <el-table-column prop="months" label="月数" width="70" />
          <el-table-column prop="amount" label="金额" width="90">
            <template #default="{ row }">¥{{ row.amount }}</template>
          </el-table-column>
          <el-table-column prop="start_date" label="生效日" width="105" />
          <el-table-column prop="end_date" label="到期日" width="105" />
          <el-table-column prop="pay_time" label="缴费时间" width="165" />
          <el-table-column prop="operator" label="操作员" />
        </el-table>
        <el-pagination class="pager" layout="total, sizes, prev, pager, next" :total="total"
          :page-sizes="[10, 20, 50, 100]"
          v-model:page-size="query.size" v-model:current-page="query.page"
          @size-change="onSizeChange" @current-change="load" />
      </div>
    </el-col>
  </el-row>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import api from '../api'

const route = useRoute()

const vehicles = ref([])
const list = ref([])
const total = ref(0)
const query = reactive({ page: 1, size: 10 })
const rule = ref({ monthly_price: 300 })
const form = reactive({ vehicle_id: null, months: 12, remark: '' })

const totalFee = computed(() => (Number(rule.value.monthly_price) * form.months).toFixed(2))

// 切换每页条数：回到第一页重新加载
function onSizeChange() { query.page = 1; load() }

async function load() {
  const [v, p, r] = await Promise.all([
    api.get('/vehicles', { params: { page: 1, size: 100 } }),
    api.get('/payments', { params: query }),
    api.get('/rules')
  ])
  vehicles.value = v.data.list
  list.value = p.data.list
  total.value = p.data.total
  rule.value = r.data[0] || rule.value
}
async function submit() {
  if (!form.vehicle_id) return ElMessage.warning('请选择车辆')
  const res = await api.post('/payments', form)
  if (res.code !== 0) return ElMessage.error(res.msg)
  ElMessage.success(`续费成功，金额 ¥${res.data.amount}，新到期日 ${res.data.end_date}`)
  form.vehicle_id = null; form.remark = ''
  query.page = 1
  load()
}

onMounted(() => {
  load()
  // 从看板"到期提醒"点续费跳转过来时，自动选中该车辆
  if (route.query.vehicle_id) {
    form.vehicle_id = Number(route.query.vehicle_id)
  }
})
</script>

<style scoped>
.card-title { margin: 0 0 14px; font-size: 15px; }
.price-tip { margin-left: 10px; color: var(--text-2); font-size: 13px; }
.pay-btn { width: 100%; background: var(--primary-grad); border: none; }
.pager { margin-top: 14px; justify-content: flex-end; }
</style>
