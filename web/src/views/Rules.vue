<template>
  <div class="page-card" style="max-width: 640px">
    <h3 class="card-title">临时车收费规则</h3>
    <el-form label-width="120px" v-if="form.name !== undefined">
      <el-form-item label="规则名称"><el-input v-model="form.name" /></el-form-item>
      <el-form-item label="免费时长(分钟)">
        <el-input-number v-model="form.free_minutes" :min="0" :max="120" />
      </el-form-item>
      <el-form-item label="每小时单价(元)">
        <el-input-number v-model="form.price_per_hour" :min="0.5" :max="20" :step="0.5" />
      </el-form-item>
      <el-form-item label="每日封顶(元)">
        <el-input-number v-model="form.daily_cap" :min="1" :max="200" :step="5" />
      </el-form-item>
      <el-form-item label="月卡价格(元/月)">
        <el-input-number v-model="form.monthly_price" :min="50" :max="2000" :step="50" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="save">保存规则</el-button>
      </el-form-item>
    </el-form>
    <el-alert type="info" :closable="false"
      title="计费说明：不足免费时长的免收费用；超过后按小时向上取整计费，单日封顶。有效月卡车辆免费。" />
  </div>
</template>

<script setup>
import { reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'

const form = reactive({})

async function load() {
  const res = await api.get('/rules')
  Object.assign(form, res.data[0] || {})
}
async function save() {
  const res = await api.put(`/rules/${form.id}`, form)
  if (res.code !== 0) return ElMessage.error(res.msg)
  ElMessage.success('规则已保存')
}

onMounted(load)
</script>

<style scoped>
.card-title { margin: 0 0 18px; font-size: 15px; }
</style>
