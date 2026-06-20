// 数据库连接诊断：
//   postgres-js 本身已具备"查询出错后自动重连"的能力，
//   这里只做"发起一次真实查询 + 读取连接池状态"以验证连接可用。
import { defineEventHandler } from 'h3'
import { databaseManager } from '~~/server/utils/database-manager'

export default defineEventHandler(async (_event) => {
  try {
    // 1. 发起一次查询，验证底层连接可用（postgres-js 会按需自动重连）
    const connectionStatus = await databaseManager.getConnectionStatus()
    // 2. 读取连接池信息（pg_stat_activity / pg_settings 层面统计）
    const poolStatus = await databaseManager.getConnectionPoolStatus()

    return {
      success: true,
      message: connectionStatus.connected ? '数据库连接正常' : '数据库连接异常',
      connected: connectionStatus.connected,
      connectionStatus,
      poolStatus,
      timestamp: new Date().toISOString()
    }
  } catch (error: any) {
    return {
      success: false,
      message: '查询失败：' + (error instanceof Error ? error.message : String(error)),
      connected: false,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    }
  }
})
