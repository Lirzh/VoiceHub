#!/usr/bin/env node
/**
 * safe-migrate.js — 安全数据库迁移脚本
 *
 * 核心改动：不再依赖 drizzle-kit introspect 的文本输出判断 schema 状态，
 * 而是直接查询 PostgreSQL 系统表（pg_type, pg_enum, information_schema）
 * 来判断数据库是否缺少关键对象，从而决定走 migrate 还是 push --force。
 *
 * 三种数据库状态：
 * 1. 空库（没有任何用户表） → drizzle-kit migrate（标准迁移）
 * 2. Legacy 库（有表但 __drizzle_migrations__ 为空，且 schema 已完整） → 跳过迁移
 * 3. Schema 缺失关键对象的库 → drizzle-kit push --force 修复
 * 4. 有迁移记录的库 → drizzle-kit migrate（增量迁移）
 */
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { config } from 'dotenv'
import pg from 'pg'

// 加载环境变量
config({ path: path.resolve(process.cwd(), '.env') })

// 颜色输出函数
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
}
function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}
function logSuccess(message) {
  log(`✅ ${message}`, 'green')
}
function logWarning(message) {
  log(`⚠️ ${message}`, 'yellow')
}
function logError(message) {
  log(`❌ ${message}`, 'red')
}

// 检查环境变量
if (!process.env.DATABASE_URL) {
  logError('DATABASE_URL 环境变量未设置')
  process.exit(1)
}

// 安全执行命令
function safeExec(command, options = {}) {
  try {
    execSync(command, { stdio: 'inherit', ...options })
    return true
  } catch (error) {
    logError(`命令执行失败: ${command}`)
    logError(error.message)
    return false
  }
}

// 检查文件是否存在
function fileExists(filePath) {
  try {
    return fs.existsSync(filePath)
  } catch {
    return false
  }
}

/**
 * 从 DATABASE_URL 中提取 PostgreSQL 连接参数
 * 支持格式：postgresql://user:password@host:port/dbname
 */
function parseDatabaseUrl(url) {
  try {
    const parsed = new URL(url)
    return {
      host: parsed.hostname || 'localhost',
      port: parseInt(parsed.port, 10) || 5432,
      database: parsed.pathname.slice(1),
      user: decodeURIComponent(parsed.username || 'postgres'),
      password: decodeURIComponent(parsed.password || ''),
    }
  } catch {
    return null
  }
}

/**
 * 查询 PostgreSQL 系统表，检查关键 schema 对象是否存在
 *
 * 检查项：
 * - user_status 枚举类型及其值（active, withdrawn, graduate）
 * - api_keys 表
 * - SystemSettings.instance_id 和 telemetryEnabled 列
 * - card_code_status 枚举类型
 * - CardCode 表
 * - Song.cardCodeId 列
 *
 * 返回 { missing: string[], isLegacy: boolean }
 *   missing: 缺少的关键对象列表
 *   isLegacy: 是否为 legacy 数据库（有表但无迁移记录）
 */
