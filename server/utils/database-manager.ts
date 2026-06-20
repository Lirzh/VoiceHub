// database-manager：为系统 API 与健康检查提供统一入口。
// 注意：本文件不做 schema 初始化。schema 在首次访问数据库时按需自动补齐。

import { db, getConnectionStatus as getClientStatus } from '~/drizzle/db';
import { sql } from 'drizzle-orm';
import {
  getConnectionPoolStatus,
  getDatabaseMetrics
} from './database-health';
import { getServerTimestamp } from './serverTime';

/**
 * 数据库管理器
 */
export class DatabaseManager {
  private static instance: DatabaseManager
  private healthCheckCache: { status: boolean; timestamp: number; latency: number } | null = null
  private readonly CACHE_TTL = 30000 // 30秒缓存

  private constructor() {}

  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager()
    }
    return DatabaseManager.instance
  }

  /**
   * 数据库健康检查（带缓存）
   */
  async healthCheck(): Promise<{
    status: boolean
    latency: number
    timestamp: Date
    connectionStatus: string
    error?: string
  }> {
    const now = getServerTimestamp()

    if (this.healthCheckCache && now - this.healthCheckCache.timestamp < this.CACHE_TTL) {
      return {
        status: this.healthCheckCache.status,
        latency: this.healthCheckCache.latency,
        timestamp: new Date(this.healthCheckCache.timestamp),
        connectionStatus: 'cached'
      }
    }

    const startTime = Date.now()
    try {
      getClientStatus()
      await db.execute(sql`SELECT 1 as health_check`)

      const latency = Date.now() - startTime
      const result = {
        status: true,
        latency,
        timestamp: new Date(),
        connectionStatus: 'connected'
      }
      this.healthCheckCache = { status: true, timestamp: now, latency }
      return result
    } catch (error) {
      const latency = Date.now() - startTime
      const result = {
        status: false,
        latency,
        timestamp: new Date(),
        connectionStatus: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      }
      this.healthCheckCache = { status: false, timestamp: now, latency }
      return result
    }
  }

  /**
   * 基础信息 — pg_database_size 与活跃连接数
   */
  async getBasicMetrics(): Promise<{
    databaseSize: string
    activeConnections: number
    serverless: boolean
  }> {
    const sizeResult = await db.execute(sql`
      SELECT pg_size_pretty(pg_database_size(current_database())) as database_size
    `)
    const connectionStats = await db.execute(sql`
      SELECT count(*) as active_connections
      FROM pg_stat_activity
      WHERE datname = current_database() AND state = 'active'
    `)

    const sizeRow = sizeResult[0] as { database_size?: string } | undefined
    const connRow = connectionStats[0] as { active_connections?: number | string } | undefined

    return {
      databaseSize: sizeRow?.database_size || 'Unknown',
      activeConnections:
        Number.parseInt(String(connRow?.active_connections ?? '0'), 10) || 0,
      serverless: true
    }
  }

  /**
   * 连接状态（执行一次 SELECT 1 验证连通性）
   */
  async getConnectionStatus(): Promise<{
    connected: boolean
    status: string
    activeConnections: number
    serverlessMode: boolean
    autoSuspend: boolean
    error: string | null
  }> {
    try {
      const clientStatus = getClientStatus()
      await db.execute(sql`SELECT 1 as connection_check`)

      let activeConnections = 0
      try {
        const connectionStats = await db.execute(sql`
          SELECT count(*) as active_connections
          FROM pg_stat_activity
          WHERE datname = current_database() AND state = 'active'
        `)
        const connRow = connectionStats[0] as { active_connections?: number | string } | undefined
        activeConnections = Number.parseInt(String(connRow?.active_connections ?? '0'), 10) || 0
      } catch (metricsError) {
        console.warn('Failed to get active connection count:', metricsError)
      }

      return {
        connected: true,
        status: clientStatus.status || 'connected',
        activeConnections,
        serverlessMode: true,
        autoSuspend: true,
        error: null
      }
    } catch (error) {
      console.error('Failed to get connection status:', error)
      return {
        connected: false,
        status: 'error',
        activeConnections: 0,
        serverlessMode: true,
        autoSuspend: true,
        error: error instanceof Error ? error.message : 'Failed to retrieve connection status'
      }
    }
  }

  async getConnectionPoolStatus() {
    return await getConnectionPoolStatus()
  }

  async getPerformanceMetrics() {
    return await getDatabaseMetrics()
  }

  /**
   * 当前 schema 中无 session 表；保留占位以保持 API 向后兼容。
   */
  async cleanupExpiredSessions(): Promise<number> {
    return 0
  }

  clearHealthCheckCache(): void {
    this.healthCheckCache = null
  }
}

export const databaseManager = DatabaseManager.getInstance()
