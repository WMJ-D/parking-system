<template>
  <div class="page-card spots-page">
    <div class="head-actions">
      <el-button @click="addZoneVisible = true">新增分区</el-button>
      <el-button type="primary" @click="openAdd">新增车位</el-button>
    </div>

    <el-tabs v-model="activeTab" class="spot-tabs">
      <!-- ============ 车位图 ============ -->
      <el-tab-pane name="map">
        <template #label>
          <span class="tab-label"><el-icon><Grid /></el-icon>车位图</span>
        </template>

        <div class="map-bar">
          <div class="legend">
            <span><i class="dot d-free"></i>空闲</span>
            <span><i class="dot d-occupied"></i>占用</span>
            <span><i class="dot d-disabled"></i>停用</span>
            <span class="tag-fix"><el-tag size="small" type="primary">固</el-tag>固定</span>
          </div>
          <span class="map-total">共 {{ spotMapData.length }} 个车位</span>
        </div>

        <div v-for="(spots, zone) in spotMap" :key="zone" class="zone">
          <div class="zone-name">{{ zone }}</div>
          <div class="spot-grid">
            <el-tooltip v-for="s in spots" :key="s.id" placement="top" effect="dark">
              <template #content>
                <div style="line-height: 1.8">
                  <b>{{ s.spot_no }}</b>（{{ s.stype === 'fixed' ? '固定车位' : '临时车位' }}）<br />
                  状态：{{ { free: '空闲', occupied: '占用', disabled: '停用' }[s.status] }}<br />
                  <template v-if="s.plate_no">绑定：{{ s.plate_no }}（{{ s.owner_name }}）</template>
                  <template v-else>未绑定车辆</template>
                </div>
              </template>
              <div class="spot" :class="'st-' + s.status" @click="openEdit(s)">
                <div class="spot-no">{{ s.spot_no }}</div>
                <div class="spot-info">
                  <span v-if="s.stype === 'fixed'" class="fix-badge">固</span>
                  <span class="spot-plate">{{ s.plate_no || '&nbsp;' }}</span>
                </div>
              </div>
            </el-tooltip>
          </div>
        </div>

        <el-empty v-if="!spotMapData.length" description="暂无车位数据" :image-size="80" />
      </el-tab-pane>

      <!-- ============ 车位列表 ============ -->
      <el-tab-pane name="list" lazy>
        <template #label>
          <span class="tab-label"><el-icon><List /></el-icon>车位列表</span>
        </template>

        <div class="toolbar">
          <el-select v-model="query.zone_id" placeholder="全部分区" clearable style="width: 140px">
            <el-option v-for="z in zones" :key="z.id" :label="z.name" :value="z.id" />
          </el-select>
          <el-select v-model="query.status" placeholder="全部状态" clearable style="width: 130px">
            <el-option label="空闲" value="free" /><el-option label="占用" value="occupied" /><el-option label="停用" value="disabled" />
          </el-select>
          <el-input v-model="query.keyword" placeholder="车位号/车牌" clearable style="width: 180px" @keyup.enter="load" />
          <el-button type="primary" @click="search">查询</el-button>
        </div>

        <el-table ref="tableRef" :data="list" stripe>
          <el-table-column prop="spot_no" label="车位号" width="110" />
          <el-table-column prop="zone_name" label="分区" width="90" />
          <el-table-column label="类型" width="100">
            <template #default="{ row }">
              <el-tag :type="row.stype === 'fixed' ? 'primary' : 'info'" effect="light" size="small">
                {{ row.stype === 'fixed' ? '固定车位' : '临时车位' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.status === 'free' ? 'success' : row.status === 'occupied' ? 'danger' : 'info'" size="small">
                {{ { free: '空闲', occupied: '占用', disabled: '停用' }[row.status] }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="plate_no" label="绑定车辆" min-width="150">
            <template #default="{ row }">{{ row.plate_no || '—' }}</template>
          </el-table-column>
          <el-table-column prop="owner_name" label="车主" min-width="130">
            <template #default="{ row }">{{ row.owner_name || '—' }}</template>
          </el-table-column>
          <el-table-column label="操作" min-width="140" align="center">
            <template #default="{ row }">
              <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
              <el-button link type="danger" @click="del(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-pagination class="pager" layout="total, sizes, prev, pager, next" :total="total"
          :page-sizes="[10, 20, 50, 100]"
          v-model:page-size="query.size" v-model:current-page="query.page"
          @size-change="onSizeChange" @current-change="load" />
      </el-tab-pane>
    </el-tabs>
  </div>

  <el-dialog v-model="dlgVisible" append-to-body :title="form.id ? '编辑车位' : '新增车位'" width="440px">
    <el-form label-width="90px">
      <el-form-item label="车位号"><el-input v-model="form.spot_no" placeholder="如 A-021" /></el-form-item>
      <el-form-item label="分区">
        <el-select v-model="form.zone_id" style="width: 100%">
          <el-option v-for="z in zones" :key="z.id" :label="z.name" :value="z.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="类型">
        <el-radio-group v-model="form.stype">
          <el-radio value="fixed">固定车位</el-radio>
          <el-radio value="temporary">临时车位</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item v-if="form.id" label="状态">
        <el-select v-model="form.status" style="width: 100%">
          <el-option label="空闲" value="free" /><el-option label="停用" value="disabled" />
        </el-select>
      </el-form-item>
      <el-form-item label="绑定车辆">
        <el-select v-model="form.vehicle_id" clearable filterable placeholder="选择住户车辆" style="width: 100%">
          <el-option v-for="v in vehicles" :key="v.id" :label="`${v.plate_no} (${v.owner_name})`" :value="v.id" />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dlgVisible = false">取消</el-button>
      <el-button type="primary" @click="save">保存</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="addZoneVisible" append-to-body title="新增分区" width="400px">
    <el-form label-width="80px">
      <el-form-item label="名称"><el-input v-model="zoneForm.name" /></el-form-item>
      <el-form-item label="备注"><el-input v-model="zoneForm.remark" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="addZoneVisible = false">取消</el-button>
      <el-button type="primary" @click="addZone">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, onMounted, watch, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'

const list = ref([])
const zones = ref([])
const vehicles = ref([])
const query = reactive({ zone_id: '', status: '', keyword: '', page: 1, size: 10 })
const total = ref(0)
const spotMap = ref({})

const spotMapData = ref([])
const dlgVisible = ref(false)
const addZoneVisible = ref(false)
const zoneForm = reactive({ name: '', remark: '' })
const form = reactive({ id: null, spot_no: '', zone_id: '', stype: 'temporary', status: 'free', vehicle_id: null })

// 车位图 / 车位列表 切换
const activeTab = ref('map')
const tableRef = ref(null)

// 表格在隐藏的 Tab 中初始化时宽度会按 0 计算，切回来必须重算布局
watch(activeTab, async v => {
  if (v !== 'list') return
  await nextTick()
  if (tableRef.value) tableRef.value.doLayout()
})

function search() { query.page = 1; load() }
async function loadMap() {
  const res = await api.get('/spots/map')
  spotMapData.value = res.data
  spotMap.value = res.data.reduce((m, s) => {
    (m[s.zone_name] = m[s.zone_name] || []).push(s)
    return m
  }, {})
}
// 切换每页条数：回到第一页重新加载
function onSizeChange() { query.page = 1; load() }

async function load() {
  const res = await api.get('/spots', { params: query })
  list.value = res.data.list
  total.value = res.data.total
}
async function loadZones() {
  const res = await api.get('/zones')
  zones.value = res.data
}
async function loadVehicles() {
  const res = await api.get('/vehicles', { params: { page: 1, size: 100 } })
  vehicles.value = res.data.list
}

function openAdd() {
  Object.assign(form, { id: null, spot_no: '', zone_id: zones.value[0]?.id, stype: 'temporary', status: 'free', vehicle_id: null })
  dlgVisible.value = true
}
function openEdit(row) {
  Object.assign(form, { id: row.id, spot_no: row.spot_no, zone_id: row.zone_id, stype: row.stype, status: row.status, vehicle_id: row.vehicle_id })
  dlgVisible.value = true
}
async function save() {
  if (!form.spot_no || !form.zone_id) return ElMessage.warning('请填写车位号和分区')
  const res = form.id ? await api.put(`/spots/${form.id}`, form) : await api.post('/spots', form)
  if (res.code !== 0) return ElMessage.error(res.msg)
  ElMessage.success('保存成功')
  dlgVisible.value = false
  load()
  loadMap()
}
async function del(row) {
  await ElMessageBox.confirm(`确定删除车位 ${row.spot_no} 吗？`, '提示', { type: 'warning' })
  const res = await api.delete(`/spots/${row.id}`)
  if (res.code !== 0) return ElMessage.error(res.msg)
  ElMessage.success('已删除')
  load()
  loadMap()
}
async function addZone() {
  if (!zoneForm.name) return ElMessage.warning('请输入分区名称')
  const res = await api.post('/zones', zoneForm)
  if (res.code !== 0) return ElMessage.error(res.msg)
  ElMessage.success('分区已创建')
  addZoneVisible.value = false
  zoneForm.name = ''; zoneForm.remark = ''
  loadZones()
}

onMounted(() => { load(); loadMap(); loadZones(); loadVehicles() })
</script>

<style scoped>
.spots-page { position: relative; }

/* 右上角全局操作按钮，与 Tab 头部同一行 */
.head-actions {
  position: absolute;
  top: 20px;
  right: 20px;
  display: flex;
  gap: 10px;
  z-index: 2;
}

/* ---------- Tab 头部玻璃化 ---------- */
.spot-tabs :deep(.el-tabs__header) { margin-bottom: 18px; padding-right: 220px; }
.spot-tabs :deep(.el-tabs__nav-wrap::after) { height: 1px; background-color: var(--border-soft); }
.spot-tabs :deep(.el-tabs__item) {
  height: 40px;
  font-size: 14px;
  color: var(--text-2);
  transition: color .18s;
}
.spot-tabs :deep(.el-tabs__item:hover) { color: var(--primary); }
.spot-tabs :deep(.el-tabs__item.is-active) { color: var(--primary); font-weight: 600; }
.spot-tabs :deep(.el-tabs__active-bar) {
  height: 3px;
  border-radius: 3px 3px 0 0;
  background: var(--primary);
}
.tab-label { display: inline-flex; align-items: center; gap: 6px; }

/* Tab 内容淡入，避免切换生硬 */
@keyframes tabIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}
.spot-tabs :deep(.el-tab-pane) {
  animation: tabIn .24s cubic-bezier(.22, .61, .36, 1);
}

/* ---------- 车位图 ---------- */
.map-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.legend { display: flex; gap: 16px; font-size: 13px; color: var(--text-2); align-items: center; }
.legend .dot { margin-right: 4px; }
.tag-fix { display: flex; align-items: center; gap: 4px; }
.map-total { font-size: 13px; color: var(--text-2); }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; }
.d-free { background: #2bb673; }
.d-occupied { background: #f56c6c; }
.d-disabled { background: #c0c4cc; }
.zone { margin-bottom: 16px; }
.zone:last-child { margin-bottom: 0; }
.zone-name { font-weight: 600; font-size: 14px; margin-bottom: 8px; color: var(--text); }
.spot-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
.spot {
  border-radius: var(--radius-sm); padding: 8px 10px; cursor: pointer;
  border: 1.5px solid transparent; transition: transform .12s, box-shadow .12s, background-color .2s;
  background: var(--surface-2);
  backdrop-filter: var(--blur-sm);
}
.spot:hover { transform: translateY(-2px); box-shadow: var(--shadow-sm); }
/* 状态色与主题底色混合：浅色主题是淡彩，深色主题自动变成深底彩 */
.st-free {
  background: color-mix(in srgb, #2bb673 16%, var(--surface-solid));
  border-color: color-mix(in srgb, #2bb673 42%, transparent);
}
.st-occupied {
  background: color-mix(in srgb, #f56c6c 18%, var(--surface-solid));
  border-color: color-mix(in srgb, #f56c6c 45%, transparent);
}
.st-disabled {
  background: color-mix(in srgb, #98a2b3 12%, var(--surface-solid));
  border-color: color-mix(in srgb, #98a2b3 30%, transparent);
  opacity: .6;
}
.spot-no { font-weight: 700; font-size: 14px; color: var(--text); }
.spot-info { display: flex; align-items: center; gap: 4px; margin-top: 2px; min-height: 18px; }
.fix-badge {
  font-size: 10px; color: var(--primary);
  border: 1px solid color-mix(in srgb, var(--primary) 40%, transparent);
  border-radius: 4px; padding: 0 3px; line-height: 14px; flex: none;
}
.spot-plate { font-size: 11px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.st-occupied .spot-plate { color: color-mix(in srgb, #f56c6c 75%, var(--text)); font-weight: 600; }

/* ---------- 车位列表 ---------- */
.pager { margin-top: 14px; justify-content: flex-end; }
</style>