async function checkSchemaConsistency() {
  const params = parseDatabaseUrl(process.env.DATABASE_URL)
  if (!params) {
    logError('无法解析 DATABASE_URL')
    return { missing: ['DATABASE_URL 解析失败'], isLegacy: false }
  }

  const client = new pg.Client({
    host: params.host,
    port: params.port,
    database: params.database,
    user: params.user,
    password: params.password,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 10000,
  })

  const missing = []

  try {
    await client.connect()

    // --- 1. 检查是否有任何用户表（判断空库） ---
    const tableCountResult = await client.query(`
      SELECT COUNT(*) as cnt
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name NOT IN ('__drizzle_migrations__', 'spatial_ref_sys')
    `)
    const tableCount = parseInt(tableCountResult.rows[0].cnt, 10)

    if (tableCount === 0) {
      log('🆕 检测到空数据库', 'cyan')
      return { missing: [], isEmpty: true, isLegacy: false }
    }

    // --- 2. 检查 __drizzle_migrations__ 表是否存在且有记录 ---
    let hasMigrationRecords = false
    const migrationTableExists = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = '__drizzle_migrations__'
      )
    `)
    if (migrationTableExists.rows[0].exists) {
      const migrationCount = await client.query(`
        SELECT COUNT(*) as cnt FROM public.__drizzle_migrations__
      `)
      hasMigrationRecords = parseInt(migrationCount.rows[0].cnt, 10) > 0
    }

    // --- 3. 检查 user_status 枚举类型 ---
    const enumResult = await client.query(`
      SELECT e.enumlabel
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      JOIN pg_namespace n ON t.typnamespace = n.oid
      WHERE n.nspname = 'public' AND t.typname = 'user_status'
      ORDER BY e.enumsortorder
    `)
    const enumValues = enumResult.rows.map((r) => r.enumlabel)
    const requiredValues = ['active', 'withdrawn', 'graduate']
    const missingValues = requiredValues.filter((v) => !enumValues.includes(v))
    if (enumValues.length === 0) {
      missing.push('user_status enum type')
    } else if (missingValues.length > 0) {
      missing.push(`user_status enum 缺少值: ${missingValues.join(', ')}`)
    }

    // --- 4. 检查 api_keys 表 ---
    const apiKeysExists = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'api_keys'
      )
    `)
    if (!apiKeysExists.rows[0].exists) {
      missing.push('api_keys table')
    }

    // --- 5. 检查 SystemSettings.instance_id 和 telemetryEnabled ---
    const systemSettingsCols = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'SystemSettings'
        AND column_name IN ('instance_id', 'telemetryEnabled')
    `)
    const sysCols = systemSettingsCols.rows.map((r) => r.column_name)
    if (!sysCols.includes('instance_id')) {
      missing.push('SystemSettings.instance_id column')
    }
    if (!sysCols.includes('telemetryEnabled')) {
      missing.push('SystemSettings.telemetryEnabled column')
    }

    // --- 6. 检查 card_code_status 枚举和 CardCode 表 ---
    const cardCodeStatusExists = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON t.typnamespace = n.oid
        WHERE n.nspname = 'public' AND t.typname = 'card_code_status'
      )
    `)
    if (!cardCodeStatusExists.rows[0].exists) {
      missing.push('card_code_status enum type')
    }

    const cardCodeExists = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'CardCode'
      )
    `)
    if (!cardCodeExists.rows[0].exists) {
      missing.push('CardCode table')
    }

    // --- 7. 检查 Song.cardCodeId 列 ---
    const songCardCodeCol = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'Song'
          AND column_name = 'cardCodeId'
      )
    `)
    if (!songCardCodeCol.rows[0].exists) {
      missing.push('Song.cardCodeId column')
    }

    // --- 8. 检查 collaborator_status 枚举 ---
    const collaboratorStatusExists = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON t.typnamespace = n.oid
        WHERE n.nspname = 'public' AND t.typname = 'collaborator_status'
      )
    `)
    if (!collaboratorStatusExists.rows[0].exists) {
      missing.push('collaborator_status enum type')
    }

    // --- 9. 检查 song_collaborators 表 ---
    const collaboratorsExists = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'song_collaborators'
      )
    `)
    if (!collaboratorsExists.rows[0].exists) {
      missing.push('song_collaborators table')
    }

    // --- 10. 检查 replay_request_status 枚举 ---
    const replayStatusExists = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON t.typnamespace = n.oid
        WHERE n.nspname = 'public' AND t.typname = 'replay_request_status'
      )
    `)
    if (!replayStatusExists.rows[0].exists) {
      missing.push('replay_request_status enum type')
    }

    // --- 11. 检查 song_replay_requests 表 ---
    const replayRequestsExists = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'song_replay_requests'
      )
    `)
    if (!replayRequestsExists.rows[0].exists) {
      missing.push('song_replay_requests table')
    }

    // --- 12. 检查 UserIdentity 表 ---
    const userIdentityExists = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'UserIdentity'
      )
    `)
    if (!userIdentityExists.rows[0].exists) {
      missing.push('UserIdentity table')
    }

    // 判断是否为 legacy 数据库
    const isLegacy = !hasMigrationRecords

    return { missing, isEmpty: false, isLegacy }
  } catch (error) {
    logError(`数据库查询失败: ${error.message}`)
    return { missing: ['数据库查询失败: ' + error.message], isEmpty: false, isLegacy: false }
  } finally {
    await client.end()
  }
}

/**
 * 自动执行 generate 命令并处理交互提示
 */
function runGenerateWithAutoConfirm(env) {
  return new Promise((resolve) => {
    const { spawn } = require('child_process')
    const child = spawn('pnpm', ['run', 'db:generate'], {
      env,
      shell: true,
    })
    child.stdout.on('data', (data) => {
      process.stdout.write(data)
      const str = data.toString()
      if (str.includes('?') || str.includes('renamed') || str.includes('created')) {
        try {
          child.stdin.write('\n')
        } catch (e) {
          // 忽略写入错误
        }
      }
    })
    child.stderr.on('data', (data) => {
      process.stderr.write(data)
    })
    child.on('close', (code) => {
      resolve(code === 0)
    })
    child.on('error', () => {
      resolve(false)
    })
  })
}

async function safeMigrate() {
  log('🔄 开始安全数据库迁移流程...', 'bright')
  try {
    const projectRoot = path.resolve(process.cwd(), '..')
    const drizzleConfigPath = path.join(projectRoot, 'drizzle.config.ts')
    const schemaPath = path.join(projectRoot, 'app/drizzle/schema.ts')
    const migrationsPath = path.join(projectRoot, 'app/drizzle/migrations')

    // 1. 确保配置文件存在
    if (!fileExists(drizzleConfigPath)) {
      throw new Error(`drizzle.config.ts 配置文件不存在: ${drizzleConfigPath}`)
    }
    if (!fileExists(schemaPath)) {
      throw new Error(`app/drizzle/schema.ts 文件不存在: ${schemaPath}`)
    }
    if (!fileExists(migrationsPath)) {
      log('创建迁移目录...', 'cyan')
      fs.mkdirSync(migrationsPath, { recursive: true })
    }

    // 2. 生成迁移文件（如果需要）
    log('生成数据库迁移文件...', 'cyan')
    const nonInteractiveEnv = {
      ...process.env,
      DRIZZLE_KIT_FORCE: 'true',
      CI: 'true',
      NODE_ENV: 'production',
    }
    const generateSuccess = await runGenerateWithAutoConfirm(nonInteractiveEnv)
    if (!generateSuccess) {
      logWarning('迁移文件生成可能遇到问题，尝试继续...')
    } else {
      logSuccess('迁移文件生成完成')
    }

    // 3. 直接查询 PG 系统表检查 schema 一致性
    log('📋 检查数据库 schema 状态...', 'cyan')
    const { missing, isEmpty, isLegacy } = await checkSchemaConsistency()

    // 设置非交互式环境变量
    const env = {
      ...process.env,
      DRIZZLE_KIT_FORCE: 'true',
      CI: 'true',
      NODE_ENV: 'production',
    }

    // --- 情况 1: 空库 → 标准迁移 ---
    if (isEmpty) {
      log('🆕 检测到全新部署，执行标准迁移...', 'cyan')
      if (!safeExec('cd .. && pnpm run db:migrate', { env })) {
        throw new Error('数据库迁移失败')
      }
      logSuccess('全新数据库迁移成功')
      return
    }

    // --- 情况 2: Legacy 库（有表但无迁移记录）且 schema 完整 → 跳过迁移 ---
    if (isLegacy && missing.length === 0) {
      log('🔄 检测到 legacy 数据库（通过 push 创建），schema 已完整', 'cyan')
      log('⏭️  跳过迁移，避免重放历史迁移导致冲突', 'cyan')
      logSuccess('数据库 schema 验证通过，无需迁移')
      return
    }

    // --- 情况 3: Legacy 库且 schema 不完整 → push --force 修复 ---
    if (isLegacy && missing.length > 0) {
      logWarning(`检测到 legacy 数据库，schema 不完整，缺少: ${missing.join(', ')}`)
      log('🔧 尝试使用 push --force 修复 schema...', 'cyan')
      if (safeExec('cd .. && pnpm exec drizzle-kit push --force --config=drizzle.config.ts', { env })) {
        logSuccess('schema 修复成功')
      } else {
        logError('push --force 修复失败')
        throw new Error('legacy 数据库 schema 修复失败，请手动检查')
      }
      return
    }

    // --- 情况 4: 有迁移记录的库 → 标准增量迁移 ---
    if (missing.length === 0) {
      log('📋 数据库 schema 完整，执行增量迁移...', 'cyan')
      if (!safeExec('cd .. && pnpm run db:migrate', { env })) {
        throw new Error('数据库迁移失败')
      }
      logSuccess('数据库增量迁移成功')
    } else {
      // 有迁移记录但 schema 不完整（异常状态）
      logWarning(`数据库有迁移记录但 schema 不完整，缺少: ${missing.join(', ')}`)
      log('🔧 尝试使用 push --force 修复...', 'cyan')
      if (safeExec('cd .. && pnpm exec drizzle-kit push --force --config=drizzle.config.ts', { env })) {
        logSuccess('schema 修复成功')
      } else {
        logWarning('push --force 失败，尝试标准迁移...')
        if (!safeExec('cd .. && pnpm run db:migrate', { env })) {
          throw new Error('数据库迁移完全失败')
        }
        logSuccess('数据库迁移成功')
      }
    }

    log('✅ 数据库迁移流程完成！', 'green')
  } catch (error) {
    logError(`迁移失败: ${error.message}`)
    logError('请检查数据库连接和迁移文件')
    process.exit(1)
  }
}

// 运行迁移
safeMigrate().catch((error) => {
  logError(`未预期的错误: ${error.message}`)
  process.exit(1)
})
