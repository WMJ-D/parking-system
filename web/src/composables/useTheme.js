import { ref } from 'vue'

const STORAGE_KEY = 'app-theme'

/**
 * 主题清单
 * key     —— 对应 themes.css 中的 [data-theme="key"]
 * swatch  —— 面板里的色卡预览
 * dark    —— 深色主题，用于设置 color-scheme（原生控件/滚动条跟随）
 */
export const THEMES = [
  { key: 'glass', name: '玻璃拟态', desc: '磨砂玻璃与实景光影', swatch: 'linear-gradient(135deg,#eef1f8,#c8d4ff)', dot: '#4e5bf2', dark: false },
  { key: 'neu', name: '新拟态', desc: '柔和浮雕与双向投影', swatch: 'linear-gradient(135deg,#eef0f6,#d0d6e3)', dot: '#5b6ef5', dark: false },
  { key: 'minimal', name: '简约', desc: '留白与利落分割线', swatch: 'linear-gradient(135deg,#ffffff,#e9edf3)', dot: '#2b5cff', dark: false },
  { key: 'douyin', name: '抖音', desc: '暗夜霓虹青与电光粉', swatch: 'linear-gradient(135deg,#101016,#241020)', dot: '#25f4ee', dark: true },
  { key: 'doubao', name: '豆包', desc: '清透底色与蓝紫渐变', swatch: 'linear-gradient(135deg,#f6f7fd,#e3e6ff)', dot: '#5b6cff', dark: false },
  { key: 'bluewhite', name: '蓝白', desc: '商务蓝与纯净留白', swatch: 'linear-gradient(135deg,#f2f7ff,#cfe3ff)', dot: '#1668dc', dark: false },
  { key: 'cake', name: '彩色蛋糕', desc: '奶油粉彩与糖果色', swatch: 'linear-gradient(135deg,#ffe6f1,#e0f7fb 52%,#fff3cd)', dot: '#ff6fa5', dark: false },
  { key: 'mars', name: '火星', desc: '锈红岩尘与落日余温', swatch: 'linear-gradient(135deg,#2a140c,#52240f)', dot: '#ff6b35', dark: true },
  { key: 'sun', name: '太阳', desc: '暖金日光与明亮通透', swatch: 'linear-gradient(135deg,#fff8e8,#ffd97a)', dot: '#f59e0b', dark: false },
  { key: 'moon', name: '月亮', desc: '深空静夜与星点微光', swatch: 'linear-gradient(135deg,#0b1230,#23305c)', dot: '#8ab4ff', dark: true },
  { key: 'earth', name: '地球', desc: '海洋青绿与大气光晕', swatch: 'linear-gradient(135deg,#06222a,#154854)', dot: '#2fbf9f', dark: true },
  { key: 'sakura', name: '樱花', desc: '淡粉花瓣与浅樱柔光', swatch: 'linear-gradient(135deg,#ffeef4,#ffd7e4)', dot: '#e8618c', dark: false },
  { key: 'grassland', name: '草原', desc: '青草绿地与暖阳', swatch: 'linear-gradient(135deg,#f2f8ec,#cfe8b4)', dot: '#4a9e3f', dark: false },
  { key: 'ocean', name: '大海', desc: '深海蓝与波光青', swatch: 'linear-gradient(135deg,#062436,#0d4460)', dot: '#3fc4e8', dark: true },
  { key: 'desert', name: '沙漠', desc: '沙丘金与暖日光', swatch: 'linear-gradient(135deg,#fdf6e8,#f0d9a8)', dot: '#c98a3a', dark: false },
  { key: 'cyberpunk', name: '赛博朋克', desc: '紫黑底与霓虹品红', swatch: 'linear-gradient(135deg,#12061f,#3a1155)', dot: '#ff2fd0', dark: true },
  { key: 'wasteland', name: '废土', desc: '锈黄尘埃与残破灰', swatch: 'linear-gradient(135deg,#1f1a12,#3d3524)', dot: '#c9a227', dark: true },
  { key: 'future', name: '未来科技', desc: '深空蓝与荧光蓝', swatch: 'linear-gradient(135deg,#081428,#123256)', dot: '#2f8bff', dark: true },
  { key: 'mecha', name: '机械', desc: '石墨钢与黄铜质感', swatch: 'linear-gradient(135deg,#1a1e26,#39424e)', dot: '#d4a017', dark: true },
  { key: 'sky', name: '天空', desc: '晴空蓝与云朵白', swatch: 'linear-gradient(135deg,#dcefff,#f4faff)', dot: '#38a2f0', dark: false },
  { key: 'snow', name: '雪山', desc: '冷白蓝与雪线高光', swatch: 'linear-gradient(135deg,#eaf4fc,#f8fbfe)', dot: '#4f8fc9', dark: false },
  { key: 'volcano', name: '火山', desc: '黑岩与岩浆橙红', swatch: 'linear-gradient(135deg,#240a06,#5a1a08)', dot: '#ff5722', dark: true },
  { key: 'european', name: '欧式', desc: '米白与古典金', swatch: 'linear-gradient(135deg,#f7f2e8,#e4d6bb)', dot: '#b08d4f', dark: false },
  { key: 'galaxy', name: '银河', desc: '深紫星云与点点星光', swatch: 'linear-gradient(135deg,#120a26,#33205c)', dot: '#a06bff', dark: true },
  { key: 'government', name: '政务', desc: '白底正红与严谨排版', swatch: 'linear-gradient(135deg,#eef2f7,#ffffff)', dot: '#c8102e', dark: false }
]

const DARK_KEYS = THEMES.filter(t => t.dark).map(t => t.key)

const isValid = key => THEMES.some(t => t.key === key)

export const currentTheme = ref(localStorage.getItem(STORAGE_KEY) || 'glass')

export function isDarkTheme(key = currentTheme.value) {
  return DARK_KEYS.includes(key)
}

/**
 * 应用主题
 * @param {string} key 主题标识
 * @param {boolean} animate 是否播放过渡（初始化时关掉，避免首屏闪动）
 */
export function applyTheme(key, animate = true) {
  const target = isValid(key) ? key : 'glass'
  const root = document.documentElement

  if (animate) {
    root.classList.add('theme-switching')
    window.clearTimeout(applyTheme._timer)
    applyTheme._timer = window.setTimeout(() => root.classList.remove('theme-switching'), 320)
  }

  root.setAttribute('data-theme', target)
  // 让原生控件（输入框、滚动条）跟随明暗
  root.style.colorScheme = isDarkTheme(target) ? 'dark' : 'light'
  localStorage.setItem(STORAGE_KEY, target)
  currentTheme.value = target
}

export function initTheme() {
  applyTheme(localStorage.getItem(STORAGE_KEY) || 'glass', false)
}

export function useTheme() {
  return { current: currentTheme, themes: THEMES, applyTheme }
}
