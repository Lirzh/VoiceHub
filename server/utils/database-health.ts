import { db } from '~/drizzle/db'
import { sql } from 'drizzle-orm'

// 数据库连接池状态检查
export async function getConnectionPoolStatus() {
  try {
    const result = await db.execute(sql`
      SELECT 
        setting::int as max_connections
      FROM pg_settings 
      WHERE name = 'max_connections'
    `)

    const activeConnections = await db.execute(sql`
      SELECT count(*) as active_connections
      FROM pg_stat_activity 
      WHERE state = 'active'
    `)

    const totalConnections = await db.execute(sql`
      SELECT count(*) as total_connections
      FROM pg_stat_activity
    `)

    return {
      maxConnections: result[0]?.max_connections || 0,
      activeConnections: activeConnections[0]?.active_connections || 0,
      totalConnections: totalConnections[0]?.total_connections || 0,
      utilization: result[0]?.max_connections
        ? (
            ((totalConnections[0]?.total_connections || 0) / result[0].max_connections) *
            100
          ).toFixed(2)
        : '0'
    }
  } catch (error) {
    throw new Error(
      `Failed to get connection pool status: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

// 数据库性能指标
export async function getDatabaseMetrics() {
  try {
    const startTime = Date.now()

    // 测试查询响应时间
    await db.execute(sql`SELECT 1`)
    const responseTime = Date.now() - startTime

    // 获取数据库统计信息
    const stats = await db.execute(sql`
      SELECT 
        numbackends as active_connections,
        xact_commit as transactions_committed,
        xact_rollback as transactions_rolled_back,
        blks_read as blocks_read,
        blks_hit as blocks_hit
      FROM pg_stat_database 
      WHERE datname = current_database()
    `)

    const stat = stats[0] || {}

    return {
      responseTime,
      activeConnections: stat.active_connections || 0,
      transactionsCommitted: stat.transactions_committed || 0,
      transactionsRolledBack: stat.transactions_rolled_back || 0,
      cacheHitRatio:
        stat.blocks_read && stat.blocks_hit
          ? ((stat.blocks_hit / (stat.blocks_hit + stat.blocks_read)) * 100).toFixed(2)
          : '0'
    }
  } catch (error) {
    throw new Error(
      `Failed to get database metrics: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}
