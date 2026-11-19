<template>
  <div>
    <div class="page-card">
      <div class="toolbar">
        <el-date-picker v-model="month" type="month" value-format="YYYY-MM" :clearable="false"
          placeholder="选择月份" style="width: 150px" @change="load" />
        <div class="grow" />
        <el-button @click="exportIncome"><el-icon><Download /></el-icon>&nbsp;导出收入报表</el-button>
        <el-button type="primary" @click="exportRecords"><el-icon><Download /></el-icon>&nbsp;导出进出记录</el-button>
      </div>
      <div class="stat-row">
        <div class="mini"><div class="mini-num">¥{{ total.income }}</div><div class="mini-label">{{ month }} 总收入</div></div>
        <div class="mini"><div class="mini-num">{{ total.cnt }}</div><div class="mini-label">出场车次</div></div>
        <div class="mini"><div class="mini-num">¥{{ avgDay }}</div><div class="mini-label">日均收入</div></div>
        <div class="mini"><div class="mini-num">¥{{ best.income }}</div><div class="mini-label">最高单日{{ best.d ? `（${best.d.slice(5)}）` : '' }}</div></div>
      </div>
      <div ref="chartRef" style="height: 280px"></div>
    </div>

    <div class="page-card" style="margin-top: 16px">
      <h3 class="card-title">{{ month }} 每日明细</h3>
      <el-table :data="daily" stripe>
        <el-table-column prop="d" label="日期" width="130" />
        <el-table-column prop="cnt" label="出场车次" width="120" />
        <el-table-column label="收入(元)">
          <template #default="{ row }"><b>¥{{ row.income }}</b></template>
        </el-table-column>
        <template #empty>该月暂无出场收费数据</template>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import * as echarts from 'echarts'
import api, { ensureFreshToken } from '../api'
import { currentTheme } from '../composables/useTheme'

const month = ref(new Date().toISOString().slice(0, 7))
const daily = ref([])
const total = ref({ cnt: 0, income: 0 })
const chartRef = ref(null)
let chart = null

// ECharts canvas 读不到 CSS 变量，需要手动取值
function cssVar(name, fallback = '') {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

const avgDay = computed(() => {
  if (!daily.value.length) return '0.00'
  return (Number(total.value.income) / daily.value.length).toFixed(2)
})
const best = computed(() => daily.value.reduce((b, r) => Number(r.income) > Number(b.income || 0) ? r : b, { income: 0, d: '' }))

function renderChart() {
  if (!chartRef.value) return
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
    grid: { left: 50, right: 20, top: 30, bottom: 30 },
    xAxis: {
      type: 'category',
      data: daily.value.map(d => d.d.slice(8)),
      axisLabel: { color: text3 },
      axisLine: { lineStyle: { color: border } }
    },
    yAxis: {
      type: 'value',
      name: '收入(元)',
      nameTextStyle: { color: text3 },
      axisLabel: { color: text3 },
      splitLine: { lineStyle: { color: borderSoft } }
    },
    series: [{
      name: '收入', type: 'bar', data: daily.value.map(d => Number(d.income)),
      itemStyle: { borderRadius: [6, 6, 0, 0], color: primary }
    }]
  }, true)
}

async function load() {
  const res = await api.get('/reports/income', { params: { month: month.value } })
  daily.value = res.data.daily
  total.value = res.data.total
  await nextTick()
  renderChart()
}

watch(currentTheme, async () => {
  await nextTick()
  renderChart()
})

// 导出走浏览器直连，无法携带请求头，因此把 token 放 query。
// 先确保 access token 新鲜，避免点导出时刚好过期拿到 401。
async function openExport(url) {
  const fresh = await ensureFreshToken()
  const token = fresh || localStorage.getItem('token') || ''
  const a = document.createElement('a')
  a.href = `${url}&token=${encodeURIComponent(token)}`
  a.target = '_blank'
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

function exportIncome() {
  openExport(`/api/export/income?month=${month.value}`)
}
function exportRecords() {
  const start = `${month.value}-01`
  const end = new Date(Number(month.value.slice(0, 4)), Number(month.value.slice(5, 7)), 0).toISOString().slice(0, 10)
  openExport(`/api/export/records?start=${start}&end=${end}`)
}

onMounted(() => {
  load()
  window.addEventListener('resize', () => chart && chart.resize())
})
</script>

<style scoped>
.stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 16px; }
.mini {
  background: var(--surface-2);
  backdrop-filter: var(--blur-sm);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 16px;
  box-shadow: var(--shadow-sm);
  transition: background-color .3s, border-color .3s;
}
.mini-num { font-size: 22px; font-weight: 700; color: var(--primary); }
.mini-label { font-size: 12px; color: var(--text-2); margin-top: 4px; }
.card-title { margin: 0 0 14px; font-size: 15px; }
</style>
