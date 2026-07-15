import { computed } from 'vue'

// 主题管理 Composable - 状态保存在浏览器 localStorage 中
export const useTheme = () => {
  const STORAGE_KEY = 'voicehub-theme'
  const THEMES = ['dark', 'light'] // 暗色主题 / 浅色主题
  const THEME_LABELS = { dark: '深色主题', light: '浅色主题' } // 主题显示名称
  const THEME_ICONS = { dark: 'moon', light: 'sun' } // 主题图标

  // 获取保存的主题，默认 dark
  const getSavedTheme = () => {
    if (typeof window === 'undefined') return 'dark'
    return localStorage.getItem(STORAGE_KEY) || 'dark'
  }

  // 应用主题到 DOM
  const applyTheme = (theme) => {
    if (typeof window === 'undefined') return
    const root = document.documentElement
    root.setAttribute('data-theme', theme)
  }

  // 初始化：从 localStorage 读取并应用
  const initTheme = () => {
    if (typeof window === 'undefined') return
    const savedTheme = getSavedTheme()
    applyTheme(savedTheme)
  }

  // 切换主题（循环切换）
  const cycleTheme = () => {
    if (typeof window === 'undefined') return
    const currentIndex = THEMES.indexOf(getSavedTheme())
    const nextIndex = (currentIndex + 1) % THEMES.length
    const nextTheme = THEMES[nextIndex]
    localStorage.setItem(STORAGE_KEY, nextTheme)
    applyTheme(nextTheme)
    return nextTheme
  }

  // 直接设置指定主题
  const setTheme = (theme) => {
    if (!THEMES.includes(theme)) return
    if (typeof window === 'undefined') return
    localStorage.setItem(STORAGE_KEY, theme)
    applyTheme(theme)
  }

  // 获取当前主题
  const currentTheme = computed(() => getSavedTheme())

  return {
    initTheme,
    cycleTheme,
    setTheme,
    currentTheme,
    THEMES,
    THEME_LABELS,
    THEME_ICONS
  }
}
