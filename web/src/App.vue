<template>
  <router-view />
</template>

<script setup>
import { onMounted } from 'vue'
import { ensureFreshToken } from './api'

// 应用启动时若 access token 已过期，先静默续期一次，避免首屏请求 401
onMounted(() => {
  ensureFreshToken()
})
</script>
