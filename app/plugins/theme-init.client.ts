// 主题初始化插件 - 在 Vue 初始化前同步执行
export default defineNuxtPlugin(() => {
  // 只在客户端执行
  if (typeof window === 'undefined') return

  try {
    const theme = localStorage.getItem('voicehub-theme') || 'dark'
    document.documentElement.setAttribute('data-theme', theme)
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark')
  }
})
