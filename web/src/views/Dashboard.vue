<template>
  <div v-if="data">
    <div class="stat-row">
      <div class="page-card stat">
        <div class="icon i-blue"><el-icon :size="24"><Grid /></el-icon></div>
        <div><div class="num">{{ data.spots.total }}</div><div class="label">总车位</div></div>
      </div>
      <div class="page-card stat">
        <div class="icon i-green"><el-icon :size="24"><CircleCheck /></el-icon></div>
        <div><div class="num">{{ data.spots.occupied || 0 }}</div><div class="label">占用中</div></div>
      </div>
      <div class="page-card stat">
        <div class="icon i-orange"><el-icon :size="24"><Switch /></el-icon></div>
        <div><div class="num">{{ data.todayIn }}</div><div class="label">今日入场</div></div>
      </div>
      <div class="page-card stat">
        <div class="icon i-purple"><el-icon :size="24"><Money /></el-icon></div>
        <div><div class="num">¥{{ data.todayIncome }}</div><div class="label">今日收入</div></div>
      </div>
      <div class="page-card stat">
        <div class="icon i-cyan"><el-icon :size="24"><CreditCard /></el-icon></div>
        <div><div class="num">¥{{ data.monthIncome }}</div><div class="label">本月收入</div></div>
      </div>
    </div>

    <el-row :gutter="16" class="mt16">
      <el-col :span="16">
        <el-alert v-if="data.longStay.length" type="warning" :closable="false" class="long-stay-alert">
          <template #title>
            <span class="ls-title">⚠ 长时间停车预警：{{ data.longStay.length }} 辆在场超24小时</span>
          </template>
          <div v-for="v in data.longStay" :key="v.plate_no" class="ls-row">
            <b>{{ v.plate_no }}</b>
            <span>{{ v.spot_no || '未分配' }} 车位</span>
            <span>已停 {{ v.h }} 小时</span>
          </div>
        </el-alert>
        <div class="page-card" :class="{ 'mt-alert': data.longStay.length }">
          <h3 class="card-title">近7日收费趋势</h3>
          <div ref="chartRef" style="height: 300px"></div>
        </div>
      </el-col>
      <el-col :span="8">
        <div class="page-card">
          <h3 class="card-title">车位使用率 {{ occupancy }}%</h3>
          <el-progress type="dashboard" :percentage="occupancy" :width="180" :color="grad">
            <template #default>{{ data.spots.occupied || 0 }} / {{ data.spots.total }}</template>
          </el-progress>
          <div class="spot-legend">
            <span><i class="dot d-green"></i>空闲 {{ data.spots.free || 0 }}</span>
            <span><i class="dot d-red"></i>占用 {{ data.spots.occupied || 0 }}</span>
            <span><i class="dot d-gray"></i>停用 {{ data.spots.disabled || 0 }}</span>
          </div>
        </div>
        <div class="page-card mt16">
          <h3 class="card-title">车位构成</h3>
          <div class="type-row">
            <span class="type-dot d-fixed"></span>
            <span class="type-label">固定车位</span>
            <span class="type-num">{{ data.spotTypes.fixed.total }} 个</span>
            <el-tag size="small" type="danger" effect="light" round>占用 {{ data.spotTypes.fixed.occupied }}</el-tag>
          </div>
          <div class="type-row">
            <span class="type-dot d-temp"></span>
            <span class="type-label">临时车位</span>
            <span class="type-num">{{ data.spotTypes.temporary.total }} 个</span>
            <el-tag size="small" type="danger" effect="light" round>占用 {{ data.spotTypes.temporary.occupied }}</el-tag>
          </div>
          <div class="bind-rate">
            <div class="bind-head">
              <span>固定车位绑定率</span>
              <b>{{ data.spotTypes.bindRate }}%</b>
            </div>
            <el-progress :percentage="data.spotTypes.bindRate" :stroke-width="10"
              :color="[{ color: '#5b6cff', percentage: 100 }]" :show-text="false" />
            <div class="bind-sub">已绑定 {{ data.spotTypes.fixed.bound }} / 共 {{ data.spotTypes.fixed.total }} 个固定车位</div>
          </div>
        </div>
        <div class="page-card mt16">
          <h3 class="card-title">月卡到期提醒（30天内）</h3>
          <el-empty v-if="!data.expireSoon.length" description="暂无即将到期的月卡" :image-size="60" />
          <div v-for="v in data.expireSoon" :key="v.id" class="exp-row">
            <b>{{ v.plate_no }}</b>
            <span class="owner">{{ v.owner_name }}</span>
            <el-tag :type="expireType(v.card_expire)" size="small">{{ v.card_expire }} 到期</el-tag>
            <el-button link type="primary" @click="goRenew(v)">续费</el-button>
          </div>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import * as echarts from 'echarts'
import api from '../api'
import { currentTheme } from '../composables/useTheme'

const router = useRouter()

const data = ref(null)
const chartRef = ref(null)
let chart = null

