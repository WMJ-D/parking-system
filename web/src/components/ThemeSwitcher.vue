<template>
  <el-popover
    placement="bottom-end"
    :width="520"
    trigger="click"
    popper-class="theme-popper"
    :show-arrow="false"
    :offset="10"
  >
    <template #reference>
      <button class="icon-btn" title="切换主题">
        <el-icon :size="17"><Brush /></el-icon>
      </button>
    </template>

    <div class="theme-panel">
      <div class="theme-panel__head">
        <span class="theme-panel__title">主题风格</span>
        <span class="theme-panel__count">{{ themes.length }} 套可选</span>
      </div>

      <div class="theme-scroll">
        <div class="theme-group">
          <div class="theme-group__label">浅色 · {{ lightThemes.length }}</div>
          <div class="theme-grid">
            <button
              v-for="t in lightThemes"
              :key="t.key"
              class="theme-item"
              :class="{ 'is-active': current === t.key }"
              :title="t.desc"
              @click="pick(t.key)"
            >
              <span class="theme-swatch" :style="{ background: t.swatch }">
                <span class="theme-dot" :style="{ background: t.dot }"></span>
                <span v-if="current === t.key" class="theme-check">
                  <el-icon :size="10"><Check /></el-icon>
                </span>
              </span>
              <span class="theme-name">{{ t.name }}</span>
            </button>
          </div>
        </div>

        <div class="theme-group">
          <div class="theme-group__label">深色 · {{ darkThemes.length }}</div>
          <div class="theme-grid">
            <button
              v-for="t in darkThemes"
              :key="t.key"
              class="theme-item"
              :class="{ 'is-active': current === t.key }"
              :title="t.desc"
              @click="pick(t.key)"
            >
              <span class="theme-swatch" :style="{ background: t.swatch }">
                <span class="theme-dot" :style="{ background: t.dot }"></span>
                <span v-if="current === t.key" class="theme-check">
                  <el-icon :size="10"><Check /></el-icon>
                </span>
              </span>
              <span class="theme-name">{{ t.name }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </el-popover>
</template>

<script setup>
import { computed } from 'vue'
import { useTheme } from '../composables/useTheme'

const { current, themes, applyTheme } = useTheme()

const lightThemes = computed(() => themes.filter(t => !t.dark))
const darkThemes = computed(() => themes.filter(t => t.dark))

function pick(key) {
  if (key === current.value) return
  applyTheme(key)
}
</script>

<style scoped>
.icon-btn {
  width: 34px;
  height: 34px;
  padding: 0;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--input-bg);
  color: var(--text-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: color .18s, border-color .18s, box-shadow .18s, transform .18s;
}
.icon-btn:hover {
  color: var(--primary);
  border-color: var(--primary);
  box-shadow: 0 4px 14px color-mix(in srgb, var(--primary) 22%, transparent);
}
.icon-btn:active { transform: scale(0.94); }

.theme-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.theme-panel__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.theme-panel__count {
  font-size: 12px;
  color: var(--text-3);
}

/* 25 套主题，超高时滚动；同时限制在视口内，避免矮屏被裁 */
.theme-scroll {
  max-height: min(520px, calc(100vh - 190px));
  overflow-y: auto;
  padding-right: 4px;
  margin-right: -4px;
}

.theme-group + .theme-group { margin-top: 16px; }
.theme-group__label {
  font-size: 11px;
  letter-spacing: .5px;
  color: var(--text-3);
  margin-bottom: 8px;
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px 6px;
}

.theme-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 5px 4px;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  transition: background-color .16s, border-color .16s;
}
.theme-item:hover { background: var(--primary-weak); }
.theme-item.is-active {
  border-color: var(--primary);
  background: var(--primary-weak);
}

.theme-swatch {
  position: relative;
  width: 100%;
  height: 36px;
  border-radius: 9px;
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45);
}
.theme-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
}
.theme-check {
  position: absolute;
  right: -4px;
  bottom: -4px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--primary);
  color: var(--primary-text);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--surface-solid);
}
.theme-name {
  font-size: 11px;
  line-height: 1.2;
  color: var(--text-2);
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.theme-item.is-active .theme-name {
  color: var(--primary);
  font-weight: 600;
}

@media (max-width: 620px) {
  .theme-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
</style>

<style>
/* popper 容器由 Element 创建并 teleport 到 body，scoped 管不到，单独放全局 */
.theme-popper.el-popover.el-popper {
  padding: 14px;
  border-radius: var(--radius) !important;
}
</style>
