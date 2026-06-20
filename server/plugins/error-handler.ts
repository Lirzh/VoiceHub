import { db } from '~/drizzle/db'
import { sql } from 'drizzle-orm'

export default defineNitroPlugin(async (nitroApp) => {

  // 全局未处理的 Promise 拒绝：记录日志，不吞掉错误
  process.on('unhandledRejection', (reason, promise) => {
    const msg = reason instanceof Error ? reason.message : String(reason)
    console.error('Unhandled Rejection at:', promise, 'reason:', msg)
  })

  // 全局未捕获异常：记录日志
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error.message)
  })

  // 定期健康检查（每分钟一次）
  const healthCheckInterval = setInterval(async () => {
    try {
      await db.execute(sql`SELECT 1 as health_check`)
    } catch (error) {
      console.error('Health check failed:', error)
    }
  }, 60000)

  // 在 Nitro 关闭时清理
  nitroApp.hooks.hook('close', () => {
    clearInterval(healthCheckInterval)
  })

  console.log('Global error handler initialized')
})