// ECharts 是 canvas 渲染，读不到 CSS 变量，必须手动取值
function cssVar(name, fallback = '') {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

const grad = computed(() => {
  currentTheme.value // 主题变化时重新取色
  return [
    { offset: 0.7, color: cssVar('--primary', '#4e5bf2') },
    { offset: 1, color: '#f56c6c' }
  ]
})

const occupancy = computed(() => {
  if (!data.value || !data.value.spots.total) return 0
  return Math.round((data.value.spots.occupied || 0) / data.value.spots.total * 100)
})

function expireType(d) {
  const days = (new Date(d) - new Date()) / 86400000
  return days < 7 ? 'danger' : 'warning'
}

function goRenew(v) {
  router.push('/payments?vehicle_id=' + v.id)
}

function renderChart() {
  if (!data.value || !chartRef.value) return
  if (!chart) chart = echarts.init(chartRef.value)

  const text = cssVar('--text', '#1f2329')
  const text2 = cssVar('--text-2', '#646a73')
  const text3 = cssVar('--text-3', '#8f959e')
  const border = cssVar('--border', 'rgba(0,0,0,.1)')
  const borderSoft = cssVar('--border-soft', border)
  const surface = cssVar('--surface-solid', '#ffffff')
  const primary = cssVar('--primary', '#5b6cff')

  chart.setOption({
    textStyle: { color: text2 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: surface,
      borderColor: border,
      textStyle: { color: text }
    },
    grid: { left: 40, right: 20, top: 30, bottom: 30 },
    xAxis: {
      type: 'category',
      data: data.value.trend.map(t => t.dt.slice(5)),
      axisLabel: { color: text3 },
      axisLine: { lineStyle: { color: border } }
    },
    yAxis: [
      {
        type: 'value',
        name: '收入(元)',
        nameTextStyle: { color: text3 },
        axisLabel: { color: text3 },
        splitLine: { lineStyle: { color: borderSoft } }
      },
      {
        type: 'value',
        name: '车次',
        nameTextStyle: { color: text3 },
        axisLabel: { color: text3 },
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: '收入', type: 'bar', data: data.value.trend.map(t => Number(t.income)),
        itemStyle: { borderRadius: [6, 6, 0, 0], color: primary },
        barWidth: 22
      },
      {
        name: '车次', type: 'line', yAxisIndex: 1,
        data: data.value.trend.map(t => t.cnt),
        smooth: true, color: '#33c9a3'
      }
    ]
  }, true)
}

watch(currentTheme, async () => {
  await nextTick()
  renderChart()
})

onMounted(async () => {
  const res = await api.get('/dashboard')
  data.value = res.data
  await nextTick()
  renderChart()
  window.addEventListener('resize', () => chart && chart.resize())
})
</script>

<style scoped>
.stat-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; }
.stat { display: flex; align-items: center; gap: 14px; padding: 18px; }
.stat .icon { width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: #fff; }
.i-blue { background: linear-gradient(135deg, #5b6cff, #7a8cff); }
.i-green { background: linear-gradient(135deg, #2bb673, #4cd694); }
.i-orange { background: linear-gradient(135deg, #ff9440, #ffb46b); }
.i-purple { background: linear-gradient(135deg, #7a5cff, #a08bff); }
.i-cyan { background: linear-gradient(135deg, #17b0c4, #4ecfdf); }
.stat .num { font-size: 24px; font-weight: 700; }
.stat .label { color: var(--text-2); font-size: 13px; }
.mt16 { margin-top: 16px; }
.card-title { margin: 0 0 14px; font-size: 15px; }
.spot-legend { display: flex; justify-content: center; gap: 18px; margin-top: 10px; font-size: 13px; color: var(--text-2); }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 4px; }
.d-green { background: #2bb673; } .d-red { background: #f56c6c; } .d-gray { background: #c0c4cc; }
.exp-row { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--border-soft); font-size: 14px; }
.exp-row:last-child { border-bottom: none; }
.owner { color: var(--text-2); flex: 1; }
.type-row { display: flex; align-items: center; gap: 10px; padding: 7px 0; font-size: 14px; }
.type-dot { width: 10px; height: 10px; border-radius: 3px; flex: none; }
.d-fixed { background: linear-gradient(135deg, #5b6cff, #8f7bff); }
.d-temp { background: linear-gradient(135deg, #17b0c4, #4ecfdf); }
.type-label { color: var(--text-2); }
.type-num { flex: 1; font-weight: 700; }
.bind-rate { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-soft); }
.bind-head { display: flex; justify-content: space-between; font-size: 13px; color: var(--text-2); margin-bottom: 8px; }
.bind-head b { color: var(--primary); font-size: 16px; }
.bind-sub { font-size: 12px; color: var(--text-2); margin-top: 6px; }
.long-stay-alert { border-radius: 14px; margin-bottom: 16px; }
.mt-alert { margin-top: 0; }
.ls-title { font-weight: 600; color: #b45309; }
.ls-row { display: flex; gap: 12px; font-size: 13px; padding: 2px 0; }
.ls-row b { color: #d03030; }
</style>
