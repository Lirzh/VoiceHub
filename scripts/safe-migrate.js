#!/usr/bin/env node
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env') })

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

if (!process.env.DATABASE_URL) {
  logError('DATABASE_URL 环境变量未设置')
  process.exit(1)
}

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

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath)
  } catch {
    return false
  }
}

async function safeMigrate() {
  log('🔄 开始安全数据库迁移流程...', 'bright')

  const projectRoot = path.resolve(process.cwd(), '..')
  const drizzleConfigPath = path.join(projectRoot, 'drizzle.config.ts')
  const schemaPath = path.join(projectRoot, 'app/drizzle/schema.ts')
  const migrationsPath = path.join(projectRoot, 'app/drizzle/migrations')

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

  log('执行数据库迁移...', 'cyan')
  const env = {
    ...process.env,
    DRIZZLE_KIT_FORCE: 'true',
    CI: 'true',
    NODE_ENV: 'production',
  }

  if (!safeExec('cd .. && pnpm run db:migrate', { env })) {
    throw new Error('数据库迁移失败')
  }

  logSuccess('数据库迁移流程完成！')
}

safeMigrate().catch((error) => {
  logError(`迁移失败: ${error.message}`)
  process.exit(1)
})
