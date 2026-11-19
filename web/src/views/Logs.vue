<template>
  <div class="page-card">
    <el-table :data="list" stripe>
      <el-table-column prop="created_at" label="时间" width="170" />
      <el-table-column prop="username" label="操作人" width="120" />
      <el-table-column prop="action" label="操作" width="140" />
      <el-table-column prop="detail" label="详情" min-width="300" />
    </el-table>
    <el-pagination class="pager" layout="total, sizes, prev, pager, next" :total="total"
      :page-sizes="[10, 20, 50, 100]"
      v-model:page-size="query.size" v-model:current-page="query.page"
      @size-change="onSizeChange" @current-change="load" />
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import api from '../api'

const list = ref([])
const total = ref(0)
const query = reactive({ page: 1, size: 10 })
// 切换每页条数：回到第一页重新加载
function onSizeChange() { query.page = 1; load() }

async function load() {
  const res = await api.get('/logs', { params: query })
  list.value = res.data.list
  total.value = res.data.total
}
onMounted(load)
</script>

<style scoped>
.pager { margin-top: 14px; justify-content: flex-end; }
</style>
